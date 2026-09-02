import { Icon } from "@iconify/react";
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
  is_corrected?: boolean;
};

export type ConvincerVerification = {
  was_correct: boolean;
  stakeholder_id: string;
  stakeholder_name?: string;
  categorized_archetype?: string;
  old_archetype?: string;
  true_archetype?: string;
  strategy?: string;
  explanation?: string;
};

export type ChatMsg = {
  id: string;
  message: string;
  ac_id: number;
  facial_expression?: string;
  revealed_intel?: RevealedIntel[];
  convincer_verification?: ConvincerVerification;
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
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
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
  isMaximized = false,
  onToggleMaximize,
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
      <div className="d-flex justify-content-between align-items-center mb-1 w-100 flex-shrink-0">
        <h6 className="transparent-div-label mb-0">
          💬 Conversation History
        </h6>
        {onToggleMaximize && (
          <button
            type="button"
            className="btn btn-sm text-light p-1 d-flex align-items-center justify-content-center"
            style={{
              background: "rgba(255, 255, 255, 0.12)",
              border: "1px solid rgba(255, 255, 255, 0.25)",
              borderRadius: "6px",
              width: "28px",
              height: "28px",
              flexShrink: 0,
              cursor: "pointer",
              transition: "all var(--transition)",
            }}
            onClick={onToggleMaximize}
            title={isMaximized ? "Restore view (Show Challenge & Pitch Deck)" : "Maximize conversation history"}
          >
            <Icon
              icon={isMaximized ? "ph:arrows-in-simple-bold" : "ph:arrows-out-simple-bold"}
              style={{ fontSize: "1rem" }}
            />
          </button>
        )}
      </div>
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
                                {intel.is_corrected ? "corrected intel item " : "revealed intel item "}
                                <span
                                  style={{ fontWeight: "bold", color: "#60a5fa" }}
                                  title={intel.description}
                                >
                                  {intel.description.length > 50 ? `${intel.description.slice(0, 50)}...` : intel.description}
                                </span>{" "}
                                <span
                                  className="badge bg-success ms-1"
                                  style={{ fontSize: "0.7rem", verticalAlign: "middle" }}
                                >
                                  verified
                                </span>
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                      {item.convincer_verification && (
                        <div
                          className="d-flex flex-column justify-content-center align-items-center w-100 gap-2"
                          style={{ margin: "12px 0" }}
                        >
                          <div
                            className="transparent-div"
                            style={{ minHeight: "40px", display: "flex", alignItems: "center", padding: "6px 16px" }}
                          >
                            <p
                              className="text-center m-0"
                              style={{ color: "#c3c3c3ff", fontSize: "0.85rem" }}
                            >
                              {item.convincer_verification.was_correct ? (
                                <>
                                  <span>validated convincer archetype for </span>
                                  <strong style={{ color: "#ffffff" }}>
                                    {item.convincer_verification.stakeholder_name || item.convincer_verification.stakeholder_id}
                                  </strong>
                                  <span>: </span>
                                  <span style={{ fontWeight: "bold", color: "#60a5fa" }}>
                                    {item.convincer_verification.true_archetype || item.convincer_verification.categorized_archetype}
                                  </span>{" "}
                                  <span
                                    className="badge bg-success ms-1"
                                    style={{ fontSize: "0.7rem", verticalAlign: "middle" }}
                                  >
                                    verified
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span>refuted convincer archetype for </span>
                                  <strong style={{ color: "#ffffff" }}>
                                    {item.convincer_verification.stakeholder_name || item.convincer_verification.stakeholder_id}
                                  </strong>
                                  <span> (was </span>
                                  <em>{item.convincer_verification.old_archetype}</em>
                                  <span> ➔ corrected to </span>
                                  <span style={{ fontWeight: "bold", color: "#60a5fa" }}>
                                    {item.convincer_verification.true_archetype}
                                  </span>
                                  <span>) </span>
                                  <span
                                    className="badge bg-warning text-dark ms-1"
                                    style={{ fontSize: "0.7rem", verticalAlign: "middle" }}
                                  >
                                    corrected
                                  </span>
                                </>
                              )}
                            </p>
                          </div>
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
            className={`card border-secondary shadow-sm ${styles.journalDialogueCard}`}
            data-intro-group="intro5"
            data-intro="Choose a dialogue option to respond to the stakeholders. Options are based on either discovered intel items or convincer archetypes."
            data-step="5"
            data-position="top"
          >
            <div className="card-header bg-light py-2 px-3 d-flex justify-content-between align-items-center border-bottom">
              <span className="fw-bold text-uppercase text-dark" style={{ letterSpacing: "0.04em", fontSize: "0.8rem" }}>
                Choose Dialogue Option
              </span>
              {!isEnabled ? (
                <span className="badge bg-secondary text-white fw-normal">
                  Processing response...
                </span>
              ) : (
                <span className="badge bg-light text-secondary border">
                  {dialogueOptions?.length || 0} Options
                </span>
              )}
            </div>

            <div className="card-body p-2 bg-light">
              {dialogueOptions && dialogueOptions.length > 0 ? (
                <div className={styles.journalDialogueGrid}>
                  {dialogueOptions.map((opt, index) => {
                    const isIntel = Boolean(opt.intel_item_id);

                    // Resolve stakeholder object, complete full name, and color
                    let stMatch: any = null;
                    let stakeholderName = opt.intel_stakeholder_name || "";
                    let stakeholderColor = "#0284c7";

                    if (isIntel) {
                      const searchId = (opt.intel_item_id || "").toLowerCase();
                      const searchName = (opt.intel_stakeholder_name || "").toLowerCase().trim();

                      // Match against stakeholders dictionary
                      for (const [stKey, stObj] of Object.entries(stakeholders || {})) {
                        const st = stObj as any;
                        const stNameLower = (st?.name || "").toLowerCase().trim();
                        if (
                          (searchName && (stNameLower === searchName || stNameLower.includes(searchName) || searchName.includes(stNameLower))) ||
                          (searchId && (searchId.includes(stKey.toLowerCase()) || (stNameLower && searchId.includes(stNameLower.replace(/\s+/g, "_"))))) ||
                          (stNameLower && opt.text.toLowerCase().includes(stNameLower))
                        ) {
                          stMatch = st;
                          break;
                        }
                      }

                      if (stMatch) {
                        stakeholderName = stMatch.name;
                        stakeholderColor = getStakeholderColor(stMatch);
                      } else if (!stakeholderName) {
                        const nameMatch = opt.text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[,:]/);
                        stakeholderName = nameMatch ? nameMatch[1] : "Stakeholder";
                      }
                    }

                    // Resolve archetype name with fallbacks
                    let archetypeName = "";
                    if (!isIntel) {
                      if (typeof opt.archetype === "string") {
                        archetypeName = opt.archetype;
                      } else if (opt.archetype?.name) {
                        archetypeName = opt.archetype.name;
                      } else if ((opt as any)?.archetype_name) {
                        archetypeName = (opt as any).archetype_name;
                      } else {
                        archetypeName = "General Alignment";
                      }
                    }

                    return (
                      <button
                        key={index}
                        type="button"
                        className={styles.journalOptionBtn}
                        disabled={!isEnabled}
                        onClick={() => onSelectDialogueOption?.(index)}
                      >
                        <div className="d-flex flex-wrap align-items-center gap-1 w-100 mb-2">
                          {isIntel ? (
                            <>
                              <span className="badge bg-primary text-white fw-bold text-uppercase" style={{ fontSize: "0.7rem" }}>
                                Intel-Based
                              </span>
                              <span
                                className="badge fw-semibold"
                                style={{
                                  backgroundColor: `${stakeholderColor}18`,
                                  color: stakeholderColor,
                                  border: `1.5px solid ${stakeholderColor}`,
                                  fontSize: "0.7rem",
                                }}
                              >
                                {stakeholderName}
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="badge bg-secondary text-white fw-bold text-uppercase" style={{ fontSize: "0.7rem" }}>
                                Corporate Noise
                              </span>
                              <span
                                className="badge bg-dark text-white fw-bold"
                                style={{ fontSize: "0.7rem" }}
                              >
                                {archetypeName}
                              </span>
                            </>
                          )}
                        </div>

                        <p className={styles.journalOptionText}>{opt.text}</p>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="alert alert-light border text-center text-muted mb-0 py-3 small">
                  {!isEnabled ? "Waiting for stakeholder responses..." : "No dialogue options available"}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
