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
  /** Hand the Pen: who drafted this slot themselves, if anyone. Their slot is locked: it opens in
   *  the inspector like any other but has no Remove. */
  delegatedToName?: string | null;
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
  const emptyCount = Math.max(0, max - entries.length);
  return (
    <div className={styles.tickets}>
      {entries.map((entry, idx) => (
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
                  entry.delegatedToName
                    ? `${entry.delegatedToName} drafted this. It is locked in. Click to open it in the inspector`
                    : "Click to open it in the inspector",
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
              {entry.delegatedToName && (
                <span className={styles.ticketStep}> · {entry.delegatedToName}&apos;s draft</span>
              )}
            </span>
          </button>
          {entry.marks.map((m) => (
            <HoverTooltip key={m.key} description={<ComposeTagDetail label={m.label} lines={[m.detail]} />}>
              <span className={`${styles.noteMark} ${styles.markBoard}`}>
                <Icon icon={m.icon} />
              </span>
            </HoverTooltip>
          ))}
          {entry.delegatedToName ? (
            <span className={styles.ticketLock} role="img" aria-label={`Locked in by ${entry.delegatedToName}`}>
              <Icon icon="ph:lock-key-bold" />
            </span>
          ) : (
            <HoverTooltip
              description={<ComposeTagDetail label="Remove change" lines={["Frees this slot for a different change"]} />}
              ariaText="Remove change"
              labelsChild
            >
              <button type="button" className={styles.ticketRemove} onClick={() => onRemove(idx)}>
                <Icon icon="ph:x-bold" />
              </button>
            </HoverTooltip>
          )}
        </div>
      ))}
      {Array.from({ length: emptyCount }, (_, i) => (
        <div key={`empty-${i}`} className={`${styles.ticket} ${styles.ticketEmpty}`}>
          <Icon icon="ph:plus-dashed-bold" />
          <span>Slot {entries.length + i + 1}</span>
        </div>
      ))}
    </div>
  );
}
