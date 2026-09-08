import { useState, useContext, useEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import type { ActionCard } from "../types/ActionCard";
import type { DialogueOption, DialogueOptionArchetype } from "../types/DialogueOption";
import { StakeholderContext } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import styles from "./pitch_debate.module.css";
import StakeholderDossier, { type StakeholderDossierEntry, type StakeholderBuyInInfo } from "./StakeholderDossier";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import StakeholderInteractionArea, { type ChatMsg } from "./StakeholderInteractionArea";
import PerformanceDashboard from "./PerformanceDashboard";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import ChallengeDescriptionCard from "./ChallengeDescriptionCard";
import ActionCardDetailModal from "./ActionCardDetailModal";
import ActionCardCardComponent, { type ActionCardAddendum } from "./ActionCardCardComponent";

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
  onSelectDialogueOption?: (optionId: string, addressedStakeholderId?: string, option?: DialogueOption) => void;
  pitchedActionCard?: ActionCard | null;
  dossierData?: StakeholderDossierEntry[];
  intelItems?: IntelItem[];
  onEndPitch?: (passed: boolean) => void;
  isExistingSave?: boolean;
  onClearExistingSave?: () => void;
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
  onSelectDialogueOption,
  pitchedActionCard,
  dossierData = [],
  intelItems = [],
  onEndPitch,
  last_ac,
  isExistingSave = false,
  onClearExistingSave,
}: PitchDebateProps) {
  const stakeholderCtx = useContext(StakeholderContext);
  const stakeholders = stakeholderCtx?.stakeholders || {};
  const metricsCtx = useContext(MetricsContext);
  const metrics = metricsCtx?.metrics || {};

  // Selected Stakeholder & UI States
  const [selectedStakeholderId, setSelectedStakeholderId] = useState<string>("requirements_reuben");
  const [showHelp, setShowHelp] = useState(false);
  const [isActionCardModalOpen, setIsActionCardModalOpen] = useState(false);
  const [isChatMaximized, setIsChatMaximized] = useState(false);

  // Target stakeholder selection map for corporate noise dialogue options
  const [selectedNoiseTargetMap, setSelectedNoiseTargetMap] = useState<Record<string, string>>({});
  const [openDropdownOptionId, setOpenDropdownOptionId] = useState<string | null>(null);
  const [highlightedIntelId, setHighlightedIntelId] = useState<string | null>(null);

  // Close floating dropdown when clicking anywhere outside
  useEffect(() => {
    const handleOutsideClick = () => {
      setOpenDropdownOptionId(null);
    };
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  // Conversation history: only messages that have actually been spoken (shown in a speech bubble),
  // or existing messages when loading a saved game.
  const [displayedChatMsgs, setDisplayedChatMsgs] = useState<ChatMsg[]>(() => {
    if (isExistingSave && chat_msgs && chat_msgs.length > 0) {
      return chat_msgs;
    }
    return [];
  });

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
  const previousMsgsLengthRef = useRef<number>(
    isExistingSave && chat_msgs ? chat_msgs.length : 0
  );
  const isExistingSaveRef = useRef<boolean>(isExistingSave || false);

  useEffect(() => {
    if (isExistingSave) {
      isExistingSaveRef.current = true;
    }
  }, [isExistingSave]);

  const [activeSpeakingState, setActiveSpeakingState] = useState<{
    stakeholderId: string;
    message: string;
    isClosing?: boolean;
  } | null>(null);

  const [activePlayerSpeakingState, setActivePlayerSpeakingState] = useState<{
    message: string;
    isClosing?: boolean;
  } | null>(null);

  const isAnySpeechActive = Boolean(activeSpeakingState || activePlayerSpeakingState);
  const isSpeechBubbleCoveringButton = Boolean(activePlayerSpeakingState);

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

  // Watch incoming chat_msgs prop for new messages from the parent
  useEffect(() => {
    if (!chat_msgs || chat_msgs.length === 0) {
      setDisplayedChatMsgs([]);
      previousMsgsLengthRef.current = 0;
      return;
    }

    if (isExistingSaveRef.current) {
      // Restore all existing messages to displayed chat immediately without speech bubbles
      setDisplayedChatMsgs(chat_msgs);
      previousMsgsLengthRef.current = chat_msgs.length;
      isExistingSaveRef.current = false;
      if (onClearExistingSave) {
        onClearExistingSave();
      }
      return;
    }

    if (chat_msgs.length > previousMsgsLengthRef.current) {
      const newMessages = chat_msgs.slice(previousMsgsLengthRef.current);
      newMessages.forEach((msg) => {
        if (!msg.message) return;
        const isUser = !msg.id || msg.id === "user" || msg.id === "player";
        if (isUser) {
          triggerPlayerSpeech(msg.message, msg);
        } else if (msg.id && msg.id !== "system") {
          triggerStakeholderSpeech(msg.id, msg.message, msg);
        } else if (msg.id === "system") {
          setDisplayedChatMsgs((prev) => [...prev, msg]);
        }
      });
    }
    previousMsgsLengthRef.current = chat_msgs.length;
  }, [chat_msgs, isExistingSave, onClearExistingSave]);

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
    const wrongCardIntelIds = (pitchedActionCard as any)?.wrong_intel_ids || [];
    const matchingActionCardIntels = (intelItems || []).filter(
      (item) =>
        cardIntelIds.includes(item.id) &&
        !wrongCardIntelIds.includes(item.id) &&
        (!item.requirement_id || !wrongCardIntelIds.includes(item.requirement_id)) &&
        ((item as any).is_correct !== false) &&
        (item.stakeholder_id === st.id || (item.stakeholder_name && item.stakeholder_name === st.name))
    );
    const actionCardScore = matchingActionCardIntels.reduce((sum, item) => {
      const type = item.categorized_type || item.intel_type || "requirement";
      return sum + getIntelTypeScore(type);
    }, 0);

    // 2. Dialogue Questions Contribution
    const dialogueIntelsTargeted = (chat_msgs || []).flatMap((msg) => msg.revealed_intel || []);
    const matchingDialogueIntels = dialogueIntelsTargeted.filter(
      (item: any) =>
        (item.stakeholder_id === st.id || item.stakeholder_name === st.name) &&
        !item.is_corrected
    );
    const dialogueIntelScore = matchingDialogueIntels.reduce((sum: number, item: any) => {
      const type = item.categorized_type || item.intel_type || "requirement";
      return sum + getIntelTypeScore(type);
    }, 0);

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

  const persuadedCount = activeStakeholders.filter((st) => {
    const { isPersuaded } = calculatePersuasionBreakdown(st);
    return isPersuaded;
  }).length;

  const handleEndPitchClick = () => {
    if (onEndPitch) {
      onEndPitch(allActiveStakeholdersPersuaded);
    }
  };

  const getSelectedTargetForOption = (optId: string): string => {
    if (selectedNoiseTargetMap[optId]) return selectedNoiseTargetMap[optId];
    if (selectedStakeholderId && activeStakeholders.some((s) => s.id === selectedStakeholderId)) {
      return selectedStakeholderId;
    }
    return activeStakeholders[0]?.id || "st_security";
  };

  const handleSelectNoiseTarget = (optId: string, stakeholderId: string) => {
    setSelectedNoiseTargetMap((prev) => ({
      ...prev,
      [optId]: stakeholderId,
    }));
  };

  const inspectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInspectIntel = (opt: DialogueOption) => {
    const targetId =
      opt.intel_stakeholder_id ||
      activeStakeholders.find((s) => s.name === opt.intel_stakeholder_name)?.id;
    if (targetId) {
      setSelectedStakeholderId(targetId);
    }
    const intelId = opt.intel_item_id || "";
    if (inspectTimerRef.current) {
      clearTimeout(inspectTimerRef.current);
    }
    // Briefly reset to ensure React effect fires even if the same intel item is clicked again
    setHighlightedIntelId(null);
    setTimeout(() => {
      setHighlightedIntelId(intelId);
      inspectTimerRef.current = setTimeout(() => {
        setHighlightedIntelId((curr) => (curr === intelId ? null : curr));
      }, 5000);
    }, 10);
  };

  const getArchetypeInfo = (optArchetype?: DialogueOptionArchetype | null) => {
    if (!optArchetype?.name) return null;
    const fromCtx = stakeholderCtx?.convincerArchetypes?.[optArchetype.name];
    return {
      name: optArchetype.name,
      icon: optArchetype.icon || fromCtx?.icon || "",
      color: optArchetype.color || fromCtx?.color || "",
    };
  };

  const handleSelectDialogue = (option: DialogueOption, e?: React.MouseEvent) => {
    if (!isChatEnabled) return;
    if (e) {
      const target = e.target as HTMLElement | null;
      if (
        target?.closest(`.${styles.dialogueBadgeIntelClickable}`) ||
        target?.closest(`.${styles.intelLinkButton}`) ||
        target?.closest(`.${styles.intelLinkWrapper}`) ||
        target?.closest(`.${styles.dropdownWrapper}`) ||
        target?.closest(`.${styles.dropdownToggleBtn}`) ||
        target?.closest(`.${styles.dropdownMenuFloating}`)
      ) {
        return;
      }
    }
    const targetStId = option.type === "intel"
      ? (option.intel_stakeholder_id || undefined)
      : getSelectedTargetForOption(option.id);

    if (onSelectDialogueOption) {
      onSelectDialogueOption(option.id, targetStId, option);
    }
  };

  // Grounded Addendums Placeholders from GDD.txt
  const placeholderAddendums: ActionCardAddendum[] = [
    {
      id: "addendum_1",
      title: "Automated Drift Alerting & Fallback SLA",
      stakeholder_name: "Security Manager",
      stakeholder_id: "st_security",
      status: "attached",
      objection_resolved: "Compliance & Pipeline Safety",
      description: "Execute base pipeline deployment, but enforce automated daily schema validation and instant rollback triggers to prevent unverified model shifts.",
    },
    {
      id: "addendum_2",
      title: "Sub-45ms Inferencing Latency Guarantee",
      stakeholder_name: "Lead Data Scientist",
      stakeholder_id: "st_data_sci",
      status: "attached",
      objection_resolved: "Live Latency Degradation",
      description: "Allocate local cache partitions and GPU batching to guarantee <45ms response times under peak customer traffic.",
    },
  ];

  const attachedAddendums = placeholderAddendums.filter((a) => a.status === "attached");

  const buyInInfoMap: Record<string, StakeholderBuyInInfo> = {};
  activeStakeholders.forEach((st) => {
    const breakdown = calculatePersuasionBreakdown(st);
    buyInInfoMap[st.id] = breakdown;
    if (st.name) {
      buyInInfoMap[st.name] = breakdown;
    }
  });

  const renderSeatedStakeholder = (st: any, isRightSide: boolean = false) => {
    const isSelected = selectedStakeholderId === st.id;
    const isSpeaking = activeSpeakingState?.stakeholderId === st.id;
    const stakeholderColor = getStakeholderColor(st);
    const av = st.avatar || {};
    const breakdown = calculatePersuasionBreakdown(st);

    return (
      <div
        key={st.id}
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
            className={`${styles.tableSpeechBubble} ${activeSpeakingState.isClosing ? styles.tableSpeechBubbleClosing : ""}`}
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
            size={76}
            stakeholderColor={stakeholderColor}
            title={st.name}
            flip={isRightSide ? true : av.flip}
          />
        </div>

        {/* Conference Desk Nameplate */}
        <div
          className={`${styles.deskNameplate} ${isSelected ? styles.activeDeskNameplate : ""}`}
          style={{
            color: isSelected ? "#ffc107" : stakeholderColor,
            borderColor: isSelected ? "#ffc107" : stakeholderColor,
          }}
        >
          {st.name}
        </div>

        {/* Satisfaction / Resistance Gauge Pill under nameplate */}
        <div
          className={`${styles.satisfactionPill} ${breakdown.isPersuaded ? styles.satisfactionPillCommitted : styles.satisfactionPillResistant}`}
          title={`${st.name}: ${Math.round(breakdown.total * 100)}% buy-in (Target: ${Math.round(breakdown.threshold * 100)}%)`}
        >
          <span>{breakdown.isPersuaded ? "🟢" : "🔴"}</span>
          <span>{Math.round(breakdown.total * 100)}% {breakdown.isPersuaded ? "Committed" : "Resistant"}</span>
        </div>
      </div>
    );
  };

  const bgIndex = (currentChallenge + currentPhase) % 4;

  const pitchedTitle = pitchedActionCard?.title || "Deploy High-Throughput Feature Store & Pipeline";
  const pitchedDescription = pitchedActionCard?.description || "Centralize feature transformation, reduce data leakage, and establish unified serving pipelines across development and production.";
  const cardIntelIds = pitchedActionCard?.intel_ids || [];

  return (
    <div className={styles.container}>
      {/* Main Content Canvas with Dynamic Background */}
      <div
        className="container-fluid flex-grow-1 d-flex flex-column px-3 py-2 position-relative overflow-hidden"
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
            className={styles.circularHelpIcon}
          />
        </button>

        {/* Layer 1: Default Pitch Debate Page (Board & Conversation History) */}
        <div
          className={`flex-grow-1 d-flex flex-column w-100 ${styles.helpBaseLayer} ${showHelp ? styles.helpBaseLayerDimmed : styles.helpBaseLayerActive}`}
        >
          {/* Main Board Grid: Left Column = Stakeholder Dossier, Right Column = Pitch Deck & Chat */}
          <div className="row g-2 align-items-stretch flex-grow-1 h-100" style={{ minHeight: 0 }}>

            {/* LEFT COLUMN: Stakeholder Dossier (Constantly Open & Embedded) */}
            <div className="col-12 col-lg-4 d-flex flex-column h-100 position-relative" style={{ minHeight: 0, zIndex: 1 }}>
              <div className={`flex-grow-1 ${styles.dossierContainer}`}>
                <StakeholderDossier
                  isOpen={true}
                  canClose={false}
                  isEmbedded={true}
                  dossierData={dossierData || []}
                  activeStakeholderId={selectedStakeholderId}
                  highlightedIntelId={highlightedIntelId}
                  currentPhase={currentPhase}
                  currentChallenge={currentChallenge}
                  buyInInfoMap={buyInInfoMap}
                  onClose={() => { }}
                />
              </div>
            </div>

            {/* RIGHT COLUMN: Boardroom Table + Chat + Dialogue Options */}
            <div
              className={`col-12 col-lg-8 d-flex flex-column gap-2 h-100 rounded transition-all position-relative ${isAnySpeechActive || Boolean(openDropdownOptionId) ? styles.overflowVisibleSpeech : "overflow-hidden"
                }`}
              style={{ minHeight: 0, zIndex: isAnySpeechActive ? 1500 : (openDropdownOptionId ? 2500 : 1) }}
            >
              {/* Upper Section: Challenge & Pitch Deck Table (Left) + Chat History (Right) */}
              <div
                className={`flex-grow-1 row g-2 align-items-stretch position-relative ${isAnySpeechActive ? styles.overflowVisibleSpeech : "overflow-hidden"
                  }`}
                style={{ minHeight: 0, zIndex: isAnySpeechActive ? 1600 : 1 }}
              >
                {/* Left: Challenge Card + Pitch Deck Boardroom Scene */}
                <div
                  className={`${styles.boardCol} ${isChatMaximized ? styles.boardColCollapsed : ""
                    } ${isAnySpeechActive ? styles.boardColSpeaking : ""} d-flex flex-column justify-content-between h-100 position-relative`}
                  style={{ minHeight: 0, zIndex: isAnySpeechActive ? 1700 : 1 }}
                >
                  {/* 1. Challenge Description Card above table */}
                  <div className="w-100 flex-shrink-0 mb-1">
                    <ChallengeDescriptionCard
                      challengeTitle={challengeTitle}
                      challengeDescription={challengeDescription}
                      challengeIntro={challengeIntro}
                      currentChallenge={currentChallenge}
                      challengeAmount={challengeNumber}
                    />
                  </div>

                  {/* 2. Boardroom Pitch Deck Table Scene */}
                  <div
                    className="w-100 d-flex flex-column align-items-center justify-content-center flex-grow-1 pt-3 position-relative"
                    style={{ zIndex: isAnySpeechActive ? 1800 : 2, overflow: isAnySpeechActive ? "visible" : undefined }}
                  >
                    <div
                      className={`${styles.pitchDeckTable} ${isAnySpeechActive ? styles.pitchDeckTableSpeaking : ""
                        }`}
                    >
                      {/* Top Row: Stakeholders sitting behind the table */}
                      {topStakeholders.length > 0 && (
                        <div
                          className={`${styles.tableTopSeating} ${topStakeholders.some((st) => activeSpeakingState?.stakeholderId === st.id)
                            ? styles.seatingSpeaking
                            : ""
                            }`}
                        >
                          {topStakeholders.map((st) => renderSeatedStakeholder(st))}
                        </div>
                      )}

                      {/* Middle Section: Left Seat, Central Pitched Action Card, Right Seat */}
                      <div className={`${styles.tableCenterSurface} ${[...leftStakeholders, ...rightStakeholders].some((st) => activeSpeakingState?.stakeholderId === st.id)
                        ? styles.tableCenterSurfaceSpeaking
                        : ""
                        }`}>
                        {/* Left Seat */}
                        <div
                          className={`${styles.tableSideSeating} ${leftStakeholders.some((st) => activeSpeakingState?.stakeholderId === st.id)
                            ? styles.seatingSpeaking
                            : ""
                            }`}
                        >
                          {leftStakeholders.map((st) => renderSeatedStakeholder(st))}
                        </div>

                        {/* Center Tabletop: Pitched Action Card with Addendums (Minimized View) */}
                        <div className={styles.tabletopCenterArea}>
                          <ActionCardCardComponent
                            card={
                              pitchedActionCard || {
                                id: "pitched_ac_fallback",
                                title: pitchedTitle,
                                description: pitchedDescription,
                                intel_ids: cardIntelIds,
                                addendum_intel_item_ids: [],
                              }
                            }
                            intelItems={intelItems}
                            addendums={placeholderAddendums}
                            stakeholders={stakeholders}
                            getStakeholderColor={getStakeholderColor}
                            isMinimized={true}
                            isInteractive={true}
                            onClick={() => setIsActionCardModalOpen(true)}
                          />
                        </div>

                        {/* Right Seat */}
                        <div
                          className={`${styles.tableSideSeating} ${rightStakeholders.some((st) => activeSpeakingState?.stakeholderId === st.id)
                            ? styles.seatingSpeaking
                            : ""
                            }`}
                        >
                          {rightStakeholders.map((st) => renderSeatedStakeholder(st, true))}
                        </div>
                      </div>

                      {/* Lower Border Interaction Area: Addendums Explanation & Overview */}
                      <div
                        className={styles.tableLowerInteractionArea}
                        title="Addendums modify the Base Action Card ('execute this action, but also do X'). Match presentation style to convincer profiles to resolve objections."
                      >
                        {/* Status Badges: Addendums & Consensus */}
                        <div className={styles.statChipsRowCentered}>
                          <div
                            className={styles.statChipAddendum}
                            title={`${attachedAddendums.length} Addendums currently attached to proposal (max 2)`}
                          >
                            <Icon icon="ph:puzzle-piece-bold" className={styles.addendumStatIcon} />
                            <span className={styles.statNumber}>{attachedAddendums.length} / 2</span>
                            <span className={styles.statLabel}>Addendums</span>
                          </div>

                          <div
                            className={styles.statChipConsensus}
                            title={`${persuadedCount} of ${activeStakeholders.length} stakeholders committed`}
                          >
                            <Icon icon="ph:scales-bold" className={styles.consensusStatIcon} />
                            <span className={styles.statNumber}>{persuadedCount}/{activeStakeholders.length}</span>
                            <span className={styles.statLabel}>{allActiveStakeholdersPersuaded ? "Consensus" : "Buy-In"}</span>
                          </div>
                        </div>

                        {/* Explainer Guidance from GDD.txt */}
                        <p className={styles.pitchExplainerText}>
                          <strong className={styles.explainerAddendum}>Addendums</strong> modify the <strong className={styles.explainerBaseCard}>Base Action Card</strong> (<em>"execute this action, but also do X"</em>). Address objections to prevent <strong className={styles.explainerVeto}>high-power vetos</strong> and achieve <strong className={styles.explainerPass}>Consensus</strong>.
                        </p>

                        {/* Inspect Proposal Action Button following guideline */}
                        <button
                          type="button"
                          className={`${styles.actionButton} ${isSpeechBubbleCoveringButton ? styles.actionButtonBlocked : ""}`}
                          onClick={() => setIsActionCardModalOpen(true)}
                          title="Inspect the complete Action Proposal and attached Addendums in detail"
                        >
                          <Icon icon="ph:cards-bold" style={{ fontSize: "1.1rem" }} />
                          <span>Inspect Proposal & Addendums Overview ({attachedAddendums.length} Attached) ➔</span>
                        </button>
                      </div>

                      {/* Active Player Speech Bubble on Pitch Deck */}
                      {activePlayerSpeakingState && (
                        <div
                          className={`${styles.playerTableSpeechBubble} ${activePlayerSpeakingState.isClosing ? styles.playerTableSpeechBubbleClosing : ""
                            }`}
                          onClick={(e) => { e.stopPropagation(); skipCurrentSpeech(); }}
                        >
                          <div className={styles.playerSpeechHeader}>
                            <Icon icon="ph:user-circle-bold" />
                            <span>Player</span>
                            <button
                              type="button"
                              className={styles.speechSkipBtn}
                              onClick={(e) => { e.stopPropagation(); skipCurrentSpeech(); }}
                              title="Skip to next message"
                            >
                              <Icon icon="ph:skip-forward-fill" />
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

                {/* Right: Chat History (Spans Full Height) */}
                <div
                  className={`${styles.chatCol} ${isChatMaximized ? styles.chatColMaximized : ""
                    } d-flex flex-column h-100 overflow-hidden position-relative`}
                  style={{ minHeight: 0, zIndex: 1 }}
                >
                  {/* When conversation history is maximized, the challenge fills across the whole upper space */}
                  <div
                    className={`${styles.maximizedChallengeWrapper} ${isChatMaximized ? styles.maximizedChallengeWrapperVisible : ""
                      }`}
                  >
                    <ChallengeDescriptionCard
                      challengeTitle={challengeTitle}
                      challengeDescription={challengeDescription}
                      challengeIntro={challengeIntro}
                      currentChallenge={currentChallenge}
                      challengeAmount={challengeNumber}
                    />
                  </div>

                  <div
                    className={`flex-grow-1 ${styles.chatWrapper} ${isChatMaximized ? styles.chatWrapperMaximized : ""}`}
                    style={{ minHeight: 0 }}
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
                      onInspectIntel={(intel, stId) => {
                        const targetOpt = {
                          intel_item_id: intel.id || intel.requirement_id,
                          intel_stakeholder_id: intel.stakeholder_id || stId,
                          intel_stakeholder_name: intel.stakeholder_name,
                        };
                        handleInspectIntel(targetOpt as any);
                      }}
                    />
                    {/* Maximize / Minimize button */}
                    <button
                      type="button"
                      className={styles.chatMaximizeBtn}
                      onClick={() => setIsChatMaximized(!isChatMaximized)}
                      title={isChatMaximized ? "Restore view" : "Maximize conversation history"}
                    >
                      <Icon
                        icon={isChatMaximized ? "ph:arrows-in-simple-bold" : "ph:arrows-out-simple-bold"}
                        className={styles.chatMaximizeBtnIcon}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* Dedicated Lower Section: Dialogue Options Deck & Pitch Resolution Control */}
              <div
                className="flex-shrink-0 position-relative"
                style={{ zIndex: openDropdownOptionId ? 2800 : 20 }}
              >
                <div
                  className={`${styles.dialogueOptionsDeck} ${openDropdownOptionId ? styles.dialogueOptionsDeckOpen : ""
                    }`}
                  style={{ position: "relative", zIndex: openDropdownOptionId ? 2800 : 20 }}
                >
                  {/* Header Row */}
                  <div className={styles.dialogueHeader}>
                    <div className="d-flex align-items-center gap-2">
                      <Icon icon="ph:chats-circle-bold" className="text-warning" style={{ fontSize: "1.1rem" }} />
                      <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#ffffff" }}>
                        Dialogue Options
                      </span>
                    </div>

                    <div className="d-flex align-items-center gap-2">
                      {!isChatEnabled && (
                        <span className="badge bg-warning text-dark d-flex align-items-center gap-1" style={{ fontSize: "0.68rem" }}>
                          <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" style={{ width: "0.7rem", height: "0.7rem" }}></span>
                          stakeholders are typing...
                        </span>
                      )}

                      {/* End Pitch & Proceed Button */}
                      <button
                        type="button"
                        className={`btn btn-sm ${allActiveStakeholdersPersuaded ? "btn-success" : "btn-outline-success"} fw-bold d-flex align-items-center gap-1 px-3 py-1`}
                        onClick={handleEndPitchClick}
                        title="Conclude Pitch Debate and execute proposal in Simulation Phase"
                        style={{ fontSize: "0.76rem" }}
                      >
                        <Icon icon="ph:check-circle-bold" style={{ fontSize: "0.95rem" }} />
                        <span>End Pitch & Simulate {allActiveStakeholdersPersuaded ? "(Consensus Ready)" : ""} ➔</span>
                      </button>
                    </div>
                  </div>

                  {/* Dialogue Option Cards Grid */}
                  <div className="row g-2">
                    {dialogueOptions && dialogueOptions.length > 0 ? (
                      dialogueOptions.map((opt, idx) => {
                        const isIntel = opt.type === "intel";
                        const currentTargetStId = getSelectedTargetForOption(opt.id);
                        const targetStakeholderObj =
                          activeStakeholders.find((s) => s.id === currentTargetStId) ||
                          activeStakeholders[0];
                        const isDropdownOpen = openDropdownOptionId === opt.id;

                        // Intel verification state resolution
                        const matchingIntel = intelItems?.find(
                          (item) => item.id === opt.intel_item_id || item.requirement_id === opt.intel_item_id
                        );
                        const matchingDossierItem = dossierData
                          ?.flatMap((d) => d.intel_items || [])
                          .find((item) => item.id === opt.intel_item_id || item.requirement_id === opt.intel_item_id);

                        const isVerified = Boolean(
                          (matchingIntel?.intel_type || "").toLowerCase().includes("verified") ||
                          (matchingDossierItem?.intel_type || "").toLowerCase().includes("verified") ||
                          (opt.intel_type && opt.intel_type.toLowerCase().includes("verified"))
                        );

                        const intelStakeholderObj = opt.intel_stakeholder_id
                          ? stakeholders[opt.intel_stakeholder_id] ||
                          activeStakeholders.find((s) => s.id === opt.intel_stakeholder_id)
                          : null;
                        const intelStColor = intelStakeholderObj
                          ? getStakeholderColor(intelStakeholderObj)
                          : "var(--primary-bg)";

                        // Archetype symbol and color for corporate noise loaded dynamically from backend
                        const archInfo = getArchetypeInfo(opt.archetype);

                        return (
                          <div
                            key={opt.id || idx}
                            className="col-12 col-md-6 d-flex position-relative"
                            style={{ zIndex: isDropdownOpen ? 3000 : 1 }}
                          >
                            <div
                              role="button"
                              tabIndex={isChatEnabled ? 0 : -1}
                              className={`${styles.dialogueCardContainer} ${isIntel ? styles.dialogueCardIntel : styles.dialogueCardNoise
                                } ${!isChatEnabled ? styles.dialogueCardDisabled : ""} ${isDropdownOpen ? styles.dialogueCardDropdownActive : ""
                                }`}
                              style={{ zIndex: isDropdownOpen ? 3100 : undefined }}
                              onClick={(e) => handleSelectDialogue(opt, e)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  handleSelectDialogue(opt);
                                }
                              }}
                              title={
                                isIntel
                                  ? `Click to inquire with ${opt.intel_stakeholder_name || "Stakeholder"} using this intel`
                                  : `Click to pitch corporate noise to ${targetStakeholderObj?.name || "Stakeholder"}`
                              }
                            >
                              {/* Top Line: Badge at left, Target / Direct Toward on the same horizontal line */}
                              <div className={styles.dialogueCardTopLine}>
                                {isIntel ? (
                                  <>
                                    {/* Left: CONFIRMED INTEL or UNCONFIRMED INTEL (Clickable with link icon) */}
                                    <div className="d-flex align-items-center gap-2">
                                      <button
                                        type="button"
                                        className={`${isVerified
                                          ? styles.dialogueBadgeConfirmedIntel
                                          : styles.dialogueBadgeUnconfirmedIntel
                                          } ${styles.dialogueBadgeIntelClickable}`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleInspectIntel(opt);
                                        }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        title={`Click to highlight this note in ${opt.intel_stakeholder_name || "Stakeholder"}'s Dossier`}
                                      >
                                        <Icon
                                          icon={isVerified ? "ph:seal-check-fill" : "ph:question-fill"}
                                          style={{ fontSize: "0.85rem" }}
                                        />
                                        <span>{isVerified ? "CONFIRMED INTEL" : "UNCONFIRMED INTEL"}</span>
                                        <Icon
                                          icon="ph:arrow-square-out-bold"
                                          className={styles.dialogueBadgeClickableIcon}
                                        />
                                      </button>
                                    </div>

                                    {/* Right: Target Stakeholder on same horizontal line */}
                                    <div className="d-flex align-items-center gap-1 flex-shrink-0">
                                      <span className={styles.dialogueTargetLabel}>Target:</span>
                                      {intelStakeholderObj ? (
                                        <div className="d-flex align-items-center gap-1">
                                          <div className={styles.dropdownMiniAvatar}>
                                            <StakeholderAvatarComponent
                                              avatar={(intelStakeholderObj as any).avatar || {}}
                                              size={18}
                                              isFramed={false}
                                              play_blink_animation={false}
                                              stakeholderColor={intelStColor}
                                              title={intelStakeholderObj.name}
                                            />
                                          </div>
                                          <span
                                            className={styles.dialogueTargetName}
                                            style={{ color: intelStColor }}
                                          >
                                            {intelStakeholderObj.name}
                                          </span>
                                        </div>
                                      ) : (
                                        <span className={styles.dialogueTargetName}>
                                          {opt.intel_stakeholder_name || "Stakeholder"}
                                        </span>
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    {/* Left: Corporate Noise sign + Archetype Badge */}
                                    <div className="d-flex align-items-center gap-2 overflow-hidden flex-wrap">
                                      <span className={styles.dialogueCategoryBadgeNoise}>
                                        <Icon icon="ph:megaphone-simple-bold" />
                                        Corporate Noise
                                      </span>
                                      {/* Archetype Badge with Symbols & Color loaded dynamically */}
                                      {archInfo && (
                                        <span
                                          className={styles.archetypeBadge}
                                          style={{
                                            borderColor: archInfo.color || undefined,
                                            color: archInfo.color || undefined,
                                            background: archInfo.color
                                              ? `color-mix(in srgb, ${archInfo.color} 15%, transparent)`
                                              : undefined,
                                          }}
                                          title={`Convincer Archetype: ${archInfo.name}`}
                                        >
                                          {archInfo.icon && (
                                            <span className={styles.archetypeIcon}>{archInfo.icon}</span>
                                          )}
                                          <span className={styles.archetypeName}>
                                            {archInfo.name}
                                          </span>
                                        </span>
                                      )}
                                    </div>

                                    {/* Right: Direct Toward: + Dropdown Selector on same horizontal line */}
                                    <div className="d-flex align-items-center gap-1 flex-shrink-0">
                                      <span className={styles.dialogueTargetLabel}>Direct Toward:</span>
                                      <div
                                        className={styles.dropdownWrapper}
                                        onClick={(e) => e.stopPropagation()}
                                        onMouseDown={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          className={styles.dropdownToggleBtn}
                                          disabled={!isChatEnabled}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setOpenDropdownOptionId(isDropdownOpen ? null : opt.id);
                                          }}
                                          title={`Currently targeting: ${targetStakeholderObj?.name || "Select Stakeholder"}`}
                                        >
                                          {targetStakeholderObj && (
                                            <div className={styles.dropdownMiniAvatar}>
                                              <StakeholderAvatarComponent
                                                avatar={(targetStakeholderObj as any).avatar || {}}
                                                size={18}
                                                isFramed={false}
                                                play_blink_animation={false}
                                                stakeholderColor={getStakeholderColor(targetStakeholderObj)}
                                                title={targetStakeholderObj.name}
                                              />
                                            </div>
                                          )}
                                          <span className={styles.dropdownSelectedName}>
                                            {targetStakeholderObj?.name || "Select Stakeholder"}
                                          </span>
                                          <Icon
                                            icon={isDropdownOpen ? "ph:caret-up-bold" : "ph:caret-down-bold"}
                                            style={{ fontSize: "0.7rem", opacity: 0.8 }}
                                          />
                                        </button>

                                        {/* Floating Dropdown Menu */}
                                        {isDropdownOpen && (
                                          <div
                                            className={styles.dropdownMenuFloating}
                                            onClick={(e) => e.stopPropagation()}
                                            onMouseDown={(e) => e.stopPropagation()}
                                          >
                                            <div className={styles.dropdownMenuHeader}>Direct Noise Toward:</div>
                                            {activeStakeholders.map((st) => {
                                              const isSelected = st.id === currentTargetStId;
                                              return (
                                                <button
                                                  key={st.id}
                                                  type="button"
                                                  className={`${styles.dropdownMenuItem} ${isSelected ? styles.dropdownMenuItemActive : ""
                                                    }`}
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSelectNoiseTarget(opt.id, st.id);
                                                    setOpenDropdownOptionId(null);
                                                  }}
                                                  title={`${st.name} (${st.role_description || ""})`}
                                                >
                                                  <div className={styles.dropdownMiniAvatar}>
                                                    <StakeholderAvatarComponent
                                                      avatar={(st as any).avatar || {}}
                                                      size={18}
                                                      isFramed={false}
                                                      play_blink_animation={false}
                                                      stakeholderColor={getStakeholderColor(st)}
                                                      title={st.name}
                                                    />
                                                  </div>
                                                  <span className={styles.dropdownItemName}>{st.name}</span>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>

                              {/* Card Body */}
                              <div className={styles.dialogueCardBody}>
                                {isIntel ? (
                                  /* Intel Description Callout */
                                  <div className={styles.dialogueIntelDescriptionBox}>
                                    <Icon icon="ph:quotes-fill" className={styles.dialogueQuoteIcon} />
                                    <p className={styles.dialogueIntelDescriptionText}>
                                      {opt.intel_description || "Specific stakeholder constraint and requirement."}
                                    </p>
                                  </div>
                                ) : (
                                  /* Corporate Noise Strategy Note */
                                  <div
                                    className={styles.dialogueNoiseStrategyBox}
                                    style={{
                                      borderLeft: `3.5px solid ${archInfo?.color || "#38bdf8"}`,
                                      borderColor: `color-mix(in srgb, ${archInfo?.color || "#38bdf8"} 35%, transparent)`,
                                    }}
                                  >
                                    <span
                                      style={{
                                        color: archInfo?.color || "#38bdf8",
                                        fontSize: "0.85rem",
                                        flexShrink: 0,
                                        marginTop: "2px",
                                        lineHeight: 1,
                                      }}
                                    >
                                      {archInfo?.icon || ""}
                                    </span>
                                    <p className={styles.dialogueNoiseStrategyText}>
                                      {opt.archetype?.strategy || "Foster strategic alignment and consensus across stakeholders."}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="col-12 text-center py-2 text-white-50">
                        <span className="small">Waiting for stakeholder opening statements or reactions...</span>
                      </div>
                    )}
                  </div>
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

      {/* Action Card Detail Modal (Maximized View with full Addendums breakdown) */}
      <ActionCardDetailModal
        isOpen={isActionCardModalOpen}
        onClose={() => setIsActionCardModalOpen(false)}
        actionCard={
          pitchedActionCard || {
            id: "pitched_ac_fallback",
            title: pitchedTitle,
            description: pitchedDescription,
            intel_ids: cardIntelIds,
            addendum_intel_item_ids: [],
          }
        }
        intelItems={intelItems}
        addendums={placeholderAddendums}
        stakeholders={stakeholders}
        getStakeholderColor={getStakeholderColor}
      />
    </div>
  );
}
