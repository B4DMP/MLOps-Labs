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
  const [selectedIntelIds, setSelectedIntelIds] = useState<string[]>([]);
  const [pitchedCardTitle, setPitchedCardTitle] = useState<string | null>(null);

  // Active Playing Engagement Card Modal State
  const [playingCard, setPlayingCard] = useState<EngagementCard | null>(null);
  const [isClosingCardModal, setIsClosingCardModal] = useState(false);
  const [selectedTargetStakeholderIds, setSelectedTargetStakeholderIds] = useState<string[]>([]);
  const [selectedTargetIntelId, setSelectedTargetIntelId] = useState<string | null>(null);

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

      if (payload.played_card_ids) {
        setPlayedCardIdsInPhase(payload.played_card_ids);
      }
      if (payload.card_targets) {
        setCardTargetedStakeholdersMap(payload.card_targets);
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
      if (payload.played_card_ids) {
        setPlayedCardIdsInPhase(payload.played_card_ids);
      }
      if (payload.card_targets) {
        setCardTargetedStakeholdersMap(payload.card_targets);
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
    };
  }, [subscribe, onUpdateIntelItems, setPlayedCardIdsInPhase, setCardTargetedStakeholdersMap]);

  const handleCloseCardModal = () => {
    setIsClosingCardModal(true);
    setTimeout(() => {
      setPlayingCard(null);
      setIsClosingCardModal(false);
    }, 200);
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

    // Rule: eng_3 (stakeholder_selection_amount == -1) auto-selects all stakeholders without a modal screen!
    if (card.stakeholder_selection_amount === -1) {
      const nextTokens = attentionTokens - card.token_cost;
      setAttentionTokens(nextTokens);
      setPlayedCardIdsInPhase((prev) => [...prev, card.id]);
      setIsWaitingForResponse(true);

      const activeStakeholders = availableStakeholderList.filter((st: any) => isStakeholderActiveInPhase(st));
      const activeIds = activeStakeholders.map((st: any) => st.id);

      emit("intel:play_engagement_card", {
        phase_id: currentPhase,
        challenge_id: currentChallenge,
        card_id: card.id,
        stakeholder_ids: activeIds,
        attention_tokens: nextTokens,
      });
      return;
    }

    // For eng_0, eng_1, eng_2, eng_4: open the target selection modal with background blur
    setPlayingCard(card);
    setSelectedTargetStakeholderIds([]);
    setSelectedTargetIntelId(null);
  };

  const handleToggleStakeholderTarget = (stId: string) => {
    if (!playingCard) return;
    const isAlreadyTargeted = cardTargetedStakeholdersMap[playingCard.id]?.includes(stId);
    if (isAlreadyTargeted) return;

    const requiredAmount = playingCard.stakeholder_selection_amount;

    if (selectedTargetStakeholderIds.includes(stId)) {
      setSelectedTargetStakeholderIds(selectedTargetStakeholderIds.filter((id) => id !== stId));
    } else {
      if (requiredAmount === 1) {
        setSelectedTargetStakeholderIds([stId]);
      } else if (selectedTargetStakeholderIds.length < requiredAmount) {
        setSelectedTargetStakeholderIds([...selectedTargetStakeholderIds, stId]);
      }
    }
  };

  const handleConfirmPlayCardModal = () => {
    if (!playingCard) return;

    if (playingCard.target_type === "intel" || playingCard.id === "eng_0") {
      if (!selectedTargetIntelId) return;

      const targetIntel = intelItems.find((item) => item.id === selectedTargetIntelId);
      if (!targetIntel) return;

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
    } else {
      const requiredAmount = playingCard.stakeholder_selection_amount;
      if (selectedTargetStakeholderIds.length !== requiredAmount) return;

      const nextTokens = attentionTokens - playingCard.token_cost;
      setAttentionTokens(nextTokens);
      setIsWaitingForResponse(true);

      const targetNames = selectedTargetStakeholderIds
        .map((id) => stakeholders[id]?.name || availableStakeholderList.find((s) => s.id === id)?.name || id)
        .join(", ");
      triggerPlayerSpeech(`🃏 Played "${playingCard.title}" to engage with ${targetNames}`);

      emit("intel:play_engagement_card", {
        phase_id: currentPhase,
        challenge_id: currentChallenge,
        card_id: playingCard.id,
        stakeholder_ids: selectedTargetStakeholderIds,
        attention_tokens: nextTokens,
      });

      if (selectedTargetStakeholderIds.length > 0) {
        setSelectedStakeholderId(selectedTargetStakeholderIds[0]);
      }

      setCardTargetedStakeholdersMap((prev) => ({
        ...prev,
        [playingCard.id]: [
          ...(prev[playingCard.id] || []),
          ...selectedTargetStakeholderIds,
        ],
      }));
    }

    if (
      playingCard.max_plays_per_phase === 1 ||
      playingCard.stakeholder_selection_amount === -1
    ) {
      setPlayedCardIdsInPhase((prev) => [...prev, playingCard.id]);
    }

    handleCloseCardModal();
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

  const handleConfirmIntelMerge = () => {
    if (selectedIntelIds.length === 0) return;
    const selectedItems = intelItems.filter((item) => selectedIntelIds.includes(item.id));
    const selectedTitles = selectedItems
      .map((item) => item.description.length > 25 ? item.description.slice(0, 25) + "..." : item.description)
      .join(" + ");
    const fullProposalTitle = `Action Proposal: ${selectedTitles}`;
    const pitchedCard = {
      id: `ac_pitched_${currentPhase}_${currentChallenge}`,
      ac_title: fullProposalTitle,
      title: fullProposalTitle,
      ac_descr: selectedItems.map((i) => i.description).join(" • "),
      description: selectedItems.map((i) => i.description).join(" • "),
      intel_items: selectedItems,
      selected_intel_ids: selectedIntelIds,
      stakeholder_ids: Array.from(new Set(selectedItems.map((i) => i.stakeholder_id).filter(Boolean))),
    };
    setPitchedCardTitle(fullProposalTitle);
    setIsPitchModalOpen(false);
    if (onContinue) {
      onContinue(pitchedCard);
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
                              className={`${styles.actionCardSurface} ${pitchedCardTitle
                                  ? styles.actionCardConfigured
                                  : intelItems.length > 0
                                    ? styles.actionCardReady
                                    : styles.actionCardBlueprint
                                }`}
                              onClick={() => setIsPitchModalOpen(true)}
                              title={
                                pitchedCardTitle
                                  ? "Click to edit your action card proposal"
                                  : intelItems.length > 0
                                    ? "Click to assemble 1-3 discovered intel items into a proposal"
                                    : "Play action cards below to gather intel first, then build your proposal here"
                              }
                            >
                              {pitchedCardTitle ? (
                                <div className="text-center">
                                  <span className={`badge bg-primary ${styles.actionCardBadge}`}>🃏 Pitched Base AC</span>
                                  <h6 className={`text-dark ${styles.actionCardProposalTitle}`}>{pitchedCardTitle}</h6>
                                  <p className={`text-muted ${styles.actionCardProposalSub}`}>Intel merged into proposal</p>
                                  <button type="button" className={`btn btn-sm btn-outline-primary ${styles.actionCardDraftBtn}`}>
                                    ✏️ Edit Proposal
                                  </button>
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

      {/* Engagement Card Play & Target Selection Modal with Blurred Backdrop */}
      {playingCard && (
        <div
          className={`${styles.modalBackdrop} ${isClosingCardModal ? styles.modalBackdropClosing : ""
            }`}
          onClick={handleCloseCardModal}
        >
          <div
            className={`${styles.intelModal} ${isClosingCardModal ? styles.intelModalClosing : ""
              }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className={styles.modalHeader}>
              <div className="d-flex align-items-center gap-2">
                <Icon icon={playingCard.icon || "ph:cards-bold"} style={{ fontSize: "1.8rem", color: "var(--engagement-accent)" }} />
                <h5 className="modal-title mb-0 fw-bold">{playingCard.title}</h5>
              </div>
              <button
                type="button"
                className="btn-close btn-close-white"
                onClick={handleCloseCardModal}
              ></button>
            </div>

            {/* Modal Body */}
            <div className={styles.modalBody}>
              {/* Overhauled Split Layout: Left Card Preview + Right Light Rules Container with Black Text */}
              <div className="row g-3 align-items-stretch mb-4">
                {/* Left Column: Fixed-Width Card Surface Preview (No Horizontal Stretch) */}
                <div className="col-12 col-md-auto d-flex justify-content-center align-items-stretch">
                  <div className={styles.centeredCardPreview} style={{ width: "300px", minWidth: "300px" }}>
                    <div className="d-flex justify-content-between w-100 mb-2">
                      <span
                        className="badge"
                        style={{
                          backgroundColor: "var(--engagement-muted)",
                          color: "var(--engagement-text)",
                          fontWeight: "bold",
                        }}
                      >
                        ENGAGEMENT CARD
                      </span>
                      <span
                        className="badge"
                        style={{
                          backgroundColor: "transparent",
                          border: "1px solid var(--token-color)",
                          color: "var(--token-color)",
                          fontWeight: "bold",
                        }}
                      >
                        <Icon icon="ph:coin-fill" className="me-1" style={{ color: "var(--token-color)" }} />
                        {playingCard.token_cost} Tokens
                      </span>
                    </div>
                    <Icon
                      icon={playingCard.icon || "ph:cards-bold"}
                      style={{ fontSize: "3.2rem", color: "var(--engagement-accent)" }}
                      className="my-2"
                    />
                    <h6 className="fw-bold mb-1 text-center" style={{ color: "var(--engagement-text)" }}>{playingCard.title}</h6>
                    <p className="small text-center mb-0" style={{ fontSize: "0.82rem", color: "var(--engagement-text)", opacity: 0.75 }}>
                      {playingCard.description}
                    </p>
                  </div>
                </div>

                {/* Right Column: Flex-Grow Light Rules & Mechanics Container */}
                <div className="col-12 col-md flex-grow-1">
                  <div className="card h-100 border-0 bg-light shadow-sm text-dark rounded-3 overflow-hidden">
                    {/* Header Banner */}
                    <div className="card-header bg-white border-bottom p-3 d-flex align-items-center justify-content-between">
                      <div className="d-flex align-items-center gap-2">
                        <Icon icon="ph:notebook-bold" className="text-primary" style={{ fontSize: "1.4rem" }} />
                        <h6 className="fw-bold text-dark mb-0 fs-6">Card Mechanics & Rules</h6>
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        <span className="small text-muted fw-semibold">Selection:</span>
                        <span
                          className={`badge ${playingCard.target_type === "intel" || playingCard.id === "eng_0"
                            ? selectedTargetIntelId
                              ? "bg-success"
                              : "bg-secondary"
                            : selectedTargetStakeholderIds.length === playingCard.stakeholder_selection_amount
                              ? "bg-success"
                              : "bg-secondary"
                            } fs-6 px-3 py-1.5`}
                        >
                          {playingCard.target_type === "intel" || playingCard.id === "eng_0"
                            ? selectedTargetIntelId
                              ? "1 / 1 Selected"
                              : "0 / 1 Selected"
                            : `${selectedTargetStakeholderIds.length} / ${playingCard.stakeholder_selection_amount} Selected`}
                        </span>
                      </div>
                    </div>

                    {/* Body Content with Deep Black Text */}
                    <div className="card-body p-3 text-dark">
                      {/* Instruction Callout */}
                      <div className="p-2 mb-3 bg-white rounded border border-primary-subtle d-flex align-items-center gap-2">
                        <Icon icon="ph:cursor-click-bold" className="text-primary" style={{ fontSize: "1.2rem" }} />
                        <span className="fw-bold text-dark small">
                          {playingCard.target_type === "intel" || playingCard.id === "eng_0"
                            ? "Click an unverified intel item below to select it for verification:"
                            : `Click to select exactly ${playingCard.stakeholder_selection_amount} stakeholder${playingCard.stakeholder_selection_amount > 1 ? "s" : ""
                            } below:`}
                        </span>
                      </div>

                      {/* Structured Rules List */}
                      <div className="small text-dark">
                        <ul className="mb-0 ps-3 text-dark" style={{ lineHeight: "1.5" }}>
                          {playingCard.target_type === "intel" || playingCard.id === "eng_0" ? (
                            <>
                              <li className="mb-1 text-dark">
                                <strong className="text-dark">Direct Intel Verification:</strong> Upgrades 1 unverified intel item's certainty level to{" "}
                                <span className="badge bg-success">Verified</span> in your Stakeholder Dossier.
                              </li>
                              <li className="mb-1 text-dark">
                                <strong className="text-dark">Selectability Rule:</strong> Already verified intel items are disabled and cannot be selected twice.
                              </li>
                            </>
                          ) : (
                            <>
                              <li className="mb-1 text-dark">
                                <strong className="text-dark">Stakeholder Targeting:</strong> Select exactly{" "}
                                <strong className="text-dark">{playingCard.stakeholder_selection_amount}</strong> stakeholder
                                {playingCard.stakeholder_selection_amount > 1 ? "s" : ""} to prompt specific dialogue responses & requirements.
                              </li>
                              <li className="mb-1 text-dark">
                                <strong className="text-dark">Single Target Limit:</strong> Stakeholders already targeted by{" "}
                                <em className="text-dark">"{playingCard.title}"</em> in this phase cannot be selected again.
                              </li>
                              {playingCard.intel_reveal_count !== undefined && playingCard.intel_reveal_count > 0 && (
                                <li className="mb-1 text-dark">
                                  <strong className="text-dark">Intel Revelation:</strong> Uncovers up to{" "}
                                  <strong className="text-dark">{playingCard.intel_reveal_count}</strong> random requirement
                                  {playingCard.intel_reveal_count > 1 ? "s" : ""} per targeted stakeholder.
                                </li>
                              )}
                            </>
                          )}
                          <li className="text-dark">
                            <strong className="text-dark">Resource Cost:</strong> Spends <strong className="text-dark">{playingCard.token_cost} Attention Tokens</strong>.
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Target Selection Screen Options */}
              {playingCard.target_type === "intel" || playingCard.id === "eng_0" ? (
                /* Intel Item Selection Grid */
                <div className="row g-3">
                  {intelItems.map((item) => {
                    const isVerified = (item.intel_type || "").toLowerCase().includes("verified");
                    const isSelected = selectedTargetIntelId === item.id;
                    const isSelectable = !isVerified;
                    const catType = item.categorized_type || "requirement";
                    const categoryLabel = catType.replace(/_/g, " ");

                    return (
                      <div key={item.id} className="col-12 col-md-6">
                        <div
                          className={`${styles.intelItemCard} ${isSelected ? styles.intelItemSelected : ""
                            } ${!isSelectable ? styles.intelItemDisabled : ""}`}
                          onClick={() => {
                            if (isSelectable) {
                              setSelectedTargetIntelId(item.id);
                            }
                          }}
                        >
                          <div className="d-flex justify-content-between align-items-start mb-2">
                            <span className={`badge ${getTagBadgeColor(catType)}`}>
                              {categoryLabel}
                            </span>
                            <span
                              className={`badge ${isVerified ? "bg-success" : "bg-warning text-dark"
                                }`}
                            >
                              {item.intel_type}
                            </span>
                          </div>
                          <h6 className="fw-bold text-dark mb-1">{item.description}</h6>
                          {item.stakeholder_name && (
                            <p className="small text-muted mb-0" style={{ fontSize: "0.75rem" }}>
                              Source: {item.stakeholder_name}
                            </p>
                          )}
                          {!isSelectable && (
                            <span className="badge bg-secondary mt-2 align-self-start">
                              <Icon icon="ph:check-circle-fill" className="me-1" /> Already Verified
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Stakeholder Selection Grid (Only Active Stakeholders in currentPhase) */
                <div className="row g-3">
                  {availableStakeholderList
                    .filter((st: any) => isStakeholderActiveInPhase(st))
                    .map((st) => {
                      const isSelected = selectedTargetStakeholderIds.includes(st.id);
                      const isAlreadyTargetedByThisCard = cardTargetedStakeholdersMap[playingCard.id]?.includes(st.id);
                      const isSelectable = !isAlreadyTargetedByThisCard;
                      const stColor = getStakeholderColor(st);

                      return (
                        <div key={st.id} className="col-12 col-md-4">
                          <div
                            className={`${styles.stakeholderTargetCard} ${isSelected ? styles.stakeholderTargetSelected : ""
                              } ${!isSelectable ? styles.intelItemDisabled : ""}`}
                            style={{
                              cursor: isSelectable ? "pointer" : "not-allowed",
                              opacity: isSelectable ? 1 : 0.55,
                            }}
                            onClick={() => {
                              if (isSelectable) {
                                handleToggleStakeholderTarget(st.id);
                              }
                            }}
                          >
                            <div
                              className="rounded-circle overflow-hidden d-flex align-items-center justify-content-center flex-shrink-0"
                              style={{
                                width: "48px",
                                height: "48px",
                                backgroundColor: isSelectable ? stColor : "#6c757d",
                                border: `1.5px solid ${isSelectable ? stColor : "#6c757d"}`,
                              }}
                            >
                              <StakeholderAvatarComponent
                                avatar={stakeholders[st.id]?.avatar || (st as any).avatar}
                                stakeholderColor={stColor}
                                isFramed={true}
                                play_blink_animation={false}
                                size="100%"
                                title={st.name}
                              />
                            </div>
                            <div className="flex-grow-1">
                              <div className="d-flex justify-content-between align-items-start mb-1">
                                <h6 className="fw-bold mb-0 text-dark me-1">{st.name}</h6>
                                <div className="d-flex align-items-center gap-1 flex-shrink-0">
                                  {isSelected && (
                                    <Icon
                                      icon="ph:check-circle-fill"
                                      style={{ color: "#ffc107", fontSize: "1.3rem" }}
                                    />
                                  )}
                                  {isAlreadyTargetedByThisCard && (
                                    <span title={`Already targeted by ${playingCard.title}`}>
                                      <Icon
                                        icon="ph:lock-key-fill"
                                        style={{ color: "#dc3545", fontSize: "1.2rem" }}
                                      />
                                    </span>
                                  )}
                                </div>
                              </div>
                              <p className="small text-secondary mb-0" style={{ lineHeight: "1.4", wordBreak: "break-word" }}>
                                {(st as any).role_description || (st as any).responsibilities || "Stakeholder"}
                              </p>
                              {isAlreadyTargetedByThisCard && (
                                <span className="badge bg-danger mt-2 d-inline-block" style={{ fontSize: "0.65rem" }}>
                                  Already targeted by "{playingCard.title}""
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className={styles.modalFooter}>
              <button
                className="btn btn-secondary rounded-pill px-4"
                onClick={handleCloseCardModal}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary rounded-pill px-4 fw-bold"
                disabled={
                  playingCard.target_type === "intel" || playingCard.id === "eng_0"
                    ? !selectedTargetIntelId
                    : selectedTargetStakeholderIds.length !==
                    playingCard.stakeholder_selection_amount
                }
                onClick={handleConfirmPlayCardModal}
              >
                <Icon icon="ph:lightning-fill" className="me-1" />
                Confirm & Play Card ({playingCard.token_cost})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Card Pitch Modal with Blurred Backdrop */}
      {isPitchModalOpen && (
        <div className={styles.modalBackdrop} onClick={() => setIsPitchModalOpen(false)}>
          <div className={styles.intelModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h5 className="modal-title mb-0 fw-bold">
                🎯 Assemble Proposal & Enter Pitch Debate
              </h5>
              <button
                type="button"
                className="btn-close btn-close-white"
                onClick={() => setIsPitchModalOpen(false)}
              ></button>
            </div>

            <div className={styles.modalBody}>
              <p className="text-secondary small mb-3">
                Select <b>1 to 3 Intel Items</b> to merge into your Action Card proposal. Confirming your proposal will conclude the intelligence gathering phase and advance the game to the Pitch Debate in the boardroom.
              </p>

              <div className="d-flex justify-content-between align-items-center mb-3">
                <span className="fw-bold text-dark">Available Dossier Intel Items</span>
                <span
                  className={`badge ${selectedIntelIds.length > 0 ? "bg-success" : "bg-secondary"
                    } fs-6`}
                >
                  Selected: {selectedIntelIds.length} / 3
                </span>
              </div>

              <div className="row g-3">
                {intelItems.map((item) => {
                  const isSelected = selectedIntelIds.includes(item.id);
                  return (
                    <div key={item.id} className="col-12 col-md-6">
                      <div
                        className={`${styles.intelItemCard} ${isSelected ? styles.intelItemSelected : ""
                          }`}
                        onClick={() => handleToggleIntelSelection(item.id)}
                      >
                        {(() => {
                          const catType = item.categorized_type || (item as any).type || "requirement";
                          const certaintyLabel = item.intel_type || (item as any).certainty || "unconfirmed";
                          const isVerified = (certaintyLabel || "").toLowerCase().includes("verified");

                          return (
                            <>
                              <div className="d-flex justify-content-between align-items-start mb-2">
                                <span className={`badge ${getTagBadgeColor(catType)}`}>
                                  {catType.replace(/_/g, " ")}
                                </span>
                                <div className="d-flex align-items-center gap-2">
                                  <span className={`badge ${isVerified ? "bg-success" : "bg-warning text-dark"}`}>
                                    {certaintyLabel}
                                  </span>
                                  <input
                                    type="checkbox"
                                    className="form-check-input"
                                    checked={isSelected}
                                    onChange={() => { }}
                                  />
                                </div>
                              </div>
                              <h6 className="fw-bold text-dark mb-1">{item.description}</h6>
                              {item.stakeholder_name && (
                                <p className="small text-muted mb-0">
                                  Source: {item.stakeholder_name}
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-3 bg-light border-top d-flex justify-content-end gap-2">
              <button
                className="btn btn-secondary rounded-pill px-4"
                onClick={() => setIsPitchModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-success rounded-pill px-4 fw-bold d-inline-flex align-items-center gap-2"
                disabled={selectedIntelIds.length === 0}
                onClick={handleConfirmIntelMerge}
              >
                <Icon icon="ph:paper-plane-tilt-bold" />
                Submit Proposal & Start Pitch Debate ({selectedIntelIds.length}) ➔
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Intel Verification Result PopUp Modal Component */}
      <IntelVerificationDialog
        isOpen={Boolean(verificationResultModal)}
        onClose={() => setVerificationResultModal(null)}
        resultData={verificationResultModal}
      />
    </div>
  );
}
