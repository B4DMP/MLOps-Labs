import React, { useState, useContext } from "react";
import { Icon } from "@iconify/react";
import PhaseOverview from "./PhaseOverview";
import MetricTab from "./MetricTab";
import type { ActionCard } from "../types/ActionCard";
import StakeholderList from "./StakeholderList";
import { StakeholderContext } from "./StakeholderProvider";
import HoverTooltip from "./HoverToolTip";
import styles from "./online_intel_gathering.module.css";
import StakeholderDossier, { type StakeholderDossierEntry } from "./StakeholderDossier";
import chatStyles from "./customChatMessage.module.css";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import StakeholderInteractionArea, { type ChatMsg } from "./StakeholderInteractionArea";
import OnlineIntelHelpOverlay from "./OnlineIntelHelpOverlay";
import EngagementCards from "./EngagementCards";

interface OnlineIntelGatheringProps {
  onContinue: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  showMetricValueChanges?: boolean;
  last_ac?: ActionCard;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  challengeNumber?: number;
  dossierData?: StakeholderDossierEntry[];
  activeStakeholderId?: string;
}

export interface IntelItem {
  id: string;
  title: string;
  stakeholderId: string;
  type: "hard_constraint" | "requirement" | "negotiable_preference" | "personal_friction";
  certainty: "Verified" | "Inferred" | "Unconfirmed";
  description: string;
}

export interface EngagementCard {
  id: string;
  title: string;
  icon: string;
  tokenCost: number;
  targetStakeholderId: string;
  description: string;
  responseSnippet: string;
}

function parseChallengeDescription(description: string) {
  if (!description) return [];
  const parts = description.split("#");
  return parts.map((part, index) => {
    if (index % 2 === 0) {
      return { type: "text" as const, value: part };
    } else {
      return { type: "id" as const, value: part };
    }
  });
}

export default function OnlineIntelGathering({
  onContinue,
  currentPhase = 0,
  currentChallenge = 0,
  showMetricValueChanges = false,
  last_ac,
  challengeTitle = "Deploy High-Performance Recommendation Engine",
  challengeDescription = "The team needs to align with #Security Manager# and #Lead Data Scientist# on deployment safety.",
  challengeIntro = "Phase 2: Strategic Alignment & Intelligence Gathering",
  challengeNumber = 3,
  dossierData = [],
  activeStakeholderId,
}: OnlineIntelGatheringProps) {
  const [loading, setLoading] = useState(false);
  const { stakeholders } = useContext(StakeholderContext);

  // Attention Tokens state
  const [attentionTokens, setAttentionTokens] = useState(5);
  const maxAttentionTokens = 8;

  // Active Stakeholder & Speech Bubble
  const [selectedStakeholderId, setSelectedStakeholderId] = useState<string>("st_security");
  const [stakeholderResponses, setStakeholderResponses] = useState<Record<string, string>>({
    st_security: "We must ensure strict data privacy before approving any deployment pipeline.",
    st_data_sci: "Our model latency needs to remain under 50ms for live inferencing.",
    st_product: "Budget constraints are tight, so compute costs need optimization.",
  });

  // Conversation History Chat Messages
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([
    {
      id: "st_security",
      message: "We must ensure strict data privacy before approving any deployment pipeline.",
      ac_id: -1,
    },
    {
      id: "st_data_sci",
      message: "Our model latency needs to remain under 50ms for live inferencing.",
      ac_id: -1,
    },
  ]);

  // Pitch Overlay Modal & Intel Selection State
  const [isPitchModalOpen, setIsPitchModalOpen] = useState(false);
  const [isHelpOverlayOpen, setIsHelpOverlayOpen] = useState(false);
  const [selectedIntelIds, setSelectedIntelIds] = useState<string[]>([]);
  const [pitchedCardTitle, setPitchedCardTitle] = useState<string | null>(null);

  // Mock Available Intel Items
  const [intelItems] = useState<IntelItem[]>([
    {
      id: "intel_1",
      title: "Hard Constraint: Data Privacy GDPR",
      stakeholderId: "st_security",
      type: "hard_constraint",
      certainty: "Verified",
      description: "Model cannot store raw user PII on external cloud servers.",
    },
    {
      id: "intel_2",
      title: "Requirement: CI/CD Retraining Pipeline",
      stakeholderId: "st_data_sci",
      type: "requirement",
      certainty: "Verified",
      description: "Automated drift monitoring with weekly trigger retrains.",
    },
    {
      id: "intel_3",
      title: "Negotiable Preference: PyTorch Framework",
      stakeholderId: "st_data_sci",
      type: "negotiable_preference",
      certainty: "Inferred",
      description: "Team prefers ONNX export for inference optimization.",
    },
    {
      id: "intel_4",
      title: "Personal Friction: Department Headcount Cuts",
      stakeholderId: "st_product",
      type: "personal_friction",
      certainty: "Unconfirmed",
      description: "Fears automation might replace junior data engineer roles.",
    },
    {
      id: "intel_5",
      title: "Hard Constraint: Latency < 50ms",
      stakeholderId: "st_data_sci",
      type: "hard_constraint",
      certainty: "Verified",
      description: "Strict real-time SLA for recommendation API endpoints.",
    },
  ]);

  // Mock Engagement Cards (Dialogue Prompts)
  const engagementCards: EngagementCard[] = [
    {
      id: "eng_1",
      title: "👑 1-on-1 Deep Dive",
      icon: "👑",
      tokenCost: 3,
      targetStakeholderId: "st_security",
      description: "Schedule an intensive 1-on-1 session to uncover core red lines.",
      responseSnippet: "If you guarantee end-to-end encryption, I will sign off on the milestone.",
    },
    {
      id: "eng_2",
      title: "🔍 Probe Security & Privacy",
      icon: "🔍",
      tokenCost: 2,
      targetStakeholderId: "st_security",
      description: "Ask detailed questions regarding security constraints and compliance.",
      responseSnippet: "Our audit requires automated vulnerability scanning on all container images.",
    },
    {
      id: "eng_3",
      title: "⚡ Probe Team Capacity",
      icon: "⚡",
      tokenCost: 2,
      targetStakeholderId: "st_data_sci",
      description: "Inquire about MLOps workload and engineering bottlenecks.",
      responseSnippet: "We need automated monitoring so our engineers aren't on-call 24/7.",
    },
    {
      id: "eng_4",
      title: "💬 Ask Generic Question",
      icon: "💬",
      tokenCost: 1,
      targetStakeholderId: "st_product",
      description: "Lightweight query to gauge general sentiment and open preferences.",
      responseSnippet: "We are supportive as long as project milestones stay on schedule.",
    },
  ];

  const engagementCardPrompts = engagementCards.map(
    (card) => `${card.title} (${card.tokenCost} 🪙) - ${card.description}`
  );

  const handleChatSend = (text: string) => {
    const matchedCard = engagementCards.find(
      (c) =>
        text.includes(c.title) ||
        `${c.title} (${c.tokenCost} 🪙) - ${c.description}` === text ||
        `${c.title}: ${c.description}` === text
    );

    if (matchedCard) {
      if (attentionTokens < matchedCard.tokenCost) return;
      setAttentionTokens((prev) => prev - matchedCard.tokenCost);
      setSelectedStakeholderId(matchedCard.targetStakeholderId);
      setStakeholderResponses((prev) => ({
        ...prev,
        [matchedCard.targetStakeholderId]: matchedCard.responseSnippet,
      }));
      setChatMsgs((prev) => [
        ...prev,
        { id: "user", message: text, ac_id: -1 },
        { id: matchedCard.targetStakeholderId, message: matchedCard.responseSnippet, ac_id: -1 },
      ]);
    } else {
      setChatMsgs((prev) => [
        ...prev,
        { id: "user", message: text, ac_id: -1 },
        {
          id: selectedStakeholderId,
          message: `I acknowledge your input regarding: "${text.slice(0, 35)}..."`,
          ac_id: -1,
        },
      ]);
    }
  };

  const handleToggleIntelSelection = (id: string) => {
    if (selectedIntelIds.includes(id)) {
      setSelectedIntelIds(selectedIntelIds.filter((item) => item !== id));
    } else {
      if (selectedIntelIds.length < 3) {
        setSelectedIntelIds([...selectedIntelIds, id]);
      }
    }
  };

  const handleConfirmIntelMerge = () => {
    if (selectedIntelIds.length === 0) return;
    const selectedTitles = intelItems
      .filter((item) => selectedIntelIds.includes(item.id))
      .map((item) => item.title.split(":")[1] || item.title)
      .join(" + ");
    setPitchedCardTitle(`Action Proposal: ${selectedTitles}`);
    setIsPitchModalOpen(false);
  };

  const bgIndex = (currentChallenge + currentPhase) % 4;
  const challenge_desc_cutted = parseChallengeDescription(challengeDescription);
  const challenge_title = challengeTitle;
  const challenge_id = currentChallenge;
  const challenge_number = challengeNumber;
  const challenge_intro = challengeIntro;

  const getTagBadgeColor = (type: string) => {
    switch (type) {
      case "hard_constraint":
        return "bg-danger";
      case "requirement":
        return "bg-primary";
      case "negotiable_preference":
        return "bg-success";
      case "personal_friction":
        return "bg-warning text-dark";
      default:
        return "bg-secondary";
    }
  };

  return (
    <div className={styles.container}>
      {/* Main Content Area over Game Background Canvas */}
      <div
        className="container-fluid flex-grow-1 d-flex flex-column p-3 position-relative overflow-auto"
        style={{
          backgroundImage: `url("${import.meta.env.BASE_URL}graphics/bg_${bgIndex}.png")`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {/* Floating Top Right Red Help Button */}
        <button
          className="btn btn-danger rounded-circle d-flex align-items-center justify-content-center shadow-lg position-absolute"
          style={{
            top: "16px",
            right: "20px",
            width: "56px",
            height: "56px",
            backgroundColor: "#dc3545",
            color: "#ffffff",
            border: "2px solid #ffffff",
            zIndex: 10,
          }}
          onClick={() => setIsHelpOverlayOpen(true)}
          title="View Phase, Metrics & Challenge Info"
        >
          <Icon icon="ph:question-bold" style={{ fontSize: "2.4rem", color: "#ffffff" }} />
        </button>

        {/* Main Board Grid: Left Column = Stakeholder Dossier (Full Height), Right Column = Pitch Deck & Chat */}
        <div className="row g-3 align-items-stretch flex-grow-1 h-100">
          {/* LEFT COLUMN: Stakeholder Dossier (Constantly Open & Non-Closable, Full Height) */}
          <div className="col-12 col-lg-5 d-flex flex-column h-100">
            <div className="flex-grow-1 h-100" style={{ minHeight: "500px" }}>
              <StakeholderDossier
                isOpen={true}
                canClose={false}
                isEmbedded={true}
                dossierData={dossierData || []}
                activeStakeholderId={activeStakeholderId || selectedStakeholderId}
                currentPhase={currentPhase}
                currentChallenge={currentChallenge}
                onClose={() => { }}
              />
            </div>
          </div>

          {/* RIGHT COLUMN: Pitch Deck Area (Top Right) & Stakeholder Interaction Area Component (Bottom Right) */}
          <div className="col-12 col-lg-7 d-flex flex-column gap-3 h-100 justify-content-between">
            {/* Top Right: Boardroom Table Area (Pitch Deck & Active Stakeholders List) */}
            <div className={`${styles.tableContainer} flex-shrink-0 d-flex flex-column justify-content-center`}>
              {/* Active Stakeholder List Component */}
              <div className="transparent-div d-flex justify-content-center align-items-center mb-3">
                <StakeholderList current_phase={currentPhase} />
              </div>

              {/* Rhombus / Diamond Boardroom Table */}
              <div className={styles.diamondTable}>
                {/* Control Surface: Action Card Slot in Middle of Table */}
                <div
                  className={`${styles.actionCardSurface} ${pitchedCardTitle ? styles.actionCardConfigured : styles.actionCardGreyedOut
                    }`}
                  onClick={() => setIsPitchModalOpen(true)}
                >
                  {pitchedCardTitle ? (
                    <div className="text-center">
                      <span className="badge bg-primary mb-2">🃏 Pitched Base AC</span>
                      <h6 className="fw-bold mb-2 text-dark">{pitchedCardTitle}</h6>
                      <p className="small text-muted mb-2">Selected Intel merged into proposal.</p>
                      <button className="btn btn-sm btn-outline-primary rounded-pill px-3">
                        ✏️ Edit Proposal
                      </button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <div className={styles.questionMarkIcon}>
                        <Icon icon="ph:question-bold" style={{ color: "gray", fontSize: "4.2rem" }} />
                      </div>
                      <h6 className="fw-bold mb-1">Pitch Action Card</h6>
                      <p className="small mb-0 opacity-75">
                        Click to select 1-3 Intel Items & build proposal
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Stakeholder Interaction Area Component (Conversation History Stream) */}
            <div className="flex-grow-1 overflow-hidden" style={{ minHeight: "350px" }}>
              <StakeholderInteractionArea
                className="w-100 h-100"
                handleSend={handleChatSend}
                chatMsgs={chatMsgs}
                current_phase={currentPhase}
                current_challenge={currentChallenge}
                isEnabled={true}
                actionCards={[]}
                onHoverCard={() => { }}
                selected_mgs={[]}
                showStakeholderList={false}
                showInput={false}
              />
            </div>

            {/* Dedicated Engagement Cards Component (Centered Attention Token Counter + Prompt Speech Bubbles) */}
            <EngagementCards
              attentionTokens={attentionTokens}
              maxAttentionTokens={maxAttentionTokens}
              prompts={engagementCardPrompts}
              onSelectPrompt={handleChatSend}
              isEnabled={true}
            />
          </div>
        </div>
      </div>

      {/* Action Card Pitch Modal with Blurred Backdrop */}
      {isPitchModalOpen && (
        <div className={styles.modalBackdrop} onClick={() => setIsPitchModalOpen(false)}>
          <div className={styles.intelModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h5 className="modal-title mb-0 fw-bold">
                🃏 Build Action Proposal from Intel Items
              </h5>
              <button
                type="button"
                className="btn-close btn-close-white"
                onClick={() => setIsPitchModalOpen(false)}
              ></button>
            </div>

            <div className={styles.modalBody}>
              <p className="text-secondary small mb-3">
                Select <b>1 to 3 Intel Items</b> to merge into your Base Action Card proposal for the upcoming Pitch Debate.
              </p>

              <div className="d-flex justify-content-between align-items-center mb-3">
                <span className="fw-bold text-dark">Available Dossier Intel Items</span>
                <span
                  className={`badge ${selectedIntelIds.length > 0 ? "bg-success" : "bg-secondary"
                    } fs-6`}
                >
                  Selected: {selectedIntelIds.length} / 3
                </span>
              </div>

              <div className="row g-3">
                {intelItems.map((item) => {
                  const isSelected = selectedIntelIds.includes(item.id);
                  return (
                    <div key={item.id} className="col-12 col-md-6">
                      <div
                        className={`${styles.intelItemCard} ${isSelected ? styles.intelItemSelected : ""
                          }`}
                        onClick={() => handleToggleIntelSelection(item.id)}
                      >
                        <div className="d-flex justify-content-between align-items-start mb-2">
                          <span className={`badge ${getTagBadgeColor(item.type)}`}>
                            {item.type.replace("_", " ")}
                          </span>
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={isSelected}
                            onChange={() => { }}
                          />
                        </div>
                        <h6 className="fw-bold text-dark mb-1">{item.title}</h6>
                        <p className="small text-secondary mb-0">{item.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-3 bg-light border-top d-flex justify-content-end gap-2">
              <button
                className="btn btn-secondary rounded-pill px-4"
                onClick={() => setIsPitchModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary rounded-pill px-4 fw-bold"
                disabled={selectedIntelIds.length === 0}
                onClick={handleConfirmIntelMerge}
              >
                Confirm & Build Action Card ({selectedIntelIds.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help / Info Modal Overlay Component */}
      <OnlineIntelHelpOverlay
        isOpen={isHelpOverlayOpen}
        onClose={() => setIsHelpOverlayOpen(false)}
        currentPhase={currentPhase}
        currentChallenge={currentChallenge}
        showMetricValueChanges={showMetricValueChanges}
        last_ac={last_ac}
        challengeTitle={challengeTitle}
        challengeDescription={challengeDescription}
        challengeIntro={challengeIntro}
        challengeNumber={challengeNumber}
      />
    </div>
  );
}
