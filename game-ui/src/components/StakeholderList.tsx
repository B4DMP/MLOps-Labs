import { useContext } from "react";
import HoverTooltip from "./HoverToolTip";
import CustomChatMessage from "./customChatMessage";
import { StakeholderContext } from "./StakeholderProvider";
import styles from "./StakeholderList.module.css";


interface StakeholderListProps {
  current_phase: number;
  handleSend: (textContent: string) => void;
  isEnabled: boolean;
}

function StakeholderList({
  current_phase,
  handleSend,
  isEnabled,
}: StakeholderListProps) {
  const { stakeholders } = useContext(StakeholderContext);

  return (
    <>
      <ul className="list-group list-group-horizontal flex-wrap">
        {stakeholders.map((item, index) => {


          if (
            stakeholders[index].is_selected &&
            stakeholders[index].active[current_phase]
          ) {
            return (
              <li
                className={`list-group-item rounded ${styles.stakeholderListItem}`}
                key={item.id}
                onClick={() => {}}
                style={{
                  backgroundColor: "var(--card-bg-dark)",
                  color: "white",
                  borderColor: stakeholders[index].stakeholder_color,
                  borderWidth: "0 0 4px 0",
                  borderStyle: "solid",
                }}
              >
                <div className={styles.chatMessageContainer}>
                  <CustomChatMessage
                    is_active={isEnabled}
                    onClick={() =>
                      handleSend(
                        stakeholders[index].name.split(" ")[0] +
                          ", what is your opinion?",
                      )
                    }
                    message="ask"
                  />
                </div>
                <h6 className={styles.stakeholderName}>{item.name}</h6>
                <HoverTooltip
                  description={
                    item.division_description ? item.division_description.join(" ") : "DESCRIPTION PLACEHOLDER"
                  }
                >
                  <br />
                  <span
                    style={{ color: stakeholders[index].stakeholder_color }}
                  >
                    {item.division}
                  </span>
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
