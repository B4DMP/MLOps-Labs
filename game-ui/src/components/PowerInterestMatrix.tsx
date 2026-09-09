import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import styles from "./PowerInterestMatrix.module.css";
import { StakeholderContext } from "./StakeholderProvider";
import type { PhaseStakeholderEntry } from "./PhaseProvider";
import { StakeholderAvatarComponent } from "./StakeholderAvatarComponent";
import HoverTooltip from "./HoverToolTip";

interface PowerInterestMatrixProps {
  currentStakeholders: PhaseStakeholderEntry[];
  previousStakeholders?: PhaseStakeholderEntry[];
  isFirstPhase?: boolean;
  /**
   * Layer the introduction speech bubbles are portaled into. Must be an element
   * that is not transformed and does not clip its overflow, otherwise the bubble
   * is positioned against that ancestor instead of the viewport and gets cut off.
   * Falls back to `document.body`.
   */
  bubblePortalTarget?: HTMLElement | null;
}

type QuadrantKey = "high-low" | "high-high" | "low-low" | "low-high";

interface QuadrantConfig {
  key: QuadrantKey;
  title: string;
  axisLabel: string;
  cardStyle: string;
  icon: string;
  iconColor: string;
}

const QUADRANTS: QuadrantConfig[] = [
  {
    key: "high-low",
    title: "Keep Satisfied",
    axisLabel: "High Power | Low Interest",
    cardStyle: styles.sectorTopLeft,
    icon: "ph:warning-circle-bold",
    iconColor: "#f97316",
  },
  {
    key: "high-high",
    title: "Manage Closely",
    axisLabel: "High Power | High Interest",
    cardStyle: styles.sectorTopRight,
    icon: "ph:star-bold",
    iconColor: "#ef4444",
  },
  {
    key: "low-low",
    title: "Monitor",
    axisLabel: "Low Power | Low Interest",
    cardStyle: styles.sectorBottomLeft,
    icon: "ph:eye-bold",
    iconColor: "#94a3b8",
  },
  {
    key: "low-high",
    title: "Keep Informed",
    axisLabel: "Low Power | High Interest",
    cardStyle: styles.sectorBottomRight,
    icon: "ph:info-bold",
    iconColor: "#38bdf8",
  },
];

/**
 * Stable pseudo-random animation delay per stakeholder, so the NEW / SHIFTED
 * badges pulse out of step with each other instead of beating in unison.
 */
function badgePulseDelay(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return `${((hash % 1900) / 1000).toFixed(2)}s`;
}

function formatNameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export default function PowerInterestMatrix({
  currentStakeholders = [],
  previousStakeholders = [],
  isFirstPhase = false,
  bubblePortalTarget = null,
}: PowerInterestMatrixProps) {
  const { stakeholders } = useContext(StakeholderContext);

  const { categorizedNodes, dynamicsItems } = useMemo(() => {
    const prevMap = new Map<string, PhaseStakeholderEntry>();
    previousStakeholders.forEach((ps) => prevMap.set(ps.stakeholder_id, ps));

    const currMap = new Map<string, PhaseStakeholderEntry>();
    currentStakeholders.forEach((cs) => currMap.set(cs.stakeholder_id, cs));

    const joinedNames: string[] = [];
    const leftNames: string[] = [];
    const shiftedSummaries: string[] = [];

    if (!isFirstPhase) {
      currentStakeholders.forEach((cs) => {
        if (!prevMap.has(cs.stakeholder_id)) {
          const st = stakeholders[cs.stakeholder_id];
          joinedNames.push(st?.name || cs.stakeholder_id);
        }
      });

      previousStakeholders.forEach((ps) => {
        if (!currMap.has(ps.stakeholder_id)) {
          const st = stakeholders[ps.stakeholder_id];
          leftNames.push(st?.name || ps.stakeholder_id);
        }
      });
    }

    const categorized: Record<QuadrantKey, any[]> = {
      "high-low": [],
      "high-high": [],
      "low-low": [],
      "low-high": [],
    };

    currentStakeholders.forEach((cs) => {
      const p = (cs.power || "low").toLowerCase();
      const i = (cs.interest || "low").toLowerCase();
      const quadKey: QuadrantKey = `${p}-${i}` as QuadrantKey;

      const prev = prevMap.get(cs.stakeholder_id);
      const isNew = !prev;
      const isShifted =
        prev != null &&
        (prev.power.toLowerCase() !== p || prev.interest.toLowerCase() !== i);

      const st = stakeholders[cs.stakeholder_id];
      const stName = st?.name || cs.stakeholder_id;

      if (isShifted) {
        const prevP = prev?.power.toUpperCase();
        const currP = cs.power.toUpperCase();
        const prevI = prev?.interest.toUpperCase();
        const currI = cs.interest.toUpperCase();

        const changes: string[] = [];
        if (prevP !== currP) changes.push(`Power: ${prevP} ➔ ${currP}`);
        if (prevI !== currI) changes.push(`Interest: ${prevI} ➔ ${currI}`);
        shiftedSummaries.push(`${stName} (${changes.join(", ")})`);
      }

      const nodeData = {
        stakeholderId: cs.stakeholder_id,
        currPower: cs.power,
        currInterest: cs.interest,
        prevPower: prev?.power,
        prevInterest: prev?.interest,
        isNew,
        isShifted,
        st,
      };

      if (categorized[quadKey]) {
        categorized[quadKey].push(nodeData);
      } else {
        categorized["low-low"].push(nodeData);
      }
    });

    const dynamicItems: { id: string; icon: string; text: string }[] = [];

    if (isFirstPhase) {
      dynamicItems.push({
        id: "initial",
        icon: "ph:flag-checkered-bold",
        text: "Project kickoff: Initial stakeholder positions established.",
      });
    } else {
      if (joinedNames.length > 0 && leftNames.length > 0) {
        dynamicItems.push({
          id: "replacement",
          icon: "ph:arrows-left-right-bold",
          text: `${formatNameList(joinedNames)} replaced ${formatNameList(leftNames)}`,
        });
      } else if (joinedNames.length > 0) {
        dynamicItems.push({
          id: "joined",
          icon: "ph:user-plus-bold",
          text: `${formatNameList(joinedNames)} joined the active phase`,
        });
      } else if (leftNames.length > 0) {
        dynamicItems.push({
          id: "left",
          icon: "ph:user-minus-bold",
          text: `${formatNameList(leftNames)} stepped back from this phase`,
        });
      }

      shiftedSummaries.forEach((shift, idx) => {
        dynamicItems.push({
          id: `shift-${idx}`,
          icon: "ph:trend-up-bold",
          text: shift,
        });
      });

      if (dynamicItems.length === 0) {
        dynamicItems.push({
          id: "none",
          icon: "ph:check-circle-bold",
          text: "All stakeholders maintain their previous power & interest levels.",
        });
      }
    }

    return {
      categorizedNodes: categorized,
      dynamicsItems: dynamicItems,
    };
  }, [currentStakeholders, previousStakeholders, isFirstPhase, stakeholders]);

  // Everyone on the radar who has something to say. Collected in grid reading order
  // so the bubble travels predictably instead of hopping around the quadrants.
  const { introsById, introQueue } = useMemo(() => {
    const byId = new Map<string, { name: string; color: string; message: string }>();
    const queue: string[] = [];
    QUADRANTS.forEach((quad) => {
      (categorizedNodes[quad.key] || []).forEach((item: any) => {
        const message = item.st?.introduction;
        if (!message) return;
        byId.set(item.stakeholderId, {
          name: item.st?.name || item.stakeholderId,
          color: item.st?.stakeholder_color || "#3b82f6",
          message,
        });
        // Only newcomers introduce themselves on their own. On the first phase the
        // whole cast counts as new, so the full round plays at project kickoff.
        if (item.isNew) queue.push(item.stakeholderId);
      });
    });
    return { introsById: byId, introQueue: queue };
  }, [categorizedNodes]);

  const introQueueKey = introQueue.join("|");

  const [introState, setIntroState] = useState<{
    stakeholderId: string;
    queueIndex: number | null;
    isClosing: boolean;
    nonce: number;
  } | null>(() =>
    introQueue.length > 0
      ? { stakeholderId: introQueue[0], queueIndex: 0, isClosing: false, nonce: 0 }
      : null
  );
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Set once the player dismisses the round with the close button: no further
  // bubbles play on their own, though clicking a chip still replays that one.
  const [introStopped, setIntroStopped] = useState(false);

  const clearIntroTimers = () => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    fadeTimerRef.current = null;
    advanceTimerRef.current = null;
  };

  const advanceIntro = useCallback(() => {
    clearIntroTimers();
    setIntroState((prev) => {
      if (!prev) return null;
      // A bubble opened by clicking a chip ends there; one from the opening round
      // hands over to the next newcomer.
      if (prev.queueIndex === null) return null;
      const next = prev.queueIndex + 1;
      return next < introQueue.length
        ? {
            stakeholderId: introQueue[next],
            queueIndex: next,
            isClosing: false,
            nonce: prev.nonce + 1,
          }
        : null;
    });
  }, [introQueue]);

  // Clicking a stakeholder replays their introduction, during or after the round.
  // Anyone with an introduction can be replayed, not just this phase's newcomers.
  const playIntroFor = useCallback(
    (stakeholderId: string) => {
      if (!introsById.has(stakeholderId)) return;
      clearIntroTimers();
      const queueIndex = introQueue.indexOf(stakeholderId);
      setIntroState((prev) => ({
        stakeholderId,
        queueIndex: queueIndex >= 0 ? queueIndex : null,
        isClosing: false,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
    },
    [introsById, introQueue]
  );

  const stopIntros = () => {
    clearIntroTimers();
    setIntroStopped(true);
    setIntroState(null);
  };

  // (Re)start the round of introductions whenever the set of newcomers changes
  useEffect(() => {
    clearIntroTimers();
    setIntroStopped(false);
    setIntroState(
      introQueue.length > 0
        ? { stakeholderId: introQueue[0], queueIndex: 0, isClosing: false, nonce: 0 }
        : null
    );
  }, [introQueueKey]);

  // Hold each bubble long enough to read it, fade out, then hand over to the next speaker
  useEffect(() => {
    if (!introState) return;
    const message = introsById.get(introState.stakeholderId)?.message || "";
    const durationMs = Math.min(9000, Math.max(4000, Math.round(message.length * 55)));
    fadeTimerRef.current = setTimeout(() => {
      setIntroState((prev) => (prev ? { ...prev, isClosing: true } : null));
    }, Math.max(0, durationMs - 400));
    advanceTimerRef.current = setTimeout(advanceIntro, durationMs);
    return clearIntroTimers;
  }, [introState?.stakeholderId, introState?.nonce, advanceIntro]);

  const activeIntroDetails = introState ? introsById.get(introState.stakeholderId) : undefined;
  const activeIntro =
    introState && activeIntroDetails
      ? { stakeholderId: introState.stakeholderId, ...activeIntroDetails }
      : null;

  // Anchor the bubble to the speaker's chip. The radar clips its own overflow, so the
  // bubble is positioned fixed against the viewport instead of nested in the quadrant.
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const [bubbleAnchor, setBubbleAnchor] = useState<{
    left: number;
    width: number;
    arrowX: number;
    top: number;
    bottom: number;
    placeBelow: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    if (!activeIntro) {
      setBubbleAnchor(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      const el = itemRefs.current.get(activeIntro.stakeholderId);
      if (el) {
        const rect = el.getBoundingClientRect();
        const width = Math.min(340, window.innerWidth - 24);
        const anchorX = rect.left + rect.width / 2;
        const left = Math.max(12, Math.min(anchorX - width / 2, window.innerWidth - width - 12));
        const next = {
          left,
          width,
          arrowX: anchorX - left,
          top: rect.top,
          bottom: rect.bottom,
          placeBelow: rect.top < 170,
        };
        setBubbleAnchor((prev) =>
          prev &&
          prev.left === next.left &&
          prev.width === next.width &&
          prev.arrowX === next.arrowX &&
          prev.top === next.top &&
          prev.bottom === next.bottom &&
          prev.placeBelow === next.placeBelow
            ? prev
            : next
        );
      }
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [activeIntro?.stakeholderId]);

  const replayIntros = () => {
    if (introQueue.length === 0) return;
    clearIntroTimers();
    setIntroStopped(false);
    setIntroState((prev) => ({
      stakeholderId: introQueue[0],
      queueIndex: 0,
      isClosing: false,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  };

  return (
    <div className={styles.matrixContainer}>
      {/* Dynamics Telemetry Strip */}
      <div className={styles.summaryBanner}>
        <div className={styles.summaryLabel}>
          <Icon icon="ph:arrows-clockwise-bold" className={styles.summaryBannerIcon} />
          <span>Phase Dynamics:</span>
        </div>
        <div className={styles.dynamicsList}>
          {dynamicsItems.map((item) => (
            <div key={item.id} className={styles.dynamicChip}>
              <Icon icon={item.icon} className={styles.dynamicChipIcon} />
              <span>{item.text}</span>
            </div>
          ))}
        </div>
        {introQueue.length > 0 && (
          <button
            type="button"
            className={styles.introReplayBtn}
            onClick={replayIntros}
            disabled={Boolean(activeIntro)}
            title={
              activeIntro
                ? "Stakeholders are introducing themselves"
                : introStopped
                ? "Play the stakeholder introductions again"
                : "Replay the stakeholder introductions"
            }
          >
            <Icon icon="ph:chat-teardrop-text-bold" className={styles.dynamicChipIcon} />
            <span>{activeIntro ? "Introducing..." : "Replay intros"}</span>
          </button>
        )}
      </div>

      {/* Matrix Coordinate Wrapper with Vertical Power Axis & Horizontal Interest Axis */}
      <div className={styles.matrixWrapper}>
        {/* Left Vertical Axis: Power */}
        <div className={styles.yAxis}>
          <div className={styles.axisLineY}>
            <Icon icon="ph:arrow-up-bold" className={styles.axisArrowIcon} />
            <span className={styles.axisLabelTextY}>Power</span>
          </div>
        </div>

        {/* Main Content: Unified 2x2 Radar Grid + Bottom Horizontal Axis: Interest */}
        <div className={styles.matrixMain}>
          {/* Unified 2x2 Radar Grid */}
          <div className={styles.radarGrid}>
            {QUADRANTS.map((quad) => {
              const items = categorizedNodes[quad.key] || [];

              return (
                <div key={quad.key} className={`${styles.sectorQuadrant} ${quad.cardStyle}`}>
                  <div className={styles.sectorHeader}>
                    <span className={styles.sectorTitle}>
                      <Icon icon={quad.icon} className={styles.sectorIcon} style={{ color: quad.iconColor }} />
                      {quad.title}
                    </span>
                    <span className={styles.sectorAxisBadge}>
                      <Icon
                        icon="ph:lightning-fill"
                        className={styles.axisBadgeIcon}
                        style={{ color: quad.key.startsWith("high") ? "#f87171" : "#60a5fa" }}
                      />
                      <span>{quad.key.startsWith("high") ? "High" : "Low"} Power</span>
                      <Icon
                        icon="ph:eye-fill"
                        className={`${styles.axisBadgeIcon} ${styles.axisBadgeIconSecond}`}
                        style={{ color: quad.key.endsWith("high") ? "#f87171" : "#60a5fa" }}
                      />
                      <span>{quad.key.endsWith("high") ? "High" : "Low"} Interest</span>
                    </span>
                  </div>

                  <div className={styles.stakeholderList}>
                    {items.length === 0 ? (
                      <div className={styles.emptySector}>No active stakeholders in sector</div>
                    ) : (
                      items.map((item) => {
                        const st = item.st;
                        const stName = st?.name || item.stakeholderId;
                        const stColor = st?.stakeholder_color || "#3b82f6";
                        const roleDesc = st?.role_description || "Project Stakeholder";

                        const isHighPower = (item.currPower || "").toLowerCase() === "high";
                        const isHighInterest = (item.currInterest || "").toLowerCase() === "high";
                        const keyPlayerHint = [
                          isHighPower ? "⚡ High power: strong authority" : null,
                          isHighInterest ? "👁 High interest: closely engaged" : null,
                        ]
                          .filter(Boolean)
                          .join("\n");

                        let shiftText = "";
                        if (item.isShifted) {
                          const prevP = item.prevPower?.toUpperCase();
                          const currP = item.currPower.toUpperCase();
                          const prevI = item.prevInterest?.toUpperCase();
                          const currI = item.currInterest.toUpperCase();
                          const parts: string[] = [];
                          if (prevP !== currP) parts.push(`Power: ${prevP} ➔ ${currP}`);
                          if (prevI !== currI) parts.push(`Interest: ${prevI} ➔ ${currI}`);
                          shiftText = parts.join(", ");
                        }

                        return (
                          <HoverTooltip
                            key={item.stakeholderId}
                            portalTarget={bubblePortalTarget}
                            description={[
                              `${stName}`,
                              roleDesc,
                              shiftText ? `↕ ${shiftText}` : null,
                              keyPlayerHint || null,
                            ]
                              .filter(Boolean)
                              .join("\n\n")}
                          >
                            <div
                              ref={(el) => {
                                if (el) itemRefs.current.set(item.stakeholderId, el);
                                else itemRefs.current.delete(item.stakeholderId);
                              }}
                              className={`${styles.stakeholderItem} ${
                                introsById.has(item.stakeholderId)
                                  ? styles.stakeholderItemReplayable
                                  : ""
                              } ${
                                activeIntro?.stakeholderId === item.stakeholderId
                                  ? styles.stakeholderItemSpeaking
                                  : ""
                              }`}
                              style={
                                {
                                  "--stakeholder-color": stColor,
                                } as React.CSSProperties
                              }
                              role={introsById.has(item.stakeholderId) ? "button" : undefined}
                              tabIndex={introsById.has(item.stakeholderId) ? 0 : undefined}
                              onClick={() => playIntroFor(item.stakeholderId)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  playIntroFor(item.stakeholderId);
                                }
                              }}
                            >
                              <div className={styles.stakeholderLeft}>
                                <div
                                  className={`${styles.avatarWrapper} ${
                                    activeIntro?.stakeholderId === item.stakeholderId
                                      ? styles.avatarWrapperSpeaking
                                      : ""
                                  }`}
                                  style={{ borderColor: stColor }}
                                >
                                  {st?.avatar ? (
                                    <StakeholderAvatarComponent
                                      avatar={st.avatar}
                                      stakeholderColor={stColor}
                                      isFramed={false}
                                      isSpeaking={activeIntro?.stakeholderId === item.stakeholderId}
                                      play_blink_animation={
                                        activeIntro?.stakeholderId === item.stakeholderId
                                      }
                                      size="100%"
                                    />
                                  ) : (
                                    <Icon icon="ph:user-bold" style={{ color: stColor }} />
                                  )}
                                </div>
                                <div className={styles.stakeholderMeta}>
                                  <span className={styles.stakeholderNameRow}>
                                    <span className={styles.stakeholderName}>{stName}</span>
                                    {isHighPower && (
                                      <span className={styles.keyFlag}>
                                        <Icon icon="ph:lightning-fill" />
                                      </span>
                                    )}
                                    {isHighInterest && (
                                      <span className={styles.keyFlag}>
                                        <Icon icon="ph:eye-fill" />
                                      </span>
                                    )}
                                  </span>
                                  {roleDesc && (
                                    <span className={styles.stakeholderDescription}>{roleDesc}</span>
                                  )}
                                </div>
                              </div>

                              <div className={styles.badgeContainer}>
                                {item.isNew && (
                                  <span
                                    className={styles.badgeNew}
                                    style={{ animationDelay: badgePulseDelay(item.stakeholderId) }}
                                  >
                                    <Icon icon="ph:plus-bold" /> NEW
                                  </span>
                                )}
                                {item.isShifted && (
                                  <span
                                    className={styles.badgeShifted}
                                    style={{
                                      animationDelay: badgePulseDelay(`${item.stakeholderId}-shift`),
                                    }}
                                  >
                                    <Icon icon="ph:trend-up-bold" /> SHIFTED
                                  </span>
                                )}
                              </div>
                            </div>
                          </HoverTooltip>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom Horizontal Axis: Interest */}
          <div className={styles.xAxis}>
            <div className={styles.axisLineX}>
              <span className={styles.axisLabelTextX}>Interest</span>
              <Icon icon="ph:arrow-right-bold" className={styles.axisArrowIcon} />
            </div>
          </div>
        </div>
      </div>

      {/* Self-introduction speech bubble, anchored to the speaking stakeholder's chip */}
      {activeIntro && bubbleAnchor && createPortal(
        <div
          className={`${styles.introBubble} ${
            bubbleAnchor.placeBelow ? styles.introBubbleBelow : ""
          } ${introState?.isClosing ? styles.introBubbleClosing : ""}`}
          style={{
            left: bubbleAnchor.left,
            width: bubbleAnchor.width,
            ...(bubbleAnchor.placeBelow
              ? { top: bubbleAnchor.bottom + 10 }
              : { bottom: window.innerHeight - bubbleAnchor.top + 10 }),
            // @ts-ignore custom properties drive the tail position and accent color
            "--intro-arrow-x": `${bubbleAnchor.arrowX}px`,
            "--intro-color": activeIntro.color,
          }}
          onClick={advanceIntro}
          title="Click to skip to the next introduction"
        >
          <div className={styles.introBubbleHeader}>
            <span className={styles.introBubbleName}>{activeIntro.name}</span>
            {introState?.queueIndex !== null && introState !== null && (
              <span className={styles.introBubbleCounter}>
                {introState.queueIndex + 1} / {introQueue.length}
              </span>
            )}
            <button
              type="button"
              className={`${styles.introSkipBtn} ${
                introState?.queueIndex === null ? styles.introSkipBtnAlone : ""
              }`}
              onClick={(e) => {
                e.stopPropagation();
                advanceIntro();
              }}
              title="Skip to next introduction"
            >
              <Icon icon="ph:skip-forward-fill" />
            </button>
            <button
              type="button"
              className={styles.introCloseBtn}
              onClick={(e) => {
                e.stopPropagation();
                stopIntros();
              }}
              title="Stop the introductions"
            >
              <Icon icon="ph:x-bold" />
            </button>
          </div>
          <p className={styles.introBubbleText}>{activeIntro.message}</p>
        </div>,
        bubblePortalTarget ?? document.body
      )}
    </div>
  );
}
