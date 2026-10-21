"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./checkin.module.css";
import { ChatMessage } from "@/lib/mock-data";
import { useTranslation } from "@/lib/i18n";
import { loadBuddySession, saveBuddySession } from "@/lib/buddy-session";
import { getRecentMemoryContext, saveCheckInRecord } from "@/lib/buddy-memory";
import { ChatMessageRenderer } from "@/components/ChatMessageRenderer";

function mkId(prefix = "m") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function CheckInPage() {
  const router = useRouter();
  const { lang, t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [suggestEmergency, setSuggestEmergency] = useState(false);
  const [showHomeModal, setShowHomeModal] = useState(false);
  const [activeModel, setActiveModel] = useState<string>("gemini-3.8-flash");

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSendingRef = useRef<boolean>(false);
  const recognitionRef = useRef<any>(null);

  // Initialize from session or set translated initial greeting with memory awareness
  useEffect(() => {
    const existing = loadBuddySession();
    if (existing.length > 0) {
      setMessages(existing);
    } else {
      const memoryContext = getRecentMemoryContext();
      let greetingText = "";

      if (memoryContext) {
        greetingText =
          lang === "hi"
            ? "नमस्ते। कल आपने जो साझा किया था, मुझे याद है। आज आप कैसा महसूस कर रहे हैं?"
            : lang === "mr"
            ? "नमस्कार. काल तुम्ही जे सांगितले होते, त्याची आठवण आहे. आज तुम्हाला कसे वाटत आहे?"
            : "Hello. I was thinking about what we spoke about recently. How are things feeling for you today?";
      } else {
        greetingText =
          lang === "hi"
            ? "नमस्ते। मैं आपका साथी बडी हूँ। आज आप कैसा महसूस कर रहे हैं? आप जो भी साझा करना चाहें, मैं सुनने के लिए यहाँ हूँ।"
            : lang === "mr"
            ? "नमस्कार. मी तुमचा मित्र बडी. आज तुम्हाला कसे वाटत आहे? तुम्ही हवे तेवढे मनमोकळेपणाने सांगू शकता, मी सोबत आहे."
            : "Hello. I'm Buddy, your support companion. How are you feeling today? You can share as much or as little as you'd like.";
      }

      const initial: ChatMessage = {
        id: "initial-msg",
        role: "buddy",
        text: greetingText,
        timestamp: new Date().toISOString(),
      };
      setMessages([initial]);
      saveBuddySession([initial]);
    }
  }, [lang]);

  // Keep scroll pinned to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isTyping, suggestEmergency]);

  // Handle Speech-to-Text dictation in input bar
  const handleVoiceInput = useCallback(() => {
    if (isRecording) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      setIsRecording(false);
      return;
    }

    if (typeof window === "undefined") return;
    const win = window as any;
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      setInput((prev) => prev ? prev : (lang === "hi" ? "मुझे आज थोड़ी घबराहट महसूस हो रही है।" : "I felt overwhelmed today and needed to talk."));
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = lang === "hi" ? "hi-IN" : lang === "mr" ? "mr-IN" : "en-IN";

      rec.onstart = () => setIsRecording(true);
      rec.onresult = (event: any) => {
        let text = "";
        for (let i = 0; i < event.results.length; i++) {
          text += event.results[i][0]?.transcript || "";
        }
        if (text.trim()) {
          setInput(text.trim());
        }
      };
      rec.onerror = () => setIsRecording(false);
      rec.onend = () => setIsRecording(false);

      recognitionRef.current = rec;
      rec.start();
    } catch {
      setIsRecording(false);
    }
  }, [isRecording, lang]);

  // Clean up speech recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
    };
  }, []);

  // Send message to real Gemini API
  async function sendMessage(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || isSendingRef.current || isTyping) return;

    isSendingRef.current = true;
    setInput("");

    // 1. Add user message
    const userMsg: ChatMessage = {
      id: mkId("u"),
      role: "user",
      text: msg,
      timestamp: new Date().toISOString(),
    };

    const updatedWithUser = [...messages, userMsg];
    setMessages(updatedWithUser);
    saveBuddySession(updatedWithUser);
    setIsTyping(true);

    try {
      // 2. Fetch conversation history & memory context
      const historyPayload = messages.slice(-8).map((m) => ({
        role: m.role,
        text: m.text,
      }));
      const memoryContext = getRecentMemoryContext();

      const res = await fetch("/api/buddy/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          history: historyPayload,
          language: lang,
          memoryContext,
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const data = await res.json();
      const replyText = data.reply || (lang === "hi" ? "मैं आपकी बात समझ रहा हूँ।" : "I hear you, and I am right here with you.");

      if (data.isCrisis) {
        setSuggestEmergency(true);
      }
      if (data.modelUsed) {
        setActiveModel(data.modelUsed);
      }

      // Record lightweight check-in memory
      const lower = msg.toLowerCase();
      saveCheckInRecord({
        emotional_state: data.isCrisis ? "crisis" : lower.includes("better") || lower.includes("calmer") ? "improving" : "venting",
        concerns: data.isCrisis ? ["imminent_danger"] : lower.includes("sleep") ? ["sleep"] : lower.includes("exam") ? ["exams"] : ["stress"],
        support_used: ["chat"],
        counselor_requested: lower.includes("counselor") || lower.includes("doctor"),
        safety_flag: !!data.isCrisis,
      });

      // 3. Add Gemini response
      const buddyReply: ChatMessage = {
        id: mkId("b"),
        role: "buddy",
        text: replyText,
        timestamp: new Date().toISOString(),
        isCrisis: !!data.isCrisis,
      };

      const finalMessages = [...updatedWithUser, buddyReply];
      setMessages(finalMessages);
      saveBuddySession(finalMessages);
    } catch (err) {
      console.error("[Checkin] Error calling Gemini API:", err);

      const fallbackText =
        lang === "hi"
          ? "मैं आपकी बात सुन रहा हूँ। आप सुरक्षित हैं, आराम से थोड़ा गहरा सांस लें।"
          : lang === "mr"
          ? "मी तुमचे ऐकत आहे. तुम्ही सुरक्षित आहात, शांतपणे दीर्घ श्वास घ्या."
          : "I hear you. Take a slow, gentle breath — I'm right here with you.";

      const fallbackReply: ChatMessage = {
        id: mkId("b-fb"),
        role: "buddy",
        text: fallbackText,
        timestamp: new Date().toISOString(),
        isCrisis: false,
      };

      const finalMessages = [...updatedWithUser, fallbackReply];
      setMessages(finalMessages);
      saveBuddySession(finalMessages);
    } finally {
      setIsTyping(false);
      isSendingRef.current = false;
    }
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString(lang === "hi" || lang === "mr" ? "hi-IN" : "en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const QUICK_PHRASES =
    lang === "hi"
      ? [
          "मुझे घबराहट हो रही है",
          "मुझे किसी से बात करनी है",
          "आज मैं सुरक्षित महसूस नहीं कर रहा",
          "मुझे नींद नहीं आ रही",
          "अब थोड़ा बेहतर लग रहा है",
        ]
      : lang === "mr"
      ? [
          "मला खूप भीती वाटत आहे",
          "मला कोणाशी तरी बोलायचे आहे",
          "मला आज सुरक्षित वाटत नाही",
          "मला झोप येत नाही",
          "आता थोडे बरे वाटत आहे",
        ]
      : [
          "I'm feeling anxious",
          "I don't feel safe today",
          "I need someone to listen",
          "I had trouble sleeping",
          "I feel a bit calmer now",
        ];

  function confirmGoHome() {
    setShowHomeModal(false);
    router.push("/home");
  }

  return (
    <div className={styles.page}>
      {/* Top Header */}
      <div className={styles.header}>
        <div className={styles.buddyMeta}>
          <div className={styles.buddyAvatar} aria-hidden>💜</div>
          <div>
            <div className={styles.buddyName}>Buddy</div>
            <div className={styles.buddyStatus}>
              <span className={styles.statusDot} />
              AI Support Companion · Gemini Live
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
          <Link href="/buddy-voice" className={styles.voiceSwitchBtn}>
            <span className={styles.voicePulseDot} aria-hidden />
            <span>🎙️ {t.voice}</span>
          </Link>
        </div>
      </div>

      <div className={styles.privacyBanner}>
        <span>🔒</span>
        <span>{t.privacyNote}</span>
      </div>

      {/* Chat thread */}
      <div className={styles.thread} ref={scrollRef} role="log" aria-live="polite" aria-label="Chat messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`${styles.msgRow} ${msg.role === "user" ? styles.msgRowUser : ""}`}>
            {msg.role === "buddy" && (
              <div className={styles.avatarSmall} aria-hidden>💜</div>
            )}
            <div>
              <div
                className={`chat-bubble ${msg.role} ${
                  msg.isCrisis && msg.role === "buddy" ? styles.crisisBubble : ""
                }`}
              >
                <ChatMessageRenderer
                  text={msg.text}
                  isCrisis={msg.isCrisis}
                  role={msg.role}
                />
              </div>
              <div className={`text-xs text-faint ${styles.timestamp}`}>{formatTime(msg.timestamp)}</div>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className={styles.msgRow}>
            <div className={styles.avatarSmall} aria-hidden>💜</div>
            <div className={`chat-bubble buddy ${styles.typingBubble}`} aria-label="Buddy is typing">
              <span className={styles.dot1} />
              <span className={styles.dot2} />
              <span className={styles.dot3} />
            </div>
          </div>
        )}

        {/* Dynamic safety escalation prompt */}
        {suggestEmergency && (
          <div className={`${styles.emergencySuggestion} animate-fade-in`}>
            <div className={styles.emergencyHead}>
              <span>⚡ Safety Support Options</span>
              <button className={styles.closeAlertBtn} onClick={() => setSuggestEmergency(false)} aria-label="Dismiss">✕</button>
            </div>
            <p className="text-sm">We detected high distress. We are right here with you:</p>
            <div className={styles.emergencyActions}>
              <a href="tel:14566" className="btn btn-danger btn-sm">🆘 Call NHAA 14566</a>
              <a href="tel:14416" className="btn btn-secondary btn-sm">📞 Tele-MANAS 14416</a>
              <Link href="/breathing" className="btn btn-secondary btn-sm">🌬️ 4-7-8 Breathing</Link>
              <Link href="/buddy-voice" className="btn btn-secondary btn-sm">🎙️ Speak to Buddy</Link>
            </div>
          </div>
        )}
      </div>

      {/* Quick phrases */}
      <div className={styles.quickPhrases} aria-label="Quick message suggestions">
        {QUICK_PHRASES.map((phrase) => (
          <button
            key={phrase}
            className={styles.phraseChip}
            onClick={() => sendMessage(phrase)}
            disabled={isTyping}
          >
            {phrase}
          </button>
        ))}
      </div>

      {/* Input bar */}
      <form
        className={styles.inputBar}
        onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
        aria-label="Send a message"
      >
        <button
          type="button"
          className={`${styles.micToggleBtn} ${isRecording ? styles.micActive : ""}`}
          onClick={handleVoiceInput}
          aria-label={isRecording ? "Listening to your voice" : "Voice dictation"}
          title={isRecording ? "Listening..." : "Dictate with voice"}
        >
          {isRecording ? "🔴" : "🎙️"}
        </button>

        <input
          ref={inputRef}
          className={`input ${styles.chatInput}`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isRecording ? "Listening to your speech..." : "Type how you're feeling…"}
          aria-label="Your message"
          maxLength={500}
        />

        <button
          type="submit"
          className={`btn btn-primary ${styles.sendBtn}`}
          disabled={!input.trim() || isTyping}
          aria-label="Send message"
        >
          Send
        </button>
      </form>

      {/* Home Navigation Confirmation Modal (Req 22) */}
      {showHomeModal && (
        <div className={styles.modalOverlay} onClick={() => setShowHomeModal(false)} role="presentation">
          <div
            className={styles.glassModal}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="home-modal-title"
          >
            <div className={styles.modalIconBadge}>💜</div>
            <h2 id="home-modal-title" className={styles.modalTitle}>{t.homeModalTitle}</h2>
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
