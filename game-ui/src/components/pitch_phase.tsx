/**
 * The merged pitch phase (plan 06): PREPARE, OBJECT, COMMIT on one screen.
 * PREPARE includes engagement cards and stakeholder chat (D37).
 *
 * Every rule lives on the server. This screen sends what the player did and renders the
 * `pitch:state` payload that comes back, so the same card always produces the same objections.
 */

import { useContext, useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";

import { StakeholderContext } from "./StakeholderProvider";
import type { StakeholderAvatar } from "../types/StakeholderAvatar";
import { useGameWebSocket, useWebSocketEvent } from "../services/websocket/useGameWebSocket";
import { intelTagMeta, type IntelTag } from "../types/IntelTag";
import ChallengeDescriptionCard from "./ChallengeDescriptionCard";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import styles from "./pitch_phase.module.css";
import type { EngagementCard } from "../types/EngagementCard";
import EngagementCards from "./EngagementCards";
import EngagementCardTargetModal from "./EngagementCardTargetModal";
import IntelVerificationDialog, { type IntelVerificationResultData } from "./IntelVerificationDialog";
import StakeholderInteractionArea, { type ChatMsg } from "./StakeholderInteractionArea";

const MAX_CARD_ITEMS = 5;

type ObjectionKind = "boundary" | "technical" | "stance" | "price" | "correction";
type OptionName = "amend" | "reframe" | "stonewall" | "emergency_addendum" | "concede_correction";

interface PitchItem {
  id: string;
  stakeholder_id?: string;
  type: IntelTag;
  description: string;
  /** Refinement chain (plan 05): every link of a chain carries the same id. */
  chain_id?: string;
  chain_position?: number;
  chain_length?: number;
}

/** A chain is one selectable item in the builder, pitched as its newest link. */
interface PitchChain {
  id: string;
  newest: PitchItem;
  /** The links the newest one grew out of, oldest first. */
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

interface PitchPhaseProps {
  currentPhase: number;
  currentChallenge: number;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  challengeAmount?: number;
  convincerArchetypes?: Record<string, { name?: string; icon?: string; color?: string }>;
  onEndPitch?: (passed: boolean) => void;
  /** Engagement cards for the PREPARE stage intel-gathering flow (D37). */
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
}: PitchPhaseProps) {
  const { emit, subscribe } = useGameWebSocket();
  const stakeholderCtx = useContext(StakeholderContext);
  const stakeholders = (stakeholderCtx?.stakeholders || {}) as Record<
    string,
    { name?: string; avatar?: StakeholderAvatar }
  >;

  // ── pitch state ──────────────────────────────────────────────────────────
  const [state, setState] = useState<PitchStatePayload | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [main, setMain] = useState<string>("");
  const [secondary, setSecondary] = useState<string>("");
  const [objectionIndex, setObjectionIndex] = useState(0);
  const [amendFor, setAmendFor] = useState<string | null>(null);

  // ── engagement card state (controlled-or-local pattern) ──────────────────
  const [localTokens, setLocalTokens] = useState(8);
  const [localPlayedIds, setLocalPlayedIds] = useState<string[]>([]);
  const [localChatMsgs, setLocalChatMsgs] = useState<ChatMsg[]>([]);
  const [localCardTargetedMap, setLocalCardTargetedMap] = useState<Record<string, string[]>>({});
  const [playingCard, setPlayingCard] = useState<EngagementCard | null>(null);
  const [verificationModal, setVerificationModal] = useState<IntelVerificationResultData | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

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
    [currentPhase, currentChallenge],
  );

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
      // Refresh available items now that more intel has been gathered.
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
          setChatMsgsState((prev) => [...prev, msg]);
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
    return <div className={styles.loadingSpinner}>Getting the room ready...</div>;
  }

  const current = state.objections[Math.min(objectionIndex, state.objections.length - 1)];
  const predictionFor = (itemId: string) => state.predictions.find((p) => p.item_id === itemId);
  const violatedFor = (stId: string) =>
    state.boundary_warnings.filter((w) => w.violated && w.stakeholder_id === stId);

  // One row per refinement chain, not one per note.
  const grouped: Record<string, PitchChain[]> = { boundary: [], driver: [], trade_off: [], fact: [] };
  toChains(state.available_items).forEach((chain) => {
    (grouped[chain.newest.type] ||= []).push(chain);
  });

  // Stakeholder list for the engagement card target modal.
  const availableStakeholderList = Object.entries(stakeholders).map(([id, st]) => ({
    id,
    name: st.name || id,
    avatar: st.avatar,
  }));

  return (
    <div className={styles.root}>
      <div className={styles.challengeHeader}>
        <ChallengeDescriptionCard
          challengeTitle={challengeTitle}
          challengeDescription={challengeDescription}
          challengeIntro={challengeIntro}
          currentChallenge={currentChallenge}
          challengeAmount={challengeAmount}
          is_minimized
        />
        <div className={styles.stageBar}>
          {(["PREPARE", "OBJECT", "COMMIT"] as const).map((stage, i) => (
            <span key={stage}>
              {i > 0 && <span className={styles.stageSep}>›</span>}
              <span
                className={styles.stageChip}
                style={{ opacity: state.stage === stage ? 1 : 0.45 }}
              >
                {stage}
              </span>
            </span>
          ))}
          <span className={styles.slotCount}>
            {selected.length}/{MAX_CARD_ITEMS} slots · {state.escalation_points} escalation
            {state.stage === "OBJECT" && ` · ${state.amendments_left} amendments left`}
          </span>
        </div>
      </div>

      {state.error && <div className={styles.errorBanner}>{state.error}</div>}

      <div className={styles.body}>
        <div className={styles.main}>
          {state.stage === "PREPARE" && (
            <>
              <div className={styles.builderHeader}>
                Build the card: 1 to {MAX_CARD_ITEMS} intel items, any mix.
              </div>
              {(["boundary", "driver", "trade_off", "fact"] as IntelTag[]).map((tag) =>
                (grouped[tag] || []).length === 0 ? null : (
                  <div key={tag} className={styles.intelGroup}>
                    <div className={styles.groupLabel}>
                      {tag === "boundary"
                        ? "Must: lines that must hold"
                        : tag === "driver"
                          ? "Wants: what they are asking for"
                          : tag === "trade_off"
                            ? "Concessions: what they would give up"
                            : "Facts about the system"}
                    </div>
                    {grouped[tag].map(({ id: chainId, newest: item, older }) => {
                      const pick = selected.includes(item.id);
                      const pred = predictionFor(item.id);
                      return (
                        <div
                          key={chainId}
                          className={styles.intelRow}
                          onClick={() => toggleItem(item.id)}
                          style={{ outline: pick ? "1px solid #0d6efd" : undefined }}
                        >
                          <span className={`${styles.tagPill} ${TAG_CLASS[item.type]}`}>
                            {intelTagMeta(item.type).shortLabel}
                          </span>
                          <span className={styles.stName}>{stakeholderName(item.stakeholder_id)}</span>
                          <span className={styles.intelDesc}>
                            {item.description}
                            {older.length > 0 && (
                              <span className={styles.chainOlder}>
                                {older.map((link) => (
                                  <span key={link.id} className={styles.chainLayer}>
                                    {link.description}
                                  </span>
                                ))}
                              </span>
                            )}
                          </span>
                          {older.length > 0 && (
                            <span
                              className={styles.chainDepth}
                              title="One slot: this is the sharpest reading of a note you kept working on."
                            >
                              +{older.length}
                            </span>
                          )}
                          {pick && pred && (
                            <span className={styles.optReason}>
                              {pred.predicted === null || pred.predicted === undefined
                                ? "effect unknown, you have not looked at this yet"
                                : `lands at ${LEVEL_LABELS[pred.predicted]}${
                                    pred.asked !== null &&
                                    pred.asked !== undefined &&
                                    pred.predicted < pred.asked
                                      ? ` (capped by ${pred.capped_by})`
                                      : ""
                                  }`}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ),
              )}

              <div className={styles.convincerSection}>
                <div className={styles.convincerTitle}>Framing</div>
                <select
                  className={styles.convincerSelect}
                  value={main}
                  onChange={(e) => setMain(e.target.value)}
                >
                  <option value="">Pick a main convincer profile</option>
                  {Object.keys(convincerArchetypes).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  className={styles.convincerSelect}
                  value={secondary}
                  onChange={(e) => setSecondary(e.target.value)}
                >
                  <option value="">No secondary profile</option>
                  {Object.keys(convincerArchetypes).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              {/* ── Engagement cards ────────────────────────────────────── */}
              {cards.length > 0 && (
                <div
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
                  onDrop={(e) => {
                    setIsDragging(false);
                    const cardId = e.dataTransfer.getData("engagementCardId") || e.dataTransfer.getData("cardId");
                    if (!cardId) return;
                    const card = cards.find((c) => c.id === cardId);
                    if (card) handleSelectEngagementCard(card);
                  }}
                >
                  <div className={styles.groupLabel} style={{ marginTop: 16 }}>
                    Engagement Cards · {tokens} tokens · {state.available_items.length} intel
                  </div>
                  <EngagementCards
                    attentionTokens={tokens}
                    cards={cards}
                    playedCardIds={playedIds}
                    discoveredIntelCount={state.available_items.length}
                    onOpenPitchModal={() => {}}
                    onSelectCard={handleSelectEngagementCard}
                    onDragCardStart={() => setIsDragging(true)}
                    onDragCardEnd={() => setIsDragging(false)}
                    isEnabled={!isWaiting}
                  />
                </div>
              )}
            </>
          )}

          {state.stage === "OBJECT" && current && (
            <div className={styles.objCard}>
              <div className={styles.objHeader}>
                <StakeholderAvatarComponent
                  avatar={stakeholders[current.stakeholder_id]?.avatar}
                  size={64}
                />
                <span className={styles.objStakeholder}>{stakeholderName(current.stakeholder_id)}</span>
                <span className={`${styles.objKindBadge} ${KIND_CLASS[current.kind]}`}>
                  {current.kind}
                  {current.hard ? " (hard)" : ""}
                </span>
                <span className={styles.objProgress}>
                  {objectionIndex + 1} of {state.objections.length}
                </span>
              </div>
              <div className={styles.objText}>{current.text}</div>

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
                <div className={styles.intelGroup}>
                  <div className={styles.groupLabel}>Add an item that answers this</div>
                  {toChains(state.available_items)
                    .filter((chain) => !state.card_item_ids.includes(chain.newest.id))
                    .map(({ id: chainId, newest: item, older }) => (
                      <div
                        key={chainId}
                        className={styles.intelRow}
                        onClick={() => answer(current, "amend", item.id)}
                      >
                        <span className={`${styles.tagPill} ${TAG_CLASS[item.type]}`}>
                          {intelTagMeta(item.type).shortLabel}
                        </span>
                        <span className={styles.intelDesc}>{item.description}</span>
                        {older.length > 0 && <span className={styles.chainDepth}>+{older.length}</span>}
                      </div>
                    ))}
                </div>
              )}

              <div className={styles.objNav}>
                <button
                  className={styles.btnSecondary}
                  disabled={objectionIndex === 0}
                  onClick={() => setObjectionIndex((i) => Math.max(0, i - 1))}
                >
                  Previous
                </button>
                <button
                  className={styles.btnSecondary}
                  disabled={objectionIndex >= state.objections.length - 1}
                  onClick={() => setObjectionIndex((i) => i + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}

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
              {state.outcome === "VETO" && !state.stalemate && (
                <div className={styles.objNav}>
                  <button
                    className={styles.btnDanger}
                    disabled={state.escalation_points <= 0}
                    onClick={() => emit("pitch:veto_breaker", base)}
                  >
                    Veto Breaker (1 point)
                  </button>
                  <button className={styles.btnSecondary} onClick={() => emit("pitch:rebuild", base)}>
                    Rebuild the card
                  </button>
                  <button className={styles.btnSecondary} onClick={() => emit("pitch:concede", base)}>
                    Let them have it
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={styles.sidebar}>
          <div className={styles.buyInList}>
            {state.reads.map((read) => (
              <div key={read.stakeholder_id} className={styles.buyInRow}>
                <span className={styles.buyInSt}>
                  {stakeholderName(read.stakeholder_id)}
                  {read.power === "high" && " ★"}
                </span>
                <span className={styles.buyInBarWrap}>
                  <span
                    className={styles.buyInBar}
                    style={{
                      width: `${Math.round((read.buy_in ?? (read.band === "green" ? 0.75 : read.band === "amber" ? 0.5 : 0.2)) * 100)}%`,
                      background:
                        read.band === "green" ? "#198754" : read.band === "amber" ? "#fd7e14" : "#dc3545",
                      opacity: read.buy_in === null ? 0.45 : 1,
                    }}
                  />
                </span>
                <span className={styles.buyInVal}>
                  {read.buy_in === null ? read.band : Math.round(read.buy_in * 100)}
                </span>
                {read.boundary_violated && (
                  <Icon icon="ph:prohibit-bold" color="#dc3545" title="a line of theirs is crossed" />
                )}
              </div>
            ))}
          </div>

          {state.boundary_warnings.some((w) => w.violated || !w.checkable) && (
            <div className={styles.intelGroup}>
              <div className={styles.groupLabel}>Lines</div>
              {state.boundary_warnings
                .filter((w) => w.violated || !w.checkable)
                .map((w) => (
                  <div key={w.item_id} className={styles.optReason}>
                    {w.checkable
                      ? `${stakeholderName(w.stakeholder_id)}: this card crosses their line on ${w.target}`
                      : `${stakeholderName(w.stakeholder_id)}: cannot check, you have not looked at ${w.target}`}
                  </div>
                ))}
            </div>
          )}

          {Object.entries(state.uncompensated_losses).some(([, v]) => v > 0) && (
            <div className={styles.intelGroup}>
              <div className={styles.groupLabel}>Uncompensated losses</div>
              {Object.entries(state.uncompensated_losses)
                .filter(([, v]) => v > 0)
                .map(([stId, v]) => (
                  <div key={stId} className={styles.optReason}>
                    {stakeholderName(stId)} loses something and gets nothing back ({Math.round(v * 100)}%)
                  </div>
                ))}
            </div>
          )}

          {/* ── Stakeholder conversation ──────────────────────────────── */}
          {chatMsgsState.length > 0 && (
            <div className={styles.intelGroup}>
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
      </div>

      <div className={styles.footer}>
        {state.stage === "PREPARE" && (
          <>
            <button className={styles.btnSecondary} onClick={saveCard} disabled={selected.length === 0}>
              Save card
            </button>
            <button
              className={styles.btnPrimary}
              onClick={startObjections}
              disabled={selected.length === 0}
            >
              Pitch it
            </button>
          </>
        )}
        {state.stage === "OBJECT" && (
          <button
            className={styles.btnPrimary}
            onClick={() => emit("pitch:commit", base)}
            disabled={state.objections.length > 0 && violatedFor(current?.stakeholder_id || "").length > 0}
          >
            Commit the card
          </button>
        )}
        {(state.stage === "DONE" || state.stalemate) && (
          <button className={styles.btnPrimary} onClick={() => onEndPitch?.(state.outcome === "PASS" || state.outcome === "SOFT_PASS")}>
            Continue
          </button>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
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
