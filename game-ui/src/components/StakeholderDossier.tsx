import React, { useState, useRef, useEffect, useContext } from "react";
import { Icon } from "@iconify/react";
import styles from "./StakeholderDossier.module.css";
import { StakeholderContext } from "./StakeholderProvider";
export type { ConvincerProfileConfig } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import { PhasesContext, isFirstPlayablePhase, type PhaseData } from "./PhaseProvider";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import GlossaryText from "./glossary/GlossaryText";
import { INTEL_TAGS, intelTagMeta } from "../types/IntelTag";
import { faceForEmotionState, iconForEmotionState } from "../utils/emotionFace";
import { healthBucket, healthBucketColor, HEALTH_BUCKET_WORD } from "../utils/systemHealth";

/** Answer key for one authored item. Only sent when the API runs with ENABLE_DOSSIER_DEBUG. */
export interface IntelDebugInfo {
  id: string;
  correct_tag: string;
  description: string;
  target?: string | null;
  level?: number | null;
  stakeholder_id?: string | null;
  refines_id?: string | null;
  artifact?: {
    id: string;
    artifact_type: string;
    speaker_id?: string | null;
    is_known: boolean;
    content: string;
  } | null;
}

/** Answer key for a dossier page. Only sent when the API runs with ENABLE_DOSSIER_DEBUG. */
export interface StakeholderDebugInfo {
  real_archetype?: string | null;
  player_archetype?: string | null;
  archetype_hint?: string | null;
  missing_intel: IntelDebugInfo[];
}

export interface IntelEntry {
  id: string;
  debug?: IntelDebugInfo;
  requirement_id?: string;
  intel_type: string; // e.g. "unconfirmed", "verified"
  categorized_type: string; // an IntelTag: "driver", "boundary", "trade_off" or "fact"
  description: string;
  /** Split wording: the part that holds still whatever the player tags it (bold). */
  fact?: string | null;
  /** Split wording: the part the tag is about; italic while the call is unconfirmed. */
  reading?: string | null;
  is_correct?: boolean;
  /** Where the item came from: "public_record", "offline_artifact", "interview" or "debate". */
  source?: string;
  /** For offline artifacts: which kind of document the player read it off. */
  artifact_type?: string;
  /** Refinement chain (plan 05): every link of one chain carries the same id. */
  chain_id?: string;
  chain_position?: number;
  chain_length?: number;
  refines_id?: string | null;
  /** Authored refinements past this link that the player has not found yet. A count only. */
  locked_links?: number;
  discovered_phase_id?: number | null;
  /** The graph target the note is about, and the stage that target sits in. */
  target?: string | null;
  stage_id?: string | null;
  stage_name?: string | null;
  /** Read off the graph every time: "open", "addressed", "violated" or "stale". */
  status?: string;
  /** This challenge's conflict puts somebody on the other side of this very target. */
  contested?: boolean;
}

export interface StakeholderDossierEntry {
  stakeholder_id: string;
  name: string;
  responsibilities: string;
  priorities: string;
  constraints?: string;
  role_description: string;
  metric_id?: string;
  power?: string;
  interest?: string;
  convincer_archetype?: string;
  convincer_status?: "validated" | "unconfirmed" | "unknown";
  is_validated?: boolean;
  intel_items: IntelEntry[];
  /** How many notes this stakeholder has in the challenge, found or not. */
  intel_total?: number;
  /** The environment page: Facts about the system, not about anybody. */
  is_environment?: boolean;
  /** Stages this challenge is about, which the stage filter starts on. */
  focus_stage_ids?: string[];
  debug?: StakeholderDebugInfo;
}

export interface StakeholderBuyInInfo {
  threshold: number;
  actionCardScore: number;
  dialogueScore: number;
  emotionScore: number;
  total: number;
  isPersuaded: boolean;
  currentEmotion?: string;
}

export interface StakeholderDossierProps {
  isOpen: boolean;
  onClose: () => void;
  dossierData: StakeholderDossierEntry[];
  activeStakeholderId?: string;
  highlightedIntelId?: string | null;
  currentPhase?: number;
  currentChallenge?: number;
  canClose?: boolean;
  isEmbedded?: boolean;
  emotionColors?: Record<string, string>;
  convincerArchetypes?: Record<string, any>;
  buyInInfoMap?: Record<string, StakeholderBuyInInfo>;
  /**
   * Carries the phase briefing's NEW / SHIFTED markers onto the stakeholder
   * tabs. Off by default: only the offline intel phase asks for them.
   */
  showPhaseChangeBadges?: boolean;
  /** Reopens the phase briefing. The button only appears when this is given. */
  onOpenPhaseBriefing?: () => void;
  /** Opens/closes the pipeline view. Button appears in the dossier header. */
  /** When set, notes can be dragged onto the card builder (plan 06). */
  draggableIntel?: boolean;
  onPerformanceToggle?: () => void;
  isPerformanceOpen?: boolean;
  /** Opens/closes the event log. Button appears in the dossier header, next to Performance. */
  onLogToggle?: () => void;
  isLogOpen?: boolean;
  /** Badges the Log button with how many events have been filed so far. */
  logCount?: number;
}

/** One authored item's answer key: true tag, graph target and the artifact it is read off. */
const DebugRequirement: React.FC<{ info: IntelDebugInfo; playerTag?: string }> = ({ info, playerTag }) => (
  <>
    <div className={styles.debugRow}>
      <strong>True tag:</strong>{" "}
      <span className={playerTag === undefined || playerTag === info.correct_tag ? styles.debugRightText : styles.debugWrongText}>
        {info.correct_tag}
      </span>
      {playerTag !== undefined && playerTag !== info.correct_tag && <> (player tagged {playerTag})</>}
    </div>
    <div className={styles.debugRow}>
      <strong>Target:</strong> {info.target ?? "none"}
      {info.level != null && <> at level {info.level}</>}
    </div>
    <div className={styles.debugRow}>
      <strong>Id:</strong> {info.id}
      {info.refines_id && <> (refines {info.refines_id})</>}
    </div>
    <div className={styles.debugRow}>
      <strong>Authored:</strong> {info.description}
    </div>
    {info.artifact ? (
      <div className={styles.debugRow}>
        <strong>
          Hinted by {info.artifact.artifact_type} {info.artifact.id}
          {info.artifact.speaker_id && <> from {info.artifact.speaker_id}</>}
          {info.artifact.is_known && <> (on record at start)</>}:
        </strong>
        <pre className={styles.debugArtifact}>{info.artifact.content}</pre>
      </div>
    ) : (
      <div className={styles.debugRow}>
        <strong>Hinted by:</strong> no offline artifact (interview or debate only)
      </div>
    )}
  </>
);

/** How long the markers keep pulsing when the player never opens their tab. */
const CHANGE_BADGE_PULSE_TIMEOUT_MS = 15000;

/** Dwell on a tab before its marker counts as seen. */
const CHANGE_BADGE_SEEN_MS = 1000;

const TAG_STYLE_CLASS: Record<string, string> = {
  requirement: styles.tagRequirement,
  preference: styles.tagNegotiable,
  friction: styles.tagFriction,
  default: styles.tagFriction,
};

const CATEGORY_META: Record<string, { label: string; icon: string; styleClass: string }> = Object.fromEntries(
  INTEL_TAGS.map((t) => [t.type, { label: t.label, icon: t.emoji, styleClass: TAG_STYLE_CLASS[t.styleKey] }])
);

/** Document wording for the "your read of their ..." caption. */
const ARTIFACT_TYPE_LABEL: Record<string, string> = {
  email: "email",
  slack_message: "Slack message",
  meeting_notes: "meeting notes",
  document: "document",
};

/**
 * Where a note came from. The stamp already says how sure the player can be; this says how it
 * got here, which the stamp cannot: two confirmed notes can have arrived by very different
 * routes. Player language, one line, no system words.
 */
const getSourceCaption = (item: IntelEntry): { icon: string; text: string; title: string } | null => {
  switch ((item.source || "").toLowerCase()) {
    case "public_record":
      return {
        icon: "ph:megaphone-bold",
        text: "Said openly in the team channel",
        title: "They said this in a channel the whole team reads, before you started digging.",
      };
    case "interview":
      return {
        icon: "ph:chats-circle-bold",
        text: "They told you this directly",
        title: "You got this straight from them while gathering intel.",
      };
    case "debate":
      return {
        icon: "ph:microphone-stage-bold",
        text: "Came out during the pitch",
        title: "This surfaced when they pushed back on your proposal.",
      };
    case "offline_artifact":
    default: {
      const label = ARTIFACT_TYPE_LABEL[(item.artifact_type || "").toLowerCase()];
      return {
        icon: "ph:file-text-bold",
        text: label ? `You read their ${label}` : "You read a document",
        title: "You read a document you found. Nobody has confirmed it yet.",
      };
    }
  }
};

type IntelPipStatus = "on_record" | "confirmed" | "unconfirmed" | "hidden";

/** Pips follow the stamps' colours, so they teach the player nothing new. */
const INTEL_PIP_META: Record<IntelPipStatus, { label: string; styleClass: string }> = {
  on_record: { label: "On record", styleClass: styles.pipOnRecord },
  confirmed: { label: "Confirmed", styleClass: styles.pipConfirmed },
  unconfirmed: { label: "Unconfirmed", styleClass: styles.pipUnconfirmed },
  hidden: { label: "Not found yet", styleClass: styles.pipHidden },
};

/** Settled first, so the row fills up from the left like a progress bar. */
const INTEL_PIP_ORDER: IntelPipStatus[] = ["on_record", "confirmed", "unconfirmed", "hidden"];

const getIntelPipStatus = (item: IntelEntry): IntelPipStatus => {
  if ((item.intel_type || "unconfirmed").toLowerCase() !== "verified") return "unconfirmed";
  return (item.source || "").toLowerCase() === "public_record" ? "on_record" : "confirmed";
};

/**
 * One pip per note in the stakeholder's pool: the found ones by stamp, then a hollow one for
 * each still out there. Hollow pips say how many, never what: no category, no source. Found
 * pips go by stamp, never by `is_correct`, so they cannot give away a wrong tag either.
 */
const getIntelPips = (st: StakeholderDossierEntry): IntelPipStatus[] => {
  const found = (st.intel_items || []).map(getIntelPipStatus);
  const hiddenCount = Math.max(0, (st.intel_total ?? 0) - found.length);
  return [...found, ...Array<IntelPipStatus>(hiddenCount).fill("hidden")].sort(
    (a, b) => INTEL_PIP_ORDER.indexOf(a) - INTEL_PIP_ORDER.indexOf(b)
  );
};

/** Hover text for a pip row, e.g. "3 of 4 notes found: 1 on record, 2 unconfirmed". */
const describeIntelPips = (pips: IntelPipStatus[]): string => {
  const countOf = (status: IntelPipStatus) => pips.filter((p) => p === status).length;
  const breakdown = (["on_record", "confirmed", "unconfirmed"] as const)
    .filter((status) => countOf(status) > 0)
    .map((status) => `${countOf(status)} ${INTEL_PIP_META[status].label.toLowerCase()}`);
  const summary = `${pips.length - countOf("hidden")} of ${pips.length} notes found`;
  return breakdown.length > 0 ? `${summary}: ${breakdown.join(", ")}` : summary;
};

/** Stage colours for the filter row and the environment page, from the pipeline view (plan 08). */
const STAGE_META: Record<string, { label: string; color: string }> = {
  req: { label: "Requirements", color: "#7c3aed" },
  data: { label: "Data", color: "#0284c7" },
  model: { label: "Modeling", color: "#16a34a" },
  deploy: { label: "Deployment", color: "#d97706" },
  ops: { label: "Monitoring and Ops", color: "#dc2626" },
  gov: { label: "Governance and Infra", color: "#64748b" },
};

const stageMeta = (id?: string | null): { label: string; color: string } =>
  (id ? STAGE_META[id] : undefined) || { label: id || "Not on the map", color: "#94a3b8" };

/**
 * What the graph currently says about a note. "open" is the quiet default and gets no badge:
 * most notes are open, and a badge on every one of them would say nothing.
 */
const STATUS_META: Record<string, { label: string; title: string; styleClass: string }> = {
  addressed: {
    label: "DONE",
    title: "Somebody already took this as far as they asked for.",
    styleClass: "statusAddressed",
  },
  violated: {
    label: "CROSSED",
    title: "The pipeline as it stands is over this line of theirs.",
    styleClass: "statusViolated",
  },
  stale: {
    label: "OUT OF DATE",
    title: "The system has moved since you wrote this down.",
    styleClass: "statusStale",
  },
};

export interface IntelChain {
  id: string;
  /** The newest link: the headline, and the payload the card builder uses. */
  newest: IntelEntry;
  /** The links it grew out of, oldest first. */
  older: IntelEntry[];
}

/** One card per refinement chain (D24), however many notes went into it. */
const toChains = (items: IntelEntry[]): IntelChain[] => {
  const byChain = new Map<string, IntelEntry[]>();
  (items || []).forEach((item) => {
    const key = item.chain_id || item.id;
    byChain.set(key, [...(byChain.get(key) || []), item]);
  });
  return [...byChain.entries()].map(([id, links]) => {
    const ordered = [...links].sort((a, b) => (a.chain_position ?? 0) - (b.chain_position ?? 0));
    return { id, newest: ordered[ordered.length - 1], older: ordered.slice(0, -1) };
  });
};

/** Everything in a chain the search box should match: every layer, its target and its stage. */
const chainText = (chain: IntelChain): string =>
  [chain.newest, ...chain.older]
    .map((link) => `${link.description || ""} ${link.target || ""} ${link.stage_name || ""}`)
    .join(" ")
    .toLowerCase();

/** Phases are stored from zero and spoken from one, and they have names worth using. */
export const phaseLabel = (phase?: number | null, phases?: PhaseData[]): string => {
  if (phase === null || phase === undefined) return "earlier";
  const named = phases?.[phase]?.phase_name;
  return named || `phase ${phase + 1}`;
};

/** Dock-sized phase names. Deployment is checked before model: "Model Deployment" deploys. */
const PHASE_SHORT_LABELS: Array<[RegExp, string]> = [
  [/requirement/i, "REQ"],
  [/deploy/i, "DEPLOY"],
  [/monitor|usage|operation/i, "OPS"],
  [/data/i, "DATA"],
  [/model/i, "MODEL"],
  [/intro/i, "INTRO"],
];

export const phaseShortLabel = (phase?: number | null, phases?: PhaseData[]): string => {
  if (phase === null || phase === undefined) return "EARLIER";
  const named = phases?.[phase]?.phase_name || "";
  return PHASE_SHORT_LABELS.find(([pattern]) => pattern.test(named))?.[1] || `P${phase + 1}`;
};

export default function StakeholderDossier({
  isOpen,
  onClose,
  dossierData,
  activeStakeholderId,
  highlightedIntelId,
  currentPhase: propPhase,
  currentChallenge: propChallenge = 0,
  canClose = true,
  isEmbedded = false,
  emotionColors: propEmotionColors,
  convincerArchetypes: propConvincerArchetypes,
  buyInInfoMap,
  showPhaseChangeBadges = false,
  onOpenPhaseBriefing,
  draggableIntel = false,
  onPerformanceToggle,
  isPerformanceOpen = false,
  onLogToggle,
  isLogOpen = false,
  logCount,
}: StakeholderDossierProps) {
  const { emit, subscribe } = useGameWebSocket();
  const { stakeholders, emotionColors: contextEmotionColors, convincerArchetypes: contextConvincerArchetypes } = useContext(StakeholderContext) || {
    stakeholders: {},
    emotionColors: {},
    convincerArchetypes: {},
  };
  const activeEmotionColors = propEmotionColors || contextEmotionColors || {};
  const activeConvincerArchetypes = propConvincerArchetypes || contextConvincerArchetypes || {};
  const { metrics } = useContext(MetricsContext) || { metrics: {} };
  const { currentPhase: contextPhase, phases } = useContext(PhasesContext) || {
    currentPhase: 0,
    phases: [],
  };
  const currentPhase = propPhase ?? contextPhase ?? 0;
  const currentChallenge = propChallenge;

  // Badges the Performance button with the project graph's overall health, the same number
  // PerformanceView itself shows. Only asked for when that button exists.
  const [systemHealth, setSystemHealth] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!onPerformanceToggle) return;
    emit("graph:state_request", { phase_id: currentPhase });
    const unsub = subscribe("graph:state", (data: { system_health?: number }) => {
      setSystemHealth(data?.system_health);
    });
    return unsub;
  }, [onPerformanceToggle, currentPhase]);

  const [activeRetagNoteId, setActiveRetagNoteId] = useState<string | null>(null);
  const [isRetaggingConvincer, setIsRetaggingConvincer] = useState<boolean>(false);
  const [hoveredPolaroidStId, setHoveredPolaroidStId] = useState<string | null>(null);
  /** Which answer-key panel is unfolded: a note id, or `page-<stakeholder id>`. Debug builds only. */
  const [openDebugId, setOpenDebugId] = useState<string | null>(null);
  const toggleDebug = (id: string) => setOpenDebugId((prev) => (prev === id ? null : id));

  // Dossier filters (plan 05). `null` means the player has not touched the stage row yet, so it
  // keeps following the challenge's focus stages as those change.
  const [phaseFilter, setPhaseFilter] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [collapseAddressed, setCollapseAddressed] = useState(false);
  const [confFilter, setConfFilter] = useState<"all" | "on_record" | "verified" | "unconfirmed">("all");
  /** The page the player was on before opening the system, so the button toggles back. */
  const lastPersonPage = useRef(0);

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);

  // Track fading out highlight state
  const [fadingOutIntelId, setFadingOutIntelId] = useState<string | null>(null);
  const prevHighlightedIdRef = useRef<string | null | undefined>(highlightedIntelId);
  const fadeOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prevId = prevHighlightedIdRef.current;
    if (prevId && !highlightedIntelId) {
      // Highlight was just removed, trigger fade out
      setFadingOutIntelId(prevId);
      if (fadeOutTimerRef.current) clearTimeout(fadeOutTimerRef.current);
      fadeOutTimerRef.current = setTimeout(() => {
        setFadingOutIntelId(null);
      }, 300); // match fade out animation duration
    } else if (highlightedIntelId) {
      // New highlight active, clear any pending fade-out
      setFadingOutIntelId(null);
      if (fadeOutTimerRef.current) clearTimeout(fadeOutTimerRef.current);
    }
    prevHighlightedIdRef.current = highlightedIntelId;
  }, [highlightedIntelId]);

  // Position state for window dragging
  const [position, setPosition] = useState({ x: 120, y: 60 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const prevDossierRef = useRef<StakeholderDossierEntry[]>(dossierData);

  // Dossier entries that arrived but have not yet played their "appear" animation.
  // Keys are `intel-<stakeholder>-<intel id>` and `convincer-<stakeholder>-<archetype>`.
  const [pendingAppearKeys, setPendingAppearKeys] = useState<Set<string>>(new Set());
  const seenAppearKeysRef = useRef<Set<string> | null>(null);
  const prevIsOpenRef = useRef<boolean>(isOpen);
  const prevActiveStIdRef = useRef<string | undefined>(activeStakeholderId);

  // Smoothly scroll active tab into view when page changes
  useEffect(() => {
    if (activeTabRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [currentPageIndex]);

  // Derive active stakeholders with useMemo
  const effectiveDossierData = React.useMemo<StakeholderDossierEntry[]>(() => {
    const allSts = Object.values(stakeholders || {});
    const activeSts = allSts.filter((st: any) => {
      const metric = metrics[st.metric_id] || Object.values(metrics).find((m: any) => m.id === st.metric_id);
      const metricIntro = metrics[`${st.metric_id}_intro`] || Object.values(metrics).find((m: any) => m.id === `${st.metric_id}_intro`);
      return (
        (metric && metric.phases && metric.phases[currentPhase]) ||
        (metricIntro && metricIntro.phases && metricIntro.phases[currentPhase])
      );
    });
    const targetSts = activeSts.length > 0 ? activeSts : allSts;

    const fallbackList: StakeholderDossierEntry[] = targetSts.map((st: any) => ({
      stakeholder_id: st.id || st.name,
      name: st.name || st.id,
      responsibilities: st.responsibilities || "",
      priorities: st.priorities || "",
      constraints: st.constraints || "",
      role_description: st.role_description || "Project Stakeholder",
      metric_id: st.metric_id || "",
      power: st.power || "low",
      interest: st.interest || "low",
      convincer_archetype: st.convincer_archetype || "",
      intel_items: [],
    }));

    if (dossierData && dossierData.length > 0) {
      return dossierData;
    } else if (fallbackList.length > 0) {
      return fallbackList;
    } else {
      return Object.values(stakeholders || {}).map((st: any) => ({
        stakeholder_id: st.id || st.name,
        name: st.name || st.id,
        responsibilities: st.responsibilities || "",
        priorities: st.priorities || "",
        constraints: st.constraints || "",
        role_description: st.role_description || "Project Stakeholder",
        metric_id: st.metric_id || "",
        power: st.power || "low",
        interest: st.interest || "low",
        convincer_archetype: st.convincer_archetype || "",
        intel_items: [],
      }));
    }
  }, [stakeholders, metrics, currentPhase, dossierData]);

  // The same comparison the phase briefing's radar makes, so the markers here
  // agree with what the player was just shown. Derived rather than handed over,
  // and stable for the whole phase.
  const phaseChanges = React.useMemo(() => {
    const changes = new Map<string, { isNew: boolean; shiftText: string }>();
    if (!showPhaseChangeBadges || !phases || phases.length === 0) return changes;

    const current = phases[currentPhase]?.stakeholder_power_interest || [];
    const previous = isFirstPlayablePhase(phases, currentPhase)
      ? []
      : phases[currentPhase - 1]?.stakeholder_power_interest || [];
    const previousById = new Map(previous.map((ps) => [ps.stakeholder_id, ps]));

    current.forEach((cs) => {
      const prev = previousById.get(cs.stakeholder_id);
      const power = (cs.power || "low").toLowerCase();
      const interest = (cs.interest || "low").toLowerCase();

      if (!prev) {
        changes.set(cs.stakeholder_id, { isNew: true, shiftText: "" });
        return;
      }

      const parts: string[] = [];
      if (prev.power.toLowerCase() !== power) {
        parts.push(`Power: ${prev.power.toUpperCase()} ➔ ${cs.power.toUpperCase()}`);
      }
      if (prev.interest.toLowerCase() !== interest) {
        parts.push(`Interest: ${prev.interest.toUpperCase()} ➔ ${cs.interest.toUpperCase()}`);
      }
      if (parts.length > 0) {
        changes.set(cs.stakeholder_id, { isNew: false, shiftText: parts.join(", ") });
      }
    });

    return changes;
  }, [showPhaseChangeBadges, phases, currentPhase]);

  const phaseChangeKey = Array.from(phaseChanges.keys()).join("|");

  // Markers pulse only until the player has had a fair chance to notice them:
  // either they open that stakeholder's tab, or the timeout runs out. After
  // that the marker stays put, quietly, for the rest of the phase.
  const [pulsingChangeIds, setPulsingChangeIds] = useState<Set<string>>(new Set());
  // Markers the player has read and then navigated away from: those are done
  // with, and the tab goes back to being uncluttered.
  const [dismissedChangeIds, setDismissedChangeIds] = useState<Set<string>>(new Set());
  const previousChangePageRef = useRef<number>(currentPageIndex);

  useEffect(() => {
    setPulsingChangeIds(new Set(phaseChanges.keys()));
    setDismissedChangeIds(new Set());
  }, [phaseChangeKey]);

  // Drop a marker when the player leaves that tab, but only once it has stopped
  // pulsing: a tab flicked past on the way elsewhere was never actually read.
  useEffect(() => {
    const leftIndex = previousChangePageRef.current;
    previousChangePageRef.current = currentPageIndex;
    if (leftIndex === currentPageIndex) return;

    const left = effectiveDossierData[leftIndex];
    if (!left || !phaseChanges.has(left.stakeholder_id)) return;
    if (pulsingChangeIds.has(left.stakeholder_id)) return;

    setDismissedChangeIds((prev) => {
      if (prev.has(left.stakeholder_id)) return prev;
      const next = new Set(prev);
      next.add(left.stakeholder_id);
      return next;
    });
  }, [currentPageIndex, effectiveDossierData, phaseChanges, pulsingChangeIds]);

  useEffect(() => {
    if (phaseChanges.size === 0) return;
    const timer = setTimeout(() => setPulsingChangeIds(new Set()), CHANGE_BADGE_PULSE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phaseChangeKey]);

  // Leaving the tab before the dwell elapses cancels it, so a tab flicked past
  // on the way somewhere else does not count as read.
  useEffect(() => {
    if (pulsingChangeIds.size === 0) return;
    const visible = effectiveDossierData[currentPageIndex];
    if (!visible || !pulsingChangeIds.has(visible.stakeholder_id)) return;

    const timer = setTimeout(() => {
      setPulsingChangeIds((prev) => {
        if (!prev.has(visible.stakeholder_id)) return prev;
        const next = new Set(prev);
        next.delete(visible.stakeholder_id);
        return next;
      });
    }, CHANGE_BADGE_SEEN_MS);

    return () => clearTimeout(timer);
  }, [pulsingChangeIds, currentPageIndex, effectiveDossierData]);

  // Phase filter, search and collapse (plan 05). The row filters by the phase a note was found in,
  // the name its spine shows. An empty selection means no filtering at all, so clearing the row
  // is how the player gets everything back.
  const phaseFilterActive = phaseFilter.size > 0;
  const nowOnly = phaseFilter.size === 1 && phaseFilter.has(currentPhase);

  const phasesOnPage = (st?: StakeholderDossierEntry): number[] => {
    const ids = new Set<number>();
    (st?.intel_items || []).forEach((item) => {
      if (item.discovered_phase_id !== null && item.discovered_phase_id !== undefined) {
        ids.add(item.discovered_phase_id);
      }
    });
    return [...ids].sort((a, b) => a - b);
  };

  const togglePhase = (phase: number) => {
    const next = new Set(phaseFilter);
    if (next.has(phase)) next.delete(phase);
    else next.add(phase);
    setPhaseFilter(next);
  };

  // A note with no phase is never filtered out by phase: it predates the stamp, and filtering it
  // away would lose it entirely.
  /** on record, verified or still unconfirmed: the three states a note can be in. */
  const confidenceOf = (item: { intel_type?: string; source?: string }): "on_record" | "verified" | "unconfirmed" => {
    if ((item.intel_type || "unconfirmed").toLowerCase() !== "verified") return "unconfirmed";
    return (item.source || "").toLowerCase() === "public_record" ? "on_record" : "verified";
  };

  const CONF_ORDER: Record<string, number> = { unconfirmed: 0, verified: 1, on_record: 2 };

  const visibleChains = (st: StakeholderDossierEntry): IntelChain[] => {
    const needle = search.trim().toLowerCase();
    return toChains(st.intel_items || [])
      .filter((chain) => {
        const phase = chain.newest.discovered_phase_id;
        if (phaseFilterActive && phase !== null && phase !== undefined && !phaseFilter.has(phase)) return false;
        if (confFilter !== "all" && confidenceOf(chain.newest) !== confFilter) return false;
        return !needle || chainText(chain).includes(needle);
      })
      // Unconfirmed first: those are the ones still worth doing something about.
      .sort((a, b) => CONF_ORDER[confidenceOf(a.newest)] - CONF_ORDER[confidenceOf(b.newest)]);
  };

  const totalPages = effectiveDossierData.length;
  const environmentIndex = effectiveDossierData.findIndex((st) => st.is_environment);

  const requestPageChange = (targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= totalPages) return;
    if (targetIndex !== environmentIndex) lastPersonPage.current = targetIndex;
    setIsRetaggingConvincer(false);
    setActiveRetagNoteId(null);
    setCurrentPageIndex(targetIndex);
  };

  // Helper to find a stakeholder page index by ID, name, or sub-matches
  const findStakeholderIndex = (stIdentifier?: string | null): number => {
    if (!stIdentifier || !effectiveDossierData.length) return -1;
    const target = stIdentifier.toLowerCase().trim();
    return effectiveDossierData.findIndex((st) => {
      const stId = (st.stakeholder_id || "").toLowerCase().trim();
      const stName = (st.name || "").toLowerCase().trim();
      return (
        stId === target ||
        stName === target ||
        target.includes(stId) ||
        stId.includes(target) ||
        target.includes(stName) ||
        stName.includes(target)
      );
    });
  };

  // Helper to find stakeholder page index that contains a given intel item
  const findStakeholderIndexByIntelId = (intelId?: string | null): number => {
    if (!intelId || !effectiveDossierData.length) return -1;
    return effectiveDossierData.findIndex((st) =>
      st.intel_items?.some(
        (item) =>
          item.id === intelId ||
          String(item.id) === String(intelId) ||
          (item.description && item.description === intelId)
      )
    );
  };

  // Auto-switch page when opened or when activeStakeholderId or highlightedIntelId changes
  useEffect(() => {
    if (!isOpen || effectiveDossierData.length === 0) return;

    // 1. If an intel item is highlighted, prioritize jumping to that intel item's owner page
    if (highlightedIntelId) {
      const intelOwnerIdx = findStakeholderIndexByIntelId(highlightedIntelId);
      if (intelOwnerIdx !== -1) {
        if (intelOwnerIdx !== currentPageIndex) {
          setCurrentPageIndex(intelOwnerIdx);
        }
        return;
      }
    }

    // 2. If activeStakeholderId is provided and changed (or just opened), jump to stakeholder page
    const justOpened = isOpen && !prevIsOpenRef.current;
    const activeStChanged = activeStakeholderId !== prevActiveStIdRef.current;

    if (activeStakeholderId && (justOpened || activeStChanged)) {
      const stIdx = findStakeholderIndex(activeStakeholderId);
      if (stIdx !== -1 && stIdx !== currentPageIndex) {
        setCurrentPageIndex(stIdx);
      }
    }

    prevIsOpenRef.current = isOpen;
    prevActiveStIdRef.current = activeStakeholderId;
  }, [isOpen, activeStakeholderId, highlightedIntelId, effectiveDossierData]);

  // Auto-scroll to highlighted intel sticky note
  useEffect(() => {
    if (!highlightedIntelId) return;

    // Small delay to allow DOM render after possible page switch
    const scrollTimer = setTimeout(() => {
      const el =
        document.getElementById(`intel-sticky-${highlightedIntelId}`) ||
        document.querySelector(`[data-intel-id="${highlightedIntelId}"]`) ||
        document.querySelector(`[data-requirement-id="${highlightedIntelId}"]`) ||
        (highlightedIntelId ? document.querySelector(`[data-intel-description="${CSS.escape(highlightedIntelId)}"]`) : null);

      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 60);

    return () => clearTimeout(scrollTimer);
  }, [highlightedIntelId, currentPageIndex]);

  // Detect when artifact tagging adds new intel to a stakeholder & auto-switch to their page
  useEffect(() => {
    if (dossierData && dossierData.length > 0 && prevDossierRef.current) {
      for (const newSt of dossierData) {
        const oldSt = prevDossierRef.current.find(
          (s) => s.stakeholder_id === newSt.stakeholder_id || s.name === newSt.name
        );
        const oldCount = oldSt?.intel_items?.length || 0;
        const newCount = newSt?.intel_items?.length || 0;
        if (newCount > oldCount) {
          const targetIdx = effectiveDossierData.findIndex(
            (s) => s.stakeholder_id === newSt.stakeholder_id || s.name === newSt.name
          );
          if (targetIdx !== -1) {
            requestPageChange(targetIdx);
          }
          break;
        }
      }
    }
    prevDossierRef.current = dossierData;
  }, [dossierData, effectiveDossierData]);

  // All animatable keys a stakeholder page currently holds. The convincer key carries the
  // archetype itself so re-tagging to a different archetype counts as a new appearance.
  // On-record notes are left out: the game deals them at the start of a challenge, so they
  // are never something the player added.
  const appearKeysForStakeholder = (st: StakeholderDossierEntry): string[] => {
    const keys = (st.intel_items || [])
      .filter((item) => item.id && (item.source || "").toLowerCase() !== "public_record")
      .map((item) => `intel-${st.stakeholder_id}-${item.id}`);
    const archetype = st.convincer_archetype || stakeholders[st.stakeholder_id]?.convincer_archetype;
    if (archetype) keys.push(`convincer-${st.stakeholder_id}-${archetype}`);
    return keys;
  };

  // Flag intel items and convincer archetypes that the previous dossier payload did not have
  useEffect(() => {
    // The placeholder pages built from context are not a payload. Taking the baseline from
    // them would make everything in the first real payload look freshly added.
    if (!dossierData || dossierData.length === 0) return;

    const currentKeys = new Set<string>();
    for (const st of effectiveDossierData) {
      for (const key of appearKeysForStakeholder(st)) {
        currentKeys.add(key);
      }
    }

    const seen = seenAppearKeysRef.current;
    seenAppearKeysRef.current = currentKeys;

    // Finding something only ever adds notes. A payload that drops some is a reload (a new
    // challenge, a restored game, Reset all), so it becomes the new baseline and nothing in
    // it is "new". The first payload is a baseline too.
    const isReload =
      seen === null || [...seen].some((key) => key.startsWith("intel-") && !currentKeys.has(key));
    if (isReload) {
      setPendingAppearKeys((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    const added = [...currentKeys].filter((key) => !seen.has(key));
    if (added.length === 0) return;

    setPendingAppearKeys((prev) => new Set([...prev, ...added]));
  }, [dossierData, effectiveDossierData, stakeholders]);

  // Consume a flag only while its own page is on screen. Tagging an artifact during offline
  // intel gathering flips the dossier to the next artifact's stakeholder almost immediately,
  // so a flag consumed on a timer alone would be spent while the card is off-screen. Pending
  // flags survive until that tab is visited.
  const visibleAppearSt = effectiveDossierData[currentPageIndex];
  const playingAppearKeys = visibleAppearSt
    ? appearKeysForStakeholder(visibleAppearSt).filter((key) => pendingAppearKeys.has(key))
    : [];
  // Keyed on the keys themselves, not the data objects: a dossier or emotion update landing
  // mid-animation would otherwise restart the timer, and if those keep coming the flag is
  // never spent and replays on every return to the tab.
  const playingAppearSignature = playingAppearKeys.join("|");

  useEffect(() => {
    if (!playingAppearSignature) return;
    const playingKeys = playingAppearSignature.split("|");

    // Leaving the page before this fires cancels it, so the animation replays on return
    const timer = setTimeout(() => {
      setPendingAppearKeys((prev) => {
        const next = new Set(prev);
        playingKeys.forEach((key) => next.delete(key));
        return next;
      });
    }, 1000); // slightly longer than the appear animations

    return () => clearTimeout(timer);
  }, [currentPageIndex, playingAppearSignature]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        setPosition({
          x: e.clientX - dragStartRef.current.x,
          y: e.clientY - dragStartRef.current.y,
        });
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  if (!isOpen) return null;

  /**
   * Verified intel comes from two different places and players could not tell them apart:
   * items the game hands them already true because the stakeholder said it in public, and
   * items they earned by confirming a guess. Same confidence, different story, two stamps.
   */
  const renderRubberStamp = (conf: string, isPublicRecord = false) => {
    const lower = conf ? conf.toLowerCase() : "unconfirmed";
    if (lower === "verified") {
      if (isPublicRecord) {
        return (
          <div
            className={`${styles.rubberStamp} ${styles.stampOnRecord}`}
            title="On Record: they said this openly, in a channel the whole team reads, before you started digging. Nothing left to confirm."
          >
            ★ ON RECORD
          </div>
        );
      }
      return (
        <div
          className={`${styles.rubberStamp} ${styles.stampVerified}`}
          title="Confirmed: you verified this yourself by talking to them."
        >
          ✓ CONFIRMED
        </div>
      );
    }
    return (
      <div
        className={`${styles.rubberStamp} ${styles.stampUnconfirmed}`}
        title="Unconfirmed: Confirm this item by selecting it during the Intel Verification phase, or through dialogue in the Pitch & Debate phase."
      >
        ? UNCONFIRMED
      </div>
    );
  };

  const handleReTagIntel = (intelId: string, newType: string) => {
    setActiveRetagNoteId(null);
    emit("intel:tag_item", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
      intel_id: intelId,
      categorized_type: newType,
    });
    emit("intel:get_dossier", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
    });
  };

  const handleReTagConvincer = (stakeholderId: string, newArchetype: string) => {
    setIsRetaggingConvincer(false);
    emit("intel:tag_convincer", {
      stakeholder_id: stakeholderId,
      categorized_archetype: newArchetype,
    });
    emit("intel:get_dossier", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
    });
  };

  const getStakeholderColor = (st: any): string => {
    if (!st) return "#38bdf8";
    const stId = st.stakeholder_id || st.id;
    const stObj = stakeholders[stId] || st;
    return stObj.stakeholder_color || (stObj.metric_id && metrics[stObj.metric_id]?.metric_color) || "#38bdf8";
  };

  /** The phase row, the search box and the collapse toggle, shared by both dossier views. */
  const renderFilterBar = (st: StakeholderDossierEntry, hiddenByFilter: number) => {
    const pagePhases = phasesOnPage(st);
    const nowLabel = phaseLabel(currentPhase, phases);
    const hasNowNotes = pagePhases.includes(currentPhase);
    return (
      <div className={styles.filterBar}>
        {pagePhases.length > 0 && (
          <div className={styles.phaseRow}>
            <button
              className={`${styles.phaseChip} ${styles.phaseChipNow} ${nowOnly ? styles.phaseChipOn : ""}`}
              onClick={() => setPhaseFilter(nowOnly ? new Set() : new Set([currentPhase]))}
              disabled={!hasNowNotes && !nowOnly}
              aria-pressed={nowOnly}
              title={
                nowOnly
                  ? "Show notes from every phase again"
                  : hasNowNotes
                    ? `Show only what you found in ${nowLabel}, the phase you are in`
                    : `Nothing found in ${nowLabel} yet`
              }
            >
              Now
            </button>
            {/* The dock has room for a word per phase; the full name is on the spine and in the tooltip. */}
            <div className={styles.phaseGroup}>
              {pagePhases.map((phase) => {
                const label = phaseLabel(phase, phases);
                const on = phaseFilter.has(phase);
                return (
                  <button
                    key={phase}
                    className={`${styles.phaseChip} ${on ? styles.phaseChipOn : ""}`}
                    onClick={() => togglePhase(phase)}
                    aria-pressed={on}
                    title={on ? `Stop filtering on ${label}` : `Show only what you found in ${label}`}
                  >
                    {phaseShortLabel(phase, phases)}
                  </button>
                );
              })}
            </div>
            {phaseFilterActive && (
              <button
                className={styles.phaseChipClear}
                onClick={() => setPhaseFilter(new Set())}
                title="Show notes from every phase again"
                aria-label="Show every phase"
              >
                <Icon icon="ph:x-bold" />
              </button>
            )}
          </div>
        )}
        <div className={styles.filterControls}>
          <label className={styles.searchBox}>
            <Icon icon="ph:magnifying-glass-bold" />
            <input
              type="search"
              value={search}
              placeholder="Search your notes"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className={styles.confFilters}>
            {([
              ["all", "ph:stack-bold", "All", "Everything you have written down"],
              ["unconfirmed", "ph:question-bold", "Unconfirmed", "You have not checked these yet. Wrong ones cost you in the room."],
              ["verified", "ph:check-circle-bold", "Verified", "You checked these yourself."],
              ["on_record", "ph:star-bold", "On record", "Said openly to the whole team. Nothing left to confirm."],
            ] as const).map(([key, icon, label, hint]) => (
              <button
                key={key}
                className={`${styles.confChip} ${confFilter === key ? styles.confChipOn : ""}`}
                onClick={() => setConfFilter(key)}
                title={`${label}: ${hint}`}
                aria-label={label}
              >
                <Icon icon={icon} />
                <span className={styles.confTip}>{label}</span>
              </button>
            ))}
          </div>
        </div>
        {hiddenByFilter > 0 && (
          <div className={styles.filterHint}>
            {hiddenByFilter} {hiddenByFilter === 1 ? "note is" : "notes are"} hidden by the phase row
            or the search box.
          </div>
        )}
      </div>
    );
  };

  const renderPageContent = (st: StakeholderDossierEntry) => {
    if (!st) return null;

    const allChains = toChains(st.intel_items || []);
    // The environment page reads stage by stage, so its cards arrive already in stage order.
    const pageChains = visibleChains(st).sort((a, b) =>
      st.is_environment ? (a.newest.stage_id || "~").localeCompare(b.newest.stage_id || "~") : 0
    );
    const hiddenByFilter = allChains.length - pageChains.length;
    const hasIntelEntries = st && st.intel_items && st.intel_items.length > 0;
    const intelPips = getIntelPips(st);
    const hiddenIntelCount = intelPips.filter((status) => status === "hidden").length;
    const stObj = stakeholders[st.stakeholder_id];
    const avatar = stObj?.avatar;
    const stakeholderColor = getStakeholderColor(st);
    const emotionDisplay = stObj?.emotional_state || "neutral";
    const emotionColor =
      activeEmotionColors[emotionDisplay] ||
      activeEmotionColors[emotionDisplay.toLowerCase()] ||
      "#64748b";

    const convincerArchetypeName = st.convincer_archetype || stObj?.convincer_archetype;
    const convincerProfileConfig = convincerArchetypeName ? activeConvincerArchetypes[convincerArchetypeName] : null;
    const isNewConvincer = Boolean(
      convincerArchetypeName &&
      pendingAppearKeys.has(`convincer-${st.stakeholder_id}-${convincerArchetypeName}`)
    );

    return (
      <>
        {/* Only the wall of notes scrolls. The dock below it is a sibling of this
            box, not an item inside it, so it always ends up on the page's edge. */}
        <div className={styles.pageScroll}>
        {st.is_environment ? (
          <div className={styles.environmentHeader}>
            <Icon icon={intelTagMeta("fact").icon} className={styles.environmentIcon} />
            <div>
              <div className={styles.environmentTitle}>The System</div>
              <div className={styles.environmentSubtitle}>
                What you have worked out about the pipeline itself. Nobody's wish, just the state
                of things.
              </div>
            </div>
          </div>
        ) : (
          <>
        {/* Header: Polaroid Snapshot Frame with Caption + Main Info */}
        <div className={styles.sketchbookHeader}>
          <div
            className={styles.polaroidFrame}
            onMouseEnter={() => setHoveredPolaroidStId(st.stakeholder_id)}
            onMouseLeave={() => setHoveredPolaroidStId(null)}
          >
            <div className={styles.sellotape} />
            <div className={styles.avatarBox}>
              <StakeholderAvatarComponent
                avatar={avatar}
                emotion={faceForEmotionState(emotionDisplay)}
                stakeholderColor={stakeholderColor}
                stakeholderId={st.stakeholder_id}
                isFramed={false}
                play_blink_animation={false}
                size="100%"
                title={st.name}
                isHovered={hoveredPolaroidStId === st.stakeholder_id}
              />
            </div>
            <div className={styles.polaroidCaption}>
              <span
                className={styles.highlightMarker}
                style={{
                  background: `linear-gradient(180deg, transparent 48%, ${stakeholderColor}66 48%)`,
                }}
              >
                {st.name}
              </span>
            </div>
          </div>

          <div className={styles.stakeholderMainInfo}>
            <div className={styles.stakeholderRole}>
              <strong className={styles.fieldLabel}>Role:</strong>{" "}
              <GlossaryText
                text={st.role_description || "Project Stakeholder"}
                surface="dossier_profile"
              />
            </div>
            <div className={styles.stakeholderMetaRow}>
              <div
                className={styles.powerInterestBadge}
                title={`Emotional State: "${emotionDisplay}"`}
              >
                <Icon
                  icon={iconForEmotionState(emotionDisplay)}
                  className={styles.metricIcon}
                  style={{ color: emotionColor }}
                />
                <span style={{ color: emotionColor, fontWeight: 700 }}>
                  {emotionDisplay.toUpperCase()}
                </span>
              </div>
              <div
                className={styles.powerInterestBadge}
                title={`Power: ${(st.power || stObj?.power || "low").toUpperCase()} (${
                  (st.power || stObj?.power || "").toLowerCase() === "high"
                    ? "strong authority"
                    : "limited authority"
                })`}
              >
                <Icon
                  icon="ph:lightning-bold"
                  className={styles.metricIcon}
                  style={{
                    color: (st.power || stObj?.power || "").toLowerCase() === "high" ? "#dc2626" : "#2563eb",
                  }}
                />
                <span
                  style={{
                    color: (st.power || stObj?.power || "").toLowerCase() === "high" ? "#dc2626" : "#2563eb",
                    fontWeight: 700,
                  }}
                >
                  {(st.power || stObj?.power || "low").toUpperCase()}
                </span>
              </div>
              <div
                className={styles.powerInterestBadge}
                title={`Interest: ${(st.interest || stObj?.interest || "low").toUpperCase()} (${
                  (st.interest || stObj?.interest || "").toLowerCase() === "high"
                    ? "closely engaged"
                    : "loosely engaged"
                })`}
              >
                <Icon
                  icon="ph:eye-bold"
                  className={styles.metricIcon}
                  style={{
                    color: (st.interest || stObj?.interest || "").toLowerCase() === "high" ? "#dc2626" : "#2563eb",
                  }}
                />
                <span
                  style={{
                    color: (st.interest || stObj?.interest || "").toLowerCase() === "high" ? "#dc2626" : "#2563eb",
                    fontWeight: 700,
                  }}
                >
                  {(st.interest || stObj?.interest || "low").toUpperCase()}
                </span>
              </div>
              {intelPips.length > 0 && (
                <div className={styles.powerInterestBadge} title={describeIntelPips(intelPips)}>
                  <Icon icon="ph:push-pin-bold" className={`${styles.metricIcon} ${styles.intelBadgeInk}`} />
                  <span className={styles.intelPips}>
                    {intelPips.map((status, idx) => (
                      <span
                        key={idx}
                        className={`${styles.intelPip} ${INTEL_PIP_META[status].styleClass}`}
                        title={INTEL_PIP_META[status].label}
                      />
                    ))}
                  </span>
                  <span className={styles.intelBadgeInk} style={{ fontWeight: 700 }}>
                    {intelPips.length - hiddenIntelCount}/{intelPips.length}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Convincer Profile & Persuasion Strategy Card */}
        {convincerArchetypeName ? (
          <div
            className={`${styles.convincerCard} ${isRetaggingConvincer ? styles.retagActive : ""} ${isNewConvincer ? styles.newConvincerCard : ""}`}
          >
            <div className={styles.convincerVerticalSpine}>
              <span className={styles.convincerVerticalText}>Convincer</span>
            </div>
            <div className={styles.convincerMainBody}>
              <div className={styles.convincerTopRow}>
                <div className={styles.convincerTagArea}>
                  {!(st.is_validated || st.convincer_status === "validated") ? (
                    <button
                      className={styles.archetypeChip}
                      style={{
                        borderColor: convincerProfileConfig?.color || "#2563eb",
                        color: convincerProfileConfig?.color || "#2563eb",
                        backgroundColor: `${convincerProfileConfig?.color || "#2563eb"}14`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsRetaggingConvincer(!isRetaggingConvincer);
                      }}
                      title="Click to re-tag this stakeholder's convincer archetype"
                    >
                      <span>
                        {convincerProfileConfig?.icon || "🎯"} {convincerProfileConfig?.label || convincerProfileConfig?.name || convincerArchetypeName}
                      </span>
                      <span className={styles.reTagIconBtn} aria-label="Re-tag">
                        <Icon icon="ph:pencil-simple-bold" />
                      </span>
                    </button>
                  ) : (
                    <span
                      className={styles.archetypeChipStatic}
                      style={{
                        borderColor: convincerProfileConfig?.color || "#2563eb",
                        color: convincerProfileConfig?.color || "#2563eb",
                        backgroundColor: `${convincerProfileConfig?.color || "#2563eb"}14`,
                      }}
                    >
                      <span>
                        {convincerProfileConfig?.icon || "🎯"} {convincerProfileConfig?.label || convincerProfileConfig?.name || convincerArchetypeName}
                      </span>
                    </span>
                  )}
                </div>
                <div className={styles.cardCornerStamp}>
                  {renderRubberStamp(st.is_validated || st.convincer_status === "validated" ? "verified" : "unconfirmed")}
                </div>
              </div>

              {/* Interactive Re-tag Picker Popover for Convincer Archetype */}
              {isRetaggingConvincer && (
                <div className={styles.retagPopover} onClick={(e) => e.stopPropagation()}>
                  <div className={styles.retagPopoverTitle}>Re-tag Convincer Archetype:</div>
                  <div className={styles.retagOptionsGrid}>
                    {Object.entries(activeConvincerArchetypes).map(([archName, archConfig]) => (
                      <button
                        key={archName}
                        className={`${styles.retagOptionBtn} ${archName === convincerArchetypeName ? styles.activeOptionBtn : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReTagConvincer(st.stakeholder_id, archName);
                        }}
                      >
                        {archConfig.icon || "🎯"} {archConfig.label || archConfig.name || archName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {convincerProfileConfig?.strategy && (
                <div className={styles.convincerStrategyText}>
                  <span className={styles.strategyBulb}>💡</span>
                  <span>
                    <strong>Strategy:</strong>{" "}
                    <GlossaryText text={convincerProfileConfig.strategy} surface="dossier_profile" />
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={`${styles.convincerCard} ${isRetaggingConvincer ? styles.retagActive : ""}`} style={{ opacity: 0.85, background: "rgba(241, 245, 249, 0.7)" }}>
            <div className={styles.convincerVerticalSpine}>
              <span className={styles.convincerVerticalText}>Convincer</span>
            </div>
            <div className={styles.convincerMainBody}>
              <div className={styles.convincerTopRow}>
                <div className={styles.convincerTagArea}>
                  <button
                    className={styles.archetypeChip}
                    style={{ borderColor: "#94a3b8", color: "#64748b", backgroundColor: "#f1f5f9" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsRetaggingConvincer(!isRetaggingConvincer);
                    }}
                    title="Click to categorize this stakeholder's convincer archetype"
                  >
                    <em>Uncategorized Archetype</em>
                    <span className={styles.reTagIconBtn} aria-label="Set Archetype">
                      <Icon icon="ph:pencil-simple-bold" />
                    </span>
                  </button>
                </div>
                <div className={styles.cardCornerStamp}>
                  {renderRubberStamp("unconfirmed")}
                </div>
              </div>

              {/* Interactive Re-tag Picker Popover for Uncategorized Convincer */}
              {isRetaggingConvincer && (
                <div className={styles.retagPopover} onClick={(e) => e.stopPropagation()}>
                  <div className={styles.retagPopoverTitle}>Select Convincer Archetype:</div>
                  <div className={styles.retagOptionsGrid}>
                    {Object.entries(activeConvincerArchetypes).map(([archName, archConfig]) => (
                      <button
                        key={archName}
                        className={styles.retagOptionBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReTagConvincer(st.stakeholder_id, archName);
                        }}
                      >
                        {archConfig.icon || "🎯"} {archConfig.label || archConfig.name || archName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.convincerStrategyText} style={{ color: "#94a3b8", fontStyle: "italic" }}>
                <span className={styles.strategyBulb}>💡</span>
                <span>Categorize this stakeholder's archetype to reveal their effective communication strategy.</span>
              </div>
            </div>
          </div>
        )}

        {/* Buy-In / Persuasion Breakdown Bar Card (Rendered during Pitch Debate when buyInInfoMap prop is provided) */}
        {(() => {
          const buyInInfo = buyInInfoMap ? (buyInInfoMap[st.stakeholder_id] || buyInInfoMap[st.name]) : undefined;
          if (!buyInInfo) return null;

          return (
            <div className={styles.buyInCard}>
              <div className={styles.buyInVerticalSpine}>
                <span className={styles.buyInVerticalText}>Buy-In</span>
              </div>
              <div className={styles.buyInMainBody}>
                {/* Top row: Label, Target & Status badge */}
                <div className={styles.buyInTopRow}>
                  <div className="d-flex align-items-center gap-2">
                    <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#1e293b" }}>
                      ⚖️ Buy-In Progress
                    </span>
                    <span
                      className={`badge ${buyInInfo.isPersuaded ? "bg-success" : "bg-danger"}`}
                      style={{ fontSize: "0.62rem" }}
                    >
                      {buyInInfo.isPersuaded ? "✅ Persuaded" : "⚠️ Resistant"} ({Math.round(buyInInfo.total * 100)}%)
                    </span>
                  </div>
                  <span style={{ fontSize: "0.65rem", color: "#64748b", fontWeight: 600 }}>
                    Target: <strong>{Math.round(buyInInfo.threshold * 100)}%</strong>
                  </span>
                </div>

                {/* Stacked Progress Bar with Threshold Marker Notch */}
                <div className="progress position-relative" style={{ height: "16px", backgroundColor: "#e2e8f0", borderRadius: "4px" }}>
                  {/* Threshold Marker Notch */}
                  <div
                    style={{
                      position: "absolute",
                      left: `${Math.min(99, Math.max(1, buyInInfo.threshold * 100))}%`,
                      top: "-2px",
                      bottom: "-2px",
                      width: "3px",
                      backgroundColor: "#dc3545",
                      zIndex: 5,
                      borderRadius: "1px",
                    }}
                    title={`Required Threshold: ${Math.round(buyInInfo.threshold * 100)}%`}
                  />

                  {buyInInfo.actionCardScore > 0 && (
                    <div
                      className="progress-bar bg-primary"
                      role="progressbar"
                      style={{ width: `${Math.min(100, buyInInfo.actionCardScore * 100)}%` }}
                      title={`Action Card Intel: +${Math.round(buyInInfo.actionCardScore * 100)}%`}
                    >
                      {buyInInfo.actionCardScore >= 0.12 && `+${Math.round(buyInInfo.actionCardScore * 100)}%`}
                    </div>
                  )}
                  {buyInInfo.dialogueScore > 0 && (
                    <div
                      className="progress-bar bg-info text-dark"
                      role="progressbar"
                      style={{ width: `${Math.min(100, buyInInfo.dialogueScore * 100)}%` }}
                      title={`Dialogue Engagement: +${Math.round(buyInInfo.dialogueScore * 100)}%`}
                    >
                      {buyInInfo.dialogueScore >= 0.12 && `+${Math.round(buyInInfo.dialogueScore * 100)}%`}
                    </div>
                  )}
                  {buyInInfo.emotionScore > 0 && (
                    <div
                      className="progress-bar bg-success"
                      role="progressbar"
                      style={{ width: `${Math.min(100, buyInInfo.emotionScore * 100)}%` }}
                      title={`Emotional State (${buyInInfo.currentEmotion || "neutral"}): +${Math.round(buyInInfo.emotionScore * 100)}%`}
                    >
                      {buyInInfo.emotionScore >= 0.12 && `+${Math.round(buyInInfo.emotionScore * 100)}%`}
                    </div>
                  )}
                </div>

                {/* Breakdown Legend Row */}
                <div className={styles.buyInLegendRow}>
                  <span>🃏 Card: <b>+{Math.round(buyInInfo.actionCardScore * 100)}%</b></span>
                  <span>💬 Dialogue: <b>+{Math.round(buyInInfo.dialogueScore * 100)}%</b></span>
                  <span>🎭 Emotion: <b>+{Math.round(buyInInfo.emotionScore * 100)}%</b></span>
                </div>
              </div>
            </div>
          );
        })()}

          </>
        )}

        {/* Intelligence Section Header */}
        <div className={styles.sectionTitle}>
          <span className={styles.doodleIcon}></span>{" "}
          {st.is_environment ? "Facts by stage" : "Challenge-Specific Stance"}
          <span className={styles.sectionTitleActions}>
          <button
            className={`${styles.collapseToggle} ${collapseAddressed ? styles.collapseToggleOn : ""}`}
            onClick={() => setCollapseAddressed(!collapseAddressed)}
            title="Fold the notes somebody has already acted on down to one line each"
          >
            <Icon
              icon={collapseAddressed ? "ph:arrows-out-line-vertical-bold" : "ph:arrows-in-line-vertical-bold"}
            />
            <span>Collapse done</span>
          </button>
          </span>
        </div>

        {st.debug && (
          <div className={styles.debugPanel}>
            <button className={styles.debugPanelTitle} onClick={() => toggleDebug(`page-${st.stakeholder_id}`)}>
              <Icon icon="ph:bug-bold" /> Answer key (debug): {st.debug.missing_intel.length} not found yet
              {!st.is_environment && (
                <>
                  , real archetype{" "}
                  <span
                    className={
                      st.debug.real_archetype && st.debug.real_archetype === st.debug.player_archetype
                        ? styles.debugRightText
                        : styles.debugWrongText
                    }
                  >
                    {st.debug.real_archetype || "none"}
                  </span>
                </>
              )}
            </button>
            {openDebugId === `page-${st.stakeholder_id}` && (
              <>
                {st.debug.archetype_hint && (
                  <div className={styles.debugRow}>
                    <strong>Archetype hint:</strong>
                    <pre className={styles.debugArtifact}>{st.debug.archetype_hint}</pre>
                  </div>
                )}
                {st.debug.missing_intel.map((info) => (
                  <div key={info.id} className={styles.debugMissing}>
                    <DebugRequirement info={info} />
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* One card per refinement chain: the newest link is the headline (D24) */}
        {pageChains.length > 0 ? (
          <div className={styles.stickyNoteGrid}>
            {pageChains.map((chain, idx) => {
              const item = chain.newest;
              if (collapseAddressed && item.status === "addressed") {
                return (
                  <button
                    key={`${st.stakeholder_id}-collapsed-${item.id}`}
                    className={styles.collapsedNote}
                    onClick={() => setCollapseAddressed(false)}
                    title="Already taken as far as they asked for. Click to unfold every note again."
                  >
                    <span>{(CATEGORY_META[item.categorized_type || "driver"] || CATEGORY_META.driver).icon}</span>
                    <span className={styles.collapsedText}>{item.description}</span>
                    <span className={`${styles.statusBadge} ${styles.statusAddressed}`}>DONE</span>
                  </button>
                );
              }
              const typeKey = item.categorized_type || "driver";
              const catMeta = CATEGORY_META[typeKey] || CATEGORY_META.driver;
              const noteId = item.id || `note-${idx}`;
              const isUnconfirmed = (item.intel_type || "unconfirmed").toLowerCase() === "unconfirmed";
              // Split items carry a fact that holds still and a reading that changes with the tag:
              // bold the fact, italicise the reading while it is unconfirmed. Legacy items only have
              // one sentence, and the only span that reliably survives a re-tag is the name.
              const noteDescription = item.description || "";
              const hasSplit = Boolean(item.fact);
              const hasSubjectLead = Boolean(st.name) && noteDescription.startsWith(st.name);
              const noteSubject = hasSplit ? item.fact || "" : hasSubjectLead ? st.name : "";
              const noteReading = hasSplit
                ? ` ${item.reading || ""}`
                : hasSubjectLead
                ? noteDescription.slice(st.name.length)
                : noteDescription;
              const isPublicRecord = (item.source || "").toLowerCase() === "public_record";
              const sourceCaption = getSourceCaption(item);
              // Paper colour matches the stamp: orange still open, blue public, green earned.
              const noteStatusClass = isUnconfirmed
                ? ""
                : isPublicRecord
                  ? styles.noteOnRecord
                  : styles.noteConfirmed;
              const isRetagging = isUnconfirmed && activeRetagNoteId === noteId;
              const isHighlighted = Boolean(
                highlightedIntelId &&
                (noteId === highlightedIntelId ||
                  item.id === highlightedIntelId ||
                  (item.description && item.description === highlightedIntelId))
              );
              const isNewIntel = pendingAppearKeys.has(`intel-${st.stakeholder_id}-${item.id}`);
              const isFadingOut = Boolean(
                !isHighlighted &&
                fadingOutIntelId &&
                (noteId === fadingOutIntelId ||
                  item.id === fadingOutIntelId ||
                  (item.description && item.description === fadingOutIntelId))
              );

              return (
                <React.Fragment key={`${st.stakeholder_id}-${noteId}`}>
                {/* On the environment page the cards arrive in stage order, so a divider is
                    enough to group them without a second grid. */}
                {st.is_environment &&
                  (idx === 0 || pageChains[idx - 1].newest.stage_id !== item.stage_id) && (
                    <div
                      className={styles.stageGroupTitle}
                      style={{ borderColor: stageMeta(item.stage_id).color, color: stageMeta(item.stage_id).color }}
                    >
                      {stageMeta(item.stage_id).label}
                    </div>
                  )}
                <div
                  key={`${st.stakeholder_id}-${noteId}`}
                  id={`intel-sticky-${noteId}`}
                  data-intel-id={item.id}
                  data-intel-description={item.description}
                  draggable={draggableIntel}
                  onDragStart={(e) => {
                    if (!draggableIntel) return;
                    // Same channel the engagement cards use, so the builder needs no library.
                    e.dataTransfer.setData("intelItemId", item.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  className={`${styles.stickyNote} ${noteStatusClass} ${isRetagging ? styles.retagActive : ""} ${isHighlighted ? styles.highlightedStickyNote : ""} ${isFadingOut ? styles.fadingOutStickyNote : ""} ${isNewIntel ? styles.newStickyNote : ""}`}
                >
                  <span
                    className={styles.notePhaseSpine}
                    title={`You picked this up in ${phaseLabel(item.discovered_phase_id, phases)}`}
                  >
                    <span className={styles.notePhaseName}>
                      {phaseLabel(item.discovered_phase_id, phases)}
                    </span>
                  </span>

                  {/* Header Row: Intel Type Badge on sticky note (Clickable to Re-tag only if unconfirmed) */}
                  <div className={styles.noteTopBar}>
                    {isUnconfirmed ? (
                      <button
                        className={`${styles.noteCategoryTag} ${catMeta.styleClass}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveRetagNoteId(isRetagging ? null : noteId);
                        }}
                        title="Click to re-tag this intel item's category"
                      >
                        <span>{catMeta.icon} {catMeta.label}</span>
                        <span className={styles.reTagIconBtn} aria-label="Re-tag">
                          <Icon icon="ph:pencil-simple-bold" />
                        </span>
                      </button>
                    ) : (
                      <div className="d-flex align-items-center">
                        <div
                          className={`${styles.categoryBadgeStatic} ${catMeta.styleClass}`}
                          title="Category is locked once intel is confirmed/verified"
                        >
                          <span>{catMeta.icon} {catMeta.label}</span>
                        </div>
                      </div>
                    )}
                    <div className={styles.cardCornerStamp}>
                      {item.debug && (
                        <button
                          className={`${styles.debugToggle} ${
                            item.debug.correct_tag === item.categorized_type ? styles.debugRight : styles.debugWrong
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleDebug(noteId);
                          }}
                          title={`Debug: true tag is ${item.debug.correct_tag}`}
                        >
                          <Icon icon="ph:bug-bold" />
                        </button>
                      )}
                      {item.contested && (
                        <span
                          className={`${styles.statusBadge} ${styles.contestedBadge}`}
                          title="Somebody else in this room wants the opposite on this very target."
                        >
                          CONTESTED
                        </span>
                      )}
                      {item.status && STATUS_META[item.status] && (
                        <span
                          className={`${styles.statusBadge} ${styles[STATUS_META[item.status].styleClass]}`}
                          title={STATUS_META[item.status].title}
                        >
                          {STATUS_META[item.status].label}
                        </span>
                      )}
                      {renderRubberStamp(item.intel_type, isPublicRecord)}
                    </div>
                  </div>

                  {/* Interactive Re-tag Picker Popover */}
                  {isRetagging && (
                    <div className={styles.retagPopover} onClick={(e) => e.stopPropagation()}>
                      <div className={styles.retagPopoverTitle}>Re-tag intel stance category:</div>
                      <div className={styles.retagOptionsGrid}>
                        {Object.entries(CATEGORY_META).map(([typeOptKey, metaOpt]) => (
                          <button
                            key={typeOptKey}
                            className={`${styles.retagOptionBtn} ${typeOptKey === typeKey ? styles.activeOptionBtn : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReTagIntel(item.id, typeOptKey);
                            }}
                          >
                            {metaOpt.icon} {metaOpt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {item.debug && openDebugId === noteId && (
                    <div className={styles.debugPanel} onClick={(e) => e.stopPropagation()}>
                      <div className={styles.debugPanelTitle}>Answer key (debug)</div>
                      <DebugRequirement info={item.debug} playerTag={typeKey} />
                    </div>
                  )}

                  <div className={styles.intelBody}>
                    <div className={styles.intelText}>
                      "
                      {noteSubject && <strong className={styles.intelSubject}>{noteSubject}</strong>}
                      {isUnconfirmed ? (
                        <em className={styles.intelReading}>
                          <GlossaryText text={noteReading} surface="intel_notes" />
                        </em>
                      ) : (
                        <GlossaryText text={noteReading} surface="intel_notes" />
                      )}
                      "
                    </div>
                    {sourceCaption && (
                      <div className={styles.intelSourceCaption} title={sourceCaption.title}>
                        <Icon icon={sourceCaption.icon} className={styles.intelSourceIcon} />
                        <span>{sourceCaption.text}</span>
                      </div>
                    )}
                    {/* The layers this reading grew out of, newest first, so the card gets taller
                        the longer the player has been working on the same note (D24). */}
                    {chain.older.length > 0 && (
                      <div className={styles.chainStack}>
                        {[...chain.older].reverse().map((link) => (
                          <div key={link.id} className={styles.chainLayer}>
                            <span className={styles.chainLayerPhase}>
                              {phaseLabel(link.discovered_phase_id, phases)}
                            </span>
                            <span>"{link.description}"</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {(item.locked_links || 0) > 0 && (
                      <div
                        className={styles.lockedRow}
                        title="There is more to learn about this one. Keep digging in the phases ahead."
                      >
                        <Icon icon="ph:lock-simple-bold" className={styles.lockedIcon} />
                        <span>
                          {item.locked_links === 1
                            ? "1 more layer of this note is still out there"
                            : `${item.locked_links} more layers of this note are still out there`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                </React.Fragment>
              );
            })}
            {hiddenIntelCount > 0 && (
              <div
                className={`${styles.ghostNote} ${hiddenIntelCount > 1 ? styles.ghostNoteStacked : ""}`}
                title="Notes you have not found yet. Their pips stay hollow until you do."
              >
                <Icon icon="ph:magnifying-glass-bold" className={styles.ghostNoteIcon} />
                <span>
                  {hiddenIntelCount === 1
                    ? `1 more note about ${st.name} is still out there`
                    : `${hiddenIntelCount} more notes about ${st.name} are still out there`}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.emptyStateContainer}>
            <div className={styles.emptyStateCard}>
              <div className={styles.paperclip} />
              <div className={styles.emptyStateTitle}>
                {hasIntelEntries ? "🔍 Nothing Matches These Filters" : "📋 No Field Intelligence Collected Yet"}
              </div>
              <div className={styles.emptyStateText}>
                {hasIntelEntries ? (
                  <>Your notes on <strong>{st.name}</strong> are all filtered out right now.</>
                ) : (
                  <>No interview notes, requirements, or personal stances recorded for <strong>{st.name}</strong>.</>
                )}
              </div>
              <div className={styles.emptyStateHint}>
                {hasIntelEntries ? (
                  <>💡 <em>Clear the stage row or the search box below to see them again.</em></>
                ) : (
                  <>💡 <em>Participate in Intel Gathering activities to uncover and verify their hidden constraints.</em></>
                )}
              </div>
            </div>
          </div>
        )}

        </div>

        {/* The filter strip is the foot of the page: last item in the page column,
            below the scrolling wall, so it never covers a note. */}
        <div className={styles.filterDock}>{renderFilterBar(st, hiddenByFilter)}</div>
      </>
    );
  };

  const activeStakeholder = effectiveDossierData[currentPageIndex] || effectiveDossierData[0];

  // System button badge: how much of what you've worked out about the pipeline itself is
  // actually found, the same found/total the page's own pip row shows.
  const systemPips = environmentIndex >= 0 ? getIntelPips(effectiveDossierData[environmentIndex]) : [];
  const systemFoundCount = systemPips.filter((status) => status !== "hidden").length;

  // Performance button badge: the same overall health bucket PerformanceView shows, as a dot
  // rather than a count - it's a state, not a tally.
  const systemHealthBucket = healthBucket(systemHealth);

  if (!isOpen && !isEmbedded) return null;

  const windowContent = (
    <div
      className={styles.sketchbookWindow}
      style={
        isEmbedded
          ? {
            position: "relative",
            top: "0px",
            left: "0px",
            width: "100%",
            height: "100%",
            maxWidth: "100%",
            maxHeight: "100%",
          }
          : {
            top: `${Math.max(10, position.y)}px`,
            left: `${Math.max(10, position.x)}px`,
          }
      }
    >
      {/* Header Drag Handle */}
      <div className={styles.binderHeader} onMouseDown={isEmbedded ? undefined : handleMouseDown}>
        <div className={styles.binderTitle}>
          📓 STAKEHOLDER DOSSIER
        </div>
        <div className={styles.headerControls}>
          <div className={styles.headerButtonGroup}>
            {environmentIndex >= 0 && (
              <button
                className={`${styles.briefingButton} ${currentPageIndex === environmentIndex ? styles.briefingButtonActive : ""}`}
                onClick={() => requestPageChange(currentPageIndex === environmentIndex ? lastPersonPage.current : environmentIndex)}
                title={`What you have worked out about the pipeline itself: facts, not anybody's wishes — ${describeIntelPips(systemPips)}`}
              >
                <Icon icon="ph:buildings-bold" />
                <span>System</span>
                {systemPips.length > 0 && (
                  <span className={styles.headerBadgeCount}>
                    {systemFoundCount}/{systemPips.length}
                  </span>
                )}
              </button>
            )}
            {onPerformanceToggle && (
              <button
                className={`${styles.briefingButton} ${isPerformanceOpen ? styles.briefingButtonActive : ""}`}
                onClick={onPerformanceToggle}
                title={
                  isPerformanceOpen
                    ? "Close performance"
                    : `Open performance — gameplay metrics and the project pipeline. System health: ${HEALTH_BUCKET_WORD[systemHealthBucket]}`
                }
              >
                <Icon icon="ph:gauge-bold" />
                <span>Performance</span>
                {systemHealth !== undefined && (
                  <span
                    className={styles.headerBadgeDot}
                    style={{ background: healthBucketColor(systemHealthBucket) }}
                  />
                )}
              </button>
            )}
            {onOpenPhaseBriefing && (
              <button
                className={styles.briefingButton}
                onClick={onOpenPhaseBriefing}
                title="Reopen the phase briefing: objectives, current challenge, and the stakeholder power & interest radar"
              >
                <Icon icon="ph:projector-screen-chart-bold" />
                <span>Briefing</span>
              </button>
            )}
            {onLogToggle && (
              <button
                className={`${styles.briefingButton} ${isLogOpen ? styles.briefingButtonActive : ""}`}
                onClick={onLogToggle}
                title={isLogOpen ? "Close event log" : "Open the event log — what's been filed and verified so far"}
              >
                <Icon icon="ph:scroll-bold" />
                <span>Log</span>
                {Boolean(logCount) && (
                  <span className={styles.headerBadgeCount}>{logCount}</span>
                )}
              </button>
            )}
          </div>
          <div className={styles.headerArrowGroup}>
            <button
              className={styles.topNavArrow}
              disabled={currentPageIndex <= 0}
              onClick={() => requestPageChange(currentPageIndex - 1)}
              title={currentPageIndex <= 0 ? "First stakeholder" : "Previous Stakeholder (←)"}
            >
              <Icon icon="ph:caret-left-bold" />
            </button>
            <button
              className={styles.topNavArrow}
              disabled={currentPageIndex >= totalPages - 1}
              onClick={() => requestPageChange(currentPageIndex + 1)}
              title={currentPageIndex >= totalPages - 1 ? "Last stakeholder" : "Next Stakeholder (→)"}
            >
              <Icon icon="ph:caret-right-bold" />
            </button>
          </div>
          {canClose && (
            <button className={styles.closeButton} onClick={onClose} title="Close Sketchbook">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Physical Bookmark Tabs (Top Bar) */}
      {effectiveDossierData.length > 0 && (
        <div className={styles.tabsContainer}>
          {effectiveDossierData.map((st, idx) => {
            // The environment is not a person, so it is not in the tab strip (D45).
            if (st.is_environment) return null;
            const stColor = getStakeholderColor(st);
            const stObj = stakeholders[st.stakeholder_id];
            const emotion = stObj?.emotional_state || "neutral";
            const emotionColor =
              activeEmotionColors[emotion] ||
              activeEmotionColors[emotion.toLowerCase()] ||
              "#64748b";
            const isActive = idx === currentPageIndex;
            const isHighPower = (st.power || stObj?.power || "").toLowerCase() === "high";
            const isHighInterest = (st.interest || stObj?.interest || "").toLowerCase() === "high";
            const keyPlayerHint = [
              isHighPower ? "High power" : null,
              isHighInterest ? "High interest" : null,
            ].filter(Boolean).join(", ");

            // New and shifted are mutually exclusive: shifted needs a previous
            // reading to compare against, new means there wasn't one.
            const change = dismissedChangeIds.has(st.stakeholder_id)
              ? undefined
              : phaseChanges.get(st.stakeholder_id);
            const isPulsingChange = Boolean(change && pulsingChangeIds.has(st.stakeholder_id));
            const changeHint = change
              ? change.isNew
                ? "New this phase"
                : `Shifted this phase${change.shiftText ? `: ${change.shiftText}` : ""}`
              : "";
            const tabPips = getIntelPips(st);
            const tabFoundCount = tabPips.filter((status) => status !== "hidden").length;
            // Stakeholder names are authored "<role/category> <given name>" (e.g. "Requirements
            // Reuben"): split on the first space so the tab always breaks there, on its own two
            // lines, rather than wherever the browser happens to wrap a too-narrow single line.
            const [tabRoleWord, ...tabGivenNameWords] = st.name.split(" ");
            const tabGivenName = tabGivenNameWords.join(" ");

            return (
              <button
                key={st.stakeholder_id || idx}
                ref={idx === currentPageIndex ? activeTabRef : null}
                className={`${styles.tabButton} ${isActive ? styles.activeTab : ""}`}
                onClick={() => requestPageChange(idx)}
                title={`${st.name} (Emotional State: ${emotion})${
                  keyPlayerHint ? ` - ${keyPlayerHint}` : ""
                }${changeHint ? ` - ${changeHint}` : ""}${
                  tabPips.length > 0 ? ` - Intel: ${describeIntelPips(tabPips)}` : ""
                }`}
                style={
                  {
                    "--tab-color": stColor,
                    "--emotion-color": emotionColor,
                  } as React.CSSProperties
                }
              >
                {change && (
                  <span
                    className={`${styles.tabChangeBadge} ${
                      change.isNew ? styles.tabChangeBadgeNew : styles.tabChangeBadgeShifted
                    } ${isPulsingChange ? styles.tabChangeBadgePulsing : ""}`}
                  >
                    {change.isNew ? "NEW" : "SHIFTED"}
                  </span>
                )}
                {tabPips.length > 0 && (
                  <span className={styles.tabIntelCountBadge} title={describeIntelPips(tabPips)}>
                    {tabFoundCount}/{tabPips.length}
                  </span>
                )}
                <span className={styles.tabName}>
                  {tabGivenName ? (
                    <>
                      <span className={styles.tabNameLine}>{tabRoleWord}</span>
                      <span className={styles.tabNameLine}>{tabGivenName}</span>
                    </>
                  ) : (
                    <span className={styles.tabNameLine}>{tabRoleWord}</span>
                  )}
                </span>
                <div className={styles.tabEmotionRow}>
                  <Icon
                    icon={iconForEmotionState(emotion)}
                    className={styles.tabEmotionIcon}
                  />
                  <span className={styles.tabEmotionLabel} title={`Emotional State: ${emotion}`}>
                    {emotion}
                  </span>
                  {isHighPower && (
                    <span
                      className={styles.tabKeyFlag}
                      title="High power: strong authority"
                    >
                      <Icon icon="ph:lightning-fill" className={styles.tabKeyFlagIcon} />
                    </span>
                  )}
                  {isHighInterest && (
                    <span
                      className={styles.tabKeyFlag}
                      title="High interest: closely engaged"
                    >
                      <Icon icon="ph:eye-fill" className={styles.tabKeyFlagIcon} />
                    </span>
                  )}
                </div>
                {tabPips.length > 0 && (
                  <span className={styles.tabIntelBar} aria-hidden="true">
                    {/* Every segment renders, even at zero width, so a stamp change animates */}
                    {INTEL_PIP_ORDER.filter((status) => status !== "hidden").map((status) => (
                      <span
                        key={status}
                        className={`${styles.tabIntelBarFill} ${INTEL_PIP_META[status].styleClass}`}
                        style={{
                          width: `${(tabPips.filter((p) => p === status).length / tabPips.length) * 100}%`,
                        }}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Main Notebook Binding Container */}
      <div className={styles.notebookBindingContainer}>
        {/* Paper Canvas */}
        <div className={styles.flipBookWrapper}>
          <div className={styles.pageBase} key={currentPageIndex}>
            {renderPageContent(activeStakeholder)}
          </div>
        </div>
      </div>
    </div>
  );

  if (isEmbedded) {
    return (
      <div style={{ width: "100%", height: "100%", minHeight: "450px", position: "relative", pointerEvents: "auto" }}>
        {windowContent}
      </div>
    );
  }

  return (
    <div className={styles.dossierOverlay}>
      {windowContent}
    </div>
  );
}
