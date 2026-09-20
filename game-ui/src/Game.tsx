import { useState, useRef, useEffect } from "react";
import { useGameWebSocket } from "./services/websocket/useGameWebSocket";
import type { ActionCard } from "./types/ActionCard";
import type { EngagementCard } from "./types/EngagementCard";
import Questionaire from "./Questionaire";
import type { Briefing } from "./types/Briefing";
import type { Question } from "./types/Question";
import BriefingPage from "./BriefingPage";
import introJs from "intro.js";
import "intro.js/introjs.css";
import EndPage from "./EndPage";
import OfflineIntelGathering from "./components/offline_intel_gathering";
import { type IntelItem } from "./components/ActionCardCardComponent";
import PitchDebate from "./components/pitch_debate";
import AcSimulation from "./components/ac_simulation";
import type { ChatMsg } from "./components/StakeholderInteractionArea";
import { MetricsContext } from "./components/MetricProvider";
import { StakeholderContext } from "./components/StakeholderProvider";
import { PhasesContext } from "./components/PhaseProvider";
import PrePhaseDialog from "./components/PrePhaseDialog";
import ErrorDialog from "./components/ErrorDialog";
import PerformanceDashboard from "./components/PerformanceDashboard";
import LoadingScreen from "./components/LoadingScreen";
import { motion, AnimatePresence } from "motion/react";
import { FADE_TRANSITION } from "./utils/transitions";
import type { StakeholderDossierEntry } from "./components/StakeholderDossier";
import type { StakeholderAvatar } from "./types/StakeholderAvatar";
import { colorForStakeholderId } from "./types/StakeholderAvatar";
import type { DialogueOption } from "./types/DialogueOption";

interface Stakeholder {
  id: string;
  name: string;
  responsibilities: string;
  priorities: string;
  constraints?: string;
  role_description: string;
  metric_id: string;
  stakeholder_color?: string;
  facial_expression?: string;
  emotion?: string;
  avatar?: StakeholderAvatar;
  power?: string;
  interest?: string;
  emotional_state?: string;
}

interface Metric {
  id: string;
  value?: number;
  name: string;
  description: string;
  start_value: number;
  phases: boolean[];
  metric_icon: string;
  max_value: number;
  metric_color: string;
}

interface AppProps {
  username: string;
}



function App({ username: _username }: AppProps) {
  const debug: boolean = false;
  const { emit, subscribe, isConnected } = useGameWebSocket();

  const sendJsonMessage = (data: any) => {
    emit(data.type, data);
  };

  const [currentPhase, setCurrentPhase] = useState(0);
  const [currentChallenge, setCurrentChallenge] = useState(0);
  const [phases, setPhases] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<Record<string, Metric>>({});
  const [challengeAmount, setChallengeAmount] = useState(0);
  const [_challengeMetricChanges, setChallengeMetricChanges] = useState<
    Record<string, number>
  >({});
  const [stakeholders, setStakeholders] = useState<Record<string, Stakeholder>>({});
  const [emotionColors, setEmotionColors] = useState<Record<string, string>>({});
  const [chat_msgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [engagementCards, setEngagementCards] = useState<EngagementCard[]>([]);
  const [attentionTokens, setAttentionTokens] = useState<number>(20);
  const [hasPitchDebateStarted, setHasPitchDebateStarted] = useState<boolean>(false);
  // Only the setter is used now: PitchDebate (the old reader of this flag) was
  // removed with the merged pitch phase (D37/D46).
  const [, setIsExistingDebateSave] = useState<boolean>(false);
  const [challengeTitle, setChallengeTitle] = useState("");
  const [challengeDescription, setChallengeDescription] = useState("");
  const [challengeIntro, setChallengeIntro] = useState("");
  const [progressionIndex, setProgressionIndex] = useState<number | null>(null);
  const [isLoadingSave, setIsLoadingSave] = useState<boolean>(true);
  const [isPhaseDialogueOpen, setIsPhaseDialogueOpen] = useState(false);
  // True when the briefing was reopened from the dossier mid-phase, so closing
  // it returns to the phase instead of starting the round.
  const [isBriefingReview, setIsBriefingReview] = useState(false);

  const openBriefingForReview = () => {
    setIsBriefingReview(true);
    setIsPhaseDialogueOpen(true);
  };
  // Only the setter is used now: the old PitchDebate/OnlineIntelGathering readers
  // of this flag were removed with the merged pitch phase (D37/D46).
  const [, setIsChatEnabled] = useState(true);
  const [isintro5Done, setIsintro5Done] = useState(false);
  const [isIntro1Started, setIsIntro1Started] = useState(false);
  const [isInErrorUi, setIsInErrorUi] = useState(false);
  const [lastError, setLastError] = useState("");
  const [challengeLoopId, setChallengeLoopId] = useState<number>(0);
  const [isDossierOpen, setIsDossierOpen] = useState(false);
  const [dossierData, setDossierData] = useState<StakeholderDossierEntry[]>([]);
  // Only the setter is used now: rendering this list moved into PitchPhase's own
  // dossier-derived state, so Game.tsx just keeps it updated for the websocket handlers.
  const [, setIntelItems] = useState<IntelItem[]>([]);
  const [activeStakeholderId, setActiveStakeholderId] = useState<string | undefined>(undefined);
  const [playedCardIdsInPhase, setPlayedCardIdsInPhase] = useState<string[]>([]);
  const [cardTargetedStakeholdersMap, setCardTargetedStakeholdersMap] = useState<Record<string, string[]>>({});
  const [pitchedActionCard, setPitchedActionCard] = useState<ActionCard | null>(null);

  const stakeholdersRef = useRef<Record<string, Stakeholder>>({});
  const metricsRef = useRef<Record<string, Metric>>({});
  const currentPhaseRef = useRef<number>(0);
  const currentChallengeRef = useRef<number>(0);
  const isintro5DoneRef = useRef<boolean>(false);
  const isIntro1StartedRef = useRef<boolean>(false);
  const hasPitchDebateStartedRef = useRef<boolean>(false);
  const hasReceivedInitialStateRef = useRef<boolean>(false);

  useEffect(() => {
    stakeholdersRef.current = stakeholders;
  }, [stakeholders]);

  useEffect(() => {
    metricsRef.current = metrics;
  }, [metrics]);

  useEffect(() => {
    currentPhaseRef.current = currentPhase;
  }, [currentPhase]);

  useEffect(() => {
    currentChallengeRef.current = currentChallenge;
  }, [currentChallenge]);

  useEffect(() => {
    isintro5DoneRef.current = isintro5Done;
  }, [isintro5Done]);

  useEffect(() => {
    isIntro1StartedRef.current = isIntro1Started;
  }, [isIntro1Started]);

  useEffect(() => {
    hasPitchDebateStartedRef.current = hasPitchDebateStarted;
  }, [hasPitchDebateStarted]);

  // Composite key of the last challenge PrePhaseDialog was actually shown for. A phase
  // change always changes this key too, so tracking it alone covers both "new phase" and
  // "new challenge within the same phase" - the dialog reopens, tagged NEW, either way.
  const prevShownChallengeKeyRef = useRef<string | null>(null);
  const [isNewChallenge, setIsNewChallenge] = useState(false);

  // Manage PrePhaseDialog (at the start of each phase, and each new challenge within it)
  useEffect(() => {
    if (progressionIndex === 2 && phases.length > 0) {
      // Only when challengeLoopId === 0 (Offline Intel Gathering, the start of a challenge's loop)
      if (challengeLoopId === 0) {
        const challengeKey = `${currentPhase}:${currentChallenge}`;

        if (prevShownChallengeKeyRef.current !== challengeKey) {
          prevShownChallengeKeyRef.current = challengeKey;
          setIsNewChallenge(true);

          // If phase 0 and intro1 hasn't run yet, run intro1 then open PrePhaseDialog
          if (currentPhase === 0 && !isIntro1StartedRef.current) {
            isIntro1StartedRef.current = true;
            setIsIntro1Started(true);
            setTimeout(() => {
              introJs()
                .setOptions({
                  group: "intro1",
                  exitOnEsc: false,
                  exitOnOverlayClick: false,
                })
                .oncomplete(() => setIsPhaseDialogueOpen(true))
                .onexit(() => setIsPhaseDialogueOpen(true))
                .start();
            }, 100);
          } else {
            setIsPhaseDialogueOpen(true);
          }
        }
      }
    }
  }, [
    progressionIndex,
    currentPhase,
    currentChallenge,
    challengeLoopId,
    phases.length,
  ]);


  const onQuestionaireCompleted = (nextProgressIndex: number) => {
    sendJsonMessage({
      type: "game:progress_update",
      value: nextProgressIndex,
      additional_data: answers,
    });
  };

  const onBriefingCompleted = () => {
    sendJsonMessage({
      type: "game:progress_update",
      value: 2,
    });
  };

  const [briefing, setBriefing] = useState<Briefing>({
    briefing_title: "",
    briefing_description: "",
  });
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<(Record<string, any> | null)[]>(
    Array(questions.length).fill(null),
  );
  const [isPerformanceOpen, setIsPerformanceOpen] = useState(false);

  useEffect(() => {
    // Request initial game configurations ONCE on mount
    emit("game:init");

    const unsubInit = subscribe("game:init_data", (data: any) => {
      const rawStakeholders = data["stakeholders"] || {};
      const rawMetrics = data["metrics"] || {};
      const enrichedStakeholders = { ...rawStakeholders };
      Object.keys(enrichedStakeholders).forEach((stId) => {
        const st = enrichedStakeholders[stId];
        const associatedMetric = rawMetrics[st.metric_id] || Object.values(rawMetrics).find((m: any) => m.id === st.metric_id);
        st.stakeholder_color = associatedMetric ? associatedMetric.metric_color : colorForStakeholderId(stId);
        if (st.avatar) {
          st.avatar.clothingColor = st.stakeholder_color;
        }
      });
      setStakeholders(enrichedStakeholders);
      setMetrics(rawMetrics);
      setPhases(data["phases"]);
      if (data["phases"] && data["phases"].length > 0) {
        setChallengeAmount(data["phases"].length);
      }
      if (data["emotion_colors"]) {
        setEmotionColors(data["emotion_colors"]);
        (window as any).__EMOTION_COLORS__ = data["emotion_colors"];
      }
    });

    const unsubProgress = subscribe("game:progress_change", (data: any) => {
      if (data.progressionIndex !== undefined) {
        setProgressionIndex(data.progressionIndex);

        if (data.progressionIndex === 0 && data.questions) {
          setQuestions(data.questions);
          setIsLoadingSave(false);
        } else if (data.progressionIndex === 1 && data.content) {
          setBriefing(data.content);
          setIsLoadingSave(false);
        } else if (data.progressionIndex === 3 && data.questions) {
          setAnswers([]);
          setQuestions(data.questions);
          setIsLoadingSave(false);
        } else if (data.progressionIndex === 4) {
          setIsLoadingSave(false);
        } else {
          setIsLoadingSave(false);
        }
      }
    });

    const unsubState = subscribe("game:state_update", (data: any) => {
      if (data.progressionIndex !== undefined) {
        setProgressionIndex(data.progressionIndex);
      }
      setIsLoadingSave(false);

      setMetrics((prevMetrics) => {
        const updated = { ...prevMetrics };
        const metricIds = Object.keys(updated);
        metricIds.forEach((id, i) => {
          if (updated[id] && data.metric_values && data.metric_values[i] !== undefined) {
            updated[id] = {
              ...updated[id],
              value: data.metric_values[i],
            };
          }
        });
        return updated;
      });

      setChallengeTitle(data["name"]);
      setChallengeIntro(data["roundIntroduction"]);
      setChallengeDescription(data["description"]);
      if (data.engagement_cards) {
        setEngagementCards(data.engagement_cards);
      }
      if (data.stakeholders) {
        const rawStakeholders = data.stakeholders;
        const currentMetrics = metricsRef.current || {};
        const enrichedStakeholders = { ...rawStakeholders };
        Object.keys(enrichedStakeholders).forEach((stId) => {
          const st = enrichedStakeholders[stId];
          const associatedMetric = currentMetrics[st.metric_id] || Object.values(currentMetrics).find((m: any) => m.id === st.metric_id);
          st.stakeholder_color = associatedMetric ? associatedMetric.metric_color : (st.stakeholder_color || colorForStakeholderId(stId));
          st.emotional_state = (data.emotional_states && data.emotional_states[st.id]) || st.emotional_state || "neutral";
          if (st.avatar) {
            st.avatar.clothingColor = st.stakeholder_color;
          }
        });
        setStakeholders(enrichedStakeholders);
      }

      if (data.challenge_stakeholders && Array.isArray(data.challenge_stakeholders)) {
        setStakeholders((prev) => {
          const updated = { ...prev };
          data.challenge_stakeholders.forEach((cs: any) => {
            if (updated[cs.stakeholder_id]) {
              updated[cs.stakeholder_id] = {
                ...updated[cs.stakeholder_id],
                power: cs.power,
                interest: cs.interest,
              };
            }
          });
          return updated;
        });

        setDossierData((prev) =>
          prev.map((entry) => {
            const match = data.challenge_stakeholders.find(
              (cs: any) => cs.stakeholder_id === entry.stakeholder_id
            );
            return match ? { ...entry, power: match.power, interest: match.interest } : entry;
          })
        );
      }

      const isFirstLoad = !hasReceivedInitialStateRef.current;
      hasReceivedInitialStateRef.current = true;
      const loopId = data.challenge_loop_id !== undefined ? data.challenge_loop_id : challengeLoopId;

      if (isFirstLoad) {
        currentPhaseRef.current = data["phase_id"];
        currentChallengeRef.current = data["challenge_id"];
        setCurrentPhase(data["phase_id"]);
        setCurrentChallenge(data["challenge_id"]);
        if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
          setChatMsgs(data.messages);
          setIsExistingDebateSave(true);
          if (loopId >= 2) {
            setHasPitchDebateStarted(true);
            hasPitchDebateStartedRef.current = true;
          }
        } else {
          setChatMsgs([]);
          setIsExistingDebateSave(false);
        }
        setAttentionTokens(data.attention_tokens);
        if (data.played_engagement_card_ids) setPlayedCardIdsInPhase(data.played_engagement_card_ids);
        if (data.engagement_card_targets) setCardTargetedStakeholdersMap(data.engagement_card_targets);
        if (data.action_card && typeof data.action_card === "object" && data.action_card.title) {
          setPitchedActionCard(data.action_card);
        }
      } else if (data["challenge_id"] !== currentChallengeRef.current || data["phase_id"] !== currentPhaseRef.current) {
        // If we transitioned to a new challenge (round completed after simulation), reset local state
        currentPhaseRef.current = data["phase_id"];
        currentChallengeRef.current = data["challenge_id"];
        setCurrentPhase(data["phase_id"]);
        setCurrentChallenge(data["challenge_id"]);
        setChatMsgs([]);
        setIsExistingDebateSave(false);
        setAttentionTokens(data.attention_tokens);
        setPlayedCardIdsInPhase([]);
        setCardTargetedStakeholdersMap({});
        setPitchedActionCard(null);
        setHasPitchDebateStarted(false);
        hasPitchDebateStartedRef.current = false;
      } else {
        // Same challenge / loading: restore messages and attention tokens if available
        if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
          setChatMsgs(data.messages);
          if (loopId >= 2) {
            setHasPitchDebateStarted(true);
            hasPitchDebateStartedRef.current = true;
          }
        }
        if (data.attention_tokens !== undefined) {
          setAttentionTokens(data.attention_tokens);
        }
        if (data.action_card && typeof data.action_card === "object" && data.action_card.title) {
          setPitchedActionCard(data.action_card);
        }
        if (data.played_engagement_card_ids) setPlayedCardIdsInPhase(data.played_engagement_card_ids);
        if (data.engagement_card_targets) setCardTargetedStakeholdersMap(data.engagement_card_targets);
      }

      if (data.facial_expressions && typeof data.facial_expressions === "object") {
        setStakeholders((prev) => {
          const updated = { ...prev };
          Object.keys(data.facial_expressions).forEach((stId) => {
            if (updated[stId]) {
              const face = data.facial_expressions[stId];
              updated[stId] = {
                ...updated[stId],
                facial_expression: face,
                emotion: face,
                avatar: {
                  ...updated[stId].avatar,
                  face: face,
                  emotion: face,
                },
              };
            }
          });
          return updated;
        });
      }

      if (data.emotional_states && typeof data.emotional_states === "object") {
        setStakeholders((prev) => {
          const updated = { ...prev };
          Object.keys(data.emotional_states).forEach((stId) => {
            if (updated[stId]) {
              updated[stId] = {
                ...updated[stId],
                emotional_state: data.emotional_states[stId],
              };
            }
          });
          return updated;
        });
      }

      if (data.dialogue_options && Array.isArray(data.dialogue_options)) {
        setDialogueOptions(data.dialogue_options);
      }

      setChallengeAmount(data["phases_amount"] || data["challenges_amount"]);
      setChallengeMetricChanges(data["metric_changes"]);
      if (data.challenge_loop_id !== undefined) {
        setChallengeLoopId(data.challenge_loop_id);
      }
    });

    const unsubChatReceived = subscribe("chat:message_received", (data: any) => {
      if (data && data.emotional_states && typeof data.emotional_states === "object") {
        setStakeholders((prev) => {
          const updated = { ...prev };
          Object.keys(data.emotional_states).forEach((stId) => {
            if (updated[stId]) {
              updated[stId] = {
                ...updated[stId],
                emotional_state: data.emotional_states[stId],
              };
            }
          });
          return updated;
        });
      }

      if (data.messages && Array.isArray(data.messages)) {
        setChatMsgs((prevMsgs) => [
          ...prevMsgs,
          ...data.messages.map((msg: any) => ({
            id: msg.stakeholder_id || msg.id,
            stakeholder_id: msg.stakeholder_id || msg.id,
            stakeholder_name: msg.stakeholder_name,
            message: msg.message,
            facial_expression: msg.facial_expression,
            ac_id: -1,
            revealed_intel: msg.revealed_intel || [],
          })),
        ]);

        const allRevealed: any[] = data.messages.flatMap((m: any) => m.revealed_intel || []);
        if (allRevealed.length > 0) {
          setDossierData((prevDossier) => {
            if (!prevDossier || prevDossier.length === 0) return prevDossier;
            return prevDossier.map((st) => {
              const existingIds = new Set((st.intel_items || []).map((i) => i.id));
              const updatedExisting = (st.intel_items || []).map((item) => {
                const matchingRev = allRevealed.find((r) => r.id === item.id);
                if (matchingRev) {
                  return {
                    ...item,
                    description: matchingRev.description || item.description,
                    intel_type: matchingRev.intel_type || "verified",
                    categorized_type: matchingRev.categorized_type || item.categorized_type,
                    is_correct: matchingRev.is_corrected !== undefined ? matchingRev.is_corrected : true,
                    // The stakeholder just said it out loud, so the note's caption has to move
                    // with the stamp instead of still crediting the document it came from.
                    source: "debate",
                  };
                }
                return item;
              });
              const brandNewForSt = allRevealed.filter(
                (r) =>
                  (r.stakeholder_id === st.stakeholder_id || (!r.stakeholder_id && st.is_environment)) &&
                  !existingIds.has(r.id)
              ).map((r) => ({
                id: r.id,
                description: r.description,
                intel_type: r.intel_type || "verified",
                categorized_type: r.categorized_type,
                is_correct: r.is_corrected !== undefined ? r.is_corrected : true,
                source: "debate",
                stakeholder_id: st.stakeholder_id,
              }));
              return { ...st, intel_items: [...updatedExisting, ...brandNewForSt] };
            });
          });

          setIntelItems((prevItems) => {
            const existingIds = new Set(prevItems.map((i) => i.id));
            const updated = prevItems.map((item) => {
              const matchingRev = allRevealed.find((r) => r.id === item.id);
              if (matchingRev) {
                return {
                  ...item,
                  description: matchingRev.description || item.description,
                  intel_type: matchingRev.intel_type || "verified",
                  categorized_type: matchingRev.categorized_type || item.categorized_type,
                  is_correct: matchingRev.is_corrected !== undefined ? matchingRev.is_corrected : true,
                };
              }
              return item;
            });
            const brandNew = allRevealed.filter((r) => !existingIds.has(r.id));
            return [...updated, ...brandNew];
          });
        }
      }

      if (data.facial_expressions && typeof data.facial_expressions === "object") {
        setStakeholders((prev) => {
          const updated = { ...prev };
          Object.keys(data.facial_expressions).forEach((stId) => {
            if (updated[stId]) {
              const face = data.facial_expressions[stId];
              updated[stId] = {
                ...updated[stId],
                facial_expression: face,
                emotion: face,
                avatar: {
                  ...updated[stId].avatar,
                  face: face,
                  emotion: face,
                },
              };
            }
          });
          return updated;
        });
      }
    });

    const unsubChatCompleted = subscribe("chat:graph_completed", (data: any) => {

      setIsChatEnabled(true);

      if (data && data.emotional_states && typeof data.emotional_states === "object") {
        setStakeholders((prev) => {
          const updated = { ...prev };
          Object.keys(data.emotional_states).forEach((stId) => {
            if (updated[stId]) {
              updated[stId] = {
                ...updated[stId],
                emotional_state: data.emotional_states[stId],
              };
            }
          });
          return updated;
        });
      }

      if (currentPhaseRef.current === 0 && currentChallengeRef.current === 0 && !isintro5DoneRef.current) {
        setTimeout(() => {
          introJs()
            .setOptions({
              group: "intro5",
              exitOnEsc: false,
              exitOnOverlayClick: false,
            })
            .start();
        }, 100);
        setIsintro5Done(true);
      }

      if (data && data.dialogue_options && Array.isArray(data.dialogue_options)) {
        setDialogueOptions(data.dialogue_options);
      }

      if (data && data.facial_expressions && typeof data.facial_expressions === "object") {
        setStakeholders((prev) => {
          const updated = { ...prev };
          Object.keys(data.facial_expressions).forEach((stId) => {
            if (updated[stId]) {
              const face = data.facial_expressions[stId];
              updated[stId] = {
                ...updated[stId],
                facial_expression: face,
                emotion: face,
                avatar: {
                  ...updated[stId].avatar,
                  face: face,
                  emotion: face,
                },
              };
            }
          });
          return updated;
        });
      }

      if (data && data.error === true) {
        setIsInErrorUi(true);
        setLastError(data.errorMsg);
      }
    });

    const unsubError = subscribe("system:error", (data: any) => {
      setIsInErrorUi(true);
      setLastError(data.message || data.error_message || data.error);
      setIsChatEnabled(true);
    });

    const unsubDossier = subscribe("intel:dossier_data", (payload: any) => {
      console.log("[WS] Received intel:dossier_data:", payload);
      if (payload && payload.dossier) {
        setDossierData(payload.dossier);
        const directIntelItems: IntelItem[] = (payload.dossier || []).flatMap((entry: any) =>
          (entry.intel_items || []).map((intel: any) => ({
            ...intel,
            stakeholder_id: entry.stakeholder_id,
            stakeholder_name: entry.name,
          }))
        );
        setIntelItems(directIntelItems);
      }
    });

    const unsubTagged = subscribe("intel:tagged_ack", (payload: any) => {
      console.log("[WS] Received intel:tagged_ack:", payload);
      emit("intel:get_dossier", {
        phase_id: currentPhaseRef.current,
        challenge_id: currentChallengeRef.current,
      });
    });

    return () => {
      unsubInit();
      unsubProgress();
      unsubState();
      unsubChatReceived();
      unsubChatCompleted();
      unsubError();
      unsubDossier();
      unsubTagged();
    };
  }, [emit, subscribe, debug]);

  // Fetch initial dossier & intel items when connected or when currentPhase/currentChallenge changes (e.g. restoring saved game)
  useEffect(() => {
    if (isConnected) {
      emit("intel:get_dossier", {
        phase_id: currentPhase,
        challenge_id: currentChallenge,
      });
    }
  }, [isConnected, currentPhase, currentChallenge, emit]);

  const handleOfflineIntelGatheringContinue = () => {
    let _metric_values: any = [];
    Object.values(metrics).forEach((x) => {
      _metric_values.push(x.value ?? 0);
    });

    sendJsonMessage({
      type: "game:state_update_request",
      challenge_id: currentChallenge,
      phase_id: currentPhase,
      challenge_loop_index: 0,
      metric_values: _metric_values,
      action_card_id: null,
      messages: [],
    });
  };

  const handlePitchDebateEnd = (_passed: boolean, card?: ActionCard | null) => {
    if (card) {
      setPitchedActionCard(card);
    }
    const finalCard = card || pitchedActionCard || {};

    let _metric_values: any = [];
    Object.values(metrics).forEach((x) => {
      _metric_values.push(x.value ?? 0);
    });

    sendJsonMessage({
      type: "game:state_update_request",
      challenge_id: currentChallenge,
      phase_id: currentPhase,
      challenge_loop_index: 2,
      metric_values: _metric_values,
      action_card: finalCard,
      messages: chat_msgs,
      attention_tokens: attentionTokens,
    });
  };

  const handleAcSimulationContinue = () => {

    let _metric_values: any = [];
    Object.values(metrics).forEach((x) => {
      _metric_values.push(x.value ?? 0);
    });

    sendJsonMessage({
      type: "game:state_update_request",
      challenge_id: currentChallenge,
      phase_id: currentPhase,
      challenge_loop_index: 3,
      metric_values: _metric_values,
      action_card_id: null,
      messages: [],
      attention_tokens: attentionTokens,
    });
  };

  // Only the setter is used now: the old PitchDebate reader of these options was removed
  // with the merged pitch phase (D37/D46).
  const [, setDialogueOptions] = useState<DialogueOption[]>([]);

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
      <ErrorDialog errorMsg={lastError} setIsOpen={setIsInErrorUi} isOpen={isInErrorUi} />
      <AnimatePresence mode="wait">
        {isLoadingSave || progressionIndex === null ? (
          <motion.div {...FADE_TRANSITION} key="game-loading" style={{ width: "100%", height: "100%" }}>
            <LoadingScreen />
          </motion.div>
        ) : progressionIndex === 0 ? (
          <motion.div {...FADE_TRANSITION} key="intro-questionnaire" style={{ width: "100%", height: "100%" }}>
            <Questionaire
              questions={questions}
              onQuestionaireCompleted={() => {
                onQuestionaireCompleted(1);
              }}
              setAnswers={setAnswers}
              answers={answers}
            />
          </motion.div>
        ) : progressionIndex === 1 ? (
          <motion.div {...FADE_TRANSITION} key="prebriefing" style={{ width: "100%", height: "100%" }}>
            <BriefingPage
              onBriefingCompleted={onBriefingCompleted}
              briefing={briefing}
            />
          </motion.div>
        ) : progressionIndex === 2 ? (
          <motion.div {...FADE_TRANSITION} key="gameplay" style={{ width: "100%", height: "100%" }}>
            <PhasesContext.Provider
              value={{ currentPhase, setCurrentPhase, phases, setPhases }}
            >
              <MetricsContext.Provider value={{ metrics, setMetrics }}>
                <StakeholderContext.Provider
                  value={{
                    stakeholders,
                    setStakeholders,
                    emotionColors,
                    setEmotionColors,
                  }}
                >
                  <PerformanceDashboard
                    currentPhase={currentPhase}
                    isOpen={isPerformanceOpen}
                    onClose={() => setIsPerformanceOpen(false)}
                    dossierData={dossierData}
                    // A component owner links to that stakeholder's dossier page: the dashboard
                    // steps aside and the dossier opens on them.
                    onOpenStakeholder={(stakeholderId) => {
                      setActiveStakeholderId(stakeholderId);
                      setIsDossierOpen(true);
                      setIsPerformanceOpen(false);
                    }}
                  />
                  <PrePhaseDialog
                    isOpen={isPhaseDialogueOpen}
                    setIsOpen={(open) => {
                      setIsPhaseDialogueOpen(open);
                      if (!open) setIsBriefingReview(false);
                    }}
                    isReview={isBriefingReview}
                    // Reviewing from the dossier just re-shows the existing briefing, never a "NEW" tag.
                    isNewChallenge={!isBriefingReview && isNewChallenge}
                    challengeTitle={challengeTitle}
                    challengeDescription={challengeDescription}
                    challengeIntro={challengeIntro}
                    currentChallenge={currentChallenge}
                    challengeAmount={challengeAmount}
                  />

                  <AnimatePresence mode="wait">
                    {challengeLoopId === 0 && (
                      <motion.div
                        {...FADE_TRANSITION}
                        key="offline-intel"
                        style={{ width: "100%", height: "100%" }}
                      >
                        <OfflineIntelGathering
                          onContinue={handleOfflineIntelGatheringContinue}
                          currentPhase={currentPhase}
                          currentChallenge={currentChallenge}
                          onTagArtifact={(stId) => setActiveStakeholderId(stId)}
                          onOpenPhaseBriefing={openBriefingForReview}
                          onPerformanceToggle={() => setIsPerformanceOpen((v) => !v)}
                          isPerformanceOpen={isPerformanceOpen}
                          isDossierOpen={isDossierOpen}
                          setIsDossierOpen={setIsDossierOpen}
                          dossierData={dossierData}
                          activeStakeholderId={activeStakeholderId}
                          challengeTitle={challengeTitle}
                          challengeDescription={challengeDescription}
                          challengeIntro={challengeIntro}
                          challengeAmount={challengeAmount}
                        />
                      </motion.div>
                    )}
                    {/* Merged pitch phase (plan 06 step 1, D37): engagement cards and stakeholder chat
                        now live inside PREPARE. Loop index 1 and 2 both render this screen. */}
                    {(challengeLoopId === 1 || challengeLoopId === 2) && (
                      <motion.div
                        {...FADE_TRANSITION}
                        key="pitch-debate"
                        style={{ width: "100%", height: "100%" }}
                      >
                        <PitchDebate
                          currentPhase={currentPhase}
                          currentChallenge={currentChallenge}
                          challengeTitle={challengeTitle}
                          challengeDescription={challengeDescription}
                          challengeIntro={challengeIntro}
                          challengeAmount={challengeAmount}
                          onEndPitch={handlePitchDebateEnd}
                          engagementCards={engagementCards}
                          attentionTokens={attentionTokens}
                          onAttentionTokensChange={setAttentionTokens}
                          playedCardIdsInPhase={playedCardIdsInPhase}
                          onPlayedCardIdsChange={setPlayedCardIdsInPhase}
                          chatMsgs={chat_msgs}
                          onChatMsgsChange={setChatMsgs}
                          cardTargetedStakeholdersMap={cardTargetedStakeholdersMap}
                          onCardTargetedStakeholdersMapChange={setCardTargetedStakeholdersMap}
                          dossierData={dossierData}
                          focusStakeholderId={activeStakeholderId}
                          onOpenPhaseBriefing={openBriefingForReview}
                          onPerformanceToggle={() => setIsPerformanceOpen((v) => !v)}
                          isPerformanceOpen={isPerformanceOpen}
                          onUpdateIntelItems={(items, fullDossier) => {
                            if (fullDossier) {
                              setDossierData(fullDossier);
                              setIntelItems(items as any);
                              return;
                            }
                            setIntelItems(items as any);
                            setDossierData((prevDossier) => {
                              if (!prevDossier || prevDossier.length === 0) return prevDossier;
                              return prevDossier.map((st) => {
                                const existingIds = new Set((st.intel_items || []).map((i) => i.id));
                                const updatedExisting = (st.intel_items || []).map((item) => {
                                  const matchingUpdated = (items as any[]).find((u) => u.id === item.id);
                                  if (matchingUpdated) {
                                    return {
                                      ...item,
                                      intel_type: matchingUpdated.intel_type,
                                      categorized_type: matchingUpdated.categorized_type,
                                      description: matchingUpdated.description,
                                      source: matchingUpdated.source || item.source,
                                    };
                                  }
                                  return item;
                                });
                                const brandNewForSt = (items as any[]).filter(
                                  (u) =>
                                    (u.stakeholder_id === st.stakeholder_id || (!u.stakeholder_id && st.is_environment)) &&
                                    !existingIds.has(u.id)
                                );
                                return {
                                  ...st,
                                  intel_items: [...updatedExisting, ...brandNewForSt],
                                };
                              });
                            });
                          }}
                        />
                      </motion.div>
                    )}
                    {challengeLoopId === 3 && (
                      <motion.div
                        {...FADE_TRANSITION}
                        key="ac-simulation"
                        style={{ width: "100%", height: "100%" }}
                      >
                        <AcSimulation
                          onContinue={handleAcSimulationContinue}
                          currentPhase={currentPhase}
                          currentChallenge={currentChallenge}
                          playedCard={pitchedActionCard}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </StakeholderContext.Provider>
              </MetricsContext.Provider>
            </PhasesContext.Provider>
          </motion.div>
        ) : progressionIndex === 3 ? (
          <motion.div {...FADE_TRANSITION} key="outro-questionnaire" style={{ width: "100%", height: "100%" }}>
            <Questionaire
              questions={questions}
              onQuestionaireCompleted={() => {
                onQuestionaireCompleted(4);
              }}
              setAnswers={setAnswers}
              answers={answers}
            />
          </motion.div>
        ) : progressionIndex === 4 ? (
          <motion.div {...FADE_TRANSITION} key="endpage" style={{ width: "100%", height: "100%" }}>
            <EndPage />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default App;
