import { Icon } from "@iconify/react";
import { confirmedIntelRows } from "../utils/confirmedIntel";
import { faceForEmotionState } from "../utils/emotionFace";
import { intelTagMeta } from "../types/IntelTag";
import GlossaryText from "./glossary/GlossaryText";
import HoverTooltip from "./HoverToolTip";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import type { SummaryContext } from "./CaseBoard";
import type { StakeholderDossierEntry } from "./StakeholderDossier";
import type { Stakeholder } from "./StakeholderProvider";
import type { GraphTargets } from "./useGraphTargets";
import styles from "./ConfirmedSummary.module.css";

/** How a note that has been dealt with ("addressed", "stale") is stamped: its words and its badge class. */
export interface StatusStamp {
  label: string;
  title: string;
  className: string;
}

export interface ConfirmedSummaryProps {
  /** The dossier's pages; only the confirmed notes on them are listed. */
  pages: ReadonlyArray<StakeholderDossierEntry>;
  stakeholders: Record<string, Stakeholder>;
  colorOf: (page?: StakeholderDossierEntry) => string;
  statusStamp: (status?: string) => StatusStamp | undefined;
  /** Opens a stakeholder's dossier page. */
  onOpenStakeholder: (stakeholderId: string, intelId?: string) => void;
  /** The dossier's hover tag, for the stamp in the last column. */
  onShowInfo: (e: React.SyntheticEvent, label: string, detail?: string) => void;
  onHideInfo: () => void;
  /** Names and icons of the graph steps notes are about (the board's step column). */
  graphTargets?: GraphTargets;
  /**
   * Present on the case board, where the table is compact and gains a step column, a pencil box per
   * note and two-way highlighting with the board. Absent on the Challenge-Intel page.
   */
  board?: SummaryContext;
}

/** Ledger of what each stakeholder is known to want. Confirmed notes only, so it shows nothing the pages don't. */
export default function ConfirmedSummary({
  pages, stakeholders, colorOf, statusStamp, onOpenStakeholder, onShowInfo, onHideInfo, graphTargets = {}, board,
}: ConfirmedSummaryProps) {
  const onlyIds = board?.onlyIds;
  const onBoard = Boolean(board);
  const everything = confirmedIntelRows(pages);
  const rows = onlyIds ? everything.filter((r) => onlyIds.has(r.id)) : everything;
  const openCount = rows.filter((r) => !r.resolved).length;
  const tour = onBoard ? {} : {
    "data-intro-group": "introDossier",
    "data-title": "What They Want",
    "data-intro": "This is your overview: every stakeholder want you have <mark>confirmed</mark> so far, one row each. Hover the icon to see whether it is something they want, a line they won't cross, or a trade they'd accept. Guesses you haven't confirmed never show up here, so it grows as you dig. Click a row to jump to that stakeholder's page.",
    "data-step": "4",
  };
  return (
    <section
      className={`${styles.ledger} ${onBoard ? styles.ledgerCompact : ""}`}
      aria-label="Confirmed intel summary"
      {...tour}
    >
      <div className={styles.ledgerHead}>
        <Icon icon="ph:notebook-bold" />
        <span className={styles.ledgerTitle}>What they want</span>
        <span className={styles.ledgerCount}>
          {rows.length === 0
            ? "nothing confirmed yet"
            : onlyIds
              ? `${rows.length} of ${everything.length} notes behind this thread`
              : `${openCount} open · ${rows.length - openCount} done`}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className={styles.ledgerEmpty}>
          Confirm a note on a stakeholder's page and it is filed here.
        </div>
      ) : (
        <table className={styles.ledgerTable}>
          {onBoard && (
            <>
              <colgroup>
                <col style={{ width: "26px" }} />
                <col style={{ width: "20px" }} />
                <col style={{ width: "22px" }} />
                <col />
                <col style={{ width: "22px" }} />
                <col style={{ width: "30px" }} />
              </colgroup>
              <thead>
                <tr className={styles.ledgerColHead}>
                  <th colSpan={2} />
                  <th scope="col">
                    <HoverTooltip description="The step in the system the note is about"><span>Step</span></HoverTooltip>
                  </th>
                  <th />
                  <th />
                  <th scope="col">
                    <HoverTooltip description="Pencil in the notes your pitch will cover">
                      <span><Icon icon="ph:pencil-simple-line-duotone" aria-label="Penciled in" /></span>
                    </HoverTooltip>
                  </th>
                </tr>
              </thead>
            </>
          )}
          <tbody>
            {rows.map((row, idx) => {
              const meta = intelTagMeta(row.kind);
              const sameAsAbove = idx > 0 && rows[idx - 1].stakeholderId === row.stakeholderId;
              const color = colorOf(pages.find((s) => s.stakeholder_id === row.stakeholderId));
              const verb = row.kind === "driver" ? "Wants" : row.kind === "boundary" ? "Won't cross" : "Would trade";
              const resolvedMeta = row.resolved ? statusStamp(row.status) : undefined;
              return (
                <tr
                  key={row.id}
                  className={`${styles.ledgerRow} ${row.resolved ? styles.ledgerRowDone : ""} ${sameAsAbove ? "" : styles.ledgerRowFirst} ${board?.activeStakeholder === row.stakeholderId || board?.litIds.has(row.id) ? styles.ledgerRowLit : ""} ${board?.penciled.has(row.id) ? styles.ledgerRowPenciled : ""}`}
                  tabIndex={0}
                  style={board?.litIds.has(row.id) ? { ["--lit" as string]: board.litIds.get(row.id) } : undefined}
                  onClick={() => onOpenStakeholder(row.stakeholderId, row.id)}
                  onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpenStakeholder(row.stakeholderId, row.id)}
                  onMouseEnter={() => { board?.onActiveStakeholder(row.stakeholderId); board?.onLitItem(row.id); }}
                  onMouseLeave={() => { board?.onActiveStakeholder(null); board?.onLitItem(null); }}
                  onFocus={() => { board?.onActiveStakeholder(row.stakeholderId); board?.onLitItem(row.id); }}
                  onBlur={() => { board?.onActiveStakeholder(null); board?.onLitItem(null); }}
                  aria-label={`${row.stakeholderName}: ${verb} ${row.text}${row.giveUp ? ` for ${row.giveUp}` : ""}. Open their page.`}
                >
                  <th scope="row" className={styles.ledgerWho} style={{ borderLeftColor: color }}>
                    {!sameAsAbove && (
                      <HoverTooltip description={row.stakeholderName}>
                        <StakeholderAvatarComponent
                          avatar={stakeholders[row.stakeholderId]?.avatar}
                          emotion={faceForEmotionState(stakeholders[row.stakeholderId]?.emotional_state || "neutral")}
                          stakeholderColor={color}
                          stakeholderId={row.stakeholderId}
                          isFramed={false}
                          play_blink_animation={false}
                          size={onBoard ? "20px" : "30px"}
                          thumb
                        />
                      </HoverTooltip>
                    )}
                  </th>
                  <td className={styles.ledgerKind} style={{ color: meta.color }}>
                    <HoverTooltip description={verb}>
                      <Icon icon={meta.icon} aria-label={verb} />
                    </HoverTooltip>
                  </td>
                  {onBoard && (
                    <td className={styles.ledgerTarget}>
                      {row.target && graphTargets[row.target] && (
                        <HoverTooltip description={graphTargets[row.target].name}>
                          <Icon icon={graphTargets[row.target].icon || "ph:flow-arrow-bold"} aria-label={graphTargets[row.target].name} />
                        </HoverTooltip>
                      )}
                    </td>
                  )}
                  <td className={styles.ledgerWhat}>
                    <div className={styles.ledgerText}>
                      <GlossaryText text={row.text} surface="intel_notes" />
                      {row.giveUp && (
                        <>
                          {" "}<span className={styles.ledgerFor}>for</span>{" "}
                          <GlossaryText text={row.giveUp} surface="intel_notes" />
                        </>
                      )}
                      {" "}
                      <span className={styles.ledgerGo} aria-hidden="true">
                        <Icon icon="ph:arrow-square-out-bold" />
                      </span>
                    </div>
                    {onBoard && (
                      // The rest of the note, opening over the rows below on hover. The row itself never grows,
                      // so the list does not shift under the cursor. This copy is inert (no pointer, no focus,
                      // not read out) and its first line is clipped away, so the real first line, with its
                      // glossary terms, is what you point at.
                      <div className={styles.ledgerPeek} inert>
                        <GlossaryText text={row.text} surface="intel_notes" />
                        {row.giveUp && (
                          <>
                            {" "}<span className={styles.ledgerFor}>for</span>{" "}
                            <GlossaryText text={row.giveUp} surface="intel_notes" />
                          </>
                        )}
                      </div>
                    )}
                  </td>
                  <td className={styles.ledgerMark}>
                    {(() => {
                      // Same wording as the stamps on the notes themselves.
                      const [label, detail] = resolvedMeta
                        ? [resolvedMeta.label, resolvedMeta.title]
                        : row.onRecord
                          ? ["On Record", "They said this openly, in a channel the whole team reads, before you started digging. Nothing left to confirm."]
                          : ["Confirmed", "You verified this yourself by talking to them."];
                      return (
                        <span
                          className={styles.ledgerMarkTarget}
                          tabIndex={0}
                          aria-label={`${label}: ${detail}`}
                          onMouseEnter={(e) => onShowInfo(e, label, detail)}
                          onMouseLeave={onHideInfo}
                          onFocus={(e) => onShowInfo(e, label, detail)}
                          onBlur={onHideInfo}
                        >
                          {resolvedMeta ? (
                            <span className={resolvedMeta.className}>{resolvedMeta.label}</span>
                          ) : row.onRecord ? (
                            <Icon icon="ph:star-fill" className={styles.ledgerOnRecord} />
                          ) : (
                            <Icon icon="ph:certificate-duotone" className={styles.ledgerConfirmed} />
                          )}
                        </span>
                      );
                    })()}
                  </td>
                  {board && (
                    <td className={styles.ledgerPencil} onClick={(e) => e.stopPropagation()}>
                      <HoverTooltip description="Pencil in: the pitch you are building covers this note">
                        <input
                          type="checkbox"
                          checked={board.penciled.has(row.id)}
                          onChange={(e) => board.onTogglePencil(row.id, e.target.checked)}
                          aria-label={`Pencil in: my pitch covers ${row.stakeholderName}'s note`}
                        />
                      </HoverTooltip>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
