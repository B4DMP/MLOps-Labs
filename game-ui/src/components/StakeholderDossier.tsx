import React, { useState, useRef, useEffect, useContext } from "react";
import styles from "./StakeholderDossier.module.css";
import { StakeholderContext } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import { PhasesContext } from "./PhaseProvider";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";

export interface IntelEntry {
  id: string;
  requirement_id: string;
  intel_type: string; // e.g. "unconfirmed", "verified", "inferred"
  categorized_type: string; // e.g. "hard_constraint", "requirement", "negotiable_preference", "personal_friction"
  description: string;
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
  intel_items: IntelEntry[];
}

interface StakeholderDossierProps {
  isOpen: boolean;
  onClose: () => void;
  dossierData: StakeholderDossierEntry[];
  activeStakeholderId?: string;
  currentPhase?: number;
  currentChallenge?: number;
  canClose?: boolean;
  isEmbedded?: boolean;
  emotionColors?: Record<string, string>;
}

const CATEGORY_META: Record<string, { label: string; icon: string; styleClass: string }> = {
  hard_constraint: { label: "Hard Constraint", icon: "📌", styleClass: styles.tagHardConstraint },
  requirement: { label: "Core Requirement", icon: "📋", styleClass: styles.tagRequirement },
  negotiable_preference: { label: "Negotiable Preference", icon: "💬", styleClass: styles.tagNegotiable },
  personal_friction: { label: "Personal Friction", icon: "⚡", styleClass: styles.tagFriction },
};

export interface ConvincerMeta {
  label: string;
  icon: string;
  strategy: string;
  color: string;
}

const CONVINCER_META: Record<string, ConvincerMeta> = {
  "Technical Excellence": {
    label: "Technical Excellence",
    icon: "⚙️",
    strategy: "Explain how the solution works using technical details, data, trade-offs, and objective evidence rather than promises or business rhetoric.",
    color: "#2563eb",
  },
  "Business Value": {
    label: "Business Value",
    icon: "📈",
    strategy: "Frame every proposal in terms of business impact, quantifiable benefits, strategic goals, and return on investment.",
    color: "#16a34a",
  },
  "Safety & Reliability": {
    label: "Safety & Reliability",
    icon: "🛡️",
    strategy: "Emphasize risk mitigation, safeguards, testing, compliance, SLAs, monitoring, and fallback plans to build confidence.",
    color: "#dc2626",
  },
  "Control & Governance": {
    label: "Control & Governance",
    icon: "🏛️",
    strategy: "Highlight governance structures, approval gates, reporting mechanisms, and how stakeholders retain visibility and control over the project.",
    color: "#9333ea",
  },
  "People & Trust": {
    label: "People & Trust",
    icon: "🤝",
    strategy: "Communicate openly, acknowledge concerns, demonstrate empathy, and build trust through transparency and collaboration rather than hard facts alone.",
    color: "#ea580c",
  },
  "Autonomy": {
    label: "Autonomy",
    icon: "🚀",
    strategy: "Present the proposal as empowering rather than restricting, emphasizing flexibility, delegated ownership, and local decision-making.",
    color: "#0284c7",
  },
  "Pragmatism": {
    label: "Pragmatism",
    icon: "⚡",
    strategy: "Focus on simple, actionable solutions with clear implementation steps, avoiding unnecessary complexity or overengineering.",
    color: "#d97706",
  },
};

const getConvincerMeta = (archetypeName?: string): ConvincerMeta | null => {
  if (!archetypeName) return null;
  const exact = CONVINCER_META[archetypeName];
  if (exact) return exact;
  const match = Object.keys(CONVINCER_META).find(
    (key) => key.toLowerCase() === archetypeName.toLowerCase()
  );
  if (match) return CONVINCER_META[match];
  return {
    label: archetypeName,
    icon: "🧠",
    strategy: "Focus communication on alignment with their key role and priorities.",
    color: "#475569",
  };
};

export default function StakeholderDossier({
  isOpen,
  onClose,
  dossierData,
  activeStakeholderId,
  currentPhase: propPhase,
  currentChallenge: propChallenge = 0,
  canClose = true,
  isEmbedded = false,
  emotionColors: propEmotionColors,
}: StakeholderDossierProps) {
  const { emit } = useGameWebSocket();
  const { stakeholders, emotionColors: contextEmotionColors } = useContext(StakeholderContext) || {
    stakeholders: {},
    emotionColors: {},
  };
  const activeEmotionColors = propEmotionColors || contextEmotionColors || {};
  const { metrics } = useContext(MetricsContext) || { metrics: {} };
  const { currentPhase: contextPhase } = useContext(PhasesContext) || { currentPhase: 0 };
  const currentPhase = propPhase ?? contextPhase ?? 0;
  const currentChallenge = propChallenge;

  const [activeRetagNoteId, setActiveRetagNoteId] = useState<string | null>(null);

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [nextPageIndex, setNextPageIndex] = useState(0);

  // 3D Two-Layer Page Flip animation state
  const [flippingState, setFlippingState] = useState<{
    fromIndex: number;
    toIndex: number;
    direction: "forward" | "backward";
  } | null>(null);

  const flippingStateRef = useRef(flippingState);
  flippingStateRef.current = flippingState;
  const flipTimeoutRef = useRef<number | null>(null);

  // Position state for window dragging
  const [position, setPosition] = useState({ x: 120, y: 60 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const prevDossierRef = useRef<StakeholderDossierEntry[]>(dossierData);
  const prevIsOpenRef = useRef<boolean>(isOpen);
  const prevActiveStIdRef = useRef<string | undefined>(activeStakeholderId);

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

  const totalPages = effectiveDossierData.length;

  const requestPageChange = (targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= totalPages) return;
    setNextPageIndex(targetIndex);
  };

  const completeFlip = (finishedIdx: number) => {
    if (flipTimeoutRef.current) {
      clearTimeout(flipTimeoutRef.current);
      flipTimeoutRef.current = null;
    }
    setCurrentPageIndex(finishedIdx);
    setFlippingState(null);
  };

  const handleAnimationEnd = (e: React.AnimationEvent) => {
    if (e.target !== e.currentTarget) return;
    if (flippingStateRef.current) {
      completeFlip(flippingStateRef.current.toIndex);
    }
  };

  // Animation scheduler:
  // While animation is playing, nothing happens.
  // When no animation is playing, automatically schedule a new animation if nextPageIndex !== currentPageIndex.
  useEffect(() => {
    if (!flippingState && nextPageIndex !== currentPageIndex) {
      if (nextPageIndex < 0 || nextPageIndex >= totalPages) return;
      const direction = nextPageIndex > currentPageIndex ? "forward" : "backward";

      setFlippingState({
        fromIndex: currentPageIndex,
        toIndex: nextPageIndex,
        direction,
      });

      // Fallback safety timeout in case onAnimationEnd doesn't fire
      flipTimeoutRef.current = window.setTimeout(() => {
        completeFlip(nextPageIndex);
      }, 660);
    }
  }, [flippingState, nextPageIndex, currentPageIndex, totalPages]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (flipTimeoutRef.current) {
        clearTimeout(flipTimeoutRef.current);
      }
    };
  }, []);

  // Auto-switch page when opened or when activeStakeholderId changes
  useEffect(() => {
    const justOpened = isOpen && !prevIsOpenRef.current;
    const activeStChanged = activeStakeholderId !== prevActiveStIdRef.current;

    if (isOpen && (justOpened || activeStChanged)) {
      if (activeStakeholderId) {
        const foundIdx = effectiveDossierData.findIndex(
          (st) =>
            st.stakeholder_id === activeStakeholderId ||
            st.name.toLowerCase() === activeStakeholderId.toLowerCase() ||
            st.name.toLowerCase().includes(activeStakeholderId.toLowerCase())
        );
        if (foundIdx !== -1) {
          if (justOpened) {
            setCurrentPageIndex(foundIdx);
            setNextPageIndex(foundIdx);
          } else if (activeStChanged) {
            requestPageChange(foundIdx);
          }
        }
      }
    }

    prevIsOpenRef.current = isOpen;
    prevActiveStIdRef.current = activeStakeholderId;
  }, [isOpen, activeStakeholderId, effectiveDossierData]);

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

  const renderRubberStamp = (conf: string) => {
    const lower = conf ? conf.toLowerCase() : "unconfirmed";
    if (lower === "verified") {
      return <div className={`${styles.rubberStamp} ${styles.stampVerified}`}>✓ VERIFIED</div>;
    }
    if (lower === "inferred") {
      return <div className={`${styles.rubberStamp} ${styles.stampInferred}`}>≈ INFERRED</div>;
    }
    return <div className={`${styles.rubberStamp} ${styles.stampUnconfirmed}`}>? UNCONFIRMED</div>;
  };

  const handleReTagIntel = (requirementId: string, newType: string) => {
    setActiveRetagNoteId(null);
    emit("intel:tag_item", {
      phase_id: currentPhase,
      challenge_id: currentChallenge,
      requirement_id: requirementId,
      categorized_type: newType,
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

  const renderPageContent = (st: StakeholderDossierEntry) => {
    if (!st) return null;

    const hasIntelEntries = st && st.intel_items && st.intel_items.length > 0;
    const stObj = stakeholders[st.stakeholder_id];
    const avatar = stObj?.avatar;
    const stakeholderColor = getStakeholderColor(st);
    const emotionDisplay = stObj?.emotional_state || stObj?.facial_expression || avatar?.face || "smile";
    const emotionColor =
      activeEmotionColors[emotionDisplay] ||
      activeEmotionColors[emotionDisplay.toLowerCase()] ||
      "#64748b";

    const convincerArchetypeName = st.convincer_archetype || stObj?.convincer_archetype;
    const convincerMeta = getConvincerMeta(convincerArchetypeName);

    return (
      <>
        {/* Header: Polaroid Snapshot Frame + Title */}
        <div className={styles.sketchbookHeader}>
          <div className={styles.polaroidFrame}>
            <div className={styles.sellotape} />
            <div className={styles.avatarBox}>
              <StakeholderAvatarComponent
                avatar={avatar}
                stakeholderColor={stakeholderColor}
                isFramed={false}
                play_blink_animation={false}
                size="100%"
                title={st.name}
              />
            </div>
          </div>

          <div className={styles.stakeholderMainInfo}>
            <h2 className={styles.stakeholderName}>
              <span
                className={styles.highlightMarker}
                style={{
                  background: `linear-gradient(180deg, transparent 48%, ${stakeholderColor}66 48%)`,
                }}
              >
                {st.name}
              </span>
            </h2>
            <div className={styles.stakeholderRole}>
              Role: {st.role_description || "Project Stakeholder"}
            </div>
            <div className="d-flex flex-wrap align-items-center gap-3">
              <div className={styles.stakeholderEmotion}>
                Emotional State:{" "}
                <span
                  style={{
                    color: emotionColor,
                    fontWeight: 700,
                  }}
                >
                  "{emotionDisplay}"
                </span>
              </div>
              <div className={styles.stakeholderPowerInterest}>
                <span>
                  Power:{" "}
                  <span
                    style={{
                      color: (st.power || stObj?.power || "").toLowerCase() === "high" ? "#dc2626" : "#2563eb",
                      fontWeight: 700,
                    }}
                  >
                    {(st.power || stObj?.power || "low").toUpperCase()}
                  </span>
                </span>
                <span style={{ margin: "0 4px", opacity: 0.5 }}>•</span>
                <span>
                  Interest:{" "}
                  <span
                    style={{
                      color: (st.interest || stObj?.interest || "").toLowerCase() === "high" ? "#dc2626" : "#2563eb",
                      fontWeight: 700,
                    }}
                  >
                    {(st.interest || stObj?.interest || "low").toUpperCase()}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Convincer Profile & Persuasion Strategy Card */}
        {convincerMeta && (
          <div className={styles.convincerCard}>
            <div className={styles.convincerCardHeader}>
              <span className={styles.convincerDoodleIcon}>🧠</span>
              <span>Convincer Archetype: </span>
              <strong style={{ color: convincerMeta.color }}>
                {convincerMeta.icon} {convincerMeta.label}
              </strong>
            </div>
            <div className={styles.convincerStrategyBody}>
              <span className={styles.strategyBulb}>💡</span>
              <span>
                <strong>Effective Communication Strategy:</strong> {convincerMeta.strategy}
              </span>
            </div>
          </div>
        )}

        {/* Intelligence Section Header */}
        <div className={styles.sectionTitle}>
          <span className={styles.doodleIcon}>✏️</span> Intelligence
        </div>

        {/* Sticky Notes Grid (Note-level intel type badge & re-tagging) */}
        {hasIntelEntries ? (
          <div className={styles.stickyNoteGrid}>
            {st.intel_items.map((item, idx) => {
              const typeKey = item.categorized_type || "requirement";
              const catMeta = CATEGORY_META[typeKey] || CATEGORY_META.requirement;
              const noteId = item.id || item.requirement_id || `note-${idx}`;
              const isUnconfirmed = (item.intel_type || "unconfirmed").toLowerCase() === "unconfirmed";
              const isRetagging = isUnconfirmed && activeRetagNoteId === noteId;

              return (
                <div
                  key={`${st.stakeholder_id}-${noteId}`}
                  className={`${styles.stickyNote} ${isRetagging ? styles.retagActive : ""}`}
                >
                  <div className={styles.paperclip} />

                  {/* Header Row: Intel Type Badge on sticky note (Clickable to Re-tag only if unconfirmed) */}
                  <div className={styles.noteTopBar}>
                    {isUnconfirmed ? (
                      <button
                        className={`${styles.categoryBadge} ${catMeta.styleClass}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveRetagNoteId(isRetagging ? null : noteId);
                        }}
                        title="Click to re-tag this intel item's category"
                      >
                        <span>{catMeta.icon} {catMeta.label}</span>
                        <span className={styles.reTagPrompt}>✏️ Re-tag</span>
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
                              handleReTagIntel(item.requirement_id, typeOptKey);
                            }}
                          >
                            {metaOpt.icon} {metaOpt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className={styles.intelBody}>
                    <div className={styles.stampFloat}>
                      {renderRubberStamp(item.intel_type)}
                    </div>
                    <div className={styles.intelText}>"{item.description}"</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyStateNote}>
            📝 <em>No intel collected for <strong>{st.name}</strong> yet!</em>
            <br />
            <span style={{ fontSize: "1.2rem", color: "#475569" }}>
              Tag interview notes & artifacts during the Intel Gathering phase to paste sticky notes here.
            </span>
          </div>
        )}
      </>
    );
  };

  const activeStakeholder = effectiveDossierData[currentPageIndex] || effectiveDossierData[0];

  // Determine base and flipping pages when animation is active
  let basePageEntry: StakeholderDossierEntry | null = activeStakeholder;
  let flippingPageEntry: StakeholderDossierEntry | null = null;
  let flippingAnimClass = "";

  if (flippingState) {
    if (flippingState.direction === "forward") {
      // Forward flip: target page rests underneath, current page flips left off the stack
      basePageEntry = effectiveDossierData[flippingState.toIndex];
      flippingPageEntry = effectiveDossierData[flippingState.fromIndex];
      flippingAnimClass = styles.flipForward;
    } else {
      // Backward flip: current page rests underneath, target page flips right back onto the stack
      basePageEntry = effectiveDossierData[flippingState.fromIndex];
      flippingPageEntry = effectiveDossierData[flippingState.toIndex];
      flippingAnimClass = styles.flipBackward;
    }
  }

  const activeDisplayIndex = nextPageIndex;

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
        {canClose && (
          <button className={styles.closeButton} onClick={onClose} title="Close Sketchbook">
            ✕
          </button>
        )}
      </div>

      {/* Physical Bookmark Tabs (Top Bar) */}
      {effectiveDossierData.length > 0 && (
        <div className={styles.tabsContainer}>
          {effectiveDossierData.map((st, idx) => {
            const stColor = getStakeholderColor(st);
            return (
              <button
                key={st.stakeholder_id || idx}
                className={`${styles.tabButton} ${idx === activeDisplayIndex ? styles.activeTab : ""}`}
                onClick={() => requestPageChange(idx)}
              >
                <span
                  className={styles.tabMarker}
                  style={{
                    background: `linear-gradient(180deg, transparent 50%, ${stColor}66 50%)`,
                  }}
                >
                  {st.name}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Notebook Binding Container with Left Spiral Rings */}
      <div className={styles.notebookBindingContainer}>
        {/* Left Wire Spiral Rings (12 rings) */}
        <div className={styles.spiralRings}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={styles.ringLoop} />
          ))}
        </div>

        {/* 3D Two-Layer Paper Flip Canvas */}
        <div className={styles.flipBookWrapper}>
          {/* Stationary Base Page Underneath */}
          <div className={styles.pageBase}>
            {renderPageContent(basePageEntry)}
          </div>

          {/* Flipping Top Page Layer (Rendered only when turning) */}
          {flippingState && flippingPageEntry && (
            <div
              key={`${flippingState.fromIndex}-${flippingState.toIndex}-${flippingState.direction}`}
              className={`${styles.pageFlipping} ${flippingAnimClass}`}
              onAnimationEnd={handleAnimationEnd}
            >
              {renderPageContent(flippingPageEntry)}
            </div>
          )}
        </div>
      </div>

      {/* Page Turning Footer Controls */}
      <div className={styles.pageFooter}>
        <button
          className={styles.navButton}
          disabled={activeDisplayIndex <= 0}
          onClick={() => requestPageChange(activeDisplayIndex - 1)}
        >
          ◀ Turn Page
        </button>
        <span className={styles.pageIndicator}>
          📖 Page {totalPages > 0 ? activeDisplayIndex + 1 : 0} of {totalPages} — Stakeholder Dossier
        </span>
        <button
          className={styles.navButton}
          disabled={activeDisplayIndex >= totalPages - 1}
          onClick={() => requestPageChange(activeDisplayIndex + 1)}
        >
          Next Page ▶
        </button>
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
