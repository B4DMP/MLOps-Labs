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
    cardStyle: styles.sectorTopLeft,
    icon: "ph:warning-circle-bold",
    iconColor: "#f97316",
  },
  {
    key: "high-high",
    title: "Manage Closely",
    axisLabel: "High Power • High Interest",
    cardStyle: styles.sectorTopRight,
    icon: "ph:star-bold",
    iconColor: "#ef4444",
  },
  {
    key: "low-low",
    title: "Monitor",
    axisLabel: "Low Power • Low Interest",
    cardStyle: styles.sectorBottomLeft,
    icon: "ph:eye-bold",
    iconColor: "#94a3b8",
  },
  {
    key: "low-high",
    title: "Keep Informed",
    axisLabel: "Low Power • High Interest",
    cardStyle: styles.sectorBottomRight,
    icon: "ph:info-bold",
    iconColor: "#38bdf8",
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
                    <span className={styles.sectorAxisBadge}>{quad.axisLabel}</span>
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
                            description={`${stName}: ${roleDesc}${shiftText ? ` (${shiftText})` : ""}`}
                          >
                            <div className={styles.stakeholderItem}>
                              <div className={styles.stakeholderLeft}>
                                <div
                                  className={styles.avatarWrapper}
                                  style={{ border: `2px solid ${stColor}` }}
                                >
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

          {/* Bottom Horizontal Axis: Interest */}
          <div className={styles.xAxis}>
            <div className={styles.axisLineX}>
              <span className={styles.axisLabelTextX}>Interest</span>
              <Icon icon="ph:arrow-right-bold" className={styles.axisArrowIcon} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
