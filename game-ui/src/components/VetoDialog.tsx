import { Icon } from "@iconify/react";
import styles from "./VetoDialog.module.css";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";

export interface VetoInfo {
  stakeholder_id: string;
  stakeholder_name?: string;
  power?: string;
  message: string;
  objection_kind?: string;
  objection_detail?: string;
  boundary_violated?: boolean;
}

interface VetoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onReviseProposal: () => void;
  vetoInfo: VetoInfo | null;
  stakeholders?: Record<string, any>;
  getStakeholderColor: (st: any) => string;
}

export default function VetoDialog({
  isOpen,
  onClose,
  onReviseProposal,
  vetoInfo,
  stakeholders = {},
  getStakeholderColor,
}: VetoDialogProps) {
  if (!isOpen || !vetoInfo) return null;

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
              <Icon icon="ph:prohibit-bold" className={styles.headerIcon} />
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
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <div className={styles.footerHint}>
            <Icon icon="ph:info-bold" className={styles.footerHintIcon} />
            <span>
              A high-power stakeholder has blocked the plan. Adjust your commitments to address their objection before proceeding.
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
          </div>
        </div>
      </div>
    </div>
  );
}
