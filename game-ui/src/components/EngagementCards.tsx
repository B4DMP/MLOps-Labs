import { useState } from "react";
import { Icon } from "@iconify/react";
import styles from "./EngagementCards.module.css";
import type { EngagementCard } from "../types/EngagementCard";

interface EngagementCardsProps {
  attentionTokens: number;
  cards?: EngagementCard[];
  playedCardIds?: string[];
  discoveredIntelCount?: number;
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
  discoveredIntelCount = 0,
  onOpenPitchModal,
  onSelectPrompt,
  onSelectCard,
  onDragCardStart,
  onDragCardEnd,
  isEnabled = true,
}: EngagementCardsProps) {
  const activeCards: EngagementCard[] = cards && cards.length > 0 ? cards : [];
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);

  const canPitch = discoveredIntelCount > 0;

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
      {/* Unified Phase Control Bar: Hint + Currency + Milestone Progress + Pitch Progression CTA */}
      <div className={styles.phaseControlBar}>
        {/* Actionable Player Guidance */}
        <p className={styles.phaseHint}>
          <Icon icon="ph:lightbulb-filament-bold" className={styles.phaseHintIcon} />
          Spend <strong className={styles.hintToken}>Attention Tokens <Icon icon="ph:coin-fill" className={styles.hintInlineIcon} /></strong> to play <strong className={styles.hintCard}>Engagement Cards</strong> below to engage stakeholders and uncover <strong className={styles.hintIntel}>Intel <Icon icon="ph:files-bold" className={styles.hintInlineIcon} /></strong>, then <strong className={styles.hintProposal}>pitch a Proposal</strong> to overcome this Challenge in the Pitch Debate.
        </p>

        <div className={styles.phaseControlsRow}>
          {/* Left: Attention Tokens Currency */}
          <div className={styles.tokenSection} title={`${attentionTokens} Attention Tokens available to play tactical engagement cards`}>
            <div className={styles.statRow}>
              <Icon icon="ph:coin-fill" className={styles.tokenIcon} />
              <span className={styles.tokenCount}>{attentionTokens}</span>
            </div>
            <span className={styles.tokenLabel}>Attention Tokens</span>
          </div>

          {/* Center: Intelligence Gathering Milestone Progress */}
          <div className={styles.intelStatusSection} title={`${discoveredIntelCount} intel items documented in your Stakeholder Dossier`}>
            <div className={styles.statRow}>
              <Icon icon="ph:files-bold" className={styles.intelStatusIcon} />
              <span className={styles.intelCount}>{discoveredIntelCount}</span>
            </div>
            <span className={styles.intelLabel}>Intel Gathered</span>
          </div>

          {/* Right: Phase Milestone Progression CTA Button */}
          {onOpenPitchModal && (
            <button
              type="button"
              className={`${styles.pitchCtaBtn} ${canPitch ? styles.pitchCtaBtnActive : styles.pitchCtaBtnDisabled}`}
              disabled={!canPitch}
              onClick={onOpenPitchModal}
              title={
                canPitch
                  ? "Combine discovered intel into an action proposal and enter the Pitch Debate"
                  : "Play action cards below to uncover at least 1 intel item before pitching"
              }
            >
              <Icon icon={canPitch ? "ph:paper-plane-tilt-bold" : "ph:lock-key-fill"} />
              <span>
                {canPitch ? `Ready to Pitch (${discoveredIntelCount} Intel) ➔` : "Pitch Proposal (Need ≥ 1 Intel)"}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Playable Engagement Cards Deck Container */}
      <div className={styles.cardsContainer}>
        {activeCards.map((card) => {
          const isSingleUseExhausted =
            (card.max_plays_per_phase === 1 || card.stakeholder_selection_amount === -1) &&
            playedCardIds.includes(card.id);
          const canAfford = isEnabled && attentionTokens >= card.token_cost && !isSingleUseExhausted;
          const isIntelCard = card.target_type === "intel" || card.id === "eng_0";

          return (
            <div
              key={card.id}
              draggable={canAfford}
              onDragStart={(e) => handleDragStart(e, card)}
              onDragEnd={handleDragEnd}
              className={`${styles.cardContainer} ${!canAfford ? styles.not_interactable : ""} ${draggingCardId === card.id ? styles.dragging : ""
                }`}
              onClick={() => handleCardClick(card)}
              title={
                !isEnabled
                  ? "Interaction disabled"
                  : isSingleUseExhausted
                    ? "Already played in this phase (1x per phase limit)"
                    : attentionTokens < card.token_cost
                      ? `Requires ${card.token_cost} Attention Tokens (you have ${attentionTokens})`
                      : `Drag to Pitch Deck / Chat or click to play ${card.title}`
              }
            >
              {/* Outer Card Frame Structure */}
              <div
                className={`card ${styles.cardFrame} ${canAfford ? styles.cardFramePlayable : styles.cardFrameMuted}`}
              >
                {/* Card Header: Title & Token Cost */}
                <div className={`card-header ${styles.cardHeader}`}>
                  <h6 className={styles.cardTitle} title={card.title}>
                    {card.title}
                  </h6>
                  <div className={styles.costBadge} title={`${card.token_cost} Attention Tokens`}>
                    <Icon icon="ph:coin-fill" />
                    <span>{card.token_cost}</span>
                  </div>
                </div>

                {/* Type & Target Scope Badges */}
                <div className={styles.badgeRow}>
                  <span
                    className={`badge ${styles.typePill} ${canAfford && !isSingleUseExhausted ? styles.iconPlayable : styles.iconMuted}`}
                  >
                    <Icon icon={card.icon || "ph:cards-bold"} className="me-1" />
                    {isIntelCard ? "Intel" : "Dialogue"}
                  </span>

                  {!isIntelCard && card.stakeholder_selection_amount === -1 && (
                    <span className={`badge ${styles.targetBadge}`}>
                      <Icon icon="ph:users-three-bold" className="me-1" /> All Team
                    </span>
                  )}
                  {!isIntelCard && card.stakeholder_selection_amount === 1 && (
                    <span className={`badge ${styles.targetBadge}`}>
                      <Icon icon="ph:user-bold" className="me-1" /> 1 Target
                    </span>
                  )}
                  {!isIntelCard && card.stakeholder_selection_amount > 1 && (
                    <span className={`badge ${styles.targetBadge}`}>
                      <Icon icon="ph:users-bold" className="me-1" /> {card.stakeholder_selection_amount} Targets
                    </span>
                  )}

                  {!isIntelCard && (card.intel_reveal_count ?? 1) > 0 && (
                    <span
                      className={`badge ${styles.intelBadge}`}
                      title={`Reveals ${card.intel_reveal_count ?? 1} intel requirement${(card.intel_reveal_count ?? 1) > 1 ? "s" : ""} per stakeholder`}
                    >
                      <Icon icon="ph:files-bold" className="me-1" />
                      +{card.intel_reveal_count ?? 1}
                    </span>
                  )}
                </div>

                {/* Card Body & Description Box */}
                <div className={`card-body ${styles.cardBody}`}>
                  <div className={styles.descriptionBox}>
                    <span className={styles.cardDescription}>
                      {isSingleUseExhausted ? (
                        <span className={styles.exhaustedAlert}>
                          ⚠️ Already played in this phase.
                        </span>
                      ) : (
                        card.description
                      )}
                    </span>
                  </div>

                  {/* Card Footer Play Action */}
                  <div className={styles.cardList}>
                    <div
                      className={`${styles.actionFooterBtn} ${canAfford ? styles.actionFooterPlayable : styles.actionFooterDisabled}`}
                    >
                      {isSingleUseExhausted ? (
                        <>
                          <Icon icon="ph:check-circle-bold" /> PLAYED (1/1)
                        </>
                      ) : canAfford ? (
                        <>
                          PLAY CARD
                        </>
                      ) : (
                        <>
                          <Icon icon="ph:lock-key-fill" /> NEED{" "}
                          <span className={styles.tokenCostHighlight}>{card.token_cost}</span>
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
