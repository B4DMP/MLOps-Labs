import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import HoverTooltip from "../HoverToolTip";
import { AXIS_TITLES, axisMeta, formatAxisLevel, type Axis } from "../../utils/stageCanvas";
import { ceilingOn, nominalOn, projectedOn, type OptionTarget } from "../../utils/graphOptions";
import type { AtomicChange } from "../../types/ActionCard";
import ComposeTagDetail, { tagText, type TagLine } from "./ComposeTagDetail";
import { AXIS_HINTS, AXIS_ICONS, GOVERNANCE_INK } from "./axisCopy";
import styles from "./ComposeSidebar.module.css";

/** Three pips for one axis, in that axis's own colours: built, planned in the proposal, above the ceiling. */
export function AxisPipRow({ axis, level, projected, ceiling }: { axis: Axis; level: number; projected: number; ceiling: number }) {
  return (
    <span className={styles.pips} aria-hidden>
      {[1, 2, 3].map((r) => {
        const above = r > ceiling;
        const built = axis === "automation" && level === 0 ? r === 1 : r <= level;
        const planned = !built && r <= projected;
        return (
          <span
            key={r}
            className={`${styles.pip} ${above ? styles.pipAbove : ""} ${planned ? styles.pipPlanned : ""}`}
            style={built ? { background: axisMeta(axis, level === 0 ? 0 : r).color, borderColor: "transparent" } : undefined}
          />
        );
      })}
    </span>
  );
}

/** A tooltip-carrying chip. The words live in the tooltip, as on the dossier's stat badges. */
export function Chip({
  label,
  lines,
  className = "",
  children,
}: {
  label: string;
  lines?: TagLine[];
  className?: string;
  children: ReactNode;
}) {
  return (
    <HoverTooltip description={<ComposeTagDetail label={label} lines={lines} />}>
      <span className={`${styles.chip} ${className}`} tabIndex={0} aria-label={tagText(label, lines)}>
        {children}
      </span>
    </HoverTooltip>
  );
}

/** Where one axis of the target stands now: icon plus three pips. */
export function AxisChip({
  axis,
  kind,
  target,
  changes,
}: {
  axis: Axis;
  kind: "component" | "edge";
  target: OptionTarget;
  changes: AtomicChange[];
}) {
  const nominal = nominalOn(target, axis);
  const projected = projectedOn(target, axis, changes);
  const ceiling = ceilingOn(target, axis);
  const now = axisMeta(axis, nominal);
  const lines: TagLine[] = [
    AXIS_HINTS[kind][axis],
    <>
      Current: <b>{now.label}</b>
    </>,
  ];
  if (projected !== nominal) {
    lines.push(
      <>
        Your proposal takes it to <b>{formatAxisLevel(axis, projected)}</b>.
      </>
    );
  }
  return (
    <Chip label={`${AXIS_TITLES[axis]}: ${now.label}`} lines={lines}>
      <Icon icon={AXIS_ICONS[axis]} style={axis === "governance" ? { color: GOVERNANCE_INK } : undefined} aria-hidden />
      <AxisPipRow axis={axis} level={nominal} projected={projected} ceiling={ceiling} />
    </Chip>
  );
}

export type DependencyState =
  | { kind: "ok"; levelLabel: string }
  | { kind: "held"; byId: string; byName: string; capLabel: string }
  | { kind: "uncertain"; nodes: Array<{ id: string; name: string }> };

/** Whether anything upstream holds the component back. Only the unhealthy states say more. */
export function DependencyChip({ state, onJump }: { state: DependencyState; onJump: (id: string) => void }) {
  if (state.kind === "ok") {
    return (
      <Chip
        label="Unblocked"
        lines={[
          <>
            Nothing upstream is holding this back, so it runs at <b>{state.levelLabel}</b>.
          </>,
        ]}
        className={styles.chipOk}
      >
        <Icon icon="ph:check-circle-bold" aria-hidden />
        <span className={styles.chipLabel}>Unblocked</span>
      </Chip>
    );
  }

  const heldBy = state.kind === "held" ? state.byName : state.nodes.map((n) => n.name).join(", ");
  const jumpId = state.kind === "held" ? state.byId : state.nodes[0]?.id;
  const label = state.kind === "held" ? `Held back by ${heldBy}` : `Upstream unknown: ${heldBy}`;
  const lines: TagLine[] =
    state.kind === "held"
      ? [
          <>
            Capped at <b>{state.capLabel}</b> by {heldBy}. Automating it further changes nothing until that bottleneck is
            dealt with. Governance steps are not affected.
          </>,
          "Click to jump to it.",
        ]
      : [
          "An upstream dependency is still undiscovered, so this component's real status is unknown.",
          "Click to jump to it.",
        ];
  return (
    <HoverTooltip description={<ComposeTagDetail label={label} lines={lines} />} ariaText={tagText(label, lines)}>
      <button
        type="button"
        className={`${styles.chip} ${styles.chipWarn}`}
        onClick={() => jumpId && onJump(jumpId)}
        aria-label={tagText(label, lines)}
      >
        <Icon icon={state.kind === "held" ? "ph:link-break-bold" : "ph:question-bold"} aria-hidden />
        <span className={styles.chipLabel}>{label}</span>
      </button>
    </HoverTooltip>
  );
}

/** The chip row under the inspector title. */
export function ChipRow({ children }: { children: ReactNode }) {
  return <div className={styles.chips}>{children}</div>;
}
