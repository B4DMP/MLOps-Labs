import React, { useState, useRef, useEffect, useContext } from "react";
import { Icon } from "@iconify/react";
import styles from "./StakeholderDossier.module.css";
import { StakeholderContext } from "./StakeholderProvider";
export type { ConvincerProfileConfig } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import { PhasesContext } from "./PhaseProvider";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";

export interface IntelEntry {
  id: string;
  requirement_id?: string;
  intel_type: string; // e.g. "unconfirmed", "verified"
  categorized_type: string; // e.g. "hard_constraint", "requirement", "negotiable_preference", "personal_friction"
  description: string;
  is_correct?: boolean;
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
}

const CATEGORY_META: Record<string, { label: string; icon: string; styleClass: string }> = {
  requirement: { label: "Core Requirement", icon: "📋", styleClass: styles.tagRequirement },
  negotiable_preference: { label: "Negotiable Preference", icon: "💬", styleClass: styles.tagNegotiable },
  personal_friction: { label: "Personal Friction", icon: "⚡", styleClass: styles.tagFriction },
};

const getEmotionIcon = (emotionStr: string): string => {
  const lower = (emotionStr || "neutral").toLowerCase();
  if (
    lower.includes("positive") ||
    lower.includes("happy") ||
    lower.includes("supportive") ||
    lower.includes("enthusiastic") ||
    lower.includes("relieved")
  ) {
    return "ph:smiley-bold";
  }
  if (
    lower.includes("negative") ||
    lower.includes("angry") ||
    lower.includes("frustrated") ||
    lower.includes("skeptical") ||
    lower.includes("anxious") ||
    lower.includes("overwhelmed")
  ) {
    return "ph:smiley-sad-bold";
  }
  return "ph:smiley-meh-bold";
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
}: StakeholderDossierProps) {
  const { emit } = useGameWebSocket();
  const { stakeholders, emotionColors: contextEmotionColors, convincerArchetypes: contextConvincerArchetypes } = useContext(StakeholderContext) || {
    stakeholders: {},
    emotionColors: {},
    convincerArchetypes: {},
  };
  const activeEmotionColors = propEmotionColors || contextEmotionColors || {};
  const activeConvincerArchetypes = propConvincerArchetypes || contextConvincerArchetypes || {};
  const { metrics } = useContext(MetricsContext) || { metrics: {} };
  const { currentPhase: contextPhase } = useContext(PhasesContext) || { currentPhase: 0 };
  const currentPhase = propPhase ?? contextPhase ?? 0;
  const currentChallenge = propChallenge;

  const [activeRetagNoteId, setActiveRetagNoteId] = useState<string | null>(null);
  const [isRetaggingConvincer, setIsRetaggingConvincer] = useState<boolean>(false);
  const [hoveredPolaroidStId, setHoveredPolaroidStId] = useState<string | null>(null);

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

  // Intel items that arrived but have not yet played their "appear" animation
  const [newIntelIds, setNewIntelIds] = useState<Set<string>>(new Set());
  const seenIntelIdsRef = useRef<Set<string> | null>(null);
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

  const totalPages = effectiveDossierData.length;

  const requestPageChange = (targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= totalPages) return;
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

  // Flag intel items that were not present on the previous dossier payload
  useEffect(() => {
    const currentIds = new Set<string>();
    for (const st of effectiveDossierData) {
      for (const item of st.intel_items || []) {
        if (item.id) currentIds.add(`${st.stakeholder_id}-${item.id}`);
      }
    }

    // First payload establishes the baseline - nothing is "new" on initial load
    if (seenIntelIdsRef.current === null) {
      seenIntelIdsRef.current = currentIds;
      return;
    }

    const seen = seenIntelIdsRef.current;
    const added = new Set([...currentIds].filter((id) => !seen.has(id)));
    seenIntelIdsRef.current = new Set([...seen, ...currentIds]);

    if (added.size === 0) return;

    setNewIntelIds((prev) => new Set([...prev, ...added]));
  }, [effectiveDossierData]);

  // Consume the "new" flag only while the item's own page is on screen. Tagging an
  // artifact during offline intel gathering flips the dossier to the next artifact's
  // stakeholder almost immediately, so a flag consumed on a timer alone would be spent
  // while the note is off-screen. Pending flags survive until that tab is visited.
  useEffect(() => {
    if (newIntelIds.size === 0) return;

    const visibleSt = effectiveDossierData[currentPageIndex];
    if (!visibleSt) return;

    const playingIds = (visibleSt.intel_items || [])
      .map((item) => `${visibleSt.stakeholder_id}-${item.id}`)
      .filter((key) => newIntelIds.has(key));
    if (playingIds.length === 0) return;

    // Leaving the page before this fires cancels it, so the animation replays on return
    const timer = setTimeout(() => {
      setNewIntelIds((prev) => {
        const next = new Set(prev);
        playingIds.forEach((key) => next.delete(key));
        return next;
      });
    }, 1000); // slightly longer than the newIntelDrop animation

    return () => clearTimeout(timer);
  }, [newIntelIds, currentPageIndex, effectiveDossierData]);

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
      return (
        <div
          className={`${styles.rubberStamp} ${styles.stampVerified}`}
          title="Verified Intelligence: This stance or archetype has been confirmed through stakeholder interaction."
        >
          ✓ VERIFIED
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

  const renderPageContent = (st: StakeholderDossierEntry) => {
    if (!st) return null;

    const hasIntelEntries = st && st.intel_items && st.intel_items.length > 0;
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

    return (
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
                stakeholderColor={stakeholderColor}
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
              <strong className={styles.fieldLabel}>Role:</strong> {st.role_description || "Project Stakeholder"}
            </div>
            <div className={styles.stakeholderMetaRow}>
              <div
                className={styles.powerInterestBadge}
                title={`Emotional State: "${emotionDisplay}"`}
              >
                <Icon
                  icon={getEmotionIcon(emotionDisplay)}
                  className={styles.metricIcon}
                  style={{ color: emotionColor }}
                />
                <span style={{ color: emotionColor, fontWeight: 700 }}>
                  {emotionDisplay.toUpperCase()}
                </span>
              </div>
              <div
                className={styles.powerInterestBadge}
                title={`Power: ${(st.power || stObj?.power || "low").toUpperCase()} (Organizational authority & influence)`}
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
                title={`Interest: ${(st.interest || stObj?.interest || "low").toUpperCase()} (Stakeholder engagement & active interest)`}
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
            </div>
          </div>
        </div>

        {/* Convincer Profile & Persuasion Strategy Card */}
        {convincerArchetypeName ? (
          <div className={`${styles.convincerCard} ${isRetaggingConvincer ? styles.retagActive : ""}`}>
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
                    <strong>Strategy:</strong> {convincerProfileConfig.strategy}
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

        {/* Intelligence Section Header */}
        <div className={styles.sectionTitle}>
          <span className={styles.doodleIcon}></span> Challenge-Specific Stance
        </div>

        {/* Sticky Notes Grid (Note-level intel type badge & re-tagging) */}
        {hasIntelEntries ? (
          <div className={styles.stickyNoteGrid}>
            {st.intel_items.map((item, idx) => {
              const typeKey = item.categorized_type || "requirement";
              const catMeta = CATEGORY_META[typeKey] || CATEGORY_META.requirement;
              const noteId = item.id || `note-${idx}`;
              const isUnconfirmed = (item.intel_type || "unconfirmed").toLowerCase() === "unconfirmed";
              const isRetagging = isUnconfirmed && activeRetagNoteId === noteId;
              const isHighlighted = Boolean(
                highlightedIntelId &&
                (noteId === highlightedIntelId ||
                  item.id === highlightedIntelId ||
                  (item.description && item.description === highlightedIntelId))
              );
              const isNewIntel = newIntelIds.has(`${st.stakeholder_id}-${item.id}`);
              const isFadingOut = Boolean(
                !isHighlighted &&
                fadingOutIntelId &&
                (noteId === fadingOutIntelId ||
                  item.id === fadingOutIntelId ||
                  (item.description && item.description === fadingOutIntelId))
              );

              return (
                <div
                  key={`${st.stakeholder_id}-${noteId}`}
                  id={`intel-sticky-${noteId}`}
                  data-intel-id={item.id}
                  data-intel-description={item.description}
                  className={`${styles.stickyNote} ${isRetagging ? styles.retagActive : ""} ${isHighlighted ? styles.highlightedStickyNote : ""} ${isFadingOut ? styles.fadingOutStickyNote : ""} ${isNewIntel ? styles.newStickyNote : ""}`}
                >
                  <div className={styles.paperclip} />

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
                      {renderRubberStamp(item.intel_type)}
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

                  <div className={styles.intelBody}>
                    <div className={styles.intelText}>"{item.description}"</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyStateContainer}>
            <div className={styles.emptyStateCard}>
              <div className={styles.paperclip} />
              <div className={styles.emptyStateTitle}>
                📋 No Field Intelligence Collected Yet
              </div>
              <div className={styles.emptyStateText}>
                No interview notes, requirements, or personal stances recorded for <strong>{st.name}</strong>.
              </div>
              <div className={styles.emptyStateHint}>
                💡 <em>Participate in Intel Gathering activities to uncover and verify their hidden constraints.</em>
              </div>
            </div>
          </div>
        )}
      </>
    );
  };

  const activeStakeholder = effectiveDossierData[currentPageIndex] || effectiveDossierData[0];

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
            const stColor = getStakeholderColor(st);
            const stObj = stakeholders[st.stakeholder_id];
            const emotion = stObj?.emotional_state || "neutral";
            const emotionColor =
              activeEmotionColors[emotion] ||
              activeEmotionColors[emotion.toLowerCase()] ||
              "#64748b";
            const isActive = idx === currentPageIndex;

            return (
              <button
                key={st.stakeholder_id || idx}
                ref={idx === currentPageIndex ? activeTabRef : null}
                className={`${styles.tabButton} ${isActive ? styles.activeTab : ""}`}
                onClick={() => requestPageChange(idx)}
                title={`${st.name} (Emotional State: ${emotion})`}
                style={
                  {
                    "--tab-color": stColor,
                    "--emotion-color": emotionColor,
                  } as React.CSSProperties
                }
              >
                <span className={styles.tabName}>{st.name}</span>
                <div
                  className={styles.tabEmotionRow}
                  title={`Emotional State: ${emotion}`}
                >
                  <Icon
                    icon={getEmotionIcon(emotion)}
                    className={styles.tabEmotionIcon}
                  />
                  <span className={styles.tabEmotionLabel}>
                    {emotion}
                  </span>
                </div>
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

        {/* Paper Canvas */}
        <div className={styles.flipBookWrapper}>
          <div className={styles.pageBase} key={currentPageIndex}>
            {renderPageContent(activeStakeholder)}
          </div>
        </div>
      </div>

      {/* Page Turning Footer Controls & Intel Counter */}
      <div className={styles.pageFooter}>
        <span className={styles.pageIndicator}>
          📖 Page {totalPages > 0 ? currentPageIndex + 1 : 0} of {totalPages}
        </span>
        <span className={styles.intelCounter}>
          📌 Intel Collected: {activeStakeholder?.intel_items?.length || 0}
          {activeStakeholder?.intel_items && activeStakeholder.intel_items.length > 0
            ? ` (${activeStakeholder.intel_items.filter((item: IntelEntry) => item.intel_type?.toLowerCase() === "verified").length} verified)`
            : ""}
        </span>
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
