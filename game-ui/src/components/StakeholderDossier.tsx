import React, { useState, useRef, useEffect, useContext } from "react";
import styles from "./StakeholderDossier.module.css";
import { StakeholderContext } from "./StakeholderProvider";
import { MetricsContext } from "./MetricProvider";
import { PhasesContext } from "./PhaseProvider";

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
  intel_items: IntelEntry[];
}

interface StakeholderDossierProps {
  isOpen: boolean;
  onClose: () => void;
  dossierData: StakeholderDossierEntry[];
  activeStakeholderId?: string;
}

const CATEGORY_META: Record<string, { label: string; styleClass: string }> = {
  hard_constraint: { label: "📌 Hard Constraint", styleClass: styles.catHardConstraintMarker },
  requirement: { label: "📋 Core Requirement", styleClass: styles.catRequirementMarker },
  negotiable_preference: { label: "💬 Negotiable Preference", styleClass: styles.catNegotiableMarker },
  personal_friction: { label: "⚡ Personal Friction", styleClass: styles.catFrictionMarker },
};

export default function StakeholderDossier({
  isOpen,
  onClose,
  dossierData,
  activeStakeholderId,
}: StakeholderDossierProps) {
  const { stakeholders } = useContext(StakeholderContext) || { stakeholders: {} };
  const { metrics } = useContext(MetricsContext) || { metrics: {} };
  const { currentPhase } = useContext(PhasesContext) || { currentPhase: 0 };
  
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  
  // 3D Two-Layer Page Flip animation state
  const [flippingState, setFlippingState] = useState<{
    fromIndex: number;
    toIndex: number;
    direction: "forward" | "backward";
    isAnimating: boolean;
  } | null>(null);

  // Position state for window dragging
  const [position, setPosition] = useState({ x: 120, y: 60 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const prevDossierRef = useRef<StakeholderDossierEntry[]>(dossierData);

  // Derive active stakeholders
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
    intel_items: [],
  }));

  let effectiveDossierData: StakeholderDossierEntry[] = [];
  if (dossierData && dossierData.length > 0) {
    effectiveDossierData = dossierData;
  } else if (fallbackList.length > 0) {
    effectiveDossierData = fallbackList;
  } else {
    effectiveDossierData = Object.values(stakeholders || {}).map((st: any) => ({
      stakeholder_id: st.id || st.name,
      name: st.name || st.id,
      responsibilities: st.responsibilities || "",
      priorities: st.priorities || "",
      constraints: st.constraints || "",
      role_description: st.role_description || "Project Stakeholder",
      metric_id: st.metric_id || "",
      intel_items: [],
    }));
  }

  const totalPages = effectiveDossierData.length;

  const triggerPageFlip = (targetIndex: number) => {
    if (targetIndex === currentPageIndex || targetIndex < 0 || targetIndex >= totalPages) return;
    const direction = targetIndex > currentPageIndex ? "forward" : "backward";
    
    // Set initial animation state
    setFlippingState({
      fromIndex: currentPageIndex,
      toIndex: targetIndex,
      direction,
      isAnimating: false,
    });

    // Trigger transition on next animation frame
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFlippingState({
          fromIndex: currentPageIndex,
          toIndex: targetIndex,
          direction,
          isAnimating: true,
        });
      });
    });

    // Finalize state after CSS transition finishes (750ms)
    setTimeout(() => {
      setCurrentPageIndex(targetIndex);
      setFlippingState(null);
    }, 750);
  };

  // Auto-switch page when opened or when activeStakeholderId changes
  useEffect(() => {
    if (isOpen) {
      if (activeStakeholderId) {
        const foundIdx = effectiveDossierData.findIndex(
          (st) =>
            st.stakeholder_id === activeStakeholderId ||
            st.name.toLowerCase() === activeStakeholderId.toLowerCase() ||
            st.name.toLowerCase().includes(activeStakeholderId.toLowerCase())
        );
        if (foundIdx !== -1) {
          setCurrentPageIndex(foundIdx);
          return;
        }
      }
    }
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
          if (targetIdx !== -1 && targetIdx !== currentPageIndex) {
            triggerPageFlip(targetIdx);
          }
          break;
        }
      }
    }
    prevDossierRef.current = dossierData;
  }, [dossierData, effectiveDossierData, currentPageIndex]);

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
      return <div className={`${styles.rubberStamp} ${styles.stampVerified}`}>✓ VERIFIED INTEL</div>;
    }
    if (lower === "inferred") {
      return <div className={`${styles.rubberStamp} ${styles.stampInferred}`}>≈ INFERRED LOGIC</div>;
    }
    return <div className={`${styles.rubberStamp} ${styles.stampUnconfirmed}`}>? UNCONFIRMED RUMOR</div>;
  };

  const renderPageContent = (st: StakeholderDossierEntry) => {
    if (!st) return null;

    const groupedIntel: Record<string, IntelEntry[]> = {
      hard_constraint: [],
      requirement: [],
      negotiable_preference: [],
      personal_friction: [],
    };

    if (st && st.intel_items) {
      st.intel_items.forEach((item) => {
        const typeKey = item.categorized_type || "requirement";
        if (!groupedIntel[typeKey]) {
          groupedIntel[typeKey] = [];
        }
        groupedIntel[typeKey].push(item);
      });
    }

    const hasIntelEntries = st && st.intel_items && st.intel_items.length > 0;

    return (
      <>
        {/* Header: Polaroid Snapshot Frame + Title */}
        <div className={styles.sketchbookHeader}>
          <div className={styles.polaroidFrame}>
            <div className={styles.sellotape} />
            <div className={styles.avatarBox}>
              {st.name ? st.name.charAt(0) : "👤"}
            </div>
          </div>

          <div className={styles.stakeholderMainInfo}>
            <h2 className={styles.stakeholderName}>
              <span className={styles.highlightYellow}>{st.name}</span>
            </h2>
            <div className={styles.stakeholderRole}>
              <span className={styles.highlightRed}>
                Role: {st.role_description || "Project Stakeholder"}
              </span>
            </div>
          </div>
        </div>

        {/* Intelligence Section Header */}
        <div className={styles.sectionTitle}>
          <span className={styles.doodleIcon}>✏️</span> Intelligence & Sticky Notes
        </div>

        {/* Categorized Sticky Notes */}
        {hasIntelEntries ? (
          Object.keys(CATEGORY_META).map((catKey) => {
            const items = groupedIntel[catKey] || [];
            const catMeta = CATEGORY_META[catKey];

            if (items.length === 0) return null;

            return (
              <div key={catKey} className={styles.categoryGroup}>
                <div className={`${styles.categoryTagMarker} ${catMeta.styleClass}`}>
                  {catMeta.label} ({items.length})
                </div>
                <div className={styles.stickyNoteGrid}>
                  {items.map((item, idx) => (
                    <div
                      key={`${st.stakeholder_id}-${item.id || item.requirement_id || idx}-${items.length}`}
                      className={styles.stickyNote}
                    >
                      <div className={styles.paperclip} />
                      <div className={styles.intelText}>"{item.description}"</div>
                      <div className={styles.stampContainer}>
                        {renderRubberStamp(item.intel_type)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
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
      flippingAnimClass = flippingState.isAnimating ? styles.flipForwardEnd : styles.flipForwardStart;
    } else {
      // Backward flip: current page rests underneath, target page flips right back onto the stack
      basePageEntry = effectiveDossierData[flippingState.fromIndex];
      flippingPageEntry = effectiveDossierData[flippingState.toIndex];
      flippingAnimClass = flippingState.isAnimating ? styles.flipBackwardEnd : styles.flipBackwardStart;
    }
  }

  return (
    <div className={styles.dossierOverlay}>
      <div
        className={styles.sketchbookWindow}
        style={{
          top: `${Math.max(10, position.y)}px`,
          left: `${Math.max(10, position.x)}px`,
        }}
      >
        {/* Header Drag Handle */}
        <div className={styles.binderHeader} onMouseDown={handleMouseDown}>
          <div className={styles.binderTitle}>
            📓 STAKEHOLDER DOSSIER
          </div>
          <button className={styles.closeButton} onClick={onClose} title="Close Sketchbook">
            ✕
          </button>
        </div>

        {/* Physical Bookmark Tabs (Top Bar) */}
        {effectiveDossierData.length > 0 && (
          <div className={styles.tabsContainer}>
            {effectiveDossierData.map((st, idx) => (
              <button
                key={st.stakeholder_id || idx}
                className={`${styles.tabButton} ${
                  idx === (flippingState ? flippingState.toIndex : currentPageIndex) ? styles.activeTab : ""
                }`}
                onClick={() => triggerPageFlip(idx)}
              >
                {st.name}
              </button>
            ))}
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
              <div className={`${styles.pageFlipping} ${flippingAnimClass}`}>
                {renderPageContent(flippingPageEntry)}
              </div>
            )}
          </div>
        </div>

        {/* Page Turning Footer Controls */}
        <div className={styles.pageFooter}>
          <button
            className={styles.navButton}
            disabled={currentPageIndex <= 0}
            onClick={() => triggerPageFlip(currentPageIndex - 1)}
          >
            ◀ Turn Page
          </button>
          <span className={styles.pageIndicator}>
            📖 Page {totalPages > 0 ? (flippingState ? flippingState.toIndex + 1 : currentPageIndex + 1) : 0} of {totalPages} — Stakeholder Dossier
          </span>
          <button
            className={styles.navButton}
            disabled={currentPageIndex >= totalPages - 1}
            onClick={() => triggerPageFlip(currentPageIndex + 1)}
          >
            Next Page ▶
          </button>
        </div>
      </div>
    </div>
  );
}
