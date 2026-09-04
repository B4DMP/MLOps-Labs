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
import OnlineIntelGathering, { type IntelItem } from "./components/online_intel_gathering";
import PitchDebate from "./components/pitch_debate";
import AcSimulation from "./components/ac_simulation";
import type { ChatMsg } from "./components/StakeholderInteractionArea";
import { MetricsContext } from "./components/MetricProvider";
import { StakeholderContext, type ConvincerProfileConfig } from "./components/StakeholderProvider";
import { PhasesContext } from "./components/PhaseProvider";
import PrePhaseDialog from "./components/PrePhaseDialog";
import ErrorDialog from "./components/ErrorDialog";
import ConvincerVerificationDialog, { type ConvincerVerificationInfo } from "./components/ConvincerVerificationDialog";
import type { StakeholderDossierEntry } from "./components/StakeholderDossier";
import type { StakeholderAvatar } from "./types/StakeholderAvatar";
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
  const [ac_count, setac_count] = useState(-1);
  const [chat_msgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [onlineIntelChatMsgs, setOnlineIntelChatMsgs] = useState<ChatMsg[]>([]);
  const [engagementCards, setEngagementCards] = useState<EngagementCard[]>([]);
  const [attentionTokens, setAttentionTokens] = useState<number>(8);
  const [hasPitchDebateStarted, setHasPitchDebateStarted] = useState<boolean>(false);
  const [actionCards, setActionCards] = useState<ActionCard[]>(
    debug
      ? [
        {
          id: "test_card",
          title: "test_card",
          description: "test_description",
          intel_ids: [],
          addendum_intel_item_ids: [],
        },
      ]
      : [],
  );
  const [challengeTitle, setChallengeTitle] = useState("");
  const [challengeDescription, setChallengeDescription] = useState("");
  const [challengeIntro, setChallengeIntro] = useState("");
  const [progressionIndex, setProgressionIndex] = useState(0);
  const [isPhaseDialogueOpen, setIsPhaseDialogueOpen] = useState(false);
  const [isChatEnabled, setIsChatEnabled] = useState(true);
  const [hoveredCardId, setHoveredCardId] = useState<number | null>(null);
  const [isintro5Done, setIsintro5Done] = useState(false);
  const [isIntro1Started, setIsIntro1Started] = useState(false);
  const [isInErrorUi, setIsInErrorUi] = useState(false);
  const [lastError, setLastError] = useState("");
  const [challengeLoopId, setChallengeLoopId] = useState<number>(0);
  const [isDossierOpen, setIsDossierOpen] = useState(false);
  const [convincerArchetypes, setConvincerArchetypes] = useState<Record<string, ConvincerProfileConfig>>({});
  const [dossierData, setDossierData] = useState<StakeholderDossierEntry[]>([]);
  const [intelItems, setIntelItems] = useState<IntelItem[]>([]);
  const [activeStakeholderId, setActiveStakeholderId] = useState<string | undefined>(undefined);
  const [playedCardIdsInPhase, setPlayedCardIdsInPhase] = useState<string[]>([]);
  const [cardTargetedStakeholdersMap, setCardTargetedStakeholdersMap] = useState<Record<string, string[]>>({});
  const [pitchedActionCard, setPitchedActionCard] = useState<ActionCard | null>(null);

  const stakeholdersRef = useRef<Record<string, Stakeholder>>({});
  const acCountRef = useRef<number>(-1);
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

  useEffect(() => {
    acCountRef.current = ac_count;
  }, [ac_count]);

  const prevShownPhaseRef = useRef<number | null>(null);

  // Manage PrePhaseDialog (at the start of each phase)
  useEffect(() => {
    if (progressionIndex === 2 && phases.length > 0) {
      // Check if a new phase has begun and we haven't shown PrePhaseDialog for it yet (only when challengeLoopId === 0)
      if (prevShownPhaseRef.current !== currentPhase) {
        if (challengeLoopId === 0) {
          prevShownPhaseRef.current = currentPhase;

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
          return;
        } else {
          prevShownPhaseRef.current = currentPhase;
        }
      }
    }
  }, [
    progressionIndex,
    currentPhase,
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
  const [convincerVerificationInfo, setConvincerVerificationInfo] = useState<ConvincerVerificationInfo | null>(null);

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
        st.stakeholder_color = associatedMetric ? associatedMetric.metric_color : "#888888";
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
        } else if (data.progressionIndex === 1 && data.content) {
          setBriefing(data.content);
        } else if (data.progressionIndex === 3 && data.questions) {
          setAnswers([]);
          setQuestions(data.questions);
        }
      }
    });

    const unsubState = subscribe("game:state_update", (data: any) => {
      if (data.progressionIndex !== undefined) {
        setProgressionIndex(data.progressionIndex);
      }

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
          st.stakeholder_color = associatedMetric ? associatedMetric.metric_color : (st.stakeholder_color || "#888888");
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
        setCurrentPhase(data["phase_id"]);
        setCurrentChallenge(data["challenge_id"]);
        if (data.pitch_debate_messages && Array.isArray(data.pitch_debate_messages) && data.pitch_debate_messages.length > 0) {
          setChatMsgs(data.pitch_debate_messages);
          if (loopId >= 2) {
            setHasPitchDebateStarted(true);
            hasPitchDebateStartedRef.current = true;
          }
        } else {
          setChatMsgs([]);
        }
        if (data.online_intel_gathering_messages && Array.isArray(data.online_intel_gathering_messages)) {
          setOnlineIntelChatMsgs(data.online_intel_gathering_messages);
        } else {
          setOnlineIntelChatMsgs([]);
        }
        setAttentionTokens(data.attention_tokens);
        if (data.played_engagement_card_ids) setPlayedCardIdsInPhase(data.played_engagement_card_ids);
        if (data.engagement_card_targets) setCardTargetedStakeholdersMap(data.engagement_card_targets);
        if (data.action_card && typeof data.action_card === "object" && data.action_card.title) {
          setPitchedActionCard(data.action_card);
        }
      } else if (data["challenge_id"] !== currentChallengeRef.current || data["phase_id"] !== currentPhaseRef.current) {
        // If we transitioned to a new challenge (round completed after simulation), reset local state
        setCurrentPhase(data["phase_id"]);
        setCurrentChallenge(data["challenge_id"]);
        setChatMsgs([]);
        setOnlineIntelChatMsgs([]);
        setAttentionTokens(data.attention_tokens);
        setPlayedCardIdsInPhase([]);
        setCardTargetedStakeholdersMap({});
        setPitchedActionCard(null);
        setActionCards([]);
        setac_count(0);
        setHasPitchDebateStarted(false);
        hasPitchDebateStartedRef.current = false;
      } else {
        // Same challenge / loading: restore messages and attention tokens if available
        if (data.pitch_debate_messages && Array.isArray(data.pitch_debate_messages) && data.pitch_debate_messages.length > 0) {
          setChatMsgs(data.pitch_debate_messages);
          if (loopId >= 2) {
            setHasPitchDebateStarted(true);
            hasPitchDebateStartedRef.current = true;
          }
        }
        if (data.online_intel_gathering_messages && Array.isArray(data.online_intel_gathering_messages)) {
          setOnlineIntelChatMsgs(data.online_intel_gathering_messages);
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

      if (data.convincer_archetypes && typeof data.convincer_archetypes === "object") {
        setConvincerArchetypes(data.convincer_archetypes);
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
            id: msg.stakeholder_id,
            message: msg.message,
            facial_expression: msg.facial_expression,
            ac_id: -1,
            revealed_intel: msg.revealed_intel || [],
          })),
        ]);
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

      const verifications: any[] = data.convincer_verifications || (data.convincer_verification ? [data.convincer_verification] : []);
      if (verifications.length > 0) {
        setConvincerVerificationInfo(verifications[0]);
        setChatMsgs((prev) => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          for (const verif of verifications) {
            const targetStId = verif.stakeholder_id;
            let targetIndex = -1;
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].id === targetStId) {
                targetIndex = i;
                break;
              }
            }
            if (targetIndex === -1) {
              targetIndex = updated.length - 1;
            }
            updated[targetIndex] = {
              ...updated[targetIndex],
              convincer_verification: verif,
            };
          }
          return updated;
        });
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

  let [roundOverAnimActive, SetRoundOverAnimActive] = useState(false);
  let [showMetricValueChanges, setShowMetricValueChanges] = useState(false);
  let [revealAc, setRevealAc] = useState(false);

  const getNextChallenge = (ac: ActionCard) => {
    SetRoundOverAnimActive(false);
    setShowMetricValueChanges(false);
    setRevealAc(false);

    if (debug) {
      setActionCards([
        {
          id: "test_card",
          title: "test_card",
          description: "test_description",
          intel_ids: [],
          addendum_intel_item_ids: [],
        },
      ]);
    }

    requestNextChallenge(ac);
  };

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

  const handleOnlineIntelGatheringContinue = (pitchedCard?: any) => {
    let _metric_values: any = [];
    Object.values(metrics).forEach((x) => {
      _metric_values.push(x.value ?? 0);
    });

    const cardToSave = pitchedCard || pitchedActionCard || {};
    if (pitchedCard) {
      setPitchedActionCard(pitchedCard);
    }

    sendJsonMessage({
      type: "game:state_update_request",
      challenge_id: currentChallenge,
      phase_id: currentPhase,
      challenge_loop_index: 1,
      metric_values: _metric_values,
      action_card: cardToSave,
      messages: [],
      attention_tokens: attentionTokens,
    });
  };

  const handlePitchDebateEnd = (_passed: boolean) => {
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
      action_card: pitchedActionCard || {},
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

  const playActionCard = async (ac: ActionCard) => {
    if (!isChatEnabled) return;

    SetRoundOverAnimActive(true);
    setLastAc(ac);

    const updatedMetrics: Record<string, Metric> = {};
    const metricsList = Object.values(metrics);
    metricsList.forEach((m) => {
      const nextVal = (m.value ?? m.start_value) + (ac.metric_changes[m.id] ?? 0);
      updatedMetrics[m.id] = {
        ...m,
        value: nextVal,
      };
    });

    setMetrics(updatedMetrics);

    if (currentChallenge === 0 && currentPhase === 0) {
      setTimeout(() => {
        introJs()
          .setOptions({
            group: "intro6",
            exitOnEsc: false,
            exitOnOverlayClick: false,
          })
          .start();
      }, 1500);
    }

    const { CountUp } = await import("countup.js");
    setTimeout(() => {
      setRevealAc(true);
      setShowMetricValueChanges(true);
      metricsList.forEach((m) => {
        const el = document.getElementById(`metric-value-${m.id}`);
        if (el) {
          const countUp = new CountUp(
            el,
            updatedMetrics[m.id]?.value ?? m.start_value,
            {
              startVal: m.value ?? m.start_value,
              duration: 5,
            },
          );
          if (!countUp.error) {
            countUp.start();
          }
        }
      });
    }, 200);
  };

  const requestNextChallenge = (ac: ActionCard) => {
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
      action_card_id: ac.id,
      messages: chat_msgs,
    });
    setChatMsgs([]);
    setActionCards([]);
  };

  const handleSelectDialogueOption = (optionIndex: number) => {
    if (!isChatEnabled) return;
    setIsChatEnabled(false);
    sendJsonMessage({
      type: "chat:send_message",
      option_index: optionIndex,
      phase_id: currentPhaseRef.current,
      challenge_id: currentChallengeRef.current,
    });
  };

  let [last_ac, setLastAc] = useState(actionCards[0]);
  const [dialogueOptions, setDialogueOptions] = useState<DialogueOption[]>([]);

  return (
    <>
      {progressionIndex == 2 && (
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
                convincerArchetypes,
                setConvincerArchetypes,
              }}
            >
              <ErrorDialog errorMsg={lastError} setIsOpen={setIsInErrorUi} isOpen={isInErrorUi} />
              <PrePhaseDialog
                isOpen={isPhaseDialogueOpen}
                setIsOpen={setIsPhaseDialogueOpen}
              />
              <ConvincerVerificationDialog
                info={convincerVerificationInfo}
                onClose={() => setConvincerVerificationInfo(null)}
              />

              {challengeLoopId === 0 && (
                <OfflineIntelGathering
                  onContinue={handleOfflineIntelGatheringContinue}
                  currentPhase={currentPhase}
                  currentChallenge={currentChallenge}
                  showMetricValueChanges={showMetricValueChanges}
                  last_ac={last_ac}
                  onTagArtifact={(stId) => setActiveStakeholderId(stId)}
                  isDossierOpen={isDossierOpen}
                  setIsDossierOpen={setIsDossierOpen}
                  dossierData={dossierData}
                  activeStakeholderId={activeStakeholderId}
                  challengeTitle={challengeTitle}
                  challengeDescription={challengeDescription}
                  challengeIntro={challengeIntro}
                  challengeAmount={challengeAmount}
                />
              )}
              {challengeLoopId === 1 && (
                <OnlineIntelGathering
                  onContinue={handleOnlineIntelGatheringContinue}
                  currentPhase={currentPhase}
                  currentChallenge={currentChallenge}
                  showMetricValueChanges={showMetricValueChanges}
                  last_ac={last_ac}
                  challengeTitle={challengeTitle}
                  challengeDescription={challengeDescription}
                  challengeIntro={challengeIntro}
                  challengeAmount={challengeAmount}
                  dossierData={dossierData}
                  activeStakeholderId={activeStakeholderId}
                  intelItems={intelItems}
                  attentionTokens={attentionTokens}
                  setAttentionTokens={setAttentionTokens}
                  playedCardIdsInPhase={playedCardIdsInPhase}
                  setPlayedCardIdsInPhase={setPlayedCardIdsInPhase}
                  cardTargetedStakeholdersMap={cardTargetedStakeholdersMap}
                  setCardTargetedStakeholdersMap={setCardTargetedStakeholdersMap}
                  chatMsgs={onlineIntelChatMsgs}
                  setChatMsgs={setOnlineIntelChatMsgs}
                  engagementCards={engagementCards}
                  pitchedActionCard={pitchedActionCard}
                  onUpdatePitchedCard={(card) => setPitchedActionCard(card)}
                  onUpdateIntelItems={(items) => {
                    setIntelItems(items);
                    setDossierData((prevDossier) => {
                      if (!prevDossier || prevDossier.length === 0) return prevDossier;
                      return prevDossier.map((st) => ({
                        ...st,
                        intel_items: (st.intel_items || []).map((item) => {
                          const matchingUpdated = items.find(
                            (u) => u.id === item.id || u.requirement_id === item.requirement_id
                          );
                          if (matchingUpdated) {
                            return {
                              ...item,
                              intel_type: matchingUpdated.intel_type,
                              categorized_type: matchingUpdated.categorized_type,
                              description: matchingUpdated.description,
                            };
                          }
                          return item;
                        }),
                      }));
                    });
                  }}
                />
              )}
              {challengeLoopId === 3 && (
                <AcSimulation
                  onContinue={handleAcSimulationContinue}
                  currentPhase={currentPhase}
                  currentChallenge={currentChallenge}
                  showMetricValueChanges={showMetricValueChanges}
                  last_ac={last_ac}
                />
              )}
              {challengeLoopId === 2 && (
                <PitchDebate
                  currentPhase={currentPhase}
                  setCurrentPhase={setCurrentPhase}
                  phases={phases}
                  setPhases={setPhases}
                  metrics={metrics}
                  setMetrics={setMetrics}
                  stakeholders={stakeholders}
                  setStakeholders={setStakeholders}
                  lastError={lastError}
                  isInErrorUi={isInErrorUi}
                  setIsInErrorUi={setIsInErrorUi}
                  isPhaseDialogueOpen={isPhaseDialogueOpen}
                  setIsPhaseDialogueOpen={setIsPhaseDialogueOpen}
                  challengeTitle={challengeTitle}
                  challengeDescription={challengeDescription}
                  challengeIntro={challengeIntro}
                  currentChallenge={currentChallenge}
                  challengeNumber={challengeAmount}
                  revealAc={revealAc}
                  last_ac={last_ac}
                  roundOverAnimActive={roundOverAnimActive}
                  showMetricValueChanges={showMetricValueChanges}
                  isChatEnabled={isChatEnabled}
                  actionCards={actionCards}
                  hoveredCardId={hoveredCardId}
                  setHoveredCardId={setHoveredCardId}
                  dialogueOptions={dialogueOptions}
                  chat_msgs={chat_msgs}
                  setChatMsgs={setChatMsgs}
                  playActionCard={playActionCard}
                  getNextChallenge={getNextChallenge}
                  onSelectDialogueOption={handleSelectDialogueOption}
                  pitchedActionCard={pitchedActionCard}
                  dossierData={dossierData}
                  intelItems={intelItems}
                  onEndPitch={handlePitchDebateEnd}
                />
              )}
            </StakeholderContext.Provider>
          </MetricsContext.Provider>
        </PhasesContext.Provider>
      )}
      {progressionIndex == 0 && (
        <Questionaire
          questions={questions}
          onQuestionaireCompleted={() => {
            onQuestionaireCompleted(1);
          }}
          setAnswers={setAnswers}
          answers={answers}
        />
      )}
      {progressionIndex == 1 && (
        <BriefingPage
          onBriefingCompleted={onBriefingCompleted}
          briefing={briefing}
        />
      )}
      {progressionIndex == 3 && (
        <Questionaire
          questions={questions}
          onQuestionaireCompleted={() => {
            onQuestionaireCompleted(4);
          }}
          setAnswers={setAnswers}
          answers={answers}
        />
      )}
      {progressionIndex == 4 && (
        <EndPage />
      )}
    </>
  );
}

export default App;
