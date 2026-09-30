import { useMemo, useState, type ReactNode } from "react";
import { fetchGraphDebug } from "../services/api/admin";
import type { Campaign, Player } from "./Admin";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StageDebug {
  id: string; name: string;
  health: number; maturity: number; broken: number; starved?: number; starved_ids?: string[]; debt: number; pattern_effect: number;
}
interface ComponentDebug {
  id: string; stage_id: string; name: string; owner: string;
  nominal_automation: number; nominal_governance: number;
  effective_automation: number; effective_governance: number;
  capped_by?: string; attrs?: Record<string, string>;
}
interface EdgeDebug {
  id: string; from: string; to: string; kind: string;
  automation: number; governance: number;
  effective_automation: number; effective_governance: number; trigger: string;
  capped_by?: string;
}
interface InstanceDebug {
  id: string; kind: string; component_id: string; name: string; state: string;
  props: Record<string, string>;
}
interface PatternInfo { id: string; kind: string; name: string; story?: string; stage_effects?: Record<string, number>; }
interface NearMiss extends PatternInfo { failed_clause: unknown; }
interface OpLogRow {
  seq: number; kind: string; target: string; value: unknown;
  source_kind: string; source_id?: string; reason?: string;
}
interface ChallengeEntry { template_id: string; phase_id: number; fallback?: boolean; priority?: number; failed_clause?: unknown; }
interface OrphanSection {
  targets_in_no_pattern: string[];
  targets_never_in_a_driver: string[];
  levels_without_story_fragment: string[];
  objections_never_reachable: string[];
  facts_on_nonexistent_targets: string[];
}
export interface GraphDebugPayload {
  email: string;
  stages: StageDebug[];
  components: ComponentDebug[];
  edges: EdgeDebug[];
  instances: InstanceDebug[];
  patterns: { active: PatternInfo[]; near_miss: NearMiss[] };
  op_log: OpLogRow[];
  challenges: { played: string[]; eligible_now: ChallengeEntry[]; rejected: ChallengeEntry[] };
  orphans: OrphanSection;
  intel_index: unknown[];
  objections: unknown[];
  action_cards: unknown[];
}

// ── Utilities ─────────────────────────────────────────────────────────────────

// Two independent axes (docs/plans/graph-governance-automation-rework/00-plan.md §2.1).
const AUTOMATION_LABEL = ["broken", "absent", "manual", "automated"];
const AUTOMATION_COLOR = ["#dc3545", "#6c757d", "#ffc107", "#0dcaf0"];
const GOVERNANCE_LABEL = ["none", "partial_1", "partial_2", "full"];
const GOVERNANCE_COLOR = ["#adb5bd", "#d0bfff", "#b197fc", "#9775fa"];

function levelBadge(n: number, axis: "automation" | "governance" = "automation") {
  const labels = axis === "automation" ? AUTOMATION_LABEL : GOVERNANCE_LABEL;
  const colors = axis === "automation" ? AUTOMATION_COLOR : GOVERNANCE_COLOR;
  const label = labels[n] ?? String(n);
  const color = colors[n] ?? "#888";
  return <span style={{ background: color, color: "#000", borderRadius: 4, padding: "1px 6px", fontSize: 11, fontWeight: 600 }}>{label}</span>;
}

/** Nominal and effective on one axis, collapsed to one badge when they agree. */
function axisCell(nominal: number, effective: number, axis: "automation" | "governance") {
  if (nominal === effective) return levelBadge(nominal, axis);
  return <span style={{ whiteSpace: "nowrap" }}>{levelBadge(nominal, axis)} → {levelBadge(effective, axis)}</span>;
}

function healthBar(v: number) {
  const c = v >= 75 ? "#198754" : v >= 45 ? "#ffc107" : "#dc3545";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 60, height: 8, background: "#333", borderRadius: 4, display: "inline-block", overflow: "hidden" }}>
        <span style={{ width: `${v}%`, height: "100%", background: c, display: "block" }} />
      </span>
      {v.toFixed(1)}
    </span>
  );
}

function FilterInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      placeholder="filter…"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0",
        borderRadius: 6, padding: "3px 8px", fontSize: 12, marginBottom: 8, width: "100%",
      }}
    />
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ marginBottom: 20, border: "1px solid #334155", borderRadius: 8, overflow: "hidden" }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          background: "#1e293b", padding: "8px 14px", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}
      >
        <span style={{ fontWeight: 600, color: "#94a3b8" }}>{title}</span>
        <span style={{ color: "#64748b", fontSize: 12 }}>{count} rows {open ? "▲" : "▼"}</span>
      </div>
      {open && <div style={{ padding: "10px 14px", overflowX: "auto" }}>{children}</div>}
    </div>
  );
}

function Tbl({ cols, rows }: { cols: string[]; rows: (string | ReactNode | null | undefined)[][] }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, color: "#cbd5e1" }}>
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c} style={{ textAlign: "left", padding: "4px 8px", borderBottom: "1px solid #334155", color: "#94a3b8" }}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderBottom: "1px solid #1e293b" }}>
            {row.map((cell, j) => (
              <td key={j} style={{ padding: "3px 8px", verticalAlign: "top" }}>{cell ?? "—"}</td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={cols.length} style={{ color: "#64748b", padding: "8px", textAlign: "center" }}>empty</td></tr>
        )}
      </tbody>
    </table>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────

function StagesSection({ data }: { data: StageDebug[] }) {
  const [q, setQ] = useState("");
  const rows = data.filter((r) => !q || r.id.includes(q) || r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Section title="1. Stages" count={rows.length}>
      <FilterInput value={q} onChange={setQ} />
      <Tbl
        cols={["id", "name", "health", "maturity", "broken", "starved", "debt", "pattern Δ"]}
        rows={rows.map((r) => [
          <code>{r.id}</code>,
          r.name,
          healthBar(r.health),
          (r.maturity * 100).toFixed(1) + "%",
          String(r.broken),
          r.starved ? `${r.starved} (${(r.starved_ids ?? []).join(", ")})` : "0",
          String(r.debt),
          (r.pattern_effect >= 0 ? "+" : "") + r.pattern_effect,
        ])}
      />
    </Section>
  );
}

function ComponentsSection({ data }: { data: ComponentDebug[] }) {
  const [q, setQ] = useState("");
  const rows = data.filter((r) => !q || r.id.includes(q) || r.name.toLowerCase().includes(q.toLowerCase()) || r.stage_id.includes(q));
  return (
    <Section title="2. Components" count={rows.length}>
      <FilterInput value={q} onChange={setQ} />
      <Tbl
        cols={["id", "stage", "name", "owner", "automation (nom → eff)", "governance (nom → eff)", "capped by"]}
        rows={rows.map((r) => [
          <code>{r.id}</code>,
          r.stage_id,
          r.name,
          r.owner ?? "—",
          axisCell(r.nominal_automation, r.effective_automation, "automation"),
          axisCell(r.nominal_governance, r.effective_governance, "governance"),
          r.capped_by ? <code style={{ fontSize: 11 }}>{r.capped_by}</code> : null,
        ])}
      />
    </Section>
  );
}

function EdgesSection({ data }: { data: EdgeDebug[] }) {
  const [q, setQ] = useState("");
  const rows = data.filter((r) => !q || r.id.includes(q) || r.from.includes(q) || r.to.includes(q));
  return (
    <Section title="3. Edges" count={rows.length}>
      <FilterInput value={q} onChange={setQ} />
      <Tbl
        cols={["id", "from", "to", "kind", "automation (nom → eff)", "governance (nom → eff)", "trigger", "capped by"]}
        rows={rows.map((r) => [
          <code>{r.id}</code>,
          <code>{r.from}</code>,
          <code>{r.to}</code>,
          r.kind,
          axisCell(r.automation, r.effective_automation, "automation"),
          axisCell(r.governance, r.effective_governance, "governance"),
          r.trigger,
          r.capped_by ? <code style={{ fontSize: 11 }}>{r.capped_by}</code> : null,
        ])}
      />
    </Section>
  );
}

function InstancesSection({ data }: { data: InstanceDebug[] }) {
  const [q, setQ] = useState("");
  const rows = data.filter((r) => !q || r.id.includes(q) || r.kind.includes(q) || r.component_id.includes(q));
  return (
    <Section title="4. Instances" count={rows.length}>
      <FilterInput value={q} onChange={setQ} />
      <Tbl
        cols={["id", "kind", "component", "name", "state", "props"]}
        rows={rows.map((r) => [
          <code>{r.id}</code>,
          r.kind,
          <code>{r.component_id}</code>,
          r.name,
          r.state,
          Object.entries(r.props || {}).map(([k, v]) => `${k}=${v}`).join(", "),
        ])}
      />
    </Section>
  );
}

function PatternsSection({ data }: { data: { active: PatternInfo[]; near_miss: NearMiss[] } }) {
  const [q, setQ] = useState("");
  const active = data.active.filter((r) => !q || r.id.includes(q) || r.name.toLowerCase().includes(q.toLowerCase()));
  const near = data.near_miss.filter((r) => !q || r.id.includes(q) || r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Section title="5. Patterns" count={data.active.length + data.near_miss.length}>
      <FilterInput value={q} onChange={setQ} />
      <div style={{ fontWeight: 600, color: "#198754", marginBottom: 6, fontSize: 12 }}>Active ({active.length})</div>
      <Tbl
        cols={["id", "kind", "name", "stage effects"]}
        rows={active.map((r) => [
          <code>{r.id}</code>,
          r.kind,
          r.name,
          Object.entries(r.stage_effects ?? {}).map(([s, v]) => `${s}:${v >= 0 ? "+" : ""}${v}`).join(" "),
        ])}
      />
      <div style={{ fontWeight: 600, color: "#64748b", margin: "12px 0 6px", fontSize: 12 }}>Near-miss / inactive ({near.length})</div>
      <Tbl
        cols={["id", "kind", "name", "failed clause"]}
        rows={near.map((r) => [
          <code>{r.id}</code>,
          r.kind,
          r.name,
          <code style={{ fontSize: 10, wordBreak: "break-all" }}>{JSON.stringify(r.failed_clause).slice(0, 120)}</code>,
        ])}
      />
    </Section>
  );
}

function IntelSection({ data }: { data: unknown[] }) {
  return (
    <Section title="6. Intel index" count={data.length}>
      <span style={{ color: "#64748b", fontSize: 12 }}>Available in plan 05.</span>
    </Section>
  );
}

function ObjectionsSection({ data }: { data: unknown[] }) {
  return (
    <Section title="7. Objections" count={data.length}>
      <span style={{ color: "#64748b", fontSize: 12 }}>Available in plan 06.</span>
    </Section>
  );
}

function ActionCardsSection({ data }: { data: unknown[] }) {
  return (
    <Section title="8. Action cards" count={data.length}>
      <span style={{ color: "#64748b", fontSize: 12 }}>Available in plan 06.</span>
    </Section>
  );
}

function OpLogSection({ data }: { data: OpLogRow[] }) {
  const [q, setQ] = useState("");
  const rows = data.filter((r) => !q || r.target.includes(q) || r.kind.includes(q) || (r.source_id ?? "").includes(q));
  return (
    <Section title="9. Op log" count={rows.length}>
      <FilterInput value={q} onChange={setQ} />
      <Tbl
        cols={["seq", "kind", "target", "value", "source kind", "source id"]}
        rows={rows.map((r) => [
          String(r.seq),
          r.kind,
          <code>{r.target}</code>,
          <code style={{ fontSize: 11 }}>{JSON.stringify(r.value)}</code>,
          r.source_kind,
          r.source_id ? <code style={{ fontSize: 11 }}>{r.source_id}</code> : null,
        ])}
      />
    </Section>
  );
}

function ChallengesSection({ data }: { data: GraphDebugPayload["challenges"] }) {
  const [q, setQ] = useState("");
  const elig = data.eligible_now.filter((r) => !q || r.template_id.includes(q));
  const rej = data.rejected.filter((r) => !q || r.template_id.includes(q));
  return (
    <Section title="10. Challenge selection" count={data.played.length + elig.length + rej.length}>
      <FilterInput value={q} onChange={setQ} />
      <div style={{ fontWeight: 600, color: "#94a3b8", fontSize: 12, marginBottom: 4 }}>Played ({data.played.length})</div>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 10, fontFamily: "monospace" }}>
        {data.played.length ? data.played.join(", ") : "none"}
      </div>
      <div style={{ fontWeight: 600, color: "#198754", fontSize: 12, marginBottom: 4 }}>Eligible now ({elig.length})</div>
      <Tbl
        cols={["template_id", "phase", "fallback", "priority"]}
        rows={elig.map((r) => [
          <code>{r.template_id}</code>,
          String(r.phase_id),
          r.fallback ? "✓" : "",
          r.priority != null ? String(r.priority) : "",
        ])}
      />
      <div style={{ fontWeight: 600, color: "#dc3545", fontSize: 12, margin: "10px 0 4px" }}>Rejected ({rej.length})</div>
      <Tbl
        cols={["template_id", "phase", "failed clause"]}
        rows={rej.map((r) => [
          <code>{r.template_id}</code>,
          String(r.phase_id),
          <code style={{ fontSize: 10, wordBreak: "break-all" }}>{JSON.stringify(r.failed_clause).slice(0, 200)}</code>,
        ])}
      />
    </Section>
  );
}

function OrphansSection({ data }: { data: OrphanSection }) {
  const [q, setQ] = useState("");
  const noPattern = data.targets_in_no_pattern.filter((t) => !q || t.includes(q));
  return (
    <Section title="11. Orphans" count={data.targets_in_no_pattern.length}>
      <FilterInput value={q} onChange={setQ} />
      <div style={{ fontWeight: 600, color: "#ffc107", fontSize: 12, marginBottom: 4 }}>Targets in no pattern ({noPattern.length})</div>
      <div style={{ fontFamily: "monospace", fontSize: 11, color: "#94a3b8", lineHeight: 1.8 }}>
        {noPattern.map((t) => <span key={t} style={{ marginRight: 8 }}>{t}</span>)}
        {!noPattern.length && <span style={{ color: "#64748b" }}>none</span>}
      </div>
      {(data.targets_never_in_a_driver.length > 0 || data.levels_without_story_fragment.length > 0) && (
        <div style={{ marginTop: 10, color: "#64748b", fontSize: 12 }}>
          Driver orphans and fragment gaps available after plan 05.
        </div>
      )}
    </Section>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface GraphDebugProps {
  adminToken: string;
  campaigns: Campaign[];
  players: Player[];
}

export function GraphDebug({ campaigns, players }: GraphDebugProps) {
  const [email, setEmail] = useState("");
  const [data, setData] = useState<GraphDebugPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Every campaign's own user list, plus anyone the dashboard knows about who isn't in any
  // campaign (no campaign_key match) - so the dropdown never silently hides a player.
  const groups = useMemo(() => {
    const grouped = campaigns.map((c) => ({ label: c.name, users: [...c.users].sort() }));
    const known = new Set(campaigns.flatMap((c) => c.users));
    const orphaned = players.map((p) => p.name).filter((n) => !known.has(n)).sort();
    return orphaned.length > 0 ? [...grouped, { label: "No campaign", users: orphaned }] : grouped;
  }, [campaigns, players]);

  async function load(name: string) {
    setEmail(name);
    if (!name) {
      setData(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setData(await fetchGraphDebug(name));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ color: "#e2e8f0", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "center" }}>
        <select
          value={email}
          onChange={(e) => load(e.target.value)}
          style={{
            background: "#1e293b", border: "1px solid #334155", color: "#e2e8f0",
            borderRadius: 6, padding: "6px 12px", fontSize: 13, flex: 1,
          }}
        >
          <option value="">
            {groups.length === 0 ? "No active players" : "Select a player…"}
          </option>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.users.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {loading && <span style={{ fontSize: 13, color: "#64748b" }}>Loading…</span>}
      </div>
      {error && <div style={{ color: "#dc3545", marginBottom: 12, fontSize: 13 }}>{error}</div>}
      {data && (
        <>
          <div style={{ color: "#64748b", fontSize: 12, marginBottom: 16 }}>
            Player: <strong style={{ color: "#94a3b8" }}>{data.email}</strong>
          </div>
          <StagesSection data={data.stages} />
          <ComponentsSection data={data.components} />
          <EdgesSection data={data.edges} />
          <InstancesSection data={data.instances} />
          <PatternsSection data={data.patterns} />
          <IntelSection data={data.intel_index} />
          <ObjectionsSection data={data.objections} />
          <ActionCardsSection data={data.action_cards} />
          <OpLogSection data={data.op_log} />
          <ChallengesSection data={data.challenges} />
          <OrphansSection data={data.orphans} />
        </>
      )}
    </div>
  );
}
