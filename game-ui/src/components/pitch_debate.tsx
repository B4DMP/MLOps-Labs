import { useState, useContext, useEffect, useLayoutEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { motion, AnimatePresence } from "motion/react";
import type { ActionCard } from "../types/ActionCard";
import { StakeholderContext, type EmotionGatingInfo, type EmotionGatingDimension } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import { PhasesContext } from "./PhaseProvider";
import { useSettings } from "./SettingsProvider";
import { useSpeech } from "./useSpeech";
import { slotForStakeholderVoice } from "../utils/speech";
import styles from "./pitch_debate.module.css";
import StakeholderDossier, { type StakeholderDossierEntry, type StakeholderBuyInInfo, type IntelEntry } from "./StakeholderDossier";
import OfflineIntelGathering, { type IntelArtifact } from "./offline_intel_gathering";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import StakeholderInteractionArea, { type ChatMsg, type RevealedIntel } from "./StakeholderInteractionArea";
import SpokenText from "./SpokenText";
import PerformanceDashboard from "./PerformanceDashboard";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import ChallengeDescriptionCard from "./ChallengeDescriptionCard";
import ActionCardCardComponent from "./ActionCardCardComponent";
import ComposeActionProposalModal, {
  type AtomicChange,
  dedupeAtomicChanges,
} from "./ComposeActionProposalModal";
import { describeAtomicChange, findGraphTarget } from "../utils/graphOptions";
import type { IntelItem } from "./PitchActionCardModal";
import EngagementCards from "./EngagementCards";
import type { EngagementCard } from "../types/EngagementCard";
import EngagementCardTargetModal from "./EngagementCardTargetModal";
import GatherConversationPanel from "./GatherConversationPanel";
import IntelVerificationDialog, { type IntelVerificationResultData } from "./IntelVerificationDialog";
import EventLogModal from "./EventLogModal";
import VetoDialog, { type VetoInfo } from "./VetoDialog";
import { useGameWebSocket, useWebSocketEvent } from "../services/websocket/useGameWebSocket";
import type { GatherOptionKind, GatherStatePayload } from "../types/Gather";
import type { GameEventPayload } from "../types/GameEvent";
import type { IntelTag } from "../types/IntelTag";
import type { StakeholderAvatar } from "../types/StakeholderAvatar";
import { faceForEmotionState } from "../utils/emotionFace";
import EmotionEmoji from "./EmotionEmoji";
import { FADE_TRANSITION } from "../utils/transitions";

// Intel readiness thresholds for the pitch deck's intel badge: how much of this phase's intel
// has to be verified before pitching is worth it (ratio of verified / total for the phase).
const READY_YELLOW = 0.35;
const READY_GREEN = 0.6;

export interface PitchDebateProps {
  currentPhase: number;
  currentChallenge: number;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  challengeAmount?: number;
  onEndPitch?: (passed: boolean, card?: ActionCard | null) => void;
  engagementCards?: EngagementCard[];
  attentionTokens?: number;
  onAttentionTokensChange?: (n: number) => void;
  playedCardIdsInPhase?: string[];
  onPlayedCardIdsChange?: Dispatch<SetStateAction<string[]>>;
  chatMsgs?: ChatMsg[];
  onChatMsgsChange?: Dispatch<SetStateAction<ChatMsg[]>>;
  cardTargetedStakeholdersMap?: Record<string, string[]>;
  onCardTargetedStakeholdersMapChange?: Dispatch<SetStateAction<Record<string, string[]>>>;
  onUpdateIntelItems?: (items: any[], fullDossier?: any[]) => void;
  dossierData?: StakeholderDossierEntry[];
  /** Asks the embedded dossier to show this stakeholder - set when the player follows a
   *  component owner link out of the Performance Dashboard. */
  focusStakeholderId?: string;
  /** Asks the embedded dossier to jump to and pop this intel item - set when the player
   *  follows an intel reference out of the Performance Dashboard. */
  focusIntelId?: string;
  onOpenPhaseBriefing?: () => void;
  onPerformanceToggle?: () => void;
  isPerformanceOpen?: boolean;
  onSettingsToggle?: () => void;
  isSettingsOpen?: boolean;
}

interface PitchStatePayload {
  stage: "PREPARE" | "PITCHED" | "DONE" | "OBJECT" | "COMMIT";
  atomic_changes?: AtomicChange[];
  allowed_targets?: string[];
  upstream_map?: Record<string, string[]>;
  card_item_ids: string[];
  trade_off_branches?: Record<string, "X" | "Y">;
  available_items: any[];
  card: any[];
  predictions: any[];
  boundary_warnings: any[];
  reads: Array<{
    stakeholder_id: string;
    power: string;
    alignment: number;
    emotions: number;
    buy_in: number | null;
    band: "green" | "amber" | "red";
    boundary_violated: boolean;
    emotional_state: string;
  }>;
  predicted_outcome: "PASS" | "SOFT_PASS" | "VETO";
  feedback_messages?: Array<{
    id: string;
    stakeholder_id: string;
    text: string;
    kind: string;
  }>;
  intel_total?: number;
  intel_verified?: number;
  outcome?: string | null;
  veto_info?: VetoInfo | null;
  /** How many Escalation Points are left this playthrough (D15): 3 to start, never regenerated
   * within a run. Spent by the Veto Breaker in `VetoDialog`. */
  escalation_points?: number;
}

export default function PitchDebate({
  currentPhase,
  currentChallenge,
  challengeTitle = "Deploy High-Performance Pipeline",
  challengeDescription = "Align with project stakeholders on system requirements and deployment constraints.",
  challengeIntro = "Strategic Alignment & Intelligence Gathering",
  challengeAmount = 3,
  onEndPitch,
  engagementCards: engagementCardsProp,
  attentionTokens: attentionTokensProp,
  onAttentionTokensChange,
  playedCardIdsInPhase: playedCardIdsProp,
  onPlayedCardIdsChange,
  chatMsgs: chatMsgsProp,
  onChatMsgsChange,
  cardTargetedStakeholdersMap: cardTargetedMapProp,
  onCardTargetedStakeholdersMapChange,
  onUpdateIntelItems,
  dossierData = [],
  focusStakeholderId,
  focusIntelId,
  onOpenPhaseBriefing,
  onPerformanceToggle,
  isPerformanceOpen = false,
  onSettingsToggle,
  isSettingsOpen = false,
}: PitchDebateProps) {
  const { emit, subscribe } = useGameWebSocket();
  const { settings } = useSettings();
  const { speak: speakTts, cancel: cancelTts } = useSpeech();
  const stakeholderCtx = useContext(StakeholderContext);
  const stakeholders = (stakeholderCtx?.stakeholders || {}) as Record<
    string,
    {
      name?: string;
      avatar?: StakeholderAvatar;
      stakeholder_color?: string;
      emotional_state?: string;
      metric_id?: string;
      power?: string;
      interest?: string;
      voice?: string;
    }
  >;
  const setStakeholders = stakeholderCtx?.setStakeholders;
  const metricsCtx = useContext(MetricsContext);
  const metrics = metricsCtx?.metrics || {};
  const { phases } = useContext(PhasesContext);

  // ── Modals & Views ──
  const [selectedStakeholderId, setSelectedStakeholderId] = useState<string>("requirements_reuben");
  const [showDashboard, setShowDashboard] = useState(false);
  const [isPitchModalOpen, setIsPitchModalOpen] = useState(false);
  // Set when a specific change row on the pitch deck's card is clicked, rather than the card
  // generally - tells the composer which target's inspector to open straight to.
  const [composerFocusTargetId, setComposerFocusTargetId] = useState<string | undefined>(undefined);
  const [isChatMaximized, setIsChatMaximized] = useState(false);
  const [highlightedIntelId, setHighlightedIntelId] = useState<string | null>(null);
  const [eventsOpen, setEventsOpen] = useState(false);
  const [events, setEvents] = useState<GameEventPayload[]>([]);
  const [singleArtifactForReview, setSingleArtifactForReview] = useState<IntelArtifact | null>(null);

  // ── Boardroom Hover Info Tag (ported from offline_intel_gathering.tsx / StakeholderDossier.tsx's
  // showInfoTag) - a flip-in tag anchored to whatever's hovered/focused, replacing plain `title`
  // tooltips on the boardroom table's chips, plaque and action buttons. ──
  const [infoTag, setInfoTag] = useState<{
    label: string;
    detail?: string;
    top: number;
    anchorX: number;
    left: number;
  } | null>(null);
  const infoTagRef = useRef<HTMLDivElement>(null);

  const showInfoTag = (e: React.SyntheticEvent, label: string, detail?: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const anchorX = rect.left + rect.width / 2;
    setInfoTag({ label, detail, top: rect.bottom + 6, anchorX, left: anchorX });
  };
  const hideInfoTag = () => setInfoTag(null);

  useLayoutEffect(() => {
    if (!infoTag || !infoTagRef.current) return;
    const box = infoTagRef.current.getBoundingClientRect();
    const half = box.width / 2;
    const left = Math.min(Math.max(infoTag.anchorX, 6 + half), window.innerWidth - 6 - half);
    setInfoTag((prev) => (prev && prev.left !== left ? { ...prev, left } : prev));
  }, [infoTag?.anchorX, infoTag?.label, infoTag?.detail]);

  useEffect(() => {
    if (!infoTag) return;
    const handleScroll = () => hideInfoTag();
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [infoTag]);

  // Follow an owner link from the dashboard: only on a change, so the player's own choice
  // of page is never overridden.
  const prevFocusStakeholderRef = useRef<string | undefined>(focusStakeholderId);
  useEffect(() => {
    if (focusStakeholderId && focusStakeholderId !== prevFocusStakeholderRef.current) {
      setSelectedStakeholderId(focusStakeholderId);
    }
    prevFocusStakeholderRef.current = focusStakeholderId;
  }, [focusStakeholderId]);

  // Same, for an intel reference followed from the dashboard: jump the dossier to it and
  // let it pop, same as clicking one of this screen's own references does.
  const prevFocusIntelRef = useRef<string | undefined>(focusIntelId);
  useEffect(() => {
    if (focusIntelId && focusIntelId !== prevFocusIntelRef.current) {
      setHighlightedIntelId(focusIntelId);
      setTimeout(() => setHighlightedIntelId(null), 3000);
    }
    prevFocusIntelRef.current = focusIntelId;
  }, [focusIntelId]);

  const handleOpenArtifact = (item: IntelEntry) => {
    if (!item.artifact && !item.artifact_type) return;
    const art: IntelArtifact = {
      id: item.artifact?.id || `art_${item.id}`,
      requirement_id: item.artifact?.requirement_id || item.id,
      stakeholder_id: item.artifact?.stakeholder_id || item.debug?.stakeholder_id || selectedStakeholderId,
      stakeholder_name: item.artifact?.stakeholder_name || item.debug?.stakeholder_id || "",
      stakeholder_role: item.artifact?.stakeholder_role || "",
      artifact_type: item.artifact?.artifact_type || item.artifact_type || "document",
      content: item.artifact?.content || item.debug?.artifact?.content || item.description,
      categorized_type: item.categorized_type,
      is_known: item.artifact?.is_known ?? (item.source === "public_record"),
      debug: item.debug,
    };
    setSingleArtifactForReview(art);
  };

  // ── Pitch State from Backend ──
  const [pitchState, setPitchState] = useState<PitchStatePayload | null>(null);
  const [atomicChanges, setAtomicChanges] = useState<AtomicChange[]>([]);
  const [selectedIntelIds, setSelectedIntelIds] = useState<string[]>([]);
  const [isPitchEvaluating, setIsPitchEvaluating] = useState(false);
  const [evaluatingPitchConvId, setEvaluatingPitchConvId] = useState<string | null>(null);
  const [vetoInfo, setVetoInfo] = useState<VetoInfo | null>(null);
  const [isVetoDialogOpen, setIsVetoDialogOpen] = useState(false);
  // Escalation Points (D15): 3 per playthrough, never regenerated. Kept only from `pitch:state`,
  // which always carries the live count, so this never drifts from what the server actually has.
  const [escalationPoints, setEscalationPoints] = useState<number | null>(null);
  const [isBreakingVeto, setIsBreakingVeto] = useState(false);
  const [isCommittedLocked, setIsCommittedLocked] = useState(false);
  const hasAutoTransitionedRef = useRef(false);

  // ── Engagement Card & Tokens State ──
  const [localTokens, setLocalTokens] = useState(20);
  const [localPlayedIds, setLocalPlayedIds] = useState<string[]>([]);
  const [localChatMsgs, setLocalChatMsgs] = useState<ChatMsg[]>([]);
  const [localCardTargetedMap, setLocalCardTargetedMap] = useState<Record<string, string[]>>({});
  const [playingCard, setPlayingCard] = useState<EngagementCard | null>(null);
  const [isDraggingCard, setIsDraggingCard] = useState<boolean>(false);
  const [verificationModal, setVerificationModal] = useState<IntelVerificationResultData | null>(null);
  const [conversations, setConversations] = useState<Record<string, GatherStatePayload>>({});
  const [busyConversationKeys, setBusyConversationKeys] = useState<Set<string>>(new Set());

  const cards = engagementCardsProp || [];
  const tokens = attentionTokensProp !== undefined ? attentionTokensProp : localTokens;
  const setTokens = onAttentionTokensChange ?? setLocalTokens;
  const playedIds = playedCardIdsProp !== undefined ? playedCardIdsProp : localPlayedIds;
  const setPlayedIds = onPlayedCardIdsChange ?? setLocalPlayedIds;
  const chatMsgsState = chatMsgsProp !== undefined ? chatMsgsProp : localChatMsgs;
  const setChatMsgsState = onChatMsgsChange ?? setLocalChatMsgs;
  const cardTargetedMap = cardTargetedMapProp !== undefined ? cardTargetedMapProp : localCardTargetedMap;
  const setCardTargetedMap = onCardTargetedStakeholdersMapChange ?? setLocalCardTargetedMap;

  const base = useMemo(
    () => ({ phase_id: currentPhase, challenge_id: currentChallenge }),
    [currentPhase, currentChallenge]
  );

  // ── Speech Queue System ──
  interface SpeechQueueItem {
    id: string;
    type: "player" | "stakeholder";
    stakeholderId?: string;
    message: string;
    chatMsg?: ChatMsg;
    emotionalState?: string;
    facialExpression?: string;
    emotionValues?: Record<string, number>;
    /** Which dimensions are gating this message's emotional state, and the full bucketed set -
     *  carried alongside emotionValues so the dossier's hover composition card updates in step
     *  with the emoji/face when this message is revealed, instead of lagging behind on whatever
     *  gating info happened to arrive last over the websocket. */
    emotionDimensions?: EmotionGatingInfo;
    emotionDimensionsFull?: EmotionGatingDimension[];
    buyIn?: number;
  }
  const speechQueueRef = useRef<SpeechQueueItem[]>([]);
  const isProcessingQueueRef = useRef<boolean>(false);
  const pendingDismissKeysRef = useRef<Set<string>>(new Set());
  const activeSpeechTimerRef = useRef<any>(null);
  const activeFadeTimerRef = useRef<any>(null);
  const activeNextTimerRef = useRef<any>(null);
  // Minimum-read-time floor and an absolute safety ceiling for the "wait for narration to
  // actually finish" gating below - see processSpeechQueue.
  const activeFloorTimerRef = useRef<any>(null);
  const activeHardCapTimerRef = useRef<any>(null);

  const [activeSpeakingState, setActiveSpeakingState] = useState<{
    stakeholderId: string;
    message: string;
    isClosing?: boolean;
  } | null>(null);

  const [activePlayerSpeakingState, setActivePlayerSpeakingState] = useState<{
    message: string;
    isClosing?: boolean;
  } | null>(null);
  const [isSpeechInProgress, setIsSpeechInProgress] = useState<boolean>(false);
  // Sentence-highlight position for whichever stakeholder line is currently being narrated (see
  // SpokenText), and a reference to that exact chat-history entry so only it renders live.
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number | null>(null);
  const [liveChatMsg, setLiveChatMsg] = useState<ChatMsg | null>(null);

  const isAnySpeechActive = Boolean(activeSpeakingState || activePlayerSpeakingState);
  const isSpeechBubbleCoveringButton = Boolean(activePlayerSpeakingState);
  const isPitchDebating = isPitchEvaluating || isSpeechInProgress || isAnySpeechActive;

  const isSpeechActive = () =>
    isProcessingQueueRef.current ||
    speechQueueRef.current.length > 0 ||
    Boolean(activeSpeakingState || activePlayerSpeakingState);

  const clearSpeechTimers = () => {
    if (activeFadeTimerRef.current) clearTimeout(activeFadeTimerRef.current);
    if (activeSpeechTimerRef.current) clearTimeout(activeSpeechTimerRef.current);
    if (activeNextTimerRef.current) clearTimeout(activeNextTimerRef.current);
    if (activeFloorTimerRef.current) clearTimeout(activeFloorTimerRef.current);
    if (activeHardCapTimerRef.current) clearTimeout(activeHardCapTimerRef.current);
    cancelTts();
  };

  // Shared tail for "a line is done" - used both by the normal queue advance below and by
  // playChatMessage, which re-narrates any chat-history line (player or stakeholder) without
  // re-entering the queue.
  const finishActiveSpeech = (kind: "stakeholder" | "player" = "stakeholder") => {
    if (kind === "player") {
      setActivePlayerSpeakingState((prev) => (prev ? { ...prev, isClosing: true } : null));
    } else {
      setActiveSpeakingState((prev) => (prev ? { ...prev, isClosing: true } : null));
    }
    activeSpeechTimerRef.current = setTimeout(() => {
      if (kind === "player") {
        setActivePlayerSpeakingState(null);
      } else {
        setActiveSpeakingState(null);
      }
      setActiveSentenceIndex(null);
      setLiveChatMsg(null);
      isProcessingQueueRef.current = false;
      activeNextTimerRef.current = setTimeout(processSpeechQueue, 150);
    }, 400);
  };

  const processSpeechQueue = () => {
    if (isProcessingQueueRef.current) return;
    if (speechQueueRef.current.length === 0) {
      setActiveSpeakingState(null);
      setActiveSentenceIndex(null);
      setLiveChatMsg(null);
      setActivePlayerSpeakingState(null);
      isProcessingQueueRef.current = false;
      setIsSpeechInProgress(false);
      if (pendingDismissKeysRef.current.size > 0) {
        const keysToDismiss = Array.from(pendingDismissKeysRef.current);
        pendingDismissKeysRef.current.clear();
        setTimeout(() => {
          keysToDismiss.forEach((k) => dismissConversation(k));
        }, 400);
      }
      return;
    }

    setIsSpeechInProgress(true);
    const nextItem = speechQueueRef.current.shift();
    if (!nextItem) return;

    isProcessingQueueRef.current = true;
    clearSpeechTimers();

    if (nextItem.chatMsg) {
      setChatMsgsState((prev) => [...prev, nextItem.chatMsg!]);
    }

    if (nextItem.type === "player") {
      setActiveSpeakingState(null);
      setActiveSentenceIndex(null);
      setLiveChatMsg(null);
      // Auto-skip: the chat message and any state updates above already landed, so the line
      // isn't lost - only the timed bubble and its hold are skipped. A minimal timeout (rather
      // than recursing synchronously) keeps this on the same "next tick" rhythm as a real turn,
      // so isSpeechActive()'s brief true window stays intact for callers that gate on it.
      if (settings.auto_skip_conversations) {
        setActivePlayerSpeakingState(null);
        setActiveSentenceIndex(null);
        isProcessingQueueRef.current = false;
        activeNextTimerRef.current = setTimeout(processSpeechQueue, 50);
        return;
      }
      setActivePlayerSpeakingState({ message: nextItem.message, isClosing: false });
      setActiveSentenceIndex(null);
      // The bubble stays open at least this long (its old, pre-narration duration - what it
      // still gets when muted, since speak() then calls onEnd synchronously), and does not
      // start closing until narration actually finishes speaking, however long that takes -
      // fixing both a spoken line getting cut off and the bubble outlasting a short one.
      const floorMs = Math.min(5000, Math.max(2500, Math.round(nextItem.message.length * 40)));
      let speechDone = false;
      let floorDone = false;
      let settled = false;
      const proceedWhenReady = () => {
        if (settled || !speechDone || !floorDone) return;
        settled = true;
        setActivePlayerSpeakingState((prev) => (prev ? { ...prev, isClosing: true } : null));
        activeSpeechTimerRef.current = setTimeout(() => {
          setActivePlayerSpeakingState(null);
          setActiveSentenceIndex(null);
          isProcessingQueueRef.current = false;
          activeNextTimerRef.current = setTimeout(processSpeechQueue, 150);
        }, 400);
      };
      speakTts(nextItem.message, {
        slot: "player",
        onSentence: ({ index }) => setActiveSentenceIndex(index),
        onEnd: () => {
          speechDone = true;
          proceedWhenReady();
        },
      });
      activeFloorTimerRef.current = setTimeout(() => {
        floorDone = true;
        proceedWhenReady();
      }, floorMs);
      activeHardCapTimerRef.current = setTimeout(() => {
        speechDone = true;
        proceedWhenReady();
      }, 12000);
    } else {
      setActivePlayerSpeakingState(null);
      if (nextItem.stakeholderId) {
        setSelectedStakeholderId(nextItem.stakeholderId);
      }

      // Update that stakeholder's emotional state, facial expression, avatar, emotionValues,
      // and the dossier's hover-reveal dimensions now that their message is displayed! The last
      // two (emotion_dimensions / emotion_dimensions_full) have to move in lockstep with
      // emotional_state here rather than being left for some other websocket handler to catch up
      // on later - they're what feeds the composition card under the emotion badge, and without
      // this it kept showing whichever gating info happened to arrive last instead of the
      // dimensions behind the message actually on screen.
      if (
        nextItem.stakeholderId &&
        (nextItem.emotionalState ||
          nextItem.facialExpression ||
          nextItem.emotionValues ||
          nextItem.emotionDimensions ||
          nextItem.emotionDimensionsFull) &&
        setStakeholders
      ) {
        setStakeholders((prev: Record<string, any>) => {
          const stId = nextItem.stakeholderId!;
          const current = prev[stId];
          if (!current) return prev;
          const newEmotionalState = nextItem.emotionalState || current.emotional_state || "neutral";
          const newFace = nextItem.facialExpression || faceForEmotionState(newEmotionalState);
          return {
            ...prev,
            [stId]: {
              ...current,
              emotional_state: newEmotionalState,
              facial_expression: newFace,
              emotion: newFace,
              emotion_values: nextItem.emotionValues || current.emotion_values,
              emotionValues: nextItem.emotionValues || current.emotionValues,
              emotion_dimensions: nextItem.emotionDimensions || current.emotion_dimensions,
              emotion_dimensions_full: nextItem.emotionDimensionsFull || current.emotion_dimensions_full,
              avatar: {
                ...(current.avatar || {}),
                face: newFace,
                emotion: newFace,
              },
            },
          };
        });
      }

      if (settings.auto_skip_conversations) {
        setActiveSpeakingState(null);
        setActiveSentenceIndex(null);
        setLiveChatMsg(null);
        isProcessingQueueRef.current = false;
        activeNextTimerRef.current = setTimeout(processSpeechQueue, 50);
        return;
      }

      setActiveSpeakingState({
        stakeholderId: nextItem.stakeholderId || "",
        message: nextItem.message,
        isClosing: false,
      });
      setActiveSentenceIndex(null);
      setLiveChatMsg(nextItem.chatMsg || null);
      // Same floor-plus-actual-completion gating as the player branch above: the bubble stays
      // open at least this long, and only starts closing once narration truly finishes.
      const floorMs = Math.min(12000, Math.max(4500, Math.round(nextItem.message.length * 60)));
      let speechDone = false;
      let floorDone = false;
      let settled = false;
      const proceedWhenReady = () => {
        if (settled || !speechDone || !floorDone) return;
        settled = true;
        finishActiveSpeech();
      };
      speakTts(nextItem.message, {
        slot: slotForStakeholderVoice(stakeholders[nextItem.stakeholderId || ""]?.voice),
        seed: nextItem.stakeholderId,
        onSentence: ({ index }) => setActiveSentenceIndex(index),
        onEnd: () => {
          speechDone = true;
          proceedWhenReady();
        },
      });
      activeFloorTimerRef.current = setTimeout(() => {
        floorDone = true;
        proceedWhenReady();
      }, floorMs);
      activeHardCapTimerRef.current = setTimeout(() => {
        speechDone = true;
        proceedWhenReady();
      }, 20000);
    }
  };

  const skipCurrentSpeech = () => {
    clearSpeechTimers();
    setActiveSpeakingState(null);
    setActiveSentenceIndex(null);
    setLiveChatMsg(null);
    setActivePlayerSpeakingState(null);
    isProcessingQueueRef.current = false;
    if (speechQueueRef.current.length === 0) {
      setIsSpeechInProgress(false);
    }
    processSpeechQueue();
  };

  // Narrates any stakeholder chat-history line on demand - the currently playing one (from its
  // own "replay" button) or any other past line (from its hover-revealed "play" button) - without
  // touching the queue. Interrupts whatever else is currently speaking, if anything.
  const playChatMessage = (msg: ChatMsg) => {
    const isPlayerMsg = !msg.id || msg.id === "user";
    const stakeholderId = isPlayerMsg
      ? undefined
      : msg.id && msg.id !== "system" && msg.id !== "__environment__"
        ? msg.id
        : msg.stakeholder_id;
    if (!isPlayerMsg && !stakeholderId) return;

    clearSpeechTimers();
    isProcessingQueueRef.current = true;
    setActiveSentenceIndex(null);
    setLiveChatMsg(msg);
    if (isPlayerMsg) {
      setActiveSpeakingState(null);
      setActivePlayerSpeakingState({ message: msg.message, isClosing: false });
    } else {
      setActivePlayerSpeakingState(null);
      setActiveSpeakingState({ stakeholderId: stakeholderId!, message: msg.message, isClosing: false });
    }

    const floorMs = Math.min(12000, Math.max(4500, Math.round(msg.message.length * 60)));
    let speechDone = false;
    let floorDone = false;
    let settled = false;
    const proceedWhenReady = () => {
      if (settled || !speechDone || !floorDone) return;
      settled = true;
      finishActiveSpeech(isPlayerMsg ? "player" : "stakeholder");
    };
    speakTts(msg.message, {
      slot: isPlayerMsg ? "player" : slotForStakeholderVoice(stakeholders[stakeholderId!]?.voice),
      seed: isPlayerMsg ? undefined : stakeholderId,
      onSentence: ({ index }) => setActiveSentenceIndex(index),
      onEnd: () => {
        speechDone = true;
        proceedWhenReady();
      },
    });
    activeFloorTimerRef.current = setTimeout(() => {
      floorDone = true;
      proceedWhenReady();
    }, floorMs);
    activeHardCapTimerRef.current = setTimeout(() => {
      speechDone = true;
      proceedWhenReady();
    }, 20000);
  };

  const triggerStakeholderSpeech = (
    stakeholderId: string,
    message: string,
    chatMsg?: ChatMsg,
    meta?: {
      emotionalState?: string;
      facialExpression?: string;
      emotionValues?: Record<string, number>;
      emotionDimensions?: EmotionGatingInfo;
      emotionDimensionsFull?: EmotionGatingDimension[];
      buyIn?: number;
    }
  ) => {
    if (!stakeholderId || !message) return;
    setIsSpeechInProgress(true);
    speechQueueRef.current.push({
      id: Math.random().toString(36).substring(2, 9),
      type: "stakeholder",
      stakeholderId,
      message,
      chatMsg,
      emotionalState: meta?.emotionalState,
      facialExpression: meta?.facialExpression,
      emotionValues: meta?.emotionValues,
      emotionDimensions: meta?.emotionDimensions,
      emotionDimensionsFull: meta?.emotionDimensionsFull,
      buyIn: meta?.buyIn,
    });
    processSpeechQueue();
  };

  const triggerPlayerSpeech = (message: string, chatMsg?: ChatMsg) => {
    if (!message) return;
    setIsSpeechInProgress(true);
    speechQueueRef.current.push({
      id: Math.random().toString(36).substring(2, 9),
      type: "player",
      message,
      chatMsg,
    });
    processSpeechQueue();
  };

  useEffect(() => () => clearSpeechTimers(), []);

  // ── WebSocket Subscriptions ──
  const [graphState, setGraphState] = useState<any>(null);
  useWebSocketEvent<any>("graph:state", (state) => {
    setGraphState(state);
  });
  useEffect(() => {
    emit("graph:state_request", { phase_id: currentPhase === 0 ? 1 : currentPhase });
  }, [emit, currentPhase]);

  useWebSocketEvent<PitchStatePayload>("pitch:state", (payload) => {
    setPitchState(payload);
    if (payload.escalation_points !== undefined) {
      setEscalationPoints(payload.escalation_points);
    }
    if (payload.stage === "PITCHED" || payload.stage === "DONE") {
      setIsPitchEvaluating(false);
      setEvaluatingPitchConvId(null);
    }
    if (payload.atomic_changes) {
      // A proposal saved before a target's dedup could land here still carrying two slots for
      // the same target (see dedupeAtomicChanges) - cleaned up as it enters the client.
      setAtomicChanges(dedupeAtomicChanges(payload.atomic_changes));
    }
    if (payload.card_item_ids) {
      setSelectedIntelIds(payload.card_item_ids);
    }

    if (payload.stage === "DONE") {
      if (payload.outcome === "VETO") {
        setIsCommittedLocked(false);
        // A refused Veto Breaker (out of points, or a race with the button) lands back here
        // with the same still-standing veto: stop showing the button as busy.
        setIsBreakingVeto(false);
        if (payload.veto_info) {
          setVetoInfo(payload.veto_info);
          setIsVetoDialogOpen(true);
        } else {
          const vetoRead = payload.reads?.find((r) => r.power === "high" && (r.boundary_violated || (r.buy_in ?? 1) < 0.4)) || payload.reads?.[0];
          if (vetoRead) {
            const stObj = stakeholders[vetoRead.stakeholder_id];
            setVetoInfo({
              stakeholder_id: vetoRead.stakeholder_id,
              stakeholder_name: stObj?.name || vetoRead.stakeholder_id,
              power: vetoRead.power,
              message: "I am using my executive authority to veto this action proposal as it violates critical requirements.",
              boundary_violated: vetoRead.boundary_violated,
            });
            setIsVetoDialogOpen(true);
          }
        }
      } else if (payload.outcome === "PASS" || payload.outcome === "SOFT_PASS") {
        setIsCommittedLocked(true);
        // Covers both an ordinary pass and a broken veto (outcome is "PASS" either way): the
        // dialog has nothing left to say once the card is through.
        setIsVetoDialogOpen(false);
        setIsBreakingVeto(false);
        if (!hasAutoTransitionedRef.current && onEndPitch) {
          hasAutoTransitionedRef.current = true;
          setTimeout(() => {
            onEndPitch(true);
          }, 500);
        }
      }
    } else {
      setIsCommittedLocked(false);
      hasAutoTransitionedRef.current = false;
    }
  });

  useEffect(() => {
    emit("pitch:state", base);
    emit("log:history", {});
  }, [emit, base]);

  useWebSocketEvent<{ events: GameEventPayload[] }>("log:history", (payload) => {
    setEvents(payload.events || []);
  });
  useWebSocketEvent<{ events: GameEventPayload[] }>("log:events", (payload) => {
    if (!payload.events?.length) return;
    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.seq));
      return [...prev, ...payload.events.filter((e) => !seen.has(e.seq))];
    });
  });

  useWebSocketEvent<GatherStatePayload>("gather:state", (payload) => {
    const key = `${payload.card_id}:${payload.stakeholder_id}`;
    setBusyConversationKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setConversations((prev) => ({ ...prev, [key]: payload }));

    if (payload.closed || payload.turns_left <= 0) {
      if (isSpeechActive()) {
        pendingDismissKeysRef.current.add(key);
      } else {
        setTimeout(() => {
          dismissConversation(key);
        }, 1000);
      }
    } else {
      pendingDismissKeysRef.current.delete(key);
    }
    emit("pitch:state", base);
  });

  useEffect(() => {
    if (!subscribe) return;

    const handleEngagementFinished = (payload: any) => {
      if (!payload) return;
      if (payload.played_engagement_card_ids) setPlayedIds(payload.played_engagement_card_ids);
      if (payload.engagement_card_targets) {
        setCardTargetedMap((prev) => ({ ...prev, ...payload.engagement_card_targets }));
      }
      if (payload.dossier && onUpdateIntelItems) {
        const directIntel = (payload.dossier as any[]).flatMap((entry) =>
          (entry.intel_items || []).map((intel: any) => ({
            ...intel,
            stakeholder_id: entry.stakeholder_id,
            stakeholder_name: entry.name,
          }))
        );
        onUpdateIntelItems(directIntel, payload.dossier);
      }
      emit("pitch:state", base);
    };

    const unsubs = [
      subscribe("intel:verified_res", (p: any) => {
        if (p?.status === "success") {
          setVerificationModal({
            wasCorrect: p.old_categorized_type === p.true_categorized_type,
            oldType: p.old_categorized_type,
            trueType: p.true_categorized_type,
            description: p.description,
            stakeholderName: p.stakeholder_name,
          });
        }
      }),
      subscribe("intel:message_received", (p: any) => {
        if (!p) return;
        const convId = p.conversation_id || "default";
        if (convId.startsWith("pitch_")) {
          setIsPitchEvaluating(false);
          setEvaluatingPitchConvId(null);
        }
        if (
          p.type === "telemetry_message" ||
          p.type === "system_message" ||
          p.stakeholder_id === "system" ||
          p.stakeholder_id === "__environment__"
        ) {
          const msg: ChatMsg = {
            id: "__environment__",
            message: p.message,
            ac_id: -1,
            revealed_intel: p.revealed_intel_items || [],
            conversation_id: convId,
          };
          setChatMsgsState((prev) => [...prev, msg]);
        } else if (p.type === "stakeholder_message" && p.message && p.stakeholder_id) {
          const msg: ChatMsg = {
            id: p.stakeholder_id,
            message: p.message,
            ac_id: -1,
            revealed_intel: p.revealed_intel_items || [],
            conversation_id: convId,
            emotional_state: p.emotional_state,
            facial_expression: p.facial_expression,
          };
          triggerStakeholderSpeech(p.stakeholder_id, p.message, msg, {
            emotionalState: p.emotional_state,
            facialExpression: p.facial_expression,
            emotionValues: p.emotion_values,
            emotionDimensions: p.emotion_dimensions,
            emotionDimensionsFull: p.emotion_dimensions_full,
            buyIn: p.buy_in,
          });
        } else if (p.type === "player_message" && p.message) {
          const msg: ChatMsg = {
            id: "user",
            message: p.message,
            ac_id: -1,
            conversation_id: convId,
          };
          triggerPlayerSpeech(p.message, msg);
        }
      }),
      subscribe("intel:engagement_complete", handleEngagementFinished),
      subscribe("intel:engagement_response", handleEngagementFinished),
      subscribe("intel:dossier_data", (p: any) => {
        if (!p) return;
        if (p.played_engagement_card_ids) setPlayedIds(p.played_engagement_card_ids);
        if (p.engagement_card_targets) {
          setCardTargetedMap((prev) => ({ ...prev, ...p.engagement_card_targets }));
        }
        if (p.dossier && onUpdateIntelItems) {
          const directIntel = (p.dossier as any[]).flatMap((entry) =>
            (entry.intel_items || []).map((intel: any) => ({
              ...intel,
              stakeholder_id: entry.stakeholder_id,
              stakeholder_name: entry.name,
            }))
          );
          onUpdateIntelItems(directIntel, p.dossier);
        }
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, emit, base, onUpdateIntelItems]);

  // ── Stakeholder Seating & Room Configuration ──
  const roomIds = useMemo(() => {
    const fromPhase = phases[currentPhase]?.stakeholder_power_interest?.map((s) => s.stakeholder_id) || [];
    if (fromPhase.length > 0) return fromPhase;
    return (dossierData || []).filter((st) => !st.is_challenge_intel).map((st) => st.stakeholder_id);
  }, [phases, currentPhase, dossierData]);

  const activeStakeholders = useMemo(() => {
    return roomIds
      .filter((id) => stakeholders[id])
      .map((id) => ({
        id,
        name: stakeholders[id]?.name || id,
        avatar: stakeholders[id]?.avatar || {},
        stakeholder_color: stakeholders[id]?.stakeholder_color,
        metric_id: stakeholders[id]?.metric_id,
        power: stakeholders[id]?.power,
        interest: stakeholders[id]?.interest,
      }));
  }, [roomIds, stakeholders]);

  const topStakeholders = activeStakeholders.length >= 3 ? activeStakeholders.slice(0, 2) : [];
  const remainingStakeholders = activeStakeholders.length >= 3 ? activeStakeholders.slice(2) : activeStakeholders;
  const leftStakeholders = remainingStakeholders.filter((_, idx) => idx % 2 === 0);
  const rightStakeholders = remainingStakeholders.filter((_, idx) => idx % 2 !== 0);

  const getStakeholderColor = (st: any): string => {
    if (st?.stakeholder_color && st.stakeholder_color !== "#888888" && st.stakeholder_color !== "#ffffff") {
      return st.stakeholder_color;
    }
    if (st?.metric_id && metrics[st.metric_id]?.metric_color) {
      return metrics[st.metric_id].metric_color;
    }
    return st?.stakeholder_color || "#38bdf8";
  };

  // Buy-in Map for Dossier
  const buyInInfoMap = useMemo((): Record<string, StakeholderBuyInInfo> => {
    if (!pitchState) return {};

    const matchingPitchIds = chatMsgsState
      .map((m) => m.conversation_id || "")
      .filter((id) => id.startsWith("pitch_"));
    
    const pitchConvSet = Array.from(new Set(matchingPitchIds));
    const latestExistingPitchConvId = pitchConvSet.sort((a, b) => {
      const numA = parseInt(a.replace("pitch_", ""), 10) || 0;
      const numB = parseInt(b.replace("pitch_", ""), 10) || 0;
      return numB - numA;
    })[0] || null;

    const activePitchConvId = evaluatingPitchConvId || latestExistingPitchConvId;

    return Object.fromEntries(
      pitchState.reads.map((r) => {
        const normAlign = Math.max(0, Math.min(1, 0.5 * ((r.alignment ?? 0) + 1.0)));
        const cardScore = r.boundary_violated ? 0 : 0.6 * normAlign;
        const emotionScore = 0.4 * (r.emotions ?? 0.5);
        const total = r.buy_in ?? Math.min(1.0, Math.max(0.0, cardScore + emotionScore));

        const hasSpokenInPitch = Boolean(
          activePitchConvId &&
          chatMsgsState.some(
            (m) =>
              m.conversation_id === activePitchConvId &&
              (m.id === r.stakeholder_id || m.id === stakeholders[r.stakeholder_id]?.name)
          )
        );

        // Mirrors scoring.py VETO_THRESHOLD / OBJECTION_THRESHOLD.
        const threshold = r.power === "high" ? 0.4 : 0.3;

        return [
          r.stakeholder_id,
          {
            threshold,
            actionCardScore: cardScore,
            emotionScore: emotionScore,
            total: total,
            isPersuaded: r.band === "green",
            blocks: total < threshold,
            currentEmotion: hasSpokenInPitch
              ? (stakeholders[r.stakeholder_id]?.emotional_state || r.emotional_state || "neutral")
              : (stakeholders[r.stakeholder_id]?.emotional_state || "neutral"),
            boundaryViolated: r.boundary_violated,
            isRevealed: hasSpokenInPitch,
          },
        ];
      })
    );
  }, [pitchState, stakeholders, chatMsgsState, evaluatingPitchConvId]);

  // Derived Intel Items from Dossier & Available Items
  const allIntelItems: IntelItem[] = useMemo(() => {
    const dossierMap = new Map<string, any>();
    (dossierData || []).forEach((st) => {
      (st.intel_items || []).forEach((i) => {
        dossierMap.set(i.id, {
          id: i.id,
          type: (i.categorized_type || "driver") as IntelTag,
          categorized_type: i.categorized_type,
          intel_type: i.intel_type,
          source: i.source,
          description: i.description,
          stakeholder_id: st.is_challenge_intel ? undefined : st.stakeholder_id,
          stakeholder_name: st.is_challenge_intel ? undefined : st.name,
          branch_x: i.categorized_type === "trade_off" ? i.branch_x : undefined,
          branch_y: i.categorized_type === "trade_off" ? i.branch_y : undefined,
        });
      });
    });

    if (pitchState?.available_items && pitchState.available_items.length > 0) {
      return pitchState.available_items.map((i) => {
        const dossierItem = dossierMap.get(i.id);
        const effectiveType = dossierItem?.categorized_type || i.categorized_type || i.type || "driver";
        const isTradeOff = effectiveType === "trade_off";
        return {
          id: i.id,
          type: effectiveType as IntelTag,
          categorized_type: dossierItem?.categorized_type || i.categorized_type || i.type,
          intel_type: dossierItem?.intel_type || (i as any).intel_type || "unconfirmed",
          source: dossierItem?.source || (i as any).source,
          description: dossierItem?.description || i.description,
          stakeholder_id: i.stakeholder_id || dossierItem?.stakeholder_id,
          stakeholder_name:
            (i.stakeholder_id ? stakeholders[i.stakeholder_id]?.name : undefined) ||
            dossierItem?.stakeholder_name,
          branch_x: isTradeOff ? (i.branch_x || dossierItem?.branch_x) : undefined,
          branch_y: isTradeOff ? (i.branch_y || dossierItem?.branch_y) : undefined,
        };
      });
    }

    return Array.from(dossierMap.values());
  }, [pitchState, dossierData, stakeholders]);

  // Assembled Action Card Object
  const pitchedActionCard: ActionCard | null = useMemo(() => {
    if (!pitchState) return null;
    if (atomicChanges.length > 0) {
      const title = `Action Proposal (${atomicChanges.length} Change${atomicChanges.length > 1 ? "s" : ""})`;
      // Each change is one authored option: name it by the option, with the axis step after it.
      const described = atomicChanges.map((ac) => describeAtomicChange(ac, findGraphTarget(graphState?.technical, ac.target)));
      const description = atomicChanges
        .map((ac, idx) => {
          const isEdge = ac.target.startsWith("e.");
          const targetName = isEdge
            ? `Edge ${ac.target.replace(/^e\./, "").replace(/_/g, " ")}`
            : ac.target.split(".").pop()?.replace(/_/g, " ") || ac.target;
          const { title, detail } = described[idx];
          return title === detail ? `• ${targetName}: ${detail}` : `• ${targetName}: ${title} (${detail})`;
        })
        .join(" ");
      return {
        id: "proposal_action_card",
        title,
        description,
        atomic_changes: atomicChanges,
        atomic_change_labels: described.map((d) => d.title),
        predictions: pitchState.predictions || [],
        current_phase: currentPhase,
        challenge_id: currentChallenge,
      } as ActionCard;
    }
    if (selectedIntelIds.length > 0) {
      const cardItems = allIntelItems.filter((i) => selectedIntelIds.includes(i.id));
      const title = cardItems.length > 0 ? `Proposal: ${cardItems[0].description.slice(0, 48)}...` : "Action Proposal";
      const description = cardItems.map((i) => `• ${i.description}`).join(" ");
      return {
        id: "proposal_action_card",
        title: title || "Action Proposal",
        description: description || "Proposed system modifications and commitments.",
        intel_ids: selectedIntelIds,
        addendum_intel_item_ids: [],
        current_phase: currentPhase,
        challenge_id: currentChallenge,
      } as ActionCard;
    }
    return null;
  }, [pitchState, atomicChanges, selectedIntelIds, allIntelItems, currentPhase, currentChallenge, graphState]);

  // Inspect Intel handler
  const handleInspectIntel = (intel: RevealedIntel, stakeholderId?: string) => {
    const targetIntelId = intel.id || intel.description || "";
    const targetStakeholderId = intel.stakeholder_id || stakeholderId;
    if (targetStakeholderId) {
      setSelectedStakeholderId(targetStakeholderId);
    }
    setHighlightedIntelId(targetIntelId);
    setTimeout(() => setHighlightedIntelId(null), 3000);
  };

  // ── Engagement Cards Handlers ──
  const unconfirmedNotes = useMemo(
    () =>
      (dossierData || []).flatMap((st) =>
        (st.intel_items || [])
          .filter((i) => {
            const conf = (i.intel_type || "").toLowerCase();
            return conf !== "verified" && conf !== "confirmed" && conf !== "on_record";
          })
          .map((i) => ({
            id: i.id,
            intel_type: i.intel_type,
            categorized_type: i.categorized_type,
            description: i.description,
            stakeholder_id: st.is_challenge_intel ? undefined : st.stakeholder_id,
            stakeholder_name: st.is_challenge_intel ? undefined : st.name,
          }))
      ),
    [dossierData]
  );

  const handleSelectEngagementCard = (card: EngagementCard) => {
    const exhausted =
      (card.max_plays_per_phase === 1 || card.stakeholder_selection_amount === -1) &&
      playedIds.includes(card.id);
    if (tokens < card.token_cost || exhausted) return;
    setPlayingCard(card);
  };

  const handleDropEngagementCard = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingCard(false);
    const cardId = e.dataTransfer.getData("engagementCardId") || e.dataTransfer.getData("cardId");
    if (!cardId) return;

    const card = cards.find((c) => c.id === cardId);
    if (card) {
      handleSelectEngagementCard(card);
    }
  };

  const handleConfirmPlayCardStakeholders = (stakeholderIds: string[]) => {
    if (!playingCard) return;
    const nextTokens = tokens - playingCard.token_cost;
    setTokens(nextTokens);
    emit("gather:open", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
      card_id: playingCard.id,
      stakeholder_ids: stakeholderIds,
      attention_tokens: nextTokens,
    });
    if (playingCard.max_plays_per_phase === 1 || playingCard.stakeholder_selection_amount === -1) {
      setPlayedIds((prev) => [...prev, playingCard.id]);
    }
    setCardTargetedMap((prev) => ({
      ...prev,
      [playingCard.id]: [...(prev[playingCard.id] || []), ...stakeholderIds],
    }));
    setPlayingCard(null);
  };

  const handleConfirmPlayCardIntel = (item: { id: string }) => {
    if (!playingCard) return;
    const nextTokens = tokens - playingCard.token_cost;
    setTokens(nextTokens);
    emit("intel:verify_item", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
      intel_item_id: item.id,
      attention_tokens: nextTokens,
    });
    setPlayingCard(null);
  };

  const handleGatherAsk = (
    conversation: GatherStatePayload,
    option: GatherOptionKind,
    extra?: { component_id?: string; item_id?: string }
  ) => {
    const key = `${conversation.card_id}:${conversation.stakeholder_id}`;
    setBusyConversationKeys((prev) => new Set(prev).add(key));
    emit("gather:ask", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
      card_id: conversation.card_id,
      stakeholder_id: conversation.stakeholder_id,
      option,
      ...extra,
    });
  };

  const handleGatherClose = (conversation: GatherStatePayload) => {
    const key = `${conversation.card_id}:${conversation.stakeholder_id}`;
    emit("gather:close", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
      card_id: conversation.card_id,
      stakeholder_id: conversation.stakeholder_id,
    });
    if (isSpeechActive()) {
      pendingDismissKeysRef.current.add(key);
    } else {
      dismissConversation(key);
    }
  };

  const dismissConversation = (key: string) => {
    setConversations((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // ── Pitch Card Handlers ──
  const handleConfirmMergeProposal = (newAtomicChanges: AtomicChange[]) => {
    setAtomicChanges(newAtomicChanges);

    const matchingPitchIds = chatMsgsState
      .map((m) => m.conversation_id || "")
      .filter((id) => id.startsWith("pitch_"));
    const nextPitchIndex = new Set(matchingPitchIds).size + 1;
    const nextPitchConvId = `pitch_${nextPitchIndex}`;

    setIsPitchEvaluating(true);
    setEvaluatingPitchConvId(nextPitchConvId);

    emit("pitch:evaluate", { ...base, atomic_changes: newAtomicChanges });
  };

  const handlePitchCommit = () => {
    setIsCommittedLocked(true);
    emit("pitch:commit", { ...base, atomic_changes: atomicChanges });
    triggerPlayerSpeech("⚖️ Calling for final decision and committing proposal.");
  };

  const handleVetoBreaker = () => {
    setIsBreakingVeto(true);
    emit("pitch:veto_breaker", base);
  };

  const handleProceedToSimulation = () => {
    const passed = pitchState?.outcome === "PASS" || pitchState?.outcome === "SOFT_PASS";
    if (onEndPitch) {
      onEndPitch(passed, pitchedActionCard);
    }
  };

  // ── Seated Stakeholder Rendering ──
  const renderSeatedStakeholder = (
    st: any,
    isRightSide: boolean = false,
    isTop: boolean = false,
    topIndex?: number
  ) => {
    const isSelected = selectedStakeholderId === st.id;
    const isSpeaking = activeSpeakingState?.stakeholderId === st.id;
    const stakeholderColor = getStakeholderColor(st);
    const av = st.avatar || {};

    let topBubbleClass = "";
    if (isTop) {
      if (topIndex === 0) topBubbleClass = styles.tableSpeechBubbleTopLeft;
      else if (topIndex === 1) topBubbleClass = styles.tableSpeechBubbleTopRight;
      else topBubbleClass = styles.tableSpeechBubbleTopCenter;
    }

    const isFlipped = isRightSide || (isTop && topIndex !== undefined && topIndex >= 1);

    // Stakeholder names are authored "<role/category> <given name>" (e.g. "Requirements
    // Ryan"): split on the first space so the nameplate always breaks there, on its own two
    // lines, the same pattern used by the dossier tabs (StakeholderDossier.tsx), instead of
    // truncating with an ellipsis.
    const [nameRoleWord, ...nameGivenWords] = String(st.name || "").split(" ");
    const nameGivenName = nameGivenWords.join(" ");

    return (
      <div
        key={st.id}
        className={`${styles.seatedStakeholder} ${isSelected ? styles.seatedSelected : ""} ${isSpeaking ? styles.seatedSpeaking : ""}`}
        style={{ ["--st-color" as string]: stakeholderColor }}
        onClick={() => setSelectedStakeholderId(st.id)}
      >
        {/* Active Speech Bubble */}
        {isSpeaking && activeSpeakingState && (
          <div
            className={`${styles.tableSpeechBubble} ${topBubbleClass} ${activeSpeakingState.isClosing ? styles.tableSpeechBubbleClosing : ""}`}
            style={{ borderColor: stakeholderColor }}
            onClick={(e) => {
              e.stopPropagation();
              skipCurrentSpeech();
            }}
          >
            <SpokenText
              text={activeSpeakingState.message}
              activeSentenceIndex={activeSentenceIndex}
            />
            <EmotionEmoji emotionState={st.emotional_state} className={styles.bubbleEmotionEmoji} />
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
            stakeholderId={st.id}
            title={st.name}
            flip={isFlipped ? true : av.flip}
          />
        </div>

        {/* Conference Desk Nameplate (NO satisfaction/resistance gauge, as requested). Selection
            is shown as emphasis (glow + tinted fill) in the stakeholder's OWN color, not a
            hardcoded gold override - that used to make a selected stakeholder's nameplate go
            yellow regardless of their actual accent color (e.g. Requirements Ryan's purple). */}
        <div
          className={`${styles.deskNameplate} ${isSelected ? styles.activeDeskNameplate : ""}`}
          style={{
            color: stakeholderColor,
            borderColor: stakeholderColor,
          }}
        >
          {nameGivenName ? (
            <>
              <span className={styles.deskNameplateLine}>{nameRoleWord}</span>
              <span className={styles.deskNameplateLine}>{nameGivenName}</span>
            </>
          ) : (
            <span className={styles.deskNameplateLine}>{nameRoleWord}</span>
          )}
        </div>
      </div>
    );
  };

  const hasActiveConversations = Object.keys(conversations).length > 0;
  const isCardComposed = Boolean(pitchedActionCard && (atomicChanges.length > 0 || selectedIntelIds.length > 0));
  const stage = pitchState?.stage || "PREPARE";

  // Intel readiness for this phase: verified intel against everything there is to find, so the
  // pitch deck's intel badge can warn the player before they walk in under-prepared.
  const intelTotalThisPhase = pitchState?.intel_total ?? 0;
  const intelVerifiedThisPhase = pitchState?.intel_verified ?? 0;
  const intelReadyRatio = intelTotalThisPhase > 0 ? intelVerifiedThisPhase / intelTotalThisPhase : 1;
  const intelReadiness: "red" | "yellow" | "green" =
    intelReadyRatio >= READY_GREEN ? "green" : intelReadyRatio >= READY_YELLOW ? "yellow" : "red";
  const intelReadinessText =
    intelReadiness === "green"
      ? "Enough verified intel to make a case."
      : intelReadiness === "yellow"
      ? "Thin, but you can pitch."
      : "Not enough verified intel to pitch yet.";
  // Short version that's always visible on the badge itself, not just on hover - the color alone
  // wasn't enough for players to notice something was off.
  const intelReadinessShortLabel =
    intelReadiness === "green" ? "Ready to pitch" : intelReadiness === "yellow" ? "Still thin" : "Not enough yet";

  // The "PITCH DECK" plaque carries the same readiness color coding as the Intel stat chip once
  // it's actually clickable - falls back to the old neutral blue "active" cue when there's no
  // per-phase intel total to color it by yet.
  const isPlaqueActive = (!isCommittedLocked || pitchState?.outcome === "VETO") && !isPitchDebating;
  const plaqueReadyClass = isPlaqueActive
    ? intelTotalThisPhase > 0
      ? styles[`tableCenterPlaqueReady${intelReadiness}`]
      : styles.tableCenterPlaqueActive
    : "";

  return (
    <div className={styles.container}>
      {/* Main Content Canvas - background now rendered once by Game.tsx behind every
          gameplay phase; this is just a transparent overlay over it. */}
      <div
        className={`container-fluid flex-grow-1 d-flex flex-column px-3 py-2 position-relative ${
          isAnySpeechActive ? styles.overflowVisibleSpeech : "overflow-hidden"
        }`}
        style={{
          minHeight: 0,
          height: "100%",
        }}
      >
        {/* Base Layer: Board & Conversation History */}
        <div className="flex-grow-1 d-flex flex-column w-100" style={{ minHeight: 0, height: "100%" }}>
          {/* Main Board Grid: Left Column = Stakeholder Dossier, Right Column = Boardroom Scene & Chat */}
          <div
            className={`row g-2 align-items-stretch flex-grow-1 h-100 ${
              isAnySpeechActive ? styles.overflowVisibleSpeech : ""
            }`}
            style={{ minHeight: 0 }}
          >
            {/* LEFT COLUMN: Stakeholder Dossier (Always Open & Embedded) */}
            <div className="col-12 col-lg-4 d-flex flex-column h-100 position-relative" style={{ minHeight: 0, zIndex: 1 }}>
              <div className={`flex-grow-1 ${styles.dossierContainer}`}>
                <StakeholderDossier
                  isOpen={true}
                  canClose={false}
                  isEmbedded={true}
                  dossierData={dossierData || []}
                  activeStakeholderId={selectedStakeholderId}
                  onActiveStakeholderChange={(id) => setSelectedStakeholderId(id ?? "")}
                  highlightedIntelId={highlightedIntelId}
                  currentPhase={currentPhase}
                  currentChallenge={currentChallenge}
                  buyInInfoMap={buyInInfoMap}
                  cheatSheetActiveSection="Pitch & Debate"
                  onClose={() => {}}
                  onPerformanceToggle={onPerformanceToggle ? onPerformanceToggle : () => setShowDashboard(!showDashboard)}
                  isPerformanceOpen={isPerformanceOpen || showDashboard}
                  onSettingsToggle={onSettingsToggle}
                  isSettingsOpen={isSettingsOpen}
                  onOpenPhaseBriefing={onOpenPhaseBriefing}
                  onLogToggle={() => setEventsOpen(true)}
                  isLogOpen={eventsOpen}
                  logCount={events.length}
                  onOpenArtifact={handleOpenArtifact}
                />
              </div>
            </div>

            {/* RIGHT COLUMN: Boardroom Table Scene + Conversation History + Lower Shelf OR Compose Action Proposal */}
            <div
              className={`col-12 col-lg-8 d-flex flex-column h-100 rounded transition-all position-relative ${
                isAnySpeechActive ? styles.overflowVisibleSpeech : "overflow-hidden"
              }`}
              style={{ minHeight: 0, zIndex: isAnySpeechActive ? 3000 : 1 }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {isPitchModalOpen ? (
                  <motion.div
                    key="compose-action-proposal-view"
                    className="w-100 h-100 d-flex flex-column overflow-hidden"
                    initial={{ opacity: 0, y: 14, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.985 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                  >
                    <ComposeActionProposalModal
                      isOpen={isPitchModalOpen}
                      onClose={() => {
                        hideInfoTag();
                        setIsPitchModalOpen(false);
                      }}
                      currentPhase={currentPhase}
                      currentChallenge={currentChallenge}
                      initialAtomicChanges={atomicChanges}
                      initialSelectedTargetId={composerFocusTargetId}
                      onConfirmProposal={handleConfirmMergeProposal}
                      allowedTargets={pitchState?.allowed_targets || []}
                      upstreamMap={pitchState?.upstream_map || {}}
                      predictions={pitchState?.predictions || []}
                      boundaryWarnings={pitchState?.boundary_warnings || []}
                      intelItems={allIntelItems}
                      dossierData={dossierData}
                      stakeholders={stakeholders as any}
                      getStakeholderColor={getStakeholderColor}
                      graphState={graphState}
                      // Same figures the pitch deck's own Intel stat chip shows, so the two
                      // screens never disagree about how ready the player is to pitch.
                      intelTotal={pitchState?.intel_total ?? 0}
                      intelVerified={pitchState?.intel_verified ?? 0}
                      // The dossier is already open in the left column, so an owner link just
                      // switches its page rather than opening a second modal on top.
                      onOpenStakeholder={(stakeholderId) => setSelectedStakeholderId(stakeholderId)}
                      // Same for an intel reference: jump the dossier to it and let it pop,
                      // rather than opening a second reader inside the composer.
                      onSelectIntel={(intelId, stakeholderId) => {
                        if (stakeholderId) setSelectedStakeholderId(stakeholderId);
                        setHighlightedIntelId(intelId);
                        setTimeout(() => setHighlightedIntelId(null), 3000);
                      }}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="boardroom-view"
                    className={`w-100 h-100 d-flex flex-column gap-2 ${
                      isAnySpeechActive ? styles.overflowVisibleSpeech : "overflow-hidden"
                    }`}
                    initial={{ opacity: 0, y: 14, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 12, scale: 0.985 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                  >
                    {/* Upper Section: Challenge & Boardroom Scene (Left) + Chat History (Right) */}
                    <div
                      className={`flex-grow-1 row gx-2 align-items-stretch position-relative ${
                        isAnySpeechActive ? styles.overflowVisibleSpeech : "overflow-hidden"
                      } ${isDraggingCard ? styles.singleDropZoneActive : ""}`}
                      style={{ minHeight: 0, zIndex: isAnySpeechActive ? 3100 : 1 }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                      }}
                      onDrop={(e) => {
                        setIsDraggingCard(false);
                        handleDropEngagementCard(e);
                      }}
                    >
                      {/* Left Sub-Column: Challenge Card + Boardroom Oval Table */}
                      <div
                        className={`${styles.boardCol} ${
                          isChatMaximized ? styles.boardColCollapsed : ""
                        } ${isAnySpeechActive ? styles.boardColSpeaking : ""} d-flex flex-column justify-content-between h-100 position-relative`}
                        style={{ minHeight: 0, zIndex: isChatMaximized ? 0 : (isAnySpeechActive ? 3200 : 1) }}
                      >
                        {/* 1. Challenge Description Card above the Table */}
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
                          className="w-100 d-flex flex-column align-items-center justify-content-center flex-grow-1 pt-2 position-relative"
                          style={{ zIndex: isAnySpeechActive ? 3300 : 2, overflow: isAnySpeechActive ? "visible" : undefined }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "copy";
                          }}
                          onDrop={(e) => {
                            setIsDraggingCard(false);
                            handleDropEngagementCard(e);
                          }}
                        >
                          <div
                            className={`${styles.pitchDeckTable} ${isAnySpeechActive ? styles.pitchDeckTableSpeaking : ""} ${
                              isDraggingCard ? styles.pitchDeckTableDragging : ""
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
                            {/* Top Row: Stakeholders seated behind the table */}
                            {topStakeholders.length > 0 && (
                              <div
                                className={`${styles.tableTopSeating} ${
                                  topStakeholders.some((st) => activeSpeakingState?.stakeholderId === st.id)
                                    ? styles.seatingSpeaking
                                    : ""
                                }`}
                              >
                                {topStakeholders.map((st, idx) => renderSeatedStakeholder(st, false, true, idx))}
                              </div>
                            )}

                            {/* Middle Section: Left Seat, Central Pitched Action Card, Right Seat */}
                            <div
                              className={`${styles.tableCenterSurface} ${
                                [...leftStakeholders, ...rightStakeholders].some((st) => activeSpeakingState?.stakeholderId === st.id)
                                  ? styles.tableCenterSurfaceSpeaking
                                  : ""
                              }`}
                            >
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

                              {/* Center Tabletop: Pitched Action Card or Clickable Pitch Deck Plaque */}
                              <div className={styles.tabletopCenterArea}>
                                {isCardComposed && pitchedActionCard ? (
                                  <ActionCardCardComponent
                                    card={pitchedActionCard}
                                    intelItems={allIntelItems}
                                    stakeholders={stakeholders as any}
                                    getStakeholderColor={getStakeholderColor}
                                    isMinimized={true}
                                    isInteractive={(!isCommittedLocked || pitchState?.outcome === "VETO") && !isPitchDebating}
                                    onClick={() => {
                                      if ((!isCommittedLocked || pitchState?.outcome === "VETO") && !isPitchDebating) {
                                        setComposerFocusTargetId(undefined);
                                        setIsPitchModalOpen(true);
                                      }
                                    }}
                                    onSelectChange={(target) => {
                                      if ((!isCommittedLocked || pitchState?.outcome === "VETO") && !isPitchDebating) {
                                        setComposerFocusTargetId(target);
                                        setIsPitchModalOpen(true);
                                      }
                                    }}
                                  />
                                ) : (
                                  <div
                                    className={`${styles.tableCenterPlaque} ${plaqueReadyClass}`}
                                    tabIndex={0}
                                    role="button"
                                    onClick={() => {
                                      if (isPlaqueActive) {
                                        hideInfoTag();
                                        setComposerFocusTargetId(undefined);
                                        setIsPitchModalOpen(true);
                                      }
                                    }}
                                    onMouseEnter={(e) =>
                                      showInfoTag(
                                        e,
                                        "Pitch Deck",
                                        [
                                          isCommittedLocked && pitchState?.outcome !== "VETO"
                                            ? "Action card committed"
                                            : isPitchDebating
                                            ? "Wait until all stakeholder messages have appeared in conversation history"
                                            : "Configure up to 3 graph changes",
                                          isPlaqueActive && intelTotalThisPhase > 0
                                            ? `${intelVerifiedThisPhase}/${intelTotalThisPhase} intel verified. ${intelReadinessText}`
                                            : null,
                                        ]
                                          .filter(Boolean)
                                          .join("\n")
                                      )
                                    }
                                    onMouseLeave={hideInfoTag}
                                    onFocus={(e) =>
                                      showInfoTag(
                                        e,
                                        "Pitch Deck",
                                        [
                                          isCommittedLocked && pitchState?.outcome !== "VETO"
                                            ? "Action card committed"
                                            : isPitchDebating
                                            ? "Wait until all stakeholder messages have appeared in conversation history"
                                            : "Configure up to 3 graph changes",
                                          isPlaqueActive && intelTotalThisPhase > 0
                                            ? `${intelVerifiedThisPhase}/${intelTotalThisPhase} intel verified. ${intelReadinessText}`
                                            : null,
                                        ]
                                          .filter(Boolean)
                                          .join("\n")
                                      )
                                    }
                                    onBlur={hideInfoTag}
                                  >
                                    <Icon icon="ph:presentation-chart-bold" className={styles.tableCenterPlaqueIcon} />
                                    <span>PITCH DECK</span>
                                    <span className={styles.tableCenterPlaqueSub}>Click to compose action proposal</span>
                                    {isPlaqueActive && intelTotalThisPhase > 0 && (
                                      <span className={styles.tableCenterPlaqueReadyWord}>{intelReadinessShortLabel}</span>
                                    )}
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

                            {/* Lower Border Interaction Area: Status Chips & Control Buttons */}
                            <div className={styles.tableLowerInteractionArea}>
                              {/* Status Chips */}
                              <div className={styles.statChipsRowCentered}>
                                <div
                                  className={styles.statChipToken}
                                  tabIndex={0}
                                  role="status"
                                  onMouseEnter={(e) => showInfoTag(e, "Attention Tokens", `${tokens} available to spend this phase`)}
                                  onMouseLeave={hideInfoTag}
                                  onFocus={(e) => showInfoTag(e, "Attention Tokens", `${tokens} available to spend this phase`)}
                                  onBlur={hideInfoTag}
                                >
                                  <Icon icon="ph:coin-fill" className={styles.tokenStatIcon} />
                                  <span className={styles.statNumber}>{tokens}</span>
                                  <span className={styles.statLabel}>Tokens</span>
                                </div>

                                <div
                                  className={`${styles.statChipIntel} ${styles[`intelReady${intelReadiness}`]}`}
                                  tabIndex={0}
                                  role="status"
                                  onMouseEnter={(e) =>
                                    showInfoTag(
                                      e,
                                      "Intel Readiness",
                                      intelTotalThisPhase > 0
                                        ? `${intelVerifiedThisPhase}/${intelTotalThisPhase} verified this phase.\n${intelReadinessText}`
                                        : `${allIntelItems.length} intel items collected`
                                    )
                                  }
                                  onMouseLeave={hideInfoTag}
                                  onFocus={(e) =>
                                    showInfoTag(
                                      e,
                                      "Intel Readiness",
                                      intelTotalThisPhase > 0
                                        ? `${intelVerifiedThisPhase}/${intelTotalThisPhase} verified this phase.\n${intelReadinessText}`
                                        : `${allIntelItems.length} intel items collected`
                                    )
                                  }
                                  onBlur={hideInfoTag}
                                >
                                  <Icon icon="ph:files-bold" className={styles.intelStatIcon} />
                                  <span className={styles.statNumber}>
                                    {intelTotalThisPhase > 0
                                      ? `${intelVerifiedThisPhase}/${intelTotalThisPhase}`
                                      : allIntelItems.length}
                                  </span>
                                  <span className={styles.statLabelStack}>
                                    <span className={styles.statLabel}>Intel</span>
                                    {intelTotalThisPhase > 0 && (
                                      <span className={styles.statReadinessWord}>{intelReadinessShortLabel}</span>
                                    )}
                                  </span>
                                </div>

                              </div>

                              {/* Proposal State Controls */}
                              {stage === "DONE" ? (
                                <div className="w-100 d-flex flex-column align-items-center gap-1">
                                  <div
                                    className={`${styles.outcomeBanner} ${
                                      styles[`out${pitchState?.outcome || "PASS"}`] || styles.outPASS
                                    }`}
                                  >
                                    <Icon
                                      icon={
                                        pitchState?.outcome === "PASS"
                                          ? "ph:check-circle-fill"
                                          : pitchState?.outcome === "SOFT_PASS"
                                          ? "ph:warning-circle-fill"
                                          : "ph:prohibit-bold"
                                      }
                                      className={styles.outcomeIcon}
                                    />
                                    <div>
                                      <div className={styles.outcomeLabel}>
                                        {pitchState?.outcome === "PASS"
                                          ? "Proposal Approved"
                                          : pitchState?.outcome === "SOFT_PASS"
                                          ? "Approved with Soft Pass Friction"
                                          : "Proposal Vetoed"}
                                      </div>
                                      <div className={styles.outcomeDesc}>
                                        {pitchState?.outcome === "PASS" || pitchState?.outcome === "SOFT_PASS"
                                          ? "Action plan locked in. Transitioning to simulation..."
                                          : "A high-power stakeholder blocked the proposal. Revise your card to address their objection."}
                                      </div>
                                    </div>
                                  </div>

                                  {pitchState?.outcome === "VETO" ? (
                                    <button
                                      type="button"
                                      className={styles.actionButton}
                                      onClick={() => {
                                        hideInfoTag();
                                        setIsVetoDialogOpen(false);
                                        setComposerFocusTargetId(undefined);
                                        setIsPitchModalOpen(true);
                                      }}
                                      onMouseEnter={(e) => showInfoTag(e, "Revise & Re-Pitch", "Open the proposal builder to answer the veto")}
                                      onMouseLeave={hideInfoTag}
                                      onFocus={(e) => showInfoTag(e, "Revise & Re-Pitch", "Open the proposal builder to answer the veto")}
                                      onBlur={hideInfoTag}
                                    >
                                      <Icon icon="ph:arrow-counter-clockwise-bold" />
                                      <span>Revise Action Card & Re-Pitch</span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className={styles.actionButton}
                                      onClick={() => {
                                        hideInfoTag();
                                        handleProceedToSimulation();
                                      }}
                                      onMouseEnter={(e) => showInfoTag(e, "Continue", "Move on to the simulation phase")}
                                      onMouseLeave={hideInfoTag}
                                      onFocus={(e) => showInfoTag(e, "Continue", "Move on to the simulation phase")}
                                      onBlur={hideInfoTag}
                                    >
                                      <span>Proceeding to Simulation...</span>
                                    </button>
                                  )}
                                </div>
                              ) : isPitchEvaluating ? (
                                <button
                                  type="button"
                                  className={styles.actionButton}
                                  disabled
                                  style={{ opacity: 0.85, cursor: "wait" }}
                                >
                                  <Icon icon="ph:spinner-gap-bold" className={styles.spinIcon} />
                                  <span>Presenting Action Proposal...</span>
                                </button>
                              ) : stage === "PITCHED" ? (
                                <div className="d-flex align-items-center gap-2">
                                  <button
                                    type="button"
                                    className={`${styles.actionButton} ${styles.actionButtonAuto} ${isPitchDebating ? styles.actionButtonDisabled : ""}`}
                                    disabled={isPitchDebating}
                                    onClick={() => {
                                      hideInfoTag();
                                      setComposerFocusTargetId(undefined);
                                      setIsPitchModalOpen(true);
                                    }}
                                    onMouseEnter={(e) =>
                                      showInfoTag(
                                        e,
                                        "Revise Card",
                                        isPitchDebating
                                          ? "Wait until all stakeholder messages have appeared in conversation history"
                                          : "Modify card items or trade-off branches"
                                      )
                                    }
                                    onMouseLeave={hideInfoTag}
                                    onFocus={(e) =>
                                      showInfoTag(
                                        e,
                                        "Revise Card",
                                        isPitchDebating
                                          ? "Wait until all stakeholder messages have appeared in conversation history"
                                          : "Modify card items or trade-off branches"
                                      )
                                    }
                                    onBlur={hideInfoTag}
                                  >
                                    <Icon icon="ph:pencil-simple-bold" />
                                    <span>Revise Card</span>
                                  </button>
                                  <button
                                    type="button"
                                    className={`${styles.actionButton} ${styles.actionButtonAuto} ${isPitchDebating ? styles.actionButtonDisabled : ""}`}
                                    disabled={isPitchDebating}
                                    onClick={() => {
                                      hideInfoTag();
                                      handlePitchCommit();
                                    }}
                                    onMouseEnter={(e) =>
                                      showInfoTag(
                                        e,
                                        "Commit Proposal",
                                        isPitchDebating
                                          ? "Wait until all stakeholder messages have appeared in conversation history"
                                          : "Lock in the final outcome"
                                      )
                                    }
                                    onMouseLeave={hideInfoTag}
                                    onFocus={(e) =>
                                      showInfoTag(
                                        e,
                                        "Commit Proposal",
                                        isPitchDebating
                                          ? "Wait until all stakeholder messages have appeared in conversation history"
                                          : "Lock in the final outcome"
                                      )
                                    }
                                    onBlur={hideInfoTag}
                                  >
                                    <Icon icon="ph:check-bold" />
                                    <span>Commit Proposal ➔</span>
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className={`${styles.actionButton} ${styles.actionButtonAuto} ${
                                    isSpeechBubbleCoveringButton ? styles.actionButtonBlocked : ""
                                  }`}
                                  disabled={isSpeechBubbleCoveringButton}
                                  onClick={() => {
                                    hideInfoTag();
                                    setComposerFocusTargetId(undefined);
                                    setIsPitchModalOpen(true);
                                  }}
                                  onMouseEnter={(e) => showInfoTag(e, "Assemble Proposal", "Configure up to 3 graph improvements for action proposal")}
                                  onMouseLeave={hideInfoTag}
                                  onFocus={(e) => showInfoTag(e, "Assemble Proposal", "Configure up to 3 graph improvements for action proposal")}
                                  onBlur={hideInfoTag}
                                >
                                  <Icon icon="ph:git-merge-bold" />
                                  <span>Assemble Action Proposal</span>
                                </button>
                              )}
                            </div>

                            {/* Active Player Speech Bubble on Pitch Deck */}
                            {activePlayerSpeakingState && (
                              <div
                                className={`${styles.playerTableSpeechBubble} ${
                                  activePlayerSpeakingState.isClosing ? styles.playerTableSpeechBubbleClosing : ""
                                }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  skipCurrentSpeech();
                                }}
                              >
                                <div className={styles.playerSpeechHeader}>
                                  <div className="d-flex align-items-center gap-1">
                                    <Icon icon="ph:user-circle-bold" />
                                    <span>Player</span>
                                  </div>
                                </div>
                                <div className={styles.playerSpeechContent}>
                                  <SpokenText
                                    text={activePlayerSpeakingState.message}
                                    activeSentenceIndex={activeSentenceIndex}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* One skip control for every bubble: the bubbles themselves move around
                            the table, so the button that dismisses them stays put here instead,
                            below the table. */}
                        {isAnySpeechActive && (
                          <div className={styles.speechSkipBarRow}>
                            <button
                              type="button"
                              className={styles.speechSkipBar}
                              onClick={() => {
                                // This button unmounts the instant the queue empties (isAnySpeechActive
                                // goes false), so no mouseleave/blur ever fires to clear the hover
                                // tag - clear it explicitly here instead of leaving it stuck onscreen.
                                hideInfoTag();
                                skipCurrentSpeech();
                              }}
                              onMouseEnter={(e) => showInfoTag(e, "Skip", "Skip the current message")}
                              onMouseLeave={hideInfoTag}
                              onFocus={(e) => showInfoTag(e, "Skip", "Skip the current message")}
                              onBlur={hideInfoTag}
                            >
                              <Icon icon="ph:skip-forward-fill" />
                              <span>Skip</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Right Sub-Column: Conversation History (Spans Full Height) */}
                      <div
                        className={`${styles.chatCol} ${
                          isChatMaximized ? styles.chatColMaximized : ""
                        } d-flex flex-column h-100 position-relative`}
                        style={{ minHeight: 0, zIndex: isChatMaximized ? 2000 : 1 }}
                      >
                        {/* Maximized Challenge Card Wrapper */}
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
                            chatMsgs={chatMsgsState}
                            engagementCards={cards}
                            current_phase={currentPhase}
                            current_challenge={currentChallenge}
                            isEnabled={true}
                            isTyping={busyConversationKeys.size > 0 || isPitchEvaluating}
                            typingText={isPitchEvaluating ? "Stakeholders are reviewing the action proposal..." : "A stakeholder is typing..."}
                            isPitchEvaluating={isPitchEvaluating}
                            evaluatingConversationId={evaluatingPitchConvId}
                            actionCards={[]}
                            onHoverCard={() => {}}
                            showStakeholderList={false}
                            showDialogueOptions={false}
                            onInspectIntel={(intel, stId) => handleInspectIntel(intel, stId)}
                            activeSentenceIndex={activeSentenceIndex}
                            liveChatMsg={liveChatMsg}
                            onStopSpeech={skipCurrentSpeech}
                            onPlayMessage={playChatMessage}
                          />

                          {/* Maximize / Minimize button */}
                          <button
                            type="button"
                            className={styles.chatMaximizeBtn}
                            onClick={() => setIsChatMaximized(!isChatMaximized)}
                            onMouseEnter={(e) =>
                              showInfoTag(e, isChatMaximized ? "Restore View" : "Maximize", isChatMaximized ? "Restore view" : "Maximize conversation history")
                            }
                            onMouseLeave={hideInfoTag}
                            onFocus={(e) =>
                              showInfoTag(e, isChatMaximized ? "Restore View" : "Maximize", isChatMaximized ? "Restore view" : "Maximize conversation history")
                            }
                            onBlur={hideInfoTag}
                          >
                            <Icon
                              icon={isChatMaximized ? "ph:arrows-in-simple-bold" : "ph:arrows-out-simple-bold"}
                              className={styles.chatMaximizeBtnIcon}
                            />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Lower Section: Engagement Cards Shelf OR Replaced by Active Dialogue Options */}
                    <div className={`flex-shrink-0 position-relative ${styles.lowerInteractionShelf}`}>
                      <AnimatePresence mode="wait" initial={false}>
                        {hasActiveConversations ? (
                          /* Dialogue Options Area replacing engagement cards while dialogue is active */
                          <motion.div
                            key="dialogue-options-shelf"
                            className={styles.gatherConversationWrapper}
                            initial={{ opacity: 0, y: 14, scale: 0.985 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 12, scale: 0.985 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                          >
                            {Object.entries(conversations).map(([key, conv]) => (
                              <GatherConversationPanel
                                key={key}
                                conversation={conv}
                                avatar={stakeholders[conv.stakeholder_id]?.avatar}
                                stakeholderColor={stakeholders[conv.stakeholder_id]?.stakeholder_color || "#38bdf8"}
                                busy={busyConversationKeys.has(key)}
                                onAsk={(opt, extra) => handleGatherAsk(conv, opt, extra)}
                                onClose={() => handleGatherClose(conv)}
                              />
                            ))}
                          </motion.div>
                        ) : (
                          /* Default Engagement Cards Deck Shelf */
                          <motion.div
                            key="engagement-cards-shelf"
                            className={styles.engagementCardsWrapper}
                            initial={{ opacity: 0, y: 14, scale: 0.985 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 12, scale: 0.985 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                          >
                            <EngagementCards
                              cards={cards}
                              attentionTokens={tokens}
                              playedCardIds={playedIds}
                              onSelectCard={handleSelectEngagementCard}
                              onDragCardStart={() => setIsDraggingCard(true)}
                              onDragCardEnd={() => setIsDraggingCard(false)}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Dashboard Layer (only when used standalone without parent onPerformanceToggle) */}
        {!onPerformanceToggle && (
          <PerformanceDashboard
            isOpen={showDashboard}
            onClose={() => setShowDashboard(false)}
            currentPhase={currentPhase}
            currentChallenge={currentChallenge}
            challengeTitle={challengeTitle}
            challengeDescription={challengeDescription}
            challengeIntro={challengeIntro}
            challengeAmount={challengeAmount}
          />
        )}
      </div>

      {/* Engagement Card Target Modal */}
      {playingCard && (
        <EngagementCardTargetModal
          isOpen={Boolean(playingCard)}
          onClose={() => setPlayingCard(null)}
          card={playingCard}
          attentionTokens={tokens}
          currentPhase={currentPhase}
          stakeholders={stakeholders as any}
          availableStakeholderList={activeStakeholders as any}
          isStakeholderActive={() => true}
          cardTargetedStakeholdersMap={cardTargetedMap}
          intelItems={unconfirmedNotes}
          graphState={graphState}
          onConfirmStakeholders={handleConfirmPlayCardStakeholders}
          onConfirmIntel={handleConfirmPlayCardIntel}
          getStakeholderColor={getStakeholderColor}
          getTagBadgeColor={() => "bg-secondary"}
        />
      )}

      {/* Intel Verification Result Dialog */}
      <IntelVerificationDialog
        isOpen={Boolean(verificationModal)}
        onClose={() => setVerificationModal(null)}
        resultData={verificationModal}
      />

      {/* Event Log Modal */}
      <EventLogModal
        isVisible={eventsOpen}
        onClose={() => setEventsOpen(false)}
        events={events}
        onItemClick={(itemId) => setHighlightedIntelId(itemId)}
      />

      {/* Stakeholder Veto Dialog */}
      <VetoDialog
        isOpen={isVetoDialogOpen}
        onClose={() => setIsVetoDialogOpen(false)}
        onReviseProposal={() => {
          setIsVetoDialogOpen(false);
          setComposerFocusTargetId(undefined);
          setIsPitchModalOpen(true);
        }}
        vetoInfo={vetoInfo}
        stakeholders={stakeholders as any}
        getStakeholderColor={getStakeholderColor}
        escalationPoints={escalationPoints}
        onVetoBreaker={handleVetoBreaker}
        isBreakingVeto={isBreakingVeto}
      />

      {/* Full Page Offline Intel Gathering View for Single Artifact Review */}
      <AnimatePresence>
        {singleArtifactForReview && (
          <motion.div
            {...FADE_TRANSITION}
            key="artifact-review"
            className="position-fixed top-0 start-0 w-100 h-100"
            style={{ zIndex: 1200 }}
          >
            <OfflineIntelGathering
              onContinue={() => setSingleArtifactForReview(null)}
              onGoBack={() => setSingleArtifactForReview(null)}
              singleArtifact={singleArtifactForReview}
              currentPhase={currentPhase}
              currentChallenge={currentChallenge}
              dossierData={dossierData}
              onPerformanceToggle={onPerformanceToggle}
              isPerformanceOpen={isPerformanceOpen}
              onSettingsToggle={onSettingsToggle}
              isSettingsOpen={isSettingsOpen}
              onOpenPhaseBriefing={onOpenPhaseBriefing}
              challengeTitle={challengeTitle}
              challengeDescription={challengeDescription}
              challengeIntro={challengeIntro}
              challengeAmount={challengeAmount}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {infoTag &&
        createPortal(
          <div
            ref={infoTagRef}
            className={styles.headerHoverTag}
            style={{ top: `${infoTag.top}px`, left: `${infoTag.left}px` }}
            aria-hidden="true"
          >
            <div className={styles.headerHoverTagFlip}>
              <div className={styles.headerHoverTagLabel}>{infoTag.label}</div>
              {infoTag.detail && <div className={styles.headerHoverTagDetail}>{infoTag.detail}</div>}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
