import { useContext } from "react";
import { StakeholderContext } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import type { ActionCard } from "../types/ActionCard";
import styles from "./ActionCardComponent.module.css";
import HoverTooltip from "./HoverToolTip";
import { Icon } from "@iconify/react";

export type DragCardType = {
  id: string;
  ac: ActionCard;
  current_phase: number;
};

export default function ActionCardComponent({
  ac,
  id,
  current_phase,
  highlight,
  showValues = false,
  interactable = true,
  tutorial_card,
  displayMetrics = false,
  hasDropIndicator = true,
}: {
  ac: ActionCard;
  id: string;
  current_phase: number;
  highlight?: boolean;
  showValues?: boolean;
  interactable?: boolean;
  tutorial_card?: boolean;
  displayMetrics?: boolean;
  hasDropIndicator?: boolean;
}) {
  const { stakeholders } = useContext(StakeholderContext);
  const { metrics } = useContext(MetricsContext);
  const handleDragStart = (e: React.DragEvent, card: DragCardType) => {
    e.dataTransfer.setData("cardId", card.id);
  };

  let is_card_playable = true;
  metrics.forEach((m) => {
    if (m.value !== undefined) {
      if (m.value + (ac.metric_changes[m.name] ?? 0) < 0) {
        is_card_playable = false;
      }
    }
  });

  const getStakeholder = (st_index: string) => {
    return stakeholders.find((s) => s.stakeholder_index === st_index);
  };
  const primaryStakeholder = ac.stakeholder_ids.length > 0 ? getStakeholder(ac.stakeholder_ids[0]) : null;

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
            borderColor: is_card_playable
              ? primaryStakeholder?.stakeholder_color ?? "grey"
              : "grey",
            borderWidth: "3px",
          }}
        >
          <Icon icon="teenyicons:drag-outline" className={styles.dragIcon} />
          <div className="card-header rounded-0">
            <h5 className="card-title text-center fw-bold">{ac.ac_title}</h5>
            <p className="text-muted small text-center">
              by{" "}
              {ac.stakeholder_ids.map((st_id, index) => {
                const st = getStakeholder(st_id);
                if (!st) return null;
                return (
                  <span key={st.stakeholder_index || st.name}>
                    <span
                      className="badge"
                      style={{
                        backgroundColor: is_card_playable
                          ? st.stakeholder_color
                          : "grey",
                      }}
                    >
                      {st.name}{" "}
                    </span>
                    {index < ac.stakeholder_ids.length - 1 && ", "}
                  </span>
                );
              })}
            </p>
          </div>
          <img
            className={styles.cardImage}
            style={{ filter: is_card_playable ? "none" : "grayscale(100%)" }}
            src={import.meta.env.BASE_URL + ac.ac_image.replace(/^\//, "")}
            alt="new"
            draggable="false"
          />

          <div className="card-body d-flex flex-column">
            <div className={`p-2 rounded mb-1 ${styles.descriptionBox}`}>
              <span
                style={{
                  fontSize: "0.85rem",
                  lineHeight: 1.2,
                  display: "block",
                }}
              >
                {ac.ac_descr}
              </span>
            </div>
            <div
              className={`mt-auto p-2 rounded ${styles.cardList} ${tutorial_card ? "intro5" : ""}`}
            >
              <ul
                className={styles.metricList}
                {...(tutorial_card && displayMetrics
                  ? {
                    "data-intro-group": "intro5",
                    "data-intro": `Each generated card will change the game metrics in some way. To discourage players from choosing cards based solely on numbers, the cards only display the total amount of change, not whether it will be positive or negative. For example, this card will change the metric ${metrics.filter((m) => m.phases[current_phase])[0]?.name ?? "the metrics"} by a total of ${Math.abs(ac.metric_changes[metrics.filter((m) => m.phases[current_phase])[0]?.name ?? ""]) ?? "-"}. The exact values of the changes will be revealed after the card has been played.`,
                    "data-step": "4",
                    "data-position": "bottom",
                  }
                  : tutorial_card && !displayMetrics
                    ? {
                      "data-intro-group": "intro5",
                      "data-intro": `Each generated card will change the game metrics in some way. To discourage players from choosing cards based solely on numbers, we will only reveal the values of the changes after the card has been played.`,
                      "data-step": "4",
                      "data-position": "bottom",
                    }
                    : {})}
              >
                {displayMetrics && metrics.map(
                  (metric, index) =>
                    metric.phases[current_phase] && (
                      <li
                        className={`list-group-item ${styles.cardItem}`}
                        key={metric.name}
                      >
                        <HoverTooltip
                          description={
                            metric.description ?? "DESCRIPTION PLACEHOLDER"
                          }
                        >
                          <div
                            className={styles.metricDiv}
                            style={{
                              borderColor: is_card_playable
                                ? metric.metric_color
                                : "grey",
                              color: metric.metric_color,
                            }}
                          >
                            {(showValues ||
                              (metrics[index].value ?? 0) +
                              (ac.metric_changes[metric.name] ?? 0) <
                              0) && (
                                <>
                                  <Icon
                                    icon={metric.metric_icon}
                                    className={styles.metricIcon}
                                  />
                                  <span
                                    className={styles.metricValue}
                                    style={{
                                      color:
                                        (metrics[index].value ?? 0) +
                                          (ac.metric_changes[metric.name] ?? 0) >=
                                          0
                                          ? "inherit"
                                          : "red",
                                    }}
                                  >
                                    {(ac.metric_changes[metric.name] ?? 0) > 0 &&
                                      "+"}
                                    {ac.metric_changes[metric.name] ?? 0}
                                  </span>
                                </>
                              )}
                            {!showValues &&
                              (metrics[index].value ?? 0) +
                              (ac.metric_changes[metric.name] ?? 0) >=
                              0 && (
                                <div className="d-flex align-items-center gap-1">
                                  {(ac.metric_changes[metric.name] ?? 0) != 0 &&
                                    [
                                      ...Array(
                                        Math.abs(
                                          ac.metric_changes[metric.name] ?? 0,
                                        ),
                                      ),
                                    ].map((_, i) => (
                                      <Icon
                                        icon={metric.metric_icon}
                                        key={i}
                                        style={{
                                          fontSize: "15px",
                                          flexShrink: 0,
                                        }}
                                      />
                                    ))}
                                  {(ac.metric_changes[metric.name] ?? 0) ===
                                    0 && "-"}
                                </div>
                              )}
                          </div>
                        </HoverTooltip>
                      </li>
                    ),
                )}
              </ul>
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
