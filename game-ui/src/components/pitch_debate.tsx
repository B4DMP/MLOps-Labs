import MetricTab from "./MetricTab";
import StakeholderInteractionArea, { type ChatMsg } from "./StakeholderInteractionArea";
import CardArea from "./CardArea";
import type { ActionCard } from "../types/ActionCard";
import type { DialogueOption } from "../types/DialogueOption";
import PhaseOverview from "./PhaseOverview";
import AcRevealPanel from "./AcRevealPanel";
import styles from "../Game.module.css";

interface PitchDebateProps {
  currentPhase: number;
  setCurrentPhase?: React.Dispatch<React.SetStateAction<number>>;
  phases?: any[];
  setPhases?: React.Dispatch<React.SetStateAction<any[]>>;
  metrics?: any;
  setMetrics?: React.Dispatch<React.SetStateAction<any>>;
  stakeholders?: any;
  setStakeholders?: React.Dispatch<React.SetStateAction<any>>;
  lastError?: string;
  isInErrorUi?: boolean;
  setIsInErrorUi?: (open: boolean) => void;
  isPhaseDialogueOpen?: boolean;
  setIsPhaseDialogueOpen?: (open: boolean) => void;
  challengeTitle: string;
  challengeDescription: string;
  challengeIntro: string;
  currentChallenge: number;
  challengeNumber: number;
  revealAc: boolean;
  last_ac: ActionCard;
  roundOverAnimActive: boolean;
  showMetricValueChanges: boolean;
  isChatEnabled: boolean;
  actionCards: ActionCard[];
  hoveredCardId: number | null;
  setHoveredCardId: (id: number | null) => void;
  dialogueOptions: DialogueOption[];
  chat_msgs: ChatMsg[];
  playActionCard: (ac: ActionCard) => void;
  getNextChallenge: (ac: ActionCard) => void;
  onSelectDialogueOption: (index: number) => void;
}

export default function PitchDebate({
  currentPhase,
  challengeTitle,
  challengeDescription,
  challengeIntro,
  currentChallenge,
  challengeNumber,
  revealAc,
  last_ac,
  roundOverAnimActive,
  showMetricValueChanges,
  isChatEnabled,
  actionCards,
  hoveredCardId,
  setHoveredCardId,
  dialogueOptions,
  chat_msgs,
  playActionCard,
  getNextChallenge,
  onSelectDialogueOption,
}: PitchDebateProps) {
  return (
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
        {!revealAc && (
          <div
            className={`row flex-grow-1 overflow-hidden ${roundOverAnimActive && styles.roundOverAnimActive}`}
          >
            <StakeholderInteractionArea
              onSelectDialogueOption={onSelectDialogueOption}
              dialogueOptions={dialogueOptions}
              chatMsgs={chat_msgs}
              current_phase={currentPhase}
              current_challenge={currentChallenge}
              isEnabled={isChatEnabled}
              actionCards={actionCards}
              onHoverCard={setHoveredCardId}
              showStakeholderList={false}
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
        {revealAc && last_ac && (
          <AcRevealPanel
            last_ac={last_ac}
            current_phase={currentPhase}
            goToNextChallenge={() => getNextChallenge(last_ac)}
          />
        )}
      </div>
    </div>
  );
}
