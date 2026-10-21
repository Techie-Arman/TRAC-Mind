import rawCasesData from "../data/trac_mind_cases.json";

export interface CaseRecording {
  duration_seconds: number;
  playback_speed: string;
  raw_audio_purged: boolean;
}

export interface CaseTranscript {
  sanitized: boolean;
  lines: string[];
  compliance: string;
}

export interface CaseBiomarkers {
  pitch_variance_hz: number;
  hesitation_latency_s: number;
  shimmer: number;
  jitter: number;
}

export interface CaseDDI {
  score: number;
  risk_tier: "High" | "Medium" | "Low";
  sla_due: string;
  confidence_pct: number;
}

export interface CaseModelConsensus {
  clinical_llama3_triage: number;
  trauma_informed_mistral: number;
  acoustic_biomarker_pipeline: number | null;
  concordance_pct: number;
  agreement_label: string;
}

export interface TrajectoryPoint {
  date: string;
  day: string;
  ddi: number;
}

export interface CaseNote {
  author: string;
  timestamp: string;
  text: string;
}

export interface CaseDetail {
  recording: CaseRecording | null;
  transcript: CaseTranscript;
  biomarkers: CaseBiomarkers | null;
  ddi: CaseDDI;
  model_consensus: CaseModelConsensus;
  ddi_trajectory_30d: TrajectoryPoint[];
  case_notes: CaseNote[];
}

export interface CanonicalCase {
  // Top-level properties from canonical JSON
  case_id: string;
  pseudo_id: string;
  risk_tier: "High" | "Medium" | "Low";
  ddi_score: number;
  channel: "PWA" | "IVRS" | "SMS" | "Voice";
  language: string;
  sla_deadline: string;
  counselor: string;
  last_activity: string;
  status: "open" | "in_progress" | "resolved";
  status_raw: "Open" | "In Progress" | "Resolved";
  state: string;
  district: string;
  created_at: string;
  detail: CaseDetail;

  // Compatibility aliases for existing UI code (Case interface in mock-data.ts)
  id: string;
  pseudoId: string;
  tier: "high" | "medium" | "low";
  ddi: number;
  assignedCounselor: string;
  slaDueAt: string;
  lastActivity: string;
  sanitizedTranscript: string[];
  trajectory: { day: string; ddi: number; date: string }[];
  biomarkers: {
    pitchVariance: number;
    hesitationLatency: number;
    shimmer: number;
    jitter: number;
  } | null;
}

// Reference time when data was generated: 2026-10-11 10:10 IST (+05:30)
const REFERENCE_TIME_MS = new Date("2026-10-11T10:10:00+05:30").getTime();

function parseISTTimestamp(dateStr: string): number {
  if (!dateStr) return Date.now();
  if (!dateStr.includes("+") && !dateStr.includes("Z")) {
    const parts = dateStr.split(":");
    if (parts.length === 2) {
      dateStr = dateStr + ":00";
    }
    return new Date(`${dateStr}+05:30`).getTime();
  }
  return new Date(dateStr).getTime();
}

function shiftTimestamp(dateStr: string, shiftMs: number): string {
  const orig = parseISTTimestamp(dateStr);
  return new Date(orig + shiftMs).toISOString();
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

// In-memory store for appended notes
const inMemoryAppendedNotes: Record<string, CaseNote[]> = {};

function getStoredAppendedNotes(caseId: string): CaseNote[] {
  const mem = inMemoryAppendedNotes[caseId] || [];
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(`trac_notes_${caseId}`);
      if (stored) {
        const parsed = JSON.parse(stored) as CaseNote[];
        return parsed;
      }
    } catch {
      // Fallback to in-memory
    }
  }
  return mem;
}

function buildCaseRecord(raw: any, shiftMs: number): CanonicalCase {
  const shiftedSla = shiftTimestamp(raw.sla_deadline, shiftMs);
  const shiftedActivity = shiftTimestamp(raw.last_activity, shiftMs);
  const shiftedCreatedAt = shiftTimestamp(raw.created_at, shiftMs);

  const rawTrajectory = raw.detail?.ddi_trajectory_30d || [];
  const trajectory: TrajectoryPoint[] = rawTrajectory.map((p: any) => ({
    date: p.date,
    day: formatDayLabel(p.date),
    ddi: p.ddi,
  }));

  const rawNotes = raw.detail?.case_notes || [];
  const initialNotes: CaseNote[] = rawNotes.map((n: any) => ({
    author: n.author,
    timestamp: shiftTimestamp(n.timestamp, shiftMs),
    text: n.text,
  }));

  const appended = getStoredAppendedNotes(raw.case_id);
  const combinedNotes = [...initialNotes, ...appended];

  const rawBiomarkers = raw.detail?.biomarkers;
  const biomarkers = rawBiomarkers
    ? {
        pitchVariance: rawBiomarkers.pitch_variance_hz,
        hesitationLatency: rawBiomarkers.hesitation_latency_s,
        shimmer: rawBiomarkers.shimmer,
        jitter: rawBiomarkers.jitter,
        pitch_variance_hz: rawBiomarkers.pitch_variance_hz,
        hesitation_latency_s: rawBiomarkers.hesitation_latency_s,
      }
    : null;

  const detail: CaseDetail = {
    recording: raw.detail?.recording
      ? {
          duration_seconds: raw.detail.recording.duration_seconds,
          playback_speed: raw.detail.recording.playback_speed,
          raw_audio_purged: raw.detail.recording.raw_audio_purged,
        }
      : null,
    transcript: {
      sanitized: raw.detail?.transcript?.sanitized ?? true,
      lines: raw.detail?.transcript?.lines || [],
      compliance:
        raw.detail?.transcript?.compliance ||
        "DPDP Act: PII (names, locations, phone numbers) de-identified at intake. Raw audio purged post-feature extraction.",
    },
    biomarkers: rawBiomarkers
      ? {
          pitch_variance_hz: rawBiomarkers.pitch_variance_hz,
          hesitation_latency_s: rawBiomarkers.hesitation_latency_s,
          shimmer: rawBiomarkers.shimmer,
          jitter: rawBiomarkers.jitter,
        }
      : null,
    ddi: {
      score: raw.detail?.ddi?.score ?? raw.ddi_score,
      risk_tier: raw.detail?.ddi?.risk_tier ?? raw.risk_tier,
      sla_due: raw.detail?.ddi?.sla_due ?? "Within 2h",
      confidence_pct: raw.detail?.ddi?.confidence_pct ?? 94.8,
    },
    model_consensus: {
      clinical_llama3_triage: raw.detail?.model_consensus?.clinical_llama3_triage ?? raw.ddi_score,
      trauma_informed_mistral: raw.detail?.model_consensus?.trauma_informed_mistral ?? raw.ddi_score,
      acoustic_biomarker_pipeline: raw.detail?.model_consensus?.acoustic_biomarker_pipeline ?? null,
      concordance_pct: raw.detail?.model_consensus?.concordance_pct ?? 95.0,
      agreement_label: raw.detail?.model_consensus?.agreement_label ?? "High Ensemble Agreement",
    },
    ddi_trajectory_30d: trajectory,
    case_notes: combinedNotes,
  };

  const tierNormalized = (raw.risk_tier || "Low").toLowerCase() as "high" | "medium" | "low";
  const channelNormalized = (raw.channel || "pwa").toLowerCase() as "pwa" | "sms" | "voice" | "ivrs";
  const statusNormalized =
    raw.status === "In Progress"
      ? "in_progress"
      : raw.status === "Resolved"
      ? "resolved"
      : "open";

  return {
    case_id: raw.case_id,
    pseudo_id: raw.pseudo_id,
    risk_tier: raw.risk_tier,
    ddi_score: raw.ddi_score,
    channel: raw.channel,
    language: raw.language,
    sla_deadline: shiftedSla,
    counselor: raw.counselor,
    last_activity: shiftedActivity,
    status: statusNormalized,
    status_raw: raw.status,
    state: raw.state,
    district: raw.district,
    created_at: shiftedCreatedAt,
    detail,

    // Aliases
    id: raw.case_id,
    pseudoId: raw.pseudo_id,
    tier: tierNormalized,
    ddi: raw.ddi_score,
    assignedCounselor: raw.counselor,
    slaDueAt: shiftedSla,
    lastActivity: shiftedActivity,
    sanitizedTranscript: detail.transcript.lines,
    trajectory,
    biomarkers,
  };
}

let cachedShiftMs: number | null = null;
function getShiftMs(): number {
  if (cachedShiftMs === null) {
    cachedShiftMs = Date.now() - REFERENCE_TIME_MS;
  }
  return cachedShiftMs;
}

/**
 * Returns all 120 canonical cases with timestamps adjusted relative to the current session time.
 */
export function listCases(): CanonicalCase[] {
  const shiftMs = getShiftMs();
  return (rawCasesData as any[]).map((raw) => buildCaseRecord(raw, shiftMs));
}

/**
 * Finds a case by case_id, id, or pseudo_id.
 */
export function getCaseById(id: string): CanonicalCase | undefined {
  if (!id) return undefined;
  const cases = listCases();
  const lower = id.toLowerCase();
  return cases.find(
    (c) =>
      c.case_id.toLowerCase() === lower ||
      c.id.toLowerCase() === lower ||
      c.pseudo_id.toLowerCase() === lower
  );
}

/**
 * Appends a new case note to the immutable case notes log.
 */
export function appendCaseNote(
  caseId: string,
  note: { author: string; text: string; timestamp?: string }
): CaseNote[] {
  const targetCase = getCaseById(caseId);
  const canonicalId = targetCase?.case_id || caseId;

  const newNote: CaseNote = {
    author: note.author || "Counsellor",
    timestamp: note.timestamp || new Date().toISOString(),
    text: note.text.trim(),
  };

  const existingAppended = getStoredAppendedNotes(canonicalId);
  const updatedAppended = [...existingAppended, newNote];
  inMemoryAppendedNotes[canonicalId] = updatedAppended;

  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(`trac_notes_${canonicalId}`, JSON.stringify(updatedAppended));
    } catch {
      // Ignored
    }
  }

  const updatedCase = getCaseById(canonicalId);
  return updatedCase?.detail.case_notes || updatedAppended;
}

/**
 * Returns all unique sorted states in the dataset.
 */
export function getAvailableStates(): string[] {
  const set = new Set<string>();
  for (const c of rawCasesData as any[]) {
    if (c.state) set.add(c.state);
  }
  return Array.from(set).sort();
}

/**
 * Returns all unique sorted districts for a given state.
 */
export function getDistrictsForState(state: string): string[] {
  const set = new Set<string>();
  for (const c of rawCasesData as any[]) {
    if (c.state === state && c.district) {
      set.add(c.district);
    }
  }
  return Array.from(set).sort();
}
