/**
 * One open engagement-card conversation with one target (D49, plan 11). A card buys a fixed
 * number of turns per target; each turn is one option here. Turns not used are lost on close.
 */

import { Icon } from "@iconify/react";
import type { StakeholderAvatar } from "../types/StakeholderAvatar";
import type { GatherOptionKind, GatherStatePayload } from "../types/Gather";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import styles from "./GatherConversationPanel.module.css";

const RESULT_COPY: Record<string, string> = {
  revealed: "New note filed - check the dossier.",
  nothing_left: "Nothing left to ask about, in this card's tags.",
  inferred: "Your read holds up. Filed as Inferred.",
  refuted: "That wasn't it. Re-tag it in the dossier and try again.",
  gist: "You get the gist, but nothing specific enough to file.",
  archetype_matched: "Confirmed - that's how they think.",
  archetype_ruled_out: "Not that one. Ruled out for next time.",
  no_archetype_left: "Every archetype has been ruled out.",
  already_verified: "Their profile is already verified.",
  one_on_one_hit: "They confirm: you understood both sides of it.",
  one_on_one_miss: "That's not quite it.",
  rejected: "That didn't land.",
  closed: "Conversation closed.",
};

const OPTION_META: Record<GatherOptionKind, { label: string; icon: string; hint: string }> = {
  open_question: { label: "Open question", icon: "ph:door-open-bold", hint: "Reveals their next note, in this card's tags." },
  test_hypothesis: { label: "Test a hypothesis", icon: "ph:target-bold", hint: "Right and it's Inferred. Wrong and it's Refuted - a trust hit, but a free re-tag." },
  generic_question: { label: "Ask generically", icon: "ph:chat-circle-dots-bold", hint: "The gist of their next note, any tag. Nothing enters the dossier." },
  trial_balloon: { label: "Trial balloon", icon: "ph:balloon-bold", hint: "Guess their profile. A miss rules that one out." },
  one_on_one: { label: "The 1-on-1", icon: "ph:handshake-bold", hint: "“I understand [Boundary]. If we guarantee [Trade-off/Driver], would that work?”" },
};

export interface GatherConversationPanelProps {
  conversation: GatherStatePayload;
  itemLabel: (itemId: string) => string;
  archetypeLabel: (name: string) => string;
  avatar?: StakeholderAvatar;
  stakeholderColor?: string;
  busy?: boolean;
  onAsk: (option: GatherOptionKind, extra?: { item_id?: string; archetype?: string }) => void;
  onClose: () => void;
  onDismiss: () => void;
}

export default function GatherConversationPanel({
  conversation,
  itemLabel,
  archetypeLabel,
  avatar,
  stakeholderColor,
  busy = false,
  onAsk,
  onClose,
  onDismiss,
}: GatherConversationPanelProps) {
  const byKind = (kind: GatherOptionKind) => conversation.options.filter((o) => o.option === kind);
  const single = (kind: GatherOptionKind) => byKind(kind)[0];
  const testOptions = byKind("test_hypothesis");
  const balloonOptions = byKind("trial_balloon");
  const openQ = single("open_question");
  const genericQ = single("generic_question");
  const oneOnOne = single("one_on_one");

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
            {conversation.closed
              ? "conversation closed"
              : `${conversation.turns_left} turn${conversation.turns_left === 1 ? "" : "s"} left`}
          </span>
        </div>
        <button className={styles.dismissBtn} onClick={onDismiss} title="Dismiss this panel" aria-label="Dismiss">
          <Icon icon="ph:x-bold" />
        </button>
      </div>

      {conversation.result && (
        <div className={styles.resultBanner}>{RESULT_COPY[conversation.result] || conversation.result}</div>
      )}

      {conversation.closed ? (
        <div className={styles.closedHint}>
          {conversation.turns_left > 0
            ? `${conversation.turns_left} unused turn${conversation.turns_left === 1 ? "" : "s"} went to waste.`
            : "Every turn was used."}
        </div>
      ) : (
        <div className={styles.turnGrid}>
          {openQ && (
            <button
              className={`${styles.turnBtn} ${!openQ.available ? styles.turnBtnOff : ""}`}
              disabled={!openQ.available || busy}
              onClick={() => onAsk("open_question")}
              title={openQ.reason || OPTION_META.open_question.hint}
            >
              <Icon icon={OPTION_META.open_question.icon} className="me-1" />
              {OPTION_META.open_question.label}
            </button>
          )}

          {testOptions.length > 0 && testOptions[0].available ? (
            testOptions.map((opt) => (
              <button
                key={`test-${opt.item_id}`}
                className={styles.turnBtn}
                disabled={busy}
                onClick={() => onAsk("test_hypothesis", { item_id: opt.item_id! })}
                title={OPTION_META.test_hypothesis.hint}
              >
                <Icon icon={OPTION_META.test_hypothesis.icon} className="me-1" />
                Test: {itemLabel(opt.item_id!)}
              </button>
            ))
          ) : (
            <button className={`${styles.turnBtn} ${styles.turnBtnOff}`} disabled title={testOptions[0]?.reason ?? undefined}>
              <Icon icon={OPTION_META.test_hypothesis.icon} className="me-1" />
              {OPTION_META.test_hypothesis.label}
            </button>
          )}

          {genericQ && (
            <button
              className={styles.turnBtn}
              disabled={busy}
              onClick={() => onAsk("generic_question")}
              title={OPTION_META.generic_question.hint}
            >
              <Icon icon={OPTION_META.generic_question.icon} className="me-1" />
              {OPTION_META.generic_question.label}
            </button>
          )}

          {balloonOptions.length > 0 && balloonOptions[0].available ? (
            balloonOptions.map((opt) => (
              <button
                key={`balloon-${opt.archetype}`}
                className={styles.turnBtn}
                disabled={busy}
                onClick={() => onAsk("trial_balloon", { archetype: opt.archetype! })}
                title={OPTION_META.trial_balloon.hint}
              >
                <Icon icon={OPTION_META.trial_balloon.icon} className="me-1" />
                Guess: {archetypeLabel(opt.archetype!)}
              </button>
            ))
          ) : (
            <button className={`${styles.turnBtn} ${styles.turnBtnOff}`} disabled title={balloonOptions[0]?.reason ?? undefined}>
              <Icon icon={OPTION_META.trial_balloon.icon} className="me-1" />
              {OPTION_META.trial_balloon.label}
            </button>
          )}

          {conversation.card_id === "eng_1" && oneOnOne && (
            <button
              className={`${styles.turnBtn} ${!oneOnOne.available ? styles.turnBtnOff : ""}`}
              disabled={!oneOnOne.available || busy}
              onClick={() => onAsk("one_on_one")}
              title={oneOnOne.reason || OPTION_META.one_on_one.hint}
            >
              <Icon icon={OPTION_META.one_on_one.icon} className="me-1" />
              {OPTION_META.one_on_one.label}
            </button>
          )}

          <button className={styles.closeBtn} onClick={onClose} disabled={busy} title="End this conversation early - unused turns are lost">
            <Icon icon="ph:door-bold" className="me-1" />
            Close conversation
          </button>
        </div>
      )}
    </div>
  );
}
