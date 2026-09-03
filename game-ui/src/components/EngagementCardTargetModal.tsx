import { useState, useEffect } from "react";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import { Icon } from "@iconify/react";
import styles from "./EngagementCardTargetModal.module.css";
import type { EngagementCard } from "../types/EngagementCard";
import type { Stakeholder } from "./StakeholderProvider";
import EngagementCardComponent from "./EngagementCardComponent";
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

export interface EngagementCardTargetModalProps {
  isOpen: boolean;
  onClose: () => void;
  card: EngagementCard | null;
  attentionTokens: number;
  stakeholders: Record<string, Stakeholder>;
  availableStakeholderList: any[];
  isStakeholderActive: (st: any) => boolean;
  cardTargetedStakeholdersMap: Record<string, string[]>;
  intelItems?: IntelItem[];
  onConfirmStakeholders: (stakeholderIds: string[]) => void;
  onConfirmIntel: (intelItem: IntelItem) => void;
  getStakeholderColor: (st: any) => string;
  getTagBadgeColor?: (type: string) => string;
}

export default function EngagementCardTargetModal({
  isOpen,
  onClose,
  card,
  attentionTokens,
  stakeholders,
  availableStakeholderList,
  isStakeholderActive,
  cardTargetedStakeholdersMap,
  intelItems = [],
  onConfirmStakeholders,
  onConfirmIntel,
  getStakeholderColor,
  getTagBadgeColor = (type: string) => {
    switch (type) {
      case "requirement":
        return "bg-primary";
      case "negotiable_preference":
        return "bg-success";
      case "personal_friction":
        return "bg-warning text-dark";
      default:
        return "bg-secondary";
    }
  },
}: EngagementCardTargetModalProps) {
  const [selectedStakeholderIds, setSelectedStakeholderIds] = useState<string[]>([]);
  const [selectedIntelId, setSelectedIntelId] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  // Reset selections upon modal opening or card switch
  useEffect(() => {
    if (isOpen) {
      setSelectedStakeholderIds([]);
      setSelectedIntelId(null);
      setIsClosing(false);
    }
  }, [isOpen, card?.id]);

  const handleRequestClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  };

  if (!isOpen || !card) return null;

  const isIntelCard = card.target_type === "intel" || card.id === "eng_0";
  const requiredAmount = isIntelCard ? 1 : card.stakeholder_selection_amount;

  // Distinct requirement category details helper (Non-conflicting colors & icons)
  const getCategoryDetails = (type: string) => {
    switch (type) {
      case "requirement":
        return {
          label: "Requirement",
          shortLabel: "REQ",
          icon: "ph:check-square-bold",
          className: styles.categoryTagRequirement,
        };
      case "negotiable_preference":
        return {
          label: "Preference",
          shortLabel: "PREF",
          icon: "ph:sliders-horizontal-bold",
          className: styles.categoryTagPreference,
        };
      case "personal_friction":
        return {
          label: "Friction",
          shortLabel: "FRICT",
          icon: "ph:warning-circle-bold",
          className: styles.categoryTagFriction,
        };
      default:
        return {
          label: type.replace(/_/g, " "),
          shortLabel: "INTEL",
          icon: "ph:tag-bold",
          className: styles.categoryTagDefault,
        };
    }
  };

  const activeStakeholders = availableStakeholderList.filter(isStakeholderActive);

  // Filter out already targeted stakeholders for the card
  const targetedStakeholderIds = cardTargetedStakeholdersMap[card.id] || [];

  const handleToggleStakeholder = (stId: string) => {
    if (targetedStakeholderIds.includes(stId)) return;

    if (selectedStakeholderIds.includes(stId)) {
      setSelectedStakeholderIds((prev) => prev.filter((id) => id !== stId));
    } else {
      if (requiredAmount === 1) {
        setSelectedStakeholderIds([stId]);
      } else if (selectedStakeholderIds.length < requiredAmount) {
        setSelectedStakeholderIds((prev) => [...prev, stId]);
      }
    }
  };

  const handleToggleIntel = (item: IntelItem) => {
    const isVerified = (item.intel_type || "").toLowerCase().includes("verified");
    if (isVerified) return;

    setSelectedIntelId((prev) => (prev === item.id ? null : item.id));
  };

  const isSelectionValid = isIntelCard
    ? Boolean(selectedIntelId)
    : selectedStakeholderIds.length === requiredAmount;

  const handleConfirm = () => {
    if (!isSelectionValid) return;

    if (isIntelCard) {
      const selectedItem = intelItems.find((item) => item.id === selectedIntelId);
      if (selectedItem) {
        onConfirmIntel(selectedItem);
      }
    } else {
      onConfirmStakeholders(selectedStakeholderIds);
    }
  };

  // Human-readable footer guidance
  let footerHint = "";
  if (isIntelCard) {
    footerHint = selectedIntelId
      ? "Ready to verify the selected intel item."
      : "Click an unverified intel finding from the list to select it for verification.";
  } else {
    const remaining = requiredAmount - selectedStakeholderIds.length;
    if (remaining === 0) {
      const names = selectedStakeholderIds
        .map((id) => stakeholders[id]?.name || availableStakeholderList.find((s) => s.id === id)?.name || id)
        .join(", ");
      footerHint = `Ready to engage with ${names}.`;
    } else {
      footerHint = `Select ${remaining} more stakeholder${remaining > 1 ? "s" : ""} to execute ${card.title}.`;
    }
  }

  return (
    <Dialog open={isOpen} onClose={handleRequestClose} className="position-relative z-50">
      <DialogBackdrop className={`${styles.backdrop} ${isClosing ? styles.backdropClosing : ""}`} />

      <div className={styles.dialogWrapper}>
        <DialogPanel className={`${styles.panel} ${isClosing ? styles.panelClosing : ""}`}>
          {/* Header */}
          <div className={styles.header}>
            <div>
              <DialogTitle className={styles.headerTitle}>
                <Icon icon={card.icon || "ph:cards-bold"} className={styles.headerIcon} />
                <span>Target Selection • {card.title}</span>
              </DialogTitle>
              <p className={styles.headerSubtitle}>
                {isIntelCard
                  ? "Select an unverified dossier finding to authenticate with this engagement card"
                  : `Choose ${requiredAmount} stakeholder${requiredAmount > 1 ? "s" : ""} to initiate direct dialogue and uncover requirements`}
              </p>
            </div>

            <div className={styles.headerBadges}>
              <div className={styles.costBadge} title={`${card.token_cost} Attention Tokens required`}>
                <Icon icon="ph:coin-fill" style={{ color: "var(--token-color)" }} />
                <span>{card.token_cost} Cost</span>
              </div>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={handleRequestClose}
                aria-label="Close dialog"
              >
                <Icon icon="ph:x-bold" />
              </button>
            </div>
          </div>

          {/* Modal Body: 2-Column Dossier Layout */}
          <div className={styles.modalBody}>
            <div className={styles.dossierGrid}>
              {/* Left Column: Full Card Preview & Directive Summary */}
              <div className={styles.cardColumn}>
                <div className={styles.cardPreviewWrapper}>
                  <EngagementCardComponent
                    card={card}
                    isPreview={true}
                    attentionTokens={attentionTokens}
                  />
                </div>

                <div className={styles.directiveCard}>
                  <div className={styles.directiveHeader}>
                    <Icon icon="ph:list-checks-bold" className={styles.directiveIcon} />
                    <span>Card Directive & Rules</span>
                  </div>

                  <div className={styles.directiveList}>
                    <div className={styles.directiveItem}>
                      <span className={styles.stepBadge}>1</span>
                      <div>
                        <strong>Target Scope:</strong>{" "}
                        {isIntelCard
                          ? "Select 1 unverified dossier finding to upgrade."
                          : `Select exactly ${requiredAmount} active stakeholder${requiredAmount > 1 ? "s" : ""}.`}
                      </div>
                    </div>

                    <div className={styles.directiveItem}>
                      <span className={styles.stepBadge}>2</span>
                      <div>
                        <strong>{isIntelCard ? "Direct Verification:" : "Dialogue & Intel:"}</strong>{" "}
                        {isIntelCard
                          ? "Elevates finding certainty to Verified in the Stakeholder Dossier."
                          : card.intel_reveal_count !== undefined && card.intel_reveal_count > 0
                            ? `Uncovers up to ${card.intel_reveal_count} challenge-specific stance${card.intel_reveal_count > 1 ? "s" : ""} per target that will be listed in your stakeholder dossier.`
                            : "Triggers targeted dialogue responses & steers engagement dynamics."}
                      </div>
                    </div>

                    <div className={styles.directiveItem}>
                      <span className={styles.stepBadge}>3</span>
                      <div>
                        <strong>Phase Limit:</strong>{" "}
                        {isIntelCard
                          ? "Already verified intel items cannot be verified again."
                          : "Stakeholders already targeted by this card in this phase are locked."}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Stakeholder/Intel Selection Screen */}
              <div className={styles.selectionColumn}>
                <div className={styles.selectionHeader}>
                  <h6 className={styles.sectionTitle}>
                    <Icon
                      icon={isIntelCard ? "ph:files-bold" : "ph:users-three-bold"}
                      className={styles.sectionIcon}
                    />
                    <span>{isIntelCard ? "Select Intel Item to Verify" : "Available Stakeholders"}</span>
                  </h6>

                  <span
                    className={`${styles.selectionCountBadge} ${isSelectionValid ? styles.selectionCountValid : styles.selectionCountPending
                      }`}
                  >
                    <Icon
                      icon={isSelectionValid ? "ph:check-circle-fill" : "ph:circle-dashed"}
                      style={{ fontSize: "1rem" }}
                    />
                    <span>
                      {isIntelCard
                        ? selectedIntelId
                          ? "1 / 1 Selected"
                          : "0 / 1 Selected"
                        : `${selectedStakeholderIds.length} / ${requiredAmount} Selected`}
                    </span>
                  </span>
                </div>

                {/* Selection Cards Grid */}
                <div className={styles.cardsScrollContainer}>
                  {isIntelCard ? (
                    /* Intel Items Grid */
                    <div className={styles.intelGrid}>
                      {intelItems.map((item) => {
                        const isVerified = (item.intel_type || "").toLowerCase().includes("verified");
                        const isSelected = selectedIntelId === item.id;
                        const isSelectable = !isVerified;
                        const catType = item.categorized_type || "requirement";
                        const catDetails = getCategoryDetails(catType);

                        return (
                          <div
                            key={item.id}
                            className={`${styles.intelCard} ${isSelected ? styles.intelSelected : ""} ${!isSelectable ? styles.intelDisabled : ""
                              }`}
                            onClick={() => isSelectable && handleToggleIntel(item)}
                          >
                            <div>
                              <div className={styles.intelHeader}>
                                <div className={styles.intelBadges}>
                                  <span className={`${styles.categoryTag} ${catDetails.className}`}>
                                    <Icon icon={catDetails.icon} />
                                    <span>{catDetails.label}</span>
                                  </span>

                                  <span
                                    className={`${styles.confirmationPill} ${
                                      isVerified ? styles.confirmationPillVerified : styles.confirmationPillUnconfirmed
                                    }`}
                                  >
                                    <Icon
                                      icon={isVerified ? "ph:seal-check-fill" : "ph:question-fill"}
                                      style={{ fontSize: "0.85rem" }}
                                    />
                                    <span>{isVerified ? "Verified" : "Unconfirmed"}</span>
                                  </span>
                                </div>
                              </div>

                              <p className={styles.intelDescription} style={{ marginTop: "0.6rem" }}>
                                {item.description}
                              </p>
                            </div>

                            <div className="d-flex justify-content-between align-items-center mt-2">
                              {item.stakeholder_name ? (
                                <p className={styles.intelSource}>
                                  <Icon icon="ph:user-circle" />
                                  <span>Source: {item.stakeholder_name}</span>
                                </p>
                              ) : (
                                <span />
                              )}

                              {!isSelectable ? (
                                <span className={styles.lockedBadge}>
                                  <Icon icon="ph:check-circle-fill" /> Already Verified
                                </span>
                              ) : isSelected ? (
                                <Icon icon="ph:check-circle-fill" className={styles.checkedIcon} />
                              ) : (
                                <span className={styles.uncheckCircle} />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Stakeholder Cards Grid with prominent Avatars */
                    <div className={styles.stakeholderGrid}>
                      {activeStakeholders.map((st) => {
                        const isSelected = selectedStakeholderIds.includes(st.id);
                        const isAlreadyTargeted = targetedStakeholderIds.includes(st.id);
                        const isSelectable = !isAlreadyTargeted;
                        const stColor = getStakeholderColor(st);
                        const stAvatar = stakeholders[st.id]?.avatar || st.avatar;

                        return (
                          <div
                            key={st.id}
                            className={`${styles.stakeholderCard} ${isSelected ? styles.stakeholderSelected : ""
                              } ${!isSelectable ? styles.stakeholderDisabled : ""}`}
                            onClick={() => isSelectable && handleToggleStakeholder(st.id)}
                            title={
                              isAlreadyTargeted
                                ? `Already targeted by "${card.title}" in this phase.`
                                : `Click to ${isSelected ? "deselect" : "select"} ${st.name}`
                            }
                          >
                            {/* Prominent Stakeholder Avatar Frame */}
                            <div
                              className={styles.avatarWrapper}
                              style={{
                                borderColor: isSelectable ? stColor : "#94a3b8",
                                backgroundColor: isSelectable ? stColor : "#94a3b8",
                              }}
                            >
                              <StakeholderAvatarComponent
                                avatar={stAvatar}
                                stakeholderColor={stColor}
                                isFramed={true}
                                play_blink_animation={false}
                                size="100%"
                                title={st.name}
                              />
                            </div>

                            {/* Stakeholder Details */}
                            <div className={styles.stakeholderMeta}>
                              <div className={styles.stakeholderHeaderRow}>
                                <h6 className={styles.stakeholderName} title={st.name}>
                                  {st.name}
                                </h6>
                                <div className={styles.statusIndicator}>
                                  {isSelected && (
                                    <Icon
                                      icon="ph:check-circle-fill"
                                      className={styles.checkedIcon}
                                    />
                                  )}
                                  {isAlreadyTargeted && (
                                    <span title="Already targeted" style={{ display: "inline-flex" }}>
                                      <Icon
                                        icon="ph:lock-key-fill"
                                        className={styles.lockedIcon}
                                      />
                                    </span>
                                  )}
                                  {!isSelected && !isAlreadyTargeted && (
                                    <span className={styles.uncheckCircle} />
                                  )}
                                </div>
                              </div>

                              <p className={styles.stakeholderRole} title={st.role_description || st.responsibilities}>
                                {st.role_description || st.responsibilities || "Key Project Stakeholder"}
                              </p>

                              {isAlreadyTargeted ? (
                                <span className={styles.lockedBadge}>
                                  <Icon icon="ph:lock-key-fill" /> Already targeted in this challenge
                                </span>
                              ) : (
                                <div className={styles.tagRow}>
                                  {st.power && (
                                    <span className={styles.miniBadge}>
                                      <Icon icon="ph:lightning-bold" /> {st.power} Power
                                    </span>
                                  )}
                                  {st.interest && (
                                    <span className={styles.miniBadge}>
                                      <Icon icon="ph:eye-bold" /> {st.interest} Interest
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer with game guidance and actions */}
            <div className={styles.footer}>
              <div className={styles.footerHint}>
                <Icon icon="ph:info-bold" className={styles.footerHintIcon} />
                <span>{footerHint}</span>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={handleRequestClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  disabled={!isSelectionValid}
                  onClick={handleConfirm}
                >
                  <Icon icon="ph:lightning-fill" />
                  <span>
                    Confirm & Play Card ({card.token_cost} Tokens)
                  </span>
                </button>
              </div>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
