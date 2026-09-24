import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { splitSentences } from "../utils/speech";
import styles from "./SpokenText.module.css";

export interface SpokenTextProps {
  text: string;
  /** null when nothing is currently being narrated for this text (muted, finished, not started) -
   * renders plain, fully-opaque text with no highlight or dimming in that case. */
  activeSentenceIndex: number | null;
  className?: string;
  /** Renders a sentence's core text (leading/trailing whitespace is handled outside this). Plain
   * text by default; a caller with richer content (e.g. markdown + glossary term highlighting)
   * can pass its own renderer so sentence-highlighting and that formatting both survive. */
  renderSentence?: (sentenceCore: string) => ReactNode;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

interface RenderedSentence {
  /** Leading/trailing whitespace kept as plain text nodes so the natural spacing between
   * sentences survives, rather than collapsing into a single joiner. */
  leading: string;
  core: string;
  trailing: string;
}

/** Splits `text` into sentences with the same filtering `chunkText` applies (dropping ones that
 * are empty once trimmed), so index N here always means the same sentence as `onSentence`'s
 * `index: N` from `speak()`/`speakAuto()`. */
function toRenderedSentences(text: string): RenderedSentence[] {
  return splitSentences(text)
    .map((raw) => {
      const leading = raw.match(/^\s*/)?.[0] ?? "";
      const trailing = raw.match(/\s*$/)?.[0] ?? "";
      const core = raw.slice(leading.length, raw.length - trailing.length);
      return { leading, core, trailing };
    })
    .filter((s) => s.core.length > 0);
}

/**
 * Renders `text` as one span per sentence: the sentence at `activeSentenceIndex` and everything
 * already spoken stay full-opacity dark text with a blinking caret marking where narration
 * currently is, while sentences still to come stay dimmed until narration reaches them. Safe to
 * use any time, including when nothing is currently narrating (`activeSentenceIndex: null`) - it
 * then just renders the plain text, which makes it usable as the default way this codebase
 * renders any narrated paragraph, not only while actively speaking.
 */
export default function SpokenText({ text, activeSentenceIndex, className, renderSentence }: SpokenTextProps) {
  const sentences = useMemo(() => toRenderedSentences(text), [text]);
  const reducedMotion = usePrefersReducedMotion();

  const containerClassName = className ? `${styles.container} ${className}` : styles.container;

  if (activeSentenceIndex == null) {
    return <span className={containerClassName}>{renderSentence ? renderSentence(text) : text}</span>;
  }

  return (
    <span className={containerClassName}>
      {sentences.map((sentence, index) => {
        const isActive = index === activeSentenceIndex;
        const isSpokenOrActive = index <= activeSentenceIndex;

        return (
          <motion.span
            key={index}
            data-spoken-state={isActive ? "active" : isSpokenOrActive ? "spoken" : "upcoming"}
            className={isActive ? styles.active : isSpokenOrActive ? styles.spoken : styles.upcoming}
            initial={false}
            // The dim -> full-opacity lift only actually animates for a sentence crossing from
            // "upcoming" into "spoken"/"active" (that's the only time these values change);
            // already-settled sentences just keep re-rendering the same target values.
            animate={{ opacity: isSpokenOrActive ? 1 : 0.42, y: isSpokenOrActive ? 0 : 2 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.35, ease: "easeOut" }}
          >
            {sentence.leading}
            {renderSentence ? renderSentence(sentence.core) : sentence.core}
            {isActive && <span className={styles.caret} aria-hidden="true" />}
            {sentence.trailing}
          </motion.span>
        );
      })}
    </span>
  );
}
