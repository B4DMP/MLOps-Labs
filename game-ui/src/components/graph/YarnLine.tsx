import { EDGE_ON_CORK, LIT_GLOW } from "./cardPalette";

/** Arrowheads in the yarn colours. Render once inside the diagram's `<defs>`; strings refer to them by id. */
export function YarnMarkers() {
  return (
    <>
      {Object.entries(EDGE_ON_CORK).map(([id, fill]) => (
        <marker key={id} id={id} markerUnits="userSpaceOnUse" markerWidth="11" markerHeight="11" refX="10" refY="5.5" orient="auto">
          <path d="M0,0 L0,11 L11,5.5 z" fill={fill} stroke="rgba(24, 12, 4, 0.55)" strokeWidth={0.8} strokeLinejoin="round" />
        </marker>
      ))}
    </>
  );
}

/**
 * A hand-off as a string pinned across the board: it casts a shadow on the cork, a solid strand
 * under it is wound with alternating dark and light bands, and the line on top carries the flow
 * state (dashes that run, or stall). Yarn sits on the cork; it does not glow.
 */
export default function YarnLine({
  x1,
  y1,
  x2,
  y2,
  marker,
  width,
  flowClass,
  viewOnly = false,
  lit = false,
  hovered = false,
  cursor,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** One of the ids in `EDGE_ON_CORK` ("arr-success", ...): the colour and the arrowhead. */
  marker: string;
  width: number;
  /** "pipe-flow" and friends: the animated dashes of the line itself. */
  flowClass?: string;
  /** Another phase: a plain dashed line, no winding. */
  viewOnly?: boolean;
  lit?: boolean;
  hovered?: boolean;
  cursor?: string;
}) {
  const color = EDGE_ON_CORK[marker] ?? EDGE_ON_CORK["arr-default"];
  const line = { x1, y1, x2, y2, pointerEvents: "none" as const };
  return (
    <>
      <line
        {...line}
        stroke="rgba(24, 12, 4, 0.42)"
        strokeWidth={width + 0.5}
        strokeLinecap="round"
        transform="translate(1.6 3)"
        style={{ filter: "blur(1.1px)" }}
      />
      <line {...line} stroke={color} strokeWidth={width} strokeLinecap="round" opacity={0.6} />
      {!viewOnly && (
        <>
          <line {...line} stroke="rgba(30, 14, 4, 0.4)" strokeWidth={width * 0.92} strokeDasharray="1.3 3.1" />
          <line
            {...line}
            stroke="rgba(255, 246, 220, 0.38)"
            strokeWidth={width * 0.92}
            strokeDasharray="1.3 3.1"
            strokeDashoffset={2.2}
          />
        </>
      )}
      <line
        className={flowClass}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={width}
        strokeDasharray={viewOnly ? "4 3" : undefined}
        markerEnd={`url(#${marker})`}
        style={{
          cursor,
          filter: lit ? `drop-shadow(0 0 3px ${LIT_GLOW})` : undefined,
          transition: "filter 0.16s ease",
          pointerEvents: "none",
        }}
        opacity={hovered || lit ? 1 : 0.92}
      />
    </>
  );
}
