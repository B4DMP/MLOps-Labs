import { Icon } from "@iconify/react";
import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StakeholderContext } from "../StakeholderProvider";
import { MetricsContext } from "../MetricProvider";
import HoverTooltip from "../HoverToolTip";
import SpokenText from "../SpokenText";
import StakeholderAvatarComponent from "../StakeholderAvatarComponent";
import { useGlossaryHighlighter } from "../glossary/GlossaryText";
import { useNarratorGate } from "../useNarratorGate";
import { useSpeech } from "../useSpeech";
import { startTour } from "../../utils/tour";
import { TOUR_GUIDE_SEED } from "../../utils/speech";
import { colorForStakeholderId } from "../../types/StakeholderAvatar";
import type { ActionCard } from "../../types/ActionCard";
import type { EngagementCard } from "../../types/EngagementCard";
import ActionReceipt from "./ActionReceipt";
import HistoryTabs from "./HistoryTabs";
import IntelChip from "./IntelChip";
import MessageBubble from "./MessageBubble";
import ProposalBand from "./ProposalBand";
import SpeechControls from "./SpeechControls";
import {
  convIdOf,
  getTabInfo,
  isSystemMsg,
  isUserMsg,
  type ChatMsg,
  type ProposalSummary,
  type RevealedIntel,
  type Stance,
  type Verdict,
} from "./chat";
import styles from "./ConversationHistory.module.css";

export interface ConversationHistoryProps {
  chatMsgs: ChatMsg[];
  engagementCards?: EngagementCard[];
  currentPhase: number;
  currentChallenge: number;
  isEnabled: boolean;
  isTyping?: boolean;
  typingText?: string;
  /** Names and shows the face of whoever is writing; without it the line is generic. */
  typingStakeholderId?: string | null;
  isPitchEvaluating?: boolean;
  evaluatingConversationId?: string | null;
  evaluatingText?: string;
  actionCards: ActionCard[];
  onHoverCard: (id: number | null) => void;
  className?: string;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  onInspectIntel?: (intel: RevealedIntel, stakeholderId?: string) => void;
  /** Sentence-highlight position for the message being narrated; null when nothing is. */
  activeSentenceIndex?: number | null;
  /** The entry in `chatMsgs` being narrated, matched by reference. */
  liveChatMsg?: ChatMsg | null;
  onStopSpeech?: () => void;
  onPlayMessage?: (msg: ChatMsg) => void;
  /** The pitched proposal and who has answered, shown in a band on pitch tabs. */
  proposal?: ProposalSummary | null;
  verdicts?: Verdict[];
  /** How a stakeholder answered the proposal, tagged on their last reply in `pitchConversationId`. */
  stances?: Record<string, Stance>;
  /** The pitch tab the band, verdicts and stance tags describe; other tabs show none of them. */
  pitchConversationId?: string | null;
}

export default function ConversationHistory({
  chatMsgs,
  engagementCards = [],
  currentPhase,
  currentChallenge,
  isEnabled,
  isTyping = false,
  typingText,
  typingStakeholderId = null,
  isPitchEvaluating = false,
  evaluatingConversationId,
  evaluatingText,
  actionCards,
  onHoverCard,
  className = "",
  isMaximized = false,
  onToggleMaximize,
  onInspectIntel,
  activeSentenceIndex = null,
  liveChatMsg = null,
  onStopSpeech,
  onPlayMessage,
  proposal = null,
  verdicts = [],
  stances,
  pitchConversationId = null,
}: ConversationHistoryProps) {
  const { stakeholders } = useContext(StakeholderContext) || { stakeholders: {} };
  const { metrics } = useContext(MetricsContext) || { metrics: {} };
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const paneRef = useRef<HTMLDivElement>(null);
  const isintro4DoneRef = useRef(false);
  const renderText = useGlossaryHighlighter("stakeholder_messages");
  const { speak: speakTour } = useSpeech();
  const gate = useNarratorGate();

  const conversationIds = useMemo(() => {
    const ids: string[] = [];
    chatMsgs.forEach((msg) => {
      const cid = convIdOf(msg);
      if (!ids.includes(cid)) ids.push(cid);
    });
    if (evaluatingConversationId && !ids.includes(evaluatingConversationId)) ids.push(evaluatingConversationId);
    return ids;
  }, [chatMsgs, evaluatingConversationId]);

  // A starting pitch takes the player straight to its tab.
  useEffect(() => {
    if (evaluatingConversationId) setActiveConversationId(evaluatingConversationId);
  }, [evaluatingConversationId]);

  // Keep the player's drag order while new conversations append at the end.
  useEffect(() => {
    setTabOrder((prev) => {
      const existing = prev.filter((id) => conversationIds.includes(id));
      const added = conversationIds.filter((id) => !existing.includes(id));
      const combined = [...existing, ...added];
      if (combined.length === prev.length && combined.every((id, i) => id === prev[i])) return prev;
      return combined;
    });
  }, [conversationIds]);

  const lastMsgConvId = chatMsgs.length > 0 ? convIdOf(chatMsgs[chatMsgs.length - 1]) : null;
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
    return chatMsgs.filter((msg) => convIdOf(msg) === activeConversationId);
  }, [chatMsgs, activeConversationId]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    chatMsgs.forEach((m) => {
      out[convIdOf(m)] = (out[convIdOf(m)] ?? 0) + 1;
    });
    return out;
  }, [chatMsgs]);

  // The stance tag goes on a stakeholder's last reply in the conversation it was read from.
  const stanceByIndex = useMemo(() => {
    const out = new Map<number, Stance>();
    if (!stances || !pitchConversationId || activeConversationId !== pitchConversationId) return out;
    Object.entries(stances).forEach(([id, stance]) => {
      for (let i = displayedMsgs.length - 1; i >= 0; i--) {
        const m = displayedMsgs[i];
        if (!isUserMsg(m) && !isSystemMsg(m) && (m.id === id || m.stakeholder_id === id)) {
          out.set(i, stance);
          break;
        }
      }
    });
    return out;
  }, [stances, pitchConversationId, activeConversationId, displayedMsgs]);

  // Stay pinned to the newest line as messages and the typing line arrive.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [displayedMsgs.length, activeConversationId, isTyping]);

  const getStakeholderColor = (st: { stakeholder_color?: string; metric_id?: string; id?: string } | null | undefined, stakeholderId?: string): string => {
    if (st?.stakeholder_color && st.stakeholder_color !== "#888888" && st.stakeholder_color !== "#ffffff") {
      return st.stakeholder_color;
    }
    if (st?.metric_id && metrics[st.metric_id]?.metric_color) return metrics[st.metric_id].metric_color;
    const id = stakeholderId || st?.id;
    return st?.stakeholder_color || (id ? colorForStakeholderId(id) : "#38bdf8");
  };

  useEffect(() => {
    if (!isEnabled && currentChallenge === 0 && currentPhase === 0 && !isintro4DoneRef.current) {
      isintro4DoneRef.current = true;
      setTimeout(() => {
        startTour("intro4", {
          beforeStart: () => gate.request(),
          narrate: (text) => speakTour(text, { slot: "narrator", seed: TOUR_GUIDE_SEED }),
        });
      }, 10);
    }
  }, [isEnabled, currentChallenge, currentPhase]);

  const typingStakeholder = typingStakeholderId ? stakeholders[typingStakeholderId] : null;
  const showBand = activeConversationId !== null && activeConversationId === pitchConversationId && (Boolean(proposal) || verdicts.length > 0);
  const hasTabs = tabOrder.length > 0;

  const renderMessage = (item: ChatMsg, index: number) => {
    const isLive = Boolean(liveChatMsg) && item === liveChatMsg;
    const play = onPlayMessage ? () => onPlayMessage(item) : undefined;
    const controls = play && !isSystemMsg(item) ? <SpeechControls isLive={isLive} onPlay={play} onStop={onStopSpeech} /> : null;
    const spoken = isLive ? (
      <SpokenText text={item.message} activeSentenceIndex={activeSentenceIndex} renderSentence={renderText} />
    ) : (
      renderText(item.message)
    );

    if (isSystemMsg(item)) {
      return (
        <ActionReceipt icon="ph:terminal-window-bold" title="System">
          {spoken}
        </ActionReceipt>
      );
    }
    if (isUserMsg(item)) {
      const info = getTabInfo(convIdOf(item), engagementCards);
      const title = convIdOf(item).startsWith("eng_") ? `You played ${info.title}` : "You";
      return (
        <ActionReceipt icon={info.icon} title={title} controls={controls}>
          {spoken}
        </ActionReceipt>
      );
    }

    const st = stakeholders[item.id] || (item.stakeholder_id ? stakeholders[item.stakeholder_id] : null);
    return (
      <MessageBubble
        msg={item}
        name={st ? st.name : item.stakeholder_name || "Stakeholder"}
        metric={st?.metric_id ? metrics[st.metric_id]?.name : undefined}
        color={getStakeholderColor(st, item.id)}
        avatar={st?.avatar}
        stakeholderId={item.id || item.stakeholder_id}
        isLive={isLive}
        activeSentenceIndex={activeSentenceIndex}
        renderText={renderText}
        stance={stanceByIndex.get(index)}
        onPlay={play}
        onStop={onStopSpeech}
      />
    );
  };

  const evaluatingHere =
    isPitchEvaluating && (!evaluatingConversationId || activeConversationId === evaluatingConversationId);

  return (
    <div
      className={`${styles.root} ${className}`}
      data-intro-group="intro5"
      data-intro="This is the chat area, where you actually talk to the stakeholders you picked. Nothing gets resolved by silence - the more you dig into what they want here, the more dossier intel and dialogue options open up, and yes, they can tell if you're stalling."
      data-step="1"
      data-position="bottom"
    >
      <div className={styles.panel}>
        <div className={styles.head}>
          {hasTabs && (
            <HistoryTabs
              order={tabOrder}
              onReorder={setTabOrder}
              activeId={activeConversationId}
              onSelect={setActiveConversationId}
              counts={counts}
              engagementCards={engagementCards}
            />
          )}
          {!hasTabs && <span className={styles.tabs} />}
          {onToggleMaximize && (
            <HoverTooltip
              description={isMaximized ? "Restore view (Show Challenge & Pitch Deck)" : "Maximize conversation history"}
              labelsChild
            >
              <button type="button" className={styles.maxBtn} onClick={onToggleMaximize}>
                <Icon icon={isMaximized ? "ph:arrows-in-simple-bold" : "ph:arrows-out-simple-bold"} />
              </button>
            </HoverTooltip>
          )}
        </div>

        <div className={styles.sheet}>
          {showBand && <ProposalBand proposal={proposal} verdicts={verdicts} />}
          <div className={styles.pane} ref={paneRef} role="log" aria-live="polite" aria-label="Conversation history">
            {displayedMsgs.length === 0 &&
              (evaluatingHere ? (
                <div className={styles.empty}>
                  <Icon icon="ph:spinner-gap-bold" className={styles.evaluatingSpinner} />
                  <span className={styles.emptyPrimary}>Presenting Action Proposal...</span>
                  <span className={styles.emptySecondary}>
                    {evaluatingText || "Stakeholders are reviewing the commitments and assessing system impact"}
                  </span>
                </div>
              ) : (
                <div className={styles.empty}>
                  <Icon icon="ph:chats-circle-bold" className={styles.emptyIcon} />
                  <span className={styles.emptyPrimary}>No messages in this conversation</span>
                  <span className={styles.emptySecondary}>
                    Play an Engagement Card or Action Card to consult with stakeholders
                  </span>
                </div>
              ))}

            {displayedMsgs.map((item, index) => {
              const speaker = isUserMsg(item) || isSystemMsg(item) ? undefined : stakeholders[item.id]?.name;
              return (
                <React.Fragment key={index}>
                  {renderMessage(item, index)}
                  {(item.revealed_intel ?? []).map((intel, idx) => (
                    <IntelChip
                      key={intel.id || idx}
                      intel={intel}
                      speakerName={speaker}
                      onInspect={
                        onInspectIntel ? () => onInspectIntel(intel, intel.stakeholder_id || item.id) : undefined
                      }
                    />
                  ))}
                  {item.ac_id !== -1 && actionCards[item.ac_id] && (
                    <ActionReceipt
                      icon="ph:cards-bold"
                      title="Generated action card"
                      anchorProps={
                        item.ac_id === 0
                          ? {
                              "data-intro-group": "intro5",
                              "data-intro":
                                "If a stakeholder proposes something concrete, the game turns it into an action card automatically - click it any time to see exactly what they're now on record asking for, whether they remember saying it or not.",
                              "data-step": "2",
                              "data-position": "bottom",
                            }
                          : undefined
                      }
                    >
                      <span
                        className={styles.lineAction}
                        onMouseEnter={() => onHoverCard?.(item.ac_id)}
                        onMouseLeave={() => onHoverCard?.(null)}
                      >
                        {actionCards[item.ac_id]?.title}
                      </span>
                    </ActionReceipt>
                  )}
                </React.Fragment>
              );
            })}

            {(isTyping || !isEnabled) && (
              <div
                className={styles.typing}
                style={typingStakeholder ? { ["--c" as string]: getStakeholderColor(typingStakeholder, typingStakeholderId!) } : undefined}
                data-intro-group="intro4"
                data-intro="This tells you a stakeholder is typing a response - nothing to do here but wait a moment; your own next move only unlocks once they've actually finished."
                data-position="bottom"
              >
                {typingStakeholder && (
                  <span className={styles.avatarBtn} aria-hidden="true">
                    <span className={styles.avatarFace}>
                      <StakeholderAvatarComponent
                        avatar={typingStakeholder.avatar}
                        emotion="smile"
                        play_blink_animation={true}
                        isFramed={false}
                        thumb
                        size="100%"
                        stakeholderColor={getStakeholderColor(typingStakeholder, typingStakeholderId!)}
                        stakeholderId={typingStakeholderId!}
                      />
                    </span>
                  </span>
                )}
                <span className={`${styles.typingBody} ${typingStakeholder ? "" : styles.typingBodyBare}`}>
                  <span className={styles.dots} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {typingStakeholder ? `${typingStakeholder.name} is writing` : typingText || "A stakeholder is typing..."}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
