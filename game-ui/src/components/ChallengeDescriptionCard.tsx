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
    <div className="card shadow-sm w-100 rounded-2 overflow-hidden" style={{ background: "#ffffff", border: "1px solid #dee2e6" }}>
      <div
        className="card-header py-1 px-3 d-flex align-items-center justify-content-center gap-2"
        style={{ background: "var(--primary-bg)", color: "white" }}
      >
        <span className="fw-bold" style={{ color: "white", fontSize: "0.9rem" }}>
          {challengeTitle}
        </span>
        <span
          className="badge"
          style={{ color: "rgba(255, 255, 255, 0.9)", background: "rgba(255, 255, 255, 0.18)", fontSize: "0.72rem" }}
        >
          Challenge {currentChallenge + 1}/{challengeAmount}
        </span>
      </div>
      <div className="card-body bg-white text-dark py-2 px-3">
        {challengeIntro && (
          <p className="card-text text-center text-secondary mb-1" style={{ fontSize: "0.75rem", lineHeight: 1.25 }}>
            <i>{challengeIntro}</i>
          </p>
        )}
        <p className="card-text text-center text-dark mb-0" style={{ fontSize: "0.8rem", lineHeight: 1.3 }}>
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
