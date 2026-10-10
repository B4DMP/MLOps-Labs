import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { EmojiIcon } from "../utils/emojiIcons";
import { submitBugReport } from "../services/api/bugReports";
import styles from "./CheatSheetModal.module.css";
import HoverTooltip from "./HoverToolTip";
import { INTEL_TAGS } from "../types/IntelTag";
import { useSpeech } from "./useSpeech";
import { startTour } from "../utils/tour";
import { useNarratorGate } from "./useNarratorGate";
import { TOUR_GUIDE_SEED } from "../utils/speech";
import { waitForCoachClear } from "../utils/introCoach";
import { AUTOMATION_META, GOVERNANCE_META } from "../utils/stageCanvas";
import { resetComposeGuide } from "../utils/composeGuide";
import { GRAPH_DEFINITIONS, GRAPH_EXAMPLE } from "../content/graphHelp";

/** Which intro.js tour group each section's "Replay Demo" button reopens. Only sections that
 * were actually covered by the phase-0 walkthrough get the button - sections without an entry
 * here (e.g. "Report Bug") simply don't show one. */
const SECTION_TOUR_GROUP: Record<string, string> = {
  Briefing: "intro2",
  "This Dossier": "introDossier",
  "Digging for Intel": "introDossier",
  "Pitch & Debate": "introPitch",
  Simulate: "introSimulate",
};

type CheatSheetTab = "guide" | "graph" | "bug";

/** Plain option names for each rung, matching the composer's legend swatches. */
const GRAPH_AUTOMATION_STEPS = [
  { name: "Not built yet", meta: AUTOMATION_META[1] },
  { name: "Implement It Manually", meta: AUTOMATION_META[2] },
  { name: "Automate It", meta: AUTOMATION_META[3] },
];
const GRAPH_GOVERNANCE_STEPS = [
  { name: "No review", meta: GOVERNANCE_META[0] },
  { name: "A review step, named per component (Spot Checks, Second Review, ...)", meta: GOVERNANCE_META[3] },
];

const MAX_BUG_MESSAGE_LENGTH = 4000;

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
  /** Debug context attached to a bug report filed from the "Report Bug" tab. */
  username?: string;
  currentPhase?: number;
  currentChallenge?: number;
  challengeTitle?: string;
  /** Tab to show on open. Defaults to the guide. */
  initialTab?: CheatSheetTab;
  /** True while the pitch composer is mounted, so its guide can be replayed from here. */
  canReplayComposerGuide?: boolean;
  /** Player id, so a replay can reset the composer guide's seen flags. */
  userId?: number | null;
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
  { label: "CONFIRMED", styleKey: "verified", detail: "You verified it yourself, talking to them." },
  { label: "★ ON RECORD", styleKey: "onRecord", detail: "They said it in the open. Nothing to confirm." },
];

/** Mirrors gameConfig/GameEngagementCards.json's cards, in that file's order. */
const ENGAGEMENT_CARD_LEGEND: { icon: string; label: string; detail: string }[] = [
  { icon: "ph:certificate-duotone", label: "Verify Intel Item", detail: "Fact-check one unconfirmed note." },
  { icon: "ph:user-focus-bold", label: "Investigate Component", detail: "Ask one stakeholder about their top requirement or a component. Can target the same stakeholder again." },
  { icon: "ph:users-bold", label: "Team Sync-Up", detail: "Ask everyone at once. Once per phase." },
  { icon: "ph:hourglass-simple-bold", label: "Patience-Reset", detail: "Fully reset one impatient stakeholder's patience." },
  { icon: "ph:megaphone-bold", label: "Pep-Talk", detail: "Small mood lift for the whole room. Once per phase." },
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
      "Challenge-Intel holds facts about the pipeline itself, not anyone's wishes.",
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
      "Build your proposal at the PITCH DECK: up to 4 changes to the pipeline.",
      <>
        Intel chip: <EmojiIcon name="dotGreen" /> ready to pitch, <EmojiIcon name="dotYellow" /> still thin,{" "}
        <EmojiIcon name="dotRed" /> not enough yet.
        <br />
        Verified intel turns it green.
      </>,
      <>
        High-power stakeholder can <EmojiIcon name="vetoStrip" /> veto if you crossed a boundary or skipped a driver.
      </>,
      <>
        After a veto: revise the card and re-pitch, or <EmojiIcon name="power" /> Push It Through with an Escalation
        Point (3 for the whole game, never refill). The stakeholder who vetoed you will remember it. Push It
        Through is not available in the introduction, so there a veto means going back and fixing the card.
      </>,
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

export default function CheatSheetModal({
  isOpen,
  onClose,
  activeSectionTitle,
  username,
  currentPhase,
  currentChallenge,
  challengeTitle,
  initialTab = "guide",
  canReplayComposerGuide = false,
  userId,
}: CheatSheetModalProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [poppingTitle, setPoppingTitle] = useState<string | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const { speak: speakTts } = useSpeech();
  const gate = useNarratorGate();

  const [activeTab, setActiveTab] = useState<CheatSheetTab>(initialTab);
  const [bugMessage, setBugMessage] = useState("");
  const [bugStatus, setBugStatus] = useState<"idle" | "submitting" | "sent" | "error">("idle");
  const [bugError, setBugError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setIsClosing(false);
      setActiveTab(initialTab);
      setBugMessage("");
      setBugStatus("idle");
      setBugError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  /** Closes the sheet, then replays `group`'s tour. */
  const handleReplayDemo = (group: string) => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
      startTour(group, { beforeStart: async () => { await waitForCoachClear(); return gate.request(); }, narrate: (text) => speakTts(text, { slot: "narrator", seed: TOUR_GUIDE_SEED }) });
    }, 200);
  };

  /** Closes the sheet, then restarts the composer guide (the mounted composer picks the reset up). */
  const handleReplayComposerGuide = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
      resetComposeGuide(userId);
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

  const handleBugSubmit = async () => {
    if (!bugMessage.trim() || bugStatus === "submitting") return;
    setBugStatus("submitting");
    setBugError(null);
    try {
      await submitBugReport({
        message: bugMessage.trim(),
        debugInfo: {
          timestamp: new Date().toISOString(),
          username,
          currentPhase,
          currentChallenge,
          challengeTitle,
          userAgent: navigator.userAgent,
        },
      });
      setBugStatus("sent");
    } catch (e) {
      setBugStatus("error");
      setBugError(e instanceof Error ? e.message : "Could not submit your bug report.");
    }
  };

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
          <HoverTooltip description="Close (Esc)">
            <button
              type="button"
              className="btn-close btn-close-white"
              onClick={handleClose}
              aria-label="Close"
              style={{ cursor: "pointer" }}
            />
          </HoverTooltip>
        </div>

        <div className={styles.tabBar}>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "guide" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("guide")}
          >
            <Icon icon="ph:question-bold" />
            <span>Guide</span>
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "graph" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("graph")}
          >
            <Icon icon="ph:graph-bold" />
            <span>MLOps Graph</span>
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "bug" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("bug")}
          >
            <Icon icon="ph:bug-bold" />
            <span>Report Bug</span>
          </button>
        </div>

        {activeTab === "graph" ? (
          <div className={styles.modalBody}>
            <div className={styles.card} style={{ ["--accent" as string]: "#0284c7" }}>
              <div className={styles.cardHeader}>
                <Icon icon="ph:graph-bold" className={styles.cardIcon} />
                <span>What the graph means</span>
              </div>
              <ul className={styles.bulletList}>
                {GRAPH_DEFINITIONS.map((d) => (
                  <li key={d.term}>
                    <strong>{d.term}:</strong> {d.text}
                  </li>
                ))}
              </ul>
              <div className={styles.tagLegend}>
                <div className={styles.legendLabel}>Automation steps (who does the work)</div>
                {GRAPH_AUTOMATION_STEPS.map((step) => (
                  <div key={step.name} className={styles.tagChip}>
                    <span className={styles.rungSwatch} style={{ background: step.meta.color }} />
                    <span className={styles.tagChipLabel}>{step.name}</span>
                  </div>
                ))}
                <div className={styles.legendLabel}>Governance steps (who checks the work)</div>
                {GRAPH_GOVERNANCE_STEPS.map((step) => (
                  <div key={step.name} className={styles.tagChip}>
                    <span className={styles.rungSwatch} style={{ background: step.meta.color }} />
                    <span className={styles.tagChipLabel}>{step.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.card} style={{ ["--accent" as string]: "#d97706" }}>
              <div className={styles.cardHeader}>
                <Icon icon="ph:honey-bold" className={styles.cardIcon} />
                <span>{GRAPH_EXAMPLE.title}</span>
              </div>
              <ul className={styles.bulletList}>
                {GRAPH_EXAMPLE.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
              {currentPhase === 0 && canReplayComposerGuide ? (
                <HoverTooltip description="Replay the guide in the composer">
                  <button
                    type="button"
                    className={styles.replayDemoButton}
                    onClick={handleReplayComposerGuide}
                  >
                    <Icon icon="ph:play-circle-bold" />
                    <span>Replay graph walkthrough</span>
                  </button>
                </HoverTooltip>
              ) : currentPhase === 0 ? (
                <div className={styles.glyphLine}>
                  <span>Open the Pitch Deck, then press ? in the composer to replay the walkthrough.</span>
                  <button type="button" className={styles.replayDemoButton} onClick={handleClose}>
                    <Icon icon="ph:x-circle-bold" />
                    <span>Close this sheet</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : activeTab === "bug" ? (
          <div className={styles.modalBody}>
            {bugStatus === "sent" ? (
              <p className={styles.successText}>
                <Icon icon="ph:check-circle-bold" />
                Thanks, we got it. We'll take a look.
              </p>
            ) : (
              <>
                <p className={styles.intro}>
                  Ran into something broken or confusing? Describe what happened and what you
                  expected instead.
                </p>
                <textarea
                  className={styles.textarea}
                  value={bugMessage}
                  maxLength={MAX_BUG_MESSAGE_LENGTH}
                  placeholder="What went wrong?"
                  onChange={(e) => setBugMessage(e.target.value)}
                />
                <div className={styles.debugSummary}>
                  <span>Sent along automatically: timestamp, username, current phase/challenge, page URL.</span>
                </div>
                {bugStatus === "error" && <p className={styles.errorText}>{bugError}</p>}
              </>
            )}
          </div>
        ) : (
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
                {section.title === activeSectionTitle && SECTION_TOUR_GROUP[section.title] && (
                  <HoverTooltip description="Replay the guided walkthrough for this screen">
                    <button
                      type="button"
                      className={styles.replayDemoButton}
                      onClick={() => handleReplayDemo(SECTION_TOUR_GROUP[section.title])}
                    >
                      <Icon icon="ph:play-circle-bold" />
                      <span>Replay Demo</span>
                    </button>
                  </HoverTooltip>
                )}
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
                        {stamp.styleKey === "verified" && <Icon icon="ph:certificate-duotone" style={{ verticalAlign: "-0.15em" }} />}
                        {stamp.styleKey === "verified" ? " " : ""}{stamp.label}
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
        )}

        <div className={styles.footer}>
          {activeTab === "bug" ? (
            bugStatus === "sent" ? (
              <div className={styles.actions}>
                <button className={styles.actionButton} onClick={handleClose}>
                  <span>Done</span>
                  <Icon icon="ph:check-bold" />
                </button>
              </div>
            ) : (
              <div className={styles.actions} style={{ justifyContent: "flex-end", gap: "0.6rem", width: "100%" }}>
                <button className={styles.secondaryButton} onClick={handleClose}>
                  Cancel
                </button>
                <button
                  className={styles.actionButton}
                  onClick={handleBugSubmit}
                  disabled={!bugMessage.trim() || bugStatus === "submitting"}
                >
                  <span>{bugStatus === "submitting" ? "Sending…" : "Send Report"}</span>
                  {bugStatus !== "submitting" && <Icon icon="ph:paper-plane-tilt-bold" />}
                </button>
              </div>
            )
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
