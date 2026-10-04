import { useState, useEffect } from "react";
import { motion } from "motion/react";
import styles from "./EngagementCards.module.css";
import cardStyles from "./EngagementCardComponent.module.css";
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

// Rendered card footprints, mirroring EngagementCardComponent.module.css's .minimizedCard and
// base .playingCard sizes - used to lay the fan out without a DOM measurement pass.
const CARD_DIMENSIONS = {
  large: { width: 245, height: 343 },
  small: { width: 180, height: 148 },
};

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
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

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

  // ── Fan geometry ──────────────────────────────────────────────────────────
  // A hand of cards spread from a shared pivot below the fan: each card gets a small
  // horizontal step and a matching rotation away from center, both scaling down as more
  // cards join the hand so the whole fan stays inside the shelf instead of running off-screen.
  const total = activeCards.length;
  const dims = isMinimized ? CARD_DIMENSIONS.small : CARD_DIMENSIONS.large;
  const overlapFactor = Math.max(0.3, Math.min(0.6, 0.6 - Math.max(0, total - 5) * 0.045));
  const xStep = dims.width * overlapFactor;
  const angleStep = total > 1 ? Math.min(9, 34 / (total - 1)) : 0;
  // Chromium/Edge anti-alias 2D-rotated borders poorly in a shallow band near 0deg (a couple
  // of degrees either way render jagged; a true 0deg is axis-aligned and always crisp). With an
  // even card count the two center cards would otherwise land right in that band, so floor
  // every non-zero tilt at MIN_TILT_DEG instead of letting angleStep produce a shallow one.
  const MIN_TILT_DEG = 6;
  const mid = (total - 1) / 2;
  const pushAmount = xStep * 0.5;
  const liftY = dims.height * 0.16 + 16;
  const fanHeight = dims.height + liftY + 24;

  return (
    <div className={styles.container}>
      {/* Playable Engagement Cards Fan - a hand of cards spread from a shared pivot, not a
          horizontally-scrolling strip. Hovering brings a card forward and straightens it while
          its neighbours part slightly, like picking a card out of a hand. */}
      <div
        className={styles.fan}
        style={{ height: fanHeight }}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {activeCards.map((card, index) => {
          const isSingleUseExhausted =
            (card.max_plays_per_phase === 1 || card.stakeholder_selection_amount === -1) &&
            playedCardIds.includes(card.id);
          const canAfford = isEnabled && attentionTokens >= card.token_cost && !isSingleUseExhausted;

          const offset = index - mid;
          const isHovered = hoveredIndex === index;
          const isDimmed = hoveredIndex !== null && !isHovered;
          const pushDir = hoveredIndex !== null && index !== hoveredIndex ? Math.sign(index - hoveredIndex) : 0;

          const rawAngle = offset * angleStep;
          const restingAngle =
            rawAngle === 0 ? 0 : Math.sign(rawAngle) * Math.max(MIN_TILT_DEG, Math.abs(rawAngle));

          const x = offset * xStep + pushDir * pushAmount;
          const rotate = isHovered ? 0 : restingAngle;
          const y = isHovered ? -liftY : 0;
          const scale = isHovered ? 1.08 : 1;

          return (
            <motion.div
              key={card.id}
              data-coach-card={card.id}
              className={styles.fanCard}
              style={{
                left: "50%",
                marginLeft: -dims.width / 2,
                zIndex: isHovered ? 200 : index,
                transformOrigin: "50% 115%",
              }}
              animate={{ x, y, rotate, scale, opacity: isDimmed ? 0.82 : 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 26, mass: 0.6 }}
              onMouseEnter={() => setHoveredIndex(index)}
            >
              <EngagementCardComponent
                card={card}
                is_minimized={isMinimized}
                attentionTokens={attentionTokens}
                isSingleUseExhausted={isSingleUseExhausted}
                canAfford={canAfford}
                isEnabled={isEnabled}
                isDragging={draggingCardId === card.id}
                className={cardStyles.fanned}
                onClick={() => handleCardClick(card)}
                onDragStart={(e) => handleDragStart(e, card)}
                onDragEnd={handleDragEnd}
              />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
