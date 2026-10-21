"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { getCaseById, appendCaseNote, CanonicalCase, CaseNote } from "@/lib/cases-data";
import styles from "./case.module.css";
import Link from "next/link";

function DDIDonut({ value, tier }: { value: number; tier: string }) {
  const r   = 50;
  const circ = 2 * Math.PI * r;
  const fill = (value / 100) * circ;
  const color = tier === "high" ? "var(--risk-high)" : tier === "medium" ? "var(--risk-medium)" : "var(--risk-low)";

  return (
    <svg width="130" height="130" viewBox="0 0 130 130" className="ddi-donut" aria-label={`DDI score: ${value}`}>
      <circle cx="65" cy="65" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="12" />
      <circle
        cx="65" cy="65" r={r}
        fill="none"
        stroke={color}
        strokeWidth="12"
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 65 65)"
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text x="65" y="60" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--ink)">{value}</text>
      <text x="65" y="76" textAnchor="middle" fontSize="11" fill="var(--ink-muted)">DDI</text>
    </svg>
  );
}

function DDIChart({ data }: { data: { day: string; ddi: number }[] }) {
  const W = 480, H = 140, PAD = { t: 10, r: 10, b: 30, l: 35 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const pointsCount = Math.max(data.length, 2);
  const xStep  = innerW / (pointsCount - 1);
  function x(i: number) { return PAD.l + i * xStep; }
  function y(v: number) { return PAD.t + innerH - (v / 100) * innerH; }
  const pts  = data.map((d, i) => `${x(i)},${y(d.ddi)}`).join(" L ");
  const path = `M ${pts}`;
  const area = `M ${x(0)},${y(0)} L ${pts} L ${x(data.length-1)},${PAD.t+innerH} L ${x(0)},${PAD.t+innerH} Z`;
  const labelIdx = data.map((_,i)=>i).filter(i => i%7===0 || i===data.length-1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} aria-label="30-day DDI trend">
      <defs>
        <linearGradient id="ddi-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0,40,70,100].map(v=>(
        <line key={v} x1={PAD.l} x2={PAD.l+innerW} y1={y(v)} y2={y(v)}
          stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
      ))}
      {[0,40,70,100].map(v=>(
        <text key={v} x={PAD.l-4} y={y(v)+4} textAnchor="end" fontSize="9" fill="var(--ink-faint)">{v}</text>
      ))}
      <path d={area} fill="url(#ddi-area)" />
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {labelIdx.map(i=>(
        <text key={i} x={x(i)} y={H-4} textAnchor="middle" fontSize="9" fill="var(--ink-faint)">{data[i].day}</text>
      ))}
      {data.length > 0 && (
        <circle cx={x(data.length-1)} cy={y(data[data.length-1].ddi)} r="4"
          fill="var(--brand)" stroke="#fff" strokeWidth="2" />
      )}
    </svg>
  );
}

function Biomarkers({ b }: { b: NonNullable<CanonicalCase["detail"]["biomarkers"]> }) {
  const items = [
    { label: "Pitch variance",      value: b.pitch_variance_hz,      max: 8,   unit: "Hz" },
    { label: "Hesitation latency",  value: b.hesitation_latency_s,  max: 4,   unit: "s"  },
    { label: "Shimmer",             value: b.shimmer,            max: 0.6, unit: ""   },
    { label: "Jitter",              value: b.jitter,             max: 0.2, unit: ""   },
  ];
  return (
    <div className={styles.bioGrid}>
      {items.map(it=>(
        <div key={it.label} className={styles.bioItem}>
          <div className={styles.bioHeader}>
            <span className={styles.bioLabel}>{it.label}</span>
            <span className={styles.bioValue}>{it.value.toFixed(2)}{it.unit}</span>
          </div>
          <div className="biomarker-bar-track">
            <div className="biomarker-bar-fill" style={{ width: `${Math.min((it.value/it.max)*100, 100)}%` }} />
          </div>
        </div>
      ))}
      <p className={`text-xs text-faint ${styles.bioDisclaimer}`}>
        Processed via openSMILE acoustical analysis. Shown as clinical supporting signal.
      </p>
    </div>
  );
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function CaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const paramId = Array.isArray(params.id) ? params.id[0] : params.id;
  const caseData = getCaseById(paramId as string);

  // Audio player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playProgress, setPlayProgress] = useState(35); // percentage
  const [speed, setSpeed] = useState<"1x" | "1.25x" | "1.5x">(
    (caseData?.detail?.recording?.playback_speed as any) || "1x"
  );

  // Counselor notes state
  const [noteText, setNoteText] = useState("");
  const [savedNotes, setSavedNotes] = useState<CaseNote[]>(
    caseData?.detail?.case_notes || []
  );
  const [noteSavedAlert, setNoteSavedAlert] = useState(false);

  function handleSaveNote() {
    if (!noteText.trim() || !caseData) return;
    const authorName =
      caseData.counselor && caseData.counselor !== "Unassigned"
        ? caseData.counselor
        : "Dr. Priya Nair";
    const updated = appendCaseNote(caseData.case_id, {
      author: authorName,
      text: noteText.trim(),
      timestamp: new Date().toISOString(),
    });
    setSavedNotes(updated);
    setNoteText("");
    setNoteSavedAlert(true);
    setTimeout(() => setNoteSavedAlert(false), 3000);
  }

  if (!caseData) {
    return (
      <div style={{ padding: "var(--sp-8)" }}>
        <p>Case not found.</p>
        <Link href="/dashboard" className="btn btn-secondary btn-sm" style={{ marginTop: "var(--sp-4)", display: "inline-flex" }}>
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className={styles.pageHeader}>
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => router.push("/dashboard")} style={{ marginBottom: "var(--sp-2)" }}>
            ← Back to Dashboard
          </button>
          <h1 className="text-h1" style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
            Case {caseData.pseudo_id}
            <span className={`risk-badge ${caseData.tier}`}>
              {caseData.risk_tier.toUpperCase()} RISK
            </span>
          </h1>
          <div className="text-sm text-muted" style={{ marginTop: "var(--sp-1)" }}>
            Channel: <strong>{caseData.channel.toUpperCase()}</strong> · Language: <strong>{caseData.language}</strong> · Assigned: <strong>{caseData.counselor}</strong>
          </div>
        </div>

        <Link
          href={`/cases/${caseData.id}/actions`}
          className="btn btn-danger"
          style={{ alignSelf: "flex-start" }}
        >
          🚨 Clinical Action Center
        </Link>
      </div>

      <div className={styles.grid}>
        {/* Left Column: Audio Recording + Transcript + Notes */}
        <div className={styles.leftCol}>
          {/* Audio Playback Widget - hidden for SMS cases where recording is null */}
          {caseData.detail.recording ? (
            <div className="card-elevated">
              <div className={styles.audioCardHead}>
                <div>
                  <h2 className={`text-h2 ${styles.sectionTitle}`}>Session Voice Recording</h2>
                  <span className="text-xs text-muted">Acoustic waveform &amp; vocal biomarker alignment</span>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setSpeed(speed === "1x" ? "1.25x" : speed === "1.25x" ? "1.5x" : "1x")}
                >
                  {speed}
                </button>
              </div>

              <div className={styles.audioPlayer}>
                <button
                  className={styles.playBtn}
                  onClick={() => setIsPlaying(!isPlaying)}
                  aria-label={isPlaying ? "Pause audio" : "Play audio"}
                >
                  {isPlaying ? "⏸" : "▶"}
                </button>

                {/* Simulated waveform bars */}
                <div className={styles.waveformContainer}>
                  {Array.from({ length: 36 }).map((_, idx) => {
                    const h = Math.sin(idx * 0.4) * 14 + 18;
                    const isPlayed = (idx / 36) * 100 <= playProgress;
                    return (
                      <div
                        key={idx}
                        className={styles.audioWaveBar}
                        style={{
                          height: `${h}px`,
                          background: isPlayed ? "var(--brand)" : "var(--border)",
                        }}
                        onClick={() => setPlayProgress((idx / 36) * 100)}
                      />
                    );
                  })}
                </div>

                <span className={styles.audioTime}>
                  {formatDuration(caseData.detail.recording.duration_seconds)}
                </span>
              </div>
            </div>
          ) : null}

          {/* Sanitized Transcript */}
          <div className="card-elevated">
            <h2 className={`text-h2 ${styles.sectionTitle}`}>Sanitized Check-In Transcript</h2>
            <div className={styles.transcript}>
              {caseData.detail.transcript.lines.map((line, i) => (
                <div key={i} className={styles.transcriptLine}>
                  <span className={styles.transcriptNum}>{i + 1}</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
            <div className={styles.piiNote}>
              🔒 <strong>DPDP Act Compliance:</strong> {caseData.detail.transcript.compliance || "Personally identifiable data (names, locations, phone numbers) has been de-identified at intake. Raw audio is purged post-feature extraction."}
            </div>
          </div>

          {/* Clinical Notes Editor */}
          <div className="card-elevated">
            <h2 className={`text-h2 ${styles.sectionTitle}`}>Confidential Case Notes</h2>
            <div className={styles.notesEditor}>
              <textarea
                className="input"
                rows={3}
                placeholder="Record clinical observations, referral actions, or survivor progress notes…"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                style={{ borderRadius: "var(--r-md)", resize: "vertical" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "var(--sp-2)" }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleSaveNote}
                  disabled={!noteText.trim()}
                >
                  Save Note to Immutable Log
                </button>
                {noteSavedAlert && (
                  <span className="text-xs text-brand font-semibold animate-fade-in">
                    ✓ Note logged with tamper-evident timestamp
                  </span>
                )}
              </div>

              {savedNotes.length > 0 && (
                <div className={styles.pastNotes}>
                  <div className="text-xs font-semibold text-muted" style={{ marginTop: "var(--sp-3)" }}>
                    Previous Notes:
                  </div>
                  {savedNotes.map((n, i) => (
                    <div key={i} className={styles.noteItem}>
                      <span className={styles.noteDot}>•</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1 }}>
                        <div className="text-xs text-muted" style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
                          <strong>{n.author}</strong>
                          <span>·</span>
                          <span>{formatTime(n.timestamp)}</span>
                        </div>
                        <p className="text-sm text-ink">{n.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Biomarkers - hidden for SMS cases where biomarkers is null */}
          {caseData.detail.biomarkers && (
            <div className="card-elevated">
              <h2 className={`text-h2 ${styles.sectionTitle}`}>Acoustic Vocal Biomarkers</h2>
              <Biomarkers b={caseData.detail.biomarkers} />
            </div>
          )}
        </div>

        {/* Right Column: DDI Score + Consensus + Trajectory + Fast Actions */}
        <div className={styles.rightCol}>
          {/* DDI Donut */}
          <div className="card-elevated">
            <h2 className={`text-h2 ${styles.sectionTitle}`}>Dynamic Distress Index (DDI)</h2>
            <div className={styles.ddiRow}>
              <DDIDonut value={caseData.detail.ddi.score} tier={caseData.detail.ddi.risk_tier.toLowerCase()} />
              <div className={styles.ddiMeta}>
                <div className={styles.ddiMetaItem}>
                  <span className="text-xs text-muted">Risk Tier</span>
                  <span className={`risk-badge ${caseData.detail.ddi.risk_tier.toLowerCase()}`}>
                    {caseData.detail.ddi.risk_tier.toUpperCase()}
                  </span>
                </div>
                <div className={styles.ddiMetaItem}>
                  <span className="text-xs text-muted">SLA Due</span>
                  <span className="text-sm font-semibold">{caseData.detail.ddi.sla_due}</span>
                </div>
                <div className={styles.ddiMetaItem}>
                  <span className="text-xs text-muted">Confidence</span>
                  <span className="text-sm font-semibold text-brand">{caseData.detail.ddi.confidence_pct}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Multi-Model Clinical Consensus (PRD §2.1) */}
          <div className="card-elevated">
            <h2 className={`text-h2 ${styles.sectionTitle}`}>AI Model Consensus</h2>
            <div className={styles.consensusList}>
              <div className={styles.consensusItem}>
                <div className={styles.consensusHeader}>
                  <span className="text-sm font-semibold">Clinical Llama-3 Triage</span>
                  <span className="text-sm font-bold text-ink">{caseData.detail.model_consensus.clinical_llama3_triage} DDI</span>
                </div>
                <div className="biomarker-bar-track">
                  <div className="biomarker-bar-fill" style={{ width: `${Math.min(caseData.detail.model_consensus.clinical_llama3_triage, 100)}%` }} />
                </div>
              </div>

              <div className={styles.consensusItem}>
                <div className={styles.consensusHeader}>
                  <span className="text-sm font-semibold">Trauma-Informed Mistral</span>
                  <span className="text-sm font-bold text-ink">{caseData.detail.model_consensus.trauma_informed_mistral} DDI</span>
                </div>
                <div className="biomarker-bar-track">
                  <div className="biomarker-bar-fill" style={{ width: `${Math.min(caseData.detail.model_consensus.trauma_informed_mistral, 100)}%` }} />
                </div>
              </div>

              {/* Acoustic Biomarker Pipeline - hidden for SMS cases where null */}
              {caseData.detail.model_consensus.acoustic_biomarker_pipeline !== null && (
                <div className={styles.consensusItem}>
                  <div className={styles.consensusHeader}>
                    <span className="text-sm font-semibold">Acoustic Biomarker Pipeline</span>
                    <span className="text-sm font-bold text-ink">{caseData.detail.model_consensus.acoustic_biomarker_pipeline} DDI</span>
                  </div>
                  <div className="biomarker-bar-track">
                    <div className="biomarker-bar-fill" style={{ width: `${Math.min(caseData.detail.model_consensus.acoustic_biomarker_pipeline, 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
            <div className={styles.consensusBadge}>
              ✓ {caseData.detail.model_consensus.agreement_label} ({caseData.detail.model_consensus.concordance_pct}% Concordance)
            </div>
          </div>

          {/* 30-day DDI trajectory */}
          <div className="card-elevated">
            <h2 className={`text-h2 ${styles.sectionTitle}`}>30-Day DDI Trajectory</h2>
            <DDIChart data={caseData.detail.ddi_trajectory_30d} />
          </div>

          {/* Quick clinical actions */}
          <div className={styles.actionsCard}>
            <div className={styles.actionsTitle}>Immediate Interventions</div>
            <div className={styles.actionBtns}>
              <Link href={`/cases/${caseData.id}/actions`} className="btn btn-danger btn-sm" style={{ width: "100%", justifyContent: "center" }}>
                🚨 Open Action Center
              </Link>
              <Link href="/sessions" className="btn btn-secondary btn-sm" style={{ flex: 1, justifyContent: "center" }}>
                📅 Schedule Session
              </Link>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => alert(`Escalation request queued for ${caseData.pseudo_id}`)}
                style={{ flex: 1, justifyContent: "center" }}
              >
                ⚡ Escalate Lead
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
