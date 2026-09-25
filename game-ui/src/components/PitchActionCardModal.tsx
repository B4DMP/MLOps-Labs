import { useState, useEffect } from "react";
import {
  Dialog,
  DialogPanel,
  DialogBackdrop,
} from "@headlessui/react";
import { Icon } from "@iconify/react";
import styles from "./PitchActionCardModal.module.css";
import type { Stakeholder } from "./StakeholderProvider";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import { intelTagMeta, type IntelTag } from "../types/IntelTag";
import HoverTooltip from "./HoverToolTip";

export interface TradeOffBranch {
  name?: string;
  description: string;
  target?: string;
  level?: number;
  ops?: Array<{ kind: string; target: string; value: number }>;
}

export interface IntelItem {
  id: string;
  requirement_id?: string;
  type?: IntelTag;
  intel_type?: string;
  source?: string;
  categorized_type?: string;
  description: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
  branch_x?: TradeOffBranch | null;
  branch_y?: TradeOffBranch | null;
}

export interface PitchActionCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  intelItems: IntelItem[];
  initialSelectedIntelIds?: string[];
  initialTradeOffBranches?: Record<string, "X" | "Y">;
  onConfirmMerge: (selectedIntelIds: string[], tradeOffBranches: Record<string, "X" | "Y">) => void;
  stakeholders: Record<string, Stakeholder>;
  getStakeholderColor: (st: any) => string;
  boundaryWarnings?: Array<{ item_id: string; checkable: boolean; violated: boolean; target_name?: string | null }>;
}

const MAX_CARD_ITEMS = 5;

export default function PitchActionCardModal({
  isOpen,
  onClose,
  intelItems = [],
  initialSelectedIntelIds = [],
  initialTradeOffBranches = {},
  onConfirmMerge,
  stakeholders = {},
  getStakeholderColor,
  boundaryWarnings = [],
}: PitchActionCardModalProps) {
  const getItemType = (item: IntelItem): IntelTag => {
    const raw = (item.type || item.categorized_type || item.intel_type || "driver").toLowerCase();
    if (raw.includes("boundary")) return "boundary";
    if (raw.includes("trade")) return "trade_off";
    if (raw.includes("fact")) return "fact";
    return "driver";
  };

  const usableIntelItems = intelItems.filter((item) => getItemType(item) !== "fact");

  const [selectedIntelIds, setSelectedIntelIds] = useState<string[]>(initialSelectedIntelIds);
  const [tradeOffBranches, setTradeOffBranches] = useState<Record<string, "X" | "Y">>(initialTradeOffBranches);
  const [selectedStakeholderFilter, setSelectedStakeholderFilter] = useState<string>("ALL");
  const [selectedTagFilter, setSelectedTagFilter] = useState<Exclude<IntelTag, "fact"> | "all">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedIntelIds(initialSelectedIntelIds);
      setTradeOffBranches(initialTradeOffBranches);
      setSelectedStakeholderFilter("ALL");
      setSelectedTagFilter("all");
      setSearchQuery("");
      setIsClosing(false);
    }
  }, [isOpen, initialSelectedIntelIds, initialTradeOffBranches]);

  const handleRequestClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  };

  if (!isOpen) return null;

  const handleToggleIntel = (item: IntelItem) => {
    const type = getItemType(item);
    if (type === "fact") {
      return;
    }
    if (selectedIntelIds.includes(item.id)) {
      setSelectedIntelIds((prev) => prev.filter((id) => id !== item.id));
    } else {
      if (selectedIntelIds.length < MAX_CARD_ITEMS) {
        setSelectedIntelIds((prev) => [...prev, item.id]);
        if (type === "trade_off" && !tradeOffBranches[item.id]) {
          setTradeOffBranches((prev) => ({ ...prev, [item.id]: "X" }));
        }
      }
    }
  };

  const handleBranchChange = (itemId: string, branch: "X" | "Y", e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setTradeOffBranches((prev) => ({ ...prev, [itemId]: branch }));
  };

  const isValidSelection = selectedIntelIds.length >= 1 && selectedIntelIds.length <= MAX_CARD_ITEMS;

  const handleConfirm = () => {
    if (!isValidSelection) return;
    onConfirmMerge(selectedIntelIds, tradeOffBranches);
    handleRequestClose();
  };

  // Stakeholder filter options
  const stakeholderOptions = Array.from(
    new Set(usableIntelItems.map((item) => item.stakeholder_id).filter(Boolean) as string[])
  ).map((stId) => {
    const st = stakeholders[stId];
    const name = st?.name || usableIntelItems.find((i) => i.stakeholder_id === stId)?.stakeholder_name || stId;
    const count = usableIntelItems.filter((i) => i.stakeholder_id === stId).length;
    const selectedCount = selectedIntelIds.filter((id) => {
      const it = usableIntelItems.find((item) => item.id === id);
      return it && it.stakeholder_id === stId;
    }).length;
    return { id: stId, name, count, selectedCount };
  });

  const unassignedCount = usableIntelItems.filter((i) => !i.stakeholder_id).length;

  const filteredIntelItems = usableIntelItems.filter((item) => {
    const itemType = getItemType(item);
    if (selectedTagFilter !== "all" && itemType !== selectedTagFilter) {
      return false;
    }
    if (selectedStakeholderFilter !== "ALL") {
      if (selectedStakeholderFilter === "UNASSIGNED") {
        if (item.stakeholder_id) return false;
      } else if (item.stakeholder_id !== selectedStakeholderFilter) {
        return false;
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const descMatch = (item.description || "").toLowerCase().includes(q);
      const stNameMatch = (item.stakeholder_name || "").toLowerCase().includes(q);
      if (!descMatch && !stNameMatch) return false;
    }
    return true;
  });

  const getTagClass = (type: IntelTag) => {
    switch (type) {
      case "driver": return styles.tagDriver;
      case "boundary": return styles.tagBoundary;
      case "trade_off": return styles.tagTradeOff;
      case "fact": return styles.tagFact;
      default: return styles.tagDriver;
    }
  };

  const getConfirmationStatus = (item: IntelItem) => {
    const conf = (item.intel_type || "unconfirmed").toLowerCase();
    const isPublicRecord = (item.source || "").toLowerCase() === "public_record";
    if (conf === "verified" || conf === "confirmed" || conf === "on_record") {
      return {
        label: isPublicRecord || conf === "on_record" ? "On Record" : "Confirmed",
        className: styles.confirmationPillVerified,
        icon: "ph:seal-check-fill",
      };
    }
    return {
      label: "Unconfirmed",
      className: styles.confirmationPillUnconfirmed,
      icon: "ph:question-fill",
    };
  };

  const renderInteractiveTradeOffText = (
    item: IntelItem,
    isSelected: boolean,
    currentBranch: "X" | "Y"
  ) => {
    const speaker = item.stakeholder_name || "Stakeholder";

    const onSelectBranch = (branch: "X" | "Y", e: React.MouseEvent) => {
      e.stopPropagation();
      if (!selectedIntelIds.includes(item.id)) {
        if (selectedIntelIds.length < MAX_CARD_ITEMS) {
          setSelectedIntelIds((prev) => [...prev, item.id]);
          setTradeOffBranches((prev) => ({ ...prev, [item.id]: branch }));
        }
      } else {
        handleBranchChange(item.id, branch, e);
      }
    };

    if (item.branch_x?.description && item.branch_y?.description) {
      return (
        <span className={styles.inlineTradeOffSentence}>
          <span>{speaker} would compromise </span>
          <HoverTooltip description={isSelected && currentBranch !== "Y" ? "Active commitment" : "Select this commitment"}>
            <button
              type="button"
              className={`${styles.inlineBranchChip} ${styles.inlineBranchChipA} ${
                isSelected && currentBranch !== "Y" ? styles.inlineBranchActiveA : ""
              }`}
              onClick={(e) => onSelectBranch("X", e)}
            >
              <Icon
                icon={isSelected && currentBranch !== "Y" ? "ph:radio-button-fill" : "ph:circle"}
                className={styles.inlineRadioIcon}
              />
              <span>{item.branch_x.description}</span>
            </button>
          </HoverTooltip>
          <span> for </span>
          <HoverTooltip description={isSelected && currentBranch === "Y" ? "Active commitment" : "Select this commitment"}>
            <button
              type="button"
              className={`${styles.inlineBranchChip} ${styles.inlineBranchChipB} ${
                isSelected && currentBranch === "Y" ? styles.inlineBranchActiveB : ""
              }`}
              onClick={(e) => onSelectBranch("Y", e)}
            >
              <Icon
                icon={isSelected && currentBranch === "Y" ? "ph:radio-button-fill" : "ph:circle"}
                className={styles.inlineRadioIcon}
              />
              <span>{item.branch_y.description}</span>
            </button>
          </HoverTooltip>
          <span>.</span>
        </span>
      );
    }

    const text = item.description;
    const match = text.match(
      /^(.*?\b(?:would compromise|would trade|compromise|trade|compromised|traded)\s+)(.+?)(\s+for\s+)(.+?)(\.?)$/i
    );
    if (!match) {
      return text;
    }
    const [, prefix, partA, connector, partB, suffix] = match;

    return (
      <span className={styles.inlineTradeOffSentence}>
        {prefix}
        <HoverTooltip description={isSelected && currentBranch !== "Y" ? "Active commitment" : "Select this commitment"}>
          <button
            type="button"
            className={`${styles.inlineBranchChip} ${styles.inlineBranchChipA} ${
              isSelected && currentBranch !== "Y" ? styles.inlineBranchActiveA : ""
            }`}
            onClick={(e) => onSelectBranch("X", e)}
          >
            <Icon
              icon={isSelected && currentBranch !== "Y" ? "ph:radio-button-fill" : "ph:circle"}
              className={styles.inlineRadioIcon}
            />
            <span>{partA}</span>
          </button>
        </HoverTooltip>
        {connector}
        <HoverTooltip description={isSelected && currentBranch === "Y" ? "Active commitment" : "Select this commitment"}>
          <button
            type="button"
            className={`${styles.inlineBranchChip} ${styles.inlineBranchChipB} ${
              isSelected && currentBranch === "Y" ? styles.inlineBranchActiveB : ""
            }`}
            onClick={(e) => onSelectBranch("Y", e)}
          >
            <Icon
              icon={isSelected && currentBranch === "Y" ? "ph:radio-button-fill" : "ph:circle"}
              className={styles.inlineRadioIcon}
            />
            <span>{partB}</span>
          </button>
        </HoverTooltip>
        {suffix}
      </span>
    );
  };

  return (
    <Dialog open={isOpen} onClose={handleRequestClose} className="position-relative z-50">
      <DialogBackdrop className={`${styles.backdrop} ${isClosing ? styles.backdropClosing : ""}`} />

      <div className={styles.dialogWrapper} onClick={handleRequestClose}>
        <DialogPanel
          className={`${styles.panel} ${isClosing ? styles.panelClosing : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className={styles.header}>
            <div className={styles.titleArea}>
              <Icon icon="ph:cards-bold" className={styles.headerIcon} />
              <h5 className={styles.title}>Compose Action Proposal</h5>
            </div>
            <button
              type="button"
              className={styles.closeButton}
              onClick={handleRequestClose}
              aria-label="Close"
            >
              <Icon icon="ph:x-bold" />
            </button>
          </div>

          {/* Modal Body */}
          <div className={styles.modalBody}>
            {/* Directive Banner */}
            <div className={styles.directiveBanner}>
              <div className={styles.directiveHeader}>
                <Icon icon="ph:lightbulb-filament-bold" style={{ fontSize: "1.1rem", color: "#f59e0b" }} />
                <span>Select 1–{MAX_CARD_ITEMS} stance items (Drivers, Trade-Offs, Boundaries) to build your proposal.</span>
              </div>
              <div className={styles.slotsIndicator}>
                <span className={`${styles.slotCountBadge} ${isValidSelection ? styles.slotCountBadgeValid : styles.slotCountBadgeEmpty}`}>
                  {selectedIntelIds.length} / {MAX_CARD_ITEMS} Slots
                </span>
              </div>
            </div>

            {/* Filter Controls */}
            <div className={styles.filterRow}>
              {/* Category Chips */}
              <div className={styles.categoryChips}>
                {(["all", "driver", "trade_off", "boundary"] as const).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`${styles.filterChip} ${selectedTagFilter === tag ? styles.filterChipActive : ""}`}
                    onClick={() => setSelectedTagFilter(tag)}
                  >
                    {tag === "all" ? "All" : intelTagMeta(tag).label}
                  </button>
                ))}
              </div>

              {/* Stakeholder Dropdown Filter */}
              <div className="d-flex align-items-center gap-2 flex-wrap">
                {stakeholderOptions.length > 0 && (
                  <select
                    className="form-select form-select-sm"
                    style={{ width: "auto", minWidth: 170, fontSize: "0.78rem" }}
                    value={selectedStakeholderFilter}
                    onChange={(e) => setSelectedStakeholderFilter(e.target.value)}
                  >
                    <option value="ALL">All Stakeholders ({usableIntelItems.length})</option>
                    {stakeholderOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.name} ({opt.count}{opt.selectedCount > 0 ? ` • ${opt.selectedCount} selected` : ""})
                      </option>
                    ))}
                    {unassignedCount > 0 && (
                      <option value="UNASSIGNED">General / Environment ({unassignedCount})</option>
                    )}
                  </select>
                )}

                {/* Search */}
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Search intel..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Cards Scroll Container */}
            <div className={styles.cardsScrollContainer}>
              {filteredIntelItems.length === 0 ? (
                <div className={styles.emptyState}>
                  <Icon icon="ph:magnifying-glass-bold" className={styles.emptyStateIcon} />
                  <h6 className="fw-bold text-dark mb-1">No Matching Intel Items Found</h6>
                  <p className="small text-muted mb-0">
                    Play Engagement Cards to research and uncover stakeholder stances.
                  </p>
                </div>
              ) : (
                <div className={styles.intelGrid}>
                  {filteredIntelItems.map((item) => {
                    const itemType = getItemType(item);
                    const isSelected = selectedIntelIds.includes(item.id);
                    const isFull = selectedIntelIds.length >= MAX_CARD_ITEMS && !isSelected;
                    const meta = intelTagMeta(itemType);

                    const st = item.stakeholder_id ? stakeholders[item.stakeholder_id] : null;
                    const stColor = st ? getStakeholderColor(st) : "var(--primary-bg)";
                    const statusInfo = getConfirmationStatus(item);

                    const warn = boundaryWarnings.find((w) => w.item_id === item.id && w.checkable && w.violated);
                    const currentBranch = tradeOffBranches[item.id] || "X";

                    return (
                      <div
                        key={item.id}
                        className={`${styles.intelCard} ${isSelected ? styles.intelSelected : ""} ${
                          isFull ? styles.intelCardDisabled : ""
                        }`}
                        onClick={() => handleToggleIntel(item)}
                        title={
                          isFull
                            ? `Card slots full (${MAX_CARD_ITEMS} / ${MAX_CARD_ITEMS}). Deselect an item first.`
                            : undefined
                        }
                      >
                        <div className={styles.intelTopRow}>
                          <div className={styles.intelBadges}>
                            <span className={`${styles.categoryTag} ${getTagClass(itemType)}`}>
                              <Icon icon={meta.icon} />
                              <span>{meta.label}</span>
                            </span>

                            <span
                              className={`${styles.confirmationPill} ${statusInfo.className}`}
                            >
                              <Icon
                                icon={statusInfo.icon}
                                style={{ fontSize: "0.82rem" }}
                              />
                              <span>{statusInfo.label}</span>
                            </span>
                          </div>

                          <div className={styles.statusIndicator}>
                            {isSelected ? (
                              <Icon icon="ph:check-circle-fill" className={styles.checkedIcon} />
                            ) : (
                              <span className={styles.uncheckCircle} />
                            )}
                          </div>
                        </div>

                        <div className={styles.intelDescription}>
                          {itemType === "trade_off"
                            ? renderInteractiveTradeOffText(item, isSelected, currentBranch)
                            : item.description}
                        </div>

                        {/* Boundary Warning */}
                        {warn && (
                          <div className="small text-danger fw-bold d-flex align-items-center gap-1" style={{ fontSize: "0.72rem" }}>
                            <Icon icon="ph:warning-fill" />
                            <span>Warning: Proposal conflicts with a confirmed stakeholder boundary.</span>
                          </div>
                        )}

                        <div className={styles.intelFooterRow}>
                          <div className={styles.sourceWrapper}>
                            {st && (
                              <div
                                className={styles.avatarMini}
                                style={{
                                  backgroundColor: stColor,
                                  border: `1.5px solid ${stColor}`,
                                }}
                              >
                                <StakeholderAvatarComponent
                                  avatar={st.avatar}
                                  stakeholderColor={stColor}
                                  stakeholderId={st.id}
                                  isFramed={true}
                                  play_blink_animation={false}
                                  size="100%"
                                  title={st.name}
                                />
                              </div>
                            )}
                            <span>Source: {item.stakeholder_name || st?.name || "Dossier"}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className={styles.footer}>
            <div className={styles.footerHint}>
              <Icon icon="ph:info-bold" className={styles.footerHintIcon} />
              <span>
                {selectedIntelIds.length === 0
                  ? `Select at least 1 item to build your card (up to ${MAX_CARD_ITEMS}).`
                  : `${selectedIntelIds.length} item${selectedIntelIds.length === 1 ? "" : "s"} selected. Click Build to place card on pitch deck table.`}
              </span>
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
                disabled={!isValidSelection}
                onClick={handleConfirm}
              >
                <Icon icon="ph:cards-bold" />
                <span>Build Action Card ({selectedIntelIds.length})</span>
              </button>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
