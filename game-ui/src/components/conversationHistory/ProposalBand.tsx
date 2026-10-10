import { Icon } from "@iconify/react";
import HoverTooltip from "../HoverToolTip";
import type { ProposalSummary, Verdict, VerdictState } from "./chat";
import styles from "./ConversationHistory.module.css";

interface ProposalBandProps {
  proposal?: ProposalSummary | null;
  verdicts: Verdict[];
}

const STATE_CLASS: Record<VerdictState, string> = {
  waiting: styles.verdictWaiting,
  backs: styles.verdictBacks,
  pushback: styles.verdictPushback,
  objection: styles.verdictObjection,
};

const STATE_TITLE: Record<VerdictState, string> = {
  waiting: "Reading the proposal",
  backs: "Backs it",
  pushback: "Pushback",
  objection: "Objection",
};

const STATE_ICON: Partial<Record<VerdictState, string>> = {
  backs: "ph:check-bold",
  pushback: "ph:warning-bold",
  objection: "ph:x-bold",
};

/** The pitched proposal on the left, who has answered on the right. Does not scroll. */
export default function ProposalBand({ proposal, verdicts }: ProposalBandProps) {
  if (!proposal && verdicts.length === 0) return null;
  return (
    <div className={styles.band} data-testid="proposal-band">
      {proposal && (
        <HoverTooltip description={`Action proposal, ${proposal.count} ${proposal.count === 1 ? "change" : "changes"}`}>
          <span className={styles.proposal}>
            <Icon icon="ph:git-pull-request-bold" className={styles.proposalIcon} />
            <span className={styles.proposalLabel}>{proposal.label}</span>
            {proposal.count > 1 && <span className={styles.proposalChip}>+{proposal.count - 1}</span>}
          </span>
        </HoverTooltip>
      )}
      <span className={styles.verdicts}>
        {verdicts.map((v) => (
          <HoverTooltip key={v.stakeholderId} description={`${v.name}: ${STATE_TITLE[v.state]}`}>
            <span className={`${styles.verdict} ${STATE_CLASS[v.state]}`} data-state={v.state}>
              {v.name}
              {v.state === "waiting" ? (
                <span className={styles.dots} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <Icon icon={STATE_ICON[v.state]!} />
              )}
            </span>
          </HoverTooltip>
        ))}
      </span>
    </div>
  );
}
