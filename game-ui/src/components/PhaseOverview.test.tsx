import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PhaseOverview from "./PhaseOverview";
import { PhasesContext, type PhaseData } from "./PhaseProvider";

/**
 * jsdom has no layout engine, so these tests cannot measure a rendered width. What they can
 * do is pin the rules that decide the width - which is where every regression in this rail
 * came from:
 *
 *  - the rail overflowed its header because `.headerPhases` was `flex: 1 1 auto`, sizing the
 *    rail from its content instead of from the space left over;
 *  - the segments came out uneven because their width was negotiated from their labels;
 *  - the rail looked shrunken beside the title because it carried its own absolute font size
 *    while the title and icon carried different ones.
 *
 * Each of those is a statement about the stylesheet, and each is asserted below.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = (name: string) => readFileSync(join(here, name), "utf-8");

/** The body of one rule, by exact selector. */
function ruleBody(source: string, selector: string): string {
  const at = source.indexOf(`\n${selector} {`);
  expect(at, `selector ${selector} not found`).toBeGreaterThan(-1);
  const open = source.indexOf("{", at);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

const PHASES: PhaseData[] = [
  { id: 0, phase_name: "Introduction", phase_desc: "Intro" },
  { id: 1, phase_name: "Requirement Engineering", phase_desc: "Req" },
  { id: 2, phase_name: "Data Engineering", phase_desc: "Data" },
  { id: 3, phase_name: "Model Engineering", phase_desc: "Model" },
  { id: 4, phase_name: "Model Deployment", phase_desc: "Deploy" },
  { id: 5, phase_name: "Monitoring/ Usage", phase_desc: "Ops" },
];

function renderRail(phases: PhaseData[] = PHASES, currentPhase = 1) {
  return render(
    <PhasesContext.Provider
      value={{ currentPhase, setCurrentPhase: () => {}, phases, setPhases: () => {} }}
    >
      <PhaseOverview />
    </PhasesContext.Provider>,
  );
}

describe("phase rail layout", () => {
  it("splits the rail into one equal column per phase, plus a column for the tail", () => {
    renderRail();
    const rail = screen.getByRole("list", { name: /lifecycle phases/i });
    expect(rail.style.gridTemplateColumns).toBe("repeat(6, minmax(0, 1fr)) auto");
  });

  it("keeps the column count in step with the number of phases", () => {
    renderRail(PHASES.slice(0, 3));
    const rail = screen.getByRole("list", { name: /lifecycle phases/i });
    expect(rail.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr)) auto");
  });

  it("renders one segment per phase plus the next-cycle tail", () => {
    renderRail();
    // Six phases are list items; the tail is deliberately a note, not a step, so it is not
    // counted as one of the phases by assistive technology.
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText("Next cycle")).toBeInTheDocument();
  });

  it("marks the phase the player is in", () => {
    renderRail(PHASES, 1);
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent(
      "Requirement Engineering",
    );
  });

  it("renders no tail when there are no phases yet", () => {
    renderRail([], 0);
    expect(screen.queryByText("Next cycle")).not.toBeInTheDocument();
  });
});

describe("phase rail stylesheet", () => {
  const rail = css("PhaseOverview.module.css");

  it("lays the rail out as a grid, so widths are never negotiated from labels", () => {
    expect(ruleBody(rail, ".rail")).toMatch(/display:\s*grid/);
    expect(ruleBody(rail, ".rail")).toMatch(/width:\s*100%/);
  });

  it("lets every segment shrink below its label", () => {
    expect(ruleBody(rail, ".step")).toMatch(/min-width:\s*0/);
    const name = ruleBody(rail, ".stepName");
    expect(name).toMatch(/min-width:\s*0/);
    expect(name).toMatch(/overflow:\s*hidden/);
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
  });

  it("carries no absolute size of its own, so it scales with its header", () => {
    // px or rem anywhere in the segment's own box would decouple the rail from the title
    // beside it - the fault that left an 11px chevron next to a 27px icon.
    const step = ruleBody(rail, ".step");
    expect(step).not.toMatch(/font-size/);
    expect(step).not.toMatch(/\d(px|rem)/);
  });
});

describe("headers that host the rail", () => {
  const cases: Array<[string, string]> = [
    ["Performance Dashboard", "PerformanceDashboard.module.css"],
    ["Phase Briefing", "PrePhaseDialog.module.css"],
  ];

  it.each(cases)("%s gives the rail only the leftover space", (_name, file) => {
    const body = ruleBody(css(file), ".headerPhases");
    // `flex: 1 1 auto` sizes from content and pushes the rail into the close button.
    expect(body).toMatch(/flex:\s*1\s+1\s+0/);
    expect(body).toMatch(/min-width:\s*0/);
  });

  it.each(cases)("%s drives one type scale for title, icon and rail", (_name, file) => {
    const source = css(file);
    expect(ruleBody(source, ".header")).toMatch(/--hdr:\s*clamp\(/);
    expect(ruleBody(source, ".header")).toMatch(/font-size:\s*var\(--hdr\)/);
    // Everything else in the header is a multiple of that one size.
    expect(ruleBody(source, ".headerTitle")).toMatch(/font-size:\s*[\d.]+em/);
    expect(ruleBody(source, ".headerPhases")).toMatch(/font-size:\s*[\d.]+em/);
  });
});
