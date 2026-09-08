import { useState, useContext, useEffect, useRef } from "react";
import { Icon } from "@iconify/react";
import type { ActionCard } from "../types/ActionCard";
import type { EngagementCard } from "../types/EngagementCard";
import { StakeholderContext } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import styles from "./online_intel_gathering.module.css";
import StakeholderDossier, { type StakeholderDossierEntry } from "./StakeholderDossier";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import StakeholderInteractionArea, { type ChatMsg, type RevealedIntel } from "./StakeholderInteractionArea";
import PerformanceDashboard from "./PerformanceDashboard";
import EngagementCards from "./EngagementCards";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import IntelVerificationDialog, { type IntelVerificationResultData } from "./IntelVerificationDialog";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import ChallengeDescriptionCard from "./ChallengeDescriptionCard";
import EngagementCardTargetModal from "./EngagementCardTargetModal";
import PitchActionCardModal from "./PitchActionCardModal";
import ActionCardDetailModal from "./ActionCardDetailModal";
import ActionCardCardComponent from "./ActionCardCardComponent";

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
  const [highlightedIntelId, setHighlightedIntelId] = useState<string | null>(null);
  const inspectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [isActionCardModalOpen, setIsActionCardModalOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [selectedIntelIds, setSelectedIntelIds] = useState<string[]>(propsPitchedActionCard?.intel_ids || []);
  const [isGeneratingActionCard, setIsGeneratingActionCard] = useState(false);
  const [pitchedActionCardState, setPitchedActionCardState] = useState<ActionCard | null>(propsPitchedActionCard || null);

  useEffect(() => {
    if (propsPitchedActionCard) {
      setPitchedActionCardState(propsPitchedActionCard);
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

  const handleInspectIntel = (intel: RevealedIntel, stakeholderId?: string) => {
    let targetIntelId = intel.id || intel.description || "";
    let targetStakeholderId = intel.stakeholder_id || stakeholderId;

    if (dossierData && dossierData.length > 0) {
      for (const st of dossierData) {
        const matchingItem = st.intel_items?.find(
          (item) =>
            (intel.id && item.id === intel.id) ||
            (intel.description && item.description === intel.description)
        );
        if (matchingItem) {
          targetIntelId = matchingItem.id || targetIntelId;
          targetStakeholderId = targetStakeholderId || st.stakeholder_id;
          break;
        }
      }
    }

    if (targetStakeholderId) {
      setSelectedStakeholderId(targetStakeholderId);
    }

    if (inspectTimerRef.current) {
      clearTimeout(inspectTimerRef.current);
    }
    // Briefly reset to ensure React effect fires even if the same intel item is clicked again
    setHighlightedIntelId(null);
    setTimeout(() => {
      setHighlightedIntelId(targetIntelId);
      inspectTimerRef.current = setTimeout(() => {
        setHighlightedIntelId((curr) => (curr === targetIntelId ? null : curr));
      }, 5000);
    }, 10);
  };


  // Clear speech timers on unmount
  useEffect(() => {
    return () => {
      speechQueueRef.current = [];
      isProcessingQueueRef.current = false;
      if (activeSpeechTimerRef.current) clearTimeout(activeSpeechTimerRef.current);
      if (activeFadeTimerRef.current) clearTimeout(activeFadeTimerRef.current);
      if (activeNextTimerRef.current) clearTimeout(activeNextTimerRef.current);
      if (inspectTimerRef.current) clearTimeout(inspectTimerRef.current);
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
        if (payload.action_card.intel_ids) {
          setSelectedIntelIds(payload.action_card.intel_ids);
        }
        if (onUpdatePitchedCard) {
          onUpdatePitchedCard(payload.action_card);
        }
        if (onContinue) {
          onContinue(payload.action_card);
        }
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
      intel_item_id: targetIntel.id,
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
          <div className="row g-2 align-items-stretch flex-grow-1 h-100" style={{ minHeight: 0 }}>
            {/* LEFT COLUMN: Stakeholder Dossier (Constantly Open & Embedded) */}
            <div className="col-12 col-lg-4 d-flex flex-column h-100 position-relative" style={{ minHeight: 0, minWidth: 0, zIndex: 1 }}>
              <div className={`flex-grow-1 ${styles.dossierContainer}`}>
                <StakeholderDossier
                  isOpen={true}
                  canClose={false}
                  isEmbedded={true}
                  dossierData={dossierData || []}
                  activeStakeholderId={selectedStakeholderId || activeStakeholderId}
                  highlightedIntelId={highlightedIntelId}
                  currentPhase={currentPhase}
                  currentChallenge={currentChallenge}
                  onClose={() => { }}
                />
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div
              className={`col-12 col-lg-8 d-flex flex-column gap-2 h-100 rounded transition-all position-relative ${
                isAnySpeechActive ? styles.overflowVisibleSpeech : "overflow-hidden"
              }`}
              style={{ minHeight: 0, minWidth: 0, zIndex: isAnySpeechActive ? 1500 : 1 }}
            >
              {/* Drop zone covers everything ABOVE the engagement cards */}
              <div
                className={`flex-grow-1 row g-2 align-items-stretch position-relative ${
                  isAnySpeechActive ? styles.overflowVisibleSpeech : "overflow-hidden"
                } ${
                  isDraggingCard ? styles.singleDropZoneActive : ""
                }`}
                style={{ minHeight: 0, zIndex: isAnySpeechActive ? 1600 : 1 }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(e) => {
                  setIsDraggingCard(false);
                  handleDropEngagementCard(e);
                }}
              >
                {/* Left: Challenge Card (moved above Pitch Deck Table) + Pitch Deck Boardroom Scene */}
                <div
                  className={`${styles.boardCol} ${
                    isChatMaximized ? styles.boardColCollapsed : ""
                  } ${isAnySpeechActive ? styles.boardColSpeaking : ""} d-flex flex-column justify-content-between h-100 position-relative`}
                  style={{ minHeight: 0, zIndex: isAnySpeechActive ? 1700 : 1 }}
                >
                  {/* 1. Challenge Description Card in the free space above the Pitch Deck Table */}
                  <div className="w-100 flex-shrink-0 mb-1">
                    <ChallengeDescriptionCard
                      challengeTitle={challengeTitle}
                      challengeDescription={challengeDescription}
                      challengeIntro={challengeIntro}
                      currentChallenge={currentChallenge}
                      challengeAmount={challengeAmount}
                    />
                  </div>

                  {/* 2. Boardroom Pitch Deck Table Scene */}
                  <div
                    className="w-100 d-flex flex-column align-items-center justify-content-center flex-grow-1 pt-3 position-relative"
                    style={{ zIndex: isAnySpeechActive ? 1800 : 2, overflow: isAnySpeechActive ? "visible" : undefined }}
                  >
                    <div
                      className={`${styles.pitchDeckTable} ${
                        isAnySpeechActive ? styles.pitchDeckTableSpeaking : ""
                      }`}
                    >
                      {/* Top Row: Stakeholders sitting behind the table */}
                      {topStakeholders.length > 0 && (
                        <div
                          className={`${styles.tableTopSeating} ${
                            topStakeholders.some((st) => activeSpeakingState?.stakeholderId === st.id)
                              ? styles.seatingSpeaking
                              : ""
                          }`}
                        >
                          {topStakeholders.map((st) => renderSeatedStakeholder(st))}
                        </div>
                      )}

                      {/* Middle Section: Left Seat, Central Pitch Action Card on Table, Right Seat */}
                      <div className={`${styles.tableCenterSurface} ${
                        [...leftStakeholders, ...rightStakeholders].some((st) => activeSpeakingState?.stakeholderId === st.id)
                          ? styles.tableCenterSurfaceSpeaking
                          : ""
                      }`}>
                        {/* Left Seat */}
                        <div
                          className={`${styles.tableSideSeating} ${
                            leftStakeholders.some((st) => activeSpeakingState?.stakeholderId === st.id)
                              ? styles.seatingSpeaking
                              : ""
                          }`}
                        >
                          {leftStakeholders.map((st) => renderSeatedStakeholder(st))}
                        </div>

                        {/* Center Tabletop: Pitch Deck Surface or Minimized Action Card */}
                        <div className={styles.tabletopCenterArea}>
                          {isGeneratingActionCard ? (
                            <div className="text-center py-2">
                              <span className="spinner-border spinner-border-sm text-primary mb-1" role="status" />
                              <p className="small text-white mb-0" style={{ fontSize: "0.74rem" }}>
                                Synthesizing Action Card...
                              </p>
                            </div>
                          ) : pitchedActionCardState?.title ? (
                            <ActionCardCardComponent
                              card={pitchedActionCardState}
                              intelItems={intelItems}
                              stakeholders={stakeholders}
                              getStakeholderColor={getStakeholderColor}
                              isMinimized={true}
                              isInteractive={true}
                              onClick={() => setIsActionCardModalOpen(true)}
                            />
                          ) : (
                            <div
                              className={styles.tableCenterPlaque}
                              onClick={() => intelItems.length > 0 && setIsPitchModalOpen(true)}
                              title={
                                intelItems.length > 0
                                  ? `${intelItems.length} Intel items collected - Click to assemble proposal`
                                  : "Pitch Deck Table"
                              }
                            >
                              <Icon icon="ph:presentation-chart-bold" className={styles.tableCenterPlaqueIcon} />
                              <span>PITCH DECK</span>
                            </div>
                          )}
                        </div>

                        {/* Right Seat */}
                        <div
                          className={`${styles.tableSideSeating} ${
                            rightStakeholders.some((st) => activeSpeakingState?.stakeholderId === st.id)
                              ? styles.seatingSpeaking
                              : ""
                          }`}
                        >
                          {rightStakeholders.map((st) => renderSeatedStakeholder(st, true))}
                        </div>
                      </div>

                      {/* Lower Border Interaction Area */}
                      <div
                        className={styles.tableLowerInteractionArea}
                        title="Spend Attention Tokens to play Engagement Cards below and uncover Intel. Gather at least 1 item to assemble an action proposal for the Pitch Debate."
                      >
                        {/* Status Badges: Tokens & Intel close together */}
                        <div className={styles.statChipsRowCentered}>
                          <div
                            className={styles.statChipToken}
                            title={`${attentionTokens} Attention Tokens available`}
                          >
                            <Icon icon="ph:coin-fill" className={styles.tokenStatIcon} />
                            <span className={styles.statNumber}>{attentionTokens}</span>
                            <span className={styles.statLabel}>Tokens</span>
                          </div>

                          <div
                            className={styles.statChipIntel}
                            title={`${intelItems.length} Intel items collected`}
                          >
                            <Icon icon="ph:files-bold" className={styles.intelStatIcon} />
                            <span className={styles.statNumber}>{intelItems.length}</span>
                            <span className={styles.statLabel}>Intel</span>
                          </div>
                        </div>

                        {/* Explainer Guidance */}
                        <p className={styles.pitchExplainerText}>
                          Spend <strong className={styles.explainerToken}>Attention Tokens</strong> to play <strong className={styles.explainerCard}>Engagement Cards</strong> below and uncover <strong className={styles.explainerIntel}>Intel</strong>. Gather at least 1 item to assemble an action proposal for the <strong className={styles.explainerPitch}>Pitch Debate</strong>.
                        </p>

                        {/* Assemble and Pitch Action Button */}
                        <button
                          type="button"
                          className={`${styles.actionButton} ${
                            intelItems.length === 0 || isGeneratingActionCard ? styles.actionButtonDisabled : ""
                          } ${isSpeechBubbleCoveringButton ? styles.actionButtonBlocked : ""}`}
                          disabled={
                            intelItems.length === 0 || isGeneratingActionCard || isSpeechBubbleCoveringButton
                          }
                          onClick={() => setIsPitchModalOpen(true)}
                          title={
                            isSpeechBubbleCoveringButton
                              ? "Action currently blocked by active speech message (click speech bubble to skip)"
                              : isGeneratingActionCard
                              ? "Synthesizing Action Card and progressing to Pitch Debate..."
                              : intelItems.length > 0
                              ? `Combine ${intelItems.length} discovered intel items into an action proposal`
                              : "Play engagement cards below to uncover at least 1 intel item before pitching"
                          }
                        >
                          {isGeneratingActionCard ? (
                            <>
                              <span className="spinner-border spinner-border-sm me-2" role="status" />
                              <span>Synthesizing & Progressing to Debate...</span>
                            </>
                          ) : (
                            <>
                              <Icon icon={intelItems.length > 0 ? "ph:paper-plane-tilt-bold" : "ph:lock-key-fill"} />
                              <span>
                                {intelItems.length > 0
                                  ? `Assemble & Pitch Proposal (${intelItems.length} Intel) ➔`
                                  : "Assemble & Pitch (Need ≥ 1 Intel)"}
                              </span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Active Player Speech Bubble on Pitch Deck */}
                      {activePlayerSpeakingState && (
                        <div
                          className={`${styles.playerTableSpeechBubble} ${
                            activePlayerSpeakingState.isClosing ? styles.playerTableSpeechBubbleClosing : ""
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
                  className={`${styles.chatCol} ${
                    isChatMaximized ? styles.chatColMaximized : ""
                  } d-flex flex-column h-100 overflow-hidden position-relative`}
                  style={{ minHeight: 0, zIndex: 1 }}
                >
                  {/* When conversation history is maximized, the challenge fills across the whole upper horizontal space */}
                  <div
                    className={`${styles.maximizedChallengeWrapper} ${
                      isChatMaximized ? styles.maximizedChallengeWrapperVisible : ""
                    }`}
                  >
                    <ChallengeDescriptionCard
                      challengeTitle={challengeTitle}
                      challengeDescription={challengeDescription}
                      challengeIntro={challengeIntro}
                      currentChallenge={currentChallenge}
                      challengeAmount={challengeAmount}
                    />
                  </div>

                  <div
                    className={`flex-grow-1 ${styles.chatWrapper} ${isChatMaximized ? styles.chatWrapperMaximized : ""}`}
                    style={{ minHeight: 0 }}
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
                      onInspectIntel={handleInspectIntel}
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
              </div>{/* end drop zone */}

              {/* Dedicated Engagement Cards Deck (OUTSIDE the drop zone) */}
              <div className="w-100 flex-shrink-0" style={{ minWidth: 0, maxWidth: "100%" }}>
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

      {/* Action Card Detail Modal (Maximized View) */}
      <ActionCardDetailModal
        isOpen={isActionCardModalOpen}
        onClose={() => setIsActionCardModalOpen(false)}
        actionCard={pitchedActionCardState}
        intelItems={intelItems}
        stakeholders={stakeholders}
        getStakeholderColor={getStakeholderColor}
      />
    </div>
  );
}
