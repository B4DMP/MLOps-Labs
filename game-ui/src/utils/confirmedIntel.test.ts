import { describe, expect, it } from "vitest";
import { confirmedIntelRows } from "./confirmedIntel";

const item = (o: Record<string, unknown>) => ({
  id: "a",
  intel_type: "verified",
  categorized_type: "driver",
  description: "Emilia wants faster retraining.",
  ...o,
});

const page = (items: ReturnType<typeof item>[], extra = {}) => ({
  stakeholder_id: "emilia",
  name: "Emilia",
  intel_items: items,
  ...extra,
});

describe("confirmedIntelRows", () => {
  it("never lists unconfirmed notes", () => {
    expect(confirmedIntelRows([page([item({ intel_type: "unconfirmed" })])])).toEqual([]);
  });

  it("drops the subject so the stakeholder column carries it", () => {
    const [row] = confirmedIntelRows([page([item({})])]);
    expect(row.text).toBe("faster retraining");
    expect(row.stakeholderName).toBe("Emilia");
  });

  it("keeps only the newest link of a refinement chain", () => {
    const rows = confirmedIntelRows([
      page([
        item({ id: "1", chain_id: "c", chain_position: 0, description: "Emilia wants retraining." }),
        item({ id: "2", chain_id: "c", chain_position: 1, description: "Emilia wants weekly retraining." }),
      ]),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["2"]);
  });

  it("splits a trade-off into what is asked and what is given up", () => {
    const [row] = confirmedIntelRows([
      page([
        item({
          categorized_type: "trade_off",
          branch_x: { description: "Slower alerts." },
          branch_y: { description: "Cheaper hosting." },
        }),
      ]),
    ]);
    expect(row.kind).toBe("trade_off");
    expect([row.text, row.giveUp]).toEqual(["slower alerts", "cheaper hosting"]);
  });

  it("skips the challenge-intel page and sinks resolved rows", () => {
    const rows = confirmedIntelRows([
      page([item({ id: "done", status: "addressed" }), item({ id: "open" })]),
      page([item({ id: "fact" })], { is_challenge_intel: true }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["open", "done"]);
  });
});
