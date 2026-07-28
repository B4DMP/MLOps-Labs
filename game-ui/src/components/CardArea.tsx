import { useState, useEffect, useContext } from "react";
import type { ActionCard } from "../types/ActionCard";
import ActionCardComponent, {
  DropIndicator,
  type DragCardType,
} from "./ActionCardComponent";
import styles from "./CardArea.module.css";
import { MetricsContext } from "./MetricProvider";
import { StakeholderContext } from "./StakeholderProvider";
import HoverTooltip from "./HoverToolTip";


interface CardAreaProps {
  challenge_descr: string;
  challenge_intro: string;
  challenge_title: string;
  action_cards: ActionCard[];
  challenge_id: number;
  challenge_number: number;
  current_phase: number;
  onPlayCard: (ac: ActionCard) => void;
  hoveredCardId?: number | null;
  isStakeholderTyping: boolean;
}

function CardArea({
  challenge_title,
  challenge_descr,
  challenge_intro,
  action_cards,
  challenge_id,
  challenge_number,
  current_phase,
  onPlayCard,
  hoveredCardId,
  isStakeholderTyping,
}: CardAreaProps) {
  const [cardDropActive, setCardDropActive] = useState(false);
  const { metrics } = useContext(MetricsContext);
  const { stakeholders } = useContext(StakeholderContext);
  let challenge_desc_cutted = [];
  const _split = challenge_descr.split("#");

  for (let i = 0; i < _split.length; i++) {
    if (i % 2 == 0) {
      challenge_desc_cutted.push({ type: "text", value: _split[i] });
    } else {
      challenge_desc_cutted.push({ type: "id", value: _split[i] });
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    highlightIndicator(e);
    setCardDropActive(true);
  };

  const handleDragLeave = () => {
    clearHighlights();
    setCardDropActive(false);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    const cardId = e.dataTransfer.getData("cardId");
    const dc_id = dragCards.findIndex((el) => el.id === cardId);

    let is_card_playable = true;
    Object.values(metrics).forEach((m) => {
      if (m.value !== undefined) {
        if (m.value + (dragCards[dc_id].ac.metric_changes[m.id] ?? 0) < 0) {
          is_card_playable = false;
        }
      }
    });
    if (is_card_playable === true) {
      onPlayCard(dragCards[dc_id].ac);
      setDragCards([]);
    }
    clearHighlights();
    setCardDropActive(false);
  };

  const handleCardReplace = (e: React.DragEvent) => {
    const cardId = e.dataTransfer.getData("cardId");

    setCardDropActive(false);
    clearHighlights();

    const indicators = getIndicators();
    const { element } = getNearestIndicator(e, indicators);

    const before = element.dataset.before || "-1";

    if (before !== cardId) {
      let copy = [...dragCards];

      let cardToTransfer = copy.find((c) => c.id === cardId);
      if (!cardToTransfer) return;
      cardToTransfer = { ...cardToTransfer };

      copy = copy.filter((c) => c.id !== cardId);

      const moveToBack = before === "-1";

      if (moveToBack) {
        copy.push(cardToTransfer);
      } else {
        const insertAtIndex = copy.findIndex((el) => el.id === before);
        if (insertAtIndex === undefined) return;

        copy.splice(insertAtIndex, 0, cardToTransfer);
      }

      setDragCards(copy);
    }
  };

  const createDragCards = (cards: ActionCard[]): DragCardType[] => {
    let ret: DragCardType[] = [];

    for (let i = 0; i < cards.length; i++) {
      ret.push({ id: i.toString(), ac: cards[i], current_phase });
    }
    return ret;
  };

  const getIndicators = () => {
    return Array.from(
      document.querySelectorAll(`[data-before]`) as unknown as HTMLElement[],
    );
  };

  const clearHighlights = (els?: HTMLElement[]) => {
    const indicators = els || getIndicators();

    indicators.forEach((i) => {
      i.style.opacity = "0";
    });
  };

  const getNearestIndicator = (
    e: React.DragEvent,
    indicators: HTMLElement[],
  ) => {
    const el = indicators.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();

        const offset = e.clientX - box.left;

        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      },
      {
        offset: Number.NEGATIVE_INFINITY,
        element: indicators[indicators.length - 1],
      },
    );

    return el;
  };

  const highlightIndicator = (e: React.DragEvent) => {
    const indicators = getIndicators();

    clearHighlights(indicators);

    const el = getNearestIndicator(e, indicators);

    el.element.style.opacity = "1";
  };

  const [dragCards, setDragCards] = useState(createDragCards(action_cards));

  useEffect(() => {
    setDragCards(createDragCards(action_cards));
  }, [action_cards]);

  return (<>
    <div
      className={`${styles.dropZone} ${cardDropActive ? styles.dropActive : ""} intro5`}
      data-intro-group="intro5"
      data-intro="Once you have decided on an action, drag and drop the action card in this area to play it."
      data-step="6"
      data-position="bottom"
      onDragOver={handleDragOver}
      onDrop={handleDragEnd}
      onDragLeave={handleDragLeave}
    >
      <div className="card shadow-sm" style={{ width: "70%", height: "fit-content" }}>
        <h5
          className="card-header"
          style={{ textAlign: "center", background: "rgba(130, 25, 25, 1)" }}
        >
          <span style={{ color: "white" }}>
            <b> {challenge_title}</b>
          </span>
          <span
            className={`text small ${styles.challengeProgress}`}
            style={{ color: "white" }}
          >
            {" "}
            (Challenge {challenge_id + 1}/{challenge_number}){" "}
          </span>
        </h5>
        <div className="card-body">
          <p className="card-text text-center">
            <i>{challenge_intro}</i>
          </p>
          <p className="card-text text-center">
            {challenge_desc_cutted.map((item, index) => {
              if (item["type"] == "text") {
                return <span key={index}>{item["value"]} </span>;
              } else if (item["type"] == "id") {
                const st = Object.values(stakeholders).find(s => s.name === item["value"]);
                if (!st) return <span key={index}>{item["value"]}</span>;
                return (
                  <HoverTooltip
                    key={index}
                    description={st.division_description}
                  >
                    <span
                      style={{
                        color: st.stakeholder_color,
                        fontWeight: "bold",
                      }}
                    >
                      {st.name + " (" + st.division + ")"}
                    </span>
                  </HoverTooltip>
                );
              }
              return null;
            })}
          </p>
        </div>
      </div>
    </div>

    <br />
    <div
      onDragOver={handleDragOver}
      onDrop={handleCardReplace}
      onDragLeave={handleDragLeave}
      className={`p-3 rounded w-100 mt-auto transparent-div ${styles.cardContainer} intro5`}
      data-intro-group="intro5"
      data-intro="This area lists every action card that has been generated yet. You can arrange the cards by dragging and dropping them."
      data-step="3"
      data-position="bottom"
    >
      <h6 className="transparent-div-label">🗂️ Action Cards</h6>

      <ul className={`list-group list-group-horizontal overflow-auto ${styles.cardListContainer}`}>
        {dragCards.map((card, index) => (
          <li
            className={`list-group-item d-flex align-items-center  ${styles.cardListItem}`}
            key={index}
            onClick={() => { }}
          >
            <ActionCardComponent
              tutorial_card={index === 0}
              ac={card.ac}
              id={card.id}
              current_phase={current_phase}
              highlight={index === hoveredCardId}
              interactable={!isStakeholderTyping}
            />
          </li>
        ))}
        <li className="list-group-item d-flex align-items-center border-0 p-0 bg-transparent">
          <DropIndicator beforeId={-1} display={true} />
        </li>
      </ul>
    </div>

  </>
  );
}

export default CardArea;
