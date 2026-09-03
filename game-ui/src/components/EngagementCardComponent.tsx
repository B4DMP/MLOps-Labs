import { Icon } from "@iconify/react";
import styles from "./EngagementCardComponent.module.css";
import type { EngagementCard } from "../types/EngagementCard";

export interface EngagementCardComponentProps {
  card: EngagementCard;
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
    : `${import.meta.env.BASE_URL}graphics/cards/${card.id}.png`;

  const isPlayable = isEnabled && canAfford && !isSingleUseExhausted && !isPreview;

  const cardTooltip = isPreview
    ? `${card.title} - ${card.description}`
    : !isEnabled
    ? "Interaction currently disabled"
    : isSingleUseExhausted
    ? "Already played in this phase (1x per phase limit)"
    : attentionTokens !== undefined && attentionTokens < card.token_cost
    ? `Requires ${card.token_cost} Attention Tokens (you have ${attentionTokens})`
    : `Drag to Pitch Deck / Chat or click to play ${card.title}`;

  return (
    <div
      draggable={isPlayable}
      onDragStart={isPlayable ? onDragStart : undefined}
      onDragEnd={isPlayable ? onDragEnd : undefined}
      onClick={isPlayable && onClick ? onClick : undefined}
      title={cardTooltip}
      className={`
        ${styles.playingCard}
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
          <h6 className={styles.cardTitle} title={card.title}>
            {card.title}
          </h6>
          <div className={styles.costBadge} title={`${card.token_cost} Attention Tokens`}>
            <Icon icon="ph:coin-fill" style={{ color: "var(--token-color)" }} />
            <span>{card.token_cost}</span>
          </div>
        </div>

        {/* Card Artwork Illustration Window */}
        <div className={styles.artworkFrame}>
          <img
            src={cardImage}
            alt={card.title}
            className={styles.cardImage}
            draggable={false}
            onError={(e) => {
              const target = e.currentTarget;
              if (target.src.endsWith(".png")) {
                target.src = target.src.replace(/\.png$/, ".jpg");
              } else if (!target.src.includes("engagement_card_sample.jpg")) {
                target.src = defaultSampleImage;
              }
            }}
          />

          {/* Archetype Icon Watermark Pill */}
          <div className={styles.artIconBadge}>
            <Icon icon={card.icon || "ph:cards-bold"} />
            <span>{card.target_type === "intel" ? "Intel" : "Dialogue"}</span>
          </div>

          {/* AI Generated Attribution */}
          <span className={styles.aiGeneratedLabel}>AI generated</span>

          {/* Drag Handle Indicator */}
          {isPlayable && (
            <Icon
              icon="teenyicons:drag-outline"
              className={styles.dragHandle}
              title="Drag to play"
            />
          )}
        </div>

        {/* Type & Mechanics Ribbon */}
        <div className={styles.typeRibbon}>
          <span className={styles.categoryLabel}>Engagement</span>
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

            {/* Intel Reveal Count Badge */}
            {card.target_type !== "intel" && (card.intel_reveal_count ?? 0) > 0 && (
              <span
                className={`${styles.metaBadge} ${styles.intelBadge}`}
                title={`Reveals ${card.intel_reveal_count} requirement${(card.intel_reveal_count ?? 1) > 1 ? "s" : ""} per stakeholder`}
              >
                <Icon icon="ph:files-bold" />
                <span>+{card.intel_reveal_count}</span>
              </span>
            )}
          </div>
        </div>

        {/* Rules & Effect Description Box */}
        <div className={styles.descriptionBox}>
          {isSingleUseExhausted ? (
            <span className={styles.exhaustedNotice}>
              <Icon icon="ph:warning-circle-bold" />
              Already played this phase (1x limit).
            </span>
          ) : (
            <p className={styles.descriptionText}>
              {card.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
