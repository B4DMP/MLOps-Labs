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
import { intelTagMeta } from "../types/IntelTag";

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
  /** Stakeholders whose intel counter is full: shown, but greyed out. */
  exhaustedStakeholderIds?: string[];
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
  exhaustedStakeholderIds = [],
  intelItems = [],
  onConfirmStakeholders,
  onConfirmIntel,
  getStakeholderColor,
}: EngagementCardTargetModalProps) {
  const [selectedStakeholderIds, setSelectedStakeholderIds] = useState<string[]>([]);
  const [selectedIntelId, setSelectedIntelId] = useState<string | null>(null);
  const [selectedStakeholderFilter, setSelectedStakeholderFilter] = useState<string>("ALL");
  const [isClosing, setIsClosing] = useState(false);

  // Reset selections upon modal opening or card switch
  useEffect(() => {
    if (isOpen && card) {
      if (card.stakeholder_selection_amount === -1) {
        const lockedIds = cardTargetedStakeholdersMap[card.id] || [];
        const activeIds = availableStakeholderList
          .filter(isStakeholderActive)
          .map((st: any) => st.id)
          .filter((id: string) => !exhaustedStakeholderIds.includes(id) && !lockedIds.includes(id));
        setSelectedStakeholderIds(activeIds);
      } else {
        setSelectedStakeholderIds([]);
      }
      setSelectedIntelId(null);
      setSelectedStakeholderFilter("ALL");
      setIsClosing(false);
    }
    // Only on open or on a card switch: the parent rebuilds these lists on every render, and
    // listening to them would wipe the player's selection each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const isAllStakeholdersCard = card.stakeholder_selection_amount === -1;
  const activeStakeholders = availableStakeholderList.filter(isStakeholderActive);
  const targetedStakeholderIds = cardTargetedStakeholdersMap[card.id] || [];
  const isExhausted = (stId: string) => exhaustedStakeholderIds.includes(stId);
  const selectableStakeholders = activeStakeholders.filter(
    (st: any) => !isExhausted(st.id) && !targetedStakeholderIds.includes(st.id)
  );
  // A card asking for two targets still plays when only one has anything left to tell.
  const requiredAmount = isIntelCard
    ? 1
    : isAllStakeholdersCard
    ? selectableStakeholders.length
    : Math.min(card.stakeholder_selection_amount, selectableStakeholders.length);

  // Tag details come from the shared tag module; the class keeps each tag's colour consistent.
  const CATEGORY_CLASS = {
    requirement: styles.categoryTagRequirement,
    preference: styles.categoryTagPreference,
    friction: styles.categoryTagFriction,
    default: "",
  };
  const getCategoryDetails = (type: string) => {
    const meta = intelTagMeta(type);
    return { label: meta.label, shortLabel: meta.shortLabel, icon: meta.icon, className: CATEGORY_CLASS[meta.styleKey] };
  };

  // Stakeholder filter options for intel verification items
  const stakeholderOptions = Array.from(
    new Set(intelItems.map((item) => item.stakeholder_id).filter(Boolean) as string[])
  ).map((stId) => {
    const st = stakeholders[stId];
    const name = st?.name || intelItems.find((i) => i.stakeholder_id === stId)?.stakeholder_name || stId;
    const count = intelItems.filter((i) => i.stakeholder_id === stId).length;
    return { id: stId, name, count };
  });

  const unassignedCount = intelItems.filter((i) => !i.stakeholder_id).length;

  const filteredIntelItems = intelItems.filter((item) => {
    if (selectedStakeholderFilter === "ALL") return true;
    if (selectedStakeholderFilter === "UNASSIGNED") return !item.stakeholder_id;
    return item.stakeholder_id === selectedStakeholderFilter;
  });

  const handleToggleStakeholder = (stId: string) => {
    if (targetedStakeholderIds.includes(stId) || isExhausted(stId)) return;

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
    : requiredAmount > 0 && selectedStakeholderIds.length === requiredAmount;

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
      footerHint = isAllStakeholdersCard
        ? `Ready to synchronize with all team members (${names}).`
        : `Ready to engage with ${names}.`;
    } else {
      footerHint = isAllStakeholdersCard
        ? `Please re-select all ${requiredAmount} stakeholders to synchronize perspectives.`
        : `Select ${remaining} more stakeholder${remaining > 1 ? "s" : ""} to execute ${card.title}.`;
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
                  : isAllStakeholdersCard
                  ? `All ${requiredAmount} active team stakeholders are selected by default. Confirm below to initiate the sync.`
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
            {/* Horizontal Directive Banner: full width across top of modal body */}
            <div className={styles.directiveBanner}>
              <div className={styles.directiveBannerHeader}>
                <Icon icon="ph:list-checks-bold" className={styles.directiveIcon} />
                <span>Card Directive & Rules</span>
              </div>

              <div className={styles.directiveStepsGrid}>
                <div className={styles.directiveStepItem}>
                  <span className={styles.stepBadge}>1</span>
                  <div className={styles.directiveStepContent}>
                    <strong>Target Scope:</strong>{" "}
                    <span>
                      {isIntelCard
                        ? "Select 1 unverified dossier finding to upgrade."
                        : isAllStakeholdersCard
                        ? `All ${requiredAmount} active team stakeholders are included in this sync.`
                        : `Select exactly ${requiredAmount} active stakeholder${requiredAmount > 1 ? "s" : ""}.`}
                    </span>
                  </div>
                </div>

                <div className={styles.directiveStepItem}>
                  <span className={styles.stepBadge}>2</span>
                  <div className={styles.directiveStepContent}>
                    <strong>{isIntelCard ? "Direct Verification:" : "Dialogue & Intel:"}</strong>{" "}
                    <span>
                      {isIntelCard
                        ? "Elevates finding certainty to Verified in the Stakeholder Dossier."
                        : card.turns !== undefined && card.turns > 0
                          ? `Buys ${card.turns} turn${card.turns > 1 ? "s" : ""} per target: unconfirmed notes you hold are checked first, then new ones come up. Results land in your dossier.`
                          : "Triggers targeted dialogue responses & steers engagement dynamics."}
                    </span>
                  </div>
                </div>

                <div className={styles.directiveStepItem}>
                  <span className={styles.stepBadge}>3</span>
                  <div className={styles.directiveStepContent}>
                    <strong>Phase Limit:</strong>{" "}
                    <span>
                      {isIntelCard
                        ? "Already verified intel items cannot be verified again."
                        : "Stakeholders already targeted by this card in this phase are locked."}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.dossierGrid}>
              {/* Left Column: Full Card Preview */}
              <div className={styles.cardColumn}>
                <div className={styles.cardPreviewWrapper}>
                  <EngagementCardComponent
                    card={card}
                    isPreview={true}
                    attentionTokens={attentionTokens}
                  />
                </div>
              </div>

              {/* Right Column: Stakeholder/Intel Selection Screen */}
              <div className={styles.selectionColumn}>
                <div className={styles.selectionHeader}>
                  <div className="d-flex align-items-center gap-2">
                    <h6 className={styles.sectionTitle}>
                      <Icon
                        icon={isIntelCard ? "ph:files-bold" : "ph:users-three-bold"}
                        className={styles.sectionIcon}
                      />
                      <span>{isIntelCard ? "Select Intel Item to Verify" : "Available Stakeholders"}</span>
                    </h6>
                    {isIntelCard && stakeholderOptions.length > 0 && (
                      <span className="badge bg-secondary" style={{ fontSize: "0.72rem" }}>
                        {filteredIntelItems.length} of {intelItems.length}
                      </span>
                    )}
                  </div>

                  <div className="d-flex align-items-center gap-2">
                    {isIntelCard && stakeholderOptions.length > 0 && (
                      <div className="d-flex align-items-center gap-1">
                        <label htmlFor="target-stakeholder-filter" className={styles.filterLabel}>
                          <Icon icon="ph:funnel-bold" className="me-1" />
                          Stakeholder:
                        </label>
                        <select
                          id="target-stakeholder-filter"
                          className={`form-select form-select-sm ${styles.stakeholderFilterSelect}`}
                          value={selectedStakeholderFilter}
                          onChange={(e) => setSelectedStakeholderFilter(e.target.value)}
                        >
                          <option value="ALL">All Stakeholders ({intelItems.length})</option>
                          {stakeholderOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name} ({opt.count})
                            </option>
                          ))}
                          {unassignedCount > 0 && (
                            <option value="UNASSIGNED">General / Unassigned ({unassignedCount})</option>
                          )}
                        </select>
                        {selectedStakeholderFilter !== "ALL" && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary py-1 px-2"
                            style={{ fontSize: "0.72rem" }}
                            onClick={() => setSelectedStakeholderFilter("ALL")}
                            title="Reset filter to show all stakeholders"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    )}

                    {isAllStakeholdersCard && selectedStakeholderIds.length < requiredAmount && (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-info py-0 px-2"
                        style={{ fontSize: "0.75rem", borderRadius: "4px" }}
                        onClick={() => setSelectedStakeholderIds(selectableStakeholders.map((st: any) => st.id))}
                      >
                        Select All
                      </button>
                    )}
                    <span
                      className={`${styles.selectionCountBadge} ${
                        isSelectionValid ? styles.selectionCountValid : styles.selectionCountPending
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
                          : isAllStakeholdersCard
                          ? `${selectedStakeholderIds.length} / ${requiredAmount} Selected (All Team)`
                          : `${selectedStakeholderIds.length} / ${requiredAmount} Selected`}
                      </span>
                    </span>
                  </div>
                </div>

                {/* Selection Cards Grid */}
                <div className={styles.cardsScrollContainer}>
                  {isIntelCard ? (
                    intelItems.length === 0 ? (
                      <div className={styles.emptyState}>
                        <Icon icon="ph:magnifying-glass-bold" className={styles.emptyStateIcon} />
                        <h6 className="fw-bold text-dark mb-1">No Intel Items Discovered Yet</h6>
                        <p className="small text-muted mb-0">
                          Play research engagement cards to uncover stakeholder stances first.
                        </p>
                      </div>
                    ) : filteredIntelItems.length === 0 ? (
                      <div className={styles.emptyState}>
                        <Icon icon="ph:user-circle-bold" className={styles.emptyStateIcon} />
                        <h6 className="fw-bold text-dark mb-1">No Intel for this Stakeholder</h6>
                        <p className="small text-muted mb-2">
                          No discovered intel items match the selected stakeholder filter.
                        </p>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => setSelectedStakeholderFilter("ALL")}
                        >
                          Show All Intel Items
                        </button>
                      </div>
                    ) : (
                      /* Intel Items Grid */
                      <div className={styles.intelGrid}>
                        {filteredIntelItems.map((item) => {
                          const isVerified = (item.intel_type || "").toLowerCase().includes("verified");
                          const isSelected = selectedIntelId === item.id;
                          const isSelectable = !isVerified;
                          const catType = item.categorized_type || "driver";
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
                    )
                  ) : (
                    /* Stakeholder Cards Grid with prominent Avatars */
                    <div className={styles.stakeholderGrid}>
                      {activeStakeholders.map((st) => {
                        const isSelected = selectedStakeholderIds.includes(st.id);
                        const isAlreadyTargeted = targetedStakeholderIds.includes(st.id);
                        const nothingLeft = isExhausted(st.id);
                        const isSelectable = !isAlreadyTargeted && !nothingLeft;
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
                                : nothingLeft
                                ? `Every note on ${st.name} is confirmed already.`
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
                                stakeholderId={st.id}
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
                              ) : nothingLeft ? (
                                <span className={styles.lockedBadge}>
                                  <Icon icon="ph:seal-check-fill" /> Nothing left to learn here
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
