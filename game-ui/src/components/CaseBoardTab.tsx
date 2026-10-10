import { Icon } from "@iconify/react";
import { faceForEmotionState } from "../utils/emotionFace";
import type { BoardState } from "../types/CaseBoard";
import type { BoardPortrait } from "./CaseBoard";
import type { StakeholderDossierEntry } from "./StakeholderDossier";
import type { Stakeholder } from "./StakeholderProvider";
import styles from "./StakeholderDossier.module.css";

/** The room's people as portraits for the board, in the order the server lists them. */
export function boardPortraits(
  pages: ReadonlyArray<StakeholderDossierEntry>,
  people: ReadonlyArray<string>,
  stakeholders: Record<string, Stakeholder>,
  colorOf: (page: StakeholderDossierEntry) => string,
): BoardPortrait[] {
  return people
    .map((id) => pages.find((st) => st.stakeholder_id === id))
    .filter((st): st is StakeholderDossierEntry => Boolean(st))
    .map((st) => {
      const stObj = stakeholders[st.stakeholder_id];
      return {
        id: st.stakeholder_id,
        name: st.name,
        color: colorOf(st),
        avatar: stObj?.avatar,
        face: faceForEmotionState(stObj?.emotional_state || "neutral"),
        highPower: (st.power || stObj?.power || "").toLowerCase() === "high",
      };
    });
}

interface BoardTabProps {
  board: BoardState;
  open: boolean;
  onOpen: () => void;
}

/** The dossier's last tab, in cork brown, as wide as its label. Looks like the person tabs beside it. */
export default function BoardTab({ board, open, onOpen }: BoardTabProps) {
  return (
    <button
      className={`${styles.tabButton} ${styles.boardTab} ${open ? styles.activeTab : ""}`}
      onClick={onOpen}
      aria-pressed={open}
      aria-label={`Case board: ${board.found.length} threads found. Tie stakeholders together.`}
      data-testid="case-board-tab"
      style={{ "--tab-color": "#5a3c24" } as React.CSSProperties}
    >
      {board.hints.length > 0 && !open && <span className={styles.boardTabPulse} aria-hidden="true" />}
      <span className={styles.tabName}>
        <span className={styles.tabNameLine}>
          <Icon icon="ph:push-pin-duotone" /> Board
        </span>
      </span>
      <div className={styles.tabEmotionRow}>
        <span className={styles.tabEmotionLabel}>
          {board.found.length} {board.found.length === 1 ? "thread" : "threads"}
        </span>
      </div>
    </button>
  );
}
