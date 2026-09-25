import { Icon } from "@iconify/react";
import type { ActionCard } from "../types/ActionCard";
import styles from "./ActionCardComponent.module.css";
import { useContext } from "react";
import { StakeholderContext, type Stakeholder } from "./StakeholderProvider";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";

export interface IntelItem {
  id: string;
  requirement_id?: string;
  intel_type?: string;
  categorized_type?: string;
  description?: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
}

interface ActionCardProps {
  id: string | number;
  ac: ActionCard;
  current_phase: number;
  tutorial_card?: boolean;
  displayMetrics?: boolean;
  showValues?: boolean;
  highlight?: boolean;
  interactable?: boolean;
  hasDropIndicator?: boolean;
  intelItems?: IntelItem[];
}

export default function ActionCardComponent({
  id,
  ac,
  current_phase,
  highlight = false,
  interactable = true,
  hasDropIndicator = true,
  intelItems = [],
}: ActionCardProps) {
  const { stakeholders } = useContext(StakeholderContext);

  // Resolve contributing stakeholders if intel items are available
  const cardIntelIds = ac.intel_ids || [];
  const matchedIntels = intelItems.filter((i) =>
    cardIntelIds.includes(i.id)
  );

  const contributingStakeholdersMap = new Map<
    string,
    { id: string; name: string; color: string; stakeholder?: Stakeholder }
  >();
  matchedIntels.forEach((item) => {
    const stId = item.stakeholder_id;
    let st: Stakeholder | null = stId ? (stakeholders[stId] || null) : null;
    if (!st && stId) {
      st = Object.values(stakeholders).find(
        (s) => s.id === stId || s.id?.toLowerCase() === stId.toLowerCase()
      ) || null;
    }
    if (!st && item.stakeholder_name) {
      st = Object.values(stakeholders).find(
        (s) => s.name?.toLowerCase() === item.stakeholder_name?.toLowerCase()
      ) || null;
    }
    const key = stId || item.stakeholder_name || "stakeholder";
    if (!contributingStakeholdersMap.has(key)) {
      const name = item.stakeholder_name || st?.name || "Stakeholder";
      const color = st?.stakeholder_color || "var(--primary-bg)";
      contributingStakeholdersMap.set(key, { id: key, name, color, stakeholder: st || undefined });
    }
  });

  const contributingStakeholders = Array.from(contributingStakeholdersMap.values());

  const handleDragStart = (
    e: React.DragEvent,
    card: { id: string; ac: ActionCard; current_phase: number },
  ) => {
    e.dataTransfer.setData("cardId", card.id);
  };

  return (
    <>
      {hasDropIndicator && <DropIndicator beforeId={id} display={interactable} />}
      <div
        draggable={interactable}
        className={`${styles.cardContainer} ${(highlight && interactable) ? styles.highlighted : ""} ${interactable ? "" : styles.not_interactable}`}
        onDragStart={(e) =>
          handleDragStart(e, {
            id: id.toString(),
            ac,
            current_phase: current_phase,
          })
        }
      >
        <div
          className="card rounded-0 shadow-sm mb-0 flex-grow-1"
          style={{
            borderColor: "var(--primary-bg)",
            borderWidth: "3px",
          }}
        >
          <Icon icon="teenyicons:drag-outline" className={styles.dragIcon} />
          <div className="card-header rounded-0">
            <h5 className="card-title text-center fw-bold">{ac.title}</h5>
            {contributingStakeholders.length > 0 ? (
              <div className="d-flex align-items-center justify-content-center gap-1 flex-wrap mt-1">
                {contributingStakeholders.map((st) => (
                  <span
                    key={st.id}
                    className="badge d-inline-flex align-items-center gap-1"
                    style={{
                      backgroundColor: `${st.color}22`,
                      color: st.color,
                      border: `1px solid ${st.color}55`,
                      fontSize: "0.68rem",
                      padding: "1px 6px 1px 2px",
                      borderRadius: "999px",
                    }}
                  >
                    <div
                      style={{
                        width: "16px",
                        height: "16px",
                        borderRadius: "50%",
                        overflow: "hidden",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <StakeholderAvatarComponent
                        avatar={st.stakeholder?.avatar}
                        stakeholderColor={st.color}
                        stakeholderId={st.id}
                        isFramed={false}
                        play_blink_animation={false}
                        size="100%"
                        title={st.name}
                      />
                    </div>
                    <span>{st.name}</span>
                  </span>
                ))}
              </div>
            ) : (
              ac.intel_ids && ac.intel_ids.length > 0 && (
                <p className="text-muted small text-center mb-0">
                  <span className="badge bg-primary">
                    {ac.intel_ids.length} Intel Merged
                  </span>
                </p>
              )
            )}
          </div>

          <div className="card-body d-flex flex-column">
            <div className={`p-2 rounded mb-1 ${styles.descriptionBox}`}>
              <span
                style={{
                  fontSize: "0.85rem",
                  lineHeight: 1.2,
                  display: "block",
                }}
              >
                {ac.description}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export const DropIndicator = ({ beforeId, display }: { beforeId: string | number, display: boolean }) => {
  return (
    <div
      data-before={beforeId}
      className={`mx-1 rounded ${styles.dropIndicator}`}
      style={{
        width: "4px",
        minHeight: "400px",
        backgroundColor: display ? "var(--primary-bg)" : "transparent",
      }}
    />
  );
};
