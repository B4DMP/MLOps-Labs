import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import { Icon } from "@iconify/react";
import styles from "./ActionCardCreatedModal.module.css";
import type { ActionCard } from "../types/ActionCard";
import type { Stakeholder } from "./StakeholderProvider";
import ActionCardCardComponent from "./ActionCardCardComponent";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";

export interface IntelItem {
  id: string;
  requirement_id?: string;
  intel_type: string;
  categorized_type: string;
  description: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
}

export interface ActionCardCreatedModalProps {
  isOpen: boolean;
  actionCard: ActionCard | null;
  intelItems?: IntelItem[];
  stakeholders?: Record<string, Stakeholder>;
  getStakeholderColor?: (st: any) => string;
  onProgressToPitchDebate: () => void;
}

export default function ActionCardCreatedModal({
  isOpen,
  actionCard,
  intelItems = [],
  stakeholders = {},
  getStakeholderColor = () => "var(--primary-bg)",
  onProgressToPitchDebate,
}: ActionCardCreatedModalProps) {
  if (!isOpen || !actionCard) return null;

  // Resolve matching intel items from the action card's intel_ids
  const cardIntelIds = actionCard.intel_ids || [];
  const mergedIntelItems = intelItems.filter((i) =>
    cardIntelIds.includes(i.id) || (i.requirement_id && cardIntelIds.includes(i.requirement_id))
  );

  const getCategoryClass = (type: string) => {
    switch (type) {
      case "requirement":
        return styles.catReq;
      case "negotiable_preference":
        return styles.catPref;
      case "personal_friction":
        return styles.catFrict;
      default:
        return styles.catDefault;
    }
  };

  const getCategoryLabel = (type: string) => {
    switch (type) {
      case "requirement":
        return "Requirement";
      case "negotiable_preference":
        return "Preference";
      case "personal_friction":
        return "Friction";
      default:
        return "Intel";
    }
  };

  return (
    <Dialog open={isOpen} onClose={() => { }} className="position-relative z-50">
      <DialogBackdrop className={styles.backdrop} />

      <div className={styles.dialogWrapper}>
        <DialogPanel className={styles.panel}>
          {/* Header styled like PrePhaseDialog */}
          <div className={styles.header}>
            <div>
              <DialogTitle className={styles.headerTitle}>
                <Icon icon="ph:cards-bold" className={styles.headerIcon} />
                <span>Action Card Created</span>
              </DialogTitle>
            </div>
          </div>

          {/* Modal Body */}
          <div className={styles.modalBody}>
            <div className={styles.dossierGrid}>
              {/* Left Column: Action Card 7/5 Playing Card Component */}
              <div className={styles.cardColumn}>
                <div className="d-flex justify-content-center align-items-center h-100 py-1">
                  <ActionCardCardComponent
                    card={actionCard}
                    intelItems={intelItems}
                    stakeholders={stakeholders}
                    getStakeholderColor={getStakeholderColor}
                  />
                </div>
              </div>

              {/* Right Column: Synthesized Intel Requirements & Next Steps */}
              <div className={styles.detailsColumn}>
                <div className={styles.sectionHeader}>
                  <h6 className={styles.sectionTitle}>
                    <Icon icon="ph:notebook-bold" className={styles.sectionIcon} />
                    <span>Merged Intel Items ({mergedIntelItems.length})</span>
                  </h6>
                </div>

                <div className={styles.intelScrollArea}>
                  {mergedIntelItems.map((item) => {
                    const st = item.stakeholder_id ? stakeholders[item.stakeholder_id] : null;
                    const stColor = st ? getStakeholderColor(st) : "var(--primary-bg)";
                    const catType = item.categorized_type || item.intel_type;
                    return (
                      <div key={item.id} className={styles.intelRow}>
                        <div className={styles.intelRowTop}>
                          <span
                            className={styles.stakeholderTag}
                            style={{ color: stColor }}
                          >
                            <div
                              style={{
                                width: "18px",
                                height: "18px",
                                borderRadius: "50%",
                                overflow: "hidden",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                backgroundColor: stColor,
                                border: `1px solid ${stColor}`,
                                flexShrink: 0,
                              }}
                            >
                              <StakeholderAvatarComponent
                                avatar={st?.avatar}
                                stakeholderColor={stColor}
                                isFramed={true}
                                play_blink_animation={false}
                                size="100%"
                                title={st?.name}
                              />
                            </div>
                            <span>{item.stakeholder_name || st?.name || "Stakeholder"}</span>
                          </span>
                          <span className={`${styles.categoryBadge} ${getCategoryClass(catType)}`}>
                            {getCategoryLabel(catType)}
                          </span>
                        </div>
                        <p className={styles.intelRowText}>{item.description}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Briefing Card matching PrePhaseDialog actionPlanCard */}
                <div className={styles.actionPlanCard}>
                  <div className={styles.actionPlanHeader}>
                    <Icon icon="ph:list-checks-bold" />
                    <span>Boardroom Pitch Briefing</span>
                  </div>
                  <div className={styles.actionPlanList}>
                    <div className={styles.actionPlanItem}>
                      <span className={styles.stepBadge}>1</span>
                      <div>
                        <strong>Pitch to Boardroom:</strong> Present this strategic action proposal to the stakeholders.
                      </div>
                    </div>
                    <div className={styles.actionPlanItem}>
                      <span className={styles.stepBadge}>2</span>
                      <div>
                        <strong>Address Concerns:</strong> Answer stakeholder questions and negotiate to secure alignment.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer matching PrePhaseDialog */}
            <div className={styles.footer}>
              <div className={styles.footerHint}>
                <Icon icon="ph:info-bold" className={styles.footerHintIcon} />
                <span>This action card represents a proposed action to address the current challenge.</span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={onProgressToPitchDebate}
                >
                  <span>Progress to Pitch Debate</span>
                  <Icon icon="ph:arrow-right-bold" />
                </button>
              </div>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
