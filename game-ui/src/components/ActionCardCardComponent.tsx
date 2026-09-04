import { useContext } from "react";
import styles from "./ActionCardCardComponent.module.css";
import type { ActionCard } from "../types/ActionCard";
import { StakeholderContext, type Stakeholder } from "./StakeholderProvider";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import type { StakeholderAvatar } from "../types/StakeholderAvatar";

export interface IntelItem {
  id: string;
  requirement_id?: string;
  intel_type?: string;
  categorized_type?: string;
  description?: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
}

export interface ActionCardCardComponentProps {
  card: ActionCard;
  intelItems?: IntelItem[];
  stakeholders?: Record<string, Stakeholder>;
  getStakeholderColor?: (st: any) => string;
  onClick?: () => void;
  className?: string;
  isInteractive?: boolean;
}

export default function ActionCardCardComponent({
  card,
  intelItems = [],
  stakeholders: propStakeholders,
  getStakeholderColor: propGetColor,
  onClick,
  className = "",
  isInteractive = false,
}: ActionCardCardComponentProps) {
  const stakeholderCtx = useContext(StakeholderContext);
  const stakeholders = propStakeholders || stakeholderCtx?.stakeholders || {};

  // Resolve stakeholders whose intel items formed this action card
  const cardIntelIds = card.intel_ids || [];
  const matchedIntels = intelItems.filter((i) =>
    cardIntelIds.includes(i.id) || (i.requirement_id && cardIntelIds.includes(i.requirement_id))
  );

  // Group unique contributing stakeholders
  const contributingStakeholdersMap = new Map<
    string,
    { id: string; name: string; color: string; avatar?: StakeholderAvatar }
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
      const color = st
        ? (propGetColor ? propGetColor(st) : st.stakeholder_color || "var(--primary-bg)")
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
      className={`
        ${styles.actionCard}
        ${isInteractive ? styles.interactive : ""}
        ${className}
      `}
      title={`${card.title} - ${card.description}`}
    >
      {/* Inner printed card frame (pinstripe playing card design matching Engagement cards) */}
      <div className={styles.innerFrame}>
        {/* Top Header: Full Title & Category Label */}
        <div className={styles.cardHeader}>
          <span className={styles.categoryLabel}>Action Card</span>
          <h6 className={styles.cardTitle}>
            {card.title}
          </h6>
        </div>

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
                    backgroundColor: `${st.color}1f`,
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

        {/* Rules & Effect Description Box: Full Description without truncation */}
        <div className={styles.descriptionBox}>
          <p className={styles.descriptionText}>
            {card.description}
          </p>
        </div>
      </div>
    </div>
  );
}
