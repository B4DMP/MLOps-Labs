/**
 * The merged pitch phase (plan 06): PREPARE, OBJECT, COMMIT on one screen.
 * PREPARE includes engagement cards and stakeholder chat (D37).
 *
 * Layout mirrors offline_intel_gathering: left column = embedded dossier,
 * right column = transparent-div with challenge header, discussion table,
 * stage content, and footer actions.
 */

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";

import { StakeholderContext } from "./StakeholderProvider";
import type { StakeholderAvatar } from "../types/StakeholderAvatar";
import { useGameWebSocket, useWebSocketEvent } from "../services/websocket/useGameWebSocket";
import { intelTagMeta, type IntelTag } from "../types/IntelTag";
import ChallengeDescriptionCard from "./ChallengeDescriptionCard";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import StakeholderDossier, { type StakeholderDossierEntry } from "./StakeholderDossier";
import styles from "./pitch_phase.module.css";
import type { EngagementCard } from "../types/EngagementCard";
import EngagementCardTargetModal from "./EngagementCardTargetModal";
import IntelVerificationDialog, { type IntelVerificationResultData } from "./IntelVerificationDialog";
import StakeholderInteractionArea, { type ChatMsg } from "./StakeholderInteractionArea";
import GlossaryText from "./glossary/GlossaryText";

const MAX_CARD_ITEMS = 5;

/** How much of this challenge's intel has to be pinned down before a pitch is worth making.
 *  Below the first threshold the room would only hear guesses, so the pitch is held back. */
const READY_YELLOW = 0.35;
const READY_GREEN = 0.6;

type ObjectionKind = "boundary" | "technical" | "stance" | "price" | "correction";
type OptionName = "amend" | "reframe" | "stonewall" | "emergency_addendum" | "concede_correction";

interface PitchItem {
  id: string;
  stakeholder_id?: string;
  type: IntelTag;
  description: string;
  chain_id?: string;
  chain_position?: number;
  chain_length?: number;
}

interface PitchChain {
  id: string;
  newest: PitchItem;
  older: PitchItem[];
}

const toChains = (items: PitchItem[]): PitchChain[] => {
  const byChain = new Map<string, PitchItem[]>();
  items.forEach((item) => {
    const key = item.chain_id || item.id;
    byChain.set(key, [...(byChain.get(key) || []), item]);
  });
  return [...byChain.entries()].map(([id, links]) => {
    const ordered = [...links].sort((a, b) => (a.chain_position ?? 0) - (b.chain_position ?? 0));
    return { id, newest: ordered[ordered.length - 1], older: ordered.slice(0, -1) };
  });
};

interface OptionSpec {
  option: OptionName;
  available: boolean;
  reason?: string | null;
}

interface PitchObjection {
  id: string;
  kind: ObjectionKind;
  stakeholder_id: string;
  item_id?: string | null;
  target?: string | null;
  text: string;
  hard: boolean;
  options: OptionSpec[];
}

interface Prediction {
  item_id: string;
  target?: string | null;
  asked?: number | null;
  predicted?: number | null;
  capped_by?: string | null;
  known: boolean;
}

interface BoundaryWarning {
  item_id: string;
  stakeholder_id?: string | null;
  target?: string | null;
  checkable: boolean;
  violated: boolean;
}

interface StakeholderRead {
  stakeholder_id: string;
  power: string;
  coverage: number;
  loss: number;
  fit: number;
  buy_in: number | null;
  band: "green" | "amber" | "red";
  boundary_violated: boolean;
}

interface PitchStatePayload {
  stage: "PREPARE" | "OBJECT" | "COMMIT" | "DONE";
  card_item_ids: string[];
  main_archetype?: string | null;
  secondary_archetype?: string | null;
  available_items: PitchItem[];
  card: PitchItem[];
  predictions: Prediction[];
  boundary_warnings: BoundaryWarning[];
  uncompensated_losses: Record<string, number>;
  reads: StakeholderRead[];
  predicted_outcome: "PASS" | "SOFT_PASS" | "VETO";
  objections: PitchObjection[];
  intel_total?: number;
  intel_verified?: number;
  amendments_left: number;
  escalation_points: number;
  patience: Record<string, number>;
  outcome?: string | null;
  error?: string | null;
  applied?: Record<string, unknown>;
  stalemate?: boolean;
}

interface StakeholderBuyInInfo {
  threshold: number;
  actionCardScore: number;
  dialogueScore: number;
  emotionScore: number;
  total: number;
  isPersuaded: boolean;
  currentEmotion: number;
}

interface PitchPhaseProps {
  currentPhase: number;
  currentChallenge: number;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  challengeAmount?: number;
  convincerArchetypes?: Record<string, {
    name?: string;
    label?: string;
    icon?: string;
    color?: string;
    strategy?: string;
    evidence_basis?: number;
    risk_and_control?: number;
    value_horizon?: number;
  }>;
  onEndPitch?: (passed: boolean) => void;
  engagementCards?: EngagementCard[];
  attentionTokens?: number;
  onAttentionTokensChange?: (n: number) => void;
  playedCardIdsInPhase?: string[];
  onPlayedCardIdsChange?: (ids: string[]) => void;
  chatMsgs?: ChatMsg[];
  onChatMsgsChange?: (msgs: ChatMsg[]) => void;
  cardTargetedStakeholdersMap?: Record<string, string[]>;
  onCardTargetedStakeholdersMapChange?: (m: Record<string, string[]>) => void;
  onUpdateIntelItems?: (items: unknown[]) => void;
  dossierData?: StakeholderDossierEntry[];
  onOpenPhaseBriefing?: () => void;
  onPipelineToggle?: () => void;
  isPipelineOpen?: boolean;
}

const LEVEL_LABELS = ["broken", "absent", "manual", "automated", "governed"];

/** The player's words for the three stages. PREPARE, OBJECT and COMMIT are ours. */
const STAGE_STEPS = [
  { id: "GATHER", label: "Gather", hint: "Spend attention tokens on cards. Verified intel is what you can pitch with." },
  { id: "PREPARE", label: "Build your case", hint: "Drop up to five items into the card. Watch the caps and the lines you would cross." },
  { id: "OBJECT", label: "Face the room", hint: "Answer every hard objection. Amending costs a slot, stonewalling costs goodwill." },
  { id: "COMMIT", label: "Decide", hint: "Take the outcome, or spend an escalation point to overrule the room." },
] as const;

/** What each objection means, in the player's words. */
const OBJECTION_MEANING: Record<ObjectionKind, string> = {
  boundary: "Your card crosses a line they will not cross. This one blocks the pitch.",
  technical: "The change cannot land as asked: something upstream holds it back.",
  stance: "Something they want is missing from your card, or barely covered.",
  price: "They lose something here and get nothing back for it.",
  correction: "You filed this intel under the wrong kind, and they noticed.",
};

const OPTION_LABELS: Record<OptionName, string> = {
  amend: "Amend",
  reframe: "Reframe",
  stonewall: "Stonewall",
  emergency_addendum: "Emergency Addendum",
  concede_correction: "Concede Correction",
};

const OPTION_ICONS: Record<OptionName, string> = {
  amend: "ph:plus-circle-bold",
  reframe: "ph:broadcast-bold",
  stonewall: "ph:shield-bold",
  emergency_addendum: "ph:lightning-bold",
  concede_correction: "ph:arrows-counter-clockwise-bold",
};

const OPTION_EFFECT: Record<OptionName, string> = {
  amend: "Add an intel item that answers them.",
  reframe: "Say it their way. Only shifts soft objections.",
  stonewall: "Hold your ground. They mind, the other side likes it.",
  emergency_addendum: "Promise something you have no intel for. Costs an escalation point.",
  concede_correction: "Admit you filed it wrong. Fixes it in your dossier.",
};

const KIND_CLASS: Record<ObjectionKind, string> = {
  boundary: styles.kindBoundary,
  technical: styles.kindTechnical,
  stance: styles.kindStance,
  price: styles.kindPrice,
  correction: styles.kindCorrection,
};

const TAG_CLASS: Record<IntelTag, string> = {
  driver: styles.tagDriver,
  boundary: styles.tagBoundary,
  trade_off: styles.tagTradeOff,
  fact: styles.tagFact,
};

export default function PitchPhase({
  currentPhase,
  currentChallenge,
  challengeTitle,
  challengeDescription,
  challengeIntro,
  challengeAmount,
  convincerArchetypes = {},
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
  dossierData,
  onOpenPhaseBriefing,
  onPipelineToggle,
  isPipelineOpen = false,
}: PitchPhaseProps) {
  const { emit, subscribe } = useGameWebSocket();
  const stakeholderCtx = useContext(StakeholderContext);
  const stakeholders = (stakeholderCtx?.stakeholders || {}) as Record<
    string,
    { name?: string; avatar?: StakeholderAvatar; stakeholder_color?: string }
  >;

  // ── pitch state ──────────────────────────────────────────────────────────
  const [state, setState] = useState<PitchStatePayload | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [main, setMain] = useState<string>("");
  const [secondary, setSecondary] = useState<string>("");
  const [objectionIndex, setObjectionIndex] = useState(0);
  const [amendFor, setAmendFor] = useState<string | null>(null);
  const [activeSt, setActiveSt] = useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Gathering is its own step: engagement cards and artifacts are the mechanic there,
  // not a button in a bar. Server side it is still PREPARE.
  const [localStage, setLocalStage] = useState<"GATHER" | "BUILD">("GATHER");
  const [chatOpen, setChatOpen] = useState(false);
  const [framingOpen, setFramingOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerTag, setPickerTag] = useState<IntelTag | "all">("all");

  // ── engagement card state (controlled-or-local pattern) ──────────────────
  const [localTokens, setLocalTokens] = useState(8);
  const [localPlayedIds, setLocalPlayedIds] = useState<string[]>([]);
  const [localChatMsgs, setLocalChatMsgs] = useState<ChatMsg[]>([]);
  const [localCardTargetedMap, setLocalCardTargetedMap] = useState<Record<string, string[]>>({});
  const [playingCard, setPlayingCard] = useState<EngagementCard | null>(null);
  const [verificationModal, setVerificationModal] = useState<IntelVerificationResultData | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);

  const cards = engagementCardsProp || [];
  const tokens = attentionTokensProp !== undefined ? attentionTokensProp : localTokens;
  const setTokens = onAttentionTokensChange ?? setLocalTokens;
  const playedIds = playedCardIdsProp !== undefined ? playedCardIdsProp : localPlayedIds;
  const setPlayedIds = onPlayedCardIdsChange ?? setLocalPlayedIds;
  const chatMsgsState = chatMsgsProp !== undefined ? chatMsgsProp : localChatMsgs;
  const setChatMsgsState = onChatMsgsChange ?? setLocalChatMsgs;
  const cardTargetedMap = cardTargetedMapProp !== undefined ? cardTargetedMapProp : localCardTargetedMap;
  const setCardTargetedMap = onCardTargetedStakeholdersMapChange ?? setLocalCardTargetedMap;

  // ── speech: stakeholders talk in bubbles at their seat, one at a time ─────
  // The chat log only gets a line once its bubble has been shown, so the history
  // never runs ahead of the room.
  type SpeechItem = { stakeholderId?: string; message: string; chatMsg?: ChatMsg };
  const speechQueue = useRef<SpeechItem[]>([]);
  const speechBusy = useRef(false);
  const speechTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [speaking, setSpeaking] = useState<{ stakeholderId?: string; message: string; closing?: boolean } | null>(null);

  const clearSpeechTimers = () => {
    speechTimers.current.forEach(clearTimeout);
    speechTimers.current = [];
  };

  const playNextSpeech = () => {
    if (speechBusy.current) return;
    const next = speechQueue.current.shift();
    if (!next) {
      setSpeaking(null);
      return;
    }
    speechBusy.current = true;
    clearSpeechTimers();
    if (next.chatMsg) setChatMsgsState((prev) => [...prev, next.chatMsg!]);
    if (next.stakeholderId) setActiveSt(next.stakeholderId);
    setSpeaking({ stakeholderId: next.stakeholderId, message: next.message, closing: false });

    // Long lines stay up longer, capped so nobody waits on a wall of text.
    const duration = Math.min(12000, Math.max(4000, next.message.length * 55));
    speechTimers.current.push(
      setTimeout(() => setSpeaking((prev) => (prev ? { ...prev, closing: true } : null)), Math.max(0, duration - 400)),
      setTimeout(() => {
        setSpeaking(null);
        speechBusy.current = false;
        speechTimers.current.push(setTimeout(playNextSpeech, 120));
      }, duration),
    );
  };

  const skipSpeech = () => {
    clearSpeechTimers();
    setSpeaking(null);
    speechBusy.current = false;
    playNextSpeech();
  };

  const say = (item: SpeechItem) => {
    speechQueue.current.push(item);
    playNextSpeech();
  };

  const pendingSpeech = speechQueue.current.length;

  useEffect(() => () => clearSpeechTimers(), []);

  const base = useMemo(
    () => ({ phase_id: currentPhase, challenge_id: currentChallenge }),
    [currentPhase, currentChallenge],
  );

  const bgIndex = (currentChallenge + currentPhase) % 4;

  // buy-in scores for the dossier
  const buyInInfoMap = useMemo((): Record<string, StakeholderBuyInInfo> => {
    if (!state) return {};
    return Object.fromEntries(
      state.reads.map((r) => [
        r.stakeholder_id,
        {
          threshold: 0.6,
          actionCardScore: r.coverage,
          dialogueScore: 0,
          emotionScore: 0,
          total: r.buy_in ?? (r.band === "green" ? 0.75 : r.band === "amber" ? 0.5 : 0.2),
          isPersuaded: r.band === "green",
          currentEmotion: 0,
        },
      ])
    );
  }, [state]);

  // cross-reference dossier to show verified/unconfirmed badge per item
  const verifiedIds = useMemo(() => {
    const ids = new Set<string>();
    (dossierData || []).forEach((st) => {
      (st.intel_items || []).forEach((item) => {
        if ((item.intel_type || "").toLowerCase() === "verified") ids.add(item.id);
      });
    });
    return ids;
  }, [dossierData]);

  // keep dossier scrolled to active stakeholder
  useEffect(() => {
    if (state?.stage === "OBJECT") {
      const obj = state.objections[objectionIndex];
      if (obj) setActiveSt(obj.stakeholder_id);
    }
  }, [state?.stage, objectionIndex, state?.objections]);

  // ── pitch:state event ────────────────────────────────────────────────────
  useWebSocketEvent<PitchStatePayload>("pitch:state", (payload) => {
    setState(payload);
    // A saved card means gathering is behind them, so a reconnect does not reopen it.
    if ((payload.card_item_ids || []).length > 0) setLocalStage("BUILD");
    setSelected(payload.card_item_ids || []);
    if (payload.main_archetype) setMain(payload.main_archetype);
    if (payload.secondary_archetype) setSecondary(payload.secondary_archetype);
    setObjectionIndex(0);
    setAmendFor(null);
  });

  useEffect(() => {
    emit("pitch:state", base);
  }, [emit, base]);

  // ── intel engagement events ───────────────────────────────────────────────
  useEffect(() => {
    if (!subscribe) return;

    const handleEngagementFinished = (payload: any) => {
      setIsWaiting(false);
      if (!payload) return;
      if (payload.played_engagement_card_ids) setPlayedIds(payload.played_engagement_card_ids);
      if (payload.engagement_card_targets) {
        setCardTargetedMap((prev) => ({ ...prev, ...payload.engagement_card_targets }));
      }
      if (payload.dossier && onUpdateIntelItems) {
        const items = (payload.dossier as any[]).flatMap((entry) =>
          (entry.intel_items || []).map((intel: any) => ({
            ...intel,
            stakeholder_id: entry.stakeholder_id,
            stakeholder_name: entry.name,
          })),
        );
        onUpdateIntelItems(items);
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
        if (p.type === "stakeholder_message" && p.message && p.stakeholder_id) {
          const msg: ChatMsg = {
            id: p.stakeholder_id,
            message: p.message,
            ac_id: -1,
            revealed_intel: p.revealed_intel_items || [],
          };
          say({ stakeholderId: p.stakeholder_id, message: p.message, chatMsg: msg });
        } else if (p.type === "player_message" && p.message) {
          const msg: ChatMsg = { id: "user", message: p.message, ac_id: -1 };
          setChatMsgsState((prev) => [...prev, msg]);
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
      }),
      subscribe("system:error", () => setIsWaiting(false)),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, emit, base, onUpdateIntelItems]);

  // ── engagement card handlers ──────────────────────────────────────────────
  const handleSelectEngagementCard = (card: EngagementCard) => {
    const exhausted =
      (card.max_plays_per_phase === 1 || card.stakeholder_selection_amount === -1) &&
      playedIds.includes(card.id);
    if (tokens < card.token_cost || exhausted) return;
    setPlayingCard(card);
  };

  const handleConfirmPlayCardStakeholders = (stakeholderIds: string[]) => {
    if (!playingCard) return;
    const nextTokens = tokens - playingCard.token_cost;
    setTokens(nextTokens);
    setIsWaiting(true);
    emit("intel:play_engagement_card", {
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

  // ── pitch card handlers ───────────────────────────────────────────────────
  const stakeholderName = (id?: string | null) =>
    (id && stakeholders[id]?.name) || id || "Someone";

  const toggleItem = (id: string) => {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_CARD_ITEMS
          ? prev
          : [...prev, id],
    );
  };

  const saveCard = () =>
    emit("pitch:set_card", {
      ...base,
      item_ids: selected,
      main_archetype: main || null,
      secondary_archetype: secondary || null,
    });

  const startObjections = () => {
    saveCard();
    emit("pitch:object", base);
  };

  const answer = (objection: PitchObjection, option: OptionName, itemId?: string) => {
    emit("pitch:answer", { ...base, objection_id: objection.id, option, item_id: itemId ?? null });
  };

  if (!state) {
    return (
      <div className="game-container d-flex align-items-center justify-content-center">
        <div className={styles.loadingSpinner}>
          <span className="spinner-border spinner-border-sm me-2" role="status" />
          Getting the room ready…
        </div>
      </div>
    );
  }

  const current = state.objections[Math.min(objectionIndex, state.objections.length - 1)];
  const predictionFor = (itemId: string) => state.predictions.find((p) => p.item_id === itemId);
  const violatedFor = (stId: string) =>
    state.boundary_warnings.filter((w) => w.violated && w.stakeholder_id === stId);

  const chains = toChains(state.available_items);
  const chainById: Record<string, PitchChain> = Object.fromEntries(chains.map((c) => [c.newest.id, c]));
  // What the room has already heard the player say: the same mark the dossier uses.
  const onRecordIds = new Set(state.card_item_ids);

  // Readiness: verified intel for this challenge against what there is to find.
  const intelTotal = state.intel_total ?? 0;
  const intelVerified = state.intel_verified ?? 0;
  const readyRatio = intelTotal > 0 ? intelVerified / intelTotal : 1;
  const readiness: "red" | "yellow" | "green" =
    readyRatio >= READY_GREEN ? "green" : readyRatio >= READY_YELLOW ? "yellow" : "red";
  const readinessText =
    readiness === "green"
      ? "Enough verified intel to make a case."
      : readiness === "yellow"
        ? "Thin. You can pitch, but expect objections you cannot answer."
        : "Not enough verified intel to pitch. Play engagement cards and verify what you find.";
  const canPitch = selected.length > 0 && readiness !== "red";

  const grouped: Record<string, PitchChain[]> = { boundary: [], driver: [], trade_off: [], fact: [] };
  toChains(state.available_items).forEach((chain) => {
    (grouped[chain.newest.type] ||= []).push(chain);
  });

  const availableStakeholderList = Object.entries(stakeholders).map(([id, st]) => ({
    id,
    name: st.name || id,
    avatar: st.avatar,
  }));

  return (
    <div className="game-container">
      <div
        className={`container-fluid flex-grow-1 d-flex flex-column px-2 px-md-3 py-1 position-relative overflow-hidden ${styles.mainContainer}`}
        style={{ backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_${bgIndex}.png")` }}
      >
        <div className={`row g-2 align-items-stretch h-100 ${styles.boardRow}`}>

          {/* ── LEFT: embedded Stakeholder Dossier ─────────────────────── */}
          <div className={`col-12 d-flex flex-column h-100 ${styles.leftColumn}`}>
            <div className={`h-100 ${styles.dossierContainer}`}>
              <StakeholderDossier
                isOpen={true}
                canClose={false}
                isEmbedded={true}
                dossierData={dossierData || []}
                activeStakeholderId={activeSt}
                currentPhase={currentPhase}
                currentChallenge={currentChallenge}
                onClose={() => {}}
                buyInInfoMap={buyInInfoMap as any}
                convincerArchetypes={convincerArchetypes}
                onOpenPhaseBriefing={onOpenPhaseBriefing}
                onPipelineToggle={onPipelineToggle}
                isPipelineOpen={isPipelineOpen}
              />
            </div>
          </div>

          {/* ── RIGHT: pitch interface ─────────────────────────────────── */}
          <div className={`col-12 d-flex flex-column h-100 ${styles.rightColumn}`}>
            <div className={`shadow-lg w-100 ${styles.pitchWrapper}`}>

              {/* Header: challenge card + stage bar */}
              <div className={styles.headerRow}>
                <ChallengeDescriptionCard
                  challengeTitle={challengeTitle}
                  challengeDescription={challengeDescription}
                  challengeIntro={challengeIntro}
                  currentChallenge={currentChallenge}
                  challengeAmount={challengeAmount}
                  is_minimized
                />
              </div>

              {state.error && <div className={styles.errorBanner}>{state.error}</div>}

              {/* Discussion table — who is in the room */}
              <div className={`${styles.discussionTable} ${styles.roomBand}`}>
                <div className={styles.tableEdge} aria-hidden />
                {state.reads.map((read, seatIndex) => {
                  const st = stakeholders[read.stakeholder_id];
                  const bandColor =
                    read.band === "green" ? "#22c55e" : read.band === "amber" ? "#f59e0b" : "#ef4444";
                  const stColor = st?.stakeholder_color || "#38bdf8";
                  const isSpeaking = speaking?.stakeholderId === read.stakeholder_id;
                  const isActive = activeSt === read.stakeholder_id;
                  // Seats at either end bias their bubble inward so it stays inside the panel.
                  const side =
                    seatIndex === 0 ? styles.speechBubbleLeft
                      : seatIndex === state.reads.length - 1 ? styles.speechBubbleRight
                      : "";
                  // The outer seats sit slightly lower, which reads as a table edge curving away.
                  const outer = seatIndex === 0 || seatIndex === state.reads.length - 1;
                  return (
                    <div
                      key={read.stakeholder_id}
                      className={`${styles.seat} ${outer ? styles.seatOuter : ""} ${isSpeaking ? styles.seatSpeaking : ""}`}
                      style={{ ["--st-color" as string]: stColor } as React.CSSProperties}
                    >
                      <button
                        className={`${styles.discussionSt} ${isActive ? styles.discussionStActive : ""}`}
                        onClick={() => setActiveSt((prev) => prev === read.stakeholder_id ? undefined : read.stakeholder_id)}
                        title={`${st?.name || read.stakeholder_id} · ${read.power === "high" ? "High Power" : "Low Power"} · buy-in: ${read.band}`}
                      >
                        <div className={styles.seatAvatar}>
                          <StakeholderAvatarComponent
                            avatar={st?.avatar}
                            size={72}
                            isFramed={false}
                            isSpeaking={isSpeaking}
                            play_blink_animation
                            stakeholderColor={stColor}
                            flip={seatIndex >= state.reads.length / 2}
                          />
                          <span className={styles.buyInDot} style={{ background: bandColor }} title={`buy-in: ${read.band}`} />
                          {read.boundary_violated && (
                            <Icon icon="ph:prohibit-bold" className={styles.discussionViolation} title="a line of theirs is crossed" />
                          )}
                        </div>
                        <span
                          className={`${styles.namePlate} ${isActive ? styles.namePlateActive : ""}`}
                          style={{ color: stColor, borderColor: stColor }}
                        >
                          {st?.name || read.stakeholder_id}
                          {read.power === "high" && (
                            <Icon icon="ph:lightning-fill" className={styles.powerBolt} title="High power" />
                          )}
                        </span>
                      </button>

                      {isSpeaking && speaking && (
                        <div
                          className={`${styles.speechBubble} ${side} ${speaking.closing ? styles.speechBubbleClosing : ""}`}
                          onClick={skipSpeech}
                          title="Skip"
                        >
                          <span className={styles.speakerName}>{stakeholderName(read.stakeholder_id)}</span>
                          <GlossaryText text={speaking.message} surface="speech_bubbles" />
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* One skip control for the room, in a fixed spot: no chasing bubbles. */}
                {speaking && (
                  <div className={styles.skipBar}>
                    <button className={styles.skipBtn} onClick={skipSpeech} title="Skip this line">
                      <Icon icon="ph:skip-forward-fill" />
                      Skip{pendingSpeech > 0 ? ` (${pendingSpeech} more)` : ""}
                    </button>
                  </div>
                )}
              </div>

              {/* Stage content */}
              <div className={styles.surface}>
              <div className={styles.pitchBody}>

                {/* Stage stepper: the title of the work surface, not a bare chip row. */}
                <div className={styles.stepperWrap}>
                  <div className={styles.stepper}>
                    {STAGE_STEPS.map((step, i) => {
                      const activeId =
                        state.stage === "DONE" ? "COMMIT"
                          : state.stage === "PREPARE" && localStage === "GATHER" ? "GATHER"
                          : state.stage;
                      const activeIdx = STAGE_STEPS.findIndex((x) => x.id === activeId);
                      const done = i < activeIdx;
                      const active = i === activeIdx;
                      // Before the pitch is made the player moves freely between gathering and
                      // building. Once the room has been faced, the way back is closed.
                      const goGather = state.stage === "PREPARE" && step.id === "GATHER";
                      const goBuild = state.stage === "PREPARE" && step.id === "PREPARE";
                      const goObject = state.stage === "PREPARE" && step.id === "OBJECT" && canPitch;
                      const clickable = !active && (goGather || goBuild || goObject);
                      return (
                        <button
                          key={step.id}
                          className={`${styles.step} ${active ? styles.stepActive : done ? styles.stepDone : styles.stepPending} ${clickable ? styles.stepClickable : ""}`}
                          disabled={!clickable}
                          onClick={() => {
                            if (goGather) setLocalStage("GATHER");
                            else if (goBuild) setLocalStage("BUILD");
                            else if (goObject) startObjections();
                          }}
                          title={
                            clickable ? `Go to ${step.label}`
                              : step.id === "OBJECT" && state.stage === "PREPARE" ? readinessText
                              : undefined
                          }
                        >
                          <span className={styles.stepNum}>{done ? <Icon icon="ph:check-bold" /> : i + 1}</span>
                          <span className={styles.stepLabel}>{step.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className={styles.stepHint}>
                    {STAGE_STEPS.find((x) =>
                      x.id === (state.stage === "DONE" ? "COMMIT"
                        : state.stage === "PREPARE" && localStage === "GATHER" ? "GATHER"
                        : state.stage))?.hint}
                  </div>
                </div>

                {/* ── GATHER ──────────────────────────────────────────── */}
                {state.stage === "PREPARE" && localStage === "GATHER" && (
                  <>
                    <div className={styles.gatherHead}>
                      <div>
                        <div className={styles.trayTitle}>Work the room</div>
                        <div className={styles.builderHint}>
                          Each card costs tokens and buys a conversation. Verify what it turns up, or it will not count.
                        </div>
                      </div>
                      <div className={styles.tokenMeter} title="Attention tokens: what it costs you to approach people">
                        <Icon icon="ph:coins-fill" className={styles.tokenIcon} />
                        <span className={styles.tokenCount}>{tokens}</span>
                        <span className={styles.tokenLabel}>attention<br />tokens left</span>
                      </div>
                    </div>

                    <div className={styles.fan}>
                      {cards.map((card, i) => {
                        const exhausted =
                          (card.max_plays_per_phase === 1 || card.stakeholder_selection_amount === -1) &&
                          playedIds.includes(card.id);
                        const tooExpensive = tokens < card.token_cost;
                        const off = exhausted || tooExpensive || isWaiting;
                        const mid = (cards.length - 1) / 2;
                        const targets =
                          card.target_type === "intel" ? "one intel item"
                            : card.stakeholder_selection_amount === -1 ? "the whole room"
                            : `${card.stakeholder_selection_amount} to talk to`;
                        return (
                          <button
                            key={card.id}
                            className={`${styles.fanCard} ${off ? styles.fanCardOff : ""}`}
                            style={{
                              transform: `rotate(${(i - mid) * 3.2}deg) translateY(${Math.abs(i - mid) * 7}px)`,
                              zIndex: i + 1,
                            }}
                            onClick={() => !off && handleSelectEngagementCard(card)}
                            title={
                              exhausted ? "Already played this phase"
                                : tooExpensive ? `Costs ${card.token_cost}, you have ${tokens}`
                                : undefined
                            }
                          >
                            <span className={styles.fanCost}>
                              <Icon icon="ph:coins-fill" />{card.token_cost}
                            </span>
                            <Icon icon={card.icon} className={styles.fanIcon} />
                            <span className={styles.fanTitle}>{card.title}</span>
                            <span className={styles.fanDesc}>{card.description}</span>
                            <span className={styles.fanTarget}>{targets}</span>
                            {exhausted && <span className={styles.fanStamp}>played</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* ── PREPARE ─────────────────────────────────────────── */}
                {state.stage === "PREPARE" && localStage === "BUILD" && (
                  <>
                    {/* The card: five slots, always in the same place. Browsing happens in the
                        picker, so the thing being built never scrolls away. */}
                    <div className={styles.trayHeader}>
                      <span className={styles.trayTitle}>Your card</span>
                      <span className={styles.builderHint}>
                        {selected.length}/{MAX_CARD_ITEMS} slots · empty slots are fine, weak intel is not
                      </span>
                    </div>

                    <div className={styles.tray}>
                      {Array.from({ length: MAX_CARD_ITEMS }, (_, slot) => {
                        const id = selected[slot];
                        const chain = id ? chainById[id] : undefined;
                        if (!chain) {
                          const isNext = slot === selected.length;
                          return (
                            <button
                              key={`empty-${slot}`}
                              className={`${styles.slot} ${styles.slotEmpty}`}
                              onClick={() => setPickerOpen(true)}
                              title="Add an intel item"
                            >
                              <Icon icon="ph:plus-bold" />
                              {isNext && <span>Add intel</span>}
                            </button>
                          );
                        }
                        const item = chain.newest;
                        const pred = predictionFor(item.id);
                        return (
                          <div key={item.id} className={`${styles.slot} ${styles.slotFilled}`}>
                            <div className={styles.slotTop}>
                              <span className={`${styles.tagPill} ${TAG_CLASS[item.type]}`}>
                                {intelTagMeta(item.type).shortLabel}
                              </span>
                              <span className={styles.stName}>{stakeholderName(item.stakeholder_id)}</span>
                              {onRecordIds.has(item.id)
                                ? <span className={styles.onRecordBadge}>★ on record</span>
                                : verifiedIds.has(item.id)
                                  ? <span className={styles.verifiedBadge}>✓ verified</span>
                                  : <span className={styles.unconfirmedBadge}>? unconfirmed</span>}
                              <button
                                className={styles.removeBtn}
                                onClick={() => toggleItem(item.id)}
                                title="Take this out of the card"
                              >
                                <Icon icon="ph:x-bold" />
                              </button>
                            </div>
                            <span className={styles.slotDesc}>{item.description}</span>
                            {chain.older.length > 0 && (
                              <span className={styles.chainDepth} title="Sharpened intel: still one slot.">
                                +{chain.older.length} earlier
                              </span>
                            )}
                            {pred && (
                              <span className={styles.predictionLabel}>
                                {pred.predicted === null || pred.predicted === undefined
                                  ? "effect unknown, you have not looked at this yet"
                                  : `lands at ${LEVEL_LABELS[pred.predicted]}${pred.asked !== null && pred.asked !== undefined && pred.predicted < pred.asked ? ` (capped by ${pred.capped_by})` : ""}`}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Framing: one decision, folded away until it is being made. */}
                    <div className={styles.convincerSection}>
                      <button className={styles.convincerTitle} onClick={() => setFramingOpen((v) => !v)}>
                        <Icon icon="ph:broadcast-bold" className="me-1" />
                        Framing
                        {main
                          ? <span className={styles.framingPick}>{convincerArchetypes[main]?.label || convincerArchetypes[main]?.name || main}</span>
                          : <span className={styles.framingNone}>none picked, worth a few points of buy-in</span>}
                        {secondary && (
                          <span className={styles.framingBackup}>
                            second audience: {convincerArchetypes[secondary]?.label || convincerArchetypes[secondary]?.name || secondary}
                          </span>
                        )}
                        <Icon icon={framingOpen ? "ph:caret-up-bold" : "ph:caret-down-bold"} className="ms-auto" />
                      </button>

                      {framingOpen && (
                        <>
                          <span className={styles.builderHint}>
                            Pick the one that matches how most of this room thinks. It is worth a few points of buy-in.
                          </span>
                          <div className={styles.profileRow}>
                            {Object.entries(convincerArchetypes).map(([key, prof]) => {
                              const isMain = main === key;
                              return (
                                <button
                                  key={key}
                                  className={`${styles.profileCard} ${isMain ? styles.profileMain : ""}`}
                                  style={{ ["--st-color" as string]: prof.color || "#38bdf8" } as React.CSSProperties}
                                  onClick={() => { setMain(isMain ? "" : key); setFramingOpen(false); }}
                                >
                                  <span className={styles.profileName}>
                                    {prof.icon && <span className="me-1">{prof.icon}</span>}
                                    {prof.label || prof.name || key}
                                    {isMain && <span className={styles.roleMain}>picked</span>}
                                  </span>
                                  {prof.strategy && <span className={styles.profileStrategy}>{prof.strategy}</span>}
                                </button>
                              );
                            })}
                          </div>

                          {main && (
                            <div className={styles.backupRow}>
                              <span className={styles.backupLabel}>
                                Second audience (optional): a hedge for anyone the main framing does not reach
                              </span>
                              <div className={styles.backupChips}>
                                {Object.entries(convincerArchetypes)
                                  .filter(([key]) => key !== main)
                                  .map(([key, prof]) => (
                                    <button
                                      key={key}
                                      className={`${styles.backupChip} ${secondary === key ? styles.backupChipOn : ""}`}
                                      onClick={() => setSecondary(secondary === key ? "" : key)}
                                    >
                                      {prof.label || prof.name || key}
                                    </button>
                                  ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* What the card would break, and who pays for it. */}
                    {state.boundary_warnings.some((w) => w.violated || !w.checkable) && (
                      <div className={styles.intelGroup}>
                        <div className={styles.groupLabel}>Lines</div>
                        {state.boundary_warnings.filter((w) => w.violated || !w.checkable).map((w) => (
                          <div key={w.item_id} className={styles.warnRow}>
                            <Icon icon={w.checkable ? "ph:prohibit-bold" : "ph:question-bold"} className={w.checkable ? styles.warnRed : styles.warnMuted} />
                            <span>
                              {w.checkable
                                ? `${stakeholderName(w.stakeholder_id)}: this card crosses their line on ${w.target}`
                                : `${stakeholderName(w.stakeholder_id)}: cannot check, you have not looked at ${w.target}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {Object.entries(state.uncompensated_losses).some(([, v]) => v > 0) && (
                      <div className={styles.intelGroup}>
                        <div className={styles.groupLabel}>Uncompensated losses</div>
                        {Object.entries(state.uncompensated_losses).filter(([, v]) => v > 0).map(([stId, v]) => (
                          <div key={stId} className={styles.warnRow}>
                            <Icon icon="ph:trend-down-bold" className={styles.warnAmber} />
                            <span>{stakeholderName(stId)} loses something and gets nothing back ({Math.round(v * 100)}%)</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* ── OBJECT ──────────────────────────────────────────── */}
                {state.stage === "OBJECT" && current && (
                  <div className={styles.objCard}>
                    <div className={styles.objHeader}>
                      <div className={styles.objAvatar}>
                        <StakeholderAvatarComponent
                          avatar={stakeholders[current.stakeholder_id]?.avatar}
                          size={64}
                          isFramed={false}
                          stakeholderColor={stakeholders[current.stakeholder_id]?.stakeholder_color || "#38bdf8"}
                        />
                      </div>
                      <div className={styles.objHeaderText}>
                        <span className={styles.objStakeholder}>{stakeholderName(current.stakeholder_id)}</span>
                        <span className={`${styles.objKindBadge} ${KIND_CLASS[current.kind]}`}>
                          {current.kind}{current.hard ? " · blocks the pitch" : ""}
                        </span>
                        <span className={styles.objMeaning}>{OBJECTION_MEANING[current.kind]}</span>
                      </div>
                      <div className={styles.objProgressWrap}>
                        <span className={styles.objProgress}>{objectionIndex + 1} of {state.objections.length}</span>
                        <span className={styles.objDots}>
                          {state.objections.map((o, i) => (
                            <button
                              key={o.id}
                              className={`${styles.objDot} ${i === objectionIndex ? styles.objDotActive : ""} ${o.hard ? styles.objDotHard : ""}`}
                              onClick={() => setObjectionIndex(i)}
                              title={`${stakeholderName(o.stakeholder_id)}: ${o.kind}`}
                            />
                          ))}
                        </span>
                      </div>
                    </div>

                    <blockquote className={styles.objText}>{current.text}</blockquote>

                    <div className={styles.optionsGrid}>
                      {current.options.map((opt) => (
                        <button
                          key={opt.option}
                          className={`${styles.optBtn} ${opt.available ? "" : styles.optBtnOff}`}
                          disabled={!opt.available}
                          onClick={() =>
                            opt.option === "amend"
                              ? setAmendFor(amendFor === current.id ? null : current.id)
                              : answer(current, opt.option)
                          }
                        >
                          <span className={styles.optLabel}>
                            <Icon icon={OPTION_ICONS[opt.option]} className="me-1" />
                            {OPTION_LABELS[opt.option]}
                          </span>
                          <span className={styles.optEffect}>{OPTION_EFFECT[opt.option]}</span>
                          {opt.reason && <span className={styles.optReason}>{opt.reason}</span>}
                        </button>
                      ))}
                    </div>

                    {amendFor === current.id && (
                      <div className={styles.amendList}>
                        <div className={styles.groupLabel}>Answer it with intel you hold</div>
                        {chains
                          .filter((chain) => !state.card_item_ids.includes(chain.newest.id))
                          .map(({ id: chainId, newest: item, older }) => (
                            <div key={chainId} className={styles.intelRow} onClick={() => answer(current, "amend", item.id)}>
                              <span className={`${styles.tagPill} ${TAG_CLASS[item.type]}`}>
                                {intelTagMeta(item.type).shortLabel}
                              </span>
                              <div className={styles.intelMain}>
                                <div className={styles.intelMeta}>
                                  <span className={styles.stName}>{stakeholderName(item.stakeholder_id)}</span>
                                  {older.length > 0 && <span className={styles.chainDepth}>+{older.length} earlier</span>}
                                </div>
                                <span className={styles.intelDesc}>{item.description}</span>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}

                    <div className={styles.objNav}>
                      <button className={styles.btnSecondary} disabled={objectionIndex === 0} onClick={() => setObjectionIndex((i) => Math.max(0, i - 1))}>
                        <Icon icon="ph:arrow-left-bold" /> Previous
                      </button>
                      <span className={styles.objNavHint}>
                        {state.objections.length === 0
                          ? "Nobody objected. Commit when you are ready."
                          : "Answer what you can, then commit."}
                      </span>
                      <button className={styles.btnSecondary} disabled={objectionIndex >= state.objections.length - 1} onClick={() => setObjectionIndex((i) => i + 1)}>
                        Next <Icon icon="ph:arrow-right-bold" />
                      </button>
                    </div>
                  </div>
                )}

                {/* ── COMMIT / DONE ────────────────────────────────────── */}
                {(state.stage === "COMMIT" || state.stage === "DONE") && (
                  <div className={styles.outcomeWrap}>
                    <div className={`${styles.outcomeBanner} ${styles[`out${state.stalemate ? "STALEMATE" : state.outcome}`] || ""}`}>
                      <Icon
                        icon={
                          state.stalemate ? "ph:hand-palm-bold"
                            : state.outcome === "PASS" ? "ph:check-circle-fill"
                            : state.outcome === "SOFT_PASS" ? "ph:warning-circle-fill"
                            : state.outcome === "CONCEDED" ? "ph:handshake-bold"
                            : "ph:prohibit-bold"
                        }
                        className={styles.outcomeIcon}
                      />
                      <div>
                        <div className={styles.outcomeLabel}>
                          {state.stalemate ? "Stalemate"
                            : state.outcome === "PASS" ? "Agreed"
                            : state.outcome === "SOFT_PASS" ? "Agreed, with a cost"
                            : state.outcome === "CONCEDED" ? "You let them have it"
                            : "Blocked"}
                        </div>
                        <div className={styles.outcomeDesc}>
                          {state.stalemate
                            ? "Nobody moved. Your change does not happen and the world carries on without you."
                            : state.outcome === "PASS"
                              ? "The room is behind the card. It goes in as pitched."
                              : state.outcome === "SOFT_PASS"
                                ? "It goes in, but the people you passed over will remember it."
                                : state.outcome === "CONCEDED"
                                  ? "Your card is off the table. The other side's position is what gets built."
                                  : "Someone with the power to stop this used it. Push it through, rebuild the card, or let them have it."}
                        </div>
                      </div>
                    </div>

                    <div className={styles.groupLabel}>Where the room stands</div>
                    <div className={styles.buyInList}>
                      {state.reads.map((read) => {
                        const st = stakeholders[read.stakeholder_id];
                        const pct = Math.round((read.buy_in ?? (read.band === "green" ? 0.75 : read.band === "amber" ? 0.5 : 0.2)) * 100);
                        const why = read.boundary_violated
                          ? "a line of theirs is crossed"
                          : read.coverage >= 0.99
                            ? "everything they asked for is in the card"
                            : read.loss > 0
                              ? "they lose something and get nothing back"
                              : read.coverage <= 0.01
                                ? "nothing they asked for is in the card"
                                : "only part of what they asked for is in the card";
                        return (
                          <div key={read.stakeholder_id} className={styles.buyInRow}>
                            <StakeholderAvatarComponent
                              avatar={st?.avatar}
                              size={34}
                              isFramed={false}
                              stakeholderColor={st?.stakeholder_color || "#38bdf8"}
                            />
                            <span className={styles.buyInSt}>
                              {stakeholderName(read.stakeholder_id)}
                              {read.power === "high" && <Icon icon="ph:lightning-fill" className={styles.powerBolt} title="High power" />}
                            </span>
                            <span className={styles.buyInBarWrap}>
                              <span
                                className={styles.buyInBar}
                                style={{
                                  width: `${pct}%`,
                                  background: read.band === "green" ? "#22c55e" : read.band === "amber" ? "#f59e0b" : "#ef4444",
                                  opacity: read.buy_in === null ? 0.45 : 1,
                                }}
                              />
                            </span>
                            <span className={styles.buyInVal}>
                              {read.buy_in === null ? read.band : `${pct}%`}
                            </span>
                            <span className={styles.buyInWhy}>{why}</span>
                          </div>
                        );
                      })}
                    </div>
                    {state.reads.some((r) => r.buy_in === null) && (
                      <div className={styles.builderHint}>
                        A band instead of a number means you have not worked out how to talk to them yet.
                      </div>
                    )}

                    {state.outcome === "VETO" && !state.stalemate && (
                      <div className={styles.outcomeChoices}>
                        <button
                          className={styles.choiceCard}
                          disabled={state.escalation_points <= 0}
                          onClick={() => emit("pitch:veto_breaker", base)}
                        >
                          <span className={styles.choiceTitle}><Icon icon="ph:lightning-bold" className="me-1" />Push it through</span>
                          <span className={styles.choiceCost}>1 escalation point, {state.escalation_points} left</span>
                          <span className={styles.choiceEffect}>It gets built. They will not forget being overruled.</span>
                        </button>
                        <button className={styles.choiceCard} onClick={() => emit("pitch:rebuild", base)}>
                          <span className={styles.choiceTitle}><Icon icon="ph:arrows-clockwise-bold" className="me-1" />Rebuild the card</span>
                          <span className={styles.choiceCost}>costs the room one patience</span>
                          <span className={styles.choiceEffect}>Back to building. The new card has to be properly different.</span>
                        </button>
                        <button className={styles.choiceCard} onClick={() => emit("pitch:concede", base)}>
                          <span className={styles.choiceTitle}><Icon icon="ph:handshake-bold" className="me-1" />Let them have it</span>
                          <span className={styles.choiceCost}>free</span>
                          <span className={styles.choiceEffect}>Their position gets built instead of yours.</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <aside className={`${styles.chatSide} ${chatOpen ? styles.chatSideOpen : ""}`}>
                <button className={styles.chatTab} onClick={() => setChatOpen((v) => !v)} title="The room's conversation">
                  <Icon icon={chatOpen ? "ph:caret-right-bold" : "ph:chat-circle-text-bold"} />
                  <span className={styles.chatTabLabel}>Conversation history</span>
                  {chatMsgsState.length > 0 && <span className={styles.chatCount}>{chatMsgsState.length}</span>}
                </button>
                {chatOpen && (
                  <div className={styles.chatBody}>
                    <StakeholderInteractionArea
                      chatMsgs={chatMsgsState}
                      current_phase={currentPhase}
                      current_challenge={currentChallenge}
                      isEnabled={!isWaiting}
                      actionCards={[]}
                      onHoverCard={() => {}}
                      showStakeholderList={false}
                      showDialogueOptions={false}
                      showHeader={false}
                    />
                  </div>
                )}
              </aside>
              </div>

              {/* Bar: where you stand and what you do next. */}
              <div className={styles.dock}>
                <div className={styles.dockRow}>
                  <span className={`${styles.readiness} ${styles[`ready${readiness}`]}`} title={readinessText}>
                    <span className={styles.readyDot} />
                    {intelVerified}/{intelTotal} verified
                  </span>
                  {state.stage === "PREPARE" && localStage === "BUILD" && (
                    <span className={styles.dockMeta}>{selected.length}/{MAX_CARD_ITEMS} slots</span>
                  )}
                  <span
                    className={styles.dockMeta}
                    title="Escalation points: three for the whole game. One pushes a card through a veto, or buys a promise you have no intel for."
                  >
                    {state.escalation_points} escalation left
                  </span>
                  {state.stage === "OBJECT" && (
                    <span className={styles.dockMeta}>{state.amendments_left} amendments left</span>
                  )}
                  <span className={styles.readyHint}>{readinessText}</span>

                  <span className={styles.dockActions}>
                    {state.stage === "PREPARE" && localStage === "GATHER" && (
                      <button
                        className={styles.btnPrimary}
                        onClick={() => setLocalStage("BUILD")}
                        title="Once you start building, the cards and the artifacts are behind you"
                      >
                        Done gathering <Icon icon="ph:arrow-right-bold" />
                      </button>
                    )}
                    {state.stage === "PREPARE" && localStage === "BUILD" && (
                      <>
                        <button className={styles.btnSecondary} onClick={saveCard} disabled={selected.length === 0}>
                          Save card
                        </button>
                        <button
                          className={styles.btnPrimary}
                          onClick={startObjections}
                          disabled={!canPitch}
                          title={readiness === "red" ? readinessText : undefined}
                        >
                          <Icon icon="ph:paper-plane-tilt-bold" />Pitch it
                        </button>
                      </>
                    )}
                    {state.stage === "OBJECT" && (
                      <button
                        className={styles.btnPrimary}
                        onClick={() => emit("pitch:commit", base)}
                        disabled={state.objections.length > 0 && current !== undefined && violatedFor(current.stakeholder_id).length > 0}
                      >
                        <Icon icon="ph:check-bold" />Commit the card
                      </button>
                    )}
                    {(state.stage === "DONE" || state.stalemate) && (
                      <button className={styles.btnPrimary} onClick={() => onEndPitch?.(state.outcome === "PASS" || state.outcome === "SOFT_PASS")}>
                        Continue <Icon icon="ph:arrow-right-bold" />
                      </button>
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {pickerOpen && (
        <div className={styles.pickerBackdrop} onClick={() => setPickerOpen(false)}>
          <div className={styles.picker} onClick={(e) => e.stopPropagation()}>
            <div className={styles.pickerHeader}>
              <span className={styles.trayTitle}>Pick intel</span>
              <span className={styles.builderHint}>
                {MAX_CARD_ITEMS - selected.length} slot{MAX_CARD_ITEMS - selected.length === 1 ? "" : "s"} left
              </span>
              <button className="btn-close btn-close-white ms-auto" onClick={() => setPickerOpen(false)} aria-label="Close" />
            </div>

            <div className={styles.pickerFilters}>
              <input
                className={styles.pickerSearch}
                placeholder="Search your intel"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                autoFocus
              />
              {(["all", "boundary", "driver", "trade_off", "fact"] as const).map((tag) => (
                <button
                  key={tag}
                  className={`${styles.filterChip} ${pickerTag === tag ? styles.filterChipActive : ""}`}
                  onClick={() => setPickerTag(tag)}
                >
                  {tag === "all" ? "All" : intelTagMeta(tag).label}
                </button>
              ))}
            </div>

            <div className={styles.pickerList}>
              {chains
                .filter((chain) => pickerTag === "all" || chain.newest.type === pickerTag)
                .filter((chain) => {
                  const q = pickerQuery.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    chain.newest.description.toLowerCase().includes(q) ||
                    stakeholderName(chain.newest.stakeholder_id).toLowerCase().includes(q)
                  );
                })
                .map((chain) => {
                  const item = chain.newest;
                  const pick = selected.includes(item.id);
                  const full = selected.length >= MAX_CARD_ITEMS && !pick;
                  const pred = predictionFor(item.id);
                  return (
                    <div
                      key={chain.id}
                      className={`${styles.intelRow} ${pick ? styles.intelRowSlotted : ""} ${full ? styles.intelRowFull : ""}`}
                      onClick={() => { if (!full) toggleItem(item.id); }}
                      title={full ? "The card is full: take something out first" : undefined}
                    >
                      <span className={`${styles.tagPill} ${TAG_CLASS[item.type]}`}>
                        {intelTagMeta(item.type).shortLabel}
                      </span>
                      <div className={styles.intelMain}>
                        <div className={styles.intelMeta}>
                          <span className={styles.stName}>{stakeholderName(item.stakeholder_id)}</span>
                          {onRecordIds.has(item.id)
                            ? <span className={styles.onRecordBadge}>★ on record</span>
                            : verifiedIds.has(item.id)
                              ? <span className={styles.verifiedBadge}>✓ verified</span>
                              : <span className={styles.unconfirmedBadge}>? unconfirmed</span>}
                          {chain.older.length > 0 && (
                            <span className={styles.chainDepth}>+{chain.older.length} earlier</span>
                          )}
                        </div>
                        <span className={styles.intelDesc}>{item.description}</span>
                        {pred && pred.predicted !== null && pred.predicted !== undefined && (
                          <span className={styles.predictionLabel}>
                            lands at {LEVEL_LABELS[pred.predicted]}
                            {pred.asked !== null && pred.asked !== undefined && pred.predicted < pred.asked
                              ? ` (capped by ${pred.capped_by})`
                              : ""}
                          </span>
                        )}
                      </div>
                      {pick && <Icon icon="ph:check-circle-fill" className={styles.pickedIcon} />}
                    </div>
                  );
                })}
            </div>

            <div className={styles.pickerFooter}>
              <button className={styles.btnPrimary} onClick={() => setPickerOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {playingCard && (
        <EngagementCardTargetModal
          isOpen={Boolean(playingCard)}
          onClose={() => setPlayingCard(null)}
          card={playingCard}
          attentionTokens={tokens}
          stakeholders={stakeholders as any}
          availableStakeholderList={availableStakeholderList as any}
          isStakeholderActive={() => true}
          cardTargetedStakeholdersMap={cardTargetedMap}
          intelItems={[]}
          onConfirmStakeholders={handleConfirmPlayCardStakeholders}
          onConfirmIntel={() => {}}
          getStakeholderColor={(st: any) => st?.stakeholder_color || "#38bdf8"}
          getTagBadgeColor={() => "bg-secondary"}
        />
      )}
      <IntelVerificationDialog
        isOpen={Boolean(verificationModal)}
        onClose={() => setVerificationModal(null)}
        resultData={verificationModal}
      />
    </div>
  );
}
