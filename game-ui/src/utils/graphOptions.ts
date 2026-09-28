/**
 * The curated-option model the compose screen builds cards from
 * (docs/plans/graph-governance-automation-rework/00-plan.md §2.3-§2.5).
 *
 * Every component and edge ships its own authored options per axis. An option moves its
 * target exactly one step up one axis and costs one slot; the player picks it by name, never
 * by raw level, and an edge's automation option already carries the trigger it switches to.
 *
 * Pure functions only, so the rules the composer enforces can be tested without rendering it.
 */
import type { AtomicChange } from "../types/ActionCard";
import { AXIS_TITLES, formatAxisLevel, formatTrigger, type Axis } from "./stageCanvas";

/** One authored step on one axis. `trigger` is set on edge automation options only. */
export interface GraphOption {
  to_level: number;
  trigger?: string | null;
  name: string;
  description: string;
}

/**
 * The fields of a component or an edge this module reads. Components report their rungs as
 * `nominal_automation`/`nominal_governance`, edges as `automation`/`governance`; `from_id` is
 * what tells an edge apart.
 */
export interface OptionTarget {
  id: string;
  from_id?: string;
  nominal_automation?: number;
  nominal_governance?: number;
  automation?: number;
  governance?: number;
  allowed_automation?: number[];
  allowed_governance?: number[];
  automation_options?: GraphOption[];
  governance_options?: GraphOption[];
}

export const AXES: readonly Axis[] = ["automation", "governance"];

export function isEdgeTarget(t: OptionTarget): boolean {
  return t.from_id !== undefined;
}

/** What a target is built to on one axis. Unknown falls back to automation `absent` and
 *  governance `none`, the rungs every target starts from. */
export function nominalOn(t: OptionTarget | undefined | null, axis: Axis): number {
  const fallback = axis === "automation" ? 1 : 0;
  if (!t) return fallback;
  const value = isEdgeTarget(t)
    ? axis === "automation" ? t.automation : t.governance
    : axis === "automation" ? t.nominal_automation : t.nominal_governance;
  return value ?? fallback;
}

/** The rungs this target may sit on for an axis, ascending. */
export function allowedOn(t: OptionTarget, axis: Axis): number[] {
  const allowed = axis === "automation" ? t.allowed_automation : t.allowed_governance;
  return allowed && allowed.length > 0 ? [...allowed].sort((a, b) => a - b) : [0, 1, 2, 3];
}

/** The highest rung this target allows on an axis. */
export function ceilingOn(t: OptionTarget, axis: Axis): number {
  const allowed = allowedOn(t, axis);
  return allowed[allowed.length - 1];
}

/** Automation's resting states are BROKEN and ABSENT - nothing built yet, or backend-only
 *  failure, neither a step a player takes (00-plan.md decision 5) - so authored options start
 *  at MANUAL and a target sitting at either floor rung is one step from MANUAL, not from
 *  ABSENT. Governance's only resting state is NONE, which is already its floor. */
function floorOn(axis: Axis): number {
  return axis === "automation" ? 1 : 0;
}

/** The target's authored options for an axis, lowest step first. */
export function optionsOn(t: OptionTarget, axis: Axis): GraphOption[] {
  const opts = (axis === "automation" ? t.automation_options : t.governance_options) ?? [];
  return [...opts].sort((a, b) => a.to_level - b.to_level);
}

export function isRaise(c: AtomicChange): boolean {
  return (c.kind ?? "raise_to") === "raise_to";
}

function isStepOn(c: AtomicChange, targetId: string, axis: Axis): boolean {
  return c.target === targetId && isRaise(c) && c.axis === axis && typeof c.value === "number";
}

/** The rung a target would sit on once every step already slotted on that axis lands. Steps
 *  apply in order and each lifts the rung by one, so several on one axis chain. */
export function projectedOn(t: OptionTarget, axis: Axis, changes: AtomicChange[]): number {
  return changes.reduce(
    (lvl, c) => (isStepOn(c, t.id, axis) ? Math.max(lvl, c.value as number) : lvl),
    nominalOn(t, axis),
  );
}

/** The automation rung a target must reach before it exists to be reviewed at all - there is
 *  nothing to sign off on a target nobody has implemented yet. */
const IMPLEMENTED_AT = 2; // AutomationState.MANUAL

/** Whether a target is built enough for governance to apply to it, counting whatever automation
 *  step is already slotted in the same proposal (so "implement it" and "sign off" can land in
 *  one card, implement first). */
export function isImplemented(t: OptionTarget, changes: AtomicChange[]): boolean {
  return projectedOn(t, "automation", changes) >= IMPLEMENTED_AT;
}

/**
 * The one authored step up to `IMPLEMENTED_AT` reads differently depending on where a component
 * starts: broken (it existed and stopped) is a repair, absent (it never existed) is a first
 * build - same option, same destination rung, but the player-facing name is chosen here from the
 * current state rather than fixed in content. Edge automation options already name what they do
 * (e.g. "Trigger Manually") and are left alone.
 */
export function optionDisplayName(t: OptionTarget, axis: Axis, option: GraphOption): string {
  if (axis === "automation" && !isEdgeTarget(t) && option.to_level === IMPLEMENTED_AT && nominalOn(t, axis) === 0) {
    return "Fix It";
  }
  return option.name;
}

/**
 * Where one option stands for this card:
 * - `done`: the target already sits at or above its rung.
 * - `slotted`: it is in the proposal.
 * - `next`: it is the step that can be added now - its rung is the allowed rung immediately
 *   above where the target would be after everything already slotted.
 * - `later`: it needs the step(s) below it first.
 */
export type OptionStatus = "done" | "slotted" | "next" | "later";

export function optionStatus(
  t: OptionTarget,
  axis: Axis,
  option: GraphOption,
  changes: AtomicChange[],
): OptionStatus {
  if (changes.some((c) => isStepOn(c, t.id, axis) && c.value === option.to_level)) return "slotted";
  if (option.to_level <= nominalOn(t, axis)) return "done";
  if (axis === "governance" && !isImplemented(t, changes)) return "later";
  const projected = projectedOn(t, axis, changes);
  const nextRung = allowedOn(t, axis).find((l) => l > Math.max(projected, floorOn(axis)));
  return option.to_level === nextRung ? "next" : "later";
}

/** The change a slotted option becomes. An edge automation option carries its trigger along;
 *  the player never picks one separately. */
export function changeForOption(t: OptionTarget, axis: Axis, option: GraphOption): AtomicChange {
  const change: AtomicChange = { target: t.id, kind: "raise_to", axis, value: option.to_level };
  if (option.trigger && isEdgeTarget(t) && axis === "automation") change.trigger = option.trigger;
  return change;
}

/** Adds one step, unless every slot is taken or it is not the next step on its axis. */
export function addOption(
  changes: AtomicChange[],
  t: OptionTarget,
  axis: Axis,
  option: GraphOption,
  maxChanges: number,
): AtomicChange[] {
  if (changes.length >= maxChanges) return changes;
  if (optionStatus(t, axis, option, changes) !== "next") return changes;
  return [...changes, changeForOption(t, axis, option)];
}

/**
 * Removes the change at `index`. A step on an axis also takes every later step on the same
 * target and axis with it: those were only reachable through it, and a step sent without its
 * predecessor would ask the backend for a jump the one-step rule forbids.
 */
export function removeChangeAt(changes: AtomicChange[], index: number): AtomicChange[] {
  const removed = changes[index];
  if (!removed) return changes;
  const cascade =
    isRaise(removed) && removed.axis && typeof removed.value === "number"
      ? (c: AtomicChange) =>
          isStepOn(c, removed.target, removed.axis as Axis) && (c.value as number) > (removed.value as number)
      : () => false;
  return changes.filter((c, i) => i !== index && !cascade(c));
}

/** A raise_to without an axis is silently dropped by the backend; a card left over from before
 *  the two-axis model must not show the player a slot that will do nothing. */
export function dropUnscopedChanges(changes: AtomicChange[]): AtomicChange[] {
  return changes.filter((c) => c.kind !== "set_attr" && (!isRaise(c) || c.axis === "automation" || c.axis === "governance"));
}

/** The authored option a slotted change came from, when the target is at hand. */
export function optionForChange(
  t: OptionTarget | undefined | null,
  change: AtomicChange,
): GraphOption | undefined {
  if (!t) return undefined;
  if (!isRaise(change) || !change.axis) return undefined;
  return optionsOn(t, change.axis).find((o) => o.to_level === change.value);
}

/**
 * How a slotted change reads to the player: `title` is the authored option's name when the
 * target is known, `detail` the mechanical read ("Automation → manual, started by manual
 * request"), which also stands in for the title when no option matches.
 */
export function describeAtomicChange(
  change: AtomicChange,
  t?: OptionTarget | null,
): { title: string; detail: string; axis?: Axis } {
  const option = optionForChange(t, change);
  if (change.kind === "set_trigger") {
    const detail = `Started by ${formatTrigger(change.trigger ?? change.value)}`;
    return { title: detail, detail };
  }
  if (!change.axis) {
    return { title: "Unscoped change", detail: "Names no axis - it will be ignored" };
  }
  const detail =
    `${AXIS_TITLES[change.axis]} → ${formatAxisLevel(change.axis, change.value)}` +
    (change.trigger ? `, started by ${formatTrigger(change.trigger)}` : "");
  const title = option ? (t ? optionDisplayName(t, change.axis, option) : option.name) : detail;
  return { title, detail, axis: change.axis };
}

/** Finds a component or edge anywhere in a `graph:state` payload's technical section. */
export function findGraphTarget(
  technical: Record<string, { components?: OptionTarget[]; edges?: OptionTarget[] }> | undefined | null,
  id: string,
): OptionTarget | undefined {
  if (!technical) return undefined;
  for (const stage of Object.values(technical)) {
    const hit =
      (stage.components || []).find((c) => c.id === id) ?? (stage.edges || []).find((e) => e.id === id);
    if (hit) return hit;
  }
  return undefined;
}
