import { useState, useContext, useEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import type { ActionCard } from "../types/ActionCard";
import type { EngagementCard } from "../types/EngagementCard";
import { StakeholderContext } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import styles from "./online_intel_gathering.module.css";
import StakeholderDossier, { type StakeholderDossierEntry } from "./StakeholderDossier";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import StakeholderInteractionArea, { type ChatMsg } from "./StakeholderInteractionArea";
import PerformanceDashboard from "./PerformanceDashboard";
import EngagementCards from "./EngagementCards";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import IntelVerificationDialog, { type IntelVerificationResultData } from "./IntelVerificationDialog";
import HoverTooltip from "./HoverToolTip";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import ChallengeDescriptionCard from "./ChallengeDescriptionCard";
import EngagementCardTargetModal from "./EngagementCardTargetModal";
import PitchActionCardModal from "./PitchActionCardModal";
import ActionCardCreatedModal from "./ActionCardCreatedModal";

interface OnlineIntelGatheringProps {
  onContinue: (pitchedCard?: any) => void;
  currentPhase?: number;
  currentChallenge?: number;
  showMetricValueChanges?: boolean;
  last_ac?: ActionCard;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  challengeAmount?: number;
  dossierData?: StakeholderDossierEntry[];
  activeStakeholderId?: string;
  intelItems?: IntelItem[];
  onUpdateIntelItems?: (items: IntelItem[]) => void;
  attentionTokens?: number;
  setAttentionTokens?: React.Dispatch<React.SetStateAction<number>>;
  playedCardIdsInPhase?: string[];
  setPlayedCardIdsInPhase?: React.Dispatch<React.SetStateAction<string[]>>;
  cardTargetedStakeholdersMap?: Record<string, string[]>;
  setCardTargetedStakeholdersMap?: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  chatMsgs?: ChatMsg[];
  setChatMsgs?: React.Dispatch<React.SetStateAction<ChatMsg[]>>;
  engagementCards?: EngagementCard[];
  pitchedActionCard?: ActionCard | null;
  onUpdatePitchedCard?: (card: ActionCard) => void;
}

export interface IntelItem {
  id: string;
  requirement_id?: string;
  intel_type: string;
  categorized_type: string;
  description: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
}

export interface IntelVerificationResultModalData {
  wasCorrect: boolean;
  oldType: string;
  trueType: string;
  description: string;
  stakeholderName: string;
}



export default function OnlineIntelGathering({
  onContinue,
  currentPhase = 0,
  currentChallenge = 0,
  showMetricValueChanges = false,
  last_ac,
  challengeTitle = "Deploy High-Performance Recommendation Engine",
  challengeDescription = "The team needs to align with #Security Manager# and #Lead Data Scientist# on deployment safety.",
  challengeIntro = "Phase 2: Strategic Alignment & Intelligence Gathering",
  challengeAmount = 3,
  dossierData = [],
  activeStakeholderId,
  intelItems = [],
  onUpdateIntelItems,
  attentionTokens: propsAttentionTokens,
  setAttentionTokens: propsSetAttentionTokens,
  playedCardIdsInPhase: propsPlayedCardIdsInPhase,
  setPlayedCardIdsInPhase: propsSetPlayedCardIdsInPhase,
  cardTargetedStakeholdersMap: propsCardTargetedStakeholdersMap,
  setCardTargetedStakeholdersMap: propsSetCardTargetedStakeholdersMap,
  chatMsgs: propsChatMsgs,
  setChatMsgs: propsSetChatMsgs,
  engagementCards: propsEngagementCards,
  pitchedActionCard: propsPitchedActionCard,
  onUpdatePitchedCard,
}: OnlineIntelGatheringProps) {
  const stakeholderCtx = useContext(StakeholderContext);
  const stakeholders = stakeholderCtx?.stakeholders || {};
  const metricsCtx = useContext(MetricsContext);
  const metrics = metricsCtx?.metrics || {};

  const engagementCards = propsEngagementCards || [];

  // Attention Tokens state (controlled or local fallback)
  const [localAttentionTokens, setLocalAttentionTokens] = useState(8);
  const attentionTokens = propsAttentionTokens !== undefined ? propsAttentionTokens : localAttentionTokens;
  const setAttentionTokens = propsSetAttentionTokens || setLocalAttentionTokens;

  // Active Stakeholder & Speech Bubble
  const [selectedStakeholderId, setSelectedStakeholderId] = useState<string>("st_security");
  const [_stakeholderResponses, setStakeholderResponses] = useState<Record<string, string>>({
    st_security: "We must ensure strict data privacy before approving any deployment pipeline.",
    st_data_sci: "Our model latency needs to remain under 50ms for live inferencing.",
    st_product: "Budget constraints are tight, so compute costs need optimization.",
  });

  // Conversation History Chat Messages 
  const [localChatMsgs, setLocalChatMsgs] = useState<ChatMsg[]>([]);
  const chatMsgs = propsChatMsgs !== undefined ? propsChatMsgs : localChatMsgs;
  const setChatMsgs = propsSetChatMsgs || setLocalChatMsgs;

  // Pitch Overlay Modal & Intel Selection State
  const [isPitchModalOpen, setIsPitchModalOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [selectedIntelIds, setSelectedIntelIds] = useState<string[]>(propsPitchedActionCard?.intel_ids || []);
  const [isGeneratingActionCard, setIsGeneratingActionCard] = useState(false);
  const [pitchedActionCardState, setPitchedActionCardState] = useState<ActionCard | null>(propsPitchedActionCard || null);
  const [pitchedCardTitle, setPitchedCardTitle] = useState<string | null>(propsPitchedActionCard?.title || null);
  const [createdActionCardForModal, setCreatedActionCardForModal] = useState<ActionCard | null>(null);

  useEffect(() => {
    if (propsPitchedActionCard) {
      setPitchedActionCardState(propsPitchedActionCard);
      setPitchedCardTitle(propsPitchedActionCard.title);
      if (propsPitchedActionCard.intel_ids) {
        setSelectedIntelIds(propsPitchedActionCard.intel_ids);
      }
    }
  }, [propsPitchedActionCard]);

  // Active Playing Engagement Card Modal State
  const [playingCard, setPlayingCard] = useState<EngagementCard | null>(null);

  const [localPlayedCardIdsInPhase, setLocalPlayedCardIdsInPhase] = useState<string[]>([]);
  const playedCardIdsInPhase = propsPlayedCardIdsInPhase !== undefined ? propsPlayedCardIdsInPhase : localPlayedCardIdsInPhase;
  const setPlayedCardIdsInPhase = propsSetPlayedCardIdsInPhase || setLocalPlayedCardIdsInPhase;

  const [localCardTargetedStakeholdersMap, setLocalCardTargetedStakeholdersMap] = useState<Record<string, string[]>>({});
  const cardTargetedStakeholdersMap = propsCardTargetedStakeholdersMap !== undefined ? propsCardTargetedStakeholdersMap : localCardTargetedStakeholdersMap;
  const setCardTargetedStakeholdersMap = propsSetCardTargetedStakeholdersMap || setLocalCardTargetedStakeholdersMap;

  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const { emit, subscribe } = useGameWebSocket();

  // Intel Verification Result Modal State
  const [verificationResultModal, setVerificationResultModal] = useState<IntelVerificationResultData | null>(null);

  // Maximized conversation history state
  const [isChatMaximized, setIsChatMaximized] = useState(false);

  // Speech Bubble Queue System (Player and Stakeholders traverse sequentially without interruptions)
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

  // Active speaking stakeholder state (triggers animated mouth and speech bubble)
  const [activeSpeakingState, setActiveSpeakingState] = useState<{
    stakeholderId: string;
    message: string;
    isClosing?: boolean;
  } | null>(null);

  // Active player speaking state (triggers player speech bubble on the pitch deck table)
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

    // Add this message to conversation history only when it appears in the speech bubble
    if (nextItem.chatMsg) {
      setChatMsgs((prev) => [...prev, nextItem.chatMsg!]);
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

  // Clear speech timers on unmount
  useEffect(() => {
    return () => {
      speechQueueRef.current = [];
      isProcessingQueueRef.current = false;
      if (activeSpeechTimerRef.current) clearTimeout(activeSpeechTimerRef.current);
      if (activeFadeTimerRef.current) clearTimeout(activeFadeTimerRef.current);
      if (activeNextTimerRef.current) clearTimeout(activeNextTimerRef.current);
    };
  }, []);

  // Subscribe to intel WebSocket events
  useEffect(() => {
    if (!subscribe) return;
    const unsubscribe = subscribe("intel:verified_res", (payload: any) => {
      console.log("[WS] Received intel:verified_res in component:", payload);
      if (payload && payload.status === "success") {
        setVerificationResultModal({
          wasCorrect: payload.old_categorized_type === payload.true_categorized_type,
          oldType: payload.old_categorized_type,
          trueType: payload.true_categorized_type,
          description: payload.description,
          stakeholderName: payload.stakeholder_name,
        });
      }
    });

    const unsubMsgReceived = subscribe("intel:message_received", (payload: any) => {
      console.log("[WS] Received intel:message_received in component:", payload);
      if (!payload) return;

      if (payload.type === "player_message" && payload.message) {
        // Delay adding to history until speech bubble appears
        triggerPlayerSpeech(payload.message, {
          id: "user",
          message: payload.message,
          ac_id: -1,
        });
      } else if (payload.type === "stakeholder_message" && payload.message) {
        if (payload.stakeholder_id) {
          // Delay adding to history until speech bubble appears
          triggerStakeholderSpeech(payload.stakeholder_id, payload.message, {
            id: payload.stakeholder_id,
            message: payload.message,
            ac_id: -1,
            revealed_intel: payload.revealed_intel_items || [],
          });
          setStakeholderResponses((prev) => ({
            ...prev,
            [payload.stakeholder_id]: payload.message,
          }));
        }
      }
    });

    const handleEngagementFinished = (payload: any) => {
      console.log("[WS] Received engagement complete in component:", payload);
      setIsWaitingForResponse(false);
      if (!payload) return;

      if (payload.played_engagement_card_ids) {
        setPlayedCardIdsInPhase(payload.played_engagement_card_ids);
      }
      if (payload.engagement_card_targets) {
        setCardTargetedStakeholdersMap(payload.engagement_card_targets);
      }

      if (payload.dossier && onUpdateIntelItems) {
        const directIntelItems: IntelItem[] = (payload.dossier || []).flatMap((entry: any) =>
          (entry.intel_items || []).map((intel: any) => ({
            ...intel,
            stakeholder_id: entry.stakeholder_id,
            stakeholder_name: entry.name,
          }))
        );
        onUpdateIntelItems(directIntelItems);
      }
    };

    const unsubComplete = subscribe("intel:engagement_complete", handleEngagementFinished);
    const unsubResponse = subscribe("intel:engagement_response", handleEngagementFinished);
    const unsubDossier = subscribe("intel:dossier_data", (payload: any) => {
      if (!payload) return;
      if (payload.played_engagement_card_ids) {
        setPlayedCardIdsInPhase(payload.played_engagement_card_ids);
      }
      if (payload.engagement_card_targets) {
        setCardTargetedStakeholdersMap(payload.engagement_card_targets);
      }
    });

    const unsubActionCardGen = subscribe("intel:action_card_generated", (payload: any) => {
      console.log("[WS] Received intel:action_card_generated in component:", payload);
      setIsGeneratingActionCard(false);
      if (payload && payload.action_card) {
        setPitchedActionCardState(payload.action_card);
        setPitchedCardTitle(payload.action_card.title);
        if (payload.action_card.intel_ids) {
          setSelectedIntelIds(payload.action_card.intel_ids);
        }
        if (onUpdatePitchedCard) {
          onUpdatePitchedCard(payload.action_card);
        }
        setCreatedActionCardForModal(payload.action_card);
      }
    });

    const unsubSystemError = subscribe("system:error", () => {
      setIsWaitingForResponse(false);
    });

    return () => {
      unsubscribe();
      unsubMsgReceived();
      unsubComplete();
      unsubResponse();
      unsubDossier();
      unsubSystemError();
      unsubActionCardGen();
    };
  }, [subscribe, onUpdateIntelItems, setPlayedCardIdsInPhase, setCardTargetedStakeholdersMap]);

  const handleCloseCardModal = () => {
    setPlayingCard(null);
  };

  const availableStakeholderList = Object.keys(stakeholders).length > 0
    ? Object.values(stakeholders)
    : [
      {
        id: "st_security",
        name: "Security Manager",
        role_description: "Ensures compliance and data security across ML pipelines.",
        stakeholder_color: "#dc3545",
        metric_id: "metric_security",
      },
      {
        id: "st_data_sci",
        name: "Lead Data Scientist",
        role_description: "Focuses on model accuracy, latency, and experiment tracking.",
        stakeholder_color: "#0d6efd",
        metric_id: "metric_accuracy",
      },
      {
        id: "st_product",
        name: "Product Owner",
        role_description: "Manages feature scope, timelines, and business ROI.",
        stakeholder_color: "#ffc107",
        metric_id: "metric_cost",
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

  const renderSeatedStakeholder = (st: any, isRightSide: boolean = false) => {
    const isSelected = (selectedStakeholderId || activeStakeholderId) === st.id;
    const isSpeaking = activeSpeakingState?.stakeholderId === st.id;
    const stakeholderColor = getStakeholderColor(st);
    const av = st.avatar || {};

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
        {/* Active Speech Bubble above speaking stakeholder (Complete text visible) */}
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

        {/* Unframed compact Avatar Viewport */}
        <div className={styles.seatedAvatarViewport}>
          <StakeholderAvatarComponent
            avatar={av}
            play_blink_animation={true}
            isFramed={false}
            isSpeaking={isSpeaking}
            size={108}
            stakeholderColor={stakeholderColor}
            title={st.name}
            flip={isRightSide ? true : av.flip}
          />
        </div>

        {/* Conference Desk Nameplate (Centered with exact stakeholder color and active indicator) */}
        <div
          className={`${styles.deskNameplate} ${isSelected ? styles.activeDeskNameplate : ""}`}
          style={{
            color: isSelected ? "#ffc107" : stakeholderColor,
            borderColor: isSelected ? "#ffc107" : stakeholderColor,
          }}
        >
          {st.name}
        </div>
      </div>
    );
  };

  const handleSelectEngagementCard = (card: EngagementCard) => {
    const isSingleUseExhausted =
      (card.max_plays_per_phase === 1 || card.stakeholder_selection_amount === -1) &&
      playedCardIdsInPhase.includes(card.id);

    if (attentionTokens < card.token_cost || isSingleUseExhausted) return;

    setPlayingCard(card);
  };

  const handleConfirmPlayCardStakeholders = (stakeholderIds: string[]) => {
    if (!playingCard) return;

    const nextTokens = attentionTokens - playingCard.token_cost;
    setAttentionTokens(nextTokens);
    setIsWaitingForResponse(true);

    const targetNames = stakeholderIds
      .map((id) => stakeholders[id]?.name || availableStakeholderList.find((s) => s.id === id)?.name || id)
      .join(", ");
    triggerPlayerSpeech(`🃏 Played "${playingCard.title}" to engage with ${targetNames}`);

    emit("intel:play_engagement_card", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
      card_id: playingCard.id,
      stakeholder_ids: stakeholderIds,
      attention_tokens: nextTokens,
    });

    if (stakeholderIds.length > 0) {
      setSelectedStakeholderId(stakeholderIds[0]);
    }

    setCardTargetedStakeholdersMap((prev) => ({
      ...prev,
      [playingCard.id]: [
        ...(prev[playingCard.id] || []),
        ...stakeholderIds,
      ],
    }));

    if (
      playingCard.max_plays_per_phase === 1 ||
      playingCard.stakeholder_selection_amount === -1
    ) {
      setPlayedCardIdsInPhase((prev) => [...prev, playingCard.id]);
    }

    setPlayingCard(null);
  };

  const handleConfirmPlayCardIntel = (targetIntel: IntelItem) => {
    if (!playingCard) return;

    const nextTokens = attentionTokens - playingCard.token_cost;
    setAttentionTokens(nextTokens);

    // Emit WebSocket verification request
    emit("intel:verify_item", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
      intel_item_id: targetIntel.requirement_id || targetIntel.id,
      attention_tokens: nextTokens,
    });

    triggerPlayerSpeech(
      `👑 Played Card: ${playingCard.title} on "${targetIntel.description}"`,
      {
        id: "user",
        message: `👑 Played Card: ${playingCard.title} on "${targetIntel.description}"`,
        ac_id: -1,
      }
    );
    triggerStakeholderSpeech(
      targetIntel.stakeholder_id || "system",
      `✅ Submitted "${targetIntel.description}" for direct verification.`,
      {
        id: targetIntel.stakeholder_id || "system",
        message: `✅ Submitted "${targetIntel.description}" for direct verification.`,
        ac_id: -1,
      }
    );

    if (
      playingCard.max_plays_per_phase === 1 ||
      playingCard.stakeholder_selection_amount === -1
    ) {
      setPlayedCardIdsInPhase((prev) => [...prev, playingCard.id]);
    }

    setPlayingCard(null);
  };



  const handleToggleIntelSelection = (id: string) => {
    if (selectedIntelIds.includes(id)) {
      setSelectedIntelIds(selectedIntelIds.filter((item) => item !== id));
    } else {
      if (selectedIntelIds.length < 3) {
        setSelectedIntelIds([...selectedIntelIds, id]);
      }
    }
  };

  const handleConfirmIntelMerge = (selectedIds: string[]) => {
    if (selectedIds.length === 0) return;
    setSelectedIntelIds(selectedIds);
    setIsGeneratingActionCard(true);
    setIsPitchModalOpen(false);
    emit("intel:generate_action_card", {
      intel_ids: selectedIds,
      phase_id: currentPhase,
      challenge_id: currentChallenge,
    });
  };

  const handleProgressToPitchDebate = () => {
    const card = createdActionCardForModal || pitchedActionCardState;
    setCreatedActionCardForModal(null);
    if (onContinue) {
      onContinue(card);
    }
  };

  const handleDropEngagementCard = (e: React.DragEvent) => {
    e.preventDefault();
    const cardId = e.dataTransfer.getData("engagementCardId") || e.dataTransfer.getData("cardId");
    if (!cardId) return;

    const cardToPlay = engagementCards.find((c) => c.id === cardId);
    if (cardToPlay) {
      handleSelectEngagementCard(cardToPlay);
    }
  };

  const bgIndex = (currentChallenge + currentPhase) % 4;


  const getTagBadgeColor = (type: string) => {
    switch (type) {
      case "requirement":
        return "bg-primary";
      case "negotiable_preference":
        return "bg-success";
      case "personal_friction":
        return "bg-warning text-dark";
      default:
        return "bg-secondary";
    }
  };

  return (
    <div className={styles.container}>
      {/* Main Content Area over Game Background Canvas */}
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

        {/* Layer 1: Default Game Page (Board Grid + Engagement Cards) */}
        <div
          className={`flex-grow-1 d-flex flex-column w-100 ${styles.helpBaseLayer} ${showHelp ? styles.helpBaseLayerDimmed : styles.helpBaseLayerActive
            }`}
        >
          {/* Main Board Grid: Left Column = Stakeholder Dossier, Right Column = Pitch Deck & Chat */}
          <div className="row g-2 align-items-stretch flex-grow-1 h-100">
            {/* LEFT COLUMN: Stakeholder Dossier (Constantly Open & Embedded) */}
            <div className="col-12 col-lg-4 d-flex flex-column h-100">
              <div className={`flex-grow-1 ${styles.dossierContainer}`}>
                <StakeholderDossier
                  isOpen={true}
                  canClose={false}
                  isEmbedded={true}
                  dossierData={dossierData || []}
                  activeStakeholderId={selectedStakeholderId || activeStakeholderId}
                  currentPhase={currentPhase}
                  currentChallenge={currentChallenge}
                  onClose={() => { }}
                />
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div
              className="col-12 col-lg-8 d-flex flex-column gap-2 h-100 rounded transition-all"
            >
              {/* Drop zone covers everything ABOVE the engagement cards */}
              <div
                className={`flex-grow-1 d-flex flex-column gap-2 overflow-hidden ${isDraggingCard ? styles.singleDropZoneActive : ""
                  }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(e) => {
                  setIsDraggingCard(false);
                  handleDropEngagementCard(e);
                }}
              >
                {/* 1. Above: Challenge Description Card (Full Width) */}
                <div className="flex-shrink-0">
                  <ChallengeDescriptionCard
                    challengeTitle={challengeTitle}
                    challengeDescription={challengeDescription}
                    challengeIntro={challengeIntro}
                    currentChallenge={currentChallenge}
                    challengeAmount={challengeAmount}
                  />
                </div>

                {/* 2+3. Middle Row: Side-by-Side Stakeholder Table (Left) + Chat History (Right) */}
                <div className="flex-grow-1 row g-2 align-items-stretch overflow-hidden">
                  {/* Left: Pitch Deck Boardroom Scene */}
                  <div
                    className={`${isChatMaximized ? "d-none" : "col-12 col-xl-7 col-lg-7"} d-flex flex-column align-items-center justify-content-center position-relative`}
                  >
                    <div className="w-100 d-flex justify-content-center">
                      <div className={styles.pitchDeckTable}>
                        {/* Top Row: Stakeholders sitting behind the table */}
                        {topStakeholders.length > 0 && (
                          <div className={styles.tableTopSeating}>
                            {topStakeholders.map(renderSeatedStakeholder)}
                          </div>
                        )}

                        {/* Middle Section: Left Seat, Central Pitch Action Card on Table, Right Seat */}
                        <div className={styles.tableCenterSurface}>
                          {/* Left Seat */}
                          <div className={styles.tableSideSeating}>
                            {leftStakeholders.map(renderSeatedStakeholder)}
                          </div>

                          {/* Center Tabletop: Evolving Proposal Drafting Desk */}
                          <div className={styles.tabletopCenterArea}>
                            <div
                              className={`${styles.actionCardSurface} ${pitchedActionCardState?.title ? styles.actionCardConfigured : styles.actionCardGreyedOut
                                }`}
                              onClick={() => !isGeneratingActionCard && setIsPitchModalOpen(true)}
                              title={
                                pitchedActionCardState?.title
                                  ? "Click to view or edit Action Card proposal"
                                  : "Click to select 1-3 Intel Items & build proposal"
                              }
                            >
                              {isGeneratingActionCard ? (
                                <div className="text-center py-2">
                                  <span className="spinner-border spinner-border-sm text-primary mb-2" role="status" />
                                  <p className="small text-white mb-0" style={{ fontSize: "0.74rem" }}>
                                    Synthesizing Action Card...
                                  </p>
                                </div>
                              ) : pitchedActionCardState?.title ? (
                                <div className={styles.actionCardInnerFrame}>
                                  {/* Header matching ActionCardCardComponent & Pitch Deck */}
                                  <div className={styles.actionCardHeader}>
                                    <span className={styles.actionCardCategoryLabel}>Action Card</span>
                                    <h6
                                      className={styles.actionCardTitle}
                                      title={pitchedActionCardState.title}
                                    >
                                      {pitchedActionCardState.title}
                                    </h6>
                                  </div>

                                  {/* Description Box */}
                                  <div className={styles.actionCardDescriptionBox}>
                                    <p
                                      className={styles.actionCardDescriptionPreview}
                                      title={pitchedActionCardState.description}
                                    >
                                      {pitchedActionCardState.description}
                                    </p>
                                  </div>
                                </div>
                              ) : intelItems.length > 0 ? (
                                <div className="text-center">
                                  <div className={styles.readyProposalIcon}>
                                    <Icon icon="ph:paper-plane-tilt-bold" />
                                  </div>
                                  <span className={`badge bg-success ${styles.actionCardBadge}`}>
                                    ✨ {intelItems.length} Intel Ready
                                  </span>
                                  <h6 className={`fw-bold text-light ${styles.actionCardProposalTitle}`}>Draft Proposal</h6>
                                  <button type="button" className={`btn btn-sm btn-success ${styles.actionCardDraftBtn}`}>
                                    📝 Assemble & Pitch ➔
                                  </button>
                                </div>
                              ) : (
                                <div className="text-center">
                                  <div className={styles.questionMarkIcon}>
                                    <Icon icon="ph:magnifying-glass-bold" />
                                  </div>
                                  <h6 className={`fw-bold ${styles.actionCardProposalTitle}`}>Investigation Phase</h6>
                                  <p className={styles.actionCardPrompt}>
                                    Play cards below to uncover stakeholder stances
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Right Seat */}
                          <div className={styles.tableSideSeating}>
                            {rightStakeholders.map((st) => renderSeatedStakeholder(st, true))}
                          </div>
                        </div>

                        {/* Table Edge Plaque */}
                        <div className={styles.tableEdgePlaque}>
                          <Icon icon="ph:presentation-chart-bold" />
                          <span>PITCH DECK</span>
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

                  {/* Right: Chat History */}
                  <div
                    className={`${isChatMaximized ? "col-12" : "col-12 col-xl-5 col-lg-5"} d-flex flex-column h-100`}
                  >
                    <div
                      className={`flex-grow-1 ${styles.chatWrapper} ${isChatMaximized ? styles.chatWrapperMaximized : ""}`}
                    >
                      <StakeholderInteractionArea
                        className="w-100 h-100"
                        chatMsgs={chatMsgs}
                        current_phase={currentPhase}
                        current_challenge={currentChallenge}
                        isEnabled={!isWaitingForResponse}
                        actionCards={[]}
                        onHoverCard={() => { }}
                        showStakeholderList={false}
                        showDialogueOptions={false}
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
                        />
                      </button>
                    </div>
                  </div>
                </div>

              </div>{/* end drop zone */}

              {/* 4. Dedicated Engagement Cards Component (OUTSIDE the drop zone) */}
              <div className="flex-shrink-0">
                <EngagementCards
                  attentionTokens={attentionTokens}
                  cards={engagementCards}
                  playedCardIds={playedCardIdsInPhase}
                  discoveredIntelCount={intelItems.length}
                  onOpenPitchModal={() => setIsPitchModalOpen(true)}
                  onSelectCard={handleSelectEngagementCard}
                  onDragCardStart={() => setIsDraggingCard(true)}
                  onDragCardEnd={() => setIsDraggingCard(false)}
                  isEnabled={!isWaitingForResponse}
                />
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
          challengeAmount={challengeAmount}
        />
      </div>

      {/* Engagement Card Play & Target Selection Modal */}
      {playingCard && (
        <EngagementCardTargetModal
          isOpen={Boolean(playingCard)}
          onClose={handleCloseCardModal}
          card={playingCard}
          attentionTokens={attentionTokens}
          stakeholders={stakeholders}
          availableStakeholderList={availableStakeholderList}
          isStakeholderActive={isStakeholderActiveInPhase}
          cardTargetedStakeholdersMap={cardTargetedStakeholdersMap}
          intelItems={intelItems}
          onConfirmStakeholders={handleConfirmPlayCardStakeholders}
          onConfirmIntel={handleConfirmPlayCardIntel}
          getStakeholderColor={getStakeholderColor}
          getTagBadgeColor={getTagBadgeColor}
        />
      )}

      {/* Action Card Pitch Modal */}
      {isPitchModalOpen && (
        <PitchActionCardModal
          isOpen={isPitchModalOpen}
          onClose={() => setIsPitchModalOpen(false)}
          intelItems={intelItems}
          initialSelectedIntelIds={selectedIntelIds}
          onConfirmMerge={handleConfirmIntelMerge}
          stakeholders={stakeholders}
          getStakeholderColor={getStakeholderColor}
          getTagBadgeColor={getTagBadgeColor}
          isGenerating={isGeneratingActionCard}
        />
      )}

      {/* Intel Verification Result PopUp Modal Component */}
      <IntelVerificationDialog
        isOpen={Boolean(verificationResultModal)}
        onClose={() => setVerificationResultModal(null)}
        resultData={verificationResultModal}
      />

      {/* Action Card Created Pop-Up Modal */}
      <ActionCardCreatedModal
        isOpen={Boolean(createdActionCardForModal)}
        actionCard={createdActionCardForModal}
        intelItems={intelItems}
        stakeholders={stakeholders}
        getStakeholderColor={getStakeholderColor}
        onProgressToPitchDebate={handleProgressToPitchDebate}
      />
    </div>
  );
}
