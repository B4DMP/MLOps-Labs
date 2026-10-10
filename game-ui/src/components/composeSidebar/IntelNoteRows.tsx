import { Icon } from "@iconify/react";
import HoverTooltip from "../HoverToolTip";
import StakeholderAvatarComponent from "../StakeholderAvatarComponent";
import type { Stakeholder } from "../StakeholderProvider";
import type { IntelEntry } from "../StakeholderDossier";
import { CHALLENGE_INTEL_META, intelTagMeta } from "../../types/IntelTag";
import { stripSubject } from "../../utils/confirmedIntel";
import ComposeTagDetail from "./ComposeTagDetail";
import styles from "./ComposeSidebar.module.css";

/** One dossier note, carrying who it belongs to so clicking it can jump the dossier there. */
export interface LinkedNote {
  item: IntelEntry;
  stakeholderName: string;
  stakeholderId?: string;
}

const NOTE_SOURCE_META: Record<string, { icon: string; label: string }> = {
  public_record: { icon: "ph:megaphone-duotone", label: "Said openly in the team channel" },
  interview: { icon: "ph:chats-circle-bold", label: "They told you this directly" },
  debate: { icon: "ph:microphone-stage-bold", label: "Came out during the pitch" },
  offline_artifact: { icon: "ph:file-text-bold", label: "You read this in a document" },
};

export function noteSourceMeta(item: IntelEntry) {
  return NOTE_SOURCE_META[(item.source || "offline_artifact").toLowerCase()] ?? NOTE_SOURCE_META.offline_artifact;
}

const KINDS = new Set(["driver", "boundary", "trade_off"]);

/** A board relation a note takes part in: shown as a small icon in the mark column. */
export interface NoteBoardMark {
  key: string;
  icon: string;
  label: string;
  detail: string;
}

interface Props {
  notes: LinkedNote[];
  stakeholders: Record<string, Stakeholder>;
  getStakeholderColor?: (st: any) => string;
  litIntelIds: ReadonlyMap<string, string>;
  onLitIntel?: (intelId: string | null) => void;
  onSelectIntel?: (intelId: string, stakeholderId?: string) => void;
  boardMarksFor: (note: LinkedNote) => NoteBoardMark[];
}

/**
 * Notes filed against the selected target, one line each, laid out like the case board's compact
 * ledger: who, what kind, the note, a mark. The rest of a long note unrolls on hover.
 *
 * The kind icon is shown only for confirmed notes. An unconfirmed note carries the player's own
 * tag, which may be wrong, and echoing it here would present a guess as established.
 */
export default function IntelNoteRows({
  notes,
  stakeholders,
  getStakeholderColor,
  litIntelIds,
  onLitIntel,
  onSelectIntel,
  boardMarksFor,
}: Props) {
  return (
    <div className={styles.notes} role="list">
      {notes.map((note) => {
        const { item } = note;
        const verified = (item.intel_type || "").toLowerCase() === "verified";
        const isFact = item.categorized_type === "fact";
        const onRecord = verified && (item.source || "").toLowerCase() === "public_record";
        const resolved = item.status === "addressed" || item.status === "stale";
        const lit = litIntelIds.has(item.id);
        const text = stripSubject(item.fact || item.description || "", note.stakeholderName) || item.description;
        const source = noteSourceMeta(item);
        const st = note.stakeholderId ? stakeholders[note.stakeholderId] : undefined;
        const color = st && getStakeholderColor ? getStakeholderColor(st) : undefined;
        const kindMeta = isFact ? CHALLENGE_INTEL_META : verified && KINDS.has(item.categorized_type) ? intelTagMeta(item.categorized_type) : null;
        const clickable = Boolean(onSelectIntel);
        const marks = boardMarksFor(note);

        return (
          <div
            key={item.id}
            role="listitem"
            className={`${styles.note} ${clickable ? styles.noteClickable : ""} ${lit ? styles.noteLit : ""} ${resolved ? styles.noteDone : ""}`}
            style={lit ? { ["--lit" as string]: litIntelIds.get(item.id) } : undefined}
            data-intel-note={item.id}
            tabIndex={clickable ? 0 : undefined}
            onMouseEnter={() => onLitIntel?.(item.id)}
            onMouseLeave={() => onLitIntel?.(null)}
            onFocus={() => onLitIntel?.(item.id)}
            onBlur={() => onLitIntel?.(null)}
            onClick={() => onSelectIntel?.(item.id, note.stakeholderId)}
            onKeyDown={(e) => {
              if (clickable && e.key === "Enter" && e.target === e.currentTarget) onSelectIntel?.(item.id, note.stakeholderId);
            }}
            aria-label={`${note.stakeholderName}: ${text}${clickable ? ". Jump to it in your dossier." : ""}`}
          >
            <HoverTooltip description={note.stakeholderName}>
              <span className={styles.noteWho}>
                {st ? (
                  <StakeholderAvatarComponent
                    avatar={st.avatar}
                    stakeholderColor={color}
                    stakeholderId={note.stakeholderId}
                    isFramed={false}
                    play_blink_animation={false}
                    size="20px"
                    thumb
                  />
                ) : (
                  <Icon icon={CHALLENGE_INTEL_META.icon} style={{ color: CHALLENGE_INTEL_META.color, fontSize: "1.2em" }} />
                )}
              </span>
            </HoverTooltip>

            <HoverTooltip
              description={
                <ComposeTagDetail
                  label={kindMeta ? kindMeta.label : "Kind not confirmed"}
                  lines={[kindMeta ? kindMeta.description : "Confirm this note to find out what kind it is."]}
                />
              }
            >
              <span className={styles.noteKind} style={{ color: kindMeta ? kindMeta.color : "var(--ink-mute)" }}>
                <Icon icon={kindMeta ? kindMeta.icon : "ph:question-bold"} />
              </span>
            </HoverTooltip>

            <span className={styles.noteText}>
              <span className={styles.noteLine}>{text}</span>
              <span className={styles.peek} aria-hidden="true" inert>
                {text}
              </span>
            </span>

            <span className={styles.noteMarks}>
              {marks.map((m) => (
                <HoverTooltip key={m.key} description={<ComposeTagDetail label={m.label} lines={[m.detail]} />}>
                  <span className={`${styles.noteMark} ${styles.markBoard}`}>
                    <Icon icon={m.icon} />
                  </span>
                </HoverTooltip>
              ))}
              <HoverTooltip
                description={
                  <ComposeTagDetail
                    label={onRecord ? "On Record" : verified ? "Confirmed" : source.label}
                    lines={[
                      onRecord
                        ? "They said this openly, in a channel the whole team reads, before you started digging."
                        : verified
                        ? "You verified this yourself by talking to them."
                        : "Nobody has confirmed this yet.",
                      resolved ? "The system has since moved past it." : undefined,
                    ]}
                  />
                }
              >
                <span className={`${styles.noteMark} ${onRecord ? styles.markOnRecord : verified ? styles.markConfirmed : styles.markSource}`}>
                  <Icon icon={onRecord ? "ph:star-fill" : verified ? "ph:certificate-duotone" : source.icon} />
                </span>
              </HoverTooltip>
            </span>
            {clickable && <Icon icon="ph:arrow-bend-up-left-bold" className={styles.noteGo} />}
          </div>
        );
      })}
    </div>
  );
}
