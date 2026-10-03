import { Icon } from "@iconify/react";
import styles from "./VetoDialog.module.css";
import { VETO_FEEDBACK } from "../content/helpCopy";
import { findGraphTarget, nominalOn, optionDisplayName, optionsOn, type OptionTarget } from "../utils/graphOptions";
import type { VetoInfo } from "./VetoDialog";

type Technical = Parameters<typeof findGraphTarget>[0];

/** The suggested change, or null when the objection is not a boundary on a known component. */
export function deriveVetoChange(
  vetoInfo: VetoInfo,
  technical: Technical,
): { component: string; option: string | null } | null {
  if (vetoInfo.objection_kind !== "boundary" || !vetoInfo.objection_target) return null;
  const id = vetoInfo.objection_target;
  const target = (findGraphTarget(technical, id) ?? findGraphTarget(technical, id.replace(/^req\./, ""))) as
    | (OptionTarget & { name?: string })
    | undefined;
  if (!target?.name) return null;
  // The boundary's exact level is not sent, so offer the first authored step up.
  const first = optionsOn(target, "automation").find((o) => o.to_level > nominalOn(target, "automation"));
  return { component: target.name, option: first ? optionDisplayName(target, "automation", first) : null };
}

interface VetoFeedbackProps {
  vetoInfo: VetoInfo;
  technical: Technical;
  /** True from the second veto in a row. */
  isRepeat: boolean;
  onShowObjection: () => void;
  onRevise: () => void;
}

export default function VetoFeedback({ vetoInfo, technical, isRepeat, onShowObjection, onRevise }: VetoFeedbackProps) {
  const change = deriveVetoChange(vetoInfo, technical);
  let suggestion: string;
  if (isRepeat) suggestion = VETO_FEEDBACK.repeat(change?.component);
  else if (change?.option) suggestion = VETO_FEEDBACK.boundary(change.component, change.option);
  else if (change) suggestion = VETO_FEEDBACK.boundaryNoOption(change.component);
  else suggestion = vetoInfo.objection_detail || VETO_FEEDBACK.fallback;

  return (
    <div className={styles.coachPanel} data-testid="veto-feedback">
      <div className={styles.coachSection}>
        <div className={styles.coachLabel}>{VETO_FEEDBACK.meansLabel}</div>
        <p className={styles.coachText}>{VETO_FEEDBACK.means}</p>
      </div>
      <div className={styles.coachSection}>
        <div className={styles.coachLabel}>{VETO_FEEDBACK.changeLabel}</div>
        <p className={styles.coachText}>{suggestion}</p>
      </div>
      <div className={styles.coachActions}>
        {vetoInfo.objection_item_id && (
          <button type="button" className={styles.coachButton} onClick={onShowObjection}>
            <Icon icon="ph:magnifying-glass-bold" />
            <span>{VETO_FEEDBACK.showObjection}</span>
          </button>
        )}
        <button type="button" className={styles.coachButton} onClick={onRevise}>
          <Icon icon="ph:pencil-simple-bold" />
          <span>{VETO_FEEDBACK.revise}</span>
        </button>
      </div>
    </div>
  );
}
