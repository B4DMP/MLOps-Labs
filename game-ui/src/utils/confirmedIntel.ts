/** One line of the Challenge-Intel summary table: what a stakeholder wants, built from confirmed notes only. */
export interface ConfirmedIntelSource {
  id: string;
  intel_type: string;
  categorized_type: string;
  description: string;
  source?: string;
  chain_id?: string;
  chain_position?: number;
  stage_id?: string | null;
  /** The graph component or hand-over the note is about. */
  target?: string | null;
  status?: string;
  branch_x?: { description: string } | null;
  branch_y?: { description: string } | null;
}

export interface ConfirmedIntelRow {
  id: string;
  stakeholderId: string;
  stakeholderName: string;
  kind: "driver" | "boundary" | "trade_off";
  /** The note reworded without the stakeholder's name, e.g. "faster retraining". */
  text: string;
  /** Second half of a trade-off: what they'd accept in return. */
  giveUp?: string;
  stageId?: string | null;
  target?: string | null;
  onRecord: boolean;
  resolved: boolean;
  /** "addressed" or "stale" when resolved. */
  status?: string;
}

const KINDS = new Set(["driver", "boundary", "trade_off"]);

const lowerFirst = (s: string) => s.replace(/^./, (c) => c.toLowerCase());
const trimStop = (s: string) => s.trim().replace(/[.!?]+$/, "");

/** Strips "<Name> wants / will not / would" so the stakeholder column carries the subject. */
export function stripSubject(description: string, name: string): string {
  let t = description.trim();
  if (name && t.startsWith(name)) t = t.slice(name.length);
  t = t.replace(/^[’']s\s+/, "").replace(/^\s*(?:really\s+|only\s+)?(?:wants?|needs?|would like|asks for)\s+/i, "");
  return lowerFirst(trimStop(t));
}

/** Newest confirmed link of each chain, per stakeholder. Unconfirmed notes never appear. */
export function confirmedIntelRows(
  pages: ReadonlyArray<{
    stakeholder_id: string;
    name: string;
    is_challenge_intel?: boolean;
    intel_items: ReadonlyArray<ConfirmedIntelSource>;
  }>,
): ConfirmedIntelRow[] {
  const rows: ConfirmedIntelRow[] = [];
  for (const page of pages) {
    if (page.is_challenge_intel) continue;
    const newest = new Map<string, ConfirmedIntelSource>();
    for (const item of page.intel_items || []) {
      const key = item.chain_id || item.id;
      const prev = newest.get(key);
      if (!prev || (item.chain_position ?? 0) >= (prev.chain_position ?? 0)) newest.set(key, item);
    }
    for (const item of newest.values()) {
      if ((item.intel_type || "").toLowerCase() !== "verified" || !KINDS.has(item.categorized_type)) continue;
      const kind = item.categorized_type as ConfirmedIntelRow["kind"];
      const hasBranches = kind === "trade_off" && item.branch_x?.description && item.branch_y?.description;
      rows.push({
        id: item.id,
        stakeholderId: page.stakeholder_id,
        stakeholderName: page.name,
        kind,
        text: hasBranches
          ? lowerFirst(trimStop(item.branch_x!.description))
          : stripSubject(item.description || "", page.name),
        giveUp: hasBranches ? lowerFirst(trimStop(item.branch_y!.description)) : undefined,
        stageId: item.stage_id,
        target: item.target,
        onRecord: (item.source || "").toLowerCase() === "public_record",
        resolved: item.status === "addressed" || item.status === "stale",
        status: item.status,
      });
    }
  }
  // Open rows first; stable otherwise, so each stakeholder keeps their page order.
  return rows.sort((a, b) => Number(a.resolved) - Number(b.resolved));
}
