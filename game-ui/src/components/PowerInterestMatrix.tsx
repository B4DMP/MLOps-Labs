import { useContext, useMemo } from "react";
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
    axisLabel: "High Power • Low Interest",
    cardStyle: styles.quadrantTopLeft,
    icon: "ph:warning-circle-bold",
    iconColor: "#f97316",
  },
  {
    key: "high-high",
    title: "Manage Closely",
    axisLabel: "High Power • High Interest",
    cardStyle: styles.quadrantTopRight,
    icon: "ph:star-bold",
    iconColor: "#ef4444",
  },
  {
    key: "low-low",
    title: "Monitor",
    axisLabel: "Low Power • Low Interest",
    cardStyle: styles.quadrantBottomLeft,
    icon: "ph:eye-bold",
    iconColor: "#94a3b8",
  },
  {
    key: "low-high",
    title: "Keep Informed",
    axisLabel: "Low Power • High Interest",
    cardStyle: styles.quadrantBottomRight,
    icon: "ph:info-bold",
    iconColor: "#3b82f6",
  },
];

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
}: PowerInterestMatrixProps) {
  const { stakeholders } = useContext(StakeholderContext);

  const { categorizedNodes, dynamicsSummary } = useMemo(() => {
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
      const isNew = !prev && !isFirstPhase;
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

    let summaryText = "";
    if (isFirstPhase) {
      summaryText = "Initial phase stakeholder positions established below.";
    } else {
      const parts: string[] = [];
      if (joinedNames.length > 0 && leftNames.length > 0) {
        parts.push(`${formatNameList(joinedNames)} replaced ${formatNameList(leftNames)}`);
      } else if (joinedNames.length > 0) {
        parts.push(`${formatNameList(joinedNames)} joined the active phase`);
      } else if (leftNames.length > 0) {
        parts.push(`${formatNameList(leftNames)} stepped back from this phase`);
      }

      if (shiftedSummaries.length > 0) {
        parts.push(shiftedSummaries.join(" • "));
      }

      summaryText = parts.length > 0 ? parts.join(" • ") : "All active stakeholders maintain their previous power & interest levels.";
    }

    return {
      categorizedNodes: categorized,
      dynamicsSummary: summaryText,
    };
  }, [currentStakeholders, previousStakeholders, isFirstPhase, stakeholders]);

  return (
    <div className={styles.matrixContainer}>
      {/* Dynamics Summary Banner */}
      <div className={styles.summaryBanner}>
        <Icon icon="ph:arrows-clockwise-bold" style={{ fontSize: "1.1rem", color: "var(--primary-bg)", flexShrink: 0, marginTop: "2px" }} />
        <div style={{ minWidth: 0 }}>
          <span>
            <strong>Phase Dynamics: </strong>
            {dynamicsSummary}
          </span>
        </div>
      </div>

      {/* 2x2 Quadrant Grid */}
      <div className={styles.matrixGrid}>
        {QUADRANTS.map((quad) => {
          const items = categorizedNodes[quad.key] || [];

          return (
            <div key={quad.key} className={`${styles.quadrantCard} ${quad.cardStyle}`}>
              <div className={styles.quadrantHeader}>
                <span className={styles.quadrantTitle}>
                  <Icon icon={quad.icon} style={{ color: quad.iconColor, fontSize: "0.95rem" }} />
                  {quad.title}
                </span>
                <span className={styles.quadrantAxisBadge}>{quad.axisLabel}</span>
              </div>

              <div className={styles.stakeholderList}>
                {items.length === 0 ? (
                  <div className={styles.emptyQuadrant}>No stakeholders</div>
                ) : (
                  items.map((item) => {
                    const st = item.st;
                    const stName = st?.name || item.stakeholderId;
                    const stColor = st?.stakeholder_color || "#3b82f6";
                    const roleDesc = st?.role_description || "Project Stakeholder";

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
                        description={`${stName} — ${roleDesc}${shiftText ? ` (${shiftText})` : ""}`}
                      >
                        <div
                          className={styles.stakeholderItem}
                          style={{ borderLeft: `3px solid ${stColor}` }}
                        >
                          <div className={styles.stakeholderLeft}>
                            <div className={styles.avatarWrapper}>
                              {st?.avatar ? (
                                <StakeholderAvatarComponent
                                  avatar={st.avatar}
                                  stakeholderColor={stColor}
                                  isFramed={false}
                                  size="100%"
                                />
                              ) : (
                                <Icon icon="ph:user-bold" style={{ color: stColor }} />
                              )}
                            </div>
                            <div className={styles.stakeholderMeta}>
                              <span className={styles.stakeholderName}>{stName}</span>
                              {roleDesc && (
                                <span className={styles.stakeholderDescription}>{roleDesc}</span>
                              )}
                            </div>
                          </div>

                          <div className={styles.badgeContainer}>
                            {item.isNew && (
                              <span className={styles.badgeNew}>
                                <Icon icon="ph:plus-bold" /> NEW
                              </span>
                            )}
                            {item.isShifted && (
                              <span className={styles.badgeShifted} title={shiftText}>
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
    </div>
  );
}
