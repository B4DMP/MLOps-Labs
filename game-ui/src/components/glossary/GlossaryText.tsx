import React, { Children, Fragment, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import GlossaryTermMark from "./GlossaryTermMark";
import { useGlossary } from "./GlossaryProvider";
import type { GlossarySurface } from "../../services/api/glossary";

/**
 * Returns a function that turns a plain string into React nodes with the glossary terms in it
 * highlighted, or leaves the string untouched when this surface has highlighting switched off.
 *
 * Both vocabularies are matched in the same pass, so a word is highlighted once and the longest
 * reading wins: "distribution centre" is the warehouse, a bare "distribution" is the statistical
 * one. Which glossary a term came from shows in its underline, not in the words themselves.
 */
export function useGlossaryHighlighter(surface: GlossarySurface) {
  const { matcherFor, isSurfaceEnabled } = useGlossary();
  const enabled = isSurfaceEnabled(surface);
  const matcher = matcherFor(surface);

  return useCallback(
    (text: string): React.ReactNode => {
      if (!enabled || !text) return text;

      const matches = matcher.findMatches(text);
      if (matches.length === 0) return text;

      const nodes: React.ReactNode[] = [];
      let cursor = 0;

      matches.forEach((match, index) => {
        if (match.start > cursor) {
          nodes.push(text.slice(cursor, match.start));
        }
        nodes.push(
          <GlossaryTermMark
            key={`${match.entry.kind}-${match.term.id}-${match.start}-${index}`}
            term={match.term}
            category={match.entry.category}
            underlineStyle={match.entry.underlineStyle}
          >
            {match.matched}
          </GlossaryTermMark>
        );
        cursor = match.end;
      });

      if (cursor < text.length) {
        nodes.push(text.slice(cursor));
      }

      return <>{nodes}</>;
    },
    [enabled, matcher]
  );
}

interface GlossaryTextProps {
  /** The sentence to render. Anything that is not a string is passed straight through. */
  text?: string | null;
  surface: GlossarySurface;
  /** Optional wrapper element. Without it the highlighted runs are returned inline. */
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Drop-in replacement for rendering a string of game text.
 *
 * `{item.description}` becomes `<GlossaryText text={item.description} surface="intel_notes" />`
 * and nothing else about the surrounding markup has to change.
 */
export default function GlossaryText({ text, surface, as, className, style }: GlossaryTextProps) {
  const highlight = useGlossaryHighlighter(surface);
  const content = highlight(text ?? "");

  if (!as) {
    return <>{content}</>;
  }

  const Wrapper = as as React.ElementType;
  return (
    <Wrapper className={className} style={style}>
      {content}
    </Wrapper>
  );
}

/**
 * Walks the children react-markdown hands a block element and highlights the bare strings among
 * them. Nested elements are left alone: they are rendered by their own overridden component,
 * which highlights its own strings in turn.
 */
function highlightChildren(
  children: React.ReactNode,
  highlight: (text: string) => React.ReactNode
): React.ReactNode {
  return Children.map(children, (child, index) => {
    if (typeof child === "string") {
      return <Fragment key={index}>{highlight(child)}</Fragment>;
    }
    return child;
  });
}

interface GlossaryMarkdownProps {
  content: string;
  surface: GlossarySurface;
}

/**
 * Markdown with glossary highlighting inside the prose.
 *
 * Only text-bearing block and inline elements are overridden, which leaves `code` and `pre`
 * untouched on purpose: a term inside a code sample is a literal, not a concept to explain.
 */
export function GlossaryMarkdown({ content, surface }: GlossaryMarkdownProps) {
  const highlight = useGlossaryHighlighter(surface);
  const { isSurfaceEnabled } = useGlossary();
  const enabled = isSurfaceEnabled(surface);

  const components = useMemo(() => {
    if (!enabled) return undefined;

    const wrap =
      (Tag: keyof React.JSX.IntrinsicElements) =>
      ({ node: _node, children, ...props }: any) => {
        const Element = Tag as React.ElementType;
        return <Element {...props}>{highlightChildren(children, highlight)}</Element>;
      };

    return {
      p: wrap("p"),
      li: wrap("li"),
      td: wrap("td"),
      th: wrap("th"),
      strong: wrap("strong"),
      em: wrap("em"),
      blockquote: wrap("blockquote"),
      h1: wrap("h1"),
      h2: wrap("h2"),
      h3: wrap("h3"),
      h4: wrap("h4"),
      h5: wrap("h5"),
      h6: wrap("h6"),
    };
  }, [enabled, highlight]);

  return <Markdown components={components}>{content}</Markdown>;
}
