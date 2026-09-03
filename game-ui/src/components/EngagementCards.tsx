import { useState } from "react";
import { Icon } from "@iconify/react";
import styles from "./EngagementCards.module.css";
import type { EngagementCard } from "../types/EngagementCard";
import EngagementCardComponent from "./EngagementCardComponent";

interface EngagementCardsProps {
  attentionTokens: number;
  cards?: EngagementCard[];
  playedCardIds?: string[];
  onSelectPrompt?: (prompt: string) => void;
  onSelectCard?: (card: EngagementCard) => void;
  onDragCardStart?: () => void;
  onDragCardEnd?: () => void;
  isEnabled?: boolean;
}

export default function EngagementCards({
  attentionTokens,
  cards,
  playedCardIds = [],
  onSelectPrompt,
  onSelectCard,
  onDragCardStart,
  onDragCardEnd,
  isEnabled = true,
}: EngagementCardsProps) {
  const activeCards: EngagementCard[] = cards && cards.length > 0 ? cards : [];
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);

  const handleCardClick = (card: EngagementCard) => {
    const isSingleUseExhausted =
      (card.max_plays_per_phase === 1 || card.stakeholder_selection_amount === -1) &&
      playedCardIds.includes(card.id);

    if (!isEnabled || attentionTokens < card.token_cost || isSingleUseExhausted) return;

    if (onSelectCard) {
      onSelectCard(card);
    } else if (onSelectPrompt) {
      onSelectPrompt(`${card.title} (${card.token_cost} 🪙) - ${card.description}`);
    }
  };

  const handleDragStart = (e: React.DragEvent, card: EngagementCard) => {
    const isSingleUseExhausted =
      (card.max_plays_per_phase === 1 || card.stakeholder_selection_amount === -1) &&
      playedCardIds.includes(card.id);

    if (!isEnabled || attentionTokens < card.token_cost || isSingleUseExhausted) {
      e.preventDefault();
      return;
    }

    e.dataTransfer.setData("engagementCardId", card.id);
    e.dataTransfer.setData("cardId", card.id);

    if (onDragCardStart) {
      onDragCardStart();
    }

    setTimeout(() => {
      setDraggingCardId(card.id);
    }, 0);
  };

  const handleDragEnd = () => {
    setDraggingCardId(null);
    if (onDragCardEnd) {
      onDragCardEnd();
    }
  };

  return (
    <div className={styles.container}>
      {/* Centered Attention Token Counter */}
      <div className={styles.tokenBar}>
        <span className={styles.tokenBarLabel}>
          Attention Tokens
        </span>
        <div className={styles.tokenBadge}>
          <Icon icon="ph:coin-fill" style={{ fontSize: "1rem", color: "var(--token-color)" }} />
          <span>{attentionTokens}</span>
        </div>
      </div>

      {/* Playable Engagement Cards Deck Container */}
      <div className={styles.cardsContainer}>
        {activeCards.map((card) => {
          const isSingleUseExhausted =
            (card.max_plays_per_phase === 1 || card.stakeholder_selection_amount === -1) &&
            playedCardIds.includes(card.id);
          const canAfford = isEnabled && attentionTokens >= card.token_cost && !isSingleUseExhausted;

          return (
            <EngagementCardComponent
              key={card.id}
              card={card}
              attentionTokens={attentionTokens}
              isSingleUseExhausted={isSingleUseExhausted}
              canAfford={canAfford}
              isEnabled={isEnabled}
              isDragging={draggingCardId === card.id}
              onClick={() => handleCardClick(card)}
              onDragStart={(e) => handleDragStart(e, card)}
              onDragEnd={handleDragEnd}
            />
          );
        })}
      </div>
    </div>
  );
}
