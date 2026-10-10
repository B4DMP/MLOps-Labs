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
}

/**
 * The proposal as a short stack of one-line tickets, one per slot. Empty slots are dashed lines.
 * A ticket opens its target in the inspector; the cross keeps the tooltip the old Remove button had.
 */
export default function ProposalTickets({
  entries,
  max,
  onOpen,
  onRemove,
  bindTip,
}: {
  entries: ProposalEntry[];
  max: number;
  onOpen: (index: number) => void;
  onRemove: (index: number) => void;
  bindTip: TipBinder;
}) {
  return (
    <div className={styles.tickets}>
      {Array.from({ length: max }, (_, idx) => {
        const entry = entries[idx];
        if (!entry) {
          return (
            <div key={idx} className={`${styles.ticket} ${styles.ticketEmpty}`}>
              <Icon icon="ph:plus-dashed-bold" />
              <span>Slot {idx + 1}</span>
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
    </div>
  );
}
