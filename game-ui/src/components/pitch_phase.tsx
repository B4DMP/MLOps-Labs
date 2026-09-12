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
import EngagementCards from "./EngagementCards";
import EngagementCardTargetModal from "./EngagementCardTargetModal";
import IntelVerificationDialog, { type IntelVerificationResultData } from "./IntelVerificationDialog";
import StakeholderInteractionArea, { type ChatMsg } from "./StakeholderInteractionArea";
import GlossaryText from "./glossary/GlossaryText";

const MAX_CARD_ITEMS = 5;

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
  convincerArchetypes?: Record<string, { name?: string; icon?: string; color?: string }>;
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

const OPTION_LABELS: Record<OptionName, string> = {
  amend: "Amend",
  reframe: "Reframe",
  stonewall: "Stonewall",
  emergency_addendum: "Emergency Addendum",
  concede_correction: "Concede Correction",
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
  // Cards and conversation live in the dock, opened as a sheet over the work surface,
  // so the card the player is building never moves.
  const [openSheet, setOpenSheet] = useState<"cards" | "chat" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
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
                <div className={styles.stageBar}>
                  {(["PREPARE", "OBJECT", "COMMIT"] as const).map((stage, i) => {
                    const isDone =
                      (stage === "PREPARE" && (state.stage === "OBJECT" || state.stage === "COMMIT" || state.stage === "DONE")) ||
                      (stage === "OBJECT" && (state.stage === "COMMIT" || state.stage === "DONE"));
                    const isActive = state.stage === stage || (stage === "COMMIT" && state.stage === "DONE");
                    return (
                      <span key={stage} className={styles.stageEntry}>
                        {i > 0 && <span className={styles.stageSep} />}
                        <span className={`${styles.stageChip} ${isDone ? styles.done : isActive ? styles.active : styles.pending}`}>
                          {stage}
                        </span>
                      </span>
                    );
                  })}
                  <span className={`${styles.slotCount} ${selected.length >= MAX_CARD_ITEMS ? styles.atMax : ""}`}>
                    {selected.length}/{MAX_CARD_ITEMS} slots · {state.escalation_points} EP
                    {state.stage === "OBJECT" && ` · ${state.amendments_left} left`}
                  </span>
                </div>
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
                          {read.power === "high" && <span className={styles.discussionStar}> ★</span>}
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
              <div className={styles.pitchBody}>

                {/* ── PREPARE ─────────────────────────────────────────── */}
                {state.stage === "PREPARE" && (
                  <>
                    {/* The card: five slots, always in the same place. Browsing happens in the
                        picker, so the thing being built never scrolls away. */}
                    <div className={styles.trayHeader}>
                      <span className={styles.trayTitle}>Your card</span>
                      <span className={styles.builderHint}>
                        {selected.length}/{MAX_CARD_ITEMS} slots · each item is one thing you promise the room
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

                    {/* Convincer framing */}
                    <div className={styles.convincerSection}>
                      <div className={styles.convincerTitle}>
                        <Icon icon="ph:broadcast-bold" className="me-1" />Framing
                      </div>
                      <select className={styles.convincerSelect} value={main} onChange={(e) => setMain(e.target.value)}>
                        <option value="">Pick a main convincer profile</option>
                        {Object.keys(convincerArchetypes).map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                      <select className={styles.convincerSelect} value={secondary} onChange={(e) => setSecondary(e.target.value)}>
                        <option value="">No secondary profile</option>
                        {Object.keys(convincerArchetypes).map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Boundary warnings */}
                    {state.boundary_warnings.some((w) => w.violated || !w.checkable) && (
                      <div className={styles.intelGroup}>
                        <div className={styles.groupLabel}>Lines</div>
                        {state.boundary_warnings.filter((w) => w.violated || !w.checkable).map((w) => (
                          <div key={w.item_id} className={styles.warnRow}>
                            <Icon icon={w.checkable ? "ph:prohibit-bold" : "ph:question-bold"} className={w.checkable ? styles.warnRed : styles.warnMuted} />
                            <span>
                              {w.checkable
                                ? `${stakeholderName(w.stakeholder_id)}: this card crosses their line on ${w.target}`
                                : `${stakeholderName(w.stakeholder_id)}: cannot check — you haven't looked at ${w.target}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Uncompensated losses */}
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
                      <StakeholderAvatarComponent avatar={stakeholders[current.stakeholder_id]?.avatar} size={52} />
                      <div className={styles.objHeaderText}>
                        <span className={styles.objStakeholder}>{stakeholderName(current.stakeholder_id)}</span>
                        <span className={`${styles.objKindBadge} ${KIND_CLASS[current.kind]}`}>
                          {current.kind}{current.hard ? " (hard)" : ""}
                        </span>
                      </div>
                      <span className={styles.objProgress}>{objectionIndex + 1} of {state.objections.length}</span>
                    </div>

                    <div className={styles.objText}>"{current.text}"</div>

                    <div className={styles.optionsGrid}>
                      {current.options.map((opt) => (
                        <button
                          key={opt.option}
                          className={styles.optBtn}
                          disabled={!opt.available}
                          title={opt.reason || undefined}
                          onClick={() =>
                            opt.option === "amend"
                              ? setAmendFor(amendFor === current.id ? null : current.id)
                              : answer(current, opt.option)
                          }
                        >
                          <span className={styles.optLabel}>{OPTION_LABELS[opt.option]}</span>
                          {opt.reason && <span className={styles.optReason}>{opt.reason}</span>}
                        </button>
                      ))}
                    </div>

                    {amendFor === current.id && (
                      <div className={styles.intelGroup} style={{ marginTop: 12 }}>
                        <div className={styles.groupLabel}>Add an item that answers this</div>
                        {toChains(state.available_items)
                          .filter((chain) => !state.card_item_ids.includes(chain.newest.id))
                          .map(({ id: chainId, newest: item, older }) => (
                            <div key={chainId} className={styles.intelRow} onClick={() => answer(current, "amend", item.id)}>
                              <span className={`${styles.tagPill} ${TAG_CLASS[item.type]}`}>
                                {intelTagMeta(item.type).shortLabel}
                              </span>
                              <div className={styles.intelMain}>
                                <span className={styles.intelDesc}>{item.description}</span>
                              </div>
                              {older.length > 0 && <span className={styles.chainDepth}>+{older.length}</span>}
                            </div>
                          ))}
                      </div>
                    )}

                    <div className={styles.objNav}>
                      <button className={styles.btnSecondary} disabled={objectionIndex === 0} onClick={() => setObjectionIndex((i) => Math.max(0, i - 1))}>Previous</button>
                      <button className={styles.btnSecondary} disabled={objectionIndex >= state.objections.length - 1} onClick={() => setObjectionIndex((i) => i + 1)}>Next</button>
                    </div>
                  </div>
                )}

                {/* ── COMMIT / DONE ────────────────────────────────────── */}
                {(state.stage === "COMMIT" || state.stage === "DONE") && (
                  <div className={`${styles.outcomeCard} ${styles[`out${state.outcome}`] || ""}`}>
                    <div className={styles.outcomeLabel}>
                      {state.stalemate ? "STALEMATE" : state.outcome}
                    </div>
                    <div className={styles.outcomeDesc}>
                      {state.stalemate
                        ? "Nobody moved. The change does not happen and the world moves on without you."
                        : state.outcome === "PASS"
                          ? "The room is behind the card. It goes in as pitched."
                          : state.outcome === "SOFT_PASS"
                            ? "It goes in, but the people you skipped will remember it."
                            : state.outcome === "CONCEDED"
                              ? "You dropped your card. The opposing side's position applies instead, and the people you gave up on will remember it."
                              : "Blocked. Push it through with an Escalation Point, or rebuild the card."}
                    </div>

                    {/* Buy-in breakdown */}
                    <div className={styles.buyInList}>
                      {state.reads.map((read) => (
                        <div key={read.stakeholder_id} className={styles.buyInRow}>
                          <span className={styles.buyInSt}>{stakeholderName(read.stakeholder_id)}{read.power === "high" && " ★"}</span>
                          <span className={styles.buyInBarWrap}>
                            <span
                              className={styles.buyInBar}
                              style={{
                                width: `${Math.round((read.buy_in ?? (read.band === "green" ? 0.75 : read.band === "amber" ? 0.5 : 0.2)) * 100)}%`,
                                background: read.band === "green" ? "#22c55e" : read.band === "amber" ? "#f59e0b" : "#ef4444",
                                opacity: read.buy_in === null ? 0.45 : 1,
                              }}
                            />
                          </span>
                          <span className={styles.buyInVal}>{read.buy_in === null ? read.band : Math.round(read.buy_in * 100)}</span>
                          {read.boundary_violated && <Icon icon="ph:prohibit-bold" color="#ef4444" />}
                        </div>
                      ))}
                    </div>

                    {state.outcome === "VETO" && !state.stalemate && (
                      <div className={styles.objNav} style={{ justifyContent: "center" }}>
                        <button className={styles.btnDanger} disabled={state.escalation_points <= 0} onClick={() => emit("pitch:veto_breaker", base)}
                          title={state.escalation_points <= 0 ? "No Escalation Points left" : undefined}>
                          Veto Breaker (1 EP)
                        </button>
                        <button className={styles.btnSecondary} onClick={() => emit("pitch:rebuild", base)}>Rebuild the card</button>
                        <button className={styles.btnSecondary} onClick={() => emit("pitch:concede", base)}>Let them have it</button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Dock: cards and conversation, pinned under the work surface */}
              <div className={styles.dockZone}>
              {openSheet === "cards" && cards.length > 0 && (
                <div className={styles.dockSheet}>
                  <div className={styles.dockSheetHeader}>
                    <span className={styles.groupLabel}>Engagement cards · {tokens} tokens</span>
                    <button className="btn-close btn-close-white" onClick={() => setOpenSheet(null)} aria-label="Close" />
                  </div>
                {cards.length > 0 && (
                  <div
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                    onDrop={(e) => {
                                            const cardId = e.dataTransfer.getData("engagementCardId") || e.dataTransfer.getData("cardId");
                      if (!cardId) return;
                      const card = cards.find((c) => c.id === cardId);
                      if (card) handleSelectEngagementCard(card);
                    }}
                  >
                    <div className={styles.groupLabel} style={{ marginTop: 16 }}>
                      Engagement Cards · {tokens} tokens · {state.available_items.length} intel found
                    </div>
                    <EngagementCards
                      attentionTokens={tokens}
                      cards={cards}
                      playedCardIds={playedIds}
                      discoveredIntelCount={state.available_items.length}
                      onOpenPitchModal={() => {}}
                      onSelectCard={handleSelectEngagementCard}
                                                                  isEnabled={!isWaiting}
                    />
                  </div>
                )}
                </div>
              )}
              {openSheet === "chat" && (
                <div className={styles.dockSheet}>
                  <div className={styles.dockSheetHeader}>
                    <span className={styles.groupLabel}>Conversation</span>
                    <button className="btn-close btn-close-white" onClick={() => setOpenSheet(null)} aria-label="Close" />
                  </div>
                {chatMsgsState.length > 0 && (
                  <div className={styles.intelGroup} style={{ marginTop: 16 }}>
                    <div className={styles.groupLabel}>Conversation</div>
                    <StakeholderInteractionArea
                      chatMsgs={chatMsgsState}
                      current_phase={currentPhase}
                      current_challenge={currentChallenge}
                      isEnabled={!isWaiting}
                      actionCards={[]}
                      onHoverCard={() => {}}
                      showStakeholderList={false}
                      showDialogueOptions={false}
                    />
                  </div>
                )}
                </div>
              )}

              {/* Dock */}
              <div className={styles.dock}>
                {cards.length > 0 && (
                  <button
                    className={`${styles.dockBtn} ${openSheet === "cards" ? styles.dockBtnActive : ""}`}
                    onClick={() => setOpenSheet((prev) => (prev === "cards" ? null : "cards"))}
                    disabled={state.stage !== "PREPARE"}
                    title={state.stage === "PREPARE" ? "Play an engagement card" : "Only while preparing"}
                  >
                    <Icon icon="ph:cards-bold" />
                    Cards
                    <span className={styles.dockMeta}>{tokens} tokens</span>
                  </button>
                )}
                <button
                  className={`${styles.dockBtn} ${openSheet === "chat" ? styles.dockBtnActive : ""}`}
                  onClick={() => setOpenSheet((prev) => (prev === "chat" ? null : "chat"))}
                >
                  <Icon icon="ph:chat-circle-text-bold" />
                  Conversation
                  <span className={styles.dockMeta}>{chatMsgsState.length}</span>
                </button>
                <span className={styles.dockMeta}>{state.available_items.length} intel found</span>
                <span className={styles.dockActions}>
                {state.stage === "PREPARE" && (
                  <>
                    <button className={styles.btnSecondary} onClick={saveCard} disabled={selected.length === 0}>
                      Save card
                    </button>
                    <button className={styles.btnPrimary} onClick={startObjections} disabled={selected.length === 0}>
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
