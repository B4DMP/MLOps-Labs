import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import styles from "./CheatSheetModal.module.css";
import { INTEL_TAGS } from "../types/IntelTag";

const STAMP_STYLE_CLASS: Record<string, string> = {
  verified: styles.miniStampVerified,
  onRecord: styles.miniStampOnRecord,
  unconfirmed: styles.miniStampUnconfirmed,
};

interface CheatSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Which card to scroll to and pop once the sheet opens, matching the screen it was opened
   * from. Omit to open scrolled to the top with no card called out. */
  activeSectionTitle?: string;
}

interface CheatSheetSection {
  icon: string;
  accent: string;
  title: string;
  glyph: string;
  bullets: ReactNode[];
}

/** Mirrors pitch_debate.module.css's .statChipToken identity (coin icon, gold) but recolored for
 * a light card: that chip's bright gold text is tuned for the dark boardroom table behind it and
 * would wash out here, so this borrows the same amber-on-light pairing VetoDialog's
 * .vetoBreakerButton already uses successfully in a light dialog. */
const TokenChip = () => (
  <span className={styles.miniTokenChip}>
    <Icon icon="ph:coin-fill" />
    Tokens
  </span>
);

/** Mirrors StakeholderDossier.module.css's .tabChangeBadgeNew / .tabChangeBadgeShifted exactly,
 * so a player who has seen the real tab badge recognizes it here. */
const CHANGE_BADGES: { label: string; styleKey: "new" | "shifted"; detail: string }[] = [
  { label: "NEW", styleKey: "new", detail: "Just showed up this round." },
  { label: "SHIFTED", styleKey: "shifted", detail: "Priorities moved since last round." },
];

/** Mirrors StakeholderDossier.module.css's .rubberStamp variants exactly, so a player who has
 * seen the real confidence stamp on an intel note recognizes it here. */
const STAMP_LEGEND: {
  label: string;
  styleKey: "verified" | "onRecord" | "unconfirmed";
  detail: string;
}[] = [
  { label: "? UNCONFIRMED", styleKey: "unconfirmed", detail: "Your first read. Not checked yet." },
  { label: "✓ CONFIRMED", styleKey: "verified", detail: "You verified it yourself, talking to them." },
  { label: "★ ON RECORD", styleKey: "onRecord", detail: "They said it in the open. Nothing to confirm." },
];

/** Mirrors gameConfig/GameEngagementCards.json's six cards, in that file's order. */
const ENGAGEMENT_CARD_LEGEND: { icon: string; label: string; detail: string }[] = [
  { icon: "ph:seal-check-bold", label: "Verify Intel Item", detail: "Fact-check one unconfirmed note." },
  { icon: "ph:user-focus-bold", label: "1-to-1 Meeting", detail: "Deep-dive one stakeholder, 3 questions." },
  { icon: "ph:magnifying-glass-bold", label: "Probe Requirements", detail: "Ask one stakeholder about a component." },
  { icon: "ph:users-bold", label: "Team Sync-Up", detail: "Ask everyone at once. Once per phase." },
  { icon: "ph:chat-teardrop-text-bold", label: "Ask Generic Question", detail: "Cheap read on sentiment and preferences." },
  { icon: "ph:cpu-bold", label: "Investigate Component", detail: "Inspect a component for hard facts." },
];

const SECTIONS: CheatSheetSection[] = [
  {
    icon: "ph:address-book-tabs-duotone",
    accent: "#475569",
    title: "This Dossier",
    glyph: "One tab per stakeholder, hover anything for the short version",
    bullets: [
      "Hover any badge, stamp, or button for a one-line explainer.",
      "The face badge shows how they currently feel about you and your plan.",
      "System tab holds facts about the pipeline itself, not anyone's wishes.",
    ],
  },
  {
    icon: "ph:projector-screen-chart-bold",
    accent: "#7c3aed",
    title: "Briefing",
    glyph: "Power x Interest → who to watch first",
    bullets: [
      "Read this round's objectives before you touch anything.",
      "Radar: high Power + high Interest = Manage Closely. Ignore them at your own risk.",
    ],
  },
  {
    icon: "ph:files-bold",
    accent: "#0284c7",
    title: "Digging for Intel",
    glyph: "Read artifact → tag what it says about them",
    bullets: [
      "Read each artifact, then tag what it says about them with one of the four below.",
      "Confirming what you've tagged comes next phase, by asking about it with an Engagement Card.",
    ],
  },
  {
    icon: "ph:presentation-chart-bold",
    accent: "#d97706",
    title: "Pitch & Debate",
    glyph: "Play cards → build proposal → pitch → survive the veto",
    bullets: [
      <>
        Play an Engagement Card to talk to a stakeholder, verify an intel item, or inspect a
        pipeline component (table below).
      </>,
      <>
        Each card costs <TokenChip />. You get a limited supply per round.
      </>,
      "Build your proposal at the PITCH DECK: up to 3 changes to the pipeline.",
      <>
        Intel chip: 🟢 ready to pitch, 🟡 still thin, 🔴 not enough yet.
        <br />
        Verified intel turns it green.
      </>,
      "High-power stakeholder can 🚫 veto if you crossed a boundary or skipped a driver.",
      "After a veto: revise the card and re-pitch, or ⚡ Push It Through with an Escalation Point (3 for the whole game, never refill). The stakeholder who vetoed you will remember it.",
    ],
  },
  {
    icon: "ph:gauge-bold",
    accent: "#16a34a",
    title: "Simulate",
    glyph: "Watch it land: what worked, what didn't, who noticed",
    bullets: [
      "Rollout outcome first: how the whole plan landed.",
      <>
        Then a component-by-component log:
        <br />
        flawless, capped upstream, degraded by pushback, or delayed.
      </>,
      "Six project dimensions shift, e.g. how automated or governed your pipeline gets.",
      "Stakeholders react and remember. That mood carries into the next round.",
    ],
  },
];

export default function CheatSheetModal({ isOpen, onClose, activeSectionTitle }: CheatSheetModalProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [poppingTitle, setPoppingTitle] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (isOpen) setIsClosing(false);
  }, [isOpen]);

  // Wait out the panel's own entrance animation (modalPop, ~0.25s) before scrolling, so the
  // card doesn't get yanked into place mid-transition; then pop it once to draw the eye.
  useEffect(() => {
    if (!isOpen || !activeSectionTitle) return;
    let popTimer: ReturnType<typeof setTimeout>;
    const scrollTimer = setTimeout(() => {
      cardRefs.current[activeSectionTitle]?.scrollIntoView({ behavior: "smooth", block: "center" });
      setPoppingTitle(activeSectionTitle);
      popTimer = setTimeout(() => setPoppingTitle(null), 700);
    }, 260);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(popTimer);
    };
  }, [isOpen, activeSectionTitle]);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isClosing]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className={`${styles.backdrop} ${isClosing ? styles.backdropClosing : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className={`${styles.panel} ${isClosing ? styles.panelClosing : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h1 className={styles.headerTitle}>
            <Icon icon="ph:question-bold" className={styles.headerIcon} />
            <span>Cheat Sheet</span>
          </h1>
          <button
            type="button"
            className="btn-close btn-close-white"
            onClick={handleClose}
            aria-label="Close"
            title="Close (Esc)"
            style={{ cursor: "pointer" }}
          />
        </div>

        <div className={styles.modalBody}>

          {SECTIONS.map((section) => (
            <div
              key={section.title}
              ref={(el) => {
                cardRefs.current[section.title] = el;
              }}
              className={`${styles.card} ${
                section.title === activeSectionTitle ? styles.cardActive : ""
              } ${poppingTitle === section.title ? styles.cardPop : ""}`}
              style={{ ["--accent" as string]: section.accent }}
            >
              <div className={styles.cardHeader}>
                <Icon icon={section.icon} className={styles.cardIcon} />
                <span>{section.title}</span>
              </div>
              {section.title === "Briefing" ? (
                <div className={styles.glyphLine}>
                  <Icon icon="ph:lightning-bold" style={{ color: "#dc2626" }} />
                  <span>Power</span>
                  <span>×</span>
                  <Icon icon="ph:eye-bold" style={{ color: "#2563eb" }} />
                  <span>Interest</span>
                  <span>→ who to watch first</span>
                </div>
              ) : (
                <div className={styles.glyphLine}>{section.glyph}</div>
              )}
              <ul className={styles.bulletList}>
                {section.bullets.map((bullet, i) => (
                  <li key={i}>{bullet}</li>
                ))}
              </ul>
              {section.title === "This Dossier" && (
                <div className={styles.tagLegend}>
                  <div className={styles.legendLabel}>How sure you are about it</div>
                  {STAMP_LEGEND.map((stamp) => (
                    <div key={stamp.label} className={styles.tagChip}>
                      <span className={`${styles.miniStamp} ${STAMP_STYLE_CLASS[stamp.styleKey]}`}>
                        {stamp.label}
                      </span>
                      <span className={styles.tagChipDetail}>{stamp.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              {section.title === "Briefing" && (
                <div className={styles.tagLegend}>
                  {CHANGE_BADGES.map((badge) => (
                    <div key={badge.label} className={styles.tagChip}>
                      <span
                        className={`${styles.miniBadge} ${
                          badge.styleKey === "new" ? styles.miniBadgeNew : styles.miniBadgeShifted
                        }`}
                      >
                        {badge.label}
                      </span>
                      <span className={styles.tagChipDetail}>{badge.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              {section.title === "Digging for Intel" && (
                <div className={styles.tagLegend}>
                  <div className={styles.legendLabel}>What they meant</div>
                  {INTEL_TAGS.map((tag) => (
                    <div
                      key={tag.type}
                      className={styles.tagChip}
                      style={{ ["--tag-color" as string]: tag.color }}
                    >
                      <Icon icon={tag.icon} />
                      <span className={styles.tagChipLabel}>{tag.label}</span>
                      <span className={styles.tagChipDetail}>{tag.description}</span>
                    </div>
                  ))}
                </div>
              )}
              {section.title === "Pitch & Debate" && (
                <div className={styles.tagLegend}>
                  <div className={styles.legendLabel}>Engagement Cards</div>
                  {ENGAGEMENT_CARD_LEGEND.map((card) => (
                    <div key={card.label} className={styles.tagChip}>
                      <Icon icon={card.icon} />
                      <span className={styles.tagChipLabel}>{card.label}</span>
                      <span className={styles.tagChipDetail}>{card.detail}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <div className={styles.footerHint}>
            <Icon icon="ph:info-bold" className={styles.footerHintIcon} />
            <span>Always one click away, top right of the dossier.</span>
          </div>
          <div className={styles.actions}>
            <button className={styles.actionButton} onClick={handleClose}>
              <span>Got it</span>
              <Icon icon="ph:check-bold" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
