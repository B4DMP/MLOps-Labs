import { Icon } from "@iconify/react";
import styles from "./VetoDialog.module.css";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import OnceIcon from "./Results/OnceIcon";
import ROAD_BARRIER_ICON from "./Results/icons/road-barrier.json";
import { ESCALATIONS, VETO_FEEDBACK } from "../content/helpCopy";
import type { ReactNode } from "react";

export interface VetoInfo {
  stakeholder_id: string;
  stakeholder_name?: string;
  power?: string;
  message: string;
  objection_kind?: string;
  objection_detail?: string;
  boundary_violated?: boolean;
  /** Graph target and dossier note behind a boundary objection (optional, newer servers). */
  objection_target?: string | null;
  objection_item_id?: string | null;
  /** The step a driver asks for, or the level a boundary holds (newer servers). */
  objection_level?: number | null;
  objection_axis?: string | null;
}

interface VetoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onReviseProposal: () => void;
  vetoInfo: VetoInfo | null;
  stakeholders?: Record<string, any>;
  getStakeholderColor: (st: any) => string;
  /** Escalation Points left this playthrough (D15): 3 to start, never regenerated within a run.
   * `null` while the count has not arrived yet, which hides the button rather than showing a
   * false "0 left". */
  escalationPoints?: number | null;
  /** Spends one Escalation Point to push this exact card through despite the veto. Omit to hide
   * the button entirely (e.g. a read-only replay of the dialog). */
  onVetoBreaker?: () => void;
  /** True from the click until the server answers, so the button cannot be pressed twice. */
  isBreakingVeto?: boolean;
  /** Intro walkthrough: footer wording changes (the breaker is hidden by omitting its handler). */
  isIntro?: boolean;
  /** Coach panel shown under the reason box. */
  feedback?: ReactNode;
}

export default function VetoDialog({
  isOpen,
  onClose,
  onReviseProposal,
  vetoInfo,
  stakeholders = {},
  getStakeholderColor,
  escalationPoints = null,
  onVetoBreaker,
  isBreakingVeto = false,
  isIntro = false,
  feedback,
}: VetoDialogProps) {
  if (!isOpen || !vetoInfo) return null;

  const pointsLeft = escalationPoints ?? 0;
  const canBreakVeto = Boolean(onVetoBreaker) && pointsLeft > 0 && !isBreakingVeto;
  const vetoBreakerHint =
    escalationPoints === null ? undefined : ESCALATIONS.hint(pointsLeft, vetoInfo.stakeholder_name);

  const stId = vetoInfo.stakeholder_id;
  const st = stakeholders[stId] || {};
  const stName = vetoInfo.stakeholder_name || st.name || stId;
  const stColor = getStakeholderColor(st);
  const stRole = st.role_description || st.responsibilities || "Key Decision Maker";
  const emotionalState = st.emotional_state || "critical";

  const handleRevise = () => {
    onClose();
    onReviseProposal();
  };

  return (
    <div className={styles.overlayLayer}>
      <div className={styles.panel}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <h2 className={styles.headerTitle}>
              <OnceIcon icon={ROAD_BARRIER_ICON} className={styles.headerLordicon} />
              <span>Action Proposal Vetoed</span>
            </h2>
            <p className={styles.headerSubtitle}>
              Executive Authority Exercised • Action Plan Blocked From Implementation
            </p>
          </div>
          <div>
            <span className={styles.vetoBadge}>VETO DECISION</span>
          </div>
        </div>

        {/* Modal Body */}
        <div className={styles.modalBody}>
          <div className={styles.grid}>
            {/* Left: Vetoing Stakeholder Profile */}
            <div className={styles.stakeholderColumn} style={{ ["--st-color" as string]: stColor }}>
              <div className={styles.avatarViewport}>
                <StakeholderAvatarComponent
                  avatar={st.avatar || {}}
                  play_blink_animation={true}
                  isFramed={false}
                  size={84}
                  stakeholderColor={stColor}
                  stakeholderId={stId}
                  title={stName}
                />
              </div>
              <div className={styles.stakeholderName}>{stName}</div>
              <div className={styles.stakeholderRole}>{stRole}</div>
              <div className={styles.powerBadge}>
                <Icon icon="ph:shield-warning-fill" />
                <span>High Power Authority</span>
              </div>
              <div className={styles.emotionPill}>
                <Icon icon="ph:heartbeat-fill" />
                <span>State: {emotionalState}</span>
              </div>
            </div>

            {/* Right: Veto Statement & Objection Reason */}
            <div className={styles.contentColumn}>
              <div className={styles.statementCard}>
                <div className={styles.statementHeader}>
                  <Icon icon="ph:chat-teardrop-warning-bold" />
                  <span>Executive Veto Declaration</span>
                </div>
                <p className={styles.statementQuote}>
                  "{vetoInfo.message.replace(/^🚫\s*\[VETO\]\s*/i, "")}"
                </p>
              </div>

              {vetoInfo.objection_detail && (
                <div className={styles.reasonBox}>
                  <div className={styles.reasonLabel}>
                    <Icon icon="ph:warning-octagon-bold" />
                    <span>
                      {vetoInfo.boundary_violated
                        ? "Violated Non-Negotiable Boundary"
                        : "Unaddressed Critical Priority"}
                    </span>
                  </div>
                  <p className={styles.reasonText}>{vetoInfo.objection_detail}</p>
                </div>
              )}
              {feedback}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.footerHint}>
            <Icon icon="ph:info-bold" className={styles.footerHintIcon} />
            <span>
              {isIntro
                ? VETO_FEEDBACK.introFooter
                : "A high-power stakeholder has blocked the plan. Adjust your commitments to address their objection before proceeding."}
            </span>
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.actionButton}
              onClick={handleRevise}
            >
              <Icon icon="ph:arrow-counter-clockwise-bold" />
              <span>Revise Action Card & Re-Pitch</span>
            </button>
            {onVetoBreaker && (
              <button
                type="button"
                className={styles.vetoBreakerButton}
                onClick={onVetoBreaker}
                disabled={!canBreakVeto}
                title={vetoBreakerHint}
              >
                <Icon icon="ph:lightning-bold" />
                <span>
                  {isBreakingVeto
                    ? "Overriding..."
                    : `Push It Through${escalationPoints !== null ? ` (${pointsLeft} left)` : ""}`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
