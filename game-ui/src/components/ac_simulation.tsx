/**
 * The simulation phase as the four beat delta report (plan 07).
 *
 * What you built, what the world did, which patterns moved, where you stand. Everything comes from
 * the `graph:delta_report` payload; this screen only reads it, so the numbers on screen are the
 * numbers the server applied.
 */

import { useEffect, useState } from "react";
import PhaseOverview from "./PhaseOverview";
import MetricTab from "./MetricTab";
import ActionCardComponent from "./ActionCardComponent";
import EventLog from "./EventLog";
import type { ActionCard } from "../types/ActionCard";
import type { GameEventPayload } from "../types/GameEvent";
import { useGameWebSocket, useWebSocketEvent } from "../services/websocket/useGameWebSocket";

const LEVEL_LABELS = ["broken", "absent", "manual", "automated", "governed"];

interface LevelPair {
  before: number;
  after: number;
}

interface TargetDelta {
  id: string;
  stage: string;
  nominal: LevelPair;
  effective: LevelPair;
  capped_by?: { id: string; level: number } | null;
  degraded_by?: string | null;
  story?: string;
}

interface DeltaReport {
  outcome: string;
  targets: TargetDelta[];
  debt_created: Array<{ target_id?: string; owner_id?: string; intended?: number; applied?: number }>;
  debt_cleared: Array<{ target_id?: string; owner_id?: string }>;
  world_events: Array<{ target: string; before: number; after: number; reason?: string }>;
  propagated: Array<{ target: string; effective: LevelPair; via?: string | null }>;
  stage_health: Record<string, LevelPair>;
  system_health: LevelPair;
  patterns: { gained: string[]; lost: string[]; anti_created: string[]; anti_resolved: string[] };
  grudges: {
    created: Array<{ stakeholder_id: string; reason?: string }>;
    fired: Array<{ stakeholder_id: string; effect: string; detail?: string; target?: string | null }>;
  };
  metric_deltas: Record<string, number>;
}

interface DeltaReportPayload {
  report: DeltaReport;
  next_challenge?: { id: number; phase_id: number; name: string; phase_name: string } | null;
}

interface AcSimulationProps {
  onContinue: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  /** The card just committed, for the "what you played" reveal (merged from the old
   * AcRevealPanel, plan 07/D46: the reveal and the delta report are one screen now, not two). */
  playedCard?: ActionCard | null;
}

const OUTCOME_TEXT: Record<string, string> = {
  PASS: "The room backed the card and it went in as pitched.",
  SOFT_PASS: "It went in, but the people you passed over will remember it.",
  VETO_BROKEN: "You pushed it through over a veto. It landed, and it cost you.",
  STALEMATE: "Nobody agreed. Your card never happened, and the world moved on without you.",
};

function levelArrow(pair: LevelPair) {
  if (pair.before === pair.after) return LEVEL_LABELS[pair.after] ?? String(pair.after);
  return `${LEVEL_LABELS[pair.before] ?? pair.before} → ${LEVEL_LABELS[pair.after] ?? pair.after}`;
}

function healthArrow(pair: LevelPair) {
  const diff = Math.round(pair.after - pair.before);
  const sign = diff > 0 ? "+" : "";
  return `${Math.round(pair.before)} → ${Math.round(pair.after)} (${sign}${diff})`;
}

export default function AcSimulation({
  onContinue,
  currentPhase = 0,
  currentChallenge = 0,
  playedCard,
}: AcSimulationProps) {
  const { emit } = useGameWebSocket();
  const [payload, setPayload] = useState<DeltaReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<GameEventPayload[]>([]);

  useWebSocketEvent<DeltaReportPayload>("graph:delta_report", (data) => setPayload(data));

  // The event log (D51): the gate decision and everything the simulation just moved.
  useWebSocketEvent<{ events: GameEventPayload[] }>("log:history", (data) => {
    setEvents(data.events || []);
  });
  useWebSocketEvent<{ events: GameEventPayload[] }>("log:events", (data) => {
    if (!data.events?.length) return;
    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.seq));
      return [...prev, ...data.events.filter((e) => !seen.has(e.seq))];
    });
  });

  useEffect(() => {
    emit("simulation:run", { phase_id: currentPhase, challenge_id: currentChallenge });
    emit("log:history", {});
  }, [emit, currentPhase, currentChallenge]);

  const handleClick = () => {
    setLoading(true);
    onContinue();
  };

  const report = payload?.report;
  const bgIndex = (currentChallenge + currentPhase) % 4;

  return (
    <div className="game-container">
      <nav className="navbar navbar-expand-lg flex-shrink-0" style={{ backgroundColor: "var(--primary-bg)" }}>
        <div className="container-fluid d-flex align-items-stretch py-1" style={{ gap: "1rem" }} data-bs-theme="dark">
          <div className="transparent-div" style={{ flex: "0 0 50%" }}>
            <span className="transparent-div-label">📋 Phase Overview</span>
            <PhaseOverview />
          </div>
          <div className="transparent-div" style={{ flex: "1 1 0" }}>
            <span className="transparent-div-label">📊 Performance Metrics</span>
            <MetricTab current_phase={currentPhase} />
          </div>
        </div>
      </nav>

      <div
        className="container-fluid flex-grow-1 d-flex align-items-start justify-content-center overflow-auto p-4"
        style={{
          backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_${bgIndex}.png")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div className="transparent-div p-3 p-md-4 shadow-lg" style={{ maxWidth: 900, width: "100%", borderRadius: 16 }}>
          <span className="transparent-div-label fs-6 mb-3 d-flex align-items-center gap-2">
            🚀 What happened
          </span>

          {!report && (
            <div className="card border-secondary shadow-sm">
              <div className="card-body bg-light p-4 d-flex align-items-center gap-3">
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                Running the change through the system...
              </div>
            </div>
          )}

          {report && (
            <div className="card border-secondary shadow-sm text-start w-100" style={{ borderRadius: 12, overflow: "hidden" }}>
              <div className="card-header bg-dark text-white py-3 px-4">
                <h4 className="mb-1 fw-bold text-white">{report.outcome.replace("_", " ")}</h4>
                <div className="small">{OUTCOME_TEXT[report.outcome] ?? ""}</div>
              </div>

              <div className="card-body bg-light p-4">
                {/* 0. The card you played (merged from AcRevealPanel) */}
                {playedCard && (
                  <div className="mb-4 d-flex flex-column align-items-center text-center">
                    <div className="text-muted small mb-2">You played</div>
                    <div style={{ maxWidth: 340, width: "100%" }}>
                      <ActionCardComponent
                        ac={playedCard}
                        current_phase={currentPhase}
                        highlight={false}
                        id="revealCard"
                        showValues={true}
                        displayMetrics={true}
                        interactable={false}
                        hasDropIndicator={false}
                      />
                    </div>
                  </div>
                )}

                {/* 1. What you built */}
                <h5 className="fw-bold">What you built</h5>
                {report.targets.length === 0 && <p className="text-muted">Nothing of yours reached the system.</p>}
                <ul className="list-unstyled">
                  {report.targets.map((t) => (
                    <li key={t.id} className="mb-2">
                      <strong>{t.id}</strong>: {levelArrow(t.nominal)}
                      {t.effective.after !== t.nominal.after && (
                        <span className="text-warning">
                          {" "}
                          but it runs at {LEVEL_LABELS[t.effective.after] ?? t.effective.after}
                          {t.capped_by && `, held back by ${t.capped_by.id}`}
                        </span>
                      )}
                      {t.degraded_by && (
                        <span className="text-danger"> {`${t.degraded_by} was not behind this, so it landed lower`}</span>
                      )}
                      {t.story && <div className="text-muted small">{t.story}</div>}
                    </li>
                  ))}
                </ul>
                {report.debt_created.length > 0 && (
                  <div className="alert alert-danger py-2">
                    {report.debt_created.length} shortcut left behind, and it will keep costing you.
                  </div>
                )}
                {report.debt_cleared.length > 0 && (
                  <div className="alert alert-success py-2">{report.debt_cleared.length} old shortcut cleaned up.</div>
                )}

                {/* 2. What the world did */}
                <h5 className="fw-bold mt-4">What the world did</h5>
                {report.world_events.length === 0 && <p className="text-muted">The system stayed as it was.</p>}
                <ul className="list-unstyled">
                  {report.world_events.map((e, i) => (
                    <li key={`${e.target}-${i}`} className="mb-1">
                      <strong>{e.target}</strong>: {levelArrow({ before: e.before, after: e.after })}
                      {e.reason && <span className="text-muted"> ({e.reason})</span>}
                    </li>
                  ))}
                </ul>
                {report.propagated.length > 0 && (
                  <>
                    <div className="small fw-bold">It carried on to</div>
                    <ul className="list-unstyled">
                      {report.propagated.map((p) => (
                        <li key={p.target} className="small text-muted">
                          {p.target}: {levelArrow(p.effective)}
                          {p.via && ` through ${p.via}`}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {report.grudges.fired.length > 0 && (
                  <ul className="list-unstyled">
                    {report.grudges.fired.map((g, i) => (
                      <li key={`${g.stakeholder_id}-${i}`} className="small text-warning">
                        {g.stakeholder_id}: {g.detail || g.effect}
                      </li>
                    ))}
                  </ul>
                )}

                {/* 3. Patterns */}
                <h5 className="fw-bold mt-4">Patterns</h5>
                {[
                  ["Gained", report.patterns.gained, "text-success"],
                  ["Lost", report.patterns.lost, "text-warning"],
                  ["New trouble", report.patterns.anti_created, "text-danger"],
                  ["Cleared", report.patterns.anti_resolved, "text-success"],
                ].map(([label, list, cls]) =>
                  (list as string[]).length === 0 ? null : (
                    <div key={label as string} className={cls as string}>
                      {label as string}: {(list as string[]).join(", ")}
                    </div>
                  ),
                )}
                {Object.values(report.patterns).every((l) => (l as string[]).length === 0) && (
                  <p className="text-muted">Nothing changed shape.</p>
                )}

                {/* 4. Where you stand */}
                <h5 className="fw-bold mt-4">Where you stand</h5>
                <div>System health: {healthArrow(report.system_health)}</div>
                <ul className="list-unstyled">
                  {Object.entries(report.stage_health)
                    .filter(([, pair]) => pair.before !== pair.after)
                    .map(([stage, pair]) => (
                      <li key={stage}>
                        {stage}: {healthArrow(pair)}
                      </li>
                    ))}
                </ul>
                {Object.keys(report.metric_deltas).length > 0 && (
                  <div className="small">
                    Metrics:{" "}
                    {Object.entries(report.metric_deltas)
                      .map(([m, d]) => `${m} ${d > 0 ? "+" : ""}${d}`)
                      .join(", ")}
                  </div>
                )}
                {report.grudges.created.length > 0 && (
                  <div className="small text-warning mt-2">
                    {report.grudges.created.map((g) => g.stakeholder_id).join(", ")} will remember this.
                  </div>
                )}

                {payload?.next_challenge && (
                  <div className="mt-3 small text-muted">
                    Next: {payload.next_challenge.phase_name} · {payload.next_challenge.name}
                  </div>
                )}

                <div className="mt-3 p-2" style={{ background: "rgba(15, 23, 42, 0.92)", borderRadius: 8 }}>
                  <EventLog events={events} />
                </div>

                {/* Simulation Debug Data View when VITE_SHOW_SIMULATION_DATA === 'true' */}
                {(import.meta.env.VITE_SHOW_SIMULATION_DATA === "true" || import.meta.env.VITE_SHOW_SIMULATION_DATA === true) && (
                  <details className="mt-4 p-3 bg-dark text-light rounded border border-info" style={{ fontSize: "0.8rem" }}>
                    <summary className="fw-bold text-info mb-2" style={{ cursor: "pointer" }}>
                      🛠️ Raw Simulation Debug Data (VITE_SHOW_SIMULATION_DATA)
                    </summary>
                    <div className="mb-2">
                      <strong>Outcome:</strong> {report.outcome}
                    </div>
                    <div className="mb-2">
                      <strong>Targets:</strong>
                      <pre className="bg-secondary p-2 rounded text-light overflow-auto" style={{ maxHeight: 200 }}>
                        {JSON.stringify(report.targets, null, 2)}
                      </pre>
                    </div>
                    <div className="mb-2">
                      <strong>Technical Debt Created:</strong>
                      <pre className="bg-secondary p-2 rounded text-light overflow-auto" style={{ maxHeight: 150 }}>
                        {JSON.stringify(report.debt_created, null, 2)}
                      </pre>
                    </div>
                    <div className="mb-2">
                      <strong>Full Delta Report Payload:</strong>
                      <pre className="bg-secondary p-2 rounded text-light overflow-auto" style={{ maxHeight: 250 }}>
                        {JSON.stringify(payload, null, 2)}
                      </pre>
                    </div>
                  </details>
                )}

                <button
                  onClick={handleClick}
                  disabled={loading}
                  className="actionButton mt-3"
                >
                  {loading ? "Advancing..." : "Continue ▶"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
