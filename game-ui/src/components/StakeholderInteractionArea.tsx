import { Icon } from "@iconify/react";
import { EmojiIcon } from "../utils/emojiIcons";
import StakeholdersList from "./StakeholderList";
import React, { useState, useEffect, useRef, useContext, useMemo } from "react";
import { Reorder } from "motion/react";
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
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import HoverTooltip from "./HoverToolTip";
import type { AvatarEmotion } from "../types/StakeholderAvatar";
import { colorForStakeholderId } from "../types/StakeholderAvatar";
import type { DialogueOption } from "../types/DialogueOption";
import type { ActionCard } from "../types/ActionCard";
import { startTour } from "../utils/tour";
import { useNarratorGate } from "./useNarratorGate";
import { TOUR_GUIDE_SEED } from "../utils/speech";
import { useSpeech } from "./useSpeech";

import styles from "./StakeholderInteractionArea.module.css";
import { useGlossaryHighlighter } from "./glossary/GlossaryText";
import SpokenText from "./SpokenText";
import { useGlossary } from "./glossary/GlossaryProvider";

import type { EngagementCard } from "../types/EngagementCard";

export type RevealedIntel = {
  id?: string;
  requirement_id?: string;
  description: string;
  categorized_type?: string;
  intel_type?: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
  is_corrected?: boolean;
  is_verified?: boolean;
};

export type ChatMsg = {
  id: string;
  message: string;
  ac_id: number;
  emotional_state?: string;
  facial_expression?: string;
  revealed_intel?: RevealedIntel[];
  conversation_id?: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
};

export function getTabInfo(
  conversationId: string,
  engagementCards: EngagementCard[] = []
): { title: string; icon: string } {
  if (!conversationId || conversationId === "default") {
    return { title: "Conversation", icon: "ph:chats-circle-bold" };
  }
  if (conversationId === "conv_legacy") {
    return { title: "Archived Debate", icon: "ph:archive-box-bold" };
  }
  if (conversationId.startsWith("pitch_")) {
    const num = conversationId.replace("pitch_", "");
    return {
      title: num ? `Action Pitch #${num}` : "Action Pitch",
      icon: "ph:presentation-chart-bold",
    };
  }
  if (conversationId.startsWith("eng_")) {
    const lastUnderscore = conversationId.lastIndexOf("_");
    if (lastUnderscore > 4) {
      const cardId = conversationId.substring(4, lastUnderscore);
      const playCount = conversationId.substring(lastUnderscore + 1);
      const card = engagementCards.find((c) => c.id === cardId || c.id === conversationId.slice(4));
      const countNum = parseInt(playCount, 10);
      const suffix = !isNaN(countNum) && countNum > 1 ? ` #${countNum}` : "";
      if (card) {
        return {
          title: `${card.title}${suffix}`,
          icon: card.icon ? `ph:${card.icon}` : "ph:chat-teardrop-text-bold",
        };
      }
      const formattedName = cardId
        .replace(/[_-]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      return {
        title: `${formattedName}${suffix}`,
        icon: "ph:chat-teardrop-text-bold",
      };
    } else {
      const cardId = conversationId.slice(4);
      const card = engagementCards.find((c) => c.id === cardId);
      return {
        title: card ? card.title : cardId.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        icon: card?.icon ? `ph:${card.icon}` : "ph:chat-teardrop-text-bold",
      };
    }
  }
  if (conversationId.startsWith("verify_")) {
    const num = conversationId.replace("verify_", "");
    return {
      title: num ? `Intel Verification #${num}` : "Intel Verification",
      icon: "ph:shield-check-bold",
    };
  }

  return {
    title: conversationId.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    icon: "ph:chats-bold",
  };
}

interface StakeholderInteractionAreaProps {
  onSelectDialogueOption?: (index: number) => void;
  dialogueOptions?: DialogueOption[];
  chatMsgs: ChatMsg[];
  engagementCards?: EngagementCard[];
  current_phase: number;
  current_challenge: number;
  isEnabled: boolean;
  isTyping?: boolean;
  typingText?: string;
  isPitchEvaluating?: boolean;
  evaluatingConversationId?: string | null;
  evaluatingText?: string;
  actionCards: ActionCard[];
  onHoverCard: (id: number | null) => void;
  className?: string;
  showStakeholderList?: boolean;
  showDialogueOptions?: boolean;
  /** The rail already says what this is, so it can hide the component heading. */
  showHeader?: boolean;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  onInspectIntel?: (intel: RevealedIntel, stakeholderId?: string) => void;
  /** The sentence-highlight position for whichever message is currently being narrated by TTS
   * (see SpokenText) - null/undefined when nothing is being narrated. */
  activeSentenceIndex?: number | null;
  /** Identifies, by reference, which entry in `chatMsgs` is the one currently being narrated -
   * that single entry renders through SpokenText instead of its normal static content. */
  liveChatMsg?: ChatMsg | null;
  /** Stop appears only on the line currently being narrated; play/replay appears on that line
   * plus (on hover) any other stakeholder message, so a past line can be read aloud on demand. */
  onStopSpeech?: () => void;
  onPlayMessage?: (msg: ChatMsg) => void;
}

export default function StakeholderInteractionArea({
  onSelectDialogueOption,
  dialogueOptions = [],
  chatMsgs,
  engagementCards = [],
  current_phase,
  current_challenge,
  isEnabled,
  isTyping = false,
  typingText,
  isPitchEvaluating = false,
  evaluatingConversationId,
  evaluatingText,
  actionCards,
  onHoverCard,
  className = "col-5",
  showStakeholderList = true,
  showDialogueOptions = true,
  showHeader = true,
  isMaximized = false,
  onToggleMaximize,
  onInspectIntel,
  activeSentenceIndex = null,
  liveChatMsg = null,
  onStopSpeech,
  onPlayMessage,
}: StakeholderInteractionAreaProps) {
  const { stakeholders } = useContext(StakeholderContext) || { stakeholders: {} };
  const { metrics } = useContext(MetricsContext) || { metrics: {} };
  const [_isintro4Done, setIsintro4Done] = useState(false);
  const isintro4DoneRef = useRef(false);
  const [hoveredMsgAvatarIndex, setHoveredMsgAvatarIndex] = useState<number | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  // Where each message's speech controls should anchor (chatscope lays the avatar/bubble out
  // internally, so this is measured from the DOM rather than assumed): badges sit right on the
  // avatar's own edge for stakeholder messages, forming one visual unit with it instead of a
  // separate floating pill. Player messages have no avatar (chatscope reserves no avatar slot for
  // outgoing bubbles), so those anchor to the bubble's own corner instead.
  type ControlAnchor = { kind: "avatar" | "content"; top: number; left: number; right: number; bottom: number };
  const [controlAnchors, setControlAnchors] = useState<Record<number, ControlAnchor>>({});
  const measureControlAnchor = (index: number, rowEl: HTMLDivElement | null) => {
    if (!rowEl) return;
    const rowRect = rowEl.getBoundingClientRect();
    const target = rowEl.querySelector<HTMLElement>(".cs-avatar") || rowEl.querySelector<HTMLElement>(".cs-message__content");
    if (!target) return;
    const kind: ControlAnchor["kind"] = target.classList.contains("cs-avatar") ? "avatar" : "content";
    const r = target.getBoundingClientRect();
    const next: ControlAnchor = {
      kind,
      top: r.top - rowRect.top,
      left: r.left - rowRect.left,
      right: r.right - rowRect.left,
      bottom: r.bottom - rowRect.top,
    };
    setControlAnchors((prev) => {
      const cur = prev[index];
      if (
        cur &&
        cur.kind === next.kind &&
        cur.top === next.top &&
        cur.left === next.left &&
        cur.right === next.right &&
        cur.bottom === next.bottom
      ) {
        return prev;
      }
      return { ...prev, [index]: next };
    });
  };

  const conversationIds = useMemo(() => {
    const ids: string[] = [];
    chatMsgs.forEach((msg) => {
      const cid = msg.conversation_id || "default";
      if (!ids.includes(cid)) {
        ids.push(cid);
      }
    });
    if (evaluatingConversationId && !ids.includes(evaluatingConversationId)) {
      ids.push(evaluatingConversationId);
    }
    return ids;
  }, [chatMsgs, evaluatingConversationId]);

  // When evaluatingConversationId is set, immediately switch active tab to it
  useEffect(() => {
    if (evaluatingConversationId) {
      setActiveConversationId(evaluatingConversationId);
    }
  }, [evaluatingConversationId]);

  // Keep tabOrder in sync with conversationIds while preserving user drag-and-drop order
  useEffect(() => {
    setTabOrder((prev) => {
      const existing = prev.filter((id) => conversationIds.includes(id));
      const added = conversationIds.filter((id) => !existing.includes(id));
      const combined = [...existing, ...added];
      if (
        combined.length === prev.length &&
        combined.every((id, i) => id === prev[i])
      ) {
        return prev;
      }
      return combined;
    });
  }, [conversationIds]);

  const lastMsgConvId = chatMsgs.length > 0 ? (chatMsgs[chatMsgs.length - 1].conversation_id || "default") : null;
  const prevLastMsgConvIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (conversationIds.length > 0) {
      if (!activeConversationId || !conversationIds.includes(activeConversationId)) {
        setActiveConversationId(evaluatingConversationId || conversationIds[conversationIds.length - 1]);
      } else if (lastMsgConvId && lastMsgConvId !== prevLastMsgConvIdRef.current) {
        setActiveConversationId(lastMsgConvId);
      }
    } else {
      setActiveConversationId(null);
    }
    prevLastMsgConvIdRef.current = lastMsgConvId;
  }, [conversationIds, activeConversationId, lastMsgConvId, evaluatingConversationId]);

  const displayedMsgs = useMemo(() => {
    if (!activeConversationId) return chatMsgs;
    return chatMsgs.filter((msg) => (msg.conversation_id || "default") === activeConversationId);
  }, [chatMsgs, activeConversationId]);


  const getStakeholderColor = (st: any, stakeholderId?: string): string => {
    if (st?.stakeholder_color && st.stakeholder_color !== "#888888" && st.stakeholder_color !== "#ffffff") {
      return st.stakeholder_color;
    }
    if (st?.metric_id && metrics[st.metric_id]?.metric_color) {
      return metrics[st.metric_id].metric_color;
    }
    // Deterministic per-stakeholder fallback instead of one flat color for everyone
    // (code-review finding: this bypasses StakeholderAvatarComponent's own fallback entirely).
    const id = stakeholderId || st?.id;
    return st?.stakeholder_color || (id ? colorForStakeholderId(id) : "#38bdf8");
  };

  const highlightMessage = useGlossaryHighlighter("stakeholder_messages");
  const { isSurfaceEnabled } = useGlossary();
  const highlightMessages = isSurfaceEnabled("stakeholder_messages");
  const { speak: speakTour } = useSpeech();
  const gate = useNarratorGate();

  useEffect(() => {
    if (!isEnabled && current_challenge === 0 && current_phase === 0 && !isintro4DoneRef.current) {
      isintro4DoneRef.current = true;
      setIsintro4Done(true);
      setTimeout(() => {
        startTour("intro4", { beforeStart: () => gate.request(), narrate: (text) => speakTour(text, { slot: "narrator", seed: TOUR_GUIDE_SEED }) });
      }, 10);
    }
  }, [isEnabled, current_challenge, current_phase]);

  return (
    <div
      className={`${className} ${showDialogueOptions ? "p-3" : "p-2"} h-100 d-flex flex-column rounded transparent-div ${styles.ChatContainer}`}
      data-intro-group="intro5"
      data-intro="This is the chat area, where you actually talk to the stakeholders you picked. Nothing gets resolved by silence - the more you dig into what they want here, the more dossier intel and dialogue options open up, and yes, they can tell if you're stalling."
      data-step="1"
      data-position="bottom"
    >
      <div className="d-flex justify-content-between align-items-center mb-1 w-100 flex-shrink-0">
        {showHeader && <h6 className={`transparent-div-label ${styles.chatHeaderTitle}`}>
          <EmojiIcon name="chatThread" /> Conversation History {chatMsgs.length > 0 ? `(${chatMsgs.length})` : ""}
        </h6>}
        {onToggleMaximize && (
          <HoverTooltip
            description={isMaximized ? "Restore view (Show Challenge & Pitch Deck)" : "Maximize conversation history"}
            labelsChild
          >
            <button type="button" className={styles.maximizeToggleBtn} onClick={onToggleMaximize}>
              <Icon
                icon={isMaximized ? "ph:arrows-in-simple-bold" : "ph:arrows-out-simple-bold"}
              />
            </button>
          </HoverTooltip>
        )}
      </div>
      {showStakeholderList && (
        <StakeholdersList current_phase={current_phase} />
      )}

      {tabOrder.length > 0 && (
        <div className={styles.tabBarContainer}>
          <Reorder.Group
            axis="x"
            values={tabOrder}
            onReorder={setTabOrder}
            className={styles.tabBarScroll}
            as="div"
          >
            {tabOrder.map((cid: string) => {
              const info = getTabInfo(cid, engagementCards);
              const isActive = cid === activeConversationId;
              const count = chatMsgs.filter((m) => (m.conversation_id || "default") === cid).length;
              return (
                <Reorder.Item
                  key={cid}
                  value={cid}
                  as="div"
                  className={styles.tabItemWrapper}
                  whileDrag={{ scale: 1.04, zIndex: 10 }}
                >
                  <button
                    type="button"
                    className={`${styles.tabBtn} ${isActive ? styles.tabBtnActive : ""}`}
                    onClick={() => setActiveConversationId(cid)}
                  >
                    <Icon icon="ph:dots-six-vertical-bold" className={styles.tabDragHandle} />
                    <Icon icon={info.icon} className={styles.tabIcon} />
                    <span className={styles.tabLabel}>{info.title}</span>
                    <span className={`${styles.tabBadge} ${isActive ? styles.tabBadgeActive : ""}`}>
                      {count}
                    </span>
                  </button>
                </Reorder.Item>
              );
            })}
          </Reorder.Group>
        </div>
      )}

      <div className={`${styles.messageAreaWrapper} ${showDialogueOptions ? "mt-3" : "mt-1"}`}>
        <div className={styles.innerChatScroll}>
          <MainContainer
            className={styles.ChatContainer}
            style={{ height: "100%" }}
          >
            <ChatContainer className={styles.ChatContainer}>
              <MessageList
                className={styles.ChatContainer}
                typingIndicator={
                  (isTyping || !isEnabled) && (
                    <TypingIndicator
                      data-intro-group="intro4"
                      data-intro="This tells you a stakeholder is typing a response - nothing to do here but wait a moment; your own next move only unlocks once they've actually finished."
                      data-position="bottom"
                      content={typingText || "A stakeholder is typing..."}
                    />
                  )
                }
              >
                {displayedMsgs.length === 0 && (
                  (isPitchEvaluating && (!evaluatingConversationId || activeConversationId === evaluatingConversationId)) ? (
                    <div className={styles.evaluatingContainer}>
                      <Icon icon="ph:spinner-gap-bold" className={styles.evaluatingSpinner} />
                      <div className={styles.evaluatingTextContainer}>
                        <span className={styles.evaluatingTitle}>Presenting Action Proposal...</span>
                        <span className={styles.evaluatingSubtitle}>
                          {evaluatingText || "Stakeholders are reviewing the commitments and assessing system impact"}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.emptyStateContainer}>
                      <Icon icon="ph:chats-circle-bold" className={styles.emptyStateIcon} />
                      <span className={styles.emptyStatePrimary}>No messages in this conversation</span>
                      <span className={styles.emptyStateSecondary}>Play an Engagement Card or Action Card to consult with stakeholders</span>
                    </div>
                  )
                )}

                {displayedMsgs.map((item: ChatMsg, index: number) => {
                  const isUser = !item.id || item.id === "user";
                  const isSystem = item.id === "system" || item.id === "__environment__";
                  const st = isUser || isSystem ? null : (stakeholders[item.id] || (item.stakeholder_id ? stakeholders[item.stakeholder_id] : null));
                  const senderName = isUser ? "Me" : isSystem ? "System Telemetry" : st ? st.name : (item.stakeholder_name || "Stakeholder");
                  const stColor = isSystem ? "#38bdf8" : getStakeholderColor(st, isUser ? undefined : item.id);

                  const isLive = Boolean(liveChatMsg) && item === liveChatMsg;
                  let avatarSrc = "";
                  let messageAv: any = null;
                  let messageFace: AvatarEmotion | undefined;
                  if (!isUser) {
                    if (isSystem) {
                      avatarSrc = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="%2338bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/></svg>`;
                    } else {
                      messageAv = st?.avatar;
                      const isHovered = hoveredMsgAvatarIndex === index;
                      messageFace = (isHovered ? "suspicious" : (item.facial_expression || messageAv?.face || messageAv?.emotion || "smile")) as AvatarEmotion;
                    }
                  }
                  // Stop only makes sense while this exact line is playing; (re)play is offered on
                  // every message - stakeholder or player, not just the one currently narrating -
                  // so a past line can be read aloud on demand too. System telemetry has no voice.
                  const showSpeechControls = !isSystem && Boolean(onPlayMessage);
                  const anchor = controlAnchors[index];
                  const playBtn = (
                    <HoverTooltip description={isLive ? "Replay" : "Play"}>
                      <button
                        type="button"
                        className={styles.liveSpeechControlBtn}
                        onClick={() => onPlayMessage?.(item)}
                        aria-label={isLive ? "Replay from the start" : "Read this message aloud"}
                      >
                        <Icon icon={isLive ? "ph:arrow-clockwise-bold" : "ph:play-circle-bold"} />
                      </button>
                    </HoverTooltip>
                  );
                  const stopBtn = isLive && onStopSpeech && (
                    <HoverTooltip description="Stop">
                      <button
                        type="button"
                        className={styles.liveSpeechControlBtn}
                        onClick={onStopSpeech}
                        aria-label="Stop speaking"
                      >
                        <Icon icon="ph:stop-circle-bold" />
                      </button>
                    </HoverTooltip>
                  );

                  return (
                    <React.Fragment key={index}>
                      <div className={styles.chatMessageRow} ref={(el) => measureControlAnchor(index, el)}>
                      {showSpeechControls && anchor && anchor.kind === "avatar" && (
                        <>
                          {/* One coherent unit with the avatar: badges sit right on its bottom
                              corners rather than floating separately above it. */}
                          <div
                            className={styles.avatarSpeechBadge}
                            style={{ top: anchor.bottom, left: anchor.right }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {playBtn}
                          </div>
                          {stopBtn && (
                            <div
                              className={styles.avatarSpeechBadge}
                              style={{ top: anchor.bottom, left: anchor.left }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {stopBtn}
                            </div>
                          )}
                        </>
                      )}
                      {showSpeechControls && anchor && anchor.kind === "content" && (
                        <>
                          {/* No avatar to badge onto for a player message (chatscope reserves no
                              avatar slot for outgoing bubbles) - anchor to the bubble's own
                              bottom-right corner instead. Bottom, not top: the chat list scrolls,
                              and a control poking up past the row's top edge got clipped by the
                              scroll viewport and was unclickable. */}
                          <div
                            className={styles.avatarSpeechBadge}
                            style={{ top: anchor.bottom, left: anchor.right }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {playBtn}
                          </div>
                          {stopBtn && (
                            <div
                              className={styles.avatarSpeechBadge}
                              style={{ top: anchor.bottom, left: anchor.right - 22 }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {stopBtn}
                            </div>
                          )}
                        </>
                      )}
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
                        {/* Custom content when the glossary is on for this surface, or while this
                            exact message is the one currently being read aloud (sentence
                            highlight) - otherwise the bubble renders exactly as it always did. */}
                        {(highlightMessages || isLive) && (
                          <Message.CustomContent>
                            {isLive ? (
                              <SpokenText
                                text={item.message}
                                activeSentenceIndex={activeSentenceIndex}
                                renderSentence={highlightMessages ? highlightMessage : undefined}
                              />
                            ) : (
                              highlightMessage(item.message)
                            )}
                          </Message.CustomContent>
                        )}
                        {!isUser && (
                          <Avatar
                            name={senderName}
                            src={isSystem ? avatarSrc : undefined}
                            onMouseEnter={() => setHoveredMsgAvatarIndex(index)}
                            onMouseLeave={() => setHoveredMsgAvatarIndex(null)}
                            style={{ cursor: "pointer" }}
                          >
                            {/* A real animated avatar (mouth-flap + head-sway while isLive) rather
                                than a static image - Avatar renders this in place of its own
                                <img src> whenever children are given. */}
                            {!isSystem && (
                              <StakeholderAvatarComponent
                                avatar={messageAv}
                                emotion={messageFace}
                                play_blink_animation={true}
                                isFramed={false}
                                size="100%"
                                stakeholderColor={stColor}
                                stakeholderId={item.id || item.stakeholder_id}
                                title={senderName}
                              />
                            )}
                          </Avatar>
                        )}
                      </Message>
                      </div>
                      {item.revealed_intel && item.revealed_intel.length > 0 && (
                        <div
                          className={`d-flex flex-column justify-content-center align-items-center ${styles.revealedIntelContainer} gap-2`}
                        >
                          {item.revealed_intel.map((intel: RevealedIntel, idx: number) => {
                            const isClickable = Boolean(onInspectIntel);
                            return (
                              <HoverTooltip
                                key={intel.id || idx}
                                description={
                                  isClickable
                                    ? `${intel.description.length > 60 ? `${intel.description}\n` : ""}Click to highlight this note in ${intel.stakeholder_name || "stakeholder"}'s dossier`
                                    : intel.description
                                }
                              >
                              <div
                                className={`transparent-div ${styles.indicationPill} ${isClickable ? styles.revealedIntelItemClickable : ""}`}
                                onClick={() => {
                                  if (onInspectIntel) {
                                    onInspectIntel(intel, intel.stakeholder_id || item.id);
                                  }
                                }}
                                role={isClickable ? "button" : undefined}
                                tabIndex={isClickable ? 0 : undefined}
                                onKeyDown={(e) => {
                                  if (isClickable && (e.key === "Enter" || e.key === " ")) {
                                    e.preventDefault();
                                    onInspectIntel!(intel, intel.stakeholder_id || item.id);
                                  }
                                }}
                              >
                                <div className={styles.indicationText}>
                                  <span className={styles.revealedIntelLabel}>
                                    {intel.is_corrected
                                      ? "corrected intel item: "
                                      : intel.is_verified
                                      ? "verified intel item: "
                                      : "revealed intel item: "}
                                  </span>
                                  <span style={{ fontWeight: "bold", color: "#60a5fa" }}>
                                    {intel.description.length > 60 ? `${intel.description.slice(0, 60)}...` : intel.description}
                                  </span>
                                  {isClickable && (
                                    <Icon
                                      icon="ph:arrow-square-out-bold"
                                      className={styles.revealedIntelInspectIcon}
                                      style={{ fontSize: "0.85rem", color: "#60a5fa" }}
                                    />
                                  )}
                                </div>
                              </div>
                              </HoverTooltip>
                            );
                          })}
                        </div>
                      )}
                      {item.ac_id !== -1 && actionCards[item.ac_id] && (
                        <div
                          className={`d-flex justify-content-center align-items-center ${styles.revealedIntelContainer} ${item.ac_id === 0 && "intro5"}`}
                          {...(item.ac_id === 0 ? {
                            "data-intro-group": "intro5",
                            "data-intro": "If a stakeholder proposes something concrete, the game turns it into an action card automatically - click it any time to see exactly what they're now on record asking for, whether they remember saying it or not.",
                            "data-step": "2",
                            "data-position": "bottom"
                          } : {})}
                        >
                          <div
                            className={`transparent-div ${styles.indicationPill}`}
                          >
                            <div
                              className={styles.indicationText}
                            >
                              <span>generated action card </span>
                              <span
                                style={{ fontWeight: "bold", cursor: "pointer", color: "#60a5fa" }}
                                onMouseEnter={() => onHoverCard?.(item.ac_id)}
                                onMouseLeave={() => onHoverCard?.(null)}
                              >
                                {actionCards[item.ac_id]?.title}
                              </span>
                            </div>
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
            data-intro="Choose a dialogue option to respond. The options on offer are built from the intel you've actually found - so if a stakeholder isn't budging, the dossier is probably where the missing leverage is, not this list."
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
                      let stMatchKey: string | null = null;
                      for (const [stKey, stObj] of Object.entries(stakeholders || {})) {
                        const st = stObj as any;
                        const stNameLower = (st?.name || "").toLowerCase().trim();
                        if (
                          (searchName && (stNameLower === searchName || stNameLower.includes(searchName) || searchName.includes(stNameLower))) ||
                          (searchId && (searchId.includes(stKey.toLowerCase()) || (stNameLower && searchId.includes(stNameLower.replace(/\s+/g, "_"))))) ||
                          (stNameLower && (opt.text || "").toLowerCase().includes(stNameLower))
                        ) {
                          stMatch = st;
                          stMatchKey = stKey;
                          break;
                        }
                      }

                      if (stMatch) {
                        stakeholderName = stMatch.name;
                        stakeholderColor = getStakeholderColor(stMatch, stMatchKey || undefined);
                      } else if (!stakeholderName) {
                        const nameMatch = (opt.text || "").match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)[,:]/);
                        stakeholderName = nameMatch ? nameMatch[1] : "Stakeholder";
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
                            <span className="badge bg-secondary text-white fw-bold text-uppercase" style={{ fontSize: "0.7rem" }}>
                              Corporate Noise
                            </span>
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
