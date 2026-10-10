import { Icon } from "@iconify/react";
import HoverTooltip from "../HoverToolTip";
import type { Axis } from "../../utils/stageCanvas";
import ComposeTagDetail from "./ComposeTagDetail";
import { AXIS_ICONS, GOVERNANCE_INK } from "./axisCopy";
import type { TipBinder } from "./OptionLadder";
import type { NoteBoardMark } from "./IntelNoteRows";
import styles from "./ComposeSidebar.module.css";

/** One slotted change, already resolved to words by the composer. */
export interface ProposalEntry {
  displayName: string;
  title: string;
  detail: string;
  axis?: Axis;
  isEdge: boolean;
  marks: NoteBoardMark[];
  /** Hand the Pen: who drafts this slot themselves, if anyone. Sealed (no detail, no Remove)
   *  until the pitch reveals it. */
  delegatedToName?: string | null;
}

/**
 * The proposal as a short stack of one-line tickets, one per slot. Empty slots are dashed lines.
 * A ticket opens its target in the inspector; the cross keeps the tooltip the old Remove button had.
 */
/** A component reserved for Hand the Pen but not yet revealed - not a real slotted change (it
 *  isn't in `atomicChanges` yet), so it has no index to open or remove, just a sealed marker. */
export interface ReservedEntry {
  displayName: string;
  holderName: string;
}

export default function ProposalTickets({
  entries,
  max,
  reserved,
  onOpen,
  onRemove,
  bindTip,
}: {
  entries: ProposalEntry[];
  max: number;
  /** One component held for Hand the Pen, sealed until the pitch reveals it. Occupies a slot in
   *  the count but renders after the real entries, before the empty dashes. */
  reserved?: ReservedEntry | null;
  onOpen: (index: number) => void;
  onRemove: (index: number) => void;
  bindTip: TipBinder;
}) {
  const emptyCount = Math.max(0, max - entries.length - (reserved ? 1 : 0));
  return (
    <div className={styles.tickets}>
      {entries.map((entry, idx) => {
        if (entry.delegatedToName) {
          return (
            <div key={idx} className={styles.ticket}>
              <button
                type="button"
                className={styles.ticketMain}
                onClick={() => onOpen(idx)}
                {...bindTip(
                  <ComposeTagDetail
                    label={entry.displayName}
                    lines={[`${entry.delegatedToName} drafts this one`, "Sealed until you pitch - click to open it in the inspector"]}
                  />
                )}
              >
                <span className={styles.ticketIndex}>{idx + 1}</span>
                <Icon icon="ph:seal-bold" className={styles.ticketAxis} />
                <span className={styles.ticketText}>
                  <b>{entry.displayName}</b>{" "}
                  <span className={styles.ticketStep}>· {entry.delegatedToName} drafts this one</span>
                </span>
              </button>
            </div>
          );
        }
        return (
          <div key={idx} className={styles.ticket}>
            <button
              type="button"
              className={styles.ticketMain}
              onClick={() => onOpen(idx)}
              {...bindTip(
                <ComposeTagDetail
                  label={entry.displayName}
                  lines={[
                    entry.title === entry.detail ? entry.title : `${entry.title} - ${entry.detail}`,
                    "Click to open it in the inspector",
                  ]}
                />
              )}
            >
              <span className={styles.ticketIndex}>{idx + 1}</span>
              <Icon
                icon={entry.axis ? AXIS_ICONS[entry.axis] : "ph:flow-arrow-bold"}
                className={styles.ticketAxis}
                style={{ color: entry.axis === "governance" ? GOVERNANCE_INK : "var(--accent)" }}
              />
              <span className={styles.ticketText}>
                <b>{entry.displayName}</b> <span className={styles.ticketStep}>· {entry.title}</span>
              </span>
            </button>
            {entry.marks.map((m) => (
              <HoverTooltip key={m.key} description={<ComposeTagDetail label={m.label} lines={[m.detail]} />}>
                <span className={`${styles.noteMark} ${styles.markBoard}`}>
                  <Icon icon={m.icon} />
                </span>
              </HoverTooltip>
            ))}
            <HoverTooltip
              description={<ComposeTagDetail label="Remove change" lines={["Frees this slot for a different change"]} />}
              ariaText="Remove change"
              labelsChild
            >
              <button type="button" className={styles.ticketRemove} onClick={() => onRemove(idx)}>
                <Icon icon="ph:x-bold" />
              </button>
            </HoverTooltip>
          </div>
        );
      })}
      {reserved && (
        <div key="reserved" className={styles.ticket}>
          <div
            className={styles.ticketMain}
            {...bindTip(
              <ComposeTagDetail
                label={reserved.displayName}
                lines={[`${reserved.holderName} drafts this one`, "Sealed until you pitch - it cannot be undone"]}
              />
            )}
          >
            <span className={styles.ticketIndex}>
              <Icon icon="ph:lock-key-bold" />
            </span>
            <Icon icon="ph:seal-bold" className={styles.ticketAxis} />
            <span className={styles.ticketText}>
              <b>{reserved.displayName}</b>{" "}
              <span className={styles.ticketStep}>· {reserved.holderName} drafts this one</span>
            </span>
          </div>
        </div>
      )}
      {Array.from({ length: emptyCount }, (_, i) => (
        <div key={`empty-${i}`} className={`${styles.ticket} ${styles.ticketEmpty}`}>
          <Icon icon="ph:plus-dashed-bold" />
          <span>Slot {entries.length + (reserved ? 1 : 0) + i + 1}</span>
        </div>
      ))}
    </div>
  );
}
