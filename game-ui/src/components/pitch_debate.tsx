import { useState, useContext, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import type { ActionCard } from "../types/ActionCard";
import type { DialogueOption } from "../types/DialogueOption";
import { StakeholderContext } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import styles from "./pitch_debate.module.css";
import StakeholderDossier, { type StakeholderDossierEntry } from "./StakeholderDossier";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import StakeholderInteractionArea, { type ChatMsg } from "./StakeholderInteractionArea";
import PerformanceDashboard from "./PerformanceDashboard";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import ChallengeDescriptionCard from "./ChallengeDescriptionCard";
import ActionCardDetailModal from "./ActionCardDetailModal";

export interface IntelItem {
  id: string;
  requirement_id?: string;
  intel_type: string;
  categorized_type: string;
  description: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
}

interface PitchDebateProps {
  currentPhase: number;
  setCurrentPhase?: React.Dispatch<React.SetStateAction<number>>;
  phases?: any[];
  setPhases?: React.Dispatch<React.SetStateAction<any[]>>;
  metrics?: any;
  setMetrics?: React.Dispatch<React.SetStateAction<any>>;
  stakeholders?: any;
  setStakeholders?: React.Dispatch<React.SetStateAction<any>>;
  lastError?: string;
  isInErrorUi?: boolean;
  setIsInErrorUi?: (open: boolean) => void;
  isPhaseDialogueOpen?: boolean;
  setIsPhaseDialogueOpen?: (open: boolean) => void;
  challengeTitle: string;
  challengeDescription: string;
  challengeIntro: string;
  currentChallenge: number;
  challengeNumber: number;
  revealAc?: boolean;
  last_ac?: ActionCard;
  roundOverAnimActive?: boolean;
  showMetricValueChanges?: boolean;
  isChatEnabled: boolean;
  actionCards?: ActionCard[];
  hoveredCardId?: number | null;
  setHoveredCardId?: (id: number | null) => void;
  dialogueOptions: DialogueOption[];
  chat_msgs: ChatMsg[];
  setChatMsgs?: React.Dispatch<React.SetStateAction<ChatMsg[]>>;
  playActionCard?: (ac: ActionCard) => void;
  getNextChallenge?: (ac: ActionCard) => void;
  pitchedActionCard?: ActionCard | null;
  dossierData?: StakeholderDossierEntry[];
  intelItems?: IntelItem[];
  onEndPitch?: (passed: boolean) => void;
}

export default function PitchDebate({
  currentPhase,
  challengeTitle,
  challengeDescription,
  challengeIntro,
  currentChallenge,
  challengeNumber,
  showMetricValueChanges = false,
  isChatEnabled,
  dialogueOptions = [],
  chat_msgs = [],
  setChatMsgs,
  onSelectDialogueOption,
  pitchedActionCard,
  dossierData = [],
  intelItems = [],
  onEndPitch,
  last_ac,
}: PitchDebateProps) {
  const stakeholderCtx = useContext(StakeholderContext);
  const stakeholders = stakeholderCtx?.stakeholders || {};
  const metricsCtx = useContext(MetricsContext);
  const metrics = metricsCtx?.metrics || {};

  // Selected Stakeholder & UI States
  const [selectedStakeholderId, setSelectedStakeholderId] = useState<string>("requirements_reuben");
  const [showHelp, setShowHelp] = useState(false);
  const [isDossierOpen, setIsDossierOpen] = useState(false);
  const [isActionCardModalOpen, setIsActionCardModalOpen] = useState(false);
  const [isChatMaximized, setIsChatMaximized] = useState(false);
  const [hoveredPersuasionStakeholderId, setHoveredPersuasionStakeholderId] = useState<string | null>(null);
  const [hoveredCardRect, setHoveredCardRect] = useState<DOMRect | null>(null);

  // Conversation history: only messages that have actually been spoken (shown in a speech bubble)
  const [displayedChatMsgs, setDisplayedChatMsgs] = useState<ChatMsg[]>([]);

  // Speech Queue System
  const speechQueueRef = useRef<Array<{
    id: string;
    type: "player" | "stakeholder";
    stakeholderId?: string;
    message: string;
    chatMsg?: ChatMsg;
  }>>([]);
  const isProcessingQueueRef = useRef<boolean>(false);
  const activeSpeechTimerRef = useRef<any>(null);
  const activeFadeTimerRef = useRef<any>(null);
  const activeNextTimerRef = useRef<any>(null);
  const previousMsgsLengthRef = useRef<number>(0);

  const [activeSpeakingState, setActiveSpeakingState] = useState<{
    stakeholderId: string;
    message: string;
    isClosing?: boolean;
  } | null>(null);

  const [activePlayerSpeakingState, setActivePlayerSpeakingState] = useState<{
    message: string;
    isClosing?: boolean;
  } | null>(null);

  const processSpeechQueue = () => {
    if (isProcessingQueueRef.current) return;
    if (speechQueueRef.current.length === 0) {
      setActiveSpeakingState(null);
      setActivePlayerSpeakingState(null);
      return;
    }

    const nextItem = speechQueueRef.current.shift();
    if (!nextItem) return;

    isProcessingQueueRef.current = true;

    if (activeFadeTimerRef.current) clearTimeout(activeFadeTimerRef.current);
    if (activeSpeechTimerRef.current) clearTimeout(activeSpeechTimerRef.current);
    if (activeNextTimerRef.current) clearTimeout(activeNextTimerRef.current);

    // Sync conversation history: only add to displayed chat when bubble appears
    if (nextItem.chatMsg) {
      setDisplayedChatMsgs((prev) => [...prev, nextItem.chatMsg!]);
    }

    if (nextItem.type === "player") {
      setActiveSpeakingState(null);
      setActivePlayerSpeakingState({ message: nextItem.message, isClosing: false });
      const durationMs = Math.min(5000, Math.max(2500, Math.round(nextItem.message.length * 40)));
      const fadeOutDelay = Math.max(0, durationMs - 400);

      activeFadeTimerRef.current = setTimeout(() => {
        setActivePlayerSpeakingState((prev) => (prev ? { ...prev, isClosing: true } : null));
      }, fadeOutDelay);

      activeSpeechTimerRef.current = setTimeout(() => {
        setActivePlayerSpeakingState(null);
        isProcessingQueueRef.current = false;
        activeNextTimerRef.current = setTimeout(() => {
          processSpeechQueue();
        }, 150);
      }, durationMs);
    } else {
      setActivePlayerSpeakingState(null);
      setActiveSpeakingState({
        stakeholderId: nextItem.stakeholderId || "",
        message: nextItem.message,
        isClosing: false,
      });
      const durationMs = Math.min(12000, Math.max(5000, Math.round(nextItem.message.length * 65)));
      const fadeOutDelay = Math.max(0, durationMs - 400);

      activeFadeTimerRef.current = setTimeout(() => {
        setActiveSpeakingState((prev) => (prev ? { ...prev, isClosing: true } : null));
      }, fadeOutDelay);

      activeSpeechTimerRef.current = setTimeout(() => {
        setActiveSpeakingState(null);
        isProcessingQueueRef.current = false;
        activeNextTimerRef.current = setTimeout(() => {
          processSpeechQueue();
        }, 150);
      }, durationMs);
    }
  };

  // Skip current speech bubble and advance immediately to next
  const skipCurrentSpeech = () => {
    if (activeFadeTimerRef.current) clearTimeout(activeFadeTimerRef.current);
    if (activeSpeechTimerRef.current) clearTimeout(activeSpeechTimerRef.current);
    if (activeNextTimerRef.current) clearTimeout(activeNextTimerRef.current);
    setActiveSpeakingState(null);
    setActivePlayerSpeakingState(null);
    isProcessingQueueRef.current = false;
    processSpeechQueue();
  };

  const triggerStakeholderSpeech = (stakeholderId: string, message: string, chatMsg?: ChatMsg) => {
    if (!stakeholderId || !message) return;
    speechQueueRef.current.push({
      id: Math.random().toString(36).substring(2, 9),
      type: "stakeholder",
      stakeholderId,
      message,
      chatMsg,
    });
    processSpeechQueue();
  };

  const triggerPlayerSpeech = (message: string, chatMsg?: ChatMsg) => {
    if (!message) return;
    speechQueueRef.current.push({
      id: Math.random().toString(36).substring(2, 9),
      type: "player",
      message,
      chatMsg,
    });
    processSpeechQueue();
  };

  // Watch incoming chat_msgs prop for new messages from the parent (e.g. stakeholder responses),
  // queue them for speech, and only add to displayedChatMsgs when the bubble actually appears.
  useEffect(() => {
    if (chat_msgs && chat_msgs.length > previousMsgsLengthRef.current) {
      const newMessages = chat_msgs.slice(previousMsgsLengthRef.current);
      newMessages.forEach((msg) => {
        if (!msg.message) return;
        const isUser = !msg.id || msg.id === "user" || msg.id === "player";
        if (isUser) {
          // Player messages are already queued via handleSelectDialogue; skip duplicates
          // (they arrive in chat_msgs because the parent echoes them back)
        } else if (msg.id && msg.id !== "system") {
          triggerStakeholderSpeech(msg.id, msg.message, msg);
        } else if (msg.id === "system") {
          // System messages appear immediately without a bubble
          setDisplayedChatMsgs((prev) => [...prev, msg]);
        }
      });
    }
    previousMsgsLengthRef.current = chat_msgs?.length || 0;
  }, [chat_msgs]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      speechQueueRef.current = [];
      isProcessingQueueRef.current = false;
      if (activeSpeechTimerRef.current) clearTimeout(activeSpeechTimerRef.current);
      if (activeFadeTimerRef.current) clearTimeout(activeFadeTimerRef.current);
      if (activeNextTimerRef.current) clearTimeout(activeNextTimerRef.current);
    };
  }, []);

  const availableStakeholderList = Object.keys(stakeholders).length > 0
    ? Object.values(stakeholders)
    : [
      {
        id: "st_security",
        name: "Security Manager",
        role_description: "Ensures compliance and data security across ML pipelines.",
        stakeholder_color: "#dc3545",
        metric_id: "metric_security",
        power: "high",
        interest: "high",
      },
      {
        id: "st_data_sci",
        name: "Lead Data Scientist",
        role_description: "Focuses on model accuracy, latency, and experiment tracking.",
        stakeholder_color: "#0d6efd",
        metric_id: "metric_accuracy",
        power: "high",
        interest: "high",
      },
      {
        id: "st_product",
        name: "Product Owner",
        role_description: "Manages feature scope, timelines, and business ROI.",
        stakeholder_color: "#ffc107",
        metric_id: "metric_cost",
        power: "low",
        interest: "high",
      },
    ];

  // Helper to check if a stakeholder is active in currentPhase
  const isStakeholderActiveInPhase = (st: any): boolean => {
    if (!st) return false;
    if (metrics && Object.keys(metrics).length > 0) {
      const metricId = st.metric_id;
      if (metricId) {
        const metric = metrics[metricId] || Object.values(metrics).find((m: any) => m.id === metricId);
        const metricIntro = metrics[`${metricId}_intro`] || Object.values(metrics).find((m: any) => m.id === `${metricId}_intro`);
        if (metric || metricIntro) {
          return Boolean((metric && metric.phases[currentPhase]) || (metricIntro && metricIntro.phases[currentPhase]));
        }
      }
    }
    return true;
  };

  const activeStakeholders = availableStakeholderList.filter(isStakeholderActiveInPhase);
  const topStakeholders = activeStakeholders.length >= 3 ? activeStakeholders.slice(0, 2) : [];
  const remainingStakeholders = activeStakeholders.length >= 3 ? activeStakeholders.slice(2) : activeStakeholders;
  const leftStakeholders = remainingStakeholders.filter((_, idx) => idx % 2 === 0);
  const rightStakeholders = remainingStakeholders.filter((_, idx) => idx % 2 !== 0);

  const getStakeholderColor = (st: any): string => {
    if (st?.stakeholder_color && st.stakeholder_color !== "#888888" && st.stakeholder_color !== "#ffffff") {
      return st.stakeholder_color;
    }
    if (st?.metric_id && metrics) {
      const m = metrics[st.metric_id] || Object.values(metrics).find((metric: any) => metric.id === st.metric_id);
      if (m && m.metric_color) return m.metric_color;
    }
    return st?.stakeholder_color || "#38bdf8";
  };

  // --- PERSUASION ENGINE CALCULATION ---
  const getStakeholderThreshold = (st: any): number => {
    const power = (st.power || "low").toLowerCase();
    const interest = (st.interest || "low").toLowerCase();

    if (power === "high" && interest === "high") return 0.80;
    if (power === "high" && interest === "low") return 0.65;
    if (power === "low" && interest === "high") return 0.50;
    return 0.35; // low power, low interest
  };

  const getIntelTypeScore = (type: string): number => {
    const normalized = (type || "").toLowerCase();
    if (normalized.includes("requirement")) return 0.25;
    if (normalized.includes("negotiable_preference")) return 0.20;
    if (normalized.includes("personal_friction")) return 0.10;
    return 0.20;
  };

  const getEmotionScore = (emotion?: string): number => {
    const em = (emotion || "").toLowerCase();
    if (em.includes("enthusiastic")) return 0.40;
    if (em.includes("happy") || em.includes("confident") || em.includes("satisfied")) return 0.30;
    if (em.includes("content") || em.includes("neutral") || em.includes("curious") || em.includes("relieved")) return 0.20;
    if (em.includes("skeptical") || em.includes("confused") || em.includes("worried") || em.includes("hesitant")) return 0.10;
    if (em.includes("angry") || em.includes("frustrated") || em.includes("resistant")) return 0.00;
    return 0.20;
  };

  const calculatePersuasionBreakdown = (st: any) => {
    const threshold = getStakeholderThreshold(st);

    // 1. Action Card Intel Contribution
    const cardIntelIds = pitchedActionCard?.intel_ids || [];
    const matchingActionCardIntels = (intelItems || []).filter(
      (item) => cardIntelIds.includes(item.id) && (item.stakeholder_id === st.id || (item.stakeholder_name && item.stakeholder_name === st.name))
    );
    const actionCardScore = matchingActionCardIntels.reduce((sum, item) => {
      const type = item.categorized_type || item.intel_type || "requirement";
      return sum + getIntelTypeScore(type);
    }, 0);

    // 2. Dialogue Questions Contribution
    const dialogueIntelsTargeted = (chat_msgs || []).flatMap((msg) => msg.revealed_intel || []);
    const matchingDialogueIntels = dialogueIntelsTargeted.filter(
      (item: any) => item.stakeholder_id === st.id || item.stakeholder_name === st.name
    );
    // Also reward intel-based dialogue questions asked targeting this stakeholder
    const dialogueIntelScore = matchingDialogueIntels.reduce((sum: number, item: any) => {
      const type = item.categorized_type || item.intel_type || "requirement";
      return sum + getIntelTypeScore(type);
    }, 0);

    // Baseline dialogue familiarity if dialogue engaged with this stakeholder
    const hasDialogue = (chat_msgs || []).some((m) => m.id === st.id);
    const dialogueScore = Math.min(0.35, dialogueIntelScore + (hasDialogue ? 0.05 : 0.0));

    // 3. Emotional State Contribution
    const currentEmotion = st.emotion || st.facial_expression || "neutral";
    const emotionScore = getEmotionScore(currentEmotion);

    const totalRaw = actionCardScore + dialogueScore + emotionScore;
    const total = Math.min(1.0, Math.max(0.0, totalRaw));

    return {
      threshold,
      actionCardScore: Math.min(1.0, actionCardScore),
      dialogueScore: Math.min(1.0, dialogueScore),
      emotionScore: Math.min(1.0, emotionScore),
      total,
      isPersuaded: total >= threshold,
      matchingActionCardIntels,
      matchingDialogueIntels,
      currentEmotion,
    };
  };

  const allActiveStakeholdersPersuaded = activeStakeholders.every((st) => {
    const { isPersuaded } = calculatePersuasionBreakdown(st);
    return isPersuaded;
  });

  const handleEndPitchClick = () => {
    if (onEndPitch) {
      onEndPitch(allActiveStakeholdersPersuaded);
    }
  };

  const handleSelectDialogue = (index: number) => {
    if (!isChatEnabled) return;
    const option = dialogueOptions[index];
    if (option) {
      // Add to history only when the speech bubble appears
      triggerPlayerSpeech(option.text, {
        id: "user",
        message: option.text,
        ac_id: -1,
      });
    }
    onSelectDialogueOption(index);
  };

  const renderSeatedStakeholder = (st: any) => {
    const isSelected = selectedStakeholderId === st.id;
    const isSpeaking = activeSpeakingState?.stakeholderId === st.id;
    const stakeholderColor = getStakeholderColor(st);
    const av = st.avatar || {};

    return (
      <>
        <div
          className={`${styles.seatedStakeholder} ${isSelected ? styles.seatedSelected : ""} ${isSpeaking ? styles.seatedSpeaking : ""}`}
          style={{
            // @ts-ignore
            "--st-color": stakeholderColor,
          }}
          onClick={() => setSelectedStakeholderId(st.id)}
        >
          {/* Active Speech Bubble above speaking stakeholder */}
          {isSpeaking && activeSpeakingState && (
            <div
              className={`${styles.tableSpeechBubble} ${activeSpeakingState.isClosing ? styles.tableSpeechBubbleClosing : ""
                }`}
              style={{
                borderColor: stakeholderColor,
                pointerEvents: "auto",
                cursor: "pointer",
              }}
              onClick={(e) => { e.stopPropagation(); skipCurrentSpeech(); }}
            >
              {activeSpeakingState.message}
              <button
                type="button"
                className={styles.speechSkipBtn}
                onClick={(e) => { e.stopPropagation(); skipCurrentSpeech(); }}
                title="Skip to next message"
              >
                <Icon icon="ph:skip-forward-fill" style={{ fontSize: "0.9rem" }} />
              </button>
            </div>
          )}

          {/* Avatar Viewport */}
          <div className={styles.seatedAvatarViewport}>
            <StakeholderAvatarComponent
              avatar={av}
              play_blink_animation={true}
              isFramed={false}
              isSpeaking={isSpeaking}
              size={108}
              stakeholderColor={stakeholderColor}
              title={st.name}
            />
          </div>

          {/* Conference Desk Nameplate */}
          <div
            className={styles.deskNameplate}
            style={{
              color: stakeholderColor,
              borderColor: stakeholderColor,
            }}
          >
            {st.name}
          </div>
        </div></>
    );
  };

  const bgIndex = (currentChallenge + currentPhase) % 4;

  const pitchedTitle = pitchedActionCard?.title || "Base Action Card Proposal";
  const pitchedDescription = pitchedActionCard?.description || "Multi-stakeholder aligned strategic intervention";
  const pitchedIntelsCount = pitchedActionCard?.intel_ids?.length || 0;

  // Resolve stakeholders whose intel items formed this action card
  const cardIntelIds = pitchedActionCard?.intel_ids || [];
  const matchedIntels = intelItems.filter((i) =>
    cardIntelIds.includes(i.id) || (i.requirement_id && cardIntelIds.includes(i.requirement_id))
  );


  return (
    <div className={styles.container}>
      {/* Main Content Canvas with Dynamic Background */}
      <div
        className="container-fluid flex-grow-1 d-flex flex-column p-3 position-relative overflow-auto"
        style={{
          backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_${bgIndex}.png")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {/* Floating Top Right Help / Dashboard Toggle Button */}
        <button
          type="button"
          className={styles.circularHelpBtn}
          onClick={() => setShowHelp(!showHelp)}
          title={showHelp ? "Show Original View" : "Show Dashboard & Overview"}
        >
          <Icon
            icon={showHelp ? "material-symbols:dashboard-rounded" : "ph:presentation-chart-bold"}
            style={{
              fontSize: "2.3rem",
              color: "var(--engagement-text)",
            }}
          />
        </button>

        {/* Layer 1: Default Pitch Debate Page (Board & Persuasion Grid) */}
        <div
          className={`flex-grow-1 d-flex flex-column w-100 ${styles.helpBaseLayer} ${showHelp ? styles.helpBaseLayerDimmed : styles.helpBaseLayerActive
            }`}
        >
          {/* 2-Column Grid: Left = Challenge + Pitch Deck + Chat + Dialogue Options, Right = Persuasion Bars + Addendums */}
          <div className="row g-3 align-items-stretch flex-grow-1 h-100">
            {/* LEFT COLUMN: Challenge -> Pitch Deck -> Conversation History -> Dialogue Options */}
            <div className="col-12 col-lg-7 d-flex flex-column h-100">
              <div className="transparent-div p-3 h-100 d-flex flex-column gap-2 rounded" style={{ overflow: "visible" }}>
                <span className="transparent-div-label">
                  🗣️ Pitch Debate
                </span>

                {/* 1+2. Collapsible: Challenge + Pitch Deck (animates away when chat is maximized) */}
                <div
                  className={`flex-shrink-0 d-flex flex-column gap-2 ${styles.collapsibleSection} ${isChatMaximized ? styles.collapsibleSectionHidden : styles.collapsibleSectionVisible
                    }`}
                >
                  {/* 1. Above: Challenge Description Card */}
                  <div>
                    <ChallengeDescriptionCard
                      challengeTitle={challengeTitle}
                      challengeDescription={challengeDescription}
                      challengeIntro={challengeIntro}
                      currentChallenge={currentChallenge}
                      challengeAmount={challengeNumber}
                    />
                  </div>

                  {/* 2. Middle: Pitch Deck Boardroom Scene */}
                  <div className="position-relative p-1 rounded" style={{ paddingBottom: "40px" }}>
                    <div className={styles.tableScene}>
                      <div className={styles.pitchDeckTable}>
                        {/* Top Row Seating */}
                        {topStakeholders.length > 0 && (
                          <div className={styles.tableTopSeating}>
                            {topStakeholders.map(renderSeatedStakeholder)}
                          </div>
                        )}

                        {/* Middle Section: Lateral Seats & Pitched Base Action Card */}
                        <div className={styles.tableCenterSurface}>
                          {/* Left Seat */}
                          <div className={styles.tableSideSeating}>
                            {leftStakeholders.map(renderSeatedStakeholder)}
                          </div>

                          {/* Center Tabletop with Pitched Action Card */}
                          <div className={styles.tabletopCenterArea}>
                            <div
                              className={styles.actionCardSurface}
                              onClick={() => setIsActionCardModalOpen(true)}
                              title="Click to view full 7:5 Action Card proposal"
                            >
                              <div className={styles.actionCardInnerFrame}>
                                {/* Header matching ActionCardCardComponent */}
                                <div className={styles.actionCardHeader}>
                                  <span className={styles.actionCardCategoryLabel}>Action Card</span>
                                  <h6
                                    className={styles.actionCardTitle}
                                    title={pitchedTitle}
                                  >
                                    {pitchedTitle}
                                  </h6>
                                </div>

                                {/* Description Box */}
                                <div className={styles.actionCardDescriptionBox}>
                                  <p className={styles.actionCardDescriptionPreview} title={pitchedDescription}>
                                    {pitchedDescription}
                                  </p>
                                </div>


                              </div>
                            </div>
                          </div>

                          {/* Right Seat */}
                          <div className={styles.tableSideSeating}>
                            {rightStakeholders.map(renderSeatedStakeholder)}
                          </div>
                        </div>

                        {/* Table Edge Plaque */}
                        <div className={styles.tableEdgePlaque}>
                          <Icon icon="ph:scales-bold" style={{ fontSize: "0.85rem", color: "#ffc107" }} />
                          <span>PITCH DECK</span>
                        </div>

                        {/* Player Speech Bubble */}
                        {activePlayerSpeakingState && (
                          <div
                            className={`${styles.playerTableSpeechBubble} ${activePlayerSpeakingState.isClosing ? styles.playerTableSpeechBubbleClosing : ""
                              }`}
                            style={{ pointerEvents: "auto", cursor: "pointer" }}
                            onClick={(e) => { e.stopPropagation(); skipCurrentSpeech(); }}
                          >
                            <div className={styles.playerSpeechHeader}>
                              <Icon icon="ph:user-circle-bold" style={{ fontSize: "1rem" }} />
                              <span>Player</span>
                              <button
                                type="button"
                                className={styles.speechSkipBtn}
                                onClick={(e) => { e.stopPropagation(); skipCurrentSpeech(); }}
                                title="Skip to next message"
                              >
                                <Icon icon="ph:skip-forward-fill" style={{ fontSize: "0.9rem" }} />
                              </button>
                            </div>
                            <div className={styles.playerSpeechContent}>
                              {activePlayerSpeakingState.message}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Below: Chat History — always flex-grow-1; maximize button anchored inside */}
                <div
                  className={`flex-grow-1 ${styles.chatWrapper}`}
                  style={{ minHeight: "120px" }}
                >
                  <StakeholderInteractionArea
                    className="w-100 h-100"
                    chatMsgs={displayedChatMsgs}
                    current_phase={currentPhase}
                    current_challenge={currentChallenge}
                    isEnabled={isChatEnabled}
                    actionCards={[]}
                    onHoverCard={() => { }}
                    showStakeholderList={false}
                    showDialogueOptions={false}
                  />
                  {/* Maximize / Minimize button — always bottom-right of this wrapper */}
                  <button
                    type="button"
                    className={styles.chatMaximizeBtn}
                    onClick={() => setIsChatMaximized(!isChatMaximized)}
                    title={isChatMaximized ? "Restore view" : "Maximize conversation history"}
                  >
                    <Icon
                      icon={isChatMaximized ? "ph:arrows-in-simple-bold" : "ph:arrows-out-simple-bold"}
                      style={{ fontSize: "1.25rem" }}
                    />
                  </button>
                </div>

                {/* 4. Dialogue Options Area */}
                <div className="flex-shrink-0" style={{ position: "relative", zIndex: 2 }}>
                  <div className="d-flex justify-content-between align-items-center mb-2 px-1">
                    <div className="d-flex align-items-center gap-2">
                      <Icon icon="ph:chats-circle-bold" className="text-warning" style={{ fontSize: "1.1rem" }} />
                      <span className="transparent-div-label mb-0" style={{ fontSize: "0.75rem", color: "#ffffff" }}>
                        Dialogue Options
                      </span>
                    </div>
                    {!isChatEnabled && (
                      <span className="badge bg-warning text-dark d-flex align-items-center gap-1">
                        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                        Stakeholders Deliberating...
                      </span>
                    )}
                  </div>

                  <div className="row g-2">
                    {dialogueOptions && dialogueOptions.length > 0 ? (
                      dialogueOptions.map((opt, idx) => {
                        const isIntel = Boolean(opt.intel_item_id || opt.intel_type);
                        const archetype = opt.archetype?.name;

                        return (
                          <div key={idx} className="col-12 col-md-6">
                            <button
                              type="button"
                              className="btn w-100 text-start p-2 d-flex flex-column justify-content-between transparent-div"
                              style={{
                                minHeight: "76px",
                                color: "#f1f5f9",
                                border: "1px solid rgba(255,255,255,0.2)",
                                opacity: isChatEnabled ? 1 : 0.55,
                                cursor: isChatEnabled ? "pointer" : "not-allowed",
                                transition: "background 0.18s ease, border-color 0.18s ease, transform 0.15s ease",
                              }}
                              onMouseEnter={e => { if (isChatEnabled) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.18)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.45)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; } }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ""; (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.2)"; (e.currentTarget as HTMLElement).style.transform = ""; }}
                              disabled={!isChatEnabled}
                              onClick={() => handleSelectDialogue(idx)}
                            >
                              <div className="d-flex justify-content-between align-items-center mb-1 w-100">
                                {isIntel ? (
                                  <span className="badge bg-primary" style={{ fontSize: "0.68rem" }}>
                                    🧠 Intel: {opt.intel_stakeholder_name || opt.intel_type?.replace(/_/g, " ") || "Intelligence"}
                                  </span>
                                ) : archetype ? (
                                  <span className="badge bg-secondary" style={{ fontSize: "0.68rem" }}>
                                    💡 {archetype}
                                  </span>
                                ) : (
                                  <span className="badge" style={{ fontSize: "0.68rem", background: "rgba(100,116,139,0.4)", color: "#cbd5e1" }}>
                                    💬 Inquiry
                                  </span>
                                )}
                                <span className="badge" style={{ fontSize: "0.62rem", background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.45)" }}>#{idx + 1}</span>
                              </div>
                              <div style={{ fontSize: "0.8rem", lineHeight: "1.35", color: "#e2e8f0", fontWeight: 500 }}>
                                {opt.text}
                              </div>
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <div className="col-12 text-center py-3 text-white-50">
                        <span className="small">Waiting for stakeholder opening statements...</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Persuasion Bars + Addendums Placeholder + End Pitch Button */}
            <div className="col-12 col-lg-5 d-flex flex-column h-100">
              <div className="transparent-div p-3 h-100 d-flex flex-column rounded">
                {/* Header Label */}
                <span className="transparent-div-label mb-2">
                  ⚖️ Stakeholder Buy-In
                </span>

                {/* Status Banner */}
                {allActiveStakeholdersPersuaded && (
                  <div className="d-flex justify-content-end align-items-center mb-2 px-1">
                    <span
                      className="badge bg-success fw-bold"
                      style={{ fontSize: "0.72rem" }}
                    >
                      ✅ All Persuaded (Pass)
                    </span>
                  </div>
                )}

                {/* Scrollable Stakeholder Persuasion Cards */}
                <div className="flex-grow-1 overflow-auto pe-1 mb-2" style={{ minHeight: 0, maxHeight: "390px" }}>
                  {activeStakeholders.map((st) => {
                    const stColor = getStakeholderColor(st);
                    const breakdown = calculatePersuasionBreakdown(st);

                    const formatCap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "Low";
                    const powerText = formatCap((st as any).power || "low");
                    const interestText = formatCap((st as any).interest || "low");

                    return (
                      <div
                        key={st.id}
                        className="card border-secondary shadow-sm mb-2 text-dark bg-white"
                        onMouseEnter={(e) => {
                          setHoveredPersuasionStakeholderId(st.id);
                          setHoveredCardRect(e.currentTarget.getBoundingClientRect());
                        }}
                        onMouseLeave={() => {
                          setHoveredPersuasionStakeholderId(null);
                          setHoveredCardRect(null);
                        }}
                      >
                        {/* Card Header */}
                        <div className="card-header bg-light d-flex justify-content-between align-items-center py-2 px-3 border-bottom">
                          <div className="d-flex align-items-center gap-2">
                            <span
                              className="d-inline-block rounded-circle"
                              style={{ width: "10px", height: "10px", backgroundColor: stColor }}
                            />
                            <strong className="text-dark" style={{ fontSize: "0.85rem" }}>{st.name}</strong>
                            <span className="badge bg-secondary" style={{ fontSize: "0.65rem" }}>
                              {powerText} Power • {interestText} Interest
                            </span>
                          </div>
                          <span
                            className={`badge ${breakdown.isPersuaded ? "bg-success" : "bg-danger"}`}
                            style={{ fontSize: "0.7rem" }}
                          >
                            {breakdown.isPersuaded ? "✅ Persuaded" : "⚠️ Resistant"} ({Math.round(breakdown.total * 100)}%)
                          </span>
                        </div>

                        {/* Card Body */}
                        <div className="card-body p-2">
                          {/* Bootswatch Progress Bar with Stacked Color Segments */}
                          <div className="progress position-relative" style={{ height: "20px", backgroundColor: "#e9ecef" }}>
                            {/* Threshold Marker Notch */}
                            <div
                              style={{
                                position: "absolute",
                                left: `${Math.min(99, Math.max(1, breakdown.threshold * 100))}%`,
                                top: "-3px",
                                bottom: "-3px",
                                width: "3px",
                                backgroundColor: "#dc3545",
                                zIndex: 5,
                                borderRadius: "1px",
                              }}
                              title={`Threshold required: ${Math.round(breakdown.threshold * 100)}%`}
                            />

                            {breakdown.actionCardScore > 0 && (
                              <div
                                className="progress-bar bg-primary"
                                role="progressbar"
                                style={{ width: `${Math.min(100, breakdown.actionCardScore * 100)}%` }}
                                title={`Action Card Intel: +${Math.round(breakdown.actionCardScore * 100)}%`}
                              >
                                {breakdown.actionCardScore >= 0.15 && `+${Math.round(breakdown.actionCardScore * 100)}%`}
                              </div>
                            )}
                            {breakdown.dialogueScore > 0 && (
                              <div
                                className="progress-bar bg-info text-dark"
                                role="progressbar"
                                style={{ width: `${Math.min(100, breakdown.dialogueScore * 100)}%` }}
                                title={`Dialogue Engagement: +${Math.round(breakdown.dialogueScore * 100)}%`}
                              >
                                {breakdown.dialogueScore >= 0.15 && `+${Math.round(breakdown.dialogueScore * 100)}%`}
                              </div>
                            )}
                            {breakdown.emotionScore > 0 && (
                              <div
                                className="progress-bar bg-success"
                                role="progressbar"
                                style={{ width: `${Math.min(100, breakdown.emotionScore * 100)}%` }}
                                title={`Emotional State (${breakdown.currentEmotion}): +${Math.round(
                                  breakdown.emotionScore * 100
                                )}%`}
                              >
                                {breakdown.emotionScore >= 0.15 && `+${Math.round(breakdown.emotionScore * 100)}%`}
                              </div>
                            )}
                          </div>

                          {/* Origin Breakdown Summary Footer */}
                          <div className="d-flex justify-content-between align-items-center mt-1 px-1 text-muted small" style={{ fontSize: "0.7rem" }}>
                            <span>Target: <b>{Math.round(breakdown.threshold * 100)}%</b></span>
                            <span>Action Card: <b>+{Math.round(breakdown.actionCardScore * 100)}%</b></span>
                            <span>Dialogue: <b>+{Math.round(breakdown.dialogueScore * 100)}%</b></span>
                            <span>Emotion ({breakdown.currentEmotion}): <b>+{Math.round(breakdown.emotionScore * 100)}%</b></span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Portal Floating Popover for Hovered Stakeholder (Never clipped by container bounds) */}
                {hoveredPersuasionStakeholderId && hoveredCardRect && createPortal(
                  (() => {
                    const st = activeStakeholders.find((s) => s.id === hoveredPersuasionStakeholderId);
                    if (!st) return null;
                    const breakdown = calculatePersuasionBreakdown(st);

                    const tooltipWidth = 340;
                    const padding = 12;
                    let left = hoveredCardRect.left - tooltipWidth - padding;
                    if (left < 10) {
                      left = Math.max(10, hoveredCardRect.left);
                    }
                    const top = Math.max(10, Math.min(window.innerHeight - 340, hoveredCardRect.top - 10));

                    return (
                      <div
                        className="card border-primary shadow-lg"
                        style={{
                          position: "fixed",
                          top: `${top}px`,
                          left: `${left}px`,
                          zIndex: 99999,
                          width: `${tooltipWidth}px`,
                          backgroundColor: "#ffffff",
                          color: "#212529",
                          pointerEvents: "none",
                        }}
                      >
                        <div className="card-header bg-primary text-white py-1 px-3 d-flex justify-content-between align-items-center">
                          <strong style={{ fontSize: "0.82rem" }}>{st.name} Buy-In Breakdown</strong>
                          <span className="badge bg-light text-dark">
                            Target: {Math.round(breakdown.threshold * 100)}%
                          </span>
                        </div>
                        <div className="card-body p-2" style={{ fontSize: "0.78rem" }}>
                          <div className="d-flex justify-content-between mb-1">
                            <span className="text-primary fw-bold">🃏 Base Action Card Intel:</span>
                            <strong>+{Math.round(breakdown.actionCardScore * 100)}%</strong>
                          </div>
                          {breakdown.matchingActionCardIntels.length > 0 && (
                            <div className="ps-2 mb-1 text-muted small">
                              {breakdown.matchingActionCardIntels.map((item: any, i: number) => (
                                <div key={i}>• {item.description}</div>
                              ))}
                            </div>
                          )}
                          <div className="d-flex justify-content-between mb-1">
                            <span className="text-info fw-bold">💬 Dialogue Engagement:</span>
                            <strong>+{Math.round(breakdown.dialogueScore * 100)}%</strong>
                          </div>
                          <div className="d-flex justify-content-between mb-1">
                            <span className="text-success fw-bold">🎭 Emotional State ({breakdown.currentEmotion}):</span>
                            <strong>+{Math.round(breakdown.emotionScore * 100)}%</strong>
                          </div>
                          <hr className="my-1" />
                          <div className="d-flex justify-content-between fw-bold">
                            <span>Total Buy-In:</span>
                            <span className={breakdown.isPersuaded ? "text-success" : "text-danger"}>
                              {Math.round(breakdown.total * 100)}% / {Math.round(breakdown.threshold * 100)}% (
                              {breakdown.isPersuaded ? "Pass" : "Resistant"})
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })(),
                  document.body
                )}

                {/* Action Card Addendums Placeholder Card */}
                <div className="card border-secondary shadow-sm mb-3 bg-white text-dark">
                  <div className="card-header bg-light py-2 px-3 d-flex justify-content-between align-items-center border-bottom">
                    <div className="d-flex align-items-center gap-2">
                      <Icon icon="ph:puzzle-piece-bold" className="text-primary" style={{ fontSize: "1.1rem" }} />
                      <strong style={{ fontSize: "0.85rem" }}>Action Card Addendums (PLACEHOLDER)</strong>
                    </div>
                    <span className="badge bg-secondary">Slots Available</span>
                  </div>
                  <div className="card-body p-2">
                    <div className="row g-2">
                      <div className="col-6">
                        <div className="p-2 border border-2 border-dashed rounded text-center bg-light text-muted small" style={{ fontSize: "0.75rem" }}>
                          <Icon icon="ph:plus-circle-bold" className="me-1 text-primary" /> Addendum Slot 1
                        </div>
                      </div>
                      <div className="col-6">
                        <div className="p-2 border border-2 border-dashed rounded text-center bg-light text-muted small" style={{ fontSize: "0.75rem" }}>
                          <Icon icon="ph:plus-circle-bold" className="me-1 text-primary" /> Addendum Slot 2
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom Control Row: End Pitch + Dossier Toggle Button */}
                <div className="d-flex gap-2 mt-auto pt-1">
                  <button
                    type="button"
                    className="btn btn-success flex-grow-1 fw-bold d-flex align-items-center justify-content-center gap-2 py-2"
                    onClick={handleEndPitchClick}
                    title="Conclude Pitch Debate and run System Simulation"
                  >
                    <Icon icon="ph:check-circle-bold" style={{ fontSize: "1.2rem" }} />
                    End Pitch & Proceed to Simulation
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsDossierOpen(true)}
                    style={{
                      background: "linear-gradient(135deg, #4a382c, #2b1e16)",
                      color: "#f3e9dc",
                      border: "2px solid #8c6d58",
                      borderRadius: "30px",
                      padding: "8px 18px",
                      fontFamily: "'Indie Flower', cursive, sans-serif",
                      fontWeight: "bold",
                      fontSize: "1.15rem",
                      cursor: "pointer",
                      boxShadow: "0 4px 14px rgba(0,0,0,0.4)",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      transition: "all 0.2s ease",
                      whiteSpace: "nowrap",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.transform = "scale(1.05) translateY(-2px)")}
                    onMouseOut={(e) => (e.currentTarget.style.transform = "scale(1)")}
                    title="Open Stakeholder Dossier"
                  >
                    📓 Stakeholder Dossier
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Layer 2: Dashboard / Help Overview Layer */}
        <PerformanceDashboard
          isOpen={showHelp}
          currentPhase={currentPhase}
          currentChallenge={currentChallenge}
          showMetricValueChanges={showMetricValueChanges}
          last_ac={last_ac}
          challengeTitle={challengeTitle}
          challengeDescription={challengeDescription}
          challengeIntro={challengeIntro}
          challengeAmount={challengeNumber}
        />
      </div>

      {/* Stakeholder Dossier Modal (Closed by default) */}
      <StakeholderDossier
        isOpen={isDossierOpen}
        onClose={() => setIsDossierOpen(false)}
        dossierData={dossierData || []}
        activeStakeholderId={selectedStakeholderId}
        currentPhase={currentPhase}
        currentChallenge={currentChallenge}
      />

      {/* Full 7:5 Action Card Detail Modal */}
      <ActionCardDetailModal
        isOpen={isActionCardModalOpen}
        onClose={() => setIsActionCardModalOpen(false)}
        actionCard={
          pitchedActionCard || {
            id: "pitched_ac_fallback",
            title: pitchedTitle,
            description: pitchedDescription,
            intel_ids: cardIntelIds,
          }
        }
        intelItems={intelItems}
        stakeholders={stakeholders}
        getStakeholderColor={getStakeholderColor}
      />
    </div>
  );
}
