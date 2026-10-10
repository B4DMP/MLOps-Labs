import { Icon } from "@iconify/react";
import type { ReactNode } from "react";
import styles from "./ConversationHistory.module.css";

interface ActionReceiptProps {
  icon: string;
  title: string;
  children?: ReactNode;
  controls?: ReactNode;
  /** Pass-through for the intro tour's data-* anchors. */
  anchorProps?: Record<string, string | number>;
}

/** A centred line for what the player did, or a system message: icon, bold title, then the text. */
export default function ActionReceipt({ icon, title, children, controls, anchorProps }: ActionReceiptProps) {
  return (
    <div className={styles.line} {...anchorProps}>
      <div className={styles.lineCard}>
        <span className={styles.lineIcon}>
          <Icon icon={icon} />
        </span>
        <span>
          <span className={styles.lineTitle}>{title}</span>
          {children}
        </span>
        {controls}
      </div>
    </div>
  );
}
