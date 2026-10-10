import { Icon } from "@iconify/react";
import HoverTooltip from "../HoverToolTip";
import { intelTagMeta } from "../../types/IntelTag";
import type { RevealedIntel } from "./chat";
import styles from "./ConversationHistory.module.css";

interface IntelChipProps {
  intel: RevealedIntel;
  speakerName?: string;
  onInspect?: () => void;
}

function stateLabel(intel: RevealedIntel): string {
  if (intel.is_corrected) return "Corrected";
  if (intel.is_verified) return "Verified";
  return "Revealed";
}

export default function IntelChip({ intel, speakerName, onInspect }: IntelChipProps) {
  const meta = intelTagMeta(intel.categorized_type);
  const who = intel.stakeholder_name || speakerName;
  const clickable = Boolean(onInspect);
  const tooltip = clickable
    ? `${intel.description}\nClick to highlight this note in ${who || "the stakeholder"}'s dossier`
    : intel.description;

  return (
    <HoverTooltip description={tooltip} block>
      <button
        type="button"
        className={`${styles.intelChip} ${clickable ? styles.intelChipClickable : ""}`}
        style={{ ["--tc" as string]: meta.color }}
        onClick={onInspect}
        disabled={!clickable}
        data-testid="intel-chip"
      >
        <span className={styles.intelIcon}>
          <Icon icon={meta.icon} />
        </span>
        <span className={styles.intelBody}>
          <span className={styles.intelLabel}>
            {(intel.is_verified || intel.is_corrected) && <Icon icon="ph:check-circle-fill" className={styles.intelOk} />}
            {stateLabel(intel)} {meta.label}
            {who ? ` · ${who}` : ""}
          </span>
          <span className={styles.intelText}>{intel.description}</span>
        </span>
        {clickable && (
          <span className={styles.intelGo}>
            <Icon icon="ph:arrow-line-left-bold" /> Dossier
          </span>
        )}
      </button>
    </HoverTooltip>
  );
}
