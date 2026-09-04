import { useState, useEffect } from "react";
import styles from "./EngagementCards.module.css";
import type { EngagementCard } from "../types/EngagementCard";
import EngagementCardComponent from "./EngagementCardComponent";

interface EngagementCardsProps {
  attentionTokens: number;
  cards?: EngagementCard[];
  playedCardIds?: string[];
  discoveredIntelCount?: number;
  is_minimized?: boolean;
  onOpenPitchModal?: () => void;
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
  discoveredIntelCount: _discoveredIntelCount,
  is_minimized: explicitIsMinimized,
  onOpenPitchModal: _onOpenPitchModal,
  onSelectPrompt,
  onSelectCard,
  onDragCardStart,
  onDragCardEnd,
  isEnabled = true,
}: EngagementCardsProps) {
  const activeCards: EngagementCard[] = cards && cards.length > 0 ? cards : [];
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);

  // Responsive screen-size detection for large vs small card version
  const [isLargeScreen, setIsLargeScreen] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return window.innerHeight >= 880 && window.innerWidth >= 1250;
    }
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsLargeScreen(window.innerHeight >= 880 && window.innerWidth >= 1250);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isMinimized = explicitIsMinimized !== undefined ? explicitIsMinimized : !isLargeScreen;

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
      {/* Playable Engagement Cards Deck Container */}
      <div
        className={`${styles.cardsContainer} ${
          !isMinimized ? styles.cardsContainerLarge : styles.cardsContainerSmall
        }`}
      >
        {activeCards.map((card) => {
          const isSingleUseExhausted =
            (card.max_plays_per_phase === 1 || card.stakeholder_selection_amount === -1) &&
            playedCardIds.includes(card.id);
          const canAfford = isEnabled && attentionTokens >= card.token_cost && !isSingleUseExhausted;

          return (
            <EngagementCardComponent
              key={card.id}
              card={card}
              is_minimized={isMinimized}
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
