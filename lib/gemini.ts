// ─── TRAC-Mind Gemini AI Server-Side Service ──────────────────────────────────
// SECURE: Only executes server-side in API routes.
// GEMINI_API_KEY is NEVER exposed to the frontend/browser.

import {
  buildSystemInstruction,
  BUDDY_VOICES,
  HELPLINES,
  BuddyChatMessage,
} from "./buddy-personality";
import { assessSafety, buildSafetyContextNote } from "./safety-engine";
import { assessTextDistress, buildVoiceAssessmentNote } from "./voice-analysis";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Cascading text models prioritized by latency and availability
const TEXT_MODELS = [
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3-flash-preview",
  "gemini-3.7-flash",
];

// Cascading TTS models for native audio generation
const TTS_MODELS = [
  "gemini-3.8-flash-tts",
  "gemini-2.5-flash-preview-tts",
  "gemini-3.8-flash-lite-tts",
];

// In-memory model cooldown tracking to bypass rate-limited models instantly
const modelCooldown = new Map<string, number>();

function isModelInCooldown(model: string): boolean {
  const until = modelCooldown.get(model);
  if (!until) return false;
  if (Date.now() > until) {
    modelCooldown.delete(model);
    return false;
  }
  return true;
}

function setModelCooldown(model: string, ms = 20000) {
  modelCooldown.set(model, Date.now() + ms);
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not defined in environment variables.");
  }
  return key.trim();
}

export interface ChatRequestPayload {
  message: string;
  history?: BuddyChatMessage[];
  language?: "en" | "hi" | "mr";
  memoryContext?: string | null;
}

export interface ChatResponsePayload {
  reply: string;
  isCrisis: boolean;
  modelUsed: string;
  suggestedHelpline?: {
    name: string;
    number: string;
  };
}

export interface VoiceResponsePayload extends ChatResponsePayload {
  audioBase64?: string;
  mimeType?: string;
  audioDurationMs?: number;
  fallbackToBrowserVoice?: boolean;
}

// Convert conversation history into Google Generative AI Content format
function formatContents(history: BuddyChatMessage[] = [], latestMessage: string) {
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  // Take the last 8 turns to optimize latency and token overhead
  const recentHistory = history.slice(-8);

  for (const item of recentHistory) {
    if (!item.text?.trim()) continue;
    contents.push({
      role: item.role === "user" ? "user" : "model",
      parts: [{ text: item.text.trim() }],
    });
  }

  // Append current turn
  contents.push({
    role: "user",
    parts: [{ text: latestMessage.trim() }],
  });

  return contents;
}

/**
 * Generate multi-turn text chat response using Gemini cascade
 */
export async function generateBuddyChat(
  payload: ChatRequestPayload & { safetyContextNote?: string | null; voiceAssessmentNote?: string | null }
): Promise<ChatResponsePayload> {
  const { message, history = [], language = "en", memoryContext, safetyContextNote, voiceAssessmentNote } = payload;

  // Context-aware safety assessment (replaces single detectCrisisIntent call)
  const safetyAssessment = assessSafety(message, history);
  const isCrisis = safetyAssessment.isCrisis;
  const safetyNote = safetyContextNote ?? buildSafetyContextNote(safetyAssessment);

  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch (err: unknown) {
    console.error("[Buddy Gemini] API key missing:", err);
    return getOfflineFallback(message, isCrisis, language, "api_key_missing");
  }

  const systemInstructionText = buildSystemInstruction(language, memoryContext, safetyNote, voiceAssessmentNote ?? null);
  const formattedContents = formatContents(history, message);

  // Attempt text models in cascade with low-latency timeout
  for (const model of TEXT_MODELS) {
    if (isModelInCooldown(model)) {
      continue;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2800);

      const endpoint = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstructionText }],
          },
          contents: formattedContents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 400,
            topP: 0.9,
          },
        }),
      });

      clearTimeout(timeout);

      if (!res.ok) {
        if (res.status === 429 || res.status === 503) {
          setModelCooldown(model, 25000);
        }
        continue;
      }

      const data = await res.json();
      const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

      if (candidateText) {
        // Re-assess the reply itself in case the model generated concerning content
        const replyAssessment = assessSafety(candidateText, []);
        return {
          reply: candidateText,
          isCrisis: isCrisis || replyAssessment.isCrisis,
          modelUsed: model,
          suggestedHelpline: isCrisis ? HELPLINES.nhaa : undefined,
        };
      }
    } catch {
      // Move swiftly to next responsive model
    }
  }

  // Safe fallback if external APIs are temporarily throttled
  return getOfflineFallback(message, isCrisis, language, "resilience_fallback");
}

async function fetchGoogleAudioFallback(text: string, language: string = "en"): Promise<string | null> {
  try {
    const langCode = language === "hi" ? "hi" : language === "mr" ? "mr" : "en";
    const cleanText = text.replace(/[*_#`]/g, "").trim();
    if (!cleanText) return null;

    // Split text into chunks of <= 85 characters to respect endpoint length limits
    const words = cleanText.split(/([ ।\n,.!?]+)/).filter(Boolean);
    const chunks: string[] = [];
    let current = "";

    for (const w of words) {
      if ((current + w).length <= 85) {
        current += w;
      } else {
        if (current.trim()) chunks.push(current.trim());
        current = w;
      }
    }
    if (current.trim()) chunks.push(current.trim());

    if (chunks.length === 0) return null;

    // Fetch MP3 chunks concurrently
    const chunkPromises = chunks.map(async (chunk) => {
      try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${langCode}&client=tw-ob`;
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
        });
        if (!res.ok) return null;
        const arr = await res.arrayBuffer();
        return Buffer.from(arr);
      } catch {
        return null;
      }
    });

    const buffers = await Promise.all(chunkPromises);
    const validBuffers: Uint8Array[] = [];
    for (const b of buffers) {
      if (b && b.length > 0) {
        validBuffers.push(b);
      }
    }

    if (validBuffers.length === 0) return null;

    const combined = Buffer.concat(validBuffers);
    return `data:audio/mp3;base64,${combined.toString("base64")}`;
  } catch (err) {
    console.warn("[GoogleAudioFallback] Failed:", err);
    return null;
  }
}

/**
 * Generate voice response: text generation + native Gemini TTS audio.
 * Runs a text-based distress assessment on the transcript and injects an
 * honest, clearly-labelled note into the system prompt.
 * Does NOT claim acoustic or voice-based analysis — transcript text only.
 */
export async function generateBuddyVoice(
  payload: ChatRequestPayload & { voiceName?: string }
): Promise<VoiceResponsePayload> {
  const { language = "en", voiceName = BUDDY_VOICES.default, history = [] } = payload;

  // Text-based distress assessment from what was spoken (transcript only)
  const distressAssessment = assessTextDistress(payload.message, history);
  const voiceNote = buildVoiceAssessmentNote(distressAssessment);

  // Generate the text reply with both safety and voice-assessment context
  const chatResponse = await generateBuddyChat({
    ...payload,
    voiceAssessmentNote: voiceNote || null,
  });
  const textToSynthesize = chatResponse.reply;

  let apiKey: string;
  try {
    apiKey = getApiKey();
  } catch {
    const fallbackAudio = await fetchGoogleAudioFallback(textToSynthesize, language);
    return {
      ...chatResponse,
      audioBase64: fallbackAudio || undefined,
      mimeType: fallbackAudio ? "audio/mp3" : undefined,
      fallbackToBrowserVoice: !fallbackAudio,
    };
  }

  // Attempt native audio synthesis with Gemini TTS models with fast timeout
  for (const ttsModel of TTS_MODELS) {
    if (isModelInCooldown(ttsModel)) {
      continue;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2400);

      const endpoint = `${GEMINI_API_BASE}/models/${ttsModel}:generateContent?key=${apiKey}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: textToSynthesize }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voiceName || BUDDY_VOICES.default,
                },
              },
            },
          },
        }),
      });

      clearTimeout(timeout);

      if (!res.ok) {
        if (res.status === 429 || res.status === 503) {
          setModelCooldown(ttsModel, 25000);
        }
        continue;
      }

      const data = await res.json();
      const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;

      if (inlineData?.data) {
        const mimeType = inlineData.mimeType || "audio/wav";
        return {
          ...chatResponse,
          audioBase64: `data:${mimeType};base64,${inlineData.data}`,
          mimeType,
          modelUsed: `${chatResponse.modelUsed}+${ttsModel}`,
          fallbackToBrowserVoice: false,
        };
      }
    } catch {
      // Continue to next TTS or fallback
    }
  }

  // If Gemini TTS is throttled (429 rate limit on free tier), generate real Google Audio MP3 stream
  const fallbackAudio = await fetchGoogleAudioFallback(textToSynthesize, language);
  if (fallbackAudio) {
    return {
      ...chatResponse,
      audioBase64: fallbackAudio,
      mimeType: "audio/mp3",
      modelUsed: `${chatResponse.modelUsed}+google-audio`,
      fallbackToBrowserVoice: false,
    };
  }

  // If all audio generation fails, signal browser speech synthesis
  return {
    ...chatResponse,
    audioBase64: undefined,
    fallbackToBrowserVoice: true,
  };
}

function getOfflineFallback(
  message: string,
  isCrisis: boolean,
  language: "en" | "hi" | "mr",
  modelUsed: string
): ChatResponsePayload {
  const lower = (message || "").toLowerCase();

  if (isCrisis) {
    if (language === "hi") {
      return {
        reply: "आपकी सुरक्षा और जीवन सबसे महत्वपूर्ण है। आप अकेले नहीं हैं। कृपया तुरंत हमारे टोल-फ्री हेल्पलाइन 14566 या Tele-MANAS 14416 पर संपर्क करें।",
        isCrisis: true,
        modelUsed,
        suggestedHelpline: HELPLINES.nhaa,
      };
    }
    if (language === "mr") {
      return {
        reply: "तुमची सुरक्षितता आणि जीवन सर्वात महत्त्वाचे आहे. तुम्ही एकटे नाही आहात. कृपया त्वरित टोल-फ्री हेल्पलाइन 14566 किंवा Tele-MANAS 14416 वर कॉल करा.",
        isCrisis: true,
        modelUsed,
        suggestedHelpline: HELPLINES.nhaa,
      };
    }
    return {
      reply: "Your safety and life are the most important things right now. You are not alone. Please reach out to our emergency support on 14566 or Tele-MANAS on 14416 right away.",
      isCrisis: true,
      modelUsed,
      suggestedHelpline: HELPLINES.nhaa,
    };
  }

  // Topic-aware responses to avoid repetitive phrases
  if (lower.includes("breath") || lower.includes("heart") || lower.includes("panic") || lower.includes("racing")) {
    if (language === "hi") {
      return {
        reply: "आइए एक साथ धीरे-धीरे गहरी सांस लें। यदि आप चाहें, तो हम सांस को स्थिर करने के लिए ब्रीदिंग पेसर शुरू कर सकते हैं।",
        isCrisis: false,
        modelUsed,
      };
    }
    if (language === "mr") {
      return {
        reply: "चला आपण एकत्र शांतपणे दीर्घ श्वास घेऊया. हवे असल्यास आपण ब्रीदिंग पेसर सुरू करू शकतो.",
        isCrisis: false,
        modelUsed,
      };
    }
    return {
      reply: "Let's pause together for a moment and take a slow breath. If you feel up to it, we can open the Breathing Pacer to help steady your heart.",
      isCrisis: false,
      modelUsed,
    };
  }

  if (lower.includes("counselor") || lower.includes("doctor") || lower.includes("human") || lower.includes("session")) {
    if (language === "hi") {
      return {
        reply: "हमारे पास डॉ. प्रिया नायर जैसे विशेषज्ञ परामर्शदाता उपलब्ध हैं। आप जब चाहें क्लिनिकल केयर सत्र का अनुरोध कर सकते हैं।",
        isCrisis: false,
        modelUsed,
      };
    }
    if (language === "mr") {
      return {
        reply: "आमच्याकडे समुपदेशक उपलब्ध आहेत. तुम्ही क्लिनिकल केअर सत्र सहज बुक करू शकता.",
        isCrisis: false,
        modelUsed,
      };
    }
    return {
      reply: "We have counselors like Dr. Priya Nair and Rahul Mehta available. You can request a Clinical Care Session whenever you're ready.",
      isCrisis: false,
      modelUsed,
    };
  }

  if (lower.includes("legal") || lower.includes("court") || lower.includes("police") || lower.includes("rights")) {
    if (language === "hi") {
      return {
        reply: "कानून और पोआ एक्ट के तहत आपको पूर्ण अधिकार प्राप्त हैं। आप टीआरएसी-माइंड में लीगल एड और एस्कॉर्ट सहायता देख सकते हैं।",
        isCrisis: false,
        modelUsed,
      };
    }
    return {
      reply: "You have verified legal protections under the law. We can review legal aid support or secure escorts in TRAC-Mind whenever you wish.",
      isCrisis: false,
      modelUsed,
    };
  }

  if (lower.includes("better") || lower.includes("calmer") || lower.includes("helped") || lower.includes("thank")) {
    if (language === "hi") {
      return {
        reply: "यह जानकर बहुत खुशी हुई कि आपको थोड़ा सुकून मिला। आज आप और किस विषय पर ध्यान देना चाहेंगे?",
        isCrisis: false,
        modelUsed,
      };
    }
    return {
      reply: "That brings me genuine relief to hear. You're doing so well, and we can take the next steps at whatever pace feels right for you.",
      isCrisis: false,
      modelUsed,
    };
  }

  // Natural general variations
  if (language === "hi") {
    const hiOptions = [
      "मैं आपकी बात पूरी तसल्ली से सुन रहा हूँ। आप सुरक्षित हैं, आराम से अपनी बात साझा करें।",
      "जो कुछ भी आपके मन पर बोझ बना हुआ है, उसे आप मुझसे धीरे-धीरे कह सकते हैं।",
      "यह समय आपके लिए कठिन रहा है। जो महसूस हो रहा है, उसे अपनी गति से कहें।",
    ];
    return {
      reply: hiOptions[Math.floor(Math.random() * hiOptions.length)],
      isCrisis: false,
      modelUsed,
    };
  }

  if (language === "mr") {
    const mrOptions = [
      "मी तुमचे शांतपणे ऐकत आहे. तुम्ही येथे सुरक्षित आहात, मोकळेपणाने सांगा.",
      "तुमच्या मनावर जे काही ओझे आहे, ते आपण हळूहळू सोडवू शकतो. मी सोबत आहे.",
    ];
    return {
      reply: mrOptions[Math.floor(Math.random() * mrOptions.length)],
      isCrisis: false,
      modelUsed,
    };
  }

  const enOptions = [
    "Thank you for sharing that with me. What has been feeling heaviest about it?",
    "It makes complete sense that you would feel this way. I'm right here as you talk through it.",
    "That is a lot to carry on your own. We can unpack it one step at a time whenever you are ready.",
    "I appreciate you telling me that. Would it help to talk more about it, or would you prefer a gentle exercise?",
  ];

  return {
    reply: enOptions[Math.floor(Math.random() * enOptions.length)],
    isCrisis: false,
    modelUsed,
  };
}
