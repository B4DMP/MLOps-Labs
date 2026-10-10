import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import HoverTooltip, { type useTooltipController } from "../HoverToolTip";
import {
  AXIS_TITLES,
  axisMeta,
  formatAxisLevel,
  formatTrigger,
  TRIGGER_ICONS,
  type Axis,
} from "../../utils/stageCanvas";
import {
  ceilingOn,
  isImplemented,
  nominalOn,
  optionDisplayName,
  optionStatus,
  optionsOn,
  type GraphOption,
  type OptionStatus,
  type OptionTarget,
} from "../../utils/graphOptions";
import type { AtomicChange } from "../../types/ActionCard";
import ComposeTagDetail, { type TagLine } from "./ComposeTagDetail";
import { AXIS_HINTS, AXIS_ICONS } from "./axisCopy";
import styles from "./ComposeSidebar.module.css";

/** Spreads a tooltip onto an element a `HoverTooltip` wrapper would break (flex rows, SVG). */
export type TipBinder = ReturnType<typeof useTooltipController>["bind"];

const STATUS_NOTE: Record<OptionStatus, string | undefined> = {
  done: "Already in place.",
  slotted: "In your proposal.",
  next: undefined,
  later: "Needs the step above it first.",
};

/**
 * One axis of one target, as the ladder of authored options that climbs it. Every option is a
 * single ready-made step: the player adds the next one by name and sees the ones already in
 * place, the ones in the proposal and the ones that need a step below them first. A rail runs
 * through the rungs. Each row is one line; the step's description is in its tooltip.
 */
export default function OptionLadder({
  axis,
  target,
  kind,
  changes,
  slotsFull,
  maxSlots,
  onAdd,
  onRemove,
  bindTip,
}: {
  axis: Axis;
  target: OptionTarget;
  kind: "component" | "edge";
  changes: AtomicChange[];
  slotsFull: boolean;
  maxSlots: number;
  onAdd: (option: GraphOption) => void;
  onRemove: (option: GraphOption) => void;
  bindTip: TipBinder;
}) {
  const nominal = nominalOn(target, axis);
  const ceiling = ceilingOn(target, axis);
  const options = optionsOn(target, axis);
  // Nothing to review on a target nobody has implemented yet.
  const governanceLocked = axis === "governance" && !isImplemented(target, changes);
  const title = AXIS_TITLES[axis];

  const helpLines: TagLine[] = [AXIS_HINTS[kind][axis]];
  if (governanceLocked) helpLines.push("Nothing to review until it's implemented.");

  let body: ReactNode;
  if (governanceLocked) {
    body = (
      <div
        className={styles.locked}
        {...bindTip(
          <ComposeTagDetail
            label="Locked for now"
            lines={["Implement It Manually on automation first. You can't govern something that doesn't exist yet."]}
          />
        )}
      >
        <Icon icon="ph:lock-simple-bold" />
        <span>Unlocks once it's implemented</span>
      </div>
    );
  } else if (options.length === 0) {
    body = (
      <div className={styles.locked}>
        {nominal >= ceiling
          ? `${formatAxisLevel(axis, ceiling)} is as far as this goes on ${title.toLowerCase()}.`
          : `No ${title.toLowerCase()} step is on offer here.`}
      </div>
    );
  } else {
    body = (
      <div className={styles.ladder} role="list">
        {options.map((option, index) => {
          const status = optionStatus(target, axis, option, changes);
          const rung = axisMeta(axis, option.to_level);
          const name = optionDisplayName(target, axis, option);
          const showDescription = option.description && option.description.trim() !== option.name.trim();
          const lines: TagLine[] = [
            showDescription ? option.description : undefined,
            <>
              Lands on: <b>{rung.label}</b>
            </>,
            option.trigger ? (
              <>
                Starts when: <b>{formatTrigger(option.trigger)}</b>
              </>
            ) : undefined,
            STATUS_NOTE[status],
          ];
          const statusClass =
            status === "next" ? styles.rungNext : status === "slotted" ? styles.rungSlotted : status === "done" ? styles.rungDone : styles.rungLater;
          return (
            <div
              key={`${axis}-${option.to_level}`}
              role="listitem"
              data-coach-option={`${axis}-${option.to_level}`}
              className={`${styles.rung} ${statusClass}`}
              style={{ ["--rung" as string]: rung.color, ["--rung-ink" as string]: rung.ink }}
            >
              <div className={styles.rungInfo} tabIndex={0} {...bindTip(<ComposeTagDetail label={name} lines={lines} />)}>
                <span className={styles.dot}>
                  {status === "next" ? (
                    <span className={styles.dotNumber}>{index + 1}</span>
                  ) : (
                    <Icon
                      icon={status === "done" ? "ph:check-bold" : status === "slotted" ? "ph:hammer-duotone" : "ph:lock-simple-bold"}
                      aria-hidden
                    />
                  )}
                </span>
                <span className={styles.rungName}>{name}</span>
                {status !== "done" && (
                  <span className={styles.rungTag}>
                    {option.trigger ? `${TRIGGER_ICONS[option.trigger] ?? ""} ` : ""}
                    {rung.label}
                  </span>
                )}
              </div>
              <div className={styles.rungAction}>
                {status === "done" ? (
                  <span className={styles.stamp}>IN PLACE</span>
                ) : status === "next" ? (
                  <HoverTooltip description={slotsFull ? `All ${maxSlots} slots are used` : "Add this step to the proposal - one slot"}>
                    <button type="button" className={styles.addBtn} disabled={slotsFull} onClick={() => onAdd(option)}>
                      <Icon icon="ph:plus-bold" />
                      <span>{slotsFull ? "Slots full" : "Add"}</span>
                    </button>
                  </HoverTooltip>
                ) : status === "slotted" ? (
                  <HoverTooltip description="Take this step (and any step after it on this axis) back out">
                    <button type="button" className={styles.removeBtn} onClick={() => onRemove(option)}>
                      <Icon icon="ph:x-bold" />
                      <span>In proposal</span>
                    </button>
                  </HoverTooltip>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={styles.section} data-coach={axis === "governance" ? "compose-governance" : undefined}>
      <div className={`${styles.sectionHead} ${axis === "governance" ? styles.sectionHeadGovernance : ""}`}>
        <Icon icon={AXIS_ICONS[axis]} />
        <span>{title}</span>
        <span className={styles.sectionRight}>
          <HoverTooltip description={<ComposeTagDetail label={title} lines={helpLines} />} ariaText={`${title}: ${helpLines.filter((l) => typeof l === "string").join(" ")}`}>
            <Icon icon="ph:question-bold" className={styles.helpMark} aria-label={`About ${title.toLowerCase()}`} />
          </HoverTooltip>
        </span>
      </div>
      {body}
    </div>
  );
}
