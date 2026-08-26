import { useState, useContext, useEffect } from "react";
import { Icon } from "@iconify/react";
import type { ActionCard } from "../types/ActionCard";
import type { EngagementCardConfig } from "../types/EngagementCard";
import StakeholderList from "./StakeholderList";
import { StakeholderContext } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import styles from "./online_intel_gathering.module.css";
import StakeholderDossier, { type StakeholderDossierEntry } from "./StakeholderDossier";
import "@chatscope/chat-ui-kit-styles/dist/default/styles.min.css";
import StakeholderInteractionArea, { type ChatMsg } from "./StakeholderInteractionArea";
import OnlineIntelHelpOverlay from "./OnlineIntelHelpOverlay";
import EngagementCards from "./EngagementCards";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import IntelVerificationDialog, { type IntelVerificationResultData } from "./IntelVerificationDialog";

interface OnlineIntelGatheringProps {
  onContinue: () => void;
  currentPhase?: number;
  currentChallenge?: number;
  showMetricValueChanges?: boolean;
  last_ac?: ActionCard;
  challengeTitle?: string;
  challengeDescription?: string;
  challengeIntro?: string;
  challengeAmount?: number;
  dossierData?: StakeholderDossierEntry[];
  activeStakeholderId?: string;
  intelItems?: IntelItem[];
  onUpdateIntelItems?: (items: IntelItem[]) => void;
}

export interface IntelItem {
  id: string;
  requirement_id?: string;
  intel_type: string;
  categorized_type: string;
  description: string;
  stakeholder_id?: string;
  stakeholder_name?: string;
}

export interface IntelVerificationResultModalData {
  wasCorrect: boolean;
  oldType: string;
  trueType: string;
  description: string;
  stakeholderName: string;
}

const defaultEngagementCards: EngagementCardConfig[] = [
  {
    id: "eng_0",
    title: "Verify Intel Item",
    icon: "ph:seal-check-bold",
    token_cost: 5,
    description: "Choose an unverified intel item and directly verify it.",
    stakeholder_selection_amount: 0,
    target_type: "intel",
    response_snippet: "Intel verified successfully.",
  },
  {
    id: "eng_1",
    title: "1-on-1 Deep Dive",
    icon: "ph:user-focus-bold",
    token_cost: 4,
    description: "Schedule a 1-on-1 meeting to uncover detailed information.",
    stakeholder_selection_amount: 1,
    target_type: "stakeholder",
    response_snippet: "In our 1-on-1 meeting, we discussed key technical and operational requirements in detail.",
  },
  {
    id: "eng_2",
    title: "Probe Requirements",
    icon: "ph:magnifying-glass-bold",
    token_cost: 3,
    description: "Ask questions regarding stakeholder's requirements and constraints.",
    stakeholder_selection_amount: 2,
    target_type: "stakeholder",
    response_snippet: "Probed requirements with selected stakeholders.",
  },
  {
    id: "eng_3",
    title: "Team Sync-up",
    icon: "ph:users-bold",
    token_cost: 2,
    description: "Inquire about the team's perspective on the project.",
    stakeholder_selection_amount: -1,
    target_type: "stakeholder",
    response_snippet: "Synced up with all team members to align perspectives.",
  },
  {
    id: "eng_4",
    title: "Ask Generic Question",
    icon: "ph:chat-teardrop-text-bold",
    token_cost: 1,
    description: "Lightweight query to gauge general sentiment and open preferences.",
    stakeholder_selection_amount: 1,
    target_type: "stakeholder",
    response_snippet: "Gauged general sentiment and high-level priorities.",
  },
];

export default function OnlineIntelGathering({
  currentPhase = 0,
  currentChallenge = 0,
  showMetricValueChanges = false,
  last_ac,
  challengeTitle = "Deploy High-Performance Recommendation Engine",
  challengeDescription = "The team needs to align with #Security Manager# and #Lead Data Scientist# on deployment safety.",
  challengeIntro = "Phase 2: Strategic Alignment & Intelligence Gathering",
  challengeAmount = 3,
  dossierData = [],
  activeStakeholderId,
  intelItems = [],
  onUpdateIntelItems,
}: OnlineIntelGatheringProps) {
  const stakeholderCtx = useContext(StakeholderContext);
  const stakeholders = stakeholderCtx?.stakeholders || {};
  const metricsCtx = useContext(MetricsContext);
  const metrics = metricsCtx?.metrics || {};

  // Attention Tokens state
  const [attentionTokens, setAttentionTokens] = useState(5);
  const maxAttentionTokens = 8;

  // Active Stakeholder & Speech Bubble
  const [selectedStakeholderId, setSelectedStakeholderId] = useState<string>("st_security");
  const [_stakeholderResponses, setStakeholderResponses] = useState<Record<string, string>>({
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

  // Active Playing Engagement Card Modal State
  const [playingCard, setPlayingCard] = useState<EngagementCardConfig | null>(null);
  const [isClosingCardModal, setIsClosingCardModal] = useState(false);
  const [selectedTargetStakeholderIds, setSelectedTargetStakeholderIds] = useState<string[]>([]);
  const [selectedTargetIntelId, setSelectedTargetIntelId] = useState<string | null>(null);
  const [playedCardIdsInPhase, setPlayedCardIdsInPhase] = useState<string[]>([]);
  const [cardTargetedStakeholdersMap, setCardTargetedStakeholdersMap] = useState<Record<string, string[]>>({});
  const [isDraggingCard, setIsDraggingCard] = useState(false);
  const { emit, subscribe } = useGameWebSocket();

  // Intel Verification Result Modal State
  const [verificationResultModal, setVerificationResultModal] = useState<IntelVerificationResultData | null>(null);

  // Subscribe to intel:verified_res WebSocket event
  useEffect(() => {
    if (!subscribe) return;
    const unsubscribe = subscribe("intel:verified_res", (payload: any) => {
      console.log("[WS] Received intel:verified_res in component:", payload);
      if (payload && payload.status === "success") {
        setVerificationResultModal({
          wasCorrect: payload.old_categorized_type === payload.true_categorized_type,
          oldType: payload.old_categorized_type,
          trueType: payload.true_categorized_type,
          description: payload.description,
          stakeholderName: payload.stakeholder_name,
        });
      }
    });
    return () => unsubscribe();
  }, [subscribe]);

  const handleCloseCardModal = () => {
    setIsClosingCardModal(true);
    setTimeout(() => {
      setPlayingCard(null);
      setIsClosingCardModal(false);
    }, 200);
  };

  const availableStakeholderList = Object.keys(stakeholders).length > 0
    ? Object.values(stakeholders)
    : [
      {
        id: "st_security",
        name: "Security Manager",
        role_description: "Ensures compliance and data security across ML pipelines.",
        stakeholder_color: "#dc3545",
        metric_id: "metric_security",
      },
      {
        id: "st_data_sci",
        name: "Lead Data Scientist",
        role_description: "Focuses on model accuracy, latency, and experiment tracking.",
        stakeholder_color: "#0d6efd",
        metric_id: "metric_accuracy",
      },
      {
        id: "st_product",
        name: "Product Owner",
        role_description: "Manages feature scope, timelines, and business ROI.",
        stakeholder_color: "#ffc107",
        metric_id: "metric_cost",
      },
    ];

  // Helper to check if a stakeholder is active in currentPhase
  const isStakeholderActiveInPhase = (st: any): boolean => {
    if (!st) return false;
    if (metrics && Object.keys(metrics).length > 0) {
      const metricId = st.metric_id;
      if (metricId) {
        const metric = metrics[metricId] || Object.values(metrics).find((m: any) => m.id === metricId);
        const metricIntro = metrics[`${metricId}_intro`] || Object.values(metrics).find((m: any) => m.id === `${metricId}_intro`);
        if (metric || metricIntro) {
          return Boolean((metric && metric.phases[currentPhase]) || (metricIntro && metricIntro.phases[currentPhase]));
        }
      }
    }
    return true;
  };

  const handleSelectEngagementCard = (card: EngagementCardConfig) => {
    const isSingleUseExhausted =
      (card.max_plays_per_phase === 1 || card.stakeholder_selection_amount === -1) &&
      playedCardIdsInPhase.includes(card.id);

    if (attentionTokens < card.token_cost || isSingleUseExhausted) return;

    // Rule: eng_3 (stakeholder_selection_amount == -1) auto-selects all stakeholders without a modal screen!
    if (card.stakeholder_selection_amount === -1) {
      setAttentionTokens((prev) => prev - card.token_cost);
      setPlayedCardIdsInPhase((prev) => [...prev, card.id]);

      const snippet = card.response_snippet || "Synced up with the entire team to align perspectives.";

      const activeStakeholders = availableStakeholderList.filter((st: any) => isStakeholderActiveInPhase(st));

      setChatMsgs((prev) => [
        ...prev,
        {
          id: "user",
          message: `⚡ Played Card: ${card.title} (Team Sync across ${activeStakeholders.length} active stakeholders)`,
          ac_id: -1,
        },
        ...activeStakeholders.map((st) => ({
          id: st.id,
          message: `[${st.name}] ${snippet}`,
          ac_id: -1,
        })),
      ]);
      return;
    }

    // For eng_0, eng_1, eng_2, eng_4: open the target selection modal with background blur
    setPlayingCard(card);
    setSelectedTargetStakeholderIds([]);
    setSelectedTargetIntelId(null);
  };

  const handleToggleStakeholderTarget = (stId: string) => {
    if (!playingCard) return;
    const isAlreadyTargeted = cardTargetedStakeholdersMap[playingCard.id]?.includes(stId);
    if (isAlreadyTargeted) return;

    const requiredAmount = playingCard.stakeholder_selection_amount;

    if (selectedTargetStakeholderIds.includes(stId)) {
      setSelectedTargetStakeholderIds(selectedTargetStakeholderIds.filter((id) => id !== stId));
    } else {
      if (requiredAmount === 1) {
        setSelectedTargetStakeholderIds([stId]);
      } else if (selectedTargetStakeholderIds.length < requiredAmount) {
        setSelectedTargetStakeholderIds([...selectedTargetStakeholderIds, stId]);
      }
    }
  };

  const handleConfirmPlayCardModal = () => {
    if (!playingCard) return;

    if (playingCard.target_type === "intel" || playingCard.id === "eng_0") {
      if (!selectedTargetIntelId) return;

      const targetIntel = intelItems.find((item) => item.id === selectedTargetIntelId);
      if (!targetIntel) return;

      setAttentionTokens((prev) => prev - playingCard.token_cost);

      // Emit WebSocket verification request
      emit("intel:verify_item", {
        phase_id: currentPhase,
        challenge_id: currentChallenge,
        intel_item_id: targetIntel.requirement_id || targetIntel.id,
      });

      setChatMsgs((prev) => [
        ...prev,
        {
          id: "user",
          message: `👑 Played Card: ${playingCard.title} on "${targetIntel.description}"`,
          ac_id: -1,
        },
        {
          id: targetIntel.stakeholder_id || "system",
          message: `✅ Submitted "${targetIntel.description}" for direct verification.`,
          ac_id: -1,
        },
      ]);
    } else {
      const requiredAmount = playingCard.stakeholder_selection_amount;
      if (selectedTargetStakeholderIds.length !== requiredAmount) return;

      setAttentionTokens((prev) => prev - playingCard.token_cost);

      const targetStakeholders = availableStakeholderList.filter((st) =>
        selectedTargetStakeholderIds.includes(st.id)
      );
      const namesStr = targetStakeholders.map((st) => st.name).join(" & ");
      const responseSnippet =
        playingCard.response_snippet || `Responded to ${playingCard.title}.`;

      // Update active stakeholder responses & conversation stream
      targetStakeholders.forEach((st) => {
        setStakeholderResponses((prev) => ({
          ...prev,
          [st.id]: responseSnippet,
        }));
      });

      if (targetStakeholders.length > 0) {
        setSelectedStakeholderId(targetStakeholders[0].id);
      }

      setChatMsgs((prev) => [
        ...prev,
        {
          id: "user",
          message: `Played Card: ${playingCard.title} on ${namesStr}`,
          ac_id: -1,
        },
        ...targetStakeholders.map((st) => ({
          id: st.id,
          message: `[${st.name}] ${responseSnippet}`,
          ac_id: -1,
        })),
      ]);

      setCardTargetedStakeholdersMap((prev) => ({
        ...prev,
        [playingCard.id]: [
          ...(prev[playingCard.id] || []),
          ...selectedTargetStakeholderIds,
        ],
      }));
    }

    if (
      playingCard.max_plays_per_phase === 1 ||
      playingCard.stakeholder_selection_amount === -1
    ) {
      setPlayedCardIdsInPhase((prev) => [...prev, playingCard.id]);
    }

    handleCloseCardModal();
  };

  const handleChatSend = (text: string) => {
    setChatMsgs((prev) => [
      ...prev,
      { id: "user", message: text, ac_id: -1 },
      {
        id: selectedStakeholderId,
        message: `I acknowledge your input regarding: "${text.slice(0, 35)}..."`,
        ac_id: -1,
      },
    ]);
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
      .map((item) => item.description.length > 25 ? item.description.slice(0, 25) + "..." : item.description)
      .join(" + ");
    setPitchedCardTitle(`Action Proposal: ${selectedTitles}`);
    setIsPitchModalOpen(false);
  };

  const handleDropEngagementCard = (e: React.DragEvent) => {
    e.preventDefault();
    const cardId = e.dataTransfer.getData("engagementCardId") || e.dataTransfer.getData("cardId");
    if (!cardId) return;

    const cardToPlay = defaultEngagementCards.find((c) => c.id === cardId);
    if (cardToPlay) {
      handleSelectEngagementCard(cardToPlay);
    }
  };

  const bgIndex = (currentChallenge + currentPhase) % 4;

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
        {/* Floating Top Right Help Button */}
        <button
          className="btn rounded-circle d-flex align-items-center justify-content-center shadow-lg position-absolute p-0"
          style={{
            top: "16px",
            right: "20px",
            width: "56px",
            height: "56px",
            backgroundColor: "var(--engagement-accent)",
            color: "var(--engagement-text)",
            border: "2px solid #ffffff",
            zIndex: 10,
          }}
          onClick={() => setIsHelpOverlayOpen(true)}
          title="View Phase, Metrics & Challenge Info"
        >
          <Icon
            icon="ph:question-bold"
            style={{
              fontSize: "2.4rem",
              color: "var(--engagement-text)",
            }}
          />
        </button>

        {/* Main Board Grid: Left Column = Stakeholder Dossier, Right Column = Pitch Deck & Chat */}
        <div className="row g-3 align-items-stretch flex-grow-1 h-100">
          {/* LEFT COLUMN: Stakeholder Dossier (Constantly Open & Embedded) */}
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

          {/* RIGHT COLUMN */}
          <div className="col-12 col-lg-7 d-flex flex-column gap-3 h-100 justify-content-between">
            {/* Single Unified Drop Zone Div wrapping ONLY Pitch Deck & Stakeholder Interaction Area */}
            <div
              className={`flex-grow-1 d-flex flex-column gap-3 overflow-hidden p-2 rounded transition-all ${isDraggingCard ? styles.singleDropZoneActive : ""
                }`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(e) => {
                setIsDraggingCard(false);
                handleDropEngagementCard(e);
              }}
            >
              {/* Top Right: Boardroom Table Area (Pitch Deck) */}
              <div className={`${styles.tableContainer} flex-shrink-0 d-flex flex-column justify-content-center`}>
                <div className="transparent-div d-flex justify-content-center align-items-center mb-3">
                  <StakeholderList current_phase={currentPhase} />
                </div>

                <div className={styles.diamondTable}>
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

              {/* Stakeholder Interaction Area Component (Chat) */}
              <div
                className="flex-grow-1 overflow-hidden"
                style={{ minHeight: "300px" }}
              >
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
            </div>

            {/* Dedicated Engagement Cards Component (OUTSIDE the drop zone) */}
            <EngagementCards
              attentionTokens={attentionTokens}
              maxAttentionTokens={maxAttentionTokens}
              cards={defaultEngagementCards}
              playedCardIds={playedCardIdsInPhase}
              onSelectCard={handleSelectEngagementCard}
              onDragCardStart={() => setIsDraggingCard(true)}
              onDragCardEnd={() => setIsDraggingCard(false)}
              isEnabled={true}
            />
          </div>
        </div>
      </div>

      {/* Engagement Card Play & Target Selection Modal with Blurred Backdrop */}
      {playingCard && (
        <div
          className={`${styles.modalBackdrop} ${isClosingCardModal ? styles.modalBackdropClosing : ""
            }`}
          onClick={handleCloseCardModal}
        >
          <div
            className={`${styles.intelModal} ${isClosingCardModal ? styles.intelModalClosing : ""
              }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className={styles.modalHeader}>
              <div className="d-flex align-items-center gap-2">
                <Icon icon={playingCard.icon || "ph:cards-bold"} style={{ fontSize: "1.8rem", color: "var(--engagement-accent)" }} />
                <h5 className="modal-title mb-0 fw-bold">{playingCard.title}</h5>
              </div>
              <button
                type="button"
                className="btn-close btn-close-white"
                onClick={handleCloseCardModal}
              ></button>
            </div>

            {/* Modal Body */}
            <div className={styles.modalBody}>
              {/* Overhauled Split Layout: Left Card Preview + Right Light Rules Container with Black Text */}
              <div className="row g-3 align-items-stretch mb-4">
                {/* Left Column: Fixed-Width Card Surface Preview (No Horizontal Stretch) */}
                <div className="col-12 col-md-auto d-flex justify-content-center align-items-stretch">
                  <div className={styles.centeredCardPreview} style={{ width: "300px", minWidth: "300px" }}>
                    <div className="d-flex justify-content-between w-100 mb-2">
                      <span
                        className="badge"
                        style={{
                          backgroundColor: "var(--engagement-muted)",
                          color: "var(--engagement-text)",
                          fontWeight: "bold",
                        }}
                      >
                        ENGAGEMENT CARD
                      </span>
                      <span
                        className="badge"
                        style={{
                          backgroundColor: "transparent",
                          border: "1px solid var(--token-color)",
                          color: "var(--token-color)",
                          fontWeight: "bold",
                        }}
                      >
                        <Icon icon="ph:coin-fill" className="me-1" style={{ color: "var(--token-color)" }} />
                        {playingCard.token_cost} Tokens
                      </span>
                    </div>
                    <Icon
                      icon={playingCard.icon || "ph:cards-bold"}
                      style={{ fontSize: "3.2rem", color: "var(--engagement-accent)" }}
                      className="my-2"
                    />
                    <h6 className="fw-bold mb-1 text-center" style={{ color: "var(--engagement-text)" }}>{playingCard.title}</h6>
                    <p className="small text-center mb-0" style={{ fontSize: "0.82rem", color: "var(--engagement-text)", opacity: 0.75 }}>
                      {playingCard.description}
                    </p>
                  </div>
                </div>

                {/* Right Column: Flex-Grow Light Rules & Mechanics Container */}
                <div className="col-12 col-md flex-grow-1">
                  <div className="card h-100 border-0 bg-light shadow-sm text-dark rounded-3 overflow-hidden">
                    {/* Header Banner */}
                    <div className="card-header bg-white border-bottom p-3 d-flex align-items-center justify-content-between">
                      <div className="d-flex align-items-center gap-2">
                        <Icon icon="ph:notebook-bold" className="text-primary" style={{ fontSize: "1.4rem" }} />
                        <h6 className="fw-bold text-dark mb-0 fs-6">Card Mechanics & Rules</h6>
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        <span className="small text-muted fw-semibold">Selection:</span>
                        <span
                          className={`badge ${playingCard.target_type === "intel" || playingCard.id === "eng_0"
                            ? selectedTargetIntelId
                              ? "bg-success"
                              : "bg-secondary"
                            : selectedTargetStakeholderIds.length === playingCard.stakeholder_selection_amount
                              ? "bg-success"
                              : "bg-secondary"
                            } fs-6 px-3 py-1.5`}
                        >
                          {playingCard.target_type === "intel" || playingCard.id === "eng_0"
                            ? selectedTargetIntelId
                              ? "1 / 1 Selected"
                              : "0 / 1 Selected"
                            : `${selectedTargetStakeholderIds.length} / ${playingCard.stakeholder_selection_amount} Selected`}
                        </span>
                      </div>
                    </div>

                    {/* Body Content with Deep Black Text */}
                    <div className="card-body p-3 text-dark">
                      {/* Instruction Callout */}
                      <div className="p-2 mb-3 bg-white rounded border border-primary-subtle d-flex align-items-center gap-2">
                        <Icon icon="ph:cursor-click-bold" className="text-primary" style={{ fontSize: "1.2rem" }} />
                        <span className="fw-bold text-dark small">
                          {playingCard.target_type === "intel" || playingCard.id === "eng_0"
                            ? "Click an unverified intel item below to select it for verification:"
                            : `Click to select exactly ${playingCard.stakeholder_selection_amount} stakeholder${playingCard.stakeholder_selection_amount > 1 ? "s" : ""
                            } below:`}
                        </span>
                      </div>

                      {/* Structured Rules List */}
                      <div className="small text-dark">
                        <ul className="mb-0 ps-3 text-dark" style={{ lineHeight: "1.5" }}>
                          {playingCard.target_type === "intel" || playingCard.id === "eng_0" ? (
                            <>
                              <li className="mb-1 text-dark">
                                <strong className="text-dark">Direct Intel Verification:</strong> Upgrades 1 unverified intel item's certainty level to{" "}
                                <span className="badge bg-success">Verified</span> in your Stakeholder Dossier.
                              </li>
                              <li className="mb-1 text-dark">
                                <strong className="text-dark">Selectability Rule:</strong> Already verified intel items are disabled and cannot be selected twice.
                              </li>
                            </>
                          ) : (
                            <>
                              <li className="mb-1 text-dark">
                                <strong className="text-dark">Stakeholder Targeting:</strong> Select exactly{" "}
                                <strong className="text-dark">{playingCard.stakeholder_selection_amount}</strong> stakeholder
                                {playingCard.stakeholder_selection_amount > 1 ? "s" : ""} to prompt specific dialogue responses & requirements.
                              </li>
                              <li className="mb-1 text-dark">
                                <strong className="text-dark">Single Target Limit:</strong> Stakeholders already targeted by{" "}
                                <em className="text-dark">"{playingCard.title}"</em> in this phase cannot be selected again.
                              </li>
                            </>
                          )}
                          <li className="text-dark">
                            <strong className="text-dark">Resource Cost:</strong> Spends <strong className="text-dark">{playingCard.token_cost} Attention Tokens</strong>.
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Target Selection Screen Options */}
              {playingCard.target_type === "intel" || playingCard.id === "eng_0" ? (
                /* Intel Item Selection Grid */
                <div className="row g-3">
                  {intelItems.map((item) => {
                    const isVerified = (item.intel_type || "").toLowerCase().includes("verified");
                    const isSelected = selectedTargetIntelId === item.id;
                    const isSelectable = !isVerified;
                    const catType = item.categorized_type || "requirement";
                    const categoryLabel = catType.replace(/_/g, " ");

                    return (
                      <div key={item.id} className="col-12 col-md-6">
                        <div
                          className={`${styles.intelItemCard} ${isSelected ? styles.intelItemSelected : ""
                            } ${!isSelectable ? styles.intelItemDisabled : ""}`}
                          onClick={() => {
                            if (isSelectable) {
                              setSelectedTargetIntelId(item.id);
                            }
                          }}
                        >
                          <div className="d-flex justify-content-between align-items-start mb-2">
                            <span className={`badge ${getTagBadgeColor(catType)}`}>
                              {categoryLabel}
                            </span>
                            <span
                              className={`badge ${isVerified ? "bg-success" : "bg-warning text-dark"
                                }`}
                            >
                              {item.intel_type}
                            </span>
                          </div>
                          <h6 className="fw-bold text-dark mb-1">{item.description}</h6>
                          {item.stakeholder_name && (
                            <p className="small text-muted mb-0" style={{ fontSize: "0.75rem" }}>
                              Source: {item.stakeholder_name}
                            </p>
                          )}
                          {!isSelectable && (
                            <span className="badge bg-secondary mt-2 align-self-start">
                              <Icon icon="ph:check-circle-fill" className="me-1" /> Already Verified
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Stakeholder Selection Grid (Only Active Stakeholders in currentPhase) */
                <div className="row g-3">
                  {availableStakeholderList
                    .filter((st: any) => isStakeholderActiveInPhase(st))
                    .map((st) => {
                      const isSelected = selectedTargetStakeholderIds.includes(st.id);
                      const isAlreadyTargetedByThisCard = cardTargetedStakeholdersMap[playingCard.id]?.includes(st.id);
                      const isSelectable = !isAlreadyTargetedByThisCard;

                      return (
                        <div key={st.id} className="col-12 col-md-4">
                          <div
                            className={`${styles.stakeholderTargetCard} ${isSelected ? styles.stakeholderTargetSelected : ""
                              } ${!isSelectable ? styles.intelItemDisabled : ""}`}
                            style={{
                              cursor: isSelectable ? "pointer" : "not-allowed",
                              opacity: isSelectable ? 1 : 0.55,
                            }}
                            onClick={() => {
                              if (isSelectable) {
                                handleToggleStakeholderTarget(st.id);
                              }
                            }}
                          >
                            <div
                              className="rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                              style={{
                                width: "48px",
                                height: "48px",
                                backgroundColor: isSelectable ? (st.stakeholder_color || "#0d6efd") : "#6c757d",
                                color: "#fff",
                                fontWeight: "bold",
                                fontSize: "1.2rem",
                              }}
                            >
                              {st.name.charAt(0)}
                            </div>
                            <div className="flex-grow-1">
                              <div className="d-flex justify-content-between align-items-start mb-1">
                                <h6 className="fw-bold mb-0 text-dark me-1">{st.name}</h6>
                                <div className="d-flex align-items-center gap-1 flex-shrink-0">
                                  {isSelected && (
                                    <Icon
                                      icon="ph:check-circle-fill"
                                      style={{ color: "#ffc107", fontSize: "1.3rem" }}
                                    />
                                  )}
                                  {isAlreadyTargetedByThisCard && (
                                    <span title={`Already targeted by ${playingCard.title}`}>
                                      <Icon
                                        icon="ph:lock-key-fill"
                                        style={{ color: "#dc3545", fontSize: "1.2rem" }}
                                      />
                                    </span>
                                  )}
                                </div>
                              </div>
                              <p className="small text-secondary mb-0" style={{ lineHeight: "1.4", wordBreak: "break-word" }}>
                                {(st as any).role_description || (st as any).responsibilities || "Stakeholder"}
                              </p>
                              {isAlreadyTargetedByThisCard && (
                                <span className="badge bg-danger mt-2 d-inline-block" style={{ fontSize: "0.65rem" }}>
                                  Targeted by {playingCard.title}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className={styles.modalFooter}>
              <button
                className="btn btn-secondary rounded-pill px-4"
                onClick={handleCloseCardModal}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary rounded-pill px-4 fw-bold"
                disabled={
                  playingCard.target_type === "intel" || playingCard.id === "eng_0"
                    ? !selectedTargetIntelId
                    : selectedTargetStakeholderIds.length !==
                    playingCard.stakeholder_selection_amount
                }
                onClick={handleConfirmPlayCardModal}
              >
                <Icon icon="ph:lightning-fill" className="me-1" />
                Confirm & Play Card ({playingCard.token_cost} 🪙)
              </button>
            </div>
          </div>
        </div>
      )}

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
                        {(() => {
                          const catType = item.categorized_type || (item as any).type || "requirement";
                          const certaintyLabel = item.intel_type || (item as any).certainty || "unconfirmed";
                          const isVerified = (certaintyLabel || "").toLowerCase().includes("verified");

                          return (
                            <>
                              <div className="d-flex justify-content-between align-items-start mb-2">
                                <span className={`badge ${getTagBadgeColor(catType)}`}>
                                  {catType.replace(/_/g, " ")}
                                </span>
                                <div className="d-flex align-items-center gap-2">
                                  <span className={`badge ${isVerified ? "bg-success" : "bg-warning text-dark"}`}>
                                    {certaintyLabel}
                                  </span>
                                  <input
                                    type="checkbox"
                                    className="form-check-input"
                                    checked={isSelected}
                                    onChange={() => { }}
                                  />
                                </div>
                              </div>
                              <h6 className="fw-bold text-dark mb-1">{item.description}</h6>
                              {item.stakeholder_name && (
                                <p className="small text-muted mb-0" style={{ fontSize: "0.75rem" }}>
                                  Source: {item.stakeholder_name}
                                </p>
                              )}
                            </>
                          );
                        })()}
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
        challengeAmount={challengeAmount}
      />

      {/* Intel Verification Result PopUp Modal Component */}
      <IntelVerificationDialog
        isOpen={Boolean(verificationResultModal)}
        onClose={() => setVerificationResultModal(null)}
        resultData={verificationResultModal}
      />
    </div>
  );
}
