import { useContext } from "react";
import HoverTooltip from "./HoverToolTip";
import { StakeholderContext } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import styles from "./StakeholderList.module.css";


interface StakeholderListProps {
  current_phase: number;
}

function StakeholderList({
  current_phase,
}: StakeholderListProps) {
  const { stakeholders } = useContext(StakeholderContext);
  const { metrics } = useContext(MetricsContext);

  return (
    <>
      <ul className="list-group list-group-horizontal flex-wrap">
        {Object.values(stakeholders).map((item) => {
          const metric = metrics[item.metric_id] || Object.values(metrics).find((m) => m.id === item.metric_id);
          const metricIntro = metrics[`${item.metric_id}_intro`] || Object.values(metrics).find((m) => m.id === `${item.metric_id}_intro`);
          const is_active = (metric && metric.phases[current_phase]) || (metricIntro && metricIntro.phases[current_phase]);
          if (is_active) {
            return (
              <li
                className={`list-group-item rounded ${styles.stakeholderListItem}`}
                key={item.id}
                onClick={() => { }}
                style={{
                  backgroundColor: "var(--card-bg-dark)",
                  color: "white",
                  borderColor: item.stakeholder_color,
                  borderWidth: "0 0 4px 0",
                  borderStyle: "solid",
                }}
              >
                <HoverTooltip
                  description={
                    item.role_description || "DESCRIPTION PLACEHOLDER"
                  }
                >
                  <h6 className={styles.stakeholderName} style={{ color: item.stakeholder_color }}>
                    {item.name}
                  </h6>
                </HoverTooltip>
              </li>
            );
          }
          return null;
        })}
      </ul>
    </>
  );
}

export default StakeholderList;
