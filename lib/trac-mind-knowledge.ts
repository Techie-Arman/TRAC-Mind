// ─── TRAC-Mind Project Knowledge Base ─────────────────────────────────────────
// Verified from actual repository inspection (2026-10-11).
// Clearly distinguishes: IMPLEMENTED | PARTIAL | PLANNED | BLOCKED | UNVERIFIED
// Ground truth reference for AI persona and system prompts. Do NOT invent features.

export const TRAC_MIND_KNOWLEDGE = `
TRAC-MIND PROJECT KNOWLEDGE (verified from repository inspection)
========================================================================

## What is TRAC-Mind?
TRAC-Mind (Triage, Risk Assessment & Crisis Management System) is an AI-assisted
mental-health distress monitoring, triage, and crisis management prototype built
for SIH Problem Statement 26094: "AI-Powered Dynamic Mental Health Monitoring and
Distress Prediction System for Victims of Atrocities."
It serves two user portals:
1. Survivor Portal: self-support tools, trauma-informed AI companion, and safety resources.
2. Counsellor Portal: caseload triage queue, synthetic case details, and clinical action center.

## Technology Stack
- Framework: Next.js (App Router), TypeScript, Vanilla CSS
- AI: Google Gemini API (server-side only via /api/buddy/chat and /api/buddy/voice)
- AI Fallback: Cascading Gemini text models -> Offline multilingual emergency responses;
  Gemini TTS -> Google Audio MP3 stream -> Browser SpeechSynthesis
- Data: 120 synthetic, anonymised case records (ANON-0001 to ANON-0120 in data/trac_mind_cases.json)
- Storage: Browser localStorage (session memory, case notes); no backend database in prototype
- Deployment: Vercel (production); local dev via npm run dev
- Languages: English (en), Hindi (hi, Devanagari), Marathi (mr, Devanagari)

---

## SURVIVOR PORTAL ROUTES & FEATURES

### IMPLEMENTED ✅
- Text Check-In with Buddy (/checkin): Interactive AI companion chat powered by Gemini.
  Supports English, Hindi, and Marathi. Integrated with the context-aware Safety Engine
  (lib/safety-engine.ts). Browser SpeechRecognition for voice dictation. Quick-phrase chips
  for low-literacy users. Session history maintained in component state.
- Voice Check-In with Buddy (/buddy-voice): Voice conversation UI. Captures user speech
  via browser Web Speech API (speech-to-text); Gemini generates text responses; synthesised
  via Gemini TTS or Google Audio stream fallback. Hands-free auto-listen mode.
- Guided Breathing Pacer (/breathing): Visual 4-7-8 calming breath cycle animation with
  audio chime toggle. Client-only tool, requires no network or backend.
- Sensory Grounding Tool (/grounding): 5-4-3-2-1 sensory grounding exercise with interactive
  step checklist and reassuring feedback. Client-only tool.
- Survivor Home Hub (/home): Navigation dashboard with quick-action cards, emergency SOS
  call buttons, and time-of-day greeting.
- Buddy Redirect Route (/buddy): Client-side redirect that forwards users to /checkin.
- Multilingual UI: Survivor pages support en/hi/mr through the shared i18n module (lib/i18n.tsx).
- Continuous Memory (lib/buddy-memory.ts): Stores up to 10 structured check-ins in browser
  localStorage (trac_buddy_checkin_memory). Injects emotional state and concern topics as
  context into Buddy chat if the previous check-in occurred within the last 72 hours.
- Crisis Safety UI: High-contrast emergency banner providing direct phone call triggers to
  Tele-MANAS (14416), NHAA (14566), and Emergency (112).

### PARTIAL / PROTOTYPE UI ⚠️
- Voice Analysis (lib/voice-analysis.ts): Evaluates distress strictly on the TEXT TRANSCRIPT
  of spoken words. Acoustic biomarker analysis (pitch, tremor, shimmer, jitter) is NOT
  performed on live audio in the browser. Biomarker figures in case files are pre-generated.
- Privacy & Consent Center (/consent): Demonstrates UI consent toggles (counselor sharing,
  emergency data sharing, legal aid, research) and references DPDP Act concepts. Preferences
  are held in React state only (not persisted to backend or localStorage).
- Legal Aid & Rights (/legal-aid): Educational page detailing rights under the PoA Act 1989
  and Protection of Civil Rights Act 1955. Static content; no live legal representation booking.
- Witness Protection (/witness-protection): Informational overview of witness protection
  schemes and threat reporting guidance. Static content; no real security team dispatch.
- Counsellor Connection: Buddy can suggest talking to human counsellors, but no live
  calendar booking, notification, or handoff API exists.

### UNVERIFIED / MOCK DATA 🔍
- My Progress (/my-progress): Displays a 30-day wellbeing trend chart and status summary.
  Data is loaded from a static mock array (SURVIVOR_TRAJECTORY in lib/mock-data.ts), NOT from
  actual survivor check-ins in localStorage. Export CSV button is a prototype mockup.

### PLANNED / NOT IMPLEMENTED ❌
- Real-time acoustic feature extraction from survivor microphone audio.
- Server-side persistent storage and synchronization for survivor sessions.
- Real identity authentication or OTP login for survivors (currently open access).
- SMS / IVRS communication pipeline for non-smartphone survivors.
- Automated counselor notification or alert dispatch when a crisis is expressed.

---

## COUNSELLOR PORTAL ROUTES & FEATURES

### IMPLEMENTED ✅
- Dashboard & Triage Queue (/dashboard): Displays all 120 canonical synthetic cases with DDI
  scores, risk tiers (High: 18, Medium: 57, Low: 45), SLA deadlines, assigned counselors,
  state, and district.
- Geographic Scope Filter: National / State / District toggle on /dashboard. Filtering by
  State reveals state dropdown; District reveals state + district dropdowns. Scope state
  is synced to URL search parameters without reloading. Summary counts and table update live.
- Search, Filter & Sort: Full-text search by case ID / counselor / language, risk tier pill
  tabs, status filter dropdown, and column-based sorting on the active dataset.
- All Caseload Registry (/cases): Standalone caseload table view displaying all cases with
  tier filters, text search, and DDI / activity sorting.
- Case Detail View (/cases/[id]): Comprehensive case view populated from canonical dataset.
  Includes header info, simulated waveform player (for voice/PWA cases), speaker-annotated
  transcripts, vocal biomarker metrics (pitch variance, hesitation latency, shimmer, jitter),
  DDI score card, model consensus matrix, 30-day DDI trajectory SVG chart, and case notes log.
  SMS cases cleanly omit audio players and biomarker cards without errors.
- Immutable Case Notes: Counsellors can add case notes with author name and timestamp.
  Notes are append-only (cannot be edited or deleted). Stored in browser localStorage
  (key: trac_notes_[caseId]) and maintained in memory.
- Clinical Care Sessions (/sessions): Session scheduling modal with form validation
  (case selector, date, time, mode). Sessions are saved to React component state.

### PARTIAL / PROTOTYPE UI ⚠️
- Clinical Action Center (/cases/[id]/actions): Allows counsellors to review and simulate
  escalation actions (Dispatch Legal Escort, Safe-Haven Relocation, PHC Psychiatric Referral).
  Action confirmation updates local component state only; does NOT dispatch real personnel.
- SLA Countdown: SLA deadlines are dynamically shifted relative to app load time to
  simulate live countdowns, calculated from synthetic dataset parameters.
- Counsellor Assignment: Displayed per case from synthetic data. No dynamic reassignment workflow.

### UNVERIFIED / MOCK DATA 🔍
- Analytics (/analytics): Visualizes case metrics using bar charts. Metrics are sourced from
  a legacy mock dataset (MOCK_ANALYTICS: 214 total cases, 47 active) rather than computed
  dynamically from the 120-case canonical dataset.
- Audit Log (/audit): Displays mock administrative event entries (MOCK_AUDIT). The
  "Export CSV" button has no click handler and does not trigger an export.
- Settings (/settings): Visual mockup for DDI risk thresholds, model weights, and SLA timing.
  Inputs and buttons do not persist changes to the application or backend.

### BLOCKED / NOT IMPLEMENTED 🚫
- Live Dynamic Distress Index (DDI) computation from real-time survivor inputs.
- Live ML model inference from Clinical LLaMA-3 or Trauma-Informed Mistral endpoints
  (names reflect synthetic dataset labels, not active server endpoints).
- Live acoustic biomarker processing pipeline connected to raw audio recordings.
- Counsellor authentication and role-based access control (RBAC).
- Server-side case note database persistence.
- Automated SMS / notification triggers when an SLA threshold is breached.

---

## AI ASSISTANT & SAFETY ENGINE SPECIFICATIONS

- Provider: Google Gemini API (secure server-side route execution; API key never sent to client).
- Text Cascading Order: gemini-flash-lite-latest -> gemini-3.1-flash-lite -> gemini-3.8-flash ->
  gemini-3-flash-preview -> gemini-3.7-flash -> multilingual offline fallback.
- TTS Cascading Order: gemini-3.8-flash-tts -> gemini-2.5-flash-preview-tts ->
  gemini-3.8-flash-lite-tts -> Google Translate Audio stream -> Browser SpeechSynthesis.
- Maximum Output Tokens: 400 tokens (permits natural explanations while staying concise).
- Safety Engine (lib/safety-engine.ts): Active runtime engine called by lib/gemini.ts:
  * Tier 1 (Immediate Danger): High-severity patterns in English, Hindi, and Marathi.
  * Tier 2 (Elevated Distress): Concerning signals requiring context or repetition.
  * Academic / Distancing Filter: Discounts research, coursework, or third-person mentions to
    prevent false-positive crisis interruptions.
  * Multi-Turn History Scan: Evaluates last 8 user turns to identify persistent distress patterns.
  * 4-Tier Assessment: Categorizes intent into safe, monitoring, elevated, or crisis.
  * Dual-Pass Verification: Candidate replies generated by Gemini are also screened prior to delivery.
- Persona Boundaries: Buddy is an AI companion, not a human, doctor, psychiatrist, or lawyer.
  Buddy never provides clinical diagnoses, never prescribes medications, and never claims that
  a backend action (police dispatch, counselor notification) was performed.

---

## CANONICAL CASE DATASET SPECIFICATIONS

- Source File: data/trac_mind_cases.json (120 synthetic cases, ANON-0001 to ANON-0120).
- Risk Tier Distribution: High: 18 cases, Medium: 57 cases, Low: 45 cases.
- Case Status Distribution: Open: 27 cases, In Progress: 37 cases, Resolved: 56 cases.
- Geographic Coverage (8 states, exactly 15 cases per state):
  1. Bihar (15 cases)
  2. Delhi (15 cases)
  3. Karnataka (15 cases)
  4. Maharashtra (15 cases)
  5. Rajasthan (15 cases)
  6. Tamil Nadu (15 cases)
  7. Uttar Pradesh (15 cases)
  8. West Bengal (15 cases)
  *(Note: Madhya Pradesh is NOT included in the canonical dataset).*
- All individual identities, incidents, and recordings are synthetic representations created
  specifically for SIH Problem Statement 26094.

---

## OFFICIAL EMERGENCY HELPLINES (Accurate Mandates & Details)

When users require human assistance, TRAC-Mind references three distinct national services:

1. Tele-MANAS (Tele Mental Health Assistance and Networking Across States)
   - Number: 14416 (or 1800-891-4416) | Toll-Free | 24/7 | Multi-lingual (20+ languages)
   - Governing Body: Ministry of Health and Family Welfare (MoHFW), Government of India;
     apex technical centre NIMHANS, Bengaluru.
   - Purpose: Dedicated national mental-health crisis, psychological counseling, emotional
     distress, and suicide prevention helpline. Features two-tier support: Tier 1 counselors
     and Tier 2 psychiatrists/clinical psychologists with physical district linkages.
   - Role in TRAC-Mind: PRIMARY referral for psychological crisis, self-harm thoughts, and trauma.

2. NHAA (National Helpline Against Atrocities)
   - Number: 14566 | Toll-Free | 24/7 | Hindi, English, and regional languages
   - Governing Body: Ministry of Social Justice and Empowerment (MoSJE), Government of India.
   - Purpose: Legal protection and grievance redressal under the Scheduled Castes and the
     Scheduled Tribes (Prevention of Atrocities) Act, 1989 and Protection of Civil Rights Act, 1955.
     Coordinates FIR registration tracking, institutional relief, and district monitoring.
   - Role in TRAC-Mind: PRIMARY referral for caste-based violence, atrocity reporting, legal
     obstruction, police non-responsiveness, or physical intimidation.
   - NOTE: NHAA is NOT a psychological or mental-health counseling service.

3. Emergency Response Support System (ERSS)
   - Number: 112 | Toll-Free | 24/7 | Pan-India
   - Governing Body: Ministry of Home Affairs (MHA), Government of India.
   - Purpose: Single emergency contact for all immediate physical emergencies requiring Police
     (100), Fire (101), Ambulance/Medical (102/108), or Disaster response. Features GPS-enabled
     emergency response vehicle dispatch.
   - Role in TRAC-Mind: PRIMARY referral for immediate physical danger, violence in progress,
     or acute medical emergencies requiring physical dispatch.

---

## PRIVACY & DATA SAFEGUARD REALITIES

- Prototype Status: The application demonstrates privacy and consent design patterns, but
  does NOT implement formal technical or legal compliance with the Digital Personal Data
  Protection (DPDP) Act, 2023.
- Data Storage: Check-in memory and case notes reside purely in the client browser (localStorage).
  No server-side database stores survivor conversations or counselor notes.
- Third-Party Transmission: User chat text is transmitted only to the Google Gemini API to
  generate assistant replies; it is not saved to any backend database.
- De-identification: Synthetic case transcripts display mock DPDP de-identification badges
  for demonstration purposes only.
`;

/**
 * Returns the verified project knowledge as a string suitable for injection
 * into a system prompt. Call this server-side only.
 */
export function getTRACMindKnowledge(): string {
  return TRAC_MIND_KNOWLEDGE;
}
