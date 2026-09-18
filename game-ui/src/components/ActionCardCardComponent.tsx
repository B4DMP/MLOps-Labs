import { useContext } from "react";
import { Icon } from "@iconify/react";
import styles from "./ActionCardCardComponent.module.css";
import type { ActionCard } from "../types/ActionCard";
import { StakeholderContext, type Stakeholder } from "./StakeholderProvider";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import type { StakeholderAvatar } from "../types/StakeholderAvatar";
import { formatLevel, formatLevelCap } from "./ComposeActionProposalModal";

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

  return (
    <div
      onClick={isInteractive && onClick ? onClick : undefined}
      className={`card shadow-sm rounded-2 overflow-hidden ${styles.cardContainer} ${
        isMinimized ? styles.minimizedCard : styles.maximizedCard
      } ${isInteractive ? styles.interactive : ""} ${className}`}
      style={{
        background: "#ffffff",
        border: "1px solid #dee2e6",
      }}
      title={`${card.title} - ${card.description}`}
    >
      {/* Card Header matching ChallengeDescriptionCard with card title in header */}
      <div
        className={`card-header ${isMinimized ? "py-1 px-2" : "py-2 px-3"} d-flex align-items-center justify-content-between gap-2`}
        style={{ background: "var(--primary-bg)", color: "white" }}
      >
        <span
          className={`fw-bold text-center flex-grow-1 ${isMinimized ? "text-truncate" : ""}`}
          style={{
            color: "white",
            fontSize: isMinimized ? "0.82rem" : "0.98rem",
            lineHeight: 1.3,
            whiteSpace: isMinimized ? undefined : "normal",
            wordBreak: isMinimized ? undefined : "break-word",
          }}
          title={card.title}
        >
          {card.title}
        </span>
        <div className="d-flex align-items-center gap-1 flex-shrink-0">
          <span
            className="badge"
            style={{
              color: "rgba(255, 255, 255, 0.9)",
              background: "rgba(255, 255, 255, 0.18)",
              fontSize: isMinimized ? "0.62rem" : "0.72rem",
              whiteSpace: "nowrap",
            }}
          >
            {isMinimized && card.atomic_changes && card.atomic_changes.length > 0
              ? `${card.atomic_changes.length}/3 Changes`
              : isMinimized && addendums && addendums.length > 0
              ? `${addendums.filter((a) => a.status === "attached").length}/2 Addendums`
              : "Action Card"}
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
        className={`card-body bg-white text-dark ${
          isMinimized ? "py-2 px-2" : "py-3 px-3"
        } d-flex flex-column gap-2`}
        style={!isMinimized ? { overflowY: "auto" } : undefined}
      >
        {isMinimized ? (
          <>
            {card.atomic_changes && card.atomic_changes.length > 0 ? (
              <div className="d-flex flex-column gap-1 mb-1">
                {card.atomic_changes.map((ac, idx) => {
                  const name =
                    card.target_names?.[ac.target] ||
                    ac.target.split(".").pop()?.replace(/_/g, " ") ||
                    ac.target;
                  const pred = card.predictions?.find((p) => p.target === ac.target);
                  return (
                    <div
                      key={idx}
                      className="d-flex align-items-center justify-content-between px-2 py-1 rounded"
                      style={{ background: "#f8fafc", border: "1px solid #e2e8f0", fontSize: "0.68rem" }}
                    >
                      <span className="fw-bold text-truncate" style={{ maxWidth: "55%" }} title={name}>
                        ⚡ {name}
                      </span>
                      {pred?.upstream_uncertain ? (
                        <span className="badge bg-warning text-dark" style={{ fontSize: "0.55rem" }}>
                          ❓ Uncertain
                        </span>
                      ) : pred?.capped_by ? (
                        <span className="badge bg-secondary" style={{ fontSize: "0.55rem" }}>
                          ⛓ Capped: {formatLevelCap(pred.effective_predicted)}
                        </span>
                      ) : (
                        <span className="badge bg-success" style={{ fontSize: "0.55rem" }}>
                          Advance to {formatLevelCap(pred?.predicted ?? ac.value)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p
                className="card-text text-secondary mb-1 text-center"
                style={{
                  fontSize: "0.72rem",
                  lineHeight: 1.3,
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={card.description}
              >
                {card.description}
              </p>
            )}

            {addendums && addendums.length > 0 ? (
              <div
                className="d-flex align-items-center justify-content-between pt-1 mt-auto border-top"
                style={{ borderColor: "#e2e8f0" }}
              >
                <div
                  className="d-flex align-items-center gap-1"
                  style={{
                    fontSize: "0.62rem",
                    color: "var(--primary-bg)",
                    fontWeight: 700,
                  }}
                >
                  <Icon icon="ph:puzzle-piece-fill" />
                  <span>
                    {addendums.filter((a) => a.status === "attached").length} / 2 Slots
                  </span>
                </div>
                <span
                  className="small"
                  style={{
                    fontSize: "0.6rem",
                    color: "var(--primary-bg)",
                    fontWeight: 600,
                  }}
                >
                  Click to expand ➔
                </span>
              </div>
            ) : (
              <div
                className="text-center pt-1 mt-auto border-top"
                style={{
                  borderColor: "#e2e8f0",
                  fontSize: "0.62rem",
                  color: "var(--primary-bg)",
                  fontWeight: 600,
                }}
              >
                Click to expand ➔
              </div>
            )}
          </>
        ) : (
          <>
            {/* Atomic Changes Section in Maximized Card */}
            {card.atomic_changes && card.atomic_changes.length > 0 && (
              <div className="d-flex flex-column gap-2 p-2 rounded mb-2" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <span className="fw-bold" style={{ fontSize: "0.78rem", color: "var(--primary-bg)" }}>
                  <Icon icon="ph:git-merge-bold" className="me-1" />
                  Configured Atomic Changes ({card.atomic_changes.length}/3):
                </span>
                {card.atomic_changes.map((ac, idx) => {
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
                          ❓ Functional Status Uncertain: Upstream predecessor in Fog of War.
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
        )}
      </div>
    </div>
  );
}
