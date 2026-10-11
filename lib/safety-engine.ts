// ─── TRAC-Mind Context-Aware Safety Engine ────────────────────────────────────
// Replaces the single-keyword detectCrisisIntent() with a multi-signal,
// conversation-context-aware safety assessment.
//
// KEY DESIGN DECISIONS (per approved specification):
// - A repeated keyword alone does NOT automatically trigger emergency escalation.
// - Academic / hypothetical / third-person disclosures are distinguished from
//   personal first-person disclosures wherever possible.
// - Credible immediate danger is recognised on the first message.
// - Counsellor handoff is offered — never claimed as completed unless confirmed
//   by a real integration (which does not yet exist in this prototype).
// - This engine is TEXT-ONLY. It works on message text and conversation history.
//   It does NOT claim any acoustic or vocal analysis capability.

import { BuddyChatMessage } from "./buddy-personality";

// ─── Crisis Keyword Tiers ─────────────────────────────────────────────────────

/**
 * Tier 1 — Immediate danger signals.
 * Any single match in a clearly personal context warrants immediate escalation.
 */
const IMMEDIATE_DANGER_PATTERNS = [
  /\b(kill|killing)\s+(my)?self\b/i,
  /\b(end|ending|take|taking)\s+(my\s+)?life\b/i,
  /\bsuicide\b/i,
  /\bsuicidal\b/i,
  /\bwant\s+to\s+die\b/i,
  /\b(cut|cutting|harm|hurt|injure|poison|hang(ing)?|overdose)\s+(my)?self\b/i,
  /\bself[- ]harm\b/i,
  /\bimminent\s+danger\b/i,
  /\b(going\s+to|about\s+to)\s+(end|kill|hurt)\b/i,
  /\b(they|he|she)\s+(will\s+)?kill\s+me\b/i,
  /\blife\s+is\s+not\s+worth\s+living\b/i,
  /\bno\s+reason\s+to\s+live\b/i,
  // Hindi / Marathi
  /आत्महत्या/,
  /जान\s*दे\s*दूंगा/,
  /मरना\s*चाहता/,
  /मरना\s*चाहती/,
  /खुद\s*को\s*चोट/,
  /जीव\s*संपवावा/,
  /मरायचं\s*आहे/,
  /स्वतःला\s*इजा/,
];

/**
 * Tier 2 — Elevated distress signals.
 * Concerning but require context (multiple signals, conversation pattern,
 * or first-person framing) before escalating.
 */
const ELEVATED_DISTRESS_PATTERNS = [
  /\bno\s+hope\b/i,
  /\bhopeless\b/i,
  /\bcan'?t\s+go\s+on\b/i,
  /\bcannot\s+go\s+on\b/i,
  /\bwant\s+to\s+end\s+it\b/i,
  /\bgoing\s+to\s+end\s+it\b/i,
  /\bending\s+my\s+life\b/i,
  /\bthreatened?\s+(my\s+life|me)\b/i,
  /\bthreaten(ing)?\b/i,
  /\bin\s+danger\b/i,
  /\bnot\s+safe\b/i,
  /\bscared\s+(for\s+my\s+life|of\s+him|of\s+them)\b/i,
  /\bcan't\s+take\s+(it|this)\s+anymore\b/i,
];

/**
 * Academic / distancing markers — reduce the personal crisis confidence
 * score when present. These suggest the user is discussing a concept rather
 * than disclosing personal intent.
 */
const ACADEMIC_DISTANCING_PATTERNS = [
  /\b(research|studying|study|paper|essay|thesis|report|article|book)\b/i,
  /\b(asking\s+(for|about)|wondering\s+about|curious\s+about)\b/i,
  /\b(hypothetically|theoretically|in\s+general|generally\s+speaking)\b/i,
  /\b(my\s+friend|someone\s+I\s+know|a\s+person|people\s+(often|sometimes|can))\b/i,
  /\b(character|story|novel|film|movie|show|plot)\b/i,
  /\b(statistic|data|fact|information|awareness)\b/i,
  /\b(prevention|mental\s+health\s+awareness|world\s+suicide\s+prevention)\b/i,
];

// ─── Assessment Result Types ──────────────────────────────────────────────────

export type SafetyLevel =
  | "safe"           // No concerning signals detected
  | "monitoring"     // Low-level concern, watch across turns
  | "elevated"       // Multiple signals or moderate personal disclosure
  | "crisis";        // Immediate danger — escalate now

export interface SafetyAssessment {
  level: SafetyLevel;
  isCrisis: boolean;
  isAcademic: boolean;      // True if likely academic/hypothetical framing
  concernScore: number;     // 0–100 internal score, not exposed to user
  repeatedConcern: boolean; // True if concern appeared in prior turns too
  reason: string;           // Human-readable diagnosis reason (for logging only)
  suggestCounsellor: boolean;
  emergencyMessage?: string; // Only set when level === "crisis"
}

// ─── Core Assessment Function ─────────────────────────────────────────────────

/**
 * Assess the safety level of a message, taking conversation history into account.
 *
 * @param message   The current user message.
 * @param history   Previous conversation turns (most recent last), optional.
 * @returns         A SafetyAssessment object.
 */
export function assessSafety(
  message: string,
  history: BuddyChatMessage[] = []
): SafetyAssessment {
  const text = (message || "").trim();

  // ── 1. Check for academic / distancing framing ──────────────────────────────
  const isAcademic = ACADEMIC_DISTANCING_PATTERNS.some((p) => p.test(text));

  // ── 2. Check immediate-danger patterns ──────────────────────────────────────
  const hasImmediateDanger = IMMEDIATE_DANGER_PATTERNS.some((p) => p.test(text));

  // ── 3. Check elevated-distress patterns ─────────────────────────────────────
  const elevatedMatches = ELEVATED_DISTRESS_PATTERNS.filter((p) => p.test(text));
  const hasElevatedDistress = elevatedMatches.length > 0;

  // ── 4. Scan conversation history for repeated concern signals ───────────────
  let historyConcernCount = 0;
  const recentHistory = history.slice(-8); // Last 8 turns
  for (const turn of recentHistory) {
    if (turn.role !== "user") continue;
    const historyHasImmediate = IMMEDIATE_DANGER_PATTERNS.some((p) => p.test(turn.text || ""));
    const historyHasElevated = ELEVATED_DISTRESS_PATTERNS.filter((p) => p.test(turn.text || "")).length > 0;
    if (historyHasImmediate) historyConcernCount += 3;
    else if (historyHasElevated) historyConcernCount += 1;
    // Detect persistent distress language even without pattern matches
    if (/\b(still\s+)?(scared|afraid|terrified|trapped|helpless|desperate|overwhelmed)\b/i.test(turn.text || "")) {
      historyConcernCount += 1;
    }
  }
  const repeatedConcern = historyConcernCount >= 2;

  // ── 5. Compute raw concern score ─────────────────────────────────────────────
  let concernScore = 0;
  if (hasImmediateDanger) concernScore += 70;
  if (hasElevatedDistress) concernScore += elevatedMatches.length * 15;
  if (repeatedConcern) concernScore += Math.min(historyConcernCount * 5, 20);
  if (isAcademic) concernScore = Math.max(0, concernScore - 40); // Discount strongly
  concernScore = Math.min(concernScore, 100);

  // ── 6. Determine safety level ────────────────────────────────────────────────
  let level: SafetyLevel = "safe";

  if (hasImmediateDanger && !isAcademic) {
    // Immediate personal danger: always crisis regardless of history
    level = "crisis";
  } else if (hasImmediateDanger && isAcademic) {
    // Academic discussion of crisis terms — elevated but not immediate escalation
    level = "elevated";
  } else if (hasElevatedDistress && repeatedConcern) {
    // Repeated elevated signals across turns — escalate
    level = "crisis";
  } else if (hasElevatedDistress && !isAcademic) {
    // Single elevated signal, personal framing — monitor closely
    level = "elevated";
  } else if (concernScore > 0) {
    level = "monitoring";
  }

  // ── 7. Build result ──────────────────────────────────────────────────────────
  const isCrisis = level === "crisis";
  const suggestCounsellor = level === "crisis" || level === "elevated";

  let reason = "No concerning signals detected.";
  if (hasImmediateDanger && isAcademic) reason = "Immediate-danger language detected with academic framing — elevated caution.";
  else if (hasImmediateDanger) reason = "Immediate personal danger language detected.";
  else if (hasElevatedDistress && repeatedConcern) reason = "Elevated distress repeated across multiple conversation turns.";
  else if (hasElevatedDistress) reason = `Elevated distress signal: ${elevatedMatches.map((p) => p.source).slice(0, 2).join(", ")}`;
  else if (concernScore > 0) reason = `Low-level concern (score ${concernScore}); monitoring.`;

  // Emergency message (language-agnostic; caller should localise if needed)
  let emergencyMessage: string | undefined;
  if (isCrisis) {
    emergencyMessage =
      "Your safety matters deeply. You are not alone in this. " +
      "Please reach out to NHAA on 14566 or Tele-MANAS on 14416 — both are free and available 24/7. " +
      "If you are in immediate danger, please call 112.";
  }

  return {
    level,
    isCrisis,
    isAcademic,
    concernScore,
    repeatedConcern,
    reason,
    suggestCounsellor,
    emergencyMessage,
  };
}

// ─── Utility: Build a counsellor-suggestion note for the system prompt ────────

/**
 * Returns an optional system-prompt note when safety level warrants it.
 * This is appended to the system instruction — it does NOT change the user's
 * message or fabricate any backend action.
 */
export function buildSafetyContextNote(assessment: SafetyAssessment): string {
  if (assessment.level === "safe" || assessment.level === "monitoring") {
    return "";
  }

  if (assessment.level === "crisis") {
    return `
SAFETY ALERT — RESPOND WITH IMMEDIATE PRIORITY:
The user's message contains language that suggests possible imminent personal danger or self-harm.
1. Open with profound, non-judgmental empathy in 1 sentence.
2. Immediately and warmly encourage them to call NHAA 14566 or Tele-MANAS 14416 or 112.
3. Do NOT lecture, minimise or use clinical terms. Keep it brief, warm and safety-focused.
4. Do NOT claim you have notified anyone or booked anything — no such integration exists.
5. If they are describing an academic discussion, acknowledge that respectfully and redirect gently.`;
  }

  if (assessment.level === "elevated") {
    const academicNote = assessment.isAcademic
      ? "The phrasing may be academic or hypothetical — respond with empathy but do not force a crisis frame."
      : "The user shows signs of personal distress. Offer warmth and optionally mention counsellor support.";
    return `
ELEVATED DISTRESS CONTEXT: ${academicNote}
- Respond empathetically without assuming this is an emergency.
- You may gently mention that human counsellors are available if they ever want to talk to someone.
- Do NOT claim any booking or notification has taken place.`;
  }

  return "";
}
