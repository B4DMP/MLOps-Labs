import { Icon } from "@iconify/react";
import HoverTooltip from "./HoverToolTip";
import styles from "./EngagementCardComponent.module.css";
import type { EngagementCard } from "../types/EngagementCard";

export interface EngagementCardComponentProps {
  card: EngagementCard;
  is_minimized?: boolean;
  attentionTokens?: number;
  isSingleUseExhausted?: boolean;
  canAfford?: boolean;
  isEnabled?: boolean;
  isPreview?: boolean;
  isDragging?: boolean;
  onClick?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  className?: string;
}

export default function EngagementCardComponent({
  card,
  is_minimized = false,
  attentionTokens,
  isSingleUseExhausted = false,
  canAfford = true,
  isEnabled = true,
  isPreview = false,
  isDragging = false,
  onClick,
  onDragStart,
  onDragEnd,
  className = "",
}: EngagementCardComponentProps) {
  // Resolve card illustration: custom card.image, or eng_x.png by card.id, falling back to default sample
  const defaultSampleImage = `${import.meta.env.BASE_URL}graphics/cards/engagement_card_sample.jpg`;
  const cardImage = card.image
    ? (card.image.startsWith("http") || card.image.startsWith("/")
      ? card.image
      : `${import.meta.env.BASE_URL}${card.image.replace(/^\//, "")}`)
    : `${import.meta.env.BASE_URL}graphics/cards/${card.id}_sm.png`;

  const isPlayable = isEnabled && canAfford && !isSingleUseExhausted && !isPreview;

  const cardTooltip = isPreview
    ? undefined
    : !isEnabled
      ? "Interaction currently disabled"
      : isSingleUseExhausted
        ? "Already played in this phase (1x per phase limit)"
        : attentionTokens !== undefined && attentionTokens < card.token_cost
          ? `Requires ${card.token_cost} Attention Tokens (you have ${attentionTokens})`
          : `Drag to Pitch Deck / Chat or click to play ${card.title}`;

  return (
    <HoverTooltip description={isDragging ? undefined : cardTooltip}>
    <div
      draggable={isPlayable}
      onDragStart={isPlayable ? onDragStart : undefined}
      onDragEnd={isPlayable ? onDragEnd : undefined}
      onClick={isPlayable && onClick ? onClick : undefined}
      className={`
        ${styles.playingCard}
        ${is_minimized ? styles.minimizedCard : ""}
        ${isPlayable ? styles.playable : ""}
        ${!isPlayable && !isPreview ? styles.disabled : ""}
        ${isPreview ? styles.previewMode : ""}
        ${isDragging ? styles.dragging : ""}
        ${className}
      `}
    >
      {/* Inner printed card frame (pinstripe playing card design) */}
      <div className={styles.innerFrame}>
        {/* Top Header: Title & Attention Token Cost Gem */}
        <div className={styles.cardHeader}>
          <h6 className={styles.cardTitle}>
            {card.title}
          </h6>
          <HoverTooltip description={`${card.token_cost} Attention Tokens`}>
            <div className={styles.costBadge}>
              <Icon icon="ph:coin-fill" style={{ color: "var(--token-color)" }} />
              <span>{card.token_cost}</span>
            </div>
          </HoverTooltip>
        </div>

        {/* Card Artwork Illustration Window (omitted in compact/minimized view) */}
        {!is_minimized && (
          <div className={styles.artworkFrame}>
            <img
              src={cardImage}
              alt={card.title}
              className={styles.cardImage}
              draggable={false}
              onError={(e) => {
                const target = e.currentTarget;
                if (target.src.endsWith("_sm.png")) {
                  target.src = target.src.replace(/_sm\.png$/, ".png");
                } else if (target.src.endsWith(".png")) {
                  target.src = target.src.replace(/\.png$/, ".jpg");
                } else if (target.src.endsWith("_sm.jpg")) {
                  target.src = target.src.replace(/_sm\.jpg$/, ".jpg");
                } else if (!target.src.includes("engagement_card_sample.jpg")) {
                  target.src = defaultSampleImage;
                }
              }}
            />

            {/* Target Type Pill */}
            <div className={styles.artIconBadge}>
              <Icon icon={card.icon || "ph:cards-bold"} />
              <span>{card.target_type === "intel" ? "Intel" : "Dialogue"}</span>
            </div>


            {/* Drag Handle Indicator */}
            {isPlayable && (
              <Icon
                icon="teenyicons:drag-outline"
                className={styles.dragHandle}
              />
            )}
          </div>
        )}

        {/* Type & Mechanics Ribbon */}
        <div className={styles.typeRibbon}>
          <div className={styles.badgeGroup}>
            {/* Target Scope Badge */}
            {card.target_type === "intel" || card.id === "eng_0" ? (
              <span className={`${styles.metaBadge} ${styles.intelBadge}`}>
                <Icon icon="ph:seal-check-bold" />
                <span>Intel</span>
              </span>
            ) : card.stakeholder_selection_amount === -1 ? (
              <span className={`${styles.metaBadge} ${styles.targetBadge}`}>
                <Icon icon="ph:users-three-bold" />
                <span>All Team</span>
              </span>
            ) : card.stakeholder_selection_amount === 1 ? (
              <span className={`${styles.metaBadge} ${styles.targetBadge}`}>
                <Icon icon="ph:user-bold" />
                <span>1 Target</span>
              </span>
            ) : card.stakeholder_selection_amount > 1 ? (
              <span className={`${styles.metaBadge} ${styles.targetBadge}`}>
                <Icon icon="ph:users-bold" />
                <span>{card.stakeholder_selection_amount} Targets</span>
              </span>
            ) : null}

            {/* Turns Badge (D49) */}
            {card.target_type !== "intel" && (card.turns ?? 0) > 0 && (
              <HoverTooltip description={`Buys ${card.turns} turn${(card.turns ?? 1) > 1 ? "s" : ""} per target`}>
                <span className={`${styles.metaBadge} ${styles.intelBadge}`}>
                  <Icon icon="ph:files-bold" />
                  <span>+{card.turns}</span>
                </span>
              </HoverTooltip>
            )}
          </div>
        </div>

        {/* Rules & Effect Description Box */}
        <div className={styles.descriptionBox}>

          <p className={styles.descriptionText}>
            {card.description}
          </p>

        </div>
      </div>
    </div>
    </HoverTooltip>
  );
}
