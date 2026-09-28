/**
 * One open engagement-card conversation with one target (D49, plan 11). A card buys a fixed
 * number of turns per target; each turn is one option here. Turns not used are lost on close.
 */

import { Icon } from "@iconify/react";
import { motion, AnimatePresence } from "motion/react";
import type { StakeholderAvatar } from "../types/StakeholderAvatar";
import type { GatherOptionKind, GatherStatePayload } from "../types/Gather";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import styles from "./GatherConversationPanel.module.css";

const RESULT_COPY: Record<string, string> = {
  revealed: "New note filed - check the dossier.",
  nothing_left: "Nothing left to ask about in this category.",
  gist: "You get the gist, but nothing specific enough to file.",
  rejected: "That didn't land.",
  closed: "Conversation closed.",
};

const OPTION_FALLBACK_META: Record<GatherOptionKind, { label: string; icon: string; hint: string }> = {
  component_query: {
    label: "Component Inquiry",
    icon: "ph:cpu-bold",
    hint: "Ask stakeholder about their perspective on this MLOps component.",
  },
  priority_query: {
    label: "Top Priority",
    icon: "ph:star-bold",
    hint: "Ask stakeholder about their highest priority requirements.",
  },
  generic_query: {
    label: "Ask Generically",
    icon: "ph:chat-circle-dots-bold",
    hint: "Ask an open-ended question to discover new intel.",
  },
};

export interface GatherConversationPanelProps {
  conversation: GatherStatePayload;
  itemLabel?: (itemId: string) => string;
  avatar?: StakeholderAvatar;
  stakeholderColor?: string;
  busy?: boolean;
  onAsk: (option: GatherOptionKind, extra?: { component_id?: string; item_id?: string }) => void;
  onClose: () => void;
  onDismiss?: () => void;
}

export default function GatherConversationPanel({
  conversation,
  avatar,
  stakeholderColor,
  busy = false,
  onAsk,
  onClose,
}: GatherConversationPanelProps) {
  return (
    <div className={styles.panel} style={{ ["--st-color" as string]: stakeholderColor || "#38bdf8" } as React.CSSProperties}>
      <div className={styles.head}>
        <StakeholderAvatarComponent
          avatar={avatar}
          size={40}
          isFramed={false}
          stakeholderColor={stakeholderColor || "#38bdf8"}
          stakeholderId={conversation.stakeholder_id}
        />
        <div className={styles.headText}>
          <span className={styles.name}>{conversation.stakeholder_name}</span>
          <span className={styles.turns}>
            {conversation.closed || conversation.turns_left <= 0
              ? "conversation closed"
              : `${conversation.turns_left} turn${conversation.turns_left === 1 ? "" : "s"} left`}
          </span>
        </div>
        {!conversation.closed && conversation.turns_left > 0 && (
          <button
            type="button"
            className={styles.endBtn}
            onClick={onClose}
            disabled={busy}
            title="End this conversation early - unused turns are lost"
          >
            <Icon icon="ph:door-bold" className={styles.endBtnIcon} />
            <span>End conversation</span>
          </button>
        )}
      </div>

      <AnimatePresence>
        {conversation.result && (
          <motion.div
            key={conversation.result}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className={styles.resultBanner}
          >
            {RESULT_COPY[conversation.result] || conversation.result}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait" initial={false}>
        {busy ? (
          <motion.div
            key="busy-loading"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
            className={styles.loadingContainer}
          >
            <Icon icon="ph:spinner-gap-bold" className={styles.loadingSpinner} />
            <span className={styles.loadingText}>
              Consulting with {conversation.stakeholder_name}...
            </span>
          </motion.div>
        ) : conversation.closed || conversation.turns_left <= 0 ? (
          <motion.div
            key="convo-closed"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
            className={styles.closedHint}
          >
            {conversation.turns_left > 0
              ? `${conversation.turns_left} unused turn${conversation.turns_left === 1 ? "" : "s"} went to waste.`
              : "Conversation concluded."}
          </motion.div>
        ) : (
          <motion.div
            key={`turn-grid-${conversation.turns_left}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className={styles.turnGrid}
          >
            {conversation.options.map((opt, idx) => {
              const meta = OPTION_FALLBACK_META[opt.option] || {
                label: "Ask",
                icon: "ph:chat-circle-bold",
                hint: "Dialogue option",
              };
              const displayText =
                opt.prompt || opt.label || (opt.component_id ? `Discuss ${opt.component_id}` : meta.label);
              const isSingle = conversation.options.length === 1;

              return (
                <motion.button
                  key={`${opt.option}-${opt.component_id || opt.item_id || idx}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: idx * 0.03 }}
                  className={`${styles.turnBtn} ${!opt.available ? styles.turnBtnOff : ""} ${
                    isSingle ? styles.turnBtnFullWidth : ""
                  }`}
                  disabled={!opt.available || busy}
                  onClick={() =>
                    onAsk(opt.option, {
                      component_id: opt.component_id ?? undefined,
                      item_id: opt.item_id ?? undefined,
                    })
                  }
                  title={opt.reason || opt.prompt || meta.hint}
                >
                  <Icon icon={meta.icon} className={styles.turnBtnIcon} />
                  <span className={styles.turnBtnText}>{displayText}</span>
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
