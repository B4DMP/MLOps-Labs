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
import HoverTooltip from "./HoverToolTip";
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
  currentPhase?: number;
  stakeholders: Record<string, Stakeholder>;
  availableStakeholderList: any[];
  isStakeholderActive: (st: any) => boolean;
  cardTargetedStakeholdersMap: Record<string, string[]>;
  intelItems?: IntelItem[];
  graphState?: any;
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
}: EngagementCardTargetModalProps) {
  const [selectedStakeholderIds, setSelectedStakeholderIds] = useState<string[]>([]);
  const [selectedIntelId, setSelectedIntelId] = useState<string | null>(null);
  const [selectedStakeholderFilter, setSelectedStakeholderFilter] = useState<string>("ALL");
  const [isClosing, setIsClosing] = useState(false);
  const [tooltipLayer, setTooltipLayer] = useState<HTMLDivElement | null>(null);

  // Reset selections upon modal opening or card switch
  useEffect(() => {
    if (isOpen && card) {
      if (card.stakeholder_selection_amount === -1) {
        const lockedIds = cardTargetedStakeholdersMap[card.id] || [];
        const activeIds = availableStakeholderList
          .filter(isStakeholderActive)
          .map((st: any) => st.id)
          .filter((id: string) => !lockedIds.includes(id));
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
  const selectableStakeholders = activeStakeholders.filter(
    (st: any) => !targetedStakeholderIds.includes(st.id)
  );
  const requiredAmount = isIntelCard
    ? 1
    : isAllStakeholdersCard
    ? selectableStakeholders.length
    : Math.min(card.stakeholder_selection_amount, selectableStakeholders.length);

  const subtitle = isIntelCard
    ? "Select an unverified dossier finding to authenticate with this engagement card."
    : isAllStakeholdersCard
    ? `All ${requiredAmount} active team stakeholders are selected by default. Confirm below to initiate the sync.`
    : `Choose ${requiredAmount} stakeholder${requiredAmount > 1 ? "s" : ""} to initiate direct dialogue and uncover requirements.`;

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

  const isIntelConfirmed = (item: IntelItem) => {
    const conf = (item.intel_type || "").toLowerCase();
    return conf === "verified" || conf === "confirmed" || conf === "on_record";
  };

  const handleToggleIntel = (item: IntelItem) => {
    if (isIntelConfirmed(item)) return;

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
                {subtitle}
              </p>
            </div>

            <div className={styles.headerBadges}>
              <HoverTooltip description={`${card.token_cost} Attention Tokens required`} portalTarget={tooltipLayer}>
                <div className={styles.costBadge}>
                  <Icon icon="ph:coin-fill" style={{ color: "var(--token-color)" }} />
                  <span>{card.token_cost} Cost</span>
                </div>
              </HoverTooltip>
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
                    <strong>
                      {isIntelCard
                        ? "Direct Verification:"
                        : "Dialogue & Intel:"}
                    </strong>{" "}
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
                    <strong>Challenge Limit:</strong>{" "}
                    <span>
                      {isIntelCard
                        ? "Already verified intel items cannot be verified again."
                        : "Stakeholders already targeted by this card in this challenge are locked."}
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
                      <span>
                        {isIntelCard
                          ? "Select Intel Item to Verify"
                          : "Available Stakeholders"}
                      </span>
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
                          <HoverTooltip description="Reset filter to show all stakeholders" portalTarget={tooltipLayer}>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary py-1 px-2"
                              style={{ fontSize: "0.72rem" }}
                              onClick={() => setSelectedStakeholderFilter("ALL")}
                            >
                              Clear
                            </button>
                          </HoverTooltip>
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
                        <h6 className={styles.emptyStateTitle}>No Intel Items Discovered Yet</h6>
                        <p className={styles.emptyStateSubtitle}>
                          Play research engagement cards to uncover stakeholder stances first.
                        </p>
                      </div>
                    ) : filteredIntelItems.length === 0 ? (
                      <div className={styles.emptyState}>
                        <Icon icon="ph:user-circle-bold" className={styles.emptyStateIcon} />
                        <h6 className={styles.emptyStateTitle}>No Intel for this Stakeholder</h6>
                        <p className={styles.emptyStateSubtitle}>
                          No discovered intel items match the selected stakeholder filter.
                        </p>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-info mt-2"
                          onClick={() => setSelectedStakeholderFilter("ALL")}
                        >
                          Show All Intel Items
                        </button>
                      </div>
                    ) : (
                      /* Intel Items Grid */
                      <div className={styles.intelGrid}>
                        {filteredIntelItems.map((item) => {
                          const isConfirmed = isIntelConfirmed(item);
                          const isSelected = selectedIntelId === item.id;
                          const isSelectable = !isConfirmed;
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
                                        isConfirmed ? styles.confirmationPillVerified : styles.confirmationPillUnconfirmed
                                      }`}
                                    >
                                      <Icon
                                        icon={isConfirmed ? "ph:certificate-duotone" : "ph:question-fill"}
                                        style={{ fontSize: "0.85rem" }}
                                      />
                                      <span>{isConfirmed ? "Confirmed" : "Unconfirmed"}</span>
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
                                    <Icon icon="ph:certificate-duotone" /> Already Verified
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
                        const isSelectable = !isAlreadyTargeted;
                        const stColor = getStakeholderColor(st);
                        const stAvatar = stakeholders[st.id]?.avatar || st.avatar;

                        return (
                          <HoverTooltip
                            key={st.id}
                            block
                            portalTarget={tooltipLayer}
                            description={isAlreadyTargeted ? undefined : `Click to ${isSelected ? "deselect" : "select"} ${st.name}`}
                          >
                          <div
                            className={`${styles.stakeholderCard} ${isSelected ? styles.stakeholderSelected : ""
                              } ${!isSelectable ? styles.stakeholderDisabled : ""}`}
                            onClick={() => isSelectable && handleToggleStakeholder(st.id)}
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
                                backgroundColor="#ffffff"
                                play_blink_animation={false}
                                size="100%"
                                title={st.name}
                              />
                            </div>

                            {/* Stakeholder Details */}
                            <div className={styles.stakeholderMeta}>
                              <div className={styles.stakeholderHeaderRow}>
                                <h6 className={styles.stakeholderName}>
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
                                    <span style={{ display: "inline-flex" }}>
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

                              {isAlreadyTargeted ? (
                                <span className={styles.lockedBadge}>
                                  <Icon icon="ph:lock-key-fill" /> This stakeholder was already targeted by this card in this challenge
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
                          </HoverTooltip>
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
        {/* Click-through layer for tooltips; the panel's transform would otherwise trap fixed children. */}
        <div ref={setTooltipLayer} className={styles.tooltipLayer} />
      </div>
    </Dialog>
  );
}
