import { useMemo, useState, type ReactNode } from "react";
import type { Question } from "./types/Question";
import { Icon } from "@iconify/react";
import { useSettings } from "./components/SettingsProvider";
import styles from "./Questionaire.module.css";

interface QuestionaireProps {
  onQuestionaireCompleted: () => void;
  questions: Question[];
  answers: (Record<string, any> | null)[];
  setAnswers: (answers: (Record<string, any> | null)[]) => void;
}

type Answer = { id: number; text: string; icon?: string };
type IndexedQuestion = Question & { globalIndex: number };

type Section = {
  title: string;
  description?: string;
  icon: string;
  questions: IndexedQuestion[];
};

/** A well-mixed 32-bit string hash (djb2-ish), used both for a stable per-question answer order
 * and for a stable per-answer accent color. Accumulates fully before ever reducing to a small
 * range, unlike a naive `hash = (hash * k + c) % n` that mods on every character and collapses
 * short, similar strings ("Female" / "Non-binary") into near-identical results. */
function hashString(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/** Fixed display order for icon-chip answers, independent of each question's `id` assignment.
 *
 * `id: 0` is the scoring convention for "this is the correct answer" (`admin_service` checks
 * `additional_data[i]["id"] == 0`), and it's a different role for each of the six match-to-role
 * questions - so the *authored* array order necessarily varies per question (whichever role is
 * correct has to be id 0 in the JSON). Rendering answers in that raw order would put the correct
 * option in the same grid slot only by accident, and previously did so consistently for id 0
 * itself, which is the exact positional shortcut a guessability review flagged. A random or
 * seeded-random reorder hides that, but at the cost of the grid visibly rearranging itself
 * between questions - not what was wanted either.
 *
 * The actual fix: decouple display position from `id` entirely. Every option always renders in
 * this same fixed order, in every question, in both intro and outro - `id` continues to encode
 * which one is correct, unrelated to where it lands on screen. */
const ICON_ANSWER_ORDER = [
  "Business Stakeholder",
  "Subject Matter Expert",
  "Legal Expert",
  "Data Scientist",
  "Data Engineer",
  "ML Engineer",
  "DevOps Engineer",
];

/** Answers not in `ICON_ANSWER_ORDER` (every icon-chip question other than the six match-to-role
 * ones) all get the same fallback rank, so `orderForDisplay`'s stable sort leaves them in their
 * original, single-source-of-truth JSON order rather than reordering them. */
function iconAnswerRank(text: string): number {
  const i = ICON_ANSWER_ORDER.indexOf(text);
  return i === -1 ? ICON_ANSWER_ORDER.length : i;
}

function orderForDisplay<T extends { text: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => iconAnswerRank(a.text) - iconAnswerRank(b.text));
}

/** Picks a representative icon per section, keyed off its title text. Falls back to a generic
 * one so a future section title added to the config doesn't need a matching code change here. */
function iconForSection(title: string): string {
  const key = title.toLowerCase();
  if (key.includes("demographic")) return "ph:identification-card-duotone";
  if (key.includes("knowledge")) return "ph:brain-duotone";
  if (key.includes("perspective")) return "ph:users-three-duotone";
  if (key.includes("trade")) return "ph:scales-duotone";
  if (key.includes("reflection")) return "ph:chat-circle-dots-duotone";
  if (key.includes("persona") || key.includes("evaluation")) return "ph:star-duotone";
  if (key.includes("usability")) return "ph:sliders-horizontal-duotone";
  if (key.includes("feedback")) return "ph:megaphone-duotone";
  if (key.includes("learning")) return "ph:graduation-cap-duotone";
  return "ph:clipboard-text-duotone";
}

/** Renders `**bold**` markers (used in the knowledge-question answer bank to highlight the
 * distinguishing term) as <strong> spans. A no-op on plain text, so it's safe to apply broadly. */
function renderRich(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}

/** An "escape hatch" answer (Other / Prefer not to say / Prefer to self-describe) doesn't belong
 * on an ordinal scale or in an icon grid with the substantive options - it renders as a smaller
 * secondary pill beneath them instead, matching the pattern already used across the demographic
 * questions rather than a one-off per question. */
function isEscapeHatchAnswer(text: string): boolean {
  return /^(other|prefer not to say|prefer to self-describe)/i.test(text.trim());
}

/** Only "Other"/"...self-describe" escape hatches invite free text; "Prefer not to say" is a
 * plain opt-out and shouldn't pop a textbox open. */
function escapeHatchWantsNotes(text: string): boolean {
  return /^(other|prefer to self-describe)/i.test(text.trim());
}

/** A Likert item ("1 (Strongly Disagree)" ... "5 (Strongly Agree)", SUS and the self-efficacy
 * items) is auto-detected as a horizontal scale structurally (5 options, each starting with its
 * own ordinal) rather than via a config flag, so it renders the same way with no JSON change. */
function isAutoDetectedScale(question: Question): boolean {
  return question.answers.length === 5 && question.answers.every((a) => /^\d/.test(a.text.trim()));
}

/** For an explicit `layout: "scale"` question (an ordinal category, not an agree/disagree
 * item - MLOps familiarity, age range, connection to AI/ML), the bubble number is the option's
 * position and its full text is the caption, since the source text isn't digit-prefixed. For an
 * auto-detected Likert item, the number and caption are parsed out of the "N (Label)" text
 * itself, and only the labelled ends produce a caption. */
function scaleEntry(
  question: Question,
  answer: Answer,
  position: number
): { id: number; display: string; caption: string | null } {
  if (question.layout === "scale") {
    return { id: answer.id, display: String(position + 1), caption: answer.text };
  }
  const match = answer.text.trim().match(/^(\d+)\s*\(?([^)]*)\)?\s*$/);
  if (!match) return { id: answer.id, display: answer.text, caption: null };
  const label = match[2]?.trim();
  return { id: answer.id, display: match[1], caption: label ? label : null };
}

/** Splits a scale caption like "Basic understanding (concepts and terminology)" into a bold
 * headline and an italic parenthetical on its own line, so the ordinal label reads clearly at a
 * glance instead of as one dense run of text. Falls back to a plain bold render when there's no
 * parenthetical (e.g. "Under 18", "Strongly Agree"). */
function renderScaleCaption(text: string): ReactNode {
  const match = text.match(/^(.*?)\s*(\([^)]*\))\s*$/);
  if (!match) return <strong>{text}</strong>;
  const [, main, parenthetical] = match;
  return (
    <>
      <strong>{main}</strong>
      <br />
      <em>{parenthetical}</em>
    </>
  );
}

/** A stable accent color per icon-chip answer, keyed off its own text (not its position, which
 * varies per item/shuffle) so the same option always reads the same color wherever it appears -
 * e.g. "Data Engineer" is the same hue across every match-to-role question. Plain hash into an
 * HSL hue rather than a fixed palette, so it scales to however many options a question has. */
function chipAccent(text: string): string {
  const hue = hashString(text) % 360;
  return `hsl(${hue}, 58%, 42%)`;
}

/** Every question that offers a pick-one answer is required - there is no genuine "optional"
 * question left once every one of them that could reasonably be skipped already has its own
 * "Prefer not to say" (or "Other") option to pick instead. Only a pure free-text prompt with no
 * answer options at all (General Feedback) stays optional, since there's no equivalent opt-out
 * for open commentary. */
function isAnswerRequired(question: Question): boolean {
  return question.answers.length > 0;
}

function isQuestionAnswered(question: IndexedQuestion, answers: (Record<string, any> | null)[]): boolean {
  if (!isAnswerRequired(question)) return true;
  return answers[question.globalIndex]?.id !== undefined;
}

/** Groups the (already-shuffled) question list into sections by `title` boundary: a titled
 * question starts a new section, an untitled one joins the section before it. This is exactly
 * how EvaluationQuestions.json already models "Demographic Questions" / "Knowledge Questions" /
 * etc., so no change to the config schema was needed to paginate by category. */
function groupIntoSections(questions: IndexedQuestion[]): Section[] {
  const sections: Section[] = [];
  for (const q of questions) {
    if (q.title || sections.length === 0) {
      sections.push({
        title: q.title ?? "Questions",
        description: q.description,
        icon: iconForSection(q.title ?? "Questions"),
        questions: [q],
      });
    } else {
      sections[sections.length - 1].questions.push(q);
    }
  }
  return sections;
}

export default function Questionaire({
  onQuestionaireCompleted,
  questions,
  answers,
  setAnswers,
}: QuestionaireProps) {
  const { canPlaytest } = useSettings();
  const [step, setStep] = useState(0);
  // Dev builds only (`ENABLE_DOSSIER_DEBUG`) - `question.debug` is absent entirely otherwise, so
  // this state has nothing to toggle in a normal build. Several can be open at once, since a
  // section can hold more than one debug-eligible question.
  const [debugOpen, setDebugOpen] = useState<Set<number>>(new Set());
  const toggleDebug = (globalIndex: number) => {
    setDebugOpen((open) => {
      const next = new Set(open);
      if (next.has(globalIndex)) next.delete(globalIndex);
      else next.add(globalIndex);
      return next;
    });
  };

  const shuffledQuestions: IndexedQuestion[] = useMemo(() => {
    return questions.map((q, globalIndex) => ({
      ...q,
      globalIndex,
      // Icon-chip answers get a fixed display order (see `orderForDisplay`) applied at render
      // time instead, regardless of `id` - only the remaining plain-list knowledge questions are
      // randomized here.
      answers:
        q.knowledge_question && q.layout !== "icons"
          ? [...q.answers].sort(() => Math.random() - 0.5)
          : [...q.answers],
    }));
  }, [questions]);

  const sections = useMemo(() => groupIntoSections(shuffledQuestions), [shuffledQuestions]);

  const answeredCount = answers.filter(
    (a) => a !== null && a !== undefined && (a.id !== undefined || (a.notes && a.notes.trim().length > 0))
  ).length;

  if (questions.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={`card shadow-lg border-0 rounded-4 overflow-hidden ${styles.panel} ${styles.loadingPanel}`}>
          <div className={styles.header}>
            <h2 className={styles.headerTitle}>
              <Icon icon="ph:clipboard-text-duotone" style={{ color: "var(--secondary-bg)", fontSize: "1.8rem" }} />
              <span>MLOps Questionnaire</span>
            </h2>
          </div>
          <div className="p-5 text-center bg-white">
            <div
              className="spinner-border mx-auto mb-3"
              style={{ color: "var(--primary-bg)", width: "3rem", height: "3rem" }}
              role="status"
            >
              <span className="visually-hidden">Loading...</span>
            </div>
            <h5 className="mb-2 fw-bold text-dark">Retrieving Questions...</h5>
            <p className="text-secondary mb-0 small">Please wait while the questionnaire is loaded.</p>
          </div>
        </div>
      </div>
    );
  }

  const safeStep = Math.min(step, sections.length - 1);
  const currentSection = sections[safeStep];
  const isLastStep = safeStep === sections.length - 1;
  const currentSectionComplete = currentSection.questions.every((q) => isQuestionAnswered(q, answers));
  const allComplete = shuffledQuestions.every((q) => isQuestionAnswered(q, answers));
  const firstIncompleteSectionIndex = sections.findIndex(
    (s) => !s.questions.every((q) => isQuestionAnswered(q, answers))
  );

  const setAnswerId = (globalIndex: number, id: number) => {
    const _answers = [...answers];
    _answers[globalIndex] = { id, notes: _answers[globalIndex]?.notes ?? "" };
    setAnswers(_answers);
  };

  const setAnswerNotes = (globalIndex: number, notes: string) => {
    const _answers = [...answers];
    _answers[globalIndex] = { ..._answers[globalIndex], notes };
    setAnswers(_answers);
  };

  return (
    <div className={styles.wrapper}>
      <div className={`card shadow-lg border-0 rounded-4 overflow-hidden ${styles.panel}`}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>
            <Icon icon="ph:clipboard-text-duotone" style={{ color: "var(--secondary-bg)", fontSize: "1.8rem" }} />
            <span>MLOps Questionnaire</span>
          </h2>
          <span className={styles.headerBadge}>
            {answeredCount} / {questions.length} Answered
          </span>
        </div>

        {/* Stepper */}
        <div className={styles.stepper}>
          {sections.map((section, i) => (
            <button
              key={i}
              type="button"
              className={`${styles.stepDot} ${i === safeStep ? styles.stepDotActive : ""} ${
                i < safeStep ? styles.stepDotDone : ""
              }`}
              onClick={() => setStep(i)}
              title={section.title}
            >
              <Icon icon={section.icon} />
            </button>
          ))}
          <div className={styles.stepperTrack}>
            <div
              className={styles.stepperProgress}
              style={{ width: `${(safeStep / Math.max(sections.length - 1, 1)) * 100}%` }}
            />
          </div>
        </div>

        {/* Body */}
        <div className={styles.body} key={safeStep}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionIconBadge}>
              <Icon icon={currentSection.icon} />
            </span>
            <div>
              <p className={styles.sectionEyebrow}>
                Section {safeStep + 1} of {sections.length}
              </p>
              <h3 className={styles.sectionTitle}>{currentSection.title}</h3>
              {currentSection.description && (
                <p className={styles.sectionDescription}>{currentSection.description}</p>
              )}
            </div>
          </div>

          {/* Questions in this section */}
          <div>
            {currentSection.questions.map((question) => {
              const index = question.globalIndex;
              const hasAnswers = question.answers && question.answers.length > 0;
              const primaryAnswers = hasAnswers ? question.answers.filter((a) => !isEscapeHatchAnswer(a.text)) : [];
              const escapeAnswers = hasAnswers ? question.answers.filter((a) => isEscapeHatchAnswer(a.text)) : [];
              const useScale = hasAnswers && (question.layout === "scale" || isAutoDetectedScale(question));
              const useIcons = hasAnswers && question.layout === "icons" && !useScale;
              const selectedAnswer = answers[index];
              const selectedEscape = escapeAnswers.find((a) => a.id === selectedAnswer?.id);
              const showInlineNotes = question.notes && selectedEscape && escapeHatchWantsNotes(selectedEscape.text);
              const showUnconditionalNotes = question.notes && escapeAnswers.length === 0;
              const isDebugOpen = debugOpen.has(index);
              const isDebugAnswer = (answerId: number) =>
                isDebugOpen && question.debug != null && question.debug.correct_id === answerId;

              return (
                <div className={styles.questionCard} key={index}>
                  <div className={styles.questionPromptRow}>
                    <span className={styles.questionNumberPill}>Q{index + 1}</span>
                    <p className={styles.questionText}>{renderRich(question.question)}</p>
                    {question.debug && (
                      <button
                        type="button"
                        className={styles.debugToggle}
                        onClick={() => toggleDebug(index)}
                        title={`Debug: correct answer is "${question.debug.correct_text}"`}
                        aria-label="Toggle answer key (debug)"
                      >
                        <Icon icon="ph:key-duotone" />
                      </button>
                    )}
                  </div>

                  {isDebugOpen && question.debug && (
                    <div className={styles.debugPanel}>
                      Answer key: <span className={styles.debugRightText}>{question.debug.correct_text}</span>
                    </div>
                  )}

                  {hasAnswers && useScale && (
                    <div className={styles.likertScale}>
                      <div className={styles.likertTrack} />
                      <div className={styles.likertOptions}>
                        {primaryAnswers.map((answer, position) => {
                          const { display, caption } = scaleEntry(question, answer, position);
                          const isSelected = selectedAnswer?.id === answer.id;
                          return (
                            <label
                              key={answer.id}
                              className={`${styles.likertOption} ${isDebugAnswer(answer.id) ? styles.debugCorrect : ""}`}
                              htmlFor={`q${index}-a${answer.id}`}
                            >
                              <input
                                className={styles.likertRadioHidden}
                                type="radio"
                                name={`question-${index}`}
                                id={`q${index}-a${answer.id}`}
                                value={answer.id}
                                checked={isSelected}
                                onChange={() => setAnswerId(index, answer.id)}
                              />
                              <span className={`${styles.likertBubble} ${isSelected ? styles.likertBubbleSelected : ""}`}>
                                {display}
                              </span>
                              <span className={styles.likertCaption}>
                                {caption ? renderScaleCaption(caption) : " "}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {hasAnswers && useIcons && (
                    <div
                      className={styles.iconGrid}
                      style={{ ["--icon-cols" as any]: primaryAnswers.length }}
                    >
                      {orderForDisplay(primaryAnswers).map((answer) => {
                        const isSelected = selectedAnswer?.id === answer.id;
                        return (
                          <label
                            key={answer.id}
                            className={`${styles.iconChip} ${isSelected ? styles.iconChipSelected : ""} ${
                              isDebugAnswer(answer.id) ? styles.debugCorrect : ""
                            }`}
                            htmlFor={`q${index}-a${answer.id}`}
                            style={{ ["--chip-accent" as any]: chipAccent(answer.text) }}
                          >
                            <input
                              className={styles.likertRadioHidden}
                              type="radio"
                              name={`question-${index}`}
                              id={`q${index}-a${answer.id}`}
                              value={answer.id}
                              checked={isSelected}
                              onChange={() => setAnswerId(index, answer.id)}
                            />
                            <Icon icon={answer.icon ?? "ph:circle-duotone"} className={styles.iconChipGlyph} />
                            <span className={styles.iconChipLabel}>{renderRich(answer.text)}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {hasAnswers && !useScale && !useIcons && (
                    <div className={styles.optionsList}>
                      {primaryAnswers.map((answer) => {
                        const isSelected = selectedAnswer?.id === answer.id;
                        return (
                          <label
                            key={answer.id}
                            className={`${styles.optionItem} ${isSelected ? styles.optionItemSelected : ""} ${
                              isDebugAnswer(answer.id) ? styles.debugCorrect : ""
                            }`}
                            htmlFor={`q${index}-a${answer.id}`}
                          >
                            <input
                              className={styles.optionRadio}
                              type="radio"
                              name={`question-${index}`}
                              id={`q${index}-a${answer.id}`}
                              value={answer.id}
                              checked={isSelected}
                              onChange={() => setAnswerId(index, answer.id)}
                            />
                            <span className={styles.optionText}>{renderRich(answer.text)}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {escapeAnswers.length > 0 && (
                    <div className={styles.escapeHatchRow}>
                      {escapeAnswers.map((answer) => {
                        const isSelected = selectedAnswer?.id === answer.id;
                        return (
                          <label
                            key={answer.id}
                            className={`${styles.escapeHatchPill} ${isSelected ? styles.escapeHatchPillSelected : ""}`}
                            htmlFor={`q${index}-a${answer.id}`}
                          >
                            <input
                              className={styles.likertRadioHidden}
                              type="radio"
                              name={`question-${index}`}
                              id={`q${index}-a${answer.id}`}
                              value={answer.id}
                              checked={isSelected}
                              onChange={() => setAnswerId(index, answer.id)}
                            />
                            {answer.icon && <Icon icon={answer.icon} />}
                            <span>{answer.text}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {(showInlineNotes || showUnconditionalNotes) && (
                    <div className={styles.notesWrapper}>
                      <label className={styles.notesLabel} htmlFor={`q${index}-notes`}>
                        <Icon icon="ph:note-pencil-duotone" />
                        <span>Additional notes / custom answer:</span>
                      </label>
                      <input
                        id={`q${index}-notes`}
                        type="text"
                        className={styles.notesControl}
                        placeholder="Enter your notes or custom explanation here..."
                        value={answers[index]?.notes ?? ""}
                        onChange={(e) => setAnswerNotes(index, e.target.value)}
                      />
                    </div>
                  )}

                  {question.inputField && (
                    <div className={styles.notesWrapper}>
                      <label className={styles.notesLabel} htmlFor={`q${index}-inputField`}>
                        <Icon icon="ph:chat-teardrop-text-duotone" />
                        <span>Detailed explanation:</span>
                      </label>
                      <textarea
                        id={`q${index}-inputField`}
                        rows={4}
                        className={styles.notesControl}
                        placeholder="Type your detailed explanation or answer here..."
                        value={answers[index]?.notes ?? ""}
                        onChange={(e) => setAnswerNotes(index, e.target.value)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Validation hint */}
          {!isLastStep && !currentSectionComplete && (
            <p className={styles.validationHint} role="status">
              <Icon icon="ph:warning-circle-duotone" />
              <span>Please answer every question on this page before continuing.</span>
            </p>
          )}
          {isLastStep && !allComplete && (
            <p className={styles.validationHint} role="status">
              <Icon icon="ph:warning-circle-duotone" />
              {currentSectionComplete ? (
                <span>
                  Some earlier questions still need an answer.{" "}
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() => setStep(firstIncompleteSectionIndex)}
                  >
                    Take me there
                  </button>
                </span>
              ) : (
                <span>Please answer every question on this page before submitting.</span>
              )}
            </p>
          )}

          {/* Action Area */}
          <div className={styles.actionArea}>
            <button
              type="button"
              className={`d-flex align-items-center justify-content-center gap-2 ${styles.navButton}`}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={safeStep === 0}
            >
              <Icon icon="ph:arrow-left-duotone" />
              <span>Back</span>
            </button>

            {isLastStep ? (
              <button
                type="button"
                className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton} ${
                  allComplete ? styles.actionButtonNudge : ""
                }`}
                onClick={onQuestionaireCompleted}
                disabled={!allComplete}
              >
                <span>Submit Questionnaire</span>
                <Icon icon="ph:check-circle-duotone" className={styles.actionButtonArrow} />
              </button>
            ) : (
              <button
                type="button"
                className={`d-flex align-items-center justify-content-center gap-2 ${styles.actionButton} ${
                  currentSectionComplete ? styles.actionButtonNudge : ""
                }`}
                onClick={() => setStep((s) => Math.min(sections.length - 1, s + 1))}
                disabled={!currentSectionComplete}
              >
                <span>Next</span>
                <Icon icon="ph:arrow-right-duotone" className={styles.actionButtonArrow} />
              </button>
            )}
          </div>

          {canPlaytest && (
            <div className={styles.actionArea}>
              <button type="button" className={styles.linkButton} onClick={onQuestionaireCompleted}>
                Skip questionnaire (playtest)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
