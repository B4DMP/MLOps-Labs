import { useState } from "react";
import { Icon } from "@iconify/react";
import styles from "./EngagementCards.module.css";
import type { EngagementCardConfig } from "../types/EngagementCard";

interface EngagementCardsProps {
  attentionTokens: number;
  maxAttentionTokens: number;
  cards?: EngagementCardConfig[];
  playedCardIds?: string[];
  onSelectPrompt?: (prompt: string) => void;
  onSelectCard?: (card: EngagementCardConfig) => void;
  onDragCardStart?: () => void;
  onDragCardEnd?: () => void;
  isEnabled?: boolean;
}

const defaultCards: EngagementCardConfig[] = [
  {
    id: "eng_0",
    title: "Verify Intel Item",
    icon: "ph:seal-check-bold",
    token_cost: 5,
    description: "Choose an unverified intel item and directly verify it.",
    stakeholder_selection_amount: 0,
    target_type: "intel",
    response_snippet: "Intel verified successfully.",
    max_plays_per_phase: -1,
  },
  {
    id: "eng_1",
    title: "1-on-1 Deep Dive",
    icon: "ph:user-focus-bold",
    token_cost: 4,
    description: "Schedule a 1-on-1 meeting to uncover detailed information.",
    stakeholder_selection_amount: 1,
    target_type: "stakeholder",
    response_snippet: "In our 1-on-1 meeting, we discussed key technical and operational requirements in detail.",
    max_plays_per_phase: -1,
  },
  {
    id: "eng_2",
    title: "Probe Requirements",
    icon: "ph:magnifying-glass-bold",
    token_cost: 3,
    description: "Ask questions regarding stakeholder's requirements and constraints.",
    stakeholder_selection_amount: 2,
    target_type: "stakeholder",
    response_snippet: "Probed requirements with selected stakeholders.",
    max_plays_per_phase: -1,
  },
  {
    id: "eng_3",
    title: "Team Sync-up",
    icon: "ph:users-bold",
    token_cost: 2,
    description: "Inquire about the team's perspective on the project.",
    stakeholder_selection_amount: -1,
    target_type: "stakeholder",
    response_snippet: "Synced up with all team members to align perspectives.",
    max_plays_per_phase: 1,
  },
  {
    id: "eng_4",
    title: "Ask Generic Question",
    icon: "ph:chat-teardrop-text-bold",
    token_cost: 1,
    description: "Lightweight query to gauge general sentiment and open preferences.",
    stakeholder_selection_amount: 1,
    target_type: "stakeholder",
    response_snippet: "Gauged general sentiment and high-level priorities.",
    max_plays_per_phase: -1,
  },
];

export default function EngagementCards({
  attentionTokens,
  maxAttentionTokens,
  cards,
  playedCardIds = [],
  onSelectPrompt,
  onSelectCard,
  onDragCardStart,
  onDragCardEnd,
  isEnabled = true,
}: EngagementCardsProps) {
  const activeCards: EngagementCardConfig[] = cards && cards.length > 0 ? cards : defaultCards;
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);

  const handleCardClick = (card: EngagementCardConfig) => {
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

  const handleDragStart = (e: React.DragEvent, card: EngagementCardConfig) => {
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
          <span className="opacity-75 small">/ {maxAttentionTokens}</span>
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
            <div
              key={card.id}
              draggable={canAfford}
              onDragStart={(e) => handleDragStart(e, card)}
              onDragEnd={handleDragEnd}
              className={`${styles.cardContainer} ${!canAfford ? styles.not_interactable : ""} ${
                draggingCardId === card.id ? styles.dragging : ""
              }`}
              onClick={() => handleCardClick(card)}
              title={
                !isEnabled
                  ? "Interaction disabled"
                  : isSingleUseExhausted
                    ? `Already played in this phase (1x per phase limit)`
                    : attentionTokens < card.token_cost
                      ? `Requires ${card.token_cost} Attention Tokens (you have ${attentionTokens})`
                      : `Drag to Pitch Deck / Chat or click to play ${card.title}`
              }
            >
              {/* Outer Card Frame Structure (identical to ActionCardComponent) */}
              <div
                className="card rounded-0 shadow-sm mb-0 flex-grow-1 position-relative"
                style={{
                  borderColor: canAfford ? "var(--engagement-accent)" : "var(--engagement-muted)",
                  borderWidth: "3px",
                  backgroundColor: "var(--engagement-bg)",
                  color: "var(--engagement-text)",
                }}
              >
                <Icon icon="teenyicons:drag-outline" className={styles.dragIcon} />
                {/* Card Header (Title & Cost Subtitle) */}
                <div className="card-header rounded-0 py-2 px-2 border-bottom" style={{ borderColor: "rgba(255, 255, 255, 0.15)" }}>
                  <h6 className="card-title text-center fw-bold mb-1 text-truncate" title={card.title} style={{ color: "var(--engagement-text)" }}>
                    {card.title}
                  </h6>
                  <div className="d-flex justify-content-center align-items-center small">
                    <span
                      className="badge"
                      style={{
                        fontSize: "0.65rem",
                        backgroundColor: "var(--engagement-muted)",
                        color: "var(--engagement-text)",
                      }}
                    >
                      ENGAGEMENT CARD
                    </span>
                  </div>
                </div>

                {/* Card Image / Icon Surface */}
                <div
                  className={styles.cardImage}
                  style={{ filter: canAfford ? "none" : "grayscale(100%)" }}
                >
                  <Icon
                    icon={card.icon || "ph:cards-bold"}
                    className={styles.cardImageIcon}
                    style={{
                      fontSize: "2.6rem",
                      color: isSingleUseExhausted || !canAfford
                        ? "var(--engagement-muted)"
                        : "var(--engagement-accent)",
                    }}
                  />
                </div>

                {/* Card Body & Description Box */}
                <div className="card-body d-flex flex-column p-2">
                  <div className={`p-2 rounded mb-2 ${styles.descriptionBox}`}>
                    <span
                      style={{
                        fontSize: "0.8rem",
                        lineHeight: 1.25,
                        display: "block",
                        color: "var(--engagement-text)",
                      }}
                    >
                      {isSingleUseExhausted ? (
                        <span style={{ color: "var(--engagement-accent)", fontWeight: "bold" }}>
                          ⚠️ Already played in this phase (Limit: 1x per phase).
                        </span>
                      ) : (
                        card.description
                      )}
                    </span>
                  </div>

                  {/* Card Footer Play Action */}
                  <div className={`mt-auto p-2 rounded ${styles.cardList}`}>
                    <div
                      className={`${styles.actionFooterBtn} ${canAfford ? styles.actionFooterPlayable : styles.actionFooterDisabled
                        }`}
                    >
                      {isSingleUseExhausted ? (
                        <>
                          <Icon icon="ph:check-circle-bold" /> PLAYED (1/1)
                        </>
                      ) : canAfford ? (
                        <>
                          PLAY CARD (
                          <span style={{ color: "var(--token-color)" }}>
                            {card.token_cost}
                            <Icon icon="ph:coin-fill" className="ms-1" style={{ color: "var(--token-color)" }} />
                          </span>
                          )
                        </>
                      ) : (
                        <>
                          <Icon icon="ph:lock-key-fill" /> NEED{" "}
                          <span style={{ color: "var(--token-color)" }}>
                            {card.token_cost}
                            <Icon icon="ph:coin-fill" className="ms-1" style={{ color: "var(--token-color)" }} />
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
