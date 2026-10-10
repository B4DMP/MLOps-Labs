import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import HoverTooltip from "./HoverToolTip";
import ComposeTagDetail from "./composeSidebar/ComposeTagDetail";
import IntelNoteRows, { type LinkedNote } from "./composeSidebar/IntelNoteRows";
import { AxisChip, AxisPipRow, Chip, ChipRow, DependencyChip, type DependencyState } from "./composeSidebar/StatusChips";
import { StakeholderAvatarComponent } from "./StakeholderAvatarComponent";
import type { Stakeholder } from "./StakeholderProvider";
import { nodeBar } from "./graph/cardPalette";
import { ceilingOn, nominalOn, type OptionTarget } from "../utils/graphOptions";
import { crossPhaseExplanation, formatAxisLevel } from "../utils/stageCanvas";
import { firstSentence } from "../utils/firstSentence";
import type { ComponentData, CrossPhaseStubInfo, StageData, TechnicalStage } from "./PerformanceDashboard";
import sb from "./composeSidebar/ComposeSidebar.module.css";
import tokens from "./composeSidebar/sidebarTokens.module.css";
import styles from "./DashboardInspector.module.css";

interface Props {
  stage: StageData;
  technical: TechnicalStage;
  selectedComponent: ComponentData | null;
  selectedCrossStub: CrossPhaseStubInfo | null;
  linkedNotes: LinkedNote[];
  linkedNotesLabel: string;
  stakeholders: Record<string, Stakeholder>;
  /** The owner's dossier page, when the player has one for them. */
  ownerEntry?: { stakeholder_id: string; name: string };
  onOpenStakeholder?: (stakeholderId: string) => void;
  onSelectIntel?: (intelId: string, stakeholderId?: string) => void;
  onSelectComponent: (id: string | null) => void;
  /** Back from a selection to the list. */
  onClearSelection: () => void;
  /** Jump to a component that may sit on another stage. */
  onJumpToComponent: (id: string) => void;
  nameOf: (id: string) => string;
}

const NO_LIT: ReadonlyMap<string, string> = new Map();
const noMarks = () => [];

/** The component list and the selected component's detail: the pitch composer's sidebar, in read-only form. */
export default function DashboardInspector({
  stage,
  technical,
  selectedComponent: comp,
  selectedCrossStub,
  linkedNotes,
  linkedNotesLabel,
  stakeholders,
  ownerEntry,
  onOpenStakeholder,
  onSelectIntel,
  onSelectComponent,
  onClearSelection,
  onJumpToComponent,
  nameOf,
}: Props) {
  const locked = stage.locked;
  const isBroken = (c: ComponentData) => !locked && (c.nominal_automation ?? 1) === 0;
  const barFor = (c: ComponentData) =>
    nodeBar({
      otherPhase: locked,
      broken: isBroken(c),
      uncertain: false,
      capped: !locked && Boolean(c.capped_by),
      starved: !locked && !isBroken(c) && (c.effective_automation ?? 1) === 0,
    });

  const bar = selectedCrossStub
    ? nodeBar({ otherPhase: true, broken: false, uncertain: false, capped: false })
    : comp
    ? barFor(comp)
    : nodeBar({ otherPhase: false, broken: false, uncertain: false, capped: false });
  const bandStyle = { ["--bar" as string]: bar.fill, ["--bar-ink" as string]: bar.ink };

  const heldBack = Boolean(
    comp &&
      comp.capped_by &&
      comp.effective_automation !== undefined &&
      comp.nominal_automation !== undefined &&
      comp.effective_automation < comp.nominal_automation
  );
  const dependency: DependencyState | null =
    comp && comp.nominal_automation !== undefined && !locked
      ? heldBack
        ? {
            kind: "held",
            byId: comp.capped_by!,
            byName: nameOf(comp.capped_by!),
            capLabel: formatAxisLevel("automation", comp.effective_automation ?? 0),
          }
        : { kind: "ok", levelLabel: formatAxisLevel("automation", comp.effective_automation ?? comp.nominal_automation) }
      : null;
  const debt = comp?.debt && comp.debt.length > 0 ? comp.debt[0] : null;

  const closeButton = (label: string) => (
    <HoverTooltip description={label} labelsChild>
      <button type="button" className={sb.bandClose} onClick={onClearSelection}>
        <Icon icon="ph:x-bold" />
      </button>
    </HoverTooltip>
  );

  const ownerBadge = (ownerId: string): ReactNode => {
    const name = ownerEntry?.name ?? ownerId.replace(/_/g, " ");
    const avatar = (
      <StakeholderAvatarComponent
        stakeholderId={ownerId}
        avatar={stakeholders[ownerId]?.avatar}
        stakeholderColor={stakeholders[ownerId]?.stakeholder_color}
        isFramed={false}
        size="100%"
        flip
        thumb
        hoverToSuspicious={false}
      />
    );
    return (
      <HoverTooltip
        description={<ComposeTagDetail label={`Owner: ${name}`} lines={ownerEntry && onOpenStakeholder ? ["Open their dossier page"] : undefined} />}
        ariaText={`Owner: ${name}`}
      >
        {ownerEntry && onOpenStakeholder ? (
          <button
            type="button"
            className={sb.owner}
            onClick={() => onOpenStakeholder(ownerEntry.stakeholder_id)}
            aria-label={`Owner: ${name}. Open their dossier page.`}
          >
            {avatar}
          </button>
        ) : (
          <span className={`${sb.owner} ${sb.ownerStatic}`}>{avatar}</span>
        )}
      </HoverTooltip>
    );
  };

  let band: ReactNode;
  let body: ReactNode;

  if (selectedCrossStub) {
    band = (
      <div className={sb.band} style={bandStyle}>
        <Icon icon="ph:link-break-bold" className={sb.bandIcon} />
        <h4 className={sb.bandTitle}>Cross-phase dependency</h4>
        {closeButton("Back to the component list")}
      </div>
    );
    body = (
      <div className={sb.body}>
        <p className={sb.caption}>{selectedCrossStub.otherStageName}</p>
        <div className={sb.viewOnly}>
          <Icon icon="ph:eye-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
          <div>
            {crossPhaseExplanation(selectedCrossStub.direction, selectedCrossStub.otherName, selectedCrossStub.otherStageName)}
          </div>
        </div>
      </div>
    );
  } else if (comp) {
    const target = comp as unknown as OptionTarget;
    band = (
      <div className={sb.band} style={bandStyle}>
        <Icon icon={comp.icon || "ph:cube-bold"} className={sb.bandIcon} />
        <h4 className={sb.bandTitle}>{comp.name}</h4>
        {comp.owner_id && ownerBadge(comp.owner_id)}
        {closeButton("Back to the component list")}
      </div>
    );
    const caption = comp.story ? firstSentence(comp.story) : "";
    body = (
      <div className={`${sb.body} ${comp.owner_id ? sb.bodyHang : ""}`}>
        {caption && (
          <HoverTooltip description={comp.story !== caption ? comp.story : undefined}>
            <p className={sb.caption}>{caption}</p>
          </HoverTooltip>
        )}

        {comp.nominal_automation !== undefined && !locked ? (
          <>
            <ChipRow>
              <AxisChip axis="automation" kind="component" target={target} changes={[]} />
              <AxisChip axis="governance" kind="component" target={target} changes={[]} />
              {dependency && <DependencyChip state={dependency} onJump={onJumpToComponent} />}
              {debt && (
                <Chip
                  label="Technical debt"
                  className={styles.chipDebt}
                  lines={[
                    `Meant to be ${formatAxisLevel(debt.axis ?? "automation", debt.intended)}, landed ${formatAxisLevel(
                      debt.axis ?? "automation",
                      debt.applied
                    )}${debt.owner_id ? ` without support from ${debt.owner_id.replace(/_/g, " ")}` : ""}.`,
                  ]}
                >
                  <Icon icon="ph:receipt-duotone" aria-hidden />
                  <span className={sb.chipLabel}>Debt</span>
                </Chip>
              )}
            </ChipRow>
            {heldBack && <p className={sb.caveat}>Raising it changes nothing until that is fixed.</p>}
          </>
        ) : (
          <div className={sb.viewOnly}>
            <Icon icon="ph:eye-bold" style={{ fontSize: "1.2rem", flexShrink: 0 }} />
            <div>
              {locked
                ? "This component belongs to a stage you have not reached yet. Its name and wiring are part of the plan; its state becomes readable once the project gets there."
                : "You have not uncovered intel about this component yet. Verify stakeholder intel and resolve objections to unlock deeper insights."}
            </div>
          </div>
        )}

        {linkedNotes.length > 0 && (
          <div className={sb.section}>
            <div className={sb.sectionHead}>
              <Icon icon="ph:notebook-bold" />
              <span>Notes on this component</span>
              <span className={sb.sectionRight}>{linkedNotesLabel}</span>
            </div>
            <IntelNoteRows
              notes={linkedNotes}
              stakeholders={stakeholders}
              litIntelIds={NO_LIT}
              onSelectIntel={onSelectIntel}
              boardMarksFor={noMarks}
            />
          </div>
        )}

        {debt && (
          <div className={sb.section}>
            <div className={sb.sectionHead}>
              <Icon icon="ph:receipt-duotone" />
              <span>Technical debt</span>
            </div>
            <p className={styles.plain}>
              {debt.axis === "governance" ? "Governance meant" : "Meant"} to be{" "}
              <strong>{formatAxisLevel(debt.axis ?? "automation", debt.intended)}</strong>, landed{" "}
              <strong>{formatAxisLevel(debt.axis ?? "automation", debt.applied)}</strong>
              {debt.owner_id && <> without support from {debt.owner_id.replace(/_/g, " ")}</>}.
            </p>
          </div>
        )}

        {comp.instances && comp.instances.length > 0 && (
          <div className={sb.section}>
            <div className={sb.sectionHead}>
              <Icon icon="ph:hard-drives-duotone" />
              <span>Running services</span>
              <span className={sb.sectionRight}>{comp.instances.length}</span>
            </div>
            <div className={styles.services}>
              {comp.instances.map((inst) => (
                <div key={inst.id} className={styles.serviceRow}>
                  <span className={styles.serviceName}>{inst.name}</span>
                  <span className={styles.serviceState}>{inst.state}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  } else {
    band = (
      <div className={sb.band} style={bandStyle}>
        <Icon icon="ph:cards-bold" className={sb.bandIcon} />
        <h4 className={sb.bandTitle}>{stage.name} components</h4>
      </div>
    );
    body = (
      <div className={sb.body}>
        <p className={sb.caption}>
          {locked
            ? "This stage is ahead of you. You can see what it will contain, not how any of it is doing."
            : "Click a card on the board, or a row below, to read how that component is doing."}
        </p>
        <div className={styles.list}>
          {technical.components.map((c) => {
            const t = c as unknown as OptionTarget;
            const own = barFor(c);
            return (
              <button key={c.id} type="button" className={styles.listRow} onClick={() => onSelectComponent(c.id)}>
                <span className={styles.disc} style={{ background: own.fill, color: own.ink }}>
                  <Icon icon={c.icon || "ph:cube-bold"} aria-hidden />
                </span>
                <span className={styles.listName}>{c.name || c.id.split(".").pop()}</span>
                {c.nominal_automation !== undefined && !locked && (
                  <span className={styles.listPips} aria-hidden>
                    <AxisPipRow
                      axis="automation"
                      level={nominalOn(t, "automation")}
                      projected={nominalOn(t, "automation")}
                      ceiling={ceilingOn(t, "automation")}
                    />
                    <AxisPipRow
                      axis="governance"
                      level={nominalOn(t, "governance")}
                      projected={nominalOn(t, "governance")}
                      ceiling={ceilingOn(t, "governance")}
                    />
                  </span>
                )}
                <Icon icon="ph:caret-right-bold" className={styles.listGo} aria-hidden />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={`${tokens.tokens} ${styles.root}`}>
      {band}
      <div className={styles.scroll}>{body}</div>
    </div>
  );
}
