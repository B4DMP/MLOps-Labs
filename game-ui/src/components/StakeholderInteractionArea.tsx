import StakeholdersList from "./StakeholderList";
import React, { useState, useEffect, useRef } from "react";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message,
  MessageInput,
  Avatar,
  TypingIndicator,
} from "@chatscope/chat-ui-kit-react";
import { StakeholderContext } from "./StakeholderProvider";

import { useContext } from "react";
import styles from "./StakeholderInteractionArea.module.css";
export type ChatMsg = { id: string; message: string; ac_id: number };
import CustomChatMessage from "./customChatMessage";
import type { ActionCard } from "../types/ActionCard";
import introJs from "intro.js";

interface StakeholderInteractionAreaProps {
  handleSend: (textContent: string) => void;
  chatMsgs: ChatMsg[];
  current_phase: number;
  current_challenge: number;
  isEnabled: boolean;
  actionCards: ActionCard[];
  onHoverCard: (id: number | null) => void;
  selected_mgs: string[];
  className?: string;
  showStakeholderList?: boolean;
  showInput?: boolean;
}

export default function StakeholderInteractionArea({
  handleSend,
  chatMsgs,
  current_phase,
  current_challenge,
  isEnabled,
  actionCards,
  onHoverCard,
  selected_mgs,
  className = "col-5",
  showStakeholderList = true,
  showInput = true,
}: StakeholderInteractionAreaProps) {
  const { stakeholders } = useContext(StakeholderContext);
  const [_isintro4Done, setIsintro4Done] = useState(false);
  const isintro4DoneRef = useRef(false);

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
      data-intro="This is the chat area where you can communicate with the previously selected stakeholders in order to find a solution for the current challenge. You can also use the chat to ask questions about MLOps or the content of the challenge."
      data-step="1"
      data-position="bottom"
    >
      <h6 className="transparent-div-label">
        💬 Stakeholder Interaction Area
      </h6>
      {showStakeholderList && (
        <StakeholdersList isEnabled={isEnabled} current_phase={current_phase} handleSend={handleSend} />
      )}

      <div className={`flex-grow-1 overflow-hidden rounded mt-3`}>
        <MainContainer
          className={`${styles.ChatContainer}`}
          style={{ height: "100%" }}
        >
          <ChatContainer className={`${styles.ChatContainer}`}>
            <MessageList
              className={`${styles.ChatContainer}`}
              typingIndicator={
                !isEnabled && (
                  <TypingIndicator data-intro-group="intro4" data-intro="This tells you that a stakeholder is currently typing a response."
                    data-position="bottom" content="A Stakeholder is typing" />
                )
              }
            >
              {chatMsgs.map((item, index) => {
                const isUser = !item.id || item.id === "user";
                const st = isUser
                  ? null
                  : stakeholders[item.id];

                return (
                  <React.Fragment key={index}>
                    <Message
                      className={`${styles.ChatMessage}`}
                      key={index}
                      model={{
                        message: item.message,
                        sentTime: "just now",
                        sender: isUser || !st ? "Me" : st.name,
                        direction: isUser ? "outgoing" : "incoming",
                        position: "single",
                      }}
                      avatarSpacer={isUser || !st ? false : true}
                    >
                      {!isUser && st && (
                        <Avatar
                          name={st.name}
                          src={`https://ui-avatars.com/api/?name=${st.name.replace(
                            " ",
                            "+",
                          )}&background=${st.stakeholder_color.slice(1)}`}
                          status="available"
                        />
                      )}
                    </Message>
                    {item.ac_id !== -1 && (
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
              <div style={{ height: showInput ? '80px' : '20px', flexShrink: 0 }} />
            </MessageList>
            {showInput && (
              <MessageInput className="intro5"
                data-intro-group="intro5"
                data-intro="Now it is your turn to negotiate with the stakeholders and decide for an action to take. This challenge is only an example, whose outcome will have no effect for the game."
                data-step="5"
                data-position="bottom"
                placeholder="Type message here"
                autoFocus={true}
                attachButton={false}
                onSend={handleSend}
                disabled={!isEnabled}
              />
            )}

          </ChatContainer>

          {selected_mgs && selected_mgs.length > 0 && (
            <div
              className={styles.customMessageContainer}
              style={!showInput ? { bottom: "10px" } : undefined}
            >
              <div className={styles.recommendationList}>
                {selected_mgs.map((item) => {
                  return <CustomChatMessage key={item} is_active={isEnabled} onClick={() => handleSend(item)} message={item} />
                })}
              </div>
            </div>
          )}

        </MainContainer>

      </div>
    </div>
  );
}
