import type { SVGProps } from "react";
import { Icon } from "@iconify/react";
import {
  BrokenBorder,
  LevelCaption,
  LevelMeter,
  NodeIcon,
  NodeTitleAberration,
  SelectionReticle,
} from "./nodeChrome";
import {
  BOX_H,
  BOX_W,
  NODE_CAPTION_Y,
  NODE_ICON_OFFSET,
  NODE_METER_Y,
  NODE_PAD_X,
  NODE_TITLE_LH,
  levelRungs,
  nodeFace,
  wrapLabel,
} from "../../utils/stageCanvas";
import { BAR_H, CARD, cardTilt, nodeBar } from "./cardPalette";
import styles from "./StageNode.module.css";

export interface StageNodeState {
  /** Another phase, or a stage you have not reached: readable, not workable. */
  otherPhase: boolean;
  broken: boolean;
  /** Something upstream is still undiscovered, so its real status is unknown. */
  uncertain: boolean;
  /** A bottleneck upstream holds it back. */
  capped: boolean;
  /** Runs at nothing, but only because something upstream is broken. */
  starved: boolean;
}

export interface StageNodeProps {
  id: string;
  /** Centre of the card on the diagram. */
  x: number;
  y: number;
  name: string;
  icon?: string;
  state: StageNodeState;
  /** SVG defs prefix from `NodeDefs`: "compose" or "dash". */
  prefix: string;

  automation?: number;
  effectiveAutomation?: number;
  governance?: number;
  allowedAutomation?: number[];
  allowedGovernance?: number[];
  /** Where each axis would sit once the proposal lands; drawn ahead of what is built. */
  previewAutomation?: number;
  previewGovernance?: number;
  /** Draw the caption and meter. A component nobody has uncovered has nothing to show. */
  showMeter?: boolean;
  /** The automation level the caption reports (defaults to the effective, then the built, level). */
  captionLevel?: number;

  selected?: boolean;
  /** Upstream of the selected node. */
  predecessor?: boolean;
  /** A note about this node is lit elsewhere. */
  lit?: boolean;
  /** A step of yours is attached (the composer): a teal flag, a pulsing icon, a breathing shadow. */
  slotted?: boolean;
  /** The component carries technical debt (the dashboard): an amber flag. */
  debt?: boolean;
  /** Stop the broken effects without hiding that it is broken (a slotted fix is on its way). Default: while broken. */
  glitching?: boolean;

  dataCoachNode?: string;
  /** Events on the placed group: click, hover, tooltip handlers. */
  gProps?: Omit<SVGProps<SVGGElement>, "className" | "transform">;
  /** Title font size in diagram units. A screen that draws the diagram larger asks for less. */
  titleSize?: number;
}

/**
 * One component as an index card pinned to the corkboard. A solid title bar in the state colour, the
 * icon centred between the card's edge and its title, a meter and caption below, a pin, a tilt fixed
 * by the id. Hovering swings it on the pin; broken cards tear and swing about it continuously.
 * The card's own border is never animated: it is the card.
 */
export default function StageNode({
  id,
  x,
  y,
  name,
  icon,
  state,
  prefix,
  automation,
  effectiveAutomation,
  governance,
  allowedAutomation,
  allowedGovernance,
  previewAutomation,
  previewGovernance,
  showMeter = true,
  captionLevel,
  selected = false,
  predecessor = false,
  lit = false,
  slotted = false,
  debt = false,
  glitching,
  dataCoachNode,
  gProps,
  titleSize = 12,
}: StageNodeProps) {
  const isGlitching = glitching ?? state.broken;
  const { fill: rail, ink: barInk } = nodeBar(state);
  const barInset = (selected ? 2 : 1.25) / 2;
  const face = nodeFace(prefix, { selected: selected || predecessor, broken: state.broken });
  const stroke = selected ? CARD.select : predecessor ? CARD.predecessor : state.broken ? CARD.broken : CARD.ink;

  // The title column runs from the icon to whatever sits at the bar's right end (a view-only eye, a flag, the
  // held-back link). A bold character is about 0.58 of the font size wide. A name that needs more than two lines
  // ends in an ellipsis; the tooltip carries the whole name.
  const titleX = NODE_PAD_X + (icon ? NODE_ICON_OFFSET : 0);
  const rightTaken = state.otherPhase || slotted || debt || (state.capped && !state.broken);
  const maxChars = Math.max(8, Math.floor((BOX_W - titleX - (rightTaken ? 30 : 8)) / (titleSize * 0.58)));
  const lines = wrapLabel(name, maxChars);
  if (lines.join(" ").length < name.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/.?$/, "…");
  const lineHeight = (NODE_TITLE_LH * titleSize) / 12;
  const titleY = (i: number) => BAR_H / 2 + 4 - (lines.length - 1) * (lineHeight / 2) + i * lineHeight;

  const flagColor = slotted ? CARD.proposed : debt ? CARD.debt : null;
  const flagIcon = slotted ? "ph:hammer-duotone" : "ph:receipt-duotone";
  const captionText = state.otherPhase ? "view only" : state.uncertain ? "uncertain" : state.starved ? "starved" : undefined;

  return (
    <g
      className={`${styles.stageNode} ${slotted ? styles.nodeSlotted : ""}`}
      data-coach-node={dataCoachNode}
      transform={`translate(${x - BOX_W / 2}, ${y - BOX_H / 2}) rotate(${cardTilt(id)} ${BOX_W / 2} ${BOX_H / 2})`}
      {...gProps}
    >
      {/* Hover swings this wrapper about the pin; the lit echo grows the next one. Both sit between the placed
          group above (its transform attribute must stay untouched) and the broken glitch group below, so a
          broken card keeps glitching while it is hovered or lit. */}
      <g className={styles.nodeHover}>
        <g className={`${styles.nodeEcho} ${lit ? styles.nodeEchoOn : ""}`}>
          <g className={isGlitching ? "node-broken" : undefined}>
            {/* Card face */}
            <rect
              width={BOX_W}
              height={BOX_H}
              fill={face}
              stroke={stroke}
              strokeWidth={selected ? 2 : 1.25}
              strokeDasharray={state.otherPhase ? "4 3" : undefined}
              filter={`url(#${prefix}-${isGlitching ? "broken-face" : selected ? "shadow-lifted" : "shadow"})`}
            />
            {/* Title bar: a solid block in the node's state colour, inside the outline */}
            <rect x={barInset} y={barInset} width={BOX_W - barInset * 2} height={BAR_H - barInset} fill={rail} />
            {isGlitching && <BrokenBorder color={CARD.broken} />}
            {state.capped && !state.broken && !flagColor && !state.otherPhase && (
              <Icon icon="ph:link-simple-bold" x={BOX_W - 22} y={BAR_H / 2 - 7} width={14} height={14} color={barInk} />
            )}

            {/* Another phase: readable here, editable elsewhere */}
            {state.otherPhase && !flagColor && (
              <g transform={`translate(${BOX_W - 24}, ${BAR_H / 2 - 8})`}>
                <circle cx="8" cy="8" r="8" fill="#dbe7f2" stroke="#9db6cc" />
                <text x="8" y="11" fontSize="8" textAnchor="middle">
                  👁
                </text>
              </g>
            )}

            {/* Icon, centred between the card's edge and its title */}
            {icon && (
              <g className={styles.nodeIcon}>
                <g className={slotted ? styles.iconPulse : undefined}>
                  <NodeIcon icon={icon} color={barInk} cx={titleX / 2} cy={BAR_H / 2} discOpacity={0.22} />
                </g>
              </g>
            )}

            {/* A flag folded over the top-right corner: teal with a hammer when a step of yours is attached, amber
                with a receipt when the component carries technical debt. It stays inside the card's border, so it
                never covers the selection brackets. */}
            {flagColor && (
              <g pointerEvents="none">
                <path d={`M${BOX_W - 31} ${barInset} H${BOX_W - barInset} V31 Z`} fill={flagColor} />
                <path
                  d={`M${BOX_W - 31} ${barInset} L${BOX_W - barInset} 31`}
                  stroke="rgba(255,255,255,0.4)"
                  strokeWidth={0.8}
                />
                <Icon icon={flagIcon} x={BOX_W - 17} y={3} width={13} height={13} color="#ffffff" />
              </g>
            )}

            {/* Title, centred in the bar, with its colour-split ghosts underneath while it glitches. Every line
                clears the icon, since the icon sits beside the whole title. */}
            {isGlitching && (
              <NodeTitleAberration lines={lines} x={() => titleX} y={titleY} fontWeight={700} offset={1.8} fontSize={titleSize} />
            )}
            {lines.map((line, i) => (
              <text
                key={i}
                x={titleX}
                y={titleY(i)}
                fill={barInk}
                fontSize={titleSize}
                fontWeight="700"
                stroke={barInk === "#ffffff" ? "rgba(18, 8, 2, 0.5)" : "none"}
                strokeWidth={titleSize * 0.2}
                strokeLinejoin="round"
                paintOrder="stroke"
              >
                {line}
              </text>
            ))}

            {/* One caption, plus the maturity meter when there is one to show */}
            <LevelCaption
              level={captionLevel ?? effectiveAutomation ?? automation ?? 1}
              governance={governance}
              y={NODE_CAPTION_Y}
              size={9.5}
              // Three cases are not about a rung at all, and keep the bar's colour along with their own word.
              text={captionText}
              color={captionText ? rail : undefined}
            />
            {showMeter && (
                <LevelMeter
                  automation={automation ?? 1}
                  effectiveAutomation={effectiveAutomation}
                  governance={governance}
                  automationRungs={levelRungs(allowedAutomation)}
                  governanceRungs={levelRungs(allowedGovernance)}
                  previewAutomation={previewAutomation}
                  previewGovernance={previewGovernance}
                  y={NODE_METER_Y}
                  emptyColor={CARD.empty}
                  thickness={5}
                />
            )}
          </g>

          {/* The pin that holds it to the board. Outside the glitch group on purpose: a broken card swings about
              the pin, and the pin itself never moves. */}
          <g pointerEvents="none">
            <ellipse cx={BOX_W / 2 + 1.4} cy={3.6} rx={4.4} ry={2.2} fill="#2a1a0c" fillOpacity={0.35} />
            <circle cx={BOX_W / 2} cy={1.5} r={4.2} fill="#c9962b" stroke="#6b4f20" strokeWidth={0.8} />
            <circle cx={BOX_W / 2 - 1.2} cy={0.2} r={1.3} fill="#fff4cf" fillOpacity={0.8} />
          </g>
          {selected && <SelectionReticle color={CARD.select} />}
        </g>
      </g>
    </g>
  );
}
