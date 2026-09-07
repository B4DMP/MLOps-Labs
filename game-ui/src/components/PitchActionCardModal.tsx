import { useState, useEffect } from "react";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  DialogBackdrop,
} from "@headlessui/react";
import { Icon } from "@iconify/react";
import styles from "./PitchActionCardModal.module.css";
import type { Stakeholder } from "./StakeholderProvider";
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

export interface PitchActionCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  intelItems: IntelItem[];
  initialSelectedIntelIds?: string[];
  onConfirmMerge: (selectedIntelIds: string[]) => void;
  stakeholders: Record<string, Stakeholder>;
  getStakeholderColor: (st: any) => string;
  getTagBadgeColor?: (type: string) => string;
  isGenerating?: boolean;
}

export default function PitchActionCardModal({
  isOpen,
  onClose,
  intelItems = [],
  initialSelectedIntelIds = [],
  onConfirmMerge,
  stakeholders,
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
  isGenerating = false,
}: PitchActionCardModalProps) {
  const [selectedIntelIds, setSelectedIntelIds] = useState<string[]>(initialSelectedIntelIds);
  const [selectedStakeholderFilter, setSelectedStakeholderFilter] = useState<string>("ALL");
  const [isClosing, setIsClosing] = useState(false);

  // Sync state upon opening or initialSelectedIntelIds change
  useEffect(() => {
    if (isOpen) {
      setSelectedIntelIds(initialSelectedIntelIds);
      setSelectedStakeholderFilter("ALL");
      setIsClosing(false);
    }
  }, [isOpen, initialSelectedIntelIds]);

  const handleRequestClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  };

  if (!isOpen) return null;

  const handleToggleIntel = (id: string) => {
    if (selectedIntelIds.includes(id)) {
      setSelectedIntelIds((prev) => prev.filter((item) => item !== id));
    } else {
      if (selectedIntelIds.length < 3) {
        setSelectedIntelIds((prev) => [...prev, id]);
      }
    }
  };

  const selectedItems = intelItems.filter((item) => selectedIntelIds.includes(item.id));
  const isValidSelection = selectedItems.length >= 1 && selectedItems.length <= 3;

  // Stakeholder filter options derived from intel findings
  const stakeholderOptions = Array.from(
    new Set(intelItems.map((item) => item.stakeholder_id).filter(Boolean) as string[])
  ).map((stId) => {
    const st = stakeholders[stId];
    const name = st?.name || intelItems.find((i) => i.stakeholder_id === stId)?.stakeholder_name || stId;
    const count = intelItems.filter((i) => i.stakeholder_id === stId).length;
    const selectedCount = selectedIntelIds.filter((id) => {
      const it = intelItems.find((item) => item.id === id);
      return it && it.stakeholder_id === stId;
    }).length;
    return { id: stId, name, count, selectedCount };
  });

  const unassignedCount = intelItems.filter((i) => !i.stakeholder_id).length;

  const filteredIntelItems = intelItems.filter((item) => {
    if (selectedStakeholderFilter === "ALL") return true;
    if (selectedStakeholderFilter === "UNASSIGNED") return !item.stakeholder_id;
    return item.stakeholder_id === selectedStakeholderFilter;
  });

  const handleConfirm = () => {
    if (!isValidSelection || isGenerating) return;
    onConfirmMerge(selectedIntelIds);
    handleRequestClose();
  };

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

  // Distinct stakeholders referenced by the selected intel items
  const referencedStakeholderIds = Array.from(
    new Set(selectedItems.map((i) => i.stakeholder_id).filter(Boolean) as string[])
  );

  // Dynamic synthesized proposal title
  const synthesizedProposalTitle = selectedItems.length > 0
    ? `Action Proposal: ${selectedItems
      .map((item) => (item.description.length > 22 ? item.description.slice(0, 22) + "..." : item.description))
      .join(" + ")}`
    : "Action Proposal (No Intel Merged Yet)";

  // Human-readable footer hint
  let footerHint = "";
  if (selectedItems.length === 0) {
    footerHint = "Select between 1 and 3 intel items from your dossier to build your Action Card.";
  } else if (selectedItems.length < 3) {
    footerHint = `${selectedItems.length} intel item${selectedItems.length > 1 ? "s" : ""} selected • You can select up to ${3 - selectedItems.length} more intel items${3 - selectedItems.length > 1 ? "s" : ""}.`;
  } else {
    footerHint = "Maximum 3 intel items selected • Ready to assemble your Action Card for the Pitch Debate.";
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
                <Icon icon="ph:cards-bold" className={styles.headerIcon} />
                <span>Build Action Proposal from Intel Items</span>
              </DialogTitle>
              <p className={styles.headerSubtitle}>
                Select 1 to 3 Intel Items to merge into your Base Action Card proposal for the upcoming Pitch Debate
              </p>
            </div>

            <div className={styles.headerBadges}>
              <span
                className={`${styles.selectionCountBadge} ${isValidSelection ? styles.selectionCountValid : styles.selectionCountPending
                  }`}
              >
                <Icon
                  icon={isValidSelection ? "ph:check-circle-fill" : "ph:circle-dashed"}
                  style={{ fontSize: "1rem" }}
                />
                <span>Selected: {selectedIntelIds.length} / 3</span>
              </span>

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

          {/* Modal Body: Strategy Banner at Top + Two-Column Layout */}
          <div className={styles.modalBody}>
            {/* Horizontal Strategy Directive Banner: full width across top of modal body */}
            <div className={styles.directiveBanner}>
              <div className={styles.directiveBannerHeader}>
                <Icon icon="ph:list-checks-bold" className={styles.directiveIcon} />
                <span>Proposal Synthesis Strategy</span>
              </div>

              <div className={styles.directiveStepsGrid}>
                <div className={styles.directiveStepItem}>
                  <span className={styles.stepBadge}>1</span>
                  <div className={styles.directiveStepContent}>
                    <strong>Select 1 to 3 Findings:</strong> Combine up to 3 Intel findings discovered from stakeholder research into your Action Card.
                  </div>
                </div>

                <div className={styles.directiveStepItem}>
                  <span className={styles.stepBadge}>2</span>
                  <div className={styles.directiveStepContent}>
                    <strong>Address Conflicting Stances:</strong> Targeting requirements from multiple stakeholders increases stakeholder consensus in the debate.
                  </div>
                </div>

                <div className={styles.directiveStepItem}>
                  <span className={styles.stepBadge}>3</span>
                  <div className={styles.directiveStepContent}>
                    <strong>Verified Impact:</strong> Verified findings carry higher certainty and sway during stakeholder pitch deliberations.
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.dossierGrid}>
              {/* Left Column: Action Card Synthesized Preview */}
              <div className={styles.previewColumn}>
                {/* Synthesized Action Card Preview */}
                <div className={styles.synthesizedCard}>
                  <div className={styles.synthesizedCardHeader}>
                    <div className={styles.synthesizedBadge}>
                      <Icon icon="ph:sparkle-fill" style={{ color: "white" }} />
                      <span>Synthesized Action Card</span>
                    </div>
                    <span className="badge bg-light text-dark" style={{ fontSize: "0.68rem" }}>
                      {selectedItems.length} Intel Item{selectedItems.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className={styles.synthesizedCardBody}>
                    <h6 className={styles.synthesizedTitle} title={synthesizedProposalTitle}>
                      {synthesizedProposalTitle}
                    </h6>

                    {/* Contributing Stakeholders Chips */}
                    {referencedStakeholderIds.length > 0 ? (
                      <div className={styles.stakeholderChipsRow}>
                        <span className="small text-muted" style={{ fontSize: "0.72rem" }}>
                          Targets:
                        </span>
                        {referencedStakeholderIds.map((stId) => {
                          const st = stakeholders[stId];
                          const color = st ? getStakeholderColor(st) : "var(--primary-bg)";
                          return (
                            <span
                              key={stId}
                              className={styles.stakeholderChip}
                              style={{ backgroundColor: color }}
                            >
                              <Icon icon="ph:user-bold" />
                              <span>{st?.name || stId}</span>
                            </span>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="small text-muted mb-0" style={{ fontSize: "0.74rem", fontStyle: "italic" }}>
                        Click findings on the right to attach stakeholder stances.
                      </p>
                    )}

                    {/* Merged Items Bullet List with auto-vertical expansion */}
                    {selectedItems.length > 0 && (
                      <div className={styles.mergedItemsList}>
                        {selectedItems.map((item) => {
                          const catType = item.categorized_type || (item as any).type || "requirement";
                          const catDetails = getCategoryDetails(catType);
                          const isVerified = (item.intel_type || (item as any).certainty || "").toLowerCase().includes("verified");

                          return (
                            <div key={item.id} className={styles.mergedItemRow}>
                              <span className={`${styles.categoryTag} ${catDetails.className}`}>
                                <Icon icon={catDetails.icon} />
                                <span>{catDetails.shortLabel}</span>
                              </span>
                              <span className={styles.mergedItemText}>{item.description}</span>
                              {isVerified && (
                                <span title="Verified Finding">
                                  <Icon
                                    icon="ph:seal-check-fill"
                                    className={styles.mergedVerifiedIcon}
                                  />
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Intel Findings Selection Grid */}
              <div className={styles.selectionColumn}>
                <div className={styles.selectionHeader}>
                  <div className="d-flex align-items-center gap-2">
                    <h6 className={styles.sectionTitle}>
                      <Icon icon="ph:notebook-bold" className={styles.sectionIcon} />
                      <span>Available Dossier Intel Items</span>
                    </h6>
                    {stakeholderOptions.length > 0 && (
                      <span className="badge bg-secondary" style={{ fontSize: "0.72rem" }}>
                        {filteredIntelItems.length} of {intelItems.length}
                      </span>
                    )}
                  </div>

                  <div className="d-flex align-items-center gap-2">
                    {stakeholderOptions.length > 0 && (
                      <div className="d-flex align-items-center gap-1">
                        <label htmlFor="stakeholder-filter" className={styles.filterLabel}>
                          <Icon icon="ph:funnel-bold" className="me-1" />
                          Stakeholder:
                        </label>
                        <select
                          id="stakeholder-filter"
                          className={`form-select form-select-sm ${styles.stakeholderFilterSelect}`}
                          value={selectedStakeholderFilter}
                          onChange={(e) => setSelectedStakeholderFilter(e.target.value)}
                        >
                          <option value="ALL">All Stakeholders ({intelItems.length})</option>
                          {stakeholderOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name} ({opt.count}{opt.selectedCount > 0 ? ` • ${opt.selectedCount} selected` : ""})
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
                    <span className="small text-muted ms-1">
                      (max 3)
                    </span>
                  </div>
                </div>

                <div className={styles.cardsScrollContainer}>
                  {intelItems.length === 0 ? (
                    <div className={styles.emptyState}>
                      <Icon icon="ph:magnifying-glass-bold" className={styles.emptyStateIcon} />
                      <h6 className="fw-bold text-dark mb-1">No Intel Items Discovered Yet</h6>
                      <p className="small text-muted mb-0">
                        Play Engagement Cards to research and uncover stakeholder stances.
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
                    <div className={styles.intelGrid}>
                      {filteredIntelItems.map((item) => {
                        const isSelected = selectedIntelIds.includes(item.id);
                        const catType = item.categorized_type || (item as any).type || "requirement";
                        const catDetails = getCategoryDetails(catType);
                        const certaintyLabel = item.intel_type || (item as any).certainty || "unconfirmed";
                        const isVerified = (certaintyLabel || "").toLowerCase().includes("verified");

                        const st = item.stakeholder_id ? stakeholders[item.stakeholder_id] : null;
                        const stColor = st ? getStakeholderColor(st) : "var(--primary-bg)";
                        const stAvatar = st?.avatar;

                        return (
                          <div
                            key={item.id}
                            className={`${styles.intelCard} ${isSelected ? styles.intelSelected : ""}`}
                            onClick={() => handleToggleIntel(item.id)}
                          >
                            <div className={styles.intelTopRow}>
                              <div className={styles.intelBadges}>
                                {/* Distinct Category Tag */}
                                <span className={`${styles.categoryTag} ${catDetails.className}`}>
                                  <Icon icon={catDetails.icon} />
                                  <span>{catDetails.label}</span>
                                </span>

                                {/* Distinct Confirmation Pill */}
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

                              <div className={styles.statusIndicator}>
                                {isSelected ? (
                                  <Icon icon="ph:check-circle-fill" className={styles.checkedIcon} />
                                ) : (
                                  <span className={styles.uncheckCircle} />
                                )}
                              </div>
                            </div>

                            <p className={styles.intelDescription}>
                              {item.description}
                            </p>

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
                                      avatar={stAvatar}
                                      stakeholderColor={stColor}
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
            </div>

            {/* Footer */}
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
                  disabled={!isValidSelection}
                  onClick={handleConfirm}
                >
                  <span>
                    Build Action Card
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
