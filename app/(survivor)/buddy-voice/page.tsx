"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./buddy-voice.module.css";
import { useTranslation } from "@/lib/i18n";
import { loadBuddySession, saveBuddySession } from "@/lib/buddy-session";
import { getRecentMemoryContext, saveCheckInRecord } from "@/lib/buddy-memory";
import { ChatMessageRenderer } from "@/components/ChatMessageRenderer";

type VoiceState = "idle" | "listening" | "thinking" | "speaking" | "error";

interface ChatItem {
  id: string;
  role: "user" | "buddy";
  text: string;
  isCrisis?: boolean;
}

interface SpeechRecognitionEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type WindowWithSpeech = Window & typeof globalThis & {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  __activeUtterance?: SpeechSynthesisUtterance | null;
};

function mkId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function BuddyVoicePage() {
  const router = useRouter();
  const { lang, t } = useTranslation();

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [conversation, setConversation] = useState<ChatItem[]>([]);
  const [waveHeights, setWaveHeights] = useState<number[]>(Array(28).fill(4));
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [browserSupported, setBrowserSupported] = useState(true);
  const [isCrisisActive, setIsCrisisActive] = useState(false);
  const [showHomeModal, setShowHomeModal] = useState(false);
  const [autoListenEnabled, setAutoListenEnabled] = useState(false);

  // Core execution refs
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const watchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackGenerationRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef<boolean>(true);
  const isProcessingRef = useRef<boolean>(false);
  const hasProcessedSessionRef = useRef<boolean>(false);
  const latestTranscriptRef = useRef<string>("");
  const turnCounterRef = useRef<number>(0);
  const autoListenRef = useRef<boolean>(false);

  // Keep autoListenRef in sync
  useEffect(() => {
    autoListenRef.current = autoListenEnabled;
  }, [autoListenEnabled]);

  // Initialize conversation with memory awareness
  useEffect(() => {
    const existing = loadBuddySession();
    if (existing.length > 0) {
      setConversation(existing.map((m) => ({ id: m.id, role: m.role, text: m.text, isCrisis: m.isCrisis })));
    } else {
      const memoryContext = getRecentMemoryContext();
      let initialText = t.buddyInitialGreeting;

      if (memoryContext) {
        initialText =
          lang === "hi"
            ? "नमस्ते। कल की बातचीत मुझे याद है। आज आप कैसा महसूस कर रहे हैं?"
            : lang === "mr"
            ? "नमस्कार. कालच्या बोलण्याची मला आठवण आहे. आज तुम्हाला कसे वाटत आहे?"
            : "Hello. I was thinking about what you shared earlier. How are you feeling today?";
      }

      const initialGreeting: ChatItem = {
        id: "initial-greeting",
        role: "buddy",
        text: initialText,
      };
      setConversation([initialGreeting]);
      saveBuddySession([{ ...initialGreeting, timestamp: new Date().toISOString() }]);
    }
  }, [t.buddyInitialGreeting, lang]);

  // Check speech recognition support
  useEffect(() => {
    if (typeof window !== "undefined") {
      const win = window as WindowWithSpeech;
      const supported = !!(win.SpeechRecognition || win.webkitSpeechRecognition);
      setBrowserSupported(supported);
    }
  }, []);

  // Animate waveform
  const startWave = useCallback((intensity: number) => {
    if (waveTimerRef.current) clearInterval(waveTimerRef.current);
    waveTimerRef.current = setInterval(() => {
      setWaveHeights(
        Array(28).fill(0).map(() => Math.random() * intensity + 3)
      );
    }, 80);
  }, []);

  const stopWave = useCallback(() => {
    if (waveTimerRef.current) clearInterval(waveTimerRef.current);
    setWaveHeights(Array(28).fill(4));
  }, []);

  // Stop any active audio completely
  const stopAudioPlayback = useCallback(() => {
    playbackGenerationRef.current += 1;
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    if (audioPlayerRef.current) {
      try {
        audioPlayerRef.current.pause();
        audioPlayerRef.current.src = "";
        audioPlayerRef.current.load();
      } catch {}
      audioPlayerRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    activeUtteranceRef.current = null;
    if (typeof window !== "undefined") {
      (window as WindowWithSpeech).__activeUtterance = null;
    }
    stopWave();
  }, [stopWave]);

  // Forward declaration for startListening
  const startListeningRef = useRef<() => void>(() => {});

  // Turn completed: reset state and trigger auto-listen if active
  const onPlaybackFinished = useCallback(() => {
    stopWave();
    if (watchdogTimerRef.current) {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = null;
    }
    audioPlayerRef.current = null;
    activeUtteranceRef.current = null;
    if (typeof window !== "undefined") {
      (window as WindowWithSpeech).__activeUtterance = null;
    }

    isProcessingRef.current = false;
    setVoiceState("idle");

    // Continuous voice flow: auto-return to listening if enabled
    if (autoListenRef.current) {
      setTimeout(() => {
        if (!isProcessingRef.current) {
          startListeningRef.current();
        }
      }, 450);
    }
  }, [stopWave]);

  // Prime / unlock audio element on user gesture
  const primeAudioContext = useCallback(() => {
    try {
      if (!audioPlayerRef.current) {
        const audio = new Audio();
        audio.preload = "auto";
        audio.volume = 1.0;
        audioPlayerRef.current = audio;
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      }
    } catch {}
  }, []);

  // Robust Browser Speech Synthesis (impervious to Chromium GC and cancel-race bugs)
  const speakBrowserFallback = useCallback((text: string) => {
    const playbackGeneration = ++playbackGenerationRef.current;

    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      onPlaybackFinished();
      return;
    }

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }

      // 60ms delay ensures pending cancel() completely flushes in Chromium
      setTimeout(() => {
        if (playbackGeneration !== playbackGenerationRef.current) return;

        try {
          const cleanText = text.replace(/[*_#`]/g, "").trim();
          if (!cleanText) {
            onPlaybackFinished();
            return;
          }

          const utter = new SpeechSynthesisUtterance(cleanText);
          utter.rate = 1.0;
          utter.pitch = 1.0;
          utter.volume = 1.0;

          if (lang === "hi") {
            utter.lang = "hi-IN";
          } else if (lang === "mr") {
            utter.lang = "mr-IN";
          } else {
            utter.lang = "en-IN";
          }

          const voices = window.speechSynthesis.getVoices();
          if (voices && voices.length > 0) {
            const match = voices.find((v) =>
              lang === "hi" ? v.lang.startsWith("hi") :
              lang === "mr" ? v.lang.startsWith("mr") :
              v.lang.startsWith("en-IN") || v.name.includes("Samantha") || v.name.includes("Google")
            );
            if (match) utter.voice = match;
          }

          activeUtteranceRef.current = utter;
          (window as WindowWithSpeech).__activeUtterance = utter;

          setVoiceState("speaking");
          startWave(18);

          utter.onstart = () => {
            setVoiceState("speaking");
            startWave(20);
          };

          utter.onend = () => {
            if (playbackGeneration !== playbackGenerationRef.current) return;
            onPlaybackFinished();
          };

          utter.onerror = (err) => {
            if (playbackGeneration !== playbackGenerationRef.current) return;
            console.warn("[SpeechSynthesis] Error:", err);
            onPlaybackFinished();
          };

          const maxMs = Math.min(16000, Math.max(3000, cleanText.length * 110));
          watchdogTimerRef.current = setTimeout(() => {
            if (playbackGeneration === playbackGenerationRef.current && isProcessingRef.current) {
              onPlaybackFinished();
            }
          }, maxMs);

          window.speechSynthesis.speak(utter);
        } catch {
          onPlaybackFinished();
        }
      }, 60);
    } catch {
      onPlaybackFinished();
    }
  }, [lang, onPlaybackFinished, startWave]);

  // Play Native Gemini / Google Audio with volume guarantee and primed player
  const playGeminiAudio = useCallback((audioBase64: string, fallbackText: string) => {
    try {
      stopAudioPlayback();
      const playbackGeneration = playbackGenerationRef.current;

      let audio = audioPlayerRef.current;
      if (!audio) {
        audio = new Audio();
        audioPlayerRef.current = audio;
      }

      audio.src = audioBase64;
      audio.volume = 1.0;
      audio.muted = false;
      audio.playbackRate = 1.0;
      audio.preload = "auto";

      audio.onplay = () => {
        setVoiceState("speaking");
        startWave(24);
      };

      audio.onended = () => {
        if (playbackGeneration !== playbackGenerationRef.current) return;
        onPlaybackFinished();
      };

      audio.onerror = (e) => {
        if (playbackGeneration !== playbackGenerationRef.current) return;
        console.warn("[BuddyVoice] Native audio error, switching to browser speech fallback:", e);
        speakBrowserFallback(fallbackText);
      };

      watchdogTimerRef.current = setTimeout(() => {
        if (playbackGeneration === playbackGenerationRef.current && isProcessingRef.current && audioPlayerRef.current) {
          onPlaybackFinished();
        }
      }, 20000);

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          if (playbackGeneration !== playbackGenerationRef.current) return;
          console.warn("[BuddyVoice] Audio play() promise rejected, falling back to speech synthesis:", err);
          speakBrowserFallback(fallbackText);
        });
      }
    } catch (err) {
      console.warn("[BuddyVoice] Native audio initialization exception, falling back:", err);
      speakBrowserFallback(fallbackText);
    }
  }, [onPlaybackFinished, speakBrowserFallback, startWave, stopAudioPlayback]);

  // Clean unmount
  useEffect(() => {
    return () => {
      stopAudioPlayback();
      if (waveTimerRef.current) clearInterval(waveTimerRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
    };
  }, [stopAudioPlayback]);

  // Track scroll position
  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isNearBottomRef.current = scrollHeight - (scrollTop + clientHeight) < 80;
  }

  // Smooth scroll
  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [conversation, interimTranscript]);

  // Unified speech-processing pipeline: ONE input -> ONE Gemini reply -> ONE audio playback
  const processUserSpeech = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || isProcessingRef.current) return;

    turnCounterRef.current += 1;
    const currentTurn = turnCounterRef.current;

    // Strict lock
    isProcessingRef.current = true;
    setVoiceState("thinking");
    startWave(8);

    // 1. Add user transcript to conversation
    const userMsg: ChatItem = { id: mkId(`u-t${currentTurn}`), role: "user", text };
    setConversation((prev) => {
      const updated = [...prev, userMsg];
      saveBuddySession(updated.map((m) => ({ ...m, timestamp: new Date().toISOString() })));
      return updated;
    });

    // Wipe transcript ref immediately to prevent duplicate triggers
    latestTranscriptRef.current = "";

    try {
      // 2. Fetch conversation history & memory context
      const currentHistory = loadBuddySession().slice(-8).map((m) => ({
        role: m.role,
        text: m.text,
      }));
      const memoryContext = getRecentMemoryContext();

      // 3. Call server-side Gemini Voice API
      const res = await fetch("/api/buddy/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: text,
          history: currentHistory,
          language: lang,
          voiceName: "Aoede",
          memoryContext,
        }),
      });

      if (!res.ok) {
        throw new Error(`API returned HTTP ${res.status}`);
      }

      const data = await res.json();
      const replyText = data.reply || (lang === "hi" ? "मैं आपकी बात सुन रहा हूँ।" : "I hear you, and I am right here with you.");

      if (data.isCrisis) {
        setIsCrisisActive(true);
      }

      // Record check-in memory
      const lower = text.toLowerCase();
      saveCheckInRecord({
        emotional_state: data.isCrisis ? "crisis" : lower.includes("better") ? "improving" : "venting",
        concerns: data.isCrisis ? ["imminent_danger"] : lower.includes("sleep") ? ["sleep"] : ["stress"],
        support_used: ["voice-checkin"],
        counselor_requested: lower.includes("counselor") || lower.includes("doctor"),
        safety_flag: !!data.isCrisis,
      });

      // 4. Add Buddy response to conversation
      const buddyMsg: ChatItem = {
        id: mkId(`b-t${currentTurn}`),
        role: "buddy",
        text: replyText,
        isCrisis: !!data.isCrisis,
      };
      setConversation((prev) => {
        const updated = [...prev, buddyMsg];
        saveBuddySession(updated.map((m) => ({ ...m, timestamp: new Date().toISOString() })));
        return updated;
      });

      // 5. Play Native Gemini Audio or Fallback (guaranteed audio output on EVERY turn)
      if (data.audioBase64) {
        playGeminiAudio(data.audioBase64, replyText);
      } else {
        speakBrowserFallback(replyText);
      }
    } catch (err) {
      console.error("[BuddyVoice] Error processing speech turn:", err);

      const fallbackReply =
        lang === "hi"
          ? "मैं आपकी बात समझ रहा हूँ। आप सुरक्षित हैं, आराम से गहरी सांस लें।"
          : lang === "mr"
          ? "मी तुमचे ऐकत आहे. तुम्ही येथे सुरक्षित आहात, दीर्घ श्वास घ्या."
          : "I hear you. Take a slow, gentle breath — I'm right here with you.";

      const buddyMsg: ChatItem = {
        id: mkId(`b-fb-t${currentTurn}`),
        role: "buddy",
        text: fallbackReply,
        isCrisis: false,
      };
      setConversation((prev) => {
        const updated = [...prev, buddyMsg];
        saveBuddySession(updated.map((m) => ({ ...m, timestamp: new Date().toISOString() })));
        return updated;
      });

      speakBrowserFallback(fallbackReply);
    }
  }, [lang, playGeminiAudio, speakBrowserFallback, startWave]);

  // Start Speech Recognition
  const startListening = useCallback(() => {
    if (!browserSupported) return;
    const win = window as WindowWithSpeech;
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SR) return;

    // Interrupt active audio
    stopAudioPlayback();

    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = lang === "hi" ? "hi-IN" : lang === "mr" ? "mr-IN" : "en-IN";

    recognitionRef.current = recognition;
    hasProcessedSessionRef.current = false;
    latestTranscriptRef.current = "";

    recognition.onstart = () => {
      setVoiceState("listening");
      setInterimTranscript("");
      startWave(30);
    };

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let combined = "";
      for (let i = 0; i < e.results.length; i++) {
        const item = e.results[i];
        const piece = item[0]?.transcript || "";
        combined += piece;
      }
      const trimmed = combined.trim();
      latestTranscriptRef.current = trimmed;
      setInterimTranscript(trimmed);
    };

    recognition.onerror = (e: { error: string }) => {
      if (e.error === "not-allowed" || e.error === "permission-denied") {
        setHasPermission(false);
      }
      stopWave();
      setVoiceState("error");
      isProcessingRef.current = false;
    };

    recognition.onend = () => {
      stopWave();
      const textToProcess = latestTranscriptRef.current.trim();
      setInterimTranscript("");

      // Hand off utterance exactly once per finished session
      if (!hasProcessedSessionRef.current && textToProcess && !isProcessingRef.current) {
        hasProcessedSessionRef.current = true;
        processUserSpeech(textToProcess);
      } else {
        if (!isProcessingRef.current) {
          setVoiceState("idle");
        }
      }
    };

    try {
      recognition.start();
    } catch {
      setVoiceState("error");
      isProcessingRef.current = false;
    }
  }, [browserSupported, lang, processUserSpeech, startWave, stopAudioPlayback, stopWave]);

  // Keep ref up to date for onPlaybackFinished
  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  function stopListening() {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    stopAudioPlayback();
    setVoiceState("idle");
    setInterimTranscript("");
    isProcessingRef.current = false;
  }

  // Interruption Handling: Clicking while speaking interrupts Buddy immediately
  function handleButtonPress() {
    primeAudioContext();
    if (voiceState === "listening") {
      stopListening();
    } else if (voiceState === "speaking") {
      stopAudioPlayback();
      isProcessingRef.current = false;
      startListening();
    } else if (voiceState === "idle" || voiceState === "error") {
      startListening();
    }
  }

  function confirmGoHome() {
    setShowHomeModal(false);
    stopAudioPlayback();
    router.push("/home");
  }

  const buttonLabel =
    voiceState === "idle"      ? t.btnIdle :
    voiceState === "listening" ? t.btnListening :
    voiceState === "thinking"  ? t.btnThinking :
    voiceState === "speaking"  ? "Tap to Interrupt" :
    t.statusError;

  const statusLabel =
    voiceState === "idle"      ? t.statusIdle :
    voiceState === "listening" ? t.statusListening :
    voiceState === "thinking"  ? t.statusThinking :
    voiceState === "speaking"  ? t.statusSpeaking :
    "Connection issue. Tap to retry.";

  const stateColor =
    voiceState === "listening" ? "var(--risk-high)"  :
    voiceState === "speaking"  ? "var(--brand)"      :
    voiceState === "thinking"  ? "var(--risk-medium)":
    voiceState === "error"     ? "var(--risk-high)"  :
    "var(--brand)";

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.buddyInfo}>
          <div className={styles.buddyAvatarLg} aria-hidden>
            <span className={styles.buddyEmoji}>💜</span>
            {voiceState === "speaking" && <div className={styles.speakingRing} />}
          </div>
          <div>
            <div className={styles.buddyName}>{t.buddyVoiceTitle}</div>
            <div className={styles.buddyStatus} style={{ color: stateColor }}>
              <span className={styles.statusDot} style={{ background: stateColor }} />
              {statusLabel}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowHomeModal(true)}
          >
            {t.backHome}
          </button>
          <Link href="/checkin" className="btn btn-secondary btn-sm">
            {t.chat}
          </Link>
        </div>
      </div>

      {/* Browser not supported warning */}
      {!browserSupported && (
        <div className={styles.unsupportedBanner}>
          ⚠️ Your browser does not support Web Speech recognition. Please use Google Chrome or Microsoft Edge for voice check-in.
        </div>
      )}

      {/* Microphone permission denied */}
      {hasPermission === false && (
        <div className={styles.permBanner}>
          🎙️ Microphone permission was denied. Please allow microphone access in your browser site settings and refresh.
        </div>
      )}

      {/* Crisis / Safety Escalation Alert */}
      {isCrisisActive && (
        <div className="alert alert-danger animate-fade-in" style={{ margin: "0 0 var(--sp-2)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sp-1)" }}>
            <strong>⚡ Immediate Safety Support</strong>
            <button
              onClick={() => setIsCrisisActive(false)}
              className="btn btn-ghost btn-sm"
              style={{ padding: "0 6px", height: "auto" }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
          <p className="text-sm" style={{ margin: "0 0 var(--sp-2)" }}>
            We are here with you. If you are in crisis or need urgent protection:
          </p>
          <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
            <a href="tel:14566" className="btn btn-danger btn-sm">🆘 Call NHAA 14566</a>
            <a href="tel:14416" className="btn btn-secondary btn-sm">📞 Tele-MANAS 14416</a>
            <Link href="/breathing" className="btn btn-secondary btn-sm">🌬️ 4-7-8 Breathing</Link>
          </div>
        </div>
      )}

      {/* Conversation scroll area */}
      <div
        className={styles.conversationArea}
        ref={scrollRef}
        onScroll={handleScroll}
        aria-live="polite"
        role="log"
      >
        {conversation.map((msg) => (
          <div key={msg.id} className={`${styles.msgRow} ${msg.role === "user" ? styles.userRow : ""}`}>
            {msg.role === "buddy" && (
              <div className={styles.buddyAvatarSm} aria-hidden>💜</div>
            )}
            <div
              className={`${styles.bubble} ${
                msg.role === "user" ? styles.userBubble : styles.buddyBubble
              } ${msg.isCrisis && msg.role === "buddy" ? styles.crisisBubble : ""}`}
            >
              <ChatMessageRenderer
                text={msg.text}
                isCrisis={msg.isCrisis}
                role={msg.role}
              />
            </div>
            {msg.role === "user" && (
              <div className={styles.userAvatar} aria-hidden>🎙️</div>
            )}
          </div>
        ))}

        {/* Interim transcript temporary display */}
        {interimTranscript && (
          <div className={`${styles.msgRow} ${styles.userRow}`}>
            <div className={`${styles.bubble} ${styles.userBubble} ${styles.interim}`}>
              {interimTranscript}<span className={styles.cursor} />
            </div>
            <div className={styles.userAvatar} aria-hidden>🎙️</div>
          </div>
        )}

        {/* Thinking indicator */}
        {voiceState === "thinking" && (
          <div className={styles.msgRow}>
            <div className={styles.buddyAvatarSm} aria-hidden>💜</div>
            <div className={`${styles.bubble} ${styles.buddyBubble} ${styles.thinking}`}>
              <span className={styles.dot1} />
              <span className={styles.dot2} />
              <span className={styles.dot3} />
            </div>
          </div>
        )}
      </div>

      {/* Waveform visualizer */}
      <div className={styles.waveformArea} aria-hidden>
        <div className={styles.waveform}>
          {waveHeights.map((h, i) => (
            <div
              key={i}
              className={styles.waveBar}
              style={{
                height: `${h}px`,
                background: stateColor,
                opacity: voiceState === "idle" ? 0.3 : 0.85,
                transition: voiceState !== "idle" ? "height 0.08s ease" : "height 0.4s ease, opacity 0.4s ease",
              }}
            />
          ))}
        </div>
        {voiceState !== "idle" && (
          <div className={styles.waveLabel} style={{ color: stateColor }}>
            {voiceState === "listening" && "Listening to your voice…"}
            {voiceState === "speaking"  && "Buddy is speaking (Tap mic to interrupt)…"}
            {voiceState === "thinking"  && "Buddy is thinking with Gemini…"}
          </div>
        )}
      </div>

      {/* Main microphone action button */}
      <div className={styles.controls}>
        <button
          className={`${styles.micBtn} ${voiceState === "listening" ? styles.micActive : ""} ${voiceState === "thinking" ? styles.micThinking : ""}`}
          onClick={handleButtonPress}
          disabled={voiceState === "thinking" || !browserSupported}
          aria-label={buttonLabel}
          style={{
            "--btn-color": stateColor,
          } as React.CSSProperties}
        >
          <span className={styles.micIcon}>
            {voiceState === "idle"      && "🎙️"}
            {voiceState === "listening" && "⏹"}
            {voiceState === "thinking"  && "⌛"}
            {voiceState === "speaking"  && "⏹"}
            {voiceState === "error"     && "🔄"}
          </span>
        </button>
        <div className={styles.btnLabel}>{buttonLabel}</div>

        {/* Continuous conversation toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8125rem", color: "var(--ink-muted)", cursor: "pointer", marginTop: "2px" }}>
          <input
            type="checkbox"
            checked={autoListenEnabled}
            onChange={(e) => setAutoListenEnabled(e.target.checked)}
            style={{ cursor: "pointer" }}
          />
          Hands-free continuous conversation
        </label>
      </div>

      {/* Helper quick actions */}
      <div className={styles.helpers}>
        <Link href="/breathing" className={styles.helperChip}>
          {t.needToBreathe}
        </Link>
        <Link href="/grounding" className={styles.helperChip}>
          🌿 Grounding 5-4-3-2-1
        </Link>
        <Link href="/checkin" className={styles.helperChip}>
          {t.preferText}
        </Link>
        <a href="tel:14566" className={styles.helperChip} style={{ color: "var(--risk-high)", borderColor: "rgba(201,82,107,.3)" }}>
          {t.emergencyHotline}
        </a>
      </div>

      {/* Prototype Privacy Disclaimer */}
      <p className={styles.privacyNote}>
        {t.buddySecureDisclaimer}
      </p>

      {/* Home Navigation Confirmation Modal (Req 22) */}
      {showHomeModal && (
        <div className={styles.modalOverlay} onClick={() => setShowHomeModal(false)} role="presentation">
          <div
            className={styles.glassModal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-home-modal-title"
          >
            <div className={styles.modalIconBadge}>💜</div>
            <h2 id="voice-home-modal-title" className={styles.modalTitle}>{t.homeModalTitle}</h2>
            <p className={styles.modalDesc}>{t.homeModalDesc}</p>
            <div className={styles.modalBtns}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowHomeModal(false)}
                style={{ flex: 1 }}
              >
                {t.cancel}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmGoHome}
                style={{ flex: 1 }}
              >
                {t.goHome}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
