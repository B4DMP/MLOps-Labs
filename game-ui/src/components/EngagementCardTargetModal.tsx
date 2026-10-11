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
  /** When set, only these stakeholders are valid targets for the current card (e.g. Patience-Reset
   * only accepts a currently-impatient stakeholder). Every other stakeholder is disabled with its
   * own reason, independent of the "already targeted" lock. */
  eligibleStakeholderIds?: string[];
  /** Why a stakeholder outside `eligibleStakeholderIds` is disabled (default: not impatient). */
  ineligibleReason?: string;
  /** Hand the Pen: each stakeholder's Trust reading, shown on their row (the dossier's own words). */
  trustByStakeholder?: Record<string, "low" | "medium" | "high">;
  intelItems?: IntelItem[];
  graphState?: any;
  onConfirmStakeholders: (stakeholderIds: string[]) => void;
  onConfirmIntel: (intelItem: IntelItem) => void;
  getStakeholderColor: (st: any) => string;
  getTagBadgeColor?: (type: string) => string;
}

const TRUST_LABEL = { low: "Low", medium: "Medium", high: "High" } as const;

export default function EngagementCardTargetModal({
  isOpen,
  onClose,
  card,
  attentionTokens,
  stakeholders,
  availableStakeholderList,
  isStakeholderActive,
  cardTargetedStakeholdersMap,
  eligibleStakeholderIds,
  ineligibleReason,
  trustByStakeholder,
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
  // A repeatable-target card (Investigate Component, Patience-Reset) can address a stakeholder it
  // already targeted this challenge again, so it never locks them out here.
  const targetedStakeholderIds = card.repeatable_target ? [] : (cardTargetedStakeholdersMap[card.id] || []);
  const eligibleSet = eligibleStakeholderIds ? new Set(eligibleStakeholderIds) : null;
  const selectableStakeholders = activeStakeholders.filter(
    (st: any) => !targetedStakeholderIds.includes(st.id) && (!eligibleSet || eligibleSet.has(st.id))
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

  const rules = [
    {
      label: "Target Scope",
      text: isIntelCard
        ? "Select 1 unverified dossier finding to upgrade."
        : isAllStakeholdersCard
        ? `All ${requiredAmount} active team stakeholders are included in this sync.`
        : `Select exactly ${requiredAmount} active stakeholder${requiredAmount > 1 ? "s" : ""}.`,
    },
    {
      label: isIntelCard ? "Direct Verification" : card.effect_kind === "pen" ? "Their Draft" : "Dialogue & Intel",
      text: isIntelCard
        ? "Elevates finding certainty to Verified in the Stakeholder Dossier."
        : card.effect_kind === "pen"
        ? "They decide what to change and draft it into your plan at once. It is locked in, and it replaces your change on the same step if you have one."
        : card.turns !== undefined && card.turns > 0
        ? `Buys ${card.turns} turn${card.turns > 1 ? "s" : ""} per target: unconfirmed notes you hold are checked first, then new ones come up. Results land in your dossier.`
        : "Triggers targeted dialogue responses & steers engagement dynamics.",
    },
    {
      label: "Challenge Limit",
      text: isIntelCard
        ? "Already verified intel items cannot be verified again."
        : card.repeatable_target
        ? "Can be played on the same stakeholder again, but never asks the same question twice."
        : card.effect_kind === "pen"
        ? "The pen can be handed over once per phase."
        : "Stakeholders already targeted by this card in this challenge are locked.",
    },
  ];

  const showIntelFilter = isIntelCard && stakeholderOptions.length > 0;

  return (
    <Dialog open={isOpen} onClose={handleRequestClose} className="position-relative z-50">
      <DialogBackdrop className={`${styles.backdrop} ${isClosing ? styles.backdropClosing : ""}`} />

      <div className={styles.dialogWrapper}>
        <DialogPanel className={`${styles.panel} ${isClosing ? styles.panelClosing : ""}`}>
          <header className={styles.header}>
            <span className={styles.headerIconTile}>
              <Icon icon={card.icon || "ph:cards-bold"} />
            </span>
            <div className={styles.headerText}>
              <p className={styles.eyebrow}>{isIntelCard ? "Verify intel" : "Choose a target"}</p>
              <DialogTitle className={styles.headerTitle}>{card.title}</DialogTitle>
              <p className={styles.headerSubtitle}>{subtitle}</p>
            </div>
            <div className={styles.headerActions}>
              <HoverTooltip description={`${card.token_cost} Attention Tokens required`} portalTarget={tooltipLayer}>
                <div className={styles.costBadge}>
                  <Icon icon="ph:coin-fill" />
                  <span>{card.token_cost} Cost</span>
                </div>
              </HoverTooltip>
              <button type="button" className={styles.closeBtn} onClick={handleRequestClose} aria-label="Close dialog">
                <Icon icon="ph:x-bold" />
              </button>
            </div>
          </header>

          <div className={styles.body}>
            <aside className={styles.cardRail}>
              <div className={styles.cardPreview}>
                <EngagementCardComponent card={card} isPreview={true} attentionTokens={attentionTokens} />
              </div>
            </aside>

            <section className={styles.choices}>
              <div className={styles.choicesHead}>
                <h2 className={styles.sectionTitle}>
                  <Icon icon={isIntelCard ? "ph:files-bold" : "ph:users-three-bold"} className={styles.sectionIcon} />
                  <span>{isIntelCard ? "Select Intel Item to Verify" : "Available Stakeholders"}</span>
                </h2>

                <div className={styles.headTools}>
                  {showIntelFilter && (
                    <>
                      <label htmlFor="target-stakeholder-filter" className={styles.filterLabel}>
                        <Icon icon="ph:funnel-bold" />
                        Stakeholder:
                      </label>
                      <select
                        id="target-stakeholder-filter"
                        className={styles.select}
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
                          <button type="button" className={styles.ghostBtn} onClick={() => setSelectedStakeholderFilter("ALL")}>
                            Clear
                          </button>
                        </HoverTooltip>
                      )}
                    </>
                  )}

                  {isAllStakeholdersCard && selectedStakeholderIds.length < requiredAmount && (
                    <button
                      type="button"
                      className={styles.ghostBtn}
                      onClick={() => setSelectedStakeholderIds(selectableStakeholders.map((st: any) => st.id))}
                    >
                      Select All
                    </button>
                  )}
                  <span className={`${styles.countBadge} ${isSelectionValid ? styles.countValid : styles.countPending}`}>
                    <Icon icon={isSelectionValid ? "ph:check-circle-fill" : "ph:circle-dashed"} />
                    <span>
                      {isIntelCard
                        ? `${selectedIntelId ? 1 : 0} / 1 Selected`
                        : isAllStakeholdersCard
                        ? `${selectedStakeholderIds.length} / ${requiredAmount} Selected (All Team)`
                        : `${selectedStakeholderIds.length} / ${requiredAmount} Selected`}
                    </span>
                  </span>
                </div>
              </div>

              <div className={styles.choiceScroll}>
                {isIntelCard ? (
                  intelItems.length === 0 ? (
                    <div className={styles.emptyState}>
                      <Icon icon="ph:magnifying-glass-bold" className={styles.emptyStateIcon} />
                      <h3 className={styles.emptyStateTitle}>No Intel Items Discovered Yet</h3>
                      <p className={styles.emptyStateSubtitle}>
                        Play research engagement cards to uncover stakeholder stances first.
                      </p>
                    </div>
                  ) : filteredIntelItems.length === 0 ? (
                    <div className={styles.emptyState}>
                      <Icon icon="ph:user-circle-bold" className={styles.emptyStateIcon} />
                      <h3 className={styles.emptyStateTitle}>No Intel for this Stakeholder</h3>
                      <p className={styles.emptyStateSubtitle}>
                        No discovered intel items match the selected stakeholder filter.
                      </p>
                      <button type="button" className={styles.ghostBtn} onClick={() => setSelectedStakeholderFilter("ALL")}>
                        Show All Intel Items
                      </button>
                    </div>
                  ) : (
                    <div className={styles.intelGrid}>
                      {filteredIntelItems.map((item) => {
                        const isConfirmed = isIntelConfirmed(item);
                        const isSelected = selectedIntelId === item.id;
                        const catDetails = getCategoryDetails(item.categorized_type || "driver");

                        return (
                          <button
                            type="button"
                            key={item.id}
                            aria-pressed={isSelected}
                            aria-disabled={isConfirmed}
                            className={`${styles.tile} ${styles.tileIntel} ${isSelected ? styles.tileSelected : ""} ${
                              isConfirmed ? styles.tileDisabled : ""
                            }`}
                            onClick={() => handleToggleIntel(item)}
                          >
                            <span className={styles.intelTop}>
                              <span className={`${styles.categoryTag} ${catDetails.className}`}>
                                <Icon icon={catDetails.icon} />
                                <span>{catDetails.label}</span>
                              </span>
                              <span
                                className={`${styles.statusPill} ${
                                  isConfirmed ? styles.statusVerified : styles.statusUnconfirmed
                                }`}
                              >
                                <Icon icon={isConfirmed ? "ph:certificate-duotone" : "ph:question-fill"} />
                                <span>{isConfirmed ? "Confirmed" : "Unconfirmed"}</span>
                              </span>
                            </span>

                            <span className={styles.intelDescription}>{item.description}</span>

                            <span className={styles.tileFoot}>
                              {item.stakeholder_name ? (
                                <span className={styles.intelSource}>
                                  <Icon icon="ph:user-circle" />
                                  <span>Source: {item.stakeholder_name}</span>
                                </span>
                              ) : (
                                <span />
                              )}
                              {isConfirmed ? (
                                <span className={styles.lockedBadge}>
                                  <Icon icon="ph:certificate-duotone" /> Already Verified
                                </span>
                              ) : (
                                <span className={`${styles.indicator} ${isSelected ? styles.indicatorOn : ""}`}>
                                  {isSelected && <Icon icon="ph:check-bold" />}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )
                ) : (
                  <div className={styles.stakeholderGrid}>
                    {activeStakeholders.map((st) => {
                      const isSelected = selectedStakeholderIds.includes(st.id);
                      const isAlreadyTargeted = targetedStakeholderIds.includes(st.id);
                      const isIneligible = Boolean(eligibleSet) && !eligibleSet!.has(st.id);
                      const isSelectable = !isAlreadyTargeted && !isIneligible;
                      const stColor = getStakeholderColor(st);
                      const stAvatar = stakeholders[st.id]?.avatar || st.avatar;

                      return (
                        <HoverTooltip
                          key={st.id}
                          block
                          portalTarget={tooltipLayer}
                          description={!isSelectable ? undefined : `Click to ${isSelected ? "deselect" : "select"} ${st.name}`}
                        >
                          <button
                            type="button"
                            aria-pressed={isSelected}
                            aria-disabled={!isSelectable}
                            className={`${styles.tile} ${isSelected ? styles.tileSelected : ""} ${
                              !isSelectable ? styles.tileDisabled : ""
                            }`}
                            style={{ "--st-color": isSelectable ? stColor : "#94a3b8" } as React.CSSProperties}
                            onClick={() => isSelectable && handleToggleStakeholder(st.id)}
                          >
                            <span className={styles.avatar}>
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
                            </span>

                            <span className={styles.tileMeta}>
                              <span className={styles.name}>{st.name}</span>
                              {isAlreadyTargeted ? (
                                <span className={styles.lockedBadge}>
                                  <Icon icon="ph:lock-key-fill" /> This stakeholder was already targeted by this card in this challenge
                                </span>
                              ) : isIneligible ? (
                                <span className={styles.lockedBadge}>
                                  <Icon icon="ph:lock-key-fill" /> {ineligibleReason ?? "Not currently impatient"}
                                </span>
                              ) : (
                                <span className={styles.tagRow}>
                                  {st.power && (
                                    <span className={styles.chip}>
                                      <Icon icon="ph:lightning-bold" /> {st.power} Power
                                    </span>
                                  )}
                                  {st.interest && (
                                    <span className={styles.chip}>
                                      <Icon icon="ph:eye-bold" /> {st.interest} Interest
                                    </span>
                                  )}
                                  {trustByStakeholder?.[st.id] && (
                                    <span className={styles.chip}>
                                      <Icon icon="ph:handshake-bold" /> Trust: {TRUST_LABEL[trustByStakeholder[st.id]]}
                                    </span>
                                  )}
                                </span>
                              )}
                            </span>

                            {isSelectable ? (
                              <span className={`${styles.indicator} ${isSelected ? styles.indicatorOn : ""}`}>
                                {isSelected && <Icon icon="ph:check-bold" />}
                              </span>
                            ) : (
                              <span className={`${styles.indicator} ${styles.indicatorLocked}`}>
                                <Icon icon="ph:lock-key-fill" />
                              </span>
                            )}
                          </button>
                        </HoverTooltip>
                      );
                    })}
                  </div>
                )}
              </div>

              <ul className={styles.rules} aria-label="Card rules">
                {rules.map((rule, i) => (
                  <li key={rule.label} className={styles.rule}>
                    <span className={styles.stepBadge}>{i + 1}</span>
                    <span>
                      <strong>{rule.label}</strong>
                      {rule.text}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <footer className={styles.footer}>
            <div className={`${styles.footerHint} ${isSelectionValid ? styles.footerHintReady : ""}`}>
              <Icon icon={isSelectionValid ? "ph:check-circle-fill" : "ph:info-bold"} className={styles.footerHintIcon} />
              <span>{footerHint}</span>
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.cancelButton} onClick={handleRequestClose}>
                Cancel
              </button>
              <button type="button" className={styles.actionButton} disabled={!isSelectionValid} onClick={handleConfirm}>
                <Icon icon="ph:lightning-fill" />
                <span>Confirm & Play Card ({card.token_cost} Tokens)</span>
              </button>
            </div>
          </footer>
        </DialogPanel>
        {/* Click-through layer for tooltips; the panel's transform would otherwise trap fixed children. */}
        <div ref={setTooltipLayer} className={styles.tooltipLayer} />
      </div>
    </Dialog>
  );

}
