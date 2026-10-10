import React from "react";
import { Icon } from "@iconify/react";
import styles from "./StakeholderDossier.module.css";
import type { EmotionGatingInfo, EmotionGatingDimension } from "./StakeholderProvider";
import EmotionRevealBadge from "./EmotionRevealBadge";
import { IntelTagDetail, InterestTagDetail, PatienceTagDetail, PowerTagDetail } from "./HoverTagDetails";

export type IntelPipStatus = "on_record" | "confirmed" | "unconfirmed" | "hidden";

/** Pips follow the stamps' colours, so they teach the player nothing new. */
export const INTEL_PIP_META: Record<IntelPipStatus, { label: string; styleClass: string }> = {
  on_record: { label: "On record", styleClass: styles.pipOnRecord },
  confirmed: { label: "Confirmed", styleClass: styles.pipConfirmed },
  unconfirmed: { label: "Unconfirmed", styleClass: styles.pipUnconfirmed },
  hidden: { label: "Not found yet", styleClass: styles.pipHidden },
};

/** Hover text for a pip row, e.g. "3 of 4 notes found: 1 on record, 2 unconfirmed". */
export const intelPipParts = (pips: IntelPipStatus[]): { summary: string; breakdown: string[] } => {
  const countOf = (status: IntelPipStatus) => pips.filter((p) => p === status).length;
  const breakdown = (["on_record", "confirmed", "unconfirmed"] as const)
    .filter((status) => countOf(status) > 0)
    .map((status) => `${countOf(status)} ${INTEL_PIP_META[status].label.toLowerCase()}`);
  return { summary: `${pips.length - countOf("hidden")} of ${pips.length} notes found`, breakdown };
};

export const describeIntelPips = (pips: IntelPipStatus[]): string => {
  const { summary, breakdown } = intelPipParts(pips);
  return breakdown.length > 0 ? `${summary}: ${breakdown.join(", ")}` : summary;
};

const PATIENCE_DETAIL = "Bringing them the same problem again wears on them. Answer what they asked for and it eases.";

const POWER_DETAIL = {
  high: "High power. Can this person stop you? Yes: they can veto the whole plan.",
  low: "Low power. Can this person stop you? No: they can only grumble.",
};

const INTEREST_DETAIL = {
  high: "High interest. They care a lot, so your words and your proposal move their mood strongly. Together with power, it sets how strongly they react.",
  low: "Low interest. They care less, so your words and your proposal move their mood gently. Together with power, it sets how strongly they react.",
};

type ShowInfoTag = (e: React.SyntheticEvent, label: string, detail?: React.ReactNode) => void;

/** A power/interest badge: the metric's icon plus signal bars (1 of 3 = Low, 3 of 3 = High) in place of the word. */
const LevelBadge: React.FC<{
  label: string;
  high: boolean;
  icon: { high: string; low: string };
  ariaDetail: string;
  detail: React.ReactNode;
  showInfoTag: ShowInfoTag;
  hideInfoTag: () => void;
}> = ({ label, high, icon, ariaDetail, detail, showInfoTag, hideInfoTag }) => {
  const color = high ? "#dc2626" : "#2563eb";
  return (
    <div
      className={styles.powerInterestBadge}
      tabIndex={0}
      aria-label={`${label}: ${ariaDetail}`}
      onMouseEnter={(e) => showInfoTag(e, label, detail)}
      onMouseLeave={hideInfoTag}
      onFocus={(e) => showInfoTag(e, label, detail)}
      onBlur={hideInfoTag}
    >
      <Icon icon={high ? icon.high : icon.low} className={styles.metricIcon} style={{ color }} />
      <span className={styles.levelBars} style={{ color }} aria-hidden="true">
        {[1, 2, 3].map((bar) => (
          <span key={bar} className={`${styles.levelBar} ${bar === 1 || high ? styles.levelBarOn : ""}`} />
        ))}
      </span>
    </div>
  );
};

/** The stat strip under a stakeholder's role: mood, power, interest, patience and intel found. */
const StakeholderStatGroup: React.FC<{
  emotionDisplay: string;
  emotionColor: string;
  gatingInfo?: EmotionGatingInfo;
  fullDimensions?: EmotionGatingDimension[];
  powerHigh: boolean;
  interestHigh: boolean;
  /** "Losing patience" / "Out of patience", or null while they are fine. */
  patienceLabel: string | null;
  intelPips: IntelPipStatus[];
  showInfoTag: ShowInfoTag;
  hideInfoTag: () => void;
}> = ({
  emotionDisplay,
  emotionColor,
  gatingInfo,
  fullDimensions,
  powerHigh,
  interestHigh,
  patienceLabel,
  intelPips,
  showInfoTag,
  hideInfoTag,
}) => {
  const hiddenIntelCount = intelPips.filter((status) => status === "hidden").length;
  return (
    <div className={styles.stakeholderMetaRow}>
      <EmotionRevealBadge
        emotionDisplay={emotionDisplay}
        emotionColor={emotionColor}
        gatingInfo={gatingInfo}
        fullDimensions={fullDimensions}
      />
      <LevelBadge
        label="Power"
        high={powerHigh}
        icon={{ high: "ph:lightning-fill", low: "ph:lightning-bold" }}
        ariaDetail={powerHigh ? POWER_DETAIL.high : POWER_DETAIL.low}
        detail={<PowerTagDetail high={powerHigh} />}
        showInfoTag={showInfoTag}
        hideInfoTag={hideInfoTag}
      />
      <LevelBadge
        label="Interest"
        high={interestHigh}
        icon={{ high: "ph:eye-fill", low: "ph:eye-bold" }}
        ariaDetail={interestHigh ? INTEREST_DETAIL.high : INTEREST_DETAIL.low}
        detail={<InterestTagDetail high={interestHigh} />}
        showInfoTag={showInfoTag}
        hideInfoTag={hideInfoTag}
      />
      {patienceLabel && (
        <div
          className={`${styles.powerInterestBadge} ${styles.patienceTag}`}
          tabIndex={0}
          aria-label={`${patienceLabel}: ${PATIENCE_DETAIL}`}
          onMouseEnter={(e) => showInfoTag(e, patienceLabel, <PatienceTagDetail />)}
          onMouseLeave={hideInfoTag}
          onFocus={(e) => showInfoTag(e, patienceLabel, <PatienceTagDetail />)}
          onBlur={hideInfoTag}
        >
          <Icon icon="ph:hourglass-medium-bold" className={styles.metricIcon} />
          <span>{patienceLabel === "Out of patience" ? "Fed up" : "Impatient"}</span>
        </div>
      )}
      {intelPips.length > 0 && (
        <div
          className={styles.powerInterestBadge}
          tabIndex={0}
          aria-label={`Intel: ${describeIntelPips(intelPips)}`}
          onMouseEnter={(e) => showInfoTag(e, "Intel", <IntelTagDetail {...intelPipParts(intelPips)} />)}
          onMouseLeave={hideInfoTag}
          onFocus={(e) => showInfoTag(e, "Intel", <IntelTagDetail {...intelPipParts(intelPips)} />)}
          onBlur={hideInfoTag}
        >
          <Icon icon="ph:push-pin-bold" className={`${styles.metricIcon} ${styles.intelBadgeInk}`} />
          <span className={styles.intelPips}>
            {intelPips.map((status, idx) => (
              <span key={idx} className={`${styles.intelPip} ${INTEL_PIP_META[status].styleClass}`} />
            ))}
          </span>
          <span className={styles.intelBadgeInk} style={{ fontWeight: 700 }}>
            {intelPips.length - hiddenIntelCount}/{intelPips.length}
          </span>
        </div>
      )}
    </div>
  );
};

export default StakeholderStatGroup;
