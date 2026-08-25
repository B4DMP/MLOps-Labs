import { useState, useRef, useEffect } from "react";
import { useGameWebSocket } from "./services/websocket/useGameWebSocket";
import type { ActionCard } from "./types/ActionCard";
import Questionaire from "./Questionaire";
import type { Briefing } from "./types/Briefing";
import type { Question } from "./types/Question";
import BriefingPage from "./BriefingPage";
import introJs from "intro.js";
import "intro.js/introjs.css";
import EndPage from "./EndPage";
import OfflineIntelGathering from "./components/offline_intel_gathering";
import OnlineIntelGathering from "./components/online_intel_gathering";
import PitchDebate from "./components/pitch_debate";
import AcSimulation from "./components/ac_simulation";
import type { ChatMsg } from "./components/StakeholderInteractionArea";
import { MetricsContext } from "./components/MetricProvider";
import { StakeholderContext } from "./components/StakeholderProvider";
import { PhasesContext } from "./components/PhaseProvider";
import PrePhaseDialog from "./components/PrePhaseDialog";
import ErrorDialog from "./components/ErrorDialog";
import StakeholderDossier, { type StakeholderDossierEntry } from "./components/StakeholderDossier";

interface Stakeholder {
  id: string;
  name: string;
  responsibilities: string;
  priorities: string;
  constraints: string;
  role_description: string;
  metric_id: string;
  stakeholder_color: string;
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

function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

function App({ username: _username }: AppProps) {
  const debug: boolean = false;
  const { emit, subscribe } = useGameWebSocket();

  const sendJsonMessage = (data: any) => {
    let eventName = data.event || data.type;
    if (eventName === "message") eventName = "chat:send_message";
    if (eventName === "progressIndexUpdate") eventName = "game:progress_update";
    if (eventName === "stateRequest") eventName = "game:state_update_request";
    emit(eventName, data);
  };

  const [currentPhase, setCurrentPhase] = useState(0);
  const [currentChallenge, setCurrentChallenge] = useState(0);
  const [phases, setPhases] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<Record<string, Metric>>({});
  const [challengeNumber, setChallengeNumber] = useState(0);
  const [_challengeMetricChanges, setChallengeMetricChanges] = useState<
    Record<string, number>
  >({});
  const [stakeholders, setStakeholders] = useState<Record<string, Stakeholder>>({});
  const [ac_count, setac_count] = useState(-1);
  const [chat_msgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [actionCards, setActionCards] = useState<ActionCard[]>(
    debug
      ? [
        {
          ac_title: "test_card",
          ac_descr: "test_description",
          metric_changes: {
            reliability: 1,
            data: -5,
            requirements: 3,
            efficiency: -2,
          },
          stakeholder_ids: ["daniel_whitaker_data_engineer", "jimmy_everick_data_scientist"],
          ac_image: "",
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
  const [dossierData, setDossierData] = useState<StakeholderDossierEntry[]>([]);
  const [activeStakeholderId, setActiveStakeholderId] = useState<string | undefined>(undefined);

  const stakeholdersRef = useRef<Record<string, Stakeholder>>({});
  const acCountRef = useRef<number>(-1);
  const metricsRef = useRef<Record<string, Metric>>({});
  const currentPhaseRef = useRef<number>(0);
  const currentChallengeRef = useRef<number>(0);
  const isintro5DoneRef = useRef<boolean>(false);
  const isIntro1StartedRef = useRef<boolean>(false);

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
    acCountRef.current = ac_count;
  }, [ac_count]);

  useEffect(() => {
    if (progressionIndex === 2 && challengeLoopId === 2) {
      if (chat_msgs.length === 0) {
        startRound(challengeTitle);
      }
    }
  }, [progressionIndex, challengeLoopId, challengeTitle, chat_msgs.length]);

  const startRound = (cTitle?: string) => {
    //send intial message
    sendJsonMessage({
      type: "message",
      message:
        "Welcome to the meeting! Please propose a concrete action or technical strategy that strictly prioritizes your specific professional requirements and interests, even if it disregards other perspectives. Write no more than two sentences.",
      stakeholder_ids: ["st0"],
    });
    setChatMsgs((prevMsgs) => [
      ...prevMsgs,
      {
        id: "",
        message: `Welcome to the meeting, everyone. What is your opinion about "${cTitle || challengeTitle}"?`,
        ac_id: -1,
      },
    ]);
    setIsChatEnabled(false);
    setac_count(0);
  };
  const onQuestionaireCompleted = (nextProgressIndex: number) => {
    sendJsonMessage({
      type: "progressIndexUpdate",
      value: nextProgressIndex,
      additional_data: answers,
    });
  };

  const onBriefingCompleted = () => {
    sendJsonMessage({
      type: "progressIndexUpdate",
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

  useEffect(() => {
    // Request initial game configurations ONCE on mount
    emit("game:init");

    const unsubscribe = subscribe("*", (data: any) => {
      if (data.type === "init" || data.event === "game:init_data") {
        const rawStakeholders = data["stakeholders"] || {};
        const rawMetrics = data["metrics"] || {};
        const enrichedStakeholders = { ...rawStakeholders };
        Object.keys(enrichedStakeholders).forEach((stId) => {
          const st = enrichedStakeholders[stId];
          const associatedMetric = rawMetrics[st.metric_id] || Object.values(rawMetrics).find((m: any) => m.id === st.metric_id);
          st.stakeholder_color = associatedMetric ? associatedMetric.metric_color : "#888888";
        });
        setStakeholders(enrichedStakeholders);
        setMetrics(rawMetrics);
        setPhases(data["phases"]);
      } else if (data.progressionIndex !== undefined) {
        setProgressionIndex(data.progressionIndex);

        if (data.progressionIndex === 0) {
          if (data.type === "questions") {
            setQuestions(data["questions"]);
          }
        }

        if (data.progressionIndex === 1) {
          if (data.type === "briefing") {
            setBriefing(data["content"]);
          }
        }

        if (data.progressionIndex === 2) {
          if (data.type === "message") {
            let _ac_id = -1;
            if (acCountRef.current !== data["action_cards"].length) {
              setac_count(data["action_cards"].length);
              _ac_id = data["action_cards"].length - 1;
            }

            setChatMsgs((prevMsgs) => [
              ...prevMsgs,
              ...data.messages.map((msg: any) => ({
                id: msg.stakeholder_id,
                message: msg.message,
                ac_id: _ac_id,
              })),
            ]);
            if (data.action_cards && data.action_cards.length > 0) {
              const mappedCards = data.action_cards.map((card: any) => {
                const stakeholder_ids = card.stakeholder_names.map(
                  (name: string) => {
                    const st = Object.values(stakeholdersRef.current).find(
                      (s) => s.name === name,
                    );
                    return st ? st.id : "";
                  },
                );

                return {
                  id: card.id,
                  ac_title: card.title,
                  ac_descr: card.short_description,
                  metric_changes: Object.values(metricsRef.current).reduce(
                    (acc, m) => {
                      if (card[m.id] !== undefined) {
                        acc[m.id] = card[m.id];
                      }
                      return acc;
                    },
                    {} as Record<string, number>,
                  ),
                  stakeholder_ids: stakeholder_ids,
                  ac_image: card.ac_image["image"],
                };
              });
              if (!debug) {
                setActionCards(mappedCards);
              } else {
                setActionCards([
                  {
                    ac_title: "test_card",
                    ac_descr: "test_description",
                    metric_changes: {
                      reliability: 1,
                      data: -5,
                      requirements: 3,
                      efficiency: -2,
                    },
                    stakeholder_ids: ["daniel_whitaker_data_engineer", "jimmy_everick_data_scientist"],
                    ac_image: "",
                  },
                ]);
              }
            }
          } else if (data.type === "state") {
            setMetrics((prevMetrics) => {
              const updated = { ...prevMetrics };
              const metricIds = Object.keys(updated);
              metricIds.forEach((id, i) => {
                if (updated[id]) {
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

            // If we transitioned to a new challenge, clear local state
            if (data["challenge_id"] !== currentChallengeRef.current || data["phase_id"] !== currentPhaseRef.current) {
              setCurrentPhase(data["phase_id"]);
              setCurrentChallenge(data["challenge_id"]);
              setChatMsgs([]);
              setActionCards([]);
              setac_count(0);
            }

            setChallengeNumber(data["challenges_amount"]);
            setChallengeMetricChanges(data["metric_changes"]);
            if (data.challenge_loop_id !== undefined) {
              setChallengeLoopId(data.challenge_loop_id);
            }
            if (data["challenge_id"] === 0) {
              if (data["phase_id"] === 0) {
                if (!isIntro1StartedRef.current) {
                  isIntro1StartedRef.current = true;
                  setIsIntro1Started(true);
                  setTimeout(() => {
                    const startIntro2 = () => {
                      setIsPhaseDialogueOpen(true);
                      setTimeout(() => {
                        introJs()
                          .setOptions({
                            group: "intro2",
                            exitOnEsc: false,
                            exitOnOverlayClick: false,
                          })
                          .start();
                      }, 50);
                    };

                    introJs()
                      .setOptions({
                        group: "intro1",
                        exitOnEsc: false,
                        exitOnOverlayClick: false,
                      })
                      .oncomplete(startIntro2)
                      .onexit(startIntro2)
                      .start();
                  }, 10);
                }
              } else {
                setIsPhaseDialogueOpen(true);
              }
            }
          } else if (data.type === "graph_completed") {
            setIsChatEnabled(true);
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

            //define message recommendations
            const allSts = Object.values(stakeholdersRef.current);
            const activeSts = allSts.filter((st) => {
              const metric = metricsRef.current[st.metric_id] || Object.values(metricsRef.current).find((m) => m.id === st.metric_id);
              const metricIntro = metricsRef.current[`${st.metric_id}_intro`] || Object.values(metricsRef.current).find((m) => m.id === `${st.metric_id}_intro`);
              return (metric && metric.phases[currentPhaseRef.current]) || (metricIntro && metricIntro.phases[currentPhaseRef.current]);
            });
            if (activeSts.length !== 0) {
              const msg_recommendations = [
                `${activeSts[getRandomInt(activeSts.length)].name.split(" ")[0]}, can you agree to this?`,
                `${activeSts[getRandomInt(activeSts.length)].name.split(" ")[0]}, do you have any concerns?`,
                "Can everybody agree?",
                "Do we got any other ideas?",
                "What does the rest of the team think about this?",
                "Sounds great!",
                "I am not sure about this.",
                "Let's try to find a compromise.",
                "Could you please explain your idea in more detail?",
              ];

              const res: string[] = [];
              while (res.length < 3) {
                const sel_id = getRandomInt(msg_recommendations.length);
                if (!res.includes(msg_recommendations[sel_id])) {
                  res.push(msg_recommendations[sel_id]);
                }
              }
              setSelectedMgs(res);
            }

            if (data.error === true) {
              setIsInErrorUi(true);
              setLastError(data.errorMsg);
            }
          }
        }

        if (data.progressionIndex === 3) {
          if (data.type === "questions") {
            setAnswers([]);
            setQuestions(data["questions"]);
          }
        }
      } else if (data.type === "error") {
        setIsInErrorUi(true);
        setLastError(data.error_message || data.error);
      }
    });

    const unsubDossier = subscribe("intel:dossier_data", (payload: any) => {
      console.log("[WS] Received intel:dossier_data:", payload);
      if (payload && payload.dossier) {
        setDossierData(payload.dossier);
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
      unsubscribe();
      unsubDossier();
      unsubTagged();
    };
  }, [emit, subscribe, debug]);

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
          ac_title: "test_card",
          ac_descr: "test_description",
          metric_changes: {
            reliability: 1,
            data: -5,
            requirements: 3,
            efficiency: -2,
          },
          stakeholder_ids: ["daniel_whitaker_data_engineer", "jimmy_everick_data_scientist"],
          ac_image: "",
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
      type: "stateRequest",
      challenge_id: currentChallenge,
      phase_id: currentPhase,
      challenge_loop_index: 0,
      metric_values: _metric_values,
      action_card_id: null,
      messages: [],
    });
  };

  const handleOnlineIntelGatheringContinue = () => {
    let _metric_values: any = [];
    Object.values(metrics).forEach((x) => {
      _metric_values.push(x.value ?? 0);
    });

    sendJsonMessage({
      type: "stateRequest",
      challenge_id: currentChallenge,
      phase_id: currentPhase,
      challenge_loop_index: 1,
      metric_values: _metric_values,
      action_card_id: null,
      messages: [],
    });
  };

  const handleAcSimulationContinue = () => {
    if (
      currentPhase === phases.length - 1 &&
      currentChallenge === challengeNumber - 1
    ) {
      sendJsonMessage({
        type: "progressIndexUpdate",
        value: 3,
      });
    } else {
      let _metric_values: any = [];
      Object.values(metrics).forEach((x) => {
        _metric_values.push(x.value ?? 0);
      });

      sendJsonMessage({
        type: "stateRequest",
        challenge_id: currentChallenge,
        phase_id: currentPhase,
        challenge_loop_index: 3,
        metric_values: _metric_values,
        action_card_id: null,
        messages: [],
      });
    }
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
      type: "stateRequest",
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

  const handleSend = (textContent: string) => {
    setChatMsgs((prevMsgs) => [
      ...prevMsgs,
      { id: "", message: textContent, ac_id: -1 },
    ]);
    sendJsonMessage({
      type: "message",
      message: textContent,
      stakeholder_ids: ["st0"],
    });
    setIsChatEnabled(false);
  };

  let [last_ac, setLastAc] = useState(actionCards[0]);

  let [selected_mgs, setSelectedMgs] = useState<string[]>([]);

  return (
    <>
      {progressionIndex == 2 && (
        <PhasesContext.Provider
          value={{ currentPhase, setCurrentPhase, phases, setPhases }}
        >
          <MetricsContext.Provider value={{ metrics, setMetrics }}>
            <StakeholderContext.Provider
              value={{ stakeholders, setStakeholders }}
            >
              <ErrorDialog errorMsg={lastError} setIsOpen={setIsInErrorUi} isOpen={isInErrorUi} />
              <PrePhaseDialog
                isOpen={isPhaseDialogueOpen}
                setIsOpen={setIsPhaseDialogueOpen}
                setIsRoundOpen={() => {
                  // The useEffect hook starts the round when the user transitions to challengeLoopId === 2 (Pitch Debate)
                }}
              />
              {/* Global Floating Bottom-Right Stakeholder Dossier Button */}
              {(challengeLoopId == 0 || challengeLoopId == 2) && <>
                <button
                  onClick={() => {
                    emit("intel:get_dossier", {
                      phase_id: currentPhase,
                      challenge_id: currentChallenge,
                    });
                    setIsDossierOpen((prev) => !prev);
                  }}
                  style={{
                    position: "fixed",
                    bottom: "24px",
                    right: "24px",
                    zIndex: 9998,
                    background: "linear-gradient(135deg, #4a382c, #2b1e16)",
                    color: "#f3e9dc",
                    border: "2px solid #8c6d58",
                    borderRadius: "30px",
                    padding: "10px 22px",
                    fontFamily: "'Caveat', cursive, sans-serif",
                    fontWeight: "bold",
                    fontSize: "1.25rem",
                    cursor: "pointer",
                    boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    transition: "all 0.2s ease",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.transform = "scale(1.06) translateY(-2px)")}
                  onMouseOut={(e) => (e.currentTarget.style.transform = "scale(1)")}
                >
                  📓 Stakeholder Dossier
                </button></>}

              <StakeholderDossier
                isOpen={isDossierOpen}
                onClose={() => setIsDossierOpen(false)}
                dossierData={dossierData}
                activeStakeholderId={activeStakeholderId}
                currentPhase={currentPhase}
                currentChallenge={currentChallenge}
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
                  challengeNumber={challengeNumber}
                  dossierData={dossierData}
                  activeStakeholderId={activeStakeholderId}
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
                  challengeNumber={challengeNumber}
                  revealAc={revealAc}
                  last_ac={last_ac}
                  roundOverAnimActive={roundOverAnimActive}
                  showMetricValueChanges={showMetricValueChanges}
                  isChatEnabled={isChatEnabled}
                  actionCards={actionCards}
                  hoveredCardId={hoveredCardId}
                  setHoveredCardId={setHoveredCardId}
                  selected_mgs={selected_mgs}
                  chat_msgs={chat_msgs}
                  startRound={startRound}
                  playActionCard={playActionCard}
                  getNextChallenge={getNextChallenge}
                  handleSend={handleSend}
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
