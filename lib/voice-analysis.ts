// ─── TRAC-Mind Text-Based Distress Assessment ─────────────────────────────────
// IMPORTANT ACCURACY STATEMENT (required by approved specification):
//
// This module performs TEXT-BASED distress assessment using the conversation
// transcript. It does NOT perform acoustic or voice-based analysis.
//
// What this module CANNOT do (and will never claim to do):
//   - Detect vocal tone, pitch, tremor, strain or physical pain from audio.
//   - Produce acoustic biomarker readings (pitch variance, shimmer, jitter).
//   - Infer pain scores or confidence values from raw audio.
//   - Access or process PCM audio samples from the browser MediaRecorder.
//
// What this module CAN do:
//   - Analyse the TEXT CONTENT of what a person said for distress language.
//   - Combine that analysis with the safety-engine assessment.
//   - Return an honest, appropriately labelled result.
//
// If acoustic analysis of live voice recordings is required, that would need:
//   1. Access to raw PCM audio from the browser (requires UI + route changes).
//   2. A backend audio-processing service (e.g. librosa, pyAudio).
//   3. Explicit approval from the project owner before implementation.
// Report this limitation; do not simulate it.

import { assessSafety, SafetyAssessment } from "./safety-engine";
import { BuddyChatMessage } from "./buddy-personality";

// ─── Result Types ─────────────────────────────────────────────────────────────

export type AssessmentBasis = "text_transcript_only";

export interface TextDistressAssessment {
  /** Always "text_transcript_only" — never "acoustic" or "voice" */
  basis: AssessmentBasis;

  /** Human-readable label: "Low", "Moderate", "High", "Inconclusive" */
  distressLevel: "Low" | "Moderate" | "High" | "Inconclusive";

  /** One-sentence honest summary suitable for inclusion in a Buddy reply */
  summary: string;

  /** Whether to surface safety support options */
  suggestSupport: boolean;

  /** The underlying safety assessment for reference */
  safetyAssessment: SafetyAssessment;

  /** Clear disclaimer to include when surfacing this to a user */
  disclaimer: string;
}

// ─── Assessment Function ──────────────────────────────────────────────────────

/**
 * Perform a TEXT-BASED distress assessment on the provided transcript.
 *
 * @param transcript  The text of what the user said (from speech-to-text).
 * @param history     Optional conversation history for context.
 * @returns           A TextDistressAssessment object.
 *
 * NOTE: This does NOT analyse audio. The result is based entirely on the text.
 */
export function assessTextDistress(
  transcript: string,
  history: BuddyChatMessage[] = []
): TextDistressAssessment {
  const safety = assessSafety(transcript, history);
  const basis: AssessmentBasis = "text_transcript_only";

  const disclaimer =
    "This assessment is based on the text content of what was said, " +
    "not on any acoustic or vocal characteristics. It is not a clinical " +
    "evaluation and should not replace professional assessment.";

  if (!transcript || transcript.trim().length < 5) {
    return {
      basis,
      distressLevel: "Inconclusive",
      summary: "The message was too short to assess.",
      suggestSupport: false,
      safetyAssessment: safety,
      disclaimer,
    };
  }

  // Map safety level to distress level
  let distressLevel: TextDistressAssessment["distressLevel"];
  let summary: string;

  switch (safety.level) {
    case "crisis":
      distressLevel = "High";
      summary = safety.isAcademic
        ? "The message references serious themes, though the framing may be academic."
        : "The message contains language associated with high distress or possible self-harm.";
      break;

    case "elevated":
      distressLevel = "Moderate";
      summary = safety.isAcademic
        ? "The message discusses distressing themes in what appears to be an informational context."
        : "The message shows signs of elevated distress or concern.";
      break;

    case "monitoring":
      distressLevel = "Low";
      summary = "The message contains some indicators of stress but nothing that suggests immediate concern.";
      break;

    case "safe":
    default:
      distressLevel = "Low";
      summary = "No significant distress indicators detected in the text content of this message.";
      break;
  }

  return {
    basis,
    distressLevel,
    summary,
    suggestSupport: safety.suggestCounsellor,
    safetyAssessment: safety,
    disclaimer,
  };
}

// ─── System-Prompt Helper ─────────────────────────────────────────────────────

/**
 * Returns an optional note to add to the system prompt when a voice check-in
 * transcript has been assessed. Clearly labels this as text-based only.
 */
export function buildVoiceAssessmentNote(
  assessment: TextDistressAssessment
): string {
  if (assessment.distressLevel === "Low" || assessment.distressLevel === "Inconclusive") {
    return "";
  }

  return `
TEXT DISTRESS ASSESSMENT (from spoken transcript — text-based only, not acoustic):
- Distress level detected in text: ${assessment.distressLevel}
- ${assessment.summary}
- Basis: ${assessment.basis} (no acoustic analysis was performed)
When responding, acknowledge the content of what was said with empathy.
Do NOT mention "vocal analysis", "audio analysis", "your voice", "tone", "pitch" or any acoustic characteristic.
Do NOT claim any technical analysis of the audio recording was performed.`;
}
