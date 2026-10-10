import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import StakeholderAvatarComponent from "./StakeholderAvatarComponent";
import HoverTooltip from "./HoverToolTip";
import type { AvatarEmotion, StakeholderAvatar } from "../types/StakeholderAvatar";
import {
  THREAD_KINDS, THREAD_META, resultMessage,
  type BoardState, type BoardThread, type ThreadKind,
} from "../types/CaseBoard";
import {
  BOARD_H, BOARD_W, layoutPortraits, portraitAt, threadGeometry,
  type Place, type Point,
} from "../utils/caseBoardLayout";
import type { BoardOutcome } from "./useCaseBoard";
import styles from "./CaseBoard.module.css";

export interface BoardPortrait {
  id: string;
  name: string;
  color: string;
  avatar?: StakeholderAvatar;
  face: AvatarEmotion;
  highPower: boolean;
}

/** What the board hands the dossier's summary: which notes to show, who is lit, and the pencil marks. */
export interface SummaryContext {
  /** Show only these note ids (null: all of them). */
  onlyIds: ReadonlySet<string> | null;
  /** The person hovered on the board or in the summary; their rows and portrait are lit. */
  activeStakeholder: string | null;
  onActiveStakeholder: (id: string | null) => void;
  /** Notes the player has penciled in as covered by their pitch. */
  penciled: ReadonlySet<string>;
  onTogglePencil: (itemId: string, on: boolean) => void;
  /** Note ids lit by a hovered thread (in its colour) or by the same notes hovered in the pitch composer. */
  litIds: ReadonlyMap<string, string>;
  /** The note under the cursor in the summary (null: none), so the composer can light it too. */
  onLitItem: (id: string | null) => void;
}

interface CaseBoardProps {
  board: BoardState;
  outcome: BoardOutcome | null;
  portraits: BoardPortrait[];
  /** The dossier's summary of confirmed notes. */
  renderSummary: (context: SummaryContext) => React.ReactNode;
  /** Opens a person's dossier page. */
  onOpenStakeholder: (id: string) => void;
  onConnect: (a: string, b: string, kind: ThreadKind) => void;
  onTogglePencil: (itemId: string, on: boolean) => void;
  /** Note ids lit elsewhere (the pitch composer); shown lit in the summary. */
  outerLitIds?: ReadonlyMap<string, string>;
  /** Told which notes the board lights (hovered thread or summary row), so the composer can echo them. */
  onLitChange?: (ids: ReadonlyMap<string, string>) => void;
}

const HINT_KEY = "caseBoardPencilHintSeen";
const hintSeen = () => {
  try {
    return window.localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
};

interface Chooser {
  a: string;
  b: string;
  at: Point;
}

const DRAG_THRESHOLD = 6;
const LIT_COLOR = "#e9c46a";
// Names are "<role> <given name>": break after the role word, as the dossier tabs do.
const nameLines = (full: string) => {
  const [role, ...rest] = full.split(" ");
  return rest.length ? (<><span>{role}</span><span>{rest.join(" ")}</span></>) : <span>{role}</span>;
};
// Everything on the cork is placed in percent of the board, so it scales with the box it is given.
const pctX = (x: number) => `${(x / BOARD_W) * 100}%`;
const pctY = (y: number) => `${(y / BOARD_H) * 100}%`;
const samePair = (t: { a: string; b: string }, x: string, y: string) =>
  (t.a === x && t.b === y) || (t.a === y && t.b === x);

const CaseBoard: React.FC<CaseBoardProps> = ({ board, outcome, portraits, renderSummary, onOpenStakeholder, onConnect, onTogglePencil, outerLitIds, onLitChange }) => {
  const byId = useMemo(() => Object.fromEntries(portraits.map((p) => [p.id, p])), [portraits]);
  const places = useMemo(() => layoutPortraits(portraits.map((p) => p.id)), [portraits]);
  const corkRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ from: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [source, setSource] = useState<string | null>(null);
  const [chooser, setChooser] = useState<Chooser | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [toast, setToast] = useState<string>("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(() => !hintSeen());
  const [hoverThreadId, setHoverThreadId] = useState<string | null>(null);
  const [hoverItemId, setHoverItemId] = useState<string | null>(null);
  // Coming back to the board must not replay the answer that was already shown.
  const shownSeq = useRef(outcome?.seq);
  const penciled = useMemo(() => new Set(board.penciled ?? []), [board.penciled]);
  const closeHint = () => {
    setHintOpen(false);
    try {
      window.localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* a private window just shows it again next time */
    }
  };

  const name = (id: string) => byId[id]?.name ?? id;
  const selected = board.found.find((t) => t.id === selectedId) ?? null;
  const boardLit = useMemo(() => {
    const hovered = board.found.find((t) => t.id === hoverThreadId);
    const ids = new Map<string, string>();
    if (hoverItemId) ids.set(hoverItemId, LIT_COLOR);
    if (hovered) [...hovered.a_item_ids, ...hovered.b_item_ids].forEach((id) => ids.set(id, THREAD_META[hovered.kind].color));
    return ids;
  }, [board.found, hoverThreadId, hoverItemId]);
  useEffect(() => {
    onLitChange?.(boardLit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardLit]);
  useEffect(() => () => onLitChange?.(new Map()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const litIds = useMemo(() => new Map([...(outerLitIds ?? []), ...boardLit]), [boardLit, outerLitIds]);
  const onlyIds = useMemo(
    () => (selected ? new Set([...selected.a_item_ids, ...selected.b_item_ids]) : null),
    [selected],
  );

  // Each answer from the server: say what it means, and open the file when a thread was found.
  useEffect(() => {
    if (!outcome || outcome.seq === shownSeq.current) return;
    setToast(resultMessage(outcome.code, name(outcome.a), name(outcome.b)));
    if ((outcome.code === "found" || outcome.code === "already_found") && outcome.relation) {
      setSelectedId(outcome.relation.id);
      if (outcome.code === "found") setFresh(outcome.relation.id);
    }
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome?.seq]);

  const toBoard = (e: React.PointerEvent): Point => {
    const rect = corkRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return { x: e.clientX, y: e.clientY };
    return { x: ((e.clientX - rect.left) / rect.width) * BOARD_W, y: ((e.clientY - rect.top) / rect.height) * BOARD_H };
  };

  const openChooser = (a: string, b: string, at: Point) => {
    setChooser({ a, b, at });
    setSource(null);
  };

  // Drag from one person to another to tie them together.
  const onPointerDown = (id: string) => (e: React.PointerEvent) => {
    const p = toBoard(e);
    drag.current = { from: id, x: p.x, y: p.y, moved: false };
    corkRef.current?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toBoard(e);
    if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) > DRAG_THRESHOLD) d.moved = true;
    if (d.moved) setPointer(p);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    setPointer(null);
    if (!d || !d.moved) return;
    suppressClick.current = true;
    const p = toBoard(e);
    const target = portraitAt(places, p, d.from);
    if (target) openChooser(d.from, target, p);
  };

  // A plain click (or Enter) opens the person's page; a drag that ended on someone else is not a click.
  const onPortraitClick = (id: string) => () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onOpenStakeholder(id);
  };

  // The keyboard way to tie two people: Space on one, then Space on the other.
  const pick = (id: string) => {
    if (source === null) {
      setSource(id);
    } else if (source === id) {
      setSource(null);
    } else {
      const from = places[source];
      const to = places[id];
      openChooser(source, id, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    }
  };

  const onPortraitKeyDown = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key === " ") {
      e.preventDefault();
      pick(id);
    }
  };

  const choose = (kind: ThreadKind) => {
    if (!chooser) return;
    onConnect(chooser.a, chooser.b, kind);
    setChooser(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setChooser(null);
      setSource(null);
    }
  };

  const chooserRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    chooserRef.current?.querySelector("button")?.focus();
  }, [chooser]);

  const threads = useMemo(() => {
    const seen: Record<string, number> = {};
    return board.found.filter((t) => places[t.a] && places[t.b]).map((t) => {
      const key = [t.a, t.b].sort().join("|");
      const lane = seen[key] ?? 0;
      seen[key] = lane + 1;
      return { thread: t, geo: threadGeometry(places[t.a], places[t.b], lane) };
    });
  }, [board.found, places]);

  const hints = board.hints
    .filter((pair) => pair.length === 2 && places[pair[0]] && places[pair[1]] && !board.found.some((t) => samePair(t, pair[0], pair[1])))
    .map((pair) => ({ pair, geo: threadGeometry(places[pair[0]], places[pair[1]], 0) }));

  const count = (kind: ThreadKind) => board.found.filter((t) => t.kind === kind).length;
  const sourcePlace: Place | undefined = source ? places[source] : undefined;
  const dragPlace: Place | undefined = drag.current?.moved ? places[drag.current.from] : undefined;
  const helpText = "Drag from one person to another to tie them, or press Space on two. Click a person to open their page.";

  return (
    <div className={styles.board} onKeyDown={onKeyDown}>
      <div className={styles.head}>
        <div className={styles.title}>
          <Icon icon="ph:push-pin-duotone" className={styles.titleIcon} />
          Case board <small>who is tied to whom in this challenge</small>
        </div>
        <HoverTooltip description={`${helpText} Threads you name correctly shape the pitch.`} block>
          <div className={styles.help}>
            <Icon icon="ph:hand-pointing-duotone" />
            <span>{helpText} Threads you name correctly shape the pitch.</span>
          </div>
        </HoverTooltip>
      </div>

      <div className={styles.body}>
        <div className={styles.stage}>
          <div className={styles.corkFrame}>
            <div
              className={styles.cork}
              ref={corkRef}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => { drag.current = null; setPointer(null); }}
            >
              <svg className={styles.threads} viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} aria-hidden="true">
                <defs>
                  <marker id="caseBoardArrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill={THREAD_META.chain.color} />
                  </marker>
                </defs>
                {threads.map(({ thread, geo }) => {
                  const d = `M${geo.a.x},${geo.a.y} Q${geo.control.x},${geo.control.y} ${geo.b.x},${geo.b.y}`;
                  return (
                    <g key={thread.id}>
                      <path d={d} className={styles.shadow} transform="translate(2,4)" />
                      <path
                        d={d}
                        fill="none"
                        stroke={THREAD_META[thread.kind].color}
                        strokeWidth={selectedId === thread.id ? 4 : 3}
                        strokeLinecap="round"
                        markerEnd={thread.kind === "chain" ? "url(#caseBoardArrow)" : undefined}
                      />
                    </g>
                  );
                })}
                {hints.map(({ pair, geo }) => (
                  <path
                    key={pair.join("|")}
                    d={`M${geo.a.x},${geo.a.y} Q${geo.control.x},${geo.control.y} ${geo.b.x},${geo.b.y}`}
                    fill="none" stroke="#fffdf5" strokeWidth={3} strokeDasharray="6 6" strokeLinecap="round"
                  />
                ))}
                {debugOpen && (board.debug ?? []).filter((r) => !r.found && places[r.a] && places[r.b]).map((r) => {
                  const geo = threadGeometry(places[r.a], places[r.b], 2);
                  return (
                    <g key={`debug-${r.id}`} className={styles.debugThread}>
                      <path
                        d={`M${geo.a.x},${geo.a.y} Q${geo.control.x},${geo.control.y} ${geo.b.x},${geo.b.y}`}
                        fill="none" stroke={THREAD_META[r.kind].color} strokeWidth={2} strokeDasharray="2 5" strokeLinecap="round"
                      />
                      <text x={geo.mid.x} y={geo.mid.y} textAnchor="middle">{THREAD_META[r.kind].tag}</text>
                    </g>
                  );
                })}
                {dragPlace && pointer && (
                  <path
                    d={`M${dragPlace.x},${dragPlace.y} Q${(dragPlace.x + pointer.x) / 2},${(dragPlace.y + pointer.y) / 2 + 20} ${pointer.x},${pointer.y}`}
                    fill="none" stroke="#fffdf5" strokeWidth={3} strokeDasharray="6 5"
                  />
                )}
              </svg>

              {portraits.map((p) => {
                const place = places[p.id];
                if (!place) return null;
                const isSource = source === p.id;
                return (
                  <button
                    type="button"
                    key={p.id}
                    data-testid={`portrait-${p.id}`}
                    className={`${styles.polaroid} ${isSource ? styles.src : ""} ${activeId === p.id ? styles.lit : ""}`}
                    style={{ left: pctX(place.x), top: pctY(place.y), ["--rot" as string]: `${place.rot}deg`, ["--c" as string]: p.color }}
                    aria-pressed={isSource}
                    aria-label={
                      source && !isSource
                        ? `Tie ${name(source)} to ${p.name}: press Space`
                        : `${p.name}: open their page. Drag to another person, or press Space, to tie them.`
                    }
                    onPointerDown={onPointerDown(p.id)}
                    onDragStart={(e) => e.preventDefault()}
                    onClick={onPortraitClick(p.id)}
                    onKeyDown={onPortraitKeyDown(p.id)}
                    onKeyUp={(e) => e.key === " " && e.preventDefault()}
                    onMouseEnter={() => setActiveId(p.id)}
                    onMouseLeave={() => setActiveId(null)}
                    onFocus={() => setActiveId(p.id)}
                    onBlur={() => setActiveId(null)}
                  >
                    <span className={styles.tape} />
                    {p.highPower && (
                      <span className={styles.flags} role="img" aria-label="High power">
                        <span><Icon icon="ph:lightning-fill" /></span>
                      </span>
                    )}
                    <span className={styles.photo} style={{ background: `linear-gradient(165deg, ${p.color}77, ${p.color}26)` }}>
                      <StakeholderAvatarComponent
                        avatar={p.avatar}
                        emotion={p.face}
                        stakeholderColor={p.color}
                        stakeholderId={p.id}
                        isFramed={false}
                        play_blink_animation={false}
                        size="100%"
                        flip={place.flip}
                        portrait
                        style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 0" }}
                      />
                    </span>
                    <span className={styles.nm}>{nameLines(p.name)}</span>
                  </button>
                );
              })}

              {threads.map(({ thread, geo }) => (
                <button
                  type="button"
                  key={thread.id}
                  data-testid={`thread-${thread.id}`}
                  className={`${styles.chip} ${selectedId === thread.id ? styles.sel : ""} ${fresh === thread.id ? styles.fresh : ""}`}
                  style={{ left: pctX(geo.mid.x), top: pctY(geo.mid.y), ["--cc" as string]: THREAD_META[thread.kind].color }}
                  aria-label={`${THREAD_META[thread.kind].tag}: ${name(thread.a)} and ${name(thread.b)}`}
                  onClick={() => setSelectedId(selectedId === thread.id ? null : thread.id)}
                  onMouseEnter={() => setHoverThreadId(thread.id)}
                  onMouseLeave={() => setHoverThreadId(null)}
                  onFocus={() => setHoverThreadId(thread.id)}
                  onBlur={() => setHoverThreadId(null)}
                  onAnimationEnd={() => setFresh(null)}
                >
                  <Icon icon={THREAD_META[thread.kind].icon} />
                  {THREAD_META[thread.kind].tag}
                </button>
              ))}

              {hints.map(({ pair, geo }) => (
                <button
                  type="button"
                  key={pair.join("|")}
                  data-testid={`hint-${pair.join("-")}`}
                  className={`${styles.chip} ${styles.hint}`}
                  style={{ left: pctX(geo.mid.x), top: pctY(geo.mid.y), ["--cc" as string]: "#8a7a62" }}
                  aria-label={`Something between ${name(pair[0])} and ${name(pair[1])}`}
                  onClick={() => openChooser(pair[0], pair[1], geo.mid)}
                >
                  <Icon icon="ph:question-duotone" />
                  Something here?
                </button>
              ))}

              {sourcePlace && !chooser && (
                <span className={styles.sourceHint}>Now pick the second person</span>
              )}
              <div className={`${styles.toast} ${toast ? styles.show : ""}`} role="status" aria-live="polite">
                {toast}
              </div>
            </div>
          </div>

          {/* Beside the clipped cork frame, so it is never cut off by it. */}
          {chooser && (
            <div
              className={styles.chooser}
              ref={chooserRef}
              role="menu"
              aria-label={`What ties ${name(chooser.a)} and ${name(chooser.b)} together?`}
              style={{
                left: `max(4px, min(${pctX(Math.max(chooser.at.x - 100, 0))}, calc(100% - 252px)))`,
                top: `min(${pctY(chooser.at.y)}, calc(100% - 56px))`,
              }}
            >
              <h4>What ties {name(chooser.a)} and {name(chooser.b)}?</h4>
              {THREAD_KINDS.map((kind) => (
                <button
                  type="button"
                  key={kind}
                  role="menuitem"
                  style={{ ["--cc" as string]: THREAD_META[kind].color }}
                  onClick={() => choose(kind)}
                >
                  <Icon icon={THREAD_META[kind].icon} />
                  {THREAD_META[kind].choice}
                </button>
              ))}
              <button type="button" role="menuitem" className={styles.cancel} onClick={() => setChooser(null)}>
                Cancel
              </button>
            </div>
          )}
        </div>

        <aside className={styles.file} aria-label="What they want">
          {selected && (
            <ThreadHeader thread={selected} byId={byId} onShowAll={() => setSelectedId(null)} />
          )}
          {hintOpen && (
            <div className={styles.pencilHint} role="note">
              <Icon icon="ph:pencil-simple-line-duotone" />
              <span>
                <b>Pencil in your pitch.</b> Tick a note when the card you are building takes care of it. The boxes are
                yours alone: the game does not check them, they just keep track of what is still uncovered.
              </span>
              <button type="button" onClick={closeHint}>Got it</button>
              <Icon icon="ph:arrow-bend-right-down-duotone" className={styles.pencilArrow} aria-hidden />
            </div>
          )}
          {renderSummary({
            onlyIds,
            activeStakeholder: activeId,
            onActiveStakeholder: setActiveId,
            penciled,
            onTogglePencil,
            litIds,
            onLitItem: setHoverItemId,
          })}
          {board.debug && (
            <div className={styles.debugPanel}>
              <button type="button" className={styles.debugPanelTitle} onClick={() => setDebugOpen((o) => !o)} aria-expanded={debugOpen}>
                <Icon icon="ph:bug-duotone" /> Answer key (debug): {board.debug.filter((r) => !r.found).length} of {board.debug.length} not found yet
              </button>
              {debugOpen && board.debug.map((r) => (
                <div key={r.id} className={styles.debugRow}>
                  <strong style={{ color: THREAD_META[r.kind].color }}>{THREAD_META[r.kind].tag}</strong>{" "}
                  {name(r.a)} and {name(r.b)}
                  {r.kind === "chain" ? " (first waits on second)" : ""}
                  {r.on_record ? ", on the record" : ""}
                  <br />
                  <span className={styles.debugMeta}>
                    {r.target}{r.via ? ` via ${r.via}` : ""}; {r.a_item_ids.length + r.b_item_ids.length} notes behind it
                  </span>
                  <br />
                  <span className={r.found ? styles.debugRightText : r.eligible ? styles.debugWrongText : styles.debugMeta}>
                    {r.found ? "found" : r.eligible ? "findable now, not found" : `not findable yet: needs verified notes from ${r.lacking.join(" and ")}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      <div className={styles.dock}>
        <span className={styles.chips}>
          {THREAD_KINDS.map((kind) => (
            <span key={kind} className={styles.fchip} style={{ ["--cc" as string]: THREAD_META[kind].color }}>
              <Icon icon={THREAD_META[kind].icon} />
              {THREAD_META[kind].plural} <b>{count(kind)}</b>
            </span>
          ))}
        </span>
        <span className={styles.stats}>
          <span className={`${styles.pill} ${styles.gold}`}>
            <Icon icon="ph:magnifying-glass-duotone" />
            {board.found.length} {board.found.length === 1 ? "thread" : "threads"} found
          </span>
          <HoverTooltip description="Wrong guesses you can still make this challenge">
            <span className={styles.pill}>
              <Icon icon="ph:needle-duotone" />
              Guesses left
              <span className={styles.attempts} aria-label={`${board.attempts_left} left`}>
                {Array.from({ length: Math.max(board.attempts_total ?? 0, board.attempts_left) }, (_, i) => (
                  <i key={i} className={i < board.attempts_left ? "" : styles.used} />
                ))}
              </span>
            </span>
          </HoverTooltip>
        </span>
      </div>
    </div>
  );
};

interface ThreadHeaderProps {
  thread: BoardThread;
  byId: Record<string, BoardPortrait>;
  onShowAll: () => void;
}

/** What a picked thread is and does; the summary under it is narrowed to the notes behind it. */
const ThreadHeader: React.FC<ThreadHeaderProps> = ({ thread, byId, onShowAll }) => {
  const meta = THREAD_META[thread.kind];
  const a = byId[thread.a];
  const b = byId[thread.b];
  const avatar = (p: BoardPortrait | undefined, flip = false) => p && (
    <StakeholderAvatarComponent
      avatar={p.avatar} emotion={p.face} stakeholderColor={p.color} stakeholderId={p.id}
      isFramed={false} play_blink_animation={false} size={30} flip={flip} thumb
    />
  );
  const effect = thread.kind === "chain"
    ? `${a?.name ?? "One of them"}'s change comes after ${b?.name ?? "the other"}'s step. The card builder says so, so you see the cap before an objection costs patience.`
    : meta.effect;

  return (
    <div className={styles.fHead} style={{ ["--cc" as string]: meta.color }}>
      <div className={styles.duo}>
        <span className={styles.av} style={{ background: `${a?.color}33` }}>{avatar(a)}</span>
        <span className={styles.mid}><Icon icon={meta.icon} /></span>
        <span className={styles.av} style={{ background: `${b?.color}33` }}>{avatar(b, true)}</span>
      </div>
      <div className={styles.fText}>
        <div className={styles.fTitle}>
          <span className={styles.fSub}>{meta.label}{thread.on_record ? " · on the record" : ""}</span>{" "}
          {a?.name} and {b?.name}
          {thread.kind === "chain" && a && b ? `: ${a.name} waits on ${b.name}` : ""}
        </div>
        <div className={styles.effect}>{effect}</div>
      </div>
      <HoverTooltip description="Show every note again">
        <button type="button" className={styles.showAll} onClick={onShowAll}>
          <Icon icon="ph:x-circle-duotone" /> Show all
        </button>
      </HoverTooltip>
    </div>
  );
};

export default CaseBoard;
