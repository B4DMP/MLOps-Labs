import { Fragment, useState, useEffect, useRef, useContext, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { Icon } from "@iconify/react";
import { useGameWebSocket, useWebSocketEvent } from "../services/websocket/useGameWebSocket";
import IntelArtifactViewer from "./IntelArtifactViewer";
import StakeholderDossier, { type IntelDebugInfo, type StakeholderDossierEntry } from "./StakeholderDossier";
import EventLogModal from "./EventLogModal";
import PhaseOverview from "./PhaseOverview";
import type { GameEventPayload } from "../types/GameEvent";
import styles from "./offline_intel_gathering.module.css";
import { CHALLENGE_INTEL_META, INTEL_TAGS, intelTagMeta } from "../types/IntelTag";
import { useSpeech } from "./useSpeech";
import { slotForStakeholderVoice, TOUR_GUIDE_SEED } from "../utils/speech";
import { startTour } from "../utils/tour";
import { StakeholderContext } from "./StakeholderProvider";
import { useSettings } from "./SettingsProvider";
import OnceIcon from "./Results/OnceIcon";
import MAIL_OPEN_MARKETING_ICON from "./Results/icons/mail-open-marketing.json";
import MESSAGES_ENGAGEMENT_ALT_ICON from "./Results/icons/messages-engagement-alt.json";
import AVATARS_CHATTING_ICON from "./Results/icons/avatars-chatting.json";
import FILE_POLICY_ICON from "./Results/icons/file-policy.json";
import LIST_RULES_ICON from "./Results/icons/list-rules.json";
import MAGNIFIER_ICON from "./Results/icons/magnifier.json";
import RADIO_WALKIE_TALKIE_ICON from "./Results/icons/radio-walkie-talkie.json";
import SERVER_ICON from "./Results/icons/server.json";
import LAYERS_ICON from "./Results/icons/layers.json";
import EYE_ICON from "./Results/icons/eye.json";
import MICROPHONE_ICON from "./Results/icons/microphone.json";

/** Every `ArtifactType` the backend enum defines (`requirement.py`), even the six only the
 * artifact-regeneration admin tool can currently assign - the content pipeline that deals real
 * runs only ever picks the first four (`content_gen/stages/artifacts.py`'s `ARTIFACT_TYPES`), but
 * mapping the rest now costs nothing and means nothing needs touching if that ever widens. */
const ARTIFACT_TYPE_ICON: Record<string, object> = {
  email: MAIL_OPEN_MARKETING_ICON,
  slack_message: MESSAGES_ENGAGEMENT_ALT_ICON,
  meeting_notes: AVATARS_CHATTING_ICON,
  document: FILE_POLICY_ICON,
  runbook: LIST_RULES_ICON,
  dashboard_snapshot: MAGNIFIER_ICON,
  incident_ticket: RADIO_WALKIE_TALKIE_ICON,
  ci_log: SERVER_ICON,
  architecture_note: LAYERS_ICON,
};

interface OfflineIntelGatheringProps {
  onContinue: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  onTagArtifact?: (stakeholderId: string) => void;
  isDossierOpen?: boolean;
  setIsDossierOpen?: (open: boolean) => void;
  dossierData?: StakeholderDossierEntry[];
  activeStakeholderId?: string;
  /** An intel item clicked from outside this screen (e.g. the Performance Dashboard): the
   *  dossier jumps to it and pops it into view, same as clicking a reference in here does. */
  focusIntelId?: string;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  challengeAmount?: number;
  /** Lets the embedded dossier reopen the phase briefing. */
  onOpenPhaseBriefing?: () => void;
  /** True while PrePhaseDialog is narrating the phase/challenge introduction. Artifact
   *  auto-narration waits for that to finish - both call the same shared speech arbiter, and
   *  without this an artifact mounted at the same time would cut the phase briefing off. */
  isPhaseBriefingOpen?: boolean;
  /** Opens performance (gameplay metrics + the project pipeline) from the dossier, as in the pitch phase. */
  onPerformanceToggle?: () => void;
  isPerformanceOpen?: boolean;
  onSettingsToggle?: () => void;
  isSettingsOpen?: boolean;
  /** When provided, renders in single-item / focus review mode with only this artifact */
  singleArtifact?: IntelArtifact | null;
  /** Callback for the "go back" button in bottom right */
  onGoBack?: () => void;
}

export interface IntelArtifact {
  id: string;
  requirement_id: string;
  stakeholder_id: string;
  stakeholder_name: string;
  stakeholder_role: string;
  artifact_type: string;
  content: string;
  categorized_type?: string;
  /** Already on the public record: dealt in pre-tagged and locked, not the player's to call. */
  is_known?: boolean;
  /** Answer key, only sent when the API runs with ENABLE_DOSSIER_DEBUG. */
  debug?: IntelDebugInfo;
}

// The pickable stance tags; Challenge-Intel is appended only on locked, pre-known Facts.
const REQUIREMENT_TAGS = [...INTEL_TAGS, CHALLENGE_INTEL_META].map((t) => ({
  type: t.type,
  label: t.label,
  icon: t.icon,
  color: t.color,
  description: t.description,
  about: t.about,
}));

// Matches CHALLENGE_INTEL_ENTRY_ID on the backend (intel_handler.py).
const CHALLENGE_INTEL_TAB_ID = "__challenge_intel__";

/** Which dossier page an artifact opens: Challenge-Intel for pre-known Facts, else its speaker's page. */
function dossierTargetFor(art: IntelArtifact, categorizedType?: string): string {
  const catType = categorizedType ?? art.categorized_type;
  if (catType === "fact") return CHALLENGE_INTEL_TAB_ID;
  return art.stakeholder_id || art.stakeholder_name;
}

export default function OfflineIntelGathering({
  onContinue,
  currentPhase = 0,
  currentChallenge = 0,
  onTagArtifact,
  dossierData = [],
  activeStakeholderId,
  focusIntelId,
  onOpenPhaseBriefing,
  isPhaseBriefingOpen = false,
  onPerformanceToggle,
  isPerformanceOpen = false,
  onSettingsToggle,
  isSettingsOpen = false,
  singleArtifact,
  onGoBack,
}: OfflineIntelGatheringProps) {
  const { emit, subscribe } = useGameWebSocket();
  const { speak: speakTts } = useSpeech();
  const { settings } = useSettings();
  const { stakeholders } = useContext(StakeholderContext);
  const [artifacts, setArtifacts] = useState<IntelArtifact[]>(() =>
    singleArtifact ? [singleArtifact] : []
  );
  const [events, setEvents] = useState<GameEventPayload[]>([]);
  // Clicking an event log row that names an intel item jumps the dossier to it (D51's refs, made
  // clickable): a brief highlight, then it fades so it doesn't linger as stray UI state.
  const [highlightedIntelId, setHighlightedIntelId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpToIntelItem = (itemId: string) => {
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    setHighlightedIntelId(itemId);
    highlightTimeoutRef.current = setTimeout(() => setHighlightedIntelId(null), 2500);
  };
  // Same jump, triggered from outside this screen (a note clicked in the Performance Dashboard).
  const prevFocusIntelRef = useRef<string | undefined>(focusIntelId);
  useEffect(() => {
    if (focusIntelId && focusIntelId !== prevFocusIntelRef.current) {
      jumpToIntelItem(focusIntelId);
    }
    prevFocusIntelRef.current = focusIntelId;
  }, [focusIntelId]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [loading, setLoading] = useState(!singleArtifact);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [taggedTypes, setTaggedTypes] = useState<Record<string, string>>(() =>
    singleArtifact && singleArtifact.categorized_type
      ? { [singleArtifact.id]: singleArtifact.categorized_type }
      : {}
  );
  const [, setHoveredTag] = useState<string | null>(null);
  // Debug builds only: stays open across cards so the key can be read while flipping through the deck.
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isLogOpen, setIsLogOpen] = useState(false);
  const [showIntroBanner, setShowIntroBanner] = useState(() => {
    try {
      return localStorage.getItem("mlops_offline_intel_intro_seen") !== "true";
    } catch {
      return true;
    }
  });

  const dismissIntroBanner = () => {
    setShowIntroBanner(false);
    try {
      localStorage.setItem("mlops_offline_intel_intro_seen", "true");
    } catch {
      // ignore storage failures (e.g. private browsing)
    }
  };

  // Two-step so a stray click cannot wipe the player's work
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);

  const hasRequestedRef = useRef(false);
  const introDossierTourStartedRef = useRef(false);
  // Artifact auto-narration and the tour's own narration both go through the same shared speech
  // arbiter (speakTts) - starting one preempts the other mid-sentence, and that preemption never
  // fires the preempted call's onEnd, which left isNarrating stuck true (an endless spinner) and
  // the artifact permanently unmarked/unread. Only phase 0's tour is waited on, read from the live
  // phase rather than seeded at mount, so phase 1 never inherits a gate that was never released.
  const [introDossierTourDone, setIntroDossierTourDone] = useState(false);
  const introDossierTourPending = currentPhase === 0 && !singleArtifact && !introDossierTourDone;
  const resetConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    const left = Math.min(
      Math.max(infoTag.anchorX, 6 + half),
      window.innerWidth - 6 - half
    );
    setInfoTag((prev) => (prev && prev.left !== left ? { ...prev, left } : prev));
  }, [infoTag?.anchorX, infoTag?.label, infoTag?.detail]);

  useEffect(() => {
    if (!infoTag) return;
    const handleScroll = () => hideInfoTag();
    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [infoTag]);

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
      if (resetConfirmTimeoutRef.current) {
        clearTimeout(resetConfirmTimeoutRef.current);
      }
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (singleArtifact) {
      setArtifacts([singleArtifact]);
      setTaggedTypes(
        singleArtifact.categorized_type
          ? { [singleArtifact.id]: singleArtifact.categorized_type }
          : {}
      );
      setCurrentIndex(0);
      setLoading(false);
    }
  }, [singleArtifact]);

  useEffect(() => {
    if (singleArtifact) return;

    const unsubscribe = subscribe("intel:offline_artifacts", (data: any) => {
      if (data && data.artifacts) {
        setArtifacts(data.artifacts);
        const initialTagged: Record<string, string> = {};
        data.artifacts.forEach((art: IntelArtifact) => {
          if (art.categorized_type) {
            initialTagged[art.id] = art.categorized_type;
          }
        });
        setTaggedTypes(initialTagged);
        setCurrentIndex(0);
      }
      setLoading(false);
    });

    if (!hasRequestedRef.current) {
      hasRequestedRef.current = true;
      emit("intel:get_offline_artifacts", {
        phase_id: currentPhase,
        challenge_id: currentChallenge,
      });
      emit("intel:get_dossier", {
        phase_id: currentPhase,
        challenge_id: currentChallenge,
      });
      emit("log:history", {});
    }

    return () => unsubscribe();
  }, [currentPhase, currentChallenge, singleArtifact]);

  // The event log (D51): what's been filed/verified so far, for this offline gathering pass.
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

  useEffect(() => {
    if (artifacts.length > 0 && currentIndex < artifacts.length) {
      const art = artifacts[currentIndex];
      if (art && onTagArtifact) {
        onTagArtifact(dossierTargetFor(art, taggedTypes[art.id]));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, artifacts]);

  useEffect(() => {
    setIsSubmitting(false);
  }, [currentIndex]);

  const handleTagArtifact = (categorizedType: string) => {
    if (currentIndex >= artifacts.length) return;
    if (transitionTimeoutRef.current) return; // Prevent multiple rapid clicks while transitioning

    const currentArtifact = artifacts[currentIndex];
    if (currentArtifact.is_known) return; // already on the record, not the player's call to make
    const artKey = currentArtifact.id;

    setIsNudging(false);
    setTaggedTypes((prev) => ({
      ...prev,
      [artKey]: categorizedType,
    }));

    if (onTagArtifact) {
      onTagArtifact(dossierTargetFor(currentArtifact, categorizedType));
    }

    emit("intel:tag_item", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
      intel_id: currentArtifact.requirement_id || currentArtifact.id,
      categorized_type: categorizedType,
    });

    emit("intel:get_dossier", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
    });

    if (singleArtifact) {
      // In single-artifact review mode, do not auto-advance to next card or summary
      return;
    }

    transitionTimeoutRef.current = setTimeout(() => {
      transitionTimeoutRef.current = null;
      if (currentIndex + 1 < artifacts.length) {
        setDirection(1);
        setCurrentIndex((prev) => prev + 1);
      } else {
        setDirection(1);
        setCurrentIndex(artifacts.length);
      }
    }, 400);
  };

  const handlePrevItem = () => {
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const handleNextItem = () => {
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    setIsNudging(false);
    setDirection(1);
    if (currentIndex < artifacts.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setCurrentIndex(artifacts.length);
    }
  };

  const handleResetClick = () => {
    if (resetConfirmTimeoutRef.current) {
      clearTimeout(resetConfirmTimeoutRef.current);
      resetConfirmTimeoutRef.current = null;
    }

    if (!isConfirmingReset) {
      setIsConfirmingReset(true);
      // Back out on its own if the player does not follow through
      resetConfirmTimeoutRef.current = setTimeout(() => {
        resetConfirmTimeoutRef.current = null;
        setIsConfirmingReset(false);
      }, 4000);
      return;
    }

    setIsConfirmingReset(false);
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    // Keep the locked pre-tagged items; only the player's own calls get cleared.
    setTaggedTypes((prev) => {
      const kept: Record<string, string> = {};
      artifacts.forEach((art) => {
        if (art.is_known && prev[art.id]) {
          kept[art.id] = prev[art.id];
        }
      });
      return kept;
    });
    setDirection(-1);
    setCurrentIndex(firstPlayerIndex !== -1 ? firstPlayerIndex : 0);
  };

  const handleFinalContinue = () => {
    if (!allTagged) return;
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    setIsSubmitting(true);
    onContinue();
    setTimeout(() => {
      setIsSubmitting(false);
    }, 5000);
  };

  const currentArtifact = artifacts[currentIndex];
  const isFinished = artifacts.length > 0 && currentIndex >= artifacts.length;
  const currentArtifactKey = currentArtifact ? currentArtifact.id : "";
  const currentTaggedType = currentArtifactKey ? taggedTypes[currentArtifactKey] : undefined;

  // Narrates an artifact's content once, the first time it's actually viewed - keyed the same
  // way the viewer is, so paging back through already-read artifacts never re-narrates them.
  // Read in the artifact's own author's voice (their configured gender slot) when it has one; a
  // System/environment artifact has no stakeholder_id and falls to the narrator voice.
  const narratedArtifactKeysRef = useRef<Set<string>>(new Set());
  const [isNarrating, setIsNarrating] = useState(false);
  const narrationCancelRef = useRef<() => void>(() => {});
  // Which sentence of the currently-narrating artifact is playing, for SpokenText inside
  // IntelArtifactViewer. Keyed by artifact id below so a stale index from the previous artifact
  // never briefly highlights the wrong one after paging to a new card.
  const [narratingArtifactKey, setNarratingArtifactKey] = useState<string | null>(null);
  const [activeSentenceIndex, setActiveSentenceIndex] = useState<number | null>(null);
  // Nudges the player toward their next move once the artifact has finished reading itself
  // aloud (or immediately, when there was never going to be a reading to wait for). Cleared
  // the moment they act - tag a category or advance - so it never pulses stale.
  const [isNudging, setIsNudging] = useState(false);
  const latestArtifactKeyRef = useRef(currentArtifactKey);
  useEffect(() => {
    latestArtifactKeyRef.current = currentArtifactKey;
  }, [currentArtifactKey]);
  useEffect(() => {
    setIsNudging(false);
    if (!currentArtifactKey) return;
    const alreadyNarrated = narratedArtifactKeysRef.current.has(currentArtifactKey);
    if (settings.mute_tts || !currentArtifact?.content || alreadyNarrated) {
      setIsNudging(true);
    }
  }, [currentArtifactKey, settings.mute_tts, currentArtifact?.content]);

  // `markKey` is only recorded as narrated once the reading actually completes - not when it
  // starts - so React StrictMode's dev-only double-invoke (mount, cleanup, mount again) can't
  // mark an artifact "done" from a phantom run that gets cancelled before it ever plays, which
  // would otherwise make the real, second mount see it as already-narrated and stay silent.
  const narrateArtifact = (artifact: IntelArtifact, markKey?: string) => {
    if (!artifact.content) return;
    narrationCancelRef.current(); // a replay or a fresh artifact both interrupt any prior reading
    const speaker = artifact.stakeholder_id ? stakeholders[artifact.stakeholder_id] : undefined;
    // Meeting notes are a third-party summary, not the stakeholder speaking.
    const isNarrated = !speaker || artifact.artifact_type === "meeting_notes";
    const slot = isNarrated ? "narrator" : slotForStakeholderVoice(speaker.voice);

    setIsNarrating(true);
    setNarratingArtifactKey(artifact.id);
    setActiveSentenceIndex(null);
    narrationCancelRef.current = speakTts(artifact.content, {
      slot,
      seed: isNarrated ? undefined : artifact.stakeholder_id || undefined,
      onSentence: ({ index }) => setActiveSentenceIndex(index),
      onEnd: () => {
        setIsNarrating(false);
        setNarratingArtifactKey(null);
        setActiveSentenceIndex(null);
        if (markKey) narratedArtifactKeysRef.current.add(markKey);
        if (latestArtifactKeyRef.current === artifact.id) setIsNudging(true);
      },
    });
  };

  const stopNarration = () => {
    narrationCancelRef.current();
    setIsNarrating(false);
    setNarratingArtifactKey(null);
    setActiveSentenceIndex(null);
    setIsNudging(true); // player cut the reading short themselves - they're ready to act now too
  };

  useEffect(() => {
    // The phase/challenge briefing narrates first and uses the same shared speech arbiter -
    // starting an artifact reading here would cut it off. Once the briefing closes, this effect
    // re-runs (isPhaseBriefingOpen is a dep) and narrates the artifact that's on screen then.
    // Same reasoning for the tour: it also narrates through that arbiter, so this waits for
    // introDossierTourDone too, rather than racing it (see where that state is declared).
    if (isPhaseBriefingOpen || introDossierTourPending) return;
    if (!currentArtifactKey || !currentArtifact?.content) return;
    if (narratedArtifactKeysRef.current.has(currentArtifactKey)) return;
    narrateArtifact(currentArtifact, currentArtifactKey);
    return () => {
      narrationCancelRef.current();
      setIsNarrating(false);
      setNarratingArtifactKey(null);
      setActiveSentenceIndex(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentArtifactKey, currentArtifact?.content, currentArtifact?.stakeholder_id, isPhaseBriefingOpen, introDossierTourPending]);

  // Same "wait for the briefing to finish first" rule as artifact narration above - the tour
  // and the briefing/artifact narration all go through the same shared speech arbiter.
  useEffect(() => {
    if (isPhaseBriefingOpen || singleArtifact) return;
    // Phase 0 has exactly one challenge (challenges_per_phase: 1), so checking the phase alone
    // is sufficient - `currentChallenge` is the challenge's *global* id (e.g. 113), not a
    // phase-relative index, and comparing it to 0 never matched, which silently kept this tour
    // from ever starting.
    if (currentPhase !== 0) return;
    if (artifacts.length === 0) return;
    if (introDossierTourStartedRef.current) return;
    introDossierTourStartedRef.current = true;
    startTour("introDossier", {
      narrate: (text) => speakTts(text, { slot: "narrator", seed: TOUR_GUIDE_SEED }),
      onFinish: () => setIntroDossierTourDone(true),
    });
  }, [isPhaseBriefingOpen, singleArtifact, currentPhase, artifacts.length]);

  // Known artifacts arrive pre-tagged and locked, so they stay out of every progress count:
  // the player should see how many calls are theirs to make, not a number they cannot move.
  const playerArtifacts = artifacts.filter((art) => !art.is_known);
  const totalArtifactsCount = playerArtifacts.length;
  const taggedArtifactsCount = playerArtifacts.filter((art) => {
    return Boolean(taggedTypes[art.id]);
  }).length;
  const allTagged = artifacts.length > 0 && taggedArtifactsCount === totalArtifactsCount;
  const firstUntaggedIndex = artifacts.findIndex((art) => {
    return !art.is_known && !taggedTypes[art.id];
  });
  const firstPlayerIndex = artifacts.findIndex((art) => !art.is_known);
  const knownArtifactsCount = artifacts.length - playerArtifacts.length;
  const isOnKnownArtifact = Boolean(currentArtifact?.is_known);
  // On record come the challenge itself, as a System item about the disputed component, and the
  // two sides arguing over it, as stances. Only the stances make up the clash.
  const isOnRecordFact = (art: IntelArtifact) => Boolean(art.is_known) && art.categorized_type === "fact";
  const isOnRecordStance = (art: IntelArtifact) => Boolean(art.is_known) && art.categorized_type !== "fact";
  const isOnKnownFact = isOnKnownArtifact && currentArtifact.categorized_type === "fact";
  // The on-record pair is one argument seen from two sides. Name the other side so the
  // player reads the second card as a rebuttal instead of an unrelated statement.
  const conflictPartnerIndex = isOnKnownArtifact && !isOnKnownFact
    ? artifacts.findIndex(
        (art) => isOnRecordStance(art) && art.stakeholder_id !== currentArtifact.stakeholder_id
      )
    : -1;
  const conflictPartner = conflictPartnerIndex !== -1 ? artifacts[conflictPartnerIndex] : undefined;
  const hasSeenConflictPartner = conflictPartnerIndex !== -1 && conflictPartnerIndex < currentIndex;

  const currentStakeholderId = currentArtifact?.stakeholder_id || currentArtifact?.stakeholder_name;

  return (
    <div className="game-container">
      {/* Main Content Area over Game Background Canvas */}
      <div
        className={`container-fluid flex-grow-1 d-flex flex-column px-2 px-md-3 py-1 position-relative overflow-auto ${styles.mainContainer}`}
      >
        {/* Main Board Grid: Left Column = Stakeholder Dossier (2/5), Right Column = Artifact Viewer & Categorization (3/5) */}
        <div className={`row g-2 align-items-stretch h-100 ${styles.boardRow}`}>
          {/* LEFT COLUMN: Stakeholder Dossier (2/5 of screen) */}
          <div className={`col-12 d-flex flex-column h-100 ${styles.leftColumnDossier}`}>
            <div className={`h-100 ${styles.dossierContainer}`}>
              <StakeholderDossier
                isOpen={true}
                canClose={false}
                isEmbedded={true}
                dossierData={dossierData || []}
                activeStakeholderId={activeStakeholderId || currentStakeholderId}
                speakingStakeholderId={
                  isNarrating && narratingArtifactKey === currentArtifactKey ? currentArtifact?.stakeholder_id ?? null : null
                }
                showPhaseChangeBadges={!singleArtifact}
                cheatSheetActiveSection="Digging for Intel"
                onOpenPhaseBriefing={onOpenPhaseBriefing}
                onPerformanceToggle={onPerformanceToggle}
                isPerformanceOpen={isPerformanceOpen}
                onSettingsToggle={onSettingsToggle}
                isSettingsOpen={isSettingsOpen}
                onLogToggle={() => setIsLogOpen((v) => !v)}
                isLogOpen={isLogOpen}
                logCount={events.length}
                currentPhase={currentPhase}
                currentChallenge={currentChallenge}
                onClose={() => {}}
                highlightedIntelId={singleArtifact ? (singleArtifact.requirement_id || singleArtifact.id) : highlightedIntelId}
                onOpenArtifact={(intelItem) => {
                  if (singleArtifact) return;
                  const targetIdx = artifacts.findIndex(
                    (art) =>
                      art.requirement_id === intelItem.id ||
                      art.id === intelItem.id ||
                      art.id === intelItem.artifact?.id ||
                      art.requirement_id === intelItem.artifact?.requirement_id
                  );
                  if (targetIdx !== -1) {
                    if (transitionTimeoutRef.current) {
                      clearTimeout(transitionTimeoutRef.current);
                      transitionTimeoutRef.current = null;
                    }
                    setDirection(targetIdx >= currentIndex ? 1 : -1);
                    setCurrentIndex(targetIdx);
                    const art = artifacts[targetIdx];
                    if (art && onTagArtifact) {
                      onTagArtifact(dossierTargetFor(art, taggedTypes[art.id]));
                    }
                  }
                }}
              />
            </div>
          </div>

          {/* RIGHT COLUMN: Offline Intel Gathering Artifact Viewer & Categorization (3/5 of screen) */}
          <div className={`col-12 d-flex flex-column h-100 ${styles.rightColumnIntel}`}>
            {/* Transparent Div Wrapper */}
            <div
              className={`transparent-div shadow-lg w-100 ${styles.transparentDivWrapper} ${
                singleArtifact ? styles.transparentDivWrapperSingle : ""
              }`}
            >
              {/* Where-am-I-in-the-project rail, shared with the Performance Dashboard and
                  Phase Briefing headers, sitting above the title row so it doesn't compete
                  with the title and nav pills for the same horizontal space. This header is
                  much narrower than either of those, so it renders in the tiny variant: only
                  the current phase keeps its label, the rest collapse to a representative
                  icon for that phase (name still reachable on hover). Skipped entirely in
                  singleArtifact mode: that's the Pitch & Debate "review this artifact" popup,
                  not the offline intel gathering phase, so "where am I in the project" doesn't apply. */}
              {!singleArtifact && (
                <div
                  className={styles.headerPhaseRail}
                  data-intro-group="introDossier"
                  data-title="Where You Are"
                  data-intro="Same phase rail as everywhere else, just compact - it always shows where you are in the project, in case the dossier itself has made you lose track."
                  data-step="6"
                >
                  <PhaseOverview compact />
                </div>
              )}

              {/* Header Title inside transparent-div - Merged Artifact Info */}
              <div className={styles.headerRow}>
                <div className={styles.headerTitleGroup}>
                  <span className="transparent-div-label mb-0">
                    <OnceIcon icon={MAGNIFIER_ICON} className={styles.headerTitleLordicon} /> Offline Intel Gathering
                  </span>
                  <span className={styles.infoTooltipWrapper}>
                    <button
                      type="button"
                      className={styles.infoTooltipButton}
                      aria-label="How offline intel gathering works"
                      tabIndex={0}
                    >
                      <Icon icon="ph:info-bold" />
                    </button>
                    <span className={styles.infoTooltipContent} role="tooltip">
                      Every artifact reveals something, about a stakeholder or about the system itself. Whoever
                      wrote it, read closely, then tag it below. Your call is saved as <strong>unconfirmed</strong>{" "}
                      intel in the Stakeholder Dossier. You'll get to confirm or correct it later by talking to them directly during
                      the pitch phase. Not sure yet? Use the numbered tabs above to jump around
                      before you lock everything in.
                    </span>
                  </span>
                  {!isFinished && currentArtifact && (
                    <div className={styles.headerArtifactMeta}>
                      <span className={styles.headerDivider}>|</span>
                      <span className={styles.headerArtifactBadge}>
                        <OnceIcon
                          icon={ARTIFACT_TYPE_ICON[currentArtifact.artifact_type] ?? FILE_POLICY_ICON}
                          className={styles.headerArtifactBadgeIcon}
                        />
                        {currentArtifact.artifact_type.toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>

                {/* Per-utterance narration controls: Stop only while actually reading; Listen
                    again whenever there is something to read and the player hasn't muted
                    narration globally. Both are independent of the settings panel's mute_tts.
                    The spinner covers the gap between "narration requested" and the first
                    sentence actually playing (network/synthesis latency on the server voice
                    path) - activeSentenceIndex is still null in that window. */}
                {isNarrating && activeSentenceIndex === null && (
                  <Icon
                    icon="ph:circle-notch-bold"
                    className={styles.narrationLoading}
                    aria-hidden="true"
                  />
                )}
                {isNarrating && (
                  <button
                    type="button"
                    onClick={() => {
                      // This button unmounts the instant isNarrating flips false, before the
                      // browser ever gets to dispatch a mouseleave/blur at the now-gone element -
                      // hideInfoTag() never runs on its own, so the hover card is stuck showing
                      // "Stop" until the player happens to hover another info-tag button. Calling
                      // it here explicitly closes it the moment the click is handled.
                      stopNarration();
                      hideInfoTag();
                    }}
                    className={`${styles.narrationControlButton} ${styles.narrationControlButtonPulsing}`}
                    onMouseEnter={(e) => showInfoTag(e, "Stop", "Stop reading this artifact aloud")}
                    onMouseLeave={hideInfoTag}
                    onFocus={(e) => showInfoTag(e, "Stop", "Stop reading this artifact aloud")}
                    onBlur={hideInfoTag}
                    aria-label="Stop reading this artifact aloud"
                  >
                    <Icon icon="ph:stop-circle-bold" />
                  </button>
                )}
                {!settings.mute_tts && currentArtifact?.content && (
                  <button
                    type="button"
                    onClick={() => currentArtifact && narrateArtifact(currentArtifact, currentArtifactKey)}
                    className={styles.narrationControlButton}
                    onMouseEnter={(e) => showInfoTag(e, "Listen Again", "Read this artifact aloud")}
                    onMouseLeave={hideInfoTag}
                    onFocus={(e) => showInfoTag(e, "Listen Again", "Read this artifact aloud")}
                    onBlur={hideInfoTag}
                    aria-label="Listen to this artifact again"
                  >
                    <Icon icon="ph:arrow-clockwise-bold" />
                  </button>
                )}

                {/* Quick direct item navigation pills */}
                {artifacts.length > 0 && !singleArtifact && (
                  <div
                    className={styles.navPillsContainer}
                    data-intro-group="introDossier"
                    data-title="On the Record vs. Yours to Call"
                    data-intro="Three of these items are already on the record: <mark class='mlops-mark-purple'><iconify-icon icon='ph:certificate-duotone'></iconify-icon> the challenge itself</mark>, and the conflicting opinions of the two main <mark class='mlops-mark-blue'><iconify-icon icon='ph:user-sound-duotone'></iconify-icon> stakeholders</mark> - look for the <iconify-icon icon='ph:lightning-fill' class='mlops-icon-yellow'></iconify-icon> bolt between their pills, that's exactly where the disagreement sits. Nothing to tag there - just read them, they've made up their minds without asking you. Every other numbered pill is yours to categorize, and getting it right is what actually earns you usable intel, not just a completion checkmark."
                    data-step="7"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        hideInfoTag();
                        handleResetClick();
                      }}
                      disabled={taggedArtifactsCount === 0}
                      className={`${styles.resetTagsButton} ${
                        isConfirmingReset ? styles.resetTagsButtonConfirming : ""
                      }`}
                      onMouseEnter={(e) =>
                        showInfoTag(
                          e,
                          isConfirmingReset ? "Confirm reset?" : "Reset all",
                          taggedArtifactsCount === 0
                            ? "Nothing categorized yet"
                            : isConfirmingReset
                              ? "Click again to confirm resetting all categories"
                              : "Clear every category you have picked\nand start again from the first artifact"
                        )
                      }
                      onMouseLeave={hideInfoTag}
                      onFocus={(e) =>
                        showInfoTag(
                          e,
                          isConfirmingReset ? "Confirm reset?" : "Reset all",
                          taggedArtifactsCount === 0
                            ? "Nothing categorized yet"
                            : isConfirmingReset
                              ? "Click again to confirm resetting all categories"
                              : "Clear every category you have picked\nand start again from the first artifact"
                        )
                      }
                      onBlur={hideInfoTag}
                      aria-label={
                        taggedArtifactsCount === 0
                          ? "Nothing categorized yet"
                          : isConfirmingReset
                            ? "Confirm reset: clear all categories"
                            : "Reset all categories"
                      }
                    >
                      <Icon
                        icon={isConfirmingReset ? "ph:warning-bold" : "ph:arrow-counter-clockwise-bold"}
                        className={styles.resetTagsButtonIcon}
                      />
                      <span>{isConfirmingReset ? "Confirm reset?" : "Reset all"}</span>
                    </button>
                    {artifacts.map((art, idx) => {
                      const key = art.id;
                      const isTagged = !!taggedTypes[key];
                      const isCurrent = idx === currentIndex;
                      // Each challenge's on-record pair is a disagreement between two stakeholders,
                      // and that disagreement is the challenge. Mark the seam between them - the
                      // System item leads the deck but isn't itself a side of the argument.
                      const previous = idx > 0 ? artifacts[idx - 1] : undefined;
                      const opensConflictSeam = Boolean(
                        isOnRecordStance(art) &&
                        previous &&
                        isOnRecordStance(previous) &&
                        previous.stakeholder_id !== art.stakeholder_id
                      );
                      const pillLabel = `Item ${idx + 1}: ${art.stakeholder_name}`;
                      const pillStatus = art.is_known
                        ? (isOnRecordFact(art) ? "On record: about the system" : "On record, nothing to tag")
                        : (isTagged ? `Categorized: ${intelTagMeta(taggedTypes[key])?.label ?? "Tagged"}` : "Uncategorized");
                      const pillDetail = [
                        pillStatus,
                        isCurrent ? "Currently viewing" : "Click to jump to item",
                      ].join("\n");

                      const pill = (
                        <button
                          key={key || idx}
                          onClick={() => {
                            hideInfoTag();
                            if (transitionTimeoutRef.current) {
                              clearTimeout(transitionTimeoutRef.current);
                              transitionTimeoutRef.current = null;
                            }
                            setDirection(idx >= currentIndex ? 1 : -1);
                            setCurrentIndex(idx);
                            if (onTagArtifact) {
                              onTagArtifact(dossierTargetFor(art, taggedTypes[key]));
                            }
                          }}
                          className={`btn btn-xs fw-bold ${styles.navPillIcon} ${styles.navPill} ${
                            art.is_known
                              ? (isOnRecordFact(art) ? styles.navPillOnRecordFact : styles.navPillOnRecord)
                              : isTagged
                                ? styles.navPillTagged
                                : styles.navPillUntagged
                          } ${isCurrent ? styles.navPillCurrent : ""}`}
                          onMouseEnter={(e) => showInfoTag(e, pillLabel, pillDetail)}
                          onMouseLeave={hideInfoTag}
                          onFocus={(e) => showInfoTag(e, pillLabel, pillDetail)}
                          onBlur={hideInfoTag}
                          aria-label={`${pillLabel}: ${pillStatus}`}
                        >
                          {art.is_known ? (
                            <Icon icon={isOnRecordFact(art) ? intelTagMeta("fact").icon : "ph:user-sound-duotone"} />
                          ) : (
                            idx + 1
                          )}
                        </button>
                      );

                      if (!opensConflictSeam) return pill;

                      return (
                        <span key={`seam-${key || idx}`} className={styles.conflictSeam}>
                          <span
                            className={styles.conflictSeamBolt}
                            onMouseEnter={(e) =>
                              showInfoTag(
                                e,
                                "Stakeholder Conflict",
                                `${previous?.stakeholder_name} and ${art.stakeholder_name} want different things here.\nSorting that out is the job.`
                              )
                            }
                            onMouseLeave={hideInfoTag}
                            onFocus={(e) =>
                              showInfoTag(
                                e,
                                "Stakeholder Conflict",
                                `${previous?.stakeholder_name} and ${art.stakeholder_name} want different things here.\nSorting that out is the job.`
                              )
                            }
                            onBlur={hideInfoTag}
                            tabIndex={0}
                            role="note"
                            aria-label={`Conflict between ${previous?.stakeholder_name} and ${art.stakeholder_name}`}
                          >
                            <Icon icon="ph:lightning-fill" aria-hidden="true" />
                          </span>
                          {pill}
                        </span>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        hideInfoTag();
                        if (transitionTimeoutRef.current) {
                          clearTimeout(transitionTimeoutRef.current);
                          transitionTimeoutRef.current = null;
                        }
                        setIsSubmitting(false);
                        setDirection(1);
                        setCurrentIndex(artifacts.length);
                      }}
                      className={`btn btn-xs fw-bold ${styles.navPill} ${
                        isFinished
                          ? styles.navPillCurrent
                          : allTagged
                            ? styles.navPillSummaryReady
                            : styles.navPillSummary
                      }`}
                      onMouseEnter={(e) =>
                        showInfoTag(
                          e,
                          allTagged ? "Ready for Summary" : "Categorization Summary",
                          allTagged
                            ? "All items categorized!\nView summary & continue to pitch"
                            : `Review progress (${taggedArtifactsCount}/${totalArtifactsCount} categorized)`
                        )
                      }
                      onMouseLeave={hideInfoTag}
                      onFocus={(e) =>
                        showInfoTag(
                          e,
                          allTagged ? "Ready for Summary" : "Categorization Summary",
                          allTagged
                            ? "All items categorized!\nView summary & continue to pitch"
                            : `Review progress (${taggedArtifactsCount}/${totalArtifactsCount} categorized)`
                        )
                      }
                      onBlur={hideInfoTag}
                      aria-label={allTagged ? "View Summary & Continue to Pitch" : "View Categorization Summary"}
                    >
                      <Icon icon={allTagged ? "ph:check-bold" : "ph:list-bullets-bold"} />
                      <span>Summary</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Bootswatch Journal Card */}
              <div
                className={`card border-secondary shadow-sm text-start w-100 ${styles.journalCard}`}
              >
                {loading ? (
                  <div className="card-body bg-light p-4 text-center my-3 d-flex flex-column justify-content-center align-items-center flex-grow-1">
                    <div className={`spinner-border text-primary mb-3 ${styles.loadingSpinner}`} role="status" />
                    <h5 className="fw-bold text-dark mb-2">Loading Offline Intel Artifacts...</h5>
                    <p className="text-muted fs-6 mb-0">Analyzing scenario specifications across stakeholder items.</p>
                  </div>
                ) : isFinished ? (
                  /* Completion State / Summary Screen */
                  <div className={styles.summaryContainer}>
                    {/* Header matching Journal style */}
                    <div className={styles.completionHeader}>
                      <div className="d-flex align-items-center gap-2">
                        <Icon
                          icon={allTagged ? "ph:check-circle-bold" : "ph:warning-circle-bold"}
                          className={`${allTagged ? "text-success" : "text-warning"} ${styles.completionStatusIcon}`}
                        />
                        <strong className={styles.completionHeaderText}>
                          {allTagged ? "Intel Artifacts Tagged" : "Incomplete Intel Categorization"}
                        </strong>
                      </div>
                      <span
                        className={`badge ${allTagged ? "bg-primary text-white" : "bg-warning text-dark"} ${styles.completionStatusBadge}`}
                      >
                        {taggedArtifactsCount} / {totalArtifactsCount} Categorized
                      </span>
                    </div>

                    <div className={styles.completionBody}>
                      {allTagged ? (
                        <>
                          <div className={`${styles.completionIconCircle} ${styles.completionIconSuccess}`}>
                            <Icon icon="ph:check-bold" />
                          </div>
                          <h4 className="fw-bold text-dark mb-2">Intel Artifacts Tagged!</h4>
                          <p className={`text-muted mb-4 fs-6 ${styles.completionDescription}`}>
                            All {totalArtifactsCount} artifacts have been categorized and recorded as <strong className="text-dark">unconfirmed intel</strong> in your Stakeholder Dossier. You'll be able to verify or correct each tag by talking to the stakeholders directly during the pitch phase.
                            {knownArtifactsCount > 0 && (
                              <>
                                {" "}The {knownArtifactsCount} item{knownArtifactsCount === 1 ? "" : "s"} you couldn't tag
                                {knownArtifactsCount === 1 ? " is" : " are"} filed as <strong className="text-dark">on record</strong>: they said
                                {knownArtifactsCount === 1 ? " it" : " those"} in public, so there's nothing left to check.
                              </>
                            )}
                          </p>
                        </>
                      ) : (
                        <>
                          <div className={`${styles.completionIconCircle} ${styles.completionIconWarning}`}>
                            <Icon icon="ph:warning-bold" />
                          </div>
                          <h4 className="fw-bold text-dark mb-2">Not All Artifacts Have Been Tagged</h4>
                          <p className={`text-muted mb-4 fs-6 ${styles.completionDescription}`}>
                            You have categorized <strong className="text-dark">{taggedArtifactsCount} of {totalArtifactsCount}</strong> artifacts. All artifacts must be tagged before proceeding to the pitch phase.
                          </p>
                        </>
                      )}

                      {/* Action buttons styled like login screen button */}
                      <div className="d-flex justify-content-center align-items-center gap-3 flex-wrap mt-2">
                        <button
                          onClick={() => {
                            if (transitionTimeoutRef.current) {
                              clearTimeout(transitionTimeoutRef.current);
                              transitionTimeoutRef.current = null;
                            }
                            setIsSubmitting(false);
                            setDirection(-1);
                            setCurrentIndex(0);
                          }}
                          className={styles.secondaryButton}
                        >
                          ◀ Review All Tags
                        </button>

                        {!allTagged ? (
                          <button
                            onClick={() => {
                              if (transitionTimeoutRef.current) {
                                clearTimeout(transitionTimeoutRef.current);
                                transitionTimeoutRef.current = null;
                              }
                              const targetIdx = firstUntaggedIndex !== -1 ? firstUntaggedIndex : 0;
                              setDirection(targetIdx >= currentIndex ? 1 : -1);
                              setCurrentIndex(targetIdx);
                            }}
                            className={`${styles.actionButton} ${styles.btnAutoWidth} ${styles.actionButtonNudge} shadow-sm d-inline-flex align-items-center justify-content-center gap-2`}
                          >
                            <Icon icon="ph:arrow-circle-right-bold" className={styles.btnIcon} />
                            <span>Categorize Remaining ({totalArtifactsCount - taggedArtifactsCount} Left)</span>
                          </button>
                        ) : (
                          <button
                            onClick={handleFinalContinue}
                            disabled={isSubmitting}
                            className={`${styles.actionButton} ${styles.btnAutoWidth} ${
                              isSubmitting ? "" : styles.actionButtonNudge
                            } shadow-sm d-inline-flex align-items-center justify-content-center gap-2`}
                          >
                            {isSubmitting ? (
                              <>
                                <span className="spinner-border spinner-border-sm" role="status" />
                                <span>Proceeding...</span>
                              </>
                            ) : (
                              <>
                                <span>Continue to the Pitch</span>
                                <Icon icon="ph:arrow-right-bold" />
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : currentArtifact ? (
                  /* Active Tagging View */
                  <div className={styles.activeStateGrid}>
                    <div className={`card-body bg-light ${styles.activeCardBody}`}>
                      {/* Known artifacts open the deck: say plainly why this one is not the player's to tag */}
                      {isOnKnownArtifact && (
                        <div className={`${styles.introBanner} ${styles.onRecordBanner}`}>
                          <OnceIcon icon={MICROPHONE_ICON} className={styles.introBannerLordicon} />
                          <span className={styles.introBannerBody}>
                            {isOnKnownFact ? (
                              <>
                                <strong>This is what the challenge is about.</strong> {currentArtifact.stakeholder_name}{" "}
                                posted it in a channel the whole team reads, so everyone already knows how things stand.
                                It's filed under <strong>Challenge-Intel</strong> in the Dossier as <strong>on record</strong>,
                                and there's nothing here for you to work out. Read it, then keep going.
                              </>
                            ) : (
                              <>
                                <strong>{currentArtifact.stakeholder_name} said this in the open.</strong> It went to a
                                channel the whole team reads, so everyone already knows where they stand. It's filed in
                                the Dossier as <strong>on record</strong> and there's nothing here for you to work out.
                                Read it, then keep going.
                              </>
                            )}
                            {conflictPartner && (
                              <span className={styles.conflictNote}>
                                <Icon icon="ph:lightning-fill" className={styles.conflictNoteIcon} />
                                {hasSeenConflictPartner
                                  ? `That's different than what ${conflictPartner.stakeholder_name} just said. Working out that clash is the job.`
                                  : `${conflictPartner.stakeholder_name} sees it differently, and you'll read their side next.`}
                              </span>
                            )}
                          </span>
                          {firstPlayerIndex !== -1 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (transitionTimeoutRef.current) {
                                  clearTimeout(transitionTimeoutRef.current);
                                  transitionTimeoutRef.current = null;
                                }
                                setDirection(1);
                                setCurrentIndex(firstPlayerIndex);
                              }}
                              className={styles.introBannerDismiss}
                            >
                              Skip ahead
                            </button>
                          )}
                        </div>
                      )}

                      {/* One-time intro banner: shown on the player's first taggable artifact, until dismissed */}
                      {showIntroBanner && currentIndex === firstPlayerIndex && (
                        <div className={styles.introBanner}>
                          <OnceIcon icon={EYE_ICON} className={styles.introBannerLordicon} />
                          <span className={styles.introBannerBody}>
                            <strong>New intel just came in.</strong> Read each item to learn more about your
                            stakeholders, then tag it below. It's saved as unconfirmed intel in their Dossier
                            until you verify it by talking to them in the next gameplay phase.
                          </span>
                          <button
                            type="button"
                            onClick={dismissIntroBanner}
                            className={styles.introBannerDismiss}
                          >
                            Got it
                          </button>
                        </div>
                      )}

                      {/* Artifact Viewer with Slide Transition - fills all remaining space, no chrome around it */}
                      <div
                        className={styles.viewerWrapper}
                        data-intro-group="introDossier"
                        data-title="The Artifact"
                        data-intro="This is the artifact body: an email, a chat message, meeting notes, or a document, giving you insight into the stakeholder's perspective. Read it for what it actually says, not just who sent it - the categorization below only works if you catch what they're really asking for, which is rarely the same as the subject line."
                        data-step="8"
                      >
                        <AnimatePresence mode="wait" custom={direction}>
                          <motion.div
                            key={`${currentIndex}-${currentArtifactKey}`}
                            custom={direction}
                            initial={{ opacity: 0, x: direction > 0 ? 40 : -40 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: direction > 0 ? -40 : 40 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className={styles.viewerMotionContainer}
                          >
                            <IntelArtifactViewer
                              content={currentArtifact.content}
                              artifactType={currentArtifact.artifact_type}
                              stakeholderName={currentArtifact.stakeholder_name}
                              isPublicRecord={Boolean(currentArtifact.is_known)}
                              activeSentenceIndex={
                                narratingArtifactKey === currentArtifactKey ? activeSentenceIndex : null
                              }
                            />
                          </motion.div>
                        </AnimatePresence>
                      </div>
                    </div>

                    {/* Compact Tagging Prompt & Buttons Panel - flush against the card's own edges, no nested box */}
                    <div
                      className={`${styles.taggingPanel} ${styles.taggingPanelStance}`}
                      data-intro-group="introDossier"
                      data-title="Categorize It"
                      data-intro="This is the categorization footer: first decide who or what the artifact is about, then whether they want it (<mark><iconify-icon icon='ph:target-duotone'></iconify-icon> driver</mark>), refuse it (<mark><iconify-icon icon='ph:prohibit-duotone'></iconify-icon> boundary</mark>), or would accept it under conditions (<mark><iconify-icon icon='ph:scales-duotone'></iconify-icon> trade-off</mark>). Get it wrong and you'll misjudge what a stakeholder actually needs later - but nothing here is final yet, it's saved as unconfirmed intel until you ask the stakeholders about it."
                      data-step="9"
                    >
                      <div className={styles.taggingPanelHeader}>
                        {!singleArtifact && (
                          <button
                            onClick={handlePrevItem}
                            disabled={currentIndex <= 0}
                            className={styles.navButton}
                            title="Previous Intel Artifact"
                            aria-label="Previous Intel Artifact"
                          >
                            <Icon icon="ph:caret-left-bold" className={styles.navButtonIcon} />
                          </button>
                        )}

                        <div className={styles.taggingPanelHeaderText}>
                          <div className={styles.taggingBadgeRow}>
                          <span
                            className={`${styles.taggingTypeBadge} ${
                              isOnKnownArtifact
                                ? styles.taggingTypeBadgeOnRecord
                                : styles.taggingTypeBadgeStance
                            }`}
                          >
                            {isOnKnownArtifact ? "On Record" : "Stance"}
                          </span>
                          {currentArtifact.debug && (
                            <button
                              type="button"
                              className={`${styles.debugToggle} ${
                                !currentTaggedType
                                  ? ""
                                  : currentTaggedType === currentArtifact.debug.correct_tag
                                    ? styles.debugRight
                                    : styles.debugWrong
                              }`}
                              onClick={() => setIsDebugOpen((open) => !open)}
                              title={`Debug: true tag is ${currentArtifact.debug.correct_tag}`}
                              aria-label="Toggle answer key (debug)"
                            >
                              <Icon icon="ph:bug-bold" />
                            </button>
                          )}
                          {currentArtifact.debug?.artifact && (
                            <button
                              type="button"
                              className={`${styles.debugToggle} ${
                                currentArtifact.debug.artifact.humor_archetype ? styles.debugRight : styles.debugWrong
                              }`}
                              onClick={() => setIsDebugOpen((open) => !open)}
                              title={
                                currentArtifact.debug.artifact.humor_archetype
                                  ? `Debug: humor applied (${currentArtifact.debug.artifact.humor_archetype})`
                                  : "Debug: no humor applied"
                              }
                              aria-label="Toggle answer key (debug)"
                            >
                              <Icon icon={currentArtifact.debug.artifact.humor_archetype ? "ph:mask-happy-bold" : "ph:mask-happy"} />
                            </button>
                          )}
                          </div>
                          <h6 className={styles.taggingTitle}>
                            {isOnKnownArtifact
                              ? isOnKnownFact
                                ? "How the system stands, already filed:"
                                : `${currentArtifact.stakeholder_name}'s stance, already filed:`
                              : `Categorize ${currentArtifact.stakeholder_name}'s stance:`}
                          </h6>
                        </div>
                        <small className={styles.taggingSubtitle}>
                          {isOnKnownArtifact ? "Nothing to pick" : "Select Category"}
                        </small>

                        {!singleArtifact ? (
                          <div className="d-flex align-items-center gap-1">
                            {allTagged && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (transitionTimeoutRef.current) {
                                    clearTimeout(transitionTimeoutRef.current);
                                    transitionTimeoutRef.current = null;
                                  }
                                  setIsSubmitting(false);
                                  setDirection(1);
                                  setCurrentIndex(artifacts.length);
                                }}
                                className={`${styles.actionButton} ${styles.returnHeaderButton}`}
                                title="All intel categorized. Return to summary to continue to the pitch debate."
                              >
                                <span>Finish & Continue</span>
                                <Icon icon="ph:arrow-right-bold" />
                              </button>
                            )}
                            <button
                              onClick={handleNextItem}
                              className={`${styles.navButton} ${
                                isNudging && isOnKnownArtifact ? styles.navButtonNudge : ""
                              }`}
                              title={currentIndex < artifacts.length - 1 ? "Next Intel Artifact" : "Finish / View Summary"}
                              aria-label={currentIndex < artifacts.length - 1 ? "Next Intel Artifact" : "Finish / View Summary"}
                            >
                              <Icon
                                icon={currentIndex < artifacts.length - 1 ? "ph:caret-right-bold" : "ph:arrow-right-bold"}
                                className={styles.navButtonIcon}
                              />
                            </button>
                          </div>
                        ) : onGoBack ? (
                          <button
                            type="button"
                            onClick={onGoBack}
                            className={`${styles.actionButton} ${styles.returnHeaderButton}`}
                            title="Return to pitch debate"
                          >
                            <span>Return to pitch debate</span>
                            <Icon icon="ph:arrow-right-bold" />
                          </button>
                        ) : null}
                      </div>

                      {currentArtifact.debug && isDebugOpen && (
                        <div className={styles.debugPanel}>
                          <strong>True tag:</strong>{" "}
                          <span
                            className={
                              !currentTaggedType || currentTaggedType === currentArtifact.debug.correct_tag
                                ? styles.debugRightText
                                : styles.debugWrongText
                            }
                          >
                            {currentArtifact.debug.correct_tag}
                          </span>
                          {currentArtifact.debug.target && (
                            <>
                              {" "}· {currentArtifact.debug.target}
                              {currentArtifact.debug.level != null && <> at level {currentArtifact.debug.level}</>}
                            </>
                          )}
                          {" "}· <span className={styles.debugId}>{currentArtifact.debug.id}</span>
                          <br />
                          <strong>Humor:</strong>{" "}
                          {currentArtifact.debug.artifact?.humor_archetype ? (
                            <span className={styles.debugRightText}>{currentArtifact.debug.artifact.humor_archetype}</span>
                          ) : (
                            <span className={styles.debugWrongText}>none</span>
                          )}
                          {currentArtifact.debug.artifact?.humor_verdict && (
                            <>
                              {" "}·{" "}
                              <span
                                className={
                                  currentArtifact.debug.artifact.humor_verdict === "strong"
                                    ? styles.debugRightText
                                    : styles.debugWrongText
                                }
                              >
                                {currentArtifact.debug.artifact.humor_verdict}
                              </span>
                            </>
                          )}
                          {currentArtifact.debug.artifact?.humor_review_reason && (
                            <>
                              <br />
                              <strong>Humor review:</strong> {currentArtifact.debug.artifact.humor_review_reason}
                            </>
                          )}
                        </div>
                      )}

                      <p className={styles.taggingHint}>
                        {isOnKnownArtifact
                          ? "This one is already sorted, and the category below is the right one. It's here so you can see what a finished call looks like before you make your own."
                          : "First ask: is this about a person or about the system? If it is about a person, do they want it, refuse to cross it, or accept giving it up?"}
                      </p>

                      <div className={`row g-2 ${styles.tagGrid}`}>
                        {REQUIREMENT_TAGS.filter((tag) => tag.type !== "fact" || isOnKnownFact).map((tag) => {
                          const isSelected = currentTaggedType === tag.type;
                          const isSystemTag = (tag as { about?: string }).about === "system";
                          const colClass = isSystemTag ? "col-12" : "col-12 col-md-4";
                          const sizeClass = styles.tagButtonRequirement;

                          return (
                            <Fragment key={tag.type}>
                            {isSystemTag && (
                              <div className="col-12">
                                <small className={styles.tagGroupLabel}>Not about anyone: about the system</small>
                              </div>
                            )}
                            <div className={colClass}>
                              <button
                                onClick={() => handleTagArtifact(tag.type)}
                                onMouseEnter={() => setHoveredTag(tag.type)}
                                onMouseLeave={() => setHoveredTag(null)}
                                disabled={isOnKnownArtifact}
                                title={isOnKnownArtifact ? "Already on record, nothing to change here" : undefined}
                                className={`btn ${styles.tagButton} ${sizeClass} ${isSelected ? styles.tagButtonSelected : ""} ${
                                  isOnKnownArtifact ? styles.tagButtonLocked : ""
                                } ${isNudging && !isOnKnownArtifact ? styles.tagButtonNudge : ""}`}
                                style={{ borderColor: tag.color }}
                              >
                                <div className={styles.tagButtonHeader}>
                                  <span className={styles.tagButtonLabelGroup}>
                                    <Icon icon={tag.icon} style={{ color: tag.color }} />{" "}
                                    <span className={styles.tagButtonLabel} style={{ color: tag.color }}>{tag.label}</span>
                                  </span>
                                  {isSelected && (
                                    <span
                                      className={`badge text-white ${styles.tagButtonBadge}`}
                                      title={
                                        isOnKnownArtifact
                                          ? "This is the right category, already filed for you"
                                          : "Pick another category to re-tag this artifact"
                                      }
                                    >
                                      <Icon
                                        icon={isOnKnownArtifact ? "ph:lock-simple-bold" : "ph:pencil-simple-bold"}
                                        className={styles.tagButtonBadgeIcon}
                                      />
                                      {isOnKnownArtifact ? "On record" : "Selected"}
                                    </span>
                                  )}
                                </div>
                                <small className={styles.tagButtonDescription}>
                                  {tag.description}
                                </small>
                              </button>
                            </div>
                            </Fragment>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="card-body bg-light p-4 text-center">
                    <p className="text-muted">No artifacts available for this challenge.</p>
                    <button onClick={handleFinalContinue} className={`${styles.actionButton} ${styles.btnAutoWidth}`}>
                      Continue
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <EventLogModal
        isVisible={isLogOpen}
        onClose={() => setIsLogOpen(false)}
        events={events}
        onItemClick={jumpToIntelItem}
      />

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

