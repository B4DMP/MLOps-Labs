import { Icon } from "@iconify/react";
import { Reorder } from "motion/react";
import type { EngagementCard } from "../../types/EngagementCard";
import { getTabInfo } from "./chat";
import styles from "./ConversationHistory.module.css";

interface HistoryTabsProps {
  order: string[];
  onReorder: (next: string[]) => void;
  activeId: string | null;
  onSelect: (id: string) => void;
  counts: Record<string, number>;
  engagementCards: EngagementCard[];
}

/** One folder tab per conversation; drag to reorder. The active tab joins the sheet below it. */
export default function HistoryTabs({ order, onReorder, activeId, onSelect, counts, engagementCards }: HistoryTabsProps) {
  return (
    <Reorder.Group axis="x" values={order} onReorder={onReorder} className={styles.tabs} as="div" role="tablist">
      {order.map((id) => {
        const info = getTabInfo(id, engagementCards);
        const active = id === activeId;
        return (
          <Reorder.Item key={id} value={id} as="div" className={styles.tabItem} whileDrag={{ scale: 1.04, zIndex: 10 }}>
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.tab} ${active ? styles.tabOn : ""}`}
              onClick={() => onSelect(id)}
            >
              <Icon icon="ph:dots-six-vertical-bold" className={styles.tabGrip} />
              <Icon icon={info.icon} />
              <span>{info.title}</span>
              <span className={styles.tabCount}>{counts[id] ?? 0}</span>
            </button>
          </Reorder.Item>
        );
      })}
    </Reorder.Group>
  );
}
