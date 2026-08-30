import StakeholdersList from "./StakeholderList";
import React, { useState, useEffect, useRef, useContext } from "react";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message,
  Avatar,
  TypingIndicator,
} from "@chatscope/chat-ui-kit-react";
import { StakeholderContext } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import { generateOpenPeepsDataUri } from "../assets/openPeepsAvatar";
import type { AvatarEmotion } from "../types/StakeholderAvatar";
import type { DialogueOption } from "../types/DialogueOption";
import type { ActionCard } from "../types/ActionCard";
import introJs from "intro.js";

import styles from "./StakeholderInteractionArea.module.css";

export type RevealedIntel = {
  id?: string;
  requirement_id?: string;
  description: string;
  categorized_type?: string;
  intel_type?: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
};

export type ChatMsg = {
  id: string;
  message: string;
  ac_id: number;
  facial_expression?: string;
  revealed_intel?: RevealedIntel[];
};

interface StakeholderInteractionAreaProps {
  onSelectDialogueOption?: (index: number) => void;
  dialogueOptions?: DialogueOption[];
  chatMsgs: ChatMsg[];
  current_phase: number;
  current_challenge: number;
  isEnabled: boolean;
  actionCards: ActionCard[];
  onHoverCard: (id: number | null) => void;
  className?: string;
  showStakeholderList?: boolean;
  showDialogueOptions?: boolean;
}

export default function StakeholderInteractionArea({
  onSelectDialogueOption,
  dialogueOptions = [],
  chatMsgs,
  current_phase,
  current_challenge,
  isEnabled,
  actionCards,
  onHoverCard,
  className = "col-5",
  showStakeholderList = true,
  showDialogueOptions = true,
}: StakeholderInteractionAreaProps) {
  const { stakeholders } = useContext(StakeholderContext) || { stakeholders: {} };
  const { metrics } = useContext(MetricsContext) || { metrics: {} };
  const [_isintro4Done, setIsintro4Done] = useState(false);
  const isintro4DoneRef = useRef(false);

  const getStakeholderColor = (st: any): string => {
    if (st?.stakeholder_color && st.stakeholder_color !== "#888888" && st.stakeholder_color !== "#ffffff") {
      return st.stakeholder_color;
    }
    if (st?.metric_id && metrics[st.metric_id]?.metric_color) {
      return metrics[st.metric_id].metric_color;
    }
    return st?.stakeholder_color || "#38bdf8";
  };

  useEffect(() => {
    if (!isEnabled && current_challenge === 0 && current_phase === 0 && !isintro4DoneRef.current) {
      isintro4DoneRef.current = true;
      setIsintro4Done(true);
      setTimeout(() => {
        introJs()
          .setOptions({
            group: "intro4",
            exitOnEsc: false,
            exitOnOverlayClick: false,
          })
          .start();
      }, 10);
    }
  }, [isEnabled, current_challenge, current_phase]);

  return (
    <div
      className={`${className} p-3 h-100 d-flex flex-column rounded transparent-div ${styles.ChatContainer}`}
      data-intro-group="intro5"
      data-intro="This is the chat area where you can communicate with the previously selected stakeholders in order to find a solution for the current challenge."
      data-step="1"
      data-position="bottom"
    >
      <h6 className="transparent-div-label">
        💬 Stakeholder Interaction Area
      </h6>
      {showStakeholderList && (
        <StakeholdersList current_phase={current_phase} />
      )}

      <div className={`flex-grow-1 overflow-hidden rounded mt-3 d-flex flex-column`} style={{ minHeight: 0 }}>
        <div className="flex-grow-1 overflow-hidden rounded" style={{ minHeight: 0, position: "relative" }}>
          <MainContainer
            className={`${styles.ChatContainer}`}
            style={{ height: "100%" }}
          >
            <ChatContainer className={`${styles.ChatContainer}`}>
              <MessageList
                className={`${styles.ChatContainer}`}
                typingIndicator={
                  !isEnabled && (
                    <TypingIndicator
                      data-intro-group="intro4"
                      data-intro="This tells you that a stakeholder is currently typing a response."
                      data-position="bottom"
                      content="Stakeholders are discussing..."
                    />
                  )
                }
              >
                {chatMsgs.map((item, index) => {
                  const isUser = !item.id || item.id === "user";
                  const st = isUser ? null : stakeholders[item.id];
                  const senderName = isUser ? "Me" : (st ? st.name : "Stakeholder");
                  const stColor = getStakeholderColor(st);

                  let avatarSrc = "";
                  if (!isUser) {
                    const av = st?.avatar;
                    const messageFace = (item.facial_expression || av?.face || av?.emotion || "smile") as AvatarEmotion;
                    avatarSrc = generateOpenPeepsDataUri({
                      head: av?.head || "short1",
                      face: messageFace,
                      facialHair: av?.facialHair,
                      facialHairProbability: av?.facialHairProbability,
                      accessories: av?.accessories,
                      accessoriesProbability: av?.accessoriesProbability,
                      skinColor: av?.skinColor || "ffdbb4",
                      clothingColor: stColor,
                      headContrastColor: av?.headContrastColor || "2c1b18",
                      backgroundColor: stColor,
                      flip: av?.flip,
                    });
                  }

                  return (
                    <React.Fragment key={index}>
                      <Message
                        className={`${styles.ChatMessage}`}
                        key={index}
                        model={{
                          message: item.message,
                          sentTime: "just now",
                          sender: senderName,
                          direction: isUser ? "outgoing" : "incoming",
                          position: "single",
                        }}
                        avatarSpacer={isUser ? false : true}
                      >
                        {!isUser && (
                          <Avatar
                            name={senderName}
                            src={avatarSrc}
                          />
                        )}
                      </Message>
                      {item.revealed_intel && item.revealed_intel.length > 0 && (
                        <div
                          className="d-flex flex-column justify-content-center align-items-center w-100 gap-2"
                          style={{ margin: "12px 0" }}
                        >
                          {item.revealed_intel.map((intel, idx) => (
                            <div
                              key={intel.id || intel.requirement_id || idx}
                              className="transparent-div"
                              style={{ height: "40px", display: "flex", alignItems: "center", padding: "0 16px" }}
                            >
                              <p
                                className="text-center m-0"
                                style={{ color: "#c3c3c3ff" }}
                              >
                                revealed intel item{" "}
                                <span
                                  style={{ fontWeight: "bold", color: "#60a5fa" }}
                                  title={intel.description}
                                >
                                  {intel.description.length > 50 ? `${intel.description.slice(0, 50)}...` : intel.description}
                                </span>{" "}
                                <span
                                  className="badge bg-secondary ms-1"
                                  style={{ fontSize: "0.7rem", verticalAlign: "middle" }}
                                >
                                  inferred
                                </span>
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                      {item.ac_id !== -1 && actionCards[item.ac_id] && (
                        <div
                          className={`d-flex justify-content-center align-items-center w-100 ${item.ac_id === 0 && "intro5"}`}
                          {...(item.ac_id === 0 ? {
                            "data-intro-group": "intro5",
                            "data-intro": "If one or multiple stakeholders propose a concrete action plan to mitigate the challenge, the game automatically generates an action card that reflects the stakeholders' proposals.",
                            "data-step": "2",
                            "data-position": "bottom"
                          } : {})}
                          style={{ margin: "15px 0" }}
                        >
                          <div
                            className="transparent-div"
                            style={{ height: "40px", display: "flex", alignItems: "center" }}
                          >
                            <p
                              className="text-center m-0"
                              style={{ color: "#c3c3c3ff" }}
                            >
                              generated action card{" "}
                              <span
                                style={{ fontWeight: "bold", cursor: "pointer" }}
                                onMouseEnter={() => onHoverCard?.(item.ac_id)}
                                onMouseLeave={() => onHoverCard?.(null)}
                              >
                                {actionCards[item.ac_id].ac_title}
                              </span>{" "}
                            </p>
                          </div>
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </MessageList>
            </ChatContainer>
          </MainContainer>
        </div>

        {showDialogueOptions && (
          <div
            className={styles.dialogueOptionsContainer}
            data-intro-group="intro5"
            data-intro="Choose a dialogue option to respond to the stakeholders. Options are based on either discovered intel items or convincer archetypes."
            data-step="5"
            data-position="top"
          >
            <div className={styles.dialogueOptionsHeader}>
              <span>Choose Dialogue Option</span>
              {!isEnabled && <span style={{ color: "#93c5fd" }}>Processing response...</span>}
            </div>

            {dialogueOptions && dialogueOptions.length > 0 ? (
              <div className={styles.dialogueOptionsGrid}>
                {dialogueOptions.map((opt, index) => {
                  const isIntel = Boolean(opt.intel_item_id);
                  return (
                    <button
                      key={index}
                      type="button"
                      className={styles.dialogueOptionCard}
                      disabled={!isEnabled}
                      onClick={() => onSelectDialogueOption?.(index)}
                    >
                      <div className={styles.optionBadgeRow}>
                        {isIntel ? (
                          <span className={styles.badgeIntel}>
                            🔍 Intel-Based
                          </span>
                        ) : (
                          <>
                            <span className={styles.badgeNoise}>
                              📢 Corporate Noise
                            </span>
                            {opt.archetype?.name && (
                              <span className={styles.metaDetail} title={opt.archetype.strategy || opt.archetype.name}>
                                Archetype: {opt.archetype.name}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                      <p className={styles.dialogueOptionText}>{opt.text}</p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className={styles.waitingIndicator}>
                {!isEnabled ? "Waiting for stakeholder responses..." : "No dialogue options available"}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
