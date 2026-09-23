import { useContext, useMemo } from "react";
import { Icon } from "@iconify/react";
import styles from "./ActionCardCardComponent.module.css";
import type { ActionCard } from "../types/ActionCard";
import { StakeholderContext, type Stakeholder } from "./StakeholderProvider";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import type { StakeholderAvatar } from "../types/StakeholderAvatar";
import { formatLevel, formatLevelCap, dedupeAtomicChanges } from "./ComposeActionProposalModal";
import { LEVEL_META } from "../utils/stageCanvas";
import HoverTooltip from "./HoverToolTip";

export interface IntelItem {
  id: string;
  requirement_id?: string;
  intel_type?: string;
  categorized_type?: string;
  description?: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
}

export interface ActionCardAddendum {
  id: string;
  title: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
  description: string;
  status: "attached" | "proposed" | "available";
  objection_resolved?: string;
}

export interface ActionCardCardComponentProps {
  card: ActionCard;
  intelItems?: IntelItem[];
  addendums?: ActionCardAddendum[];
  showAddendums?: boolean;
  stakeholders?: Record<string, Stakeholder>;
  getStakeholderColor?: (st: any) => string;
  onClick?: () => void;
  className?: string;
  isInteractive?: boolean;
  isMinimized?: boolean;
  onClose?: () => void;
}

export default function ActionCardCardComponent({
  card,
  intelItems = [],
  addendums,
  showAddendums = false,
  stakeholders: propStakeholders,
  getStakeholderColor: propGetColor,
  onClick,
  className = "",
  isInteractive = false,
  isMinimized = false,
  onClose,
}: ActionCardCardComponentProps) {
  const stakeholderCtx = useContext(StakeholderContext);
  const stakeholders = propStakeholders || stakeholderCtx?.stakeholders || {};

  // Resolve stakeholders whose intel items formed this action card
  const cardIntelIds = card.intel_ids || [];
  const matchedIntels = intelItems.filter(
    (i) => cardIntelIds.includes(i.id)
  );

  // Group unique contributing stakeholders
  const contributingStakeholdersMap = new Map<
    string,
    { id: string; name: string; color: string; avatar?: StakeholderAvatar }
  >();
  matchedIntels.forEach((item) => {
    const stId = item.stakeholder_id;
    let st: Stakeholder | null = stId ? stakeholders[stId] || null : null;
    if (!st && stId) {
      st =
        Object.values(stakeholders).find(
          (s) => s.id === stId || s.id?.toLowerCase() === stId.toLowerCase()
        ) || null;
    }
    if (!st && item.stakeholder_name) {
      st =
        Object.values(stakeholders).find(
          (s) => s.name?.toLowerCase() === item.stakeholder_name?.toLowerCase()
        ) || null;
    }
    const key = stId || item.stakeholder_name || "stakeholder";
    if (!contributingStakeholdersMap.has(key)) {
      const name = item.stakeholder_name || st?.name || "Stakeholder";
      const color = st
        ? propGetColor
          ? propGetColor(st)
          : st.stakeholder_color || "var(--primary-bg)"
        : "var(--primary-bg)";
      contributingStakeholdersMap.set(key, {
        id: key,
        name,
        color,
        avatar: st?.avatar,
      });
    }
  });

  const contributingStakeholders = Array.from(contributingStakeholdersMap.values());

  // A saved proposal can carry two slots for the same target (see dedupeAtomicChanges) -
  // deduped before it's ever rendered as two identical-looking rows.
  const atomicChanges = useMemo(() => dedupeAtomicChanges(card.atomic_changes || []), [card.atomic_changes]);

  if (isMinimized) {
    const progressLabel =
      atomicChanges.length > 0
        ? `${atomicChanges.length}/3 Changes`
        : addendums && addendums.length > 0
        ? `${addendums.filter((a) => a.status === "attached").length}/2 Addendums`
        : null;

    return (
      <div
        onClick={isInteractive && onClick ? onClick : undefined}
        className={`${styles.cardContainer} ${styles.minimizedCard} ${styles.minimizedPanel} ${
          isInteractive ? styles.interactive : ""
        } ${className}`}
      >
        <div className={styles.minimizedHeader}>
          <span className={styles.minimizedEyebrow}>
            <Icon icon="ph:git-merge-bold" className={styles.minimizedEyebrowIcon} />
            <span>Action Proposal</span>
          </span>
          {progressLabel && <span className={styles.minimizedProgressPill}>{progressLabel}</span>}
        </div>

        <div className={styles.minimizedBody}>
          {atomicChanges.length > 0 ? (
            atomicChanges.map((ac, idx) => {
              const name =
                card.target_names?.[ac.target] ||
                ac.target.split(".").pop()?.replace(/_/g, " ") ||
                ac.target;
              const pred = card.predictions?.find((p) => p.target === ac.target);
              const level = pred?.predicted ?? ac.value;
              const meta = typeof level === "number" ? LEVEL_META[Math.max(0, Math.min(4, level))] : undefined;
              return (
                <div
                  key={idx}
                  className={styles.changeRow}
                  style={meta ? ({ "--change-color": meta.color, "--change-ink": meta.ink } as React.CSSProperties) : undefined}
                >
                  <div style={{ maxWidth: "50%", minWidth: 0, flex: 1 }}>
                    <HoverTooltip description={name}>
                      <span className={`${styles.changeName} text-truncate`}>
                        <Icon icon="ph:lightning-fill" className={styles.changeNameIcon} />
                        <span className="text-truncate">{name}</span>
                      </span>
                    </HoverTooltip>
                  </div>
                  {pred?.upstream_uncertain ? (
                    <span className={`${styles.changeBadge} ${styles.changeBadgeWarning}`}>
                      <Icon icon="ph:question-fill" /> Uncertain
                    </span>
                  ) : pred?.capped_by ? (
                    <span className={`${styles.changeBadge} ${styles.changeBadgeCapped}`}>
                      <Icon icon="ph:link-simple-bold" /> {formatLevelCap(pred.effective_predicted)}
                    </span>
                  ) : (
                    <span className={styles.changeBadge}>
                      {meta && <Icon icon={meta.icon} />} {formatLevelCap(level)}
                    </span>
                  )}
                </div>
              );
            })
          ) : (
            <HoverTooltip description={card.description}>
              <p className={styles.minimizedDescription}>{card.description}</p>
            </HoverTooltip>
          )}

          {addendums && addendums.length > 0 && (
            <div className={styles.stakeholdersRow}>
              <Icon icon="ph:puzzle-piece-fill" style={{ color: "var(--primary-bg)" }} />
              <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--primary-bg)" }}>
                {addendums.filter((a) => a.status === "attached").length} / 2 Slots
              </span>
            </div>
          )}

          <div className={styles.minimizedFooter}>
            <span>Click to expand</span>
            <Icon icon="ph:arrow-right-bold" className={styles.minimizedFooterIcon} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={isInteractive && onClick ? onClick : undefined}
      className={`card shadow-sm rounded-2 overflow-hidden ${styles.cardContainer} ${styles.maximizedCard} ${
        isInteractive ? styles.interactive : ""
      } ${className}`}
      style={{
        background: "#ffffff",
        border: "1px solid #dee2e6",
      }}
    >
      {/* Card Header matching ChallengeDescriptionCard with card title in header */}
      <div
        className="card-header py-2 px-3 d-flex align-items-center justify-content-between gap-2"
        style={{ background: "var(--primary-bg)", color: "white" }}
      >
        <span
          className="fw-bold text-center flex-grow-1"
          style={{
            color: "white",
            fontSize: "0.98rem",
            lineHeight: 1.3,
            whiteSpace: "normal",
            wordBreak: "break-word",
          }}
        >
          {card.title}
        </span>
        <div className="d-flex align-items-center gap-1 flex-shrink-0">
          <span
            className="badge"
            style={{
              color: "rgba(255, 255, 255, 0.9)",
              background: "rgba(255, 255, 255, 0.18)",
              fontSize: "0.72rem",
              whiteSpace: "nowrap",
            }}
          >
            Action Card
          </span>
          {onClose && (
            <button
              type="button"
              className="btn-close btn-close-white ms-1"
              style={{ fontSize: "0.65rem" }}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              aria-label="Close"
            />
          )}
        </div>
      </div>

      {/* Card Body */}
      <div
        className="card-body bg-white text-dark py-3 px-3 d-flex flex-column gap-2"
        style={{ overflowY: "auto" }}
      >
        <>
            {/* Atomic Changes Section in Maximized Card */}
            {atomicChanges.length > 0 && (
              <div className="d-flex flex-column gap-2 p-2 rounded mb-2" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <span className="fw-bold" style={{ fontSize: "0.78rem", color: "var(--primary-bg)" }}>
                  <Icon icon="ph:git-merge-bold" className="me-1" />
                  Configured Atomic Changes ({atomicChanges.length}/3):
                </span>
                {atomicChanges.map((ac, idx) => {
                  const name =
                    card.target_names?.[ac.target] ||
                    ac.target.split(".").pop()?.replace(/_/g, " ") ||
                    ac.target;
                  const pred = card.predictions?.find((p) => p.target === ac.target);
                  return (
                    <div
                      key={idx}
                      className="d-flex flex-column gap-1 p-2 rounded bg-white border"
                      style={{ fontSize: "0.75rem" }}
                    >
                      <div className="d-flex align-items-center justify-content-between">
                        <span className="fw-bold text-dark">
                          ⚡ {name}
                        </span>
                        <span className="badge bg-primary">
                          Advance to {formatLevelCap(pred?.predicted ?? ac.value)}
                        </span>
                      </div>
                      {pred?.upstream_uncertain && (
                        <div className="text-warning fw-semibold" style={{ fontSize: "0.7rem" }}>
                          ❓ Functional Status Uncertain: Upstream predecessor is undiscovered.
                        </div>
                      )}
                      {pred?.capped_by && (
                        <div className="text-danger fw-semibold" style={{ fontSize: "0.7rem" }}>
                          ⛓ Bottlenecked: Functional throughput capped at "{formatLevel(pred.effective_predicted)}" by {pred.capped_by}.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* Contributing Stakeholders Section */}
            {contributingStakeholders.length > 0 && (
              <div className={styles.stakeholdersRow}>
                <span className={styles.stakeholdersLabel}>Intel from:</span>
                <div className={styles.stakeholderChips}>
                  {contributingStakeholders.map((st) => (
                    <span
                      key={st.id}
                      className={styles.stakeholderChip}
                      style={{
                        backgroundColor: `${st.color}18`,
                        borderColor: `${st.color}55`,
                        color: st.color,
                      }}
                    >
                      <div
                        className={styles.avatarMini}
                        style={{
                          backgroundColor: st.color,
                          border: `1px solid ${st.color}`,
                        }}
                      >
                        <StakeholderAvatarComponent
                          avatar={st.avatar}
                          stakeholderColor={st.color}
                          stakeholderId={st.id}
                          isFramed={true}
                          play_blink_animation={false}
                          size="100%"
                          title={st.name}
                        />
                      </div>
                      <span>{st.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Rules & Effect Description Box */}
            <div className={styles.descriptionBox}>
              <p className={styles.descriptionText}>{card.description}</p>
            </div>

            {/* Attached Addendums & Proposal Modifiers Section */}
            {showAddendums && (
              <div className={styles.addendumsSection}>
                <div className={styles.addendumsHeader}>
                  <h6 className={styles.addendumsTitle}>
                    <Icon icon="ph:puzzle-piece-fill" /> Attached Addendums & Modifiers
                  </h6>
                  <span className={styles.addendumsBadge}>
                    {(addendums || []).filter((a) => a.status === "attached").length} / 2 Slots
                  </span>
                </div>

                <div className={styles.addendumsList}>
                  {(addendums && addendums.length > 0
                    ? addendums
                    : [
                        {
                          id: "placeholder_1",
                          title: "Continuous Drift Alerting & Fallback SLA",
                          stakeholder_name: "Security Manager",
                          status: "attached" as const,
                          objection_resolved: "Compliance & Pipeline Safety",
                          description:
                            "Execute base pipeline deployment, but enforce automated daily schema validation and instant rollback triggers to prevent unverified model shifts.",
                        },
                        {
                          id: "placeholder_2",
                          title: "Sub-45ms Inferencing Latency Guarantee",
                          stakeholder_name: "Lead Data Scientist",
                          status: "attached" as const,
                          objection_resolved: "Live Latency Degradation",
                          description:
                            "Allocate local cache partitions and GPU batching to guarantee <45ms response times under peak customer traffic.",
                        },
                      ]
                  ).map((addendum) =>
                    addendum.status === "available" ? (
                      <div key={addendum.id} className={styles.addendumCardSlot}>
                        <span>{addendum.title}</span>
                        <span className="badge bg-secondary" style={{ fontSize: "0.55rem" }}>
                          Open Slot
                        </span>
                      </div>
                    ) : (
                      <div key={addendum.id} className={styles.addendumCard}>
                        <div className={styles.addendumCardTop}>
                          <span className={styles.addendumCardTitle}>{addendum.title}</span>
                          {addendum.stakeholder_name && (
                            <span className={styles.addendumProposerBadge}>
                              {addendum.stakeholder_name}
                            </span>
                          )}
                        </div>
                        {addendum.objection_resolved && (
                          <div className={styles.addendumObjection}>
                            Resolved: {addendum.objection_resolved}
                          </div>
                        )}
                        <p className={styles.addendumCardText}>{addendum.description}</p>
                      </div>
                    )
                  )}
                </div>

                <div className={styles.proposalExplainer}>
                  <strong>Action Proposal:</strong> Combines the Base Action Card with
                  stakeholder-negotiated addendums. High-power buy-in ensures execution in Simulation
                  without sabotage.
                </div>
              </div>
            )}
        </>
      </div>
    </div>
  );
}
