import { useContext } from "react";
import HoverTooltip from "./HoverToolTip";
import { StakeholderContext } from "./StakeholderProvider";

export function parseChallengeDescription(description?: string) {
  if (!description) return [];
  const parts = description.split(/(#[^#]+#|\{[^{}]+\})/);
  return parts
    .map((part) => {
      if (
        (part.startsWith("#") && part.endsWith("#")) ||
        (part.startsWith("{") && part.endsWith("}"))
      ) {
        return { type: "id", value: part.slice(1, -1) };
      }
      return { type: "text", value: part };
    })
    .filter((part) => part.value !== "");
}

export interface ChallengeDescriptionCardProps {
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  currentChallenge?: number;
  challengeAmount?: number;
}

export default function ChallengeDescriptionCard({
  challengeTitle = "",
  challengeDescription = "",
  challengeIntro = "",
  currentChallenge = 0,
  challengeAmount = 1,
}: ChallengeDescriptionCardProps) {
  const { stakeholders } = useContext(StakeholderContext);
  const challenge_desc_cutted = parseChallengeDescription(challengeDescription);

  return (
    <div className="card shadow-sm w-100" style={{ background: "#ffffff", border: "1px solid #dee2e6" }}>
      <h5
        className="card-header"
        style={{ textAlign: "center", background: "var(--primary-bg)", color: "white" }}
      >
        <span style={{ color: "white" }}>
          <b> {challengeTitle}</b>
        </span>
        <span
          className="text small ms-2"
          style={{ color: "rgba(255, 255, 255, 0.85)", fontSize: "0.85rem" }}
        >
          (Challenge {currentChallenge + 1}/{challengeAmount})
        </span>
      </h5>
      <div className="card-body bg-white text-dark">
        {challengeIntro && (
          <p className="card-text text-center text-secondary mb-3">
            <i>{challengeIntro}</i>
          </p>
        )}
        <p className="card-text text-center text-dark fs-6 mb-0">
          {challenge_desc_cutted.map((item, index) => {
            if (item.type === "text") {
              return <span key={index}>{item.value}</span>;
            } else if (item.type === "id") {
              const st = Object.values(stakeholders || {}).find(
                (s: any) => s.id === item.value || s.name === item.value
              );
              if (!st) return <span key={index}>{item.value}</span>;
              return (
                <HoverTooltip key={index} description={st.role_description}>
                  <span
                    style={{
                      color: st.stakeholder_color,
                      fontWeight: "bold",
                    }}
                  >
                    {st.name}
                  </span>
                </HoverTooltip>
              );
            }
            return null;
          })}
        </p>
      </div>
    </div>
  );
}
