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
        {Object.values(stakeholders).map((item) => {
          if (item.is_selected && item.active[current_phase]) {
            return (
              <li
                className={`list-group-item rounded ${styles.stakeholderListItem}`}
                key={item.id}
                onClick={() => {}}
                style={{
                  backgroundColor: "var(--card-bg-dark)",
                  color: "white",
                  borderColor: item.stakeholder_color,
                  borderWidth: "0 0 4px 0",
                  borderStyle: "solid",
                }}
              >
                <div className={styles.chatMessageContainer}>
                  <CustomChatMessage
                    is_active={isEnabled}
                    onClick={() =>
                      handleSend(
                        item.name.split(" ")[0] +
                          ", what is your opinion?",
                      )
                    }
                    message="ask"
                  />
                </div>
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
