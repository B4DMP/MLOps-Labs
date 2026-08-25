import React from "react";
import { Icon } from "@iconify/react";
import CustomChatMessage from "./customChatMessage";
import styles from "./online_intel_gathering.module.css";

interface EngagementCardsProps {
  attentionTokens: number;
  maxAttentionTokens: number;
  prompts: string[];
  onSelectPrompt: (prompt: string) => void;
  isEnabled?: boolean;
}

export default function EngagementCards({
  attentionTokens,
  maxAttentionTokens,
  prompts,
  onSelectPrompt,
  isEnabled = true,
}: EngagementCardsProps) {
  return (
    <div className="d-flex flex-column align-items-center w-100 mt-2">
      {/* Centered Attention Token Counter directly above Engagement Cards */}
      <div
        className="transparent-div d-flex align-items-center gap-2 px-3 py-1 mb-2 shadow-sm"
        style={{ flex: "0 0 auto" }}
      >
        <span className="transparent-div-label mb-0 d-flex align-items-center gap-1 me-2">
          <Icon icon="ph:coin-fill" style={{ color: "#ffc107" }} /> Attention Tokens:
        </span>
        <div className={styles.tokenBadge}>
          <Icon icon="ph:coin-fill" style={{ fontSize: "1.1rem", color: "#ffc107" }} />
          <span className="fs-6 fw-bold">{attentionTokens}</span>
          <span className="opacity-75 small">/ {maxAttentionTokens}</span>
        </div>
      </div>

      {/* Horizontal List of Prompt Template Speech Bubbles */}
      <div
        className="d-flex flex-row flex-nowrap gap-3 align-items-end justify-content-start w-100 overflow-auto py-2 px-2"
        style={{ scrollbarWidth: "none" }}
      >
        {prompts.map((item) => (
          <CustomChatMessage
            key={item}
            is_active={isEnabled}
            onClick={() => onSelectPrompt(item)}
            message={item}
          />
        ))}
      </div>
    </div>
  );
}
