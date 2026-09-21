import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import styles from "./Glossary.module.css";
import type {
  GlossaryCategory,
  GlossaryTerm,
  GlossaryUnderlineStyle,
} from "../../services/api/glossary";

/** Breathing room kept between the card and both the word and the viewport edge. */
const EDGE_MARGIN = 10;

interface GlossaryTermMarkProps {
  /** The words exactly as the author wrote them; the highlight never rewrites the sentence. */
  children: string;
  term: GlossaryTerm;
  category?: GlossaryCategory;
  /**
   * The underline of the glossary this term came from: dotted for the MLOps practice, wavy for
   * the world the game is set in. It is the only thing that distinguishes the two at a glance,
   * so it is carried rather than inferred.
   */
  underlineStyle?: GlossaryUnderlineStyle;
}

/**
 * One highlighted word or phrase plus its explanation card.
 *
 * The mark is deliberately inert as a control: it has no click handler and never stops
 * propagation, so a term sitting inside a clickable sticky note, chat bubble or speech bubble
 * leaves that interaction exactly as it was. Pointer events open the card, keyboard focus opens
 * it too, and the card itself is `pointer-events: none` so it can never swallow a click aimed at
 * whatever it happens to be floating over.
 */
export default function GlossaryTermMark({
  children,
  term,
  category,
  underlineStyle = "dotted",
}: GlossaryTermMarkProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const anchorRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const anchorRectRef = useRef<DOMRect | null>(null);

  const accent = category?.color || "#6366f1";

  // pointerenter/leave rather than mouseenter/leave: a tap on a touch device fires them too,
  // so the card is reachable there without adding a click handler that would fight the parent.
  const handleOpen = () => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      anchorRectRef.current = rect;
      setCoords({ top: rect.bottom + EDGE_MARGIN, left: rect.left + rect.width / 2 });
    }
    setIsOpen(true);
  };

  const handleClose = () => setIsOpen(false);

  // Flip above the word when the card would run off the bottom, and keep the horizontally
  // centred box inside the viewport. Same measurement approach as HoverToolTip.
  useLayoutEffect(() => {
    if (!isOpen || !cardRef.current || !anchorRectRef.current) return;

    const anchor = anchorRectRef.current;
    const box = cardRef.current.getBoundingClientRect();

    let top = anchor.bottom + EDGE_MARGIN;
    if (top + box.height > window.innerHeight - EDGE_MARGIN) {
      const above = anchor.top - EDGE_MARGIN - box.height;
      top =
        above >= EDGE_MARGIN
          ? above
          : Math.max(EDGE_MARGIN, window.innerHeight - EDGE_MARGIN - box.height);
    }

    const half = box.width / 2;
    const left = Math.min(
      Math.max(anchor.left + anchor.width / 2, EDGE_MARGIN + half),
      window.innerWidth - EDGE_MARGIN - half
    );

    setCoords((prev) => (prev.top === top && prev.left === left ? prev : { top, left }));
  }, [isOpen, term.id]);

  return (
    <span
      ref={anchorRef}
      className={styles.termMark}
      style={{
        ["--glossary-accent" as string]: accent,
        ["--glossary-underline" as string]: underlineStyle,
      }}
      data-glossary-term={term.id}
      data-glossary-underline={underlineStyle}
      onPointerEnter={handleOpen}
      onPointerLeave={handleClose}
      onFocus={handleOpen}
      onBlur={handleClose}
      tabIndex={0}
      role="note"
      aria-label={`${term.term}: ${term.definition}`}
    >
      {children}

      {isOpen &&
        createPortal(
          <div
            ref={cardRef}
            className={styles.termCard}
            style={{
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              ["--glossary-accent" as string]: accent,
              ["--glossary-underline" as string]: underlineStyle,
            }}
            role="tooltip"
          >
            <div className={styles.termCardHeader}>
              <span className={styles.termCardTitle}>{term.term}</span>
              {category && (
                <span className={styles.termCardCategory}>
                  {category.icon && <Icon icon={category.icon} className={styles.termCardCategoryIcon} />}
                  {category.label}
                </span>
              )}
            </div>

            <div className={styles.termCardDefinition}>{term.definition}</div>

            {term.why_it_matters && (
              <div className={styles.termCardWhy}>
                <Icon icon="ph:lightbulb-filament-bold" className={styles.termCardWhyIcon} />
                <span>{term.why_it_matters}</span>
              </div>
            )}

            {term.read_more && <div className={styles.termCardReadMore}>{term.read_more}</div>}
          </div>,
          document.body
        )}
    </span>
  );
}
