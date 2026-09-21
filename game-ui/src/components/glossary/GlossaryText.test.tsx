import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import GlossaryProvider from "./GlossaryProvider";
import GlossaryText from "./GlossaryText";
import type { GlossaryConfig } from "../../services/api/glossary";

function config(
  kind: string,
  underline: "dotted" | "wavy",
  terms: GlossaryConfig["terms"],
  categories: GlossaryConfig["categories"] = []
): GlossaryConfig {
  return {
    kind,
    settings: {
      enabled: true,
      underline_style: underline,
      case_sensitive: false,
      match_whole_words: true,
      max_highlights_per_term_per_block: 1,
      min_term_length: 2,
      surfaces: {
        stakeholder_messages: true,
        speech_bubbles: false,
        intel_notes: true,
        intel_artifacts: true,
        dossier_profile: true,
        dialogue_options: true,
        challenge_briefing: true,
        action_proposal: true,
      },
    },
    categories,
    terms,
  };
}

const MLOPS = config(
  "mlops",
  "dotted",
  [
    {
      id: "distribution",
      term: "distribution",
      aliases: [],
      category: "data",
      definition: "the statistical shape of a feature's values",
    },
  ],
  [{ id: "data", label: "Data Engineering", color: "#14b8a6" }]
);

const DOMAIN = config(
  "domain",
  "wavy",
  [
    {
      id: "distribution_centre",
      term: "distribution centre",
      aliases: [],
      category: "supply",
      definition: "the regional warehouse that sends each store what it ordered",
    },
  ],
  [{ id: "supply", label: "Supply Chain", color: "#0d9488" }]
);

function renderText(text: string, configs: GlossaryConfig[] = [MLOPS, DOMAIN]) {
  return render(
    <GlossaryProvider overrideConfig={configs}>
      <GlossaryText text={text} surface="intel_notes" />
    </GlossaryProvider>
  );
}

describe("GlossaryText with both glossaries", () => {
  it("underlines a domain term wavy and an MLOps term dotted", () => {
    renderText("the input distribution moved after the distribution centre changed its cut off");

    const mlops = screen.getByText("distribution");
    const domain = screen.getByText("distribution centre");

    expect(mlops.getAttribute("data-glossary-underline")).toBe("dotted");
    expect(domain.getAttribute("data-glossary-underline")).toBe("wavy");
  });

  it("marks the warehouse once, as the domain term, not as two overlapping highlights", () => {
    const { container } = renderText("the distribution centre ships overnight");

    const marks = container.querySelectorAll("[data-glossary-term]");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("distribution centre");
    expect(marks[0].getAttribute("data-glossary-term")).toBe("distribution_centre");
  });

  it("leaves the text alone when every glossary has this surface switched off", () => {
    const offEverywhere = [MLOPS, DOMAIN].map((c) => ({
      ...c,
      settings: { ...c.settings, surfaces: { ...c.settings.surfaces, intel_notes: false } },
    }));
    const { container } = renderText("the distribution centre ships overnight", offEverywhere);

    expect(container.querySelectorAll("[data-glossary-term]")).toHaveLength(0);
    expect(container.textContent).toBe("the distribution centre ships overnight");
  });

  it("keeps the author's wording exactly, including its capitalisation", () => {
    renderText("The Distribution Centre opens at five");
    expect(screen.getByText("Distribution Centre")).toBeTruthy();
  });
});
