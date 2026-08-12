import { useState, useRef, useEffect } from "react";
import { MetricsContext } from "./components/MetricProvider";
import MetricTab from "./components/MetricTab";
import StakeholderInteractionArea, {
  type ChatMsg,
} from "./components/StakeholderInteractionArea";
import { StakeholderContext } from "./components/StakeholderProvider";
import { useGameWebSocket } from "./services/websocket/useGameWebSocket";
import CardArea from "./components/CardArea";
import type { ActionCard } from "./types/ActionCard";
import { PhasesContext } from "./components/PhaseProvider";
import PhaseOverview from "./components/PhaseOverview";
import PreRoundDialog from "./components/PreRoundPanel";
import PrePhaseDialog from "./components/PrePhaseDialog";
import Questionaire from "./Questionaire";
import type { Briefing } from "./types/Briefing";
import type { Question } from "./types/Question";
import BriefingPage from "./BriefingPage";
import styles from "./Game.module.css";
import AcRevealPanel from "./components/AcRevealPanel";
import introJs from "intro.js";
import "intro.js/introjs.css";
import EndPage from "./EndPage";
import ErrorDialog from "./components/ErrorDialog";

interface Stakeholder {
  id: string;
  name: string;
  responsibilities: string;
  priorities: string;
  constraints: string;
  role_description: string;
  is_selected: boolean;
  metric_id: string;
  stakeholder_color: string;
  metric_expertise_values: Record<string, number>;
  active: boolean[];
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
    if (eventName === "stateRequest") eventName = "game:state_request";
    emit(eventName, data);
  };

  const [currentPhase, setCurrentPhase] = useState(0);
  const [currentChallenge, setCurrentChallenge] = useState(0);
  const [phases, setPhases] = useState([]);
  const [metrics, setMetrics] = useState<Record<string, Metric>>({});
  const [challengeNumber, setChallengeNumber] = useState(0);
  const [challengeMetricChanges, setChallengeMetricChanges] = useState<
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
  const [isStartDialogueOpen, setIsStartDialogueOpen] = useState(false);
  const [isPhaseDialogueOpen, setIsPhaseDialogueOpen] = useState(false);
  const [isChatEnabled, setIsChatEnabled] = useState(true);
  const [hoveredCardId, setHoveredCardId] = useState<number | null>(null);
  const [isintro5Done, setIsintro5Done] = useState(false);
  const [isIntro1Started, setIsIntro1Started] = useState(false);
  const [isInErrorUi, setIsInErrorUi] = useState(false);
  const [lastError, setLastError] = useState("");

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

  const onStakeholderSelectionDone = () => {
    setIsStartDialogueOpen(false);

    //send intial message
    sendJsonMessage({
      type: "message",
      message:
        "Welcome to the meeting! Please propose a concrete action or technical strategy that strictly prioritizes your specific professional requirements and interests, even if it disregards other perspectives. Write no more than two sentences.",
      stakeholder_ids: ["st0"],
      selectionmask: Object.values(stakeholders).filter((s) => s.is_selected).map((s) => s.id),
    });
    setChatMsgs((prevMsgs) => [
      ...prevMsgs,
      {
        id: "",
        message: `Welcome to the meeting, everyone. What is your opinion about "${challengeTitle}"?`,
        ac_id: -1,
      },
    ]);
    setIsChatEnabled(false);
    setac_count(0);
  };

  const selectStakeholder = (id: string) => {
    setStakeholders((prev) =>
      prev[id]
        ? { ...prev, [id]: { ...prev[id], is_selected: !prev[id].is_selected } }
        : prev,
    );
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
        setStakeholders(data["stakeholders"] || {});
        setMetrics(data["metrics"] || {});
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

            setStakeholders((prevStakeholders) => {
              const updated = { ...prevStakeholders };
              Object.keys(updated).forEach((id) => {
                updated[id] = { ...updated[id], is_selected: false };
              });
              return updated;
            });

            setChallengeTitle(data["name"]);
            setChallengeIntro(data["roundIntroduction"]);
            setChallengeDescription(data["description"]);
            setCurrentPhase(data["phase_id"]);
            setCurrentChallenge(data["challenge_id"]);
            setChallengeNumber(data["challenges_amount"]);
            setChallengeMetricChanges(data["metric_changes"]);
            setActionCards([]);
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
            } else {
              setIsStartDialogueOpen(true);
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
            if (allSts.filter((s) => s.is_selected).length !== 0) {
              const selectedSts = allSts.filter((s) => s.is_selected);
              const msg_recommendations = [
                `${selectedSts[getRandomInt(selectedSts.length)].name.split(" ")[0]}, can you agree to this?`,
                `${selectedSts[getRandomInt(selectedSts.length)].name.split(" ")[0]}, do you have any concerns?`,
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

    return () => unsubscribe();
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
    //game completed check
    if (
      currentPhase == phases.length - 1 &&
      currentChallenge == challengeNumber - 1
    ) {
      //game completed, ask for questions
      sendJsonMessage({
        type: "progressIndexUpdate",
        value: 3,
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
      challenge_id: currentChallenge + 1,
      phase_id: currentPhase,
      metric_values: _metric_values,
      action_card: ac,
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
      selectionmask: Object.values(stakeholders).filter((s) => s.is_selected).map((s) => s.id),
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
                  setIsStartDialogueOpen(true);
                  if (currentPhase === 0) {
                    setTimeout(() => {
                      introJs()
                        .setOptions({
                          group: "intro3",
                          exitOnEsc: false,
                          exitOnOverlayClick: false,
                        })
                        .start();
                    }, 100);
                  }
                }}
              />

              <div className="game-container">
                <nav
                  className="navbar navbar-expand-lg flex-shrink-0"
                  style={{ backgroundColor: "var(--primary-bg)" }}
                >
                  <div
                    className="container-fluid d-flex align-items-stretch py-1"
                    style={{ gap: "1rem" }}
                    data-bs-theme="dark"
                  >
                    <div
                      className="transparent-div"
                      style={{ flex: "0 0 50%" }}
                    >
                      <span
                        className="transparent-div-label intro1"
                        data-intro-group="intro1"
                        data-intro="Welcome to the MLOps Serious Game! This short introduction will explain essential game mechanics and the serious game environment. You play as a project manager of a Machine Learning project that uses MLOps guidelines."
                        data-step="1"
                        data-position="bottom"
                      >
                        📋 Phase Overview
                      </span>
                      <PhaseOverview />
                    </div>
                    <div
                      className="transparent-div intro1"
                      style={{ flex: "1 1 0" }}
                      data-intro-group="intro1"
                      data-intro="The metrics panel shows the currently active metrics. Metrics quantify aspects of the game's Environment like the project's model quality or the general efficiency of the development. As a project manager, your goal is to maximize the metrics while keeping them balanced as unbalanced metrics can complicate the development process."
                      data-step="3"
                      data-position="middle-aligned"
                    >
                      <span className="transparent-div-label">
                        📊 Performance Metrics
                      </span>
                      <MetricTab
                        current_phase={currentPhase}
                        showMetricValueChanges={showMetricValueChanges}
                        last_ac={last_ac}
                      />
                    </div>
                  </div>
                </nav>
                <div
                  className={`container-fluid flex-grow-1 d-flex flex-column overflow-hidden position-relative `}
                  style={{
                    backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_${(currentChallenge + currentPhase) % 4}.png")`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                  }}
                >
                  {!revealAc && !isStartDialogueOpen && (
                    <div
                      className={`row flex-grow-1 overflow-hidden ${roundOverAnimActive && styles.roundOverAnimActive}`}
                    >
                      <StakeholderInteractionArea
                        handleSend={handleSend}
                        chatMsgs={chat_msgs}
                        current_phase={currentPhase}
                        current_challenge={currentChallenge}
                        isEnabled={isChatEnabled}
                        actionCards={actionCards}
                        onHoverCard={setHoveredCardId}
                        selected_mgs={selected_mgs}
                      />
                      <div className="col-7 p-3 bg d-flex flex-column">
                        <CardArea
                          onPlayCard={playActionCard}
                          challenge_descr={challengeDescription}
                          challenge_intro={challengeIntro}
                          challenge_title={challengeTitle}
                          challenge_id={currentChallenge}
                          challenge_number={challengeNumber}
                          action_cards={actionCards}
                          current_phase={currentPhase}
                          hoveredCardId={hoveredCardId}
                          isStakeholderTyping={!isChatEnabled}
                        />
                      </div>
                    </div>
                  )}
                  {isStartDialogueOpen && (
                    <div className="container-fluid flex-grow-1 d-flex flex-column overflow-hidden transparent-div">
                      <PreRoundDialog
                        onStakeholderSelectionDone={onStakeholderSelectionDone}
                        challenge_title={challengeTitle}
                        challenge_desc={challengeDescription}
                        rount_intro_txt={challengeIntro}
                        metric_changes={challengeMetricChanges}
                        current_phase={currentPhase}
                        selectStakeholder={selectStakeholder}
                      />
                    </div>
                  )}
                  {revealAc && last_ac && (
                    <AcRevealPanel
                      last_ac={last_ac}
                      current_phase={currentPhase}
                      goToNextChallenge={() => getNextChallenge(last_ac)}
                    />
                  )}
                </div>
              </div>
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
