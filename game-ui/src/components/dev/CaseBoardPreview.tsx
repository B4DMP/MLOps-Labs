import { useState } from "react";
import CaseBoard, { type BoardPortrait } from "../CaseBoard";
import type { BoardState, BoardThread } from "../../types/CaseBoard";
import type { BoardOutcome } from "../useCaseBoard";

/**
 * Isolated harness for the case board. Open `/?dev=case-board` in the running app.
 *
 * The board scales with the box the dossier gives it, so its bugs are bugs about available
 * width and height, which a unit test cannot show. This renders the real component with its
 * real stylesheet at several page sizes, with 4 or 6 people and with or without threads. The
 * summary under the board is a stand-in for the dossier's "What they want" table.
 */

const NAMES = ["Requirements Ryan", "Efficiency Evelyn", "Automation Aaron", "Reliability Rachel", "Data Dave", "Model Monica"];
const COLORS = ["#7c3aed", "#0891b2", "#ea580c", "#be185d", "#2563eb", "#16a34a"];
const SIZES: Array<[number, number]> = [[745, 640], [900, 640], [640, 560]];

const portraits = (n: number): BoardPortrait[] =>
  NAMES.slice(0, n).map((name, i) => ({
    id: `p${i}`, name, color: COLORS[i], face: "calm", highPower: i % 2 === 0,
  }));

const thread = (id: string, kind: BoardThread["kind"], a: string, b: string, ids: [string, string]): BoardThread => ({
  id, kind, a, b, target: "t", a_item_ids: [ids[0]], b_item_ids: [ids[1]],
});

const state = (n: number, threads: BoardThread[], hints: string[][] = []): BoardState => ({
  visible: true, people: portraits(n).map((p) => p.id), found: threads, hints, attempts_left: 3, attempts_total: 5,
});

const NOTES = ["n1", "n2", "n3", "n4", "n5", "n6"];

export default function CaseBoardPreview() {
  const [people, setPeople] = useState(4);
  const [filled, setFilled] = useState(true);
  const [log, setLog] = useState("");
  const threads = filled
    ? [
      thread("t1", "ally", "p0", "p1", ["n1", "n2"]),
      thread("t2", "rift", "p0", "p2", ["n3", "n4"]),
      thread("t3", "chain", "p3", "p1", ["n5", "n6"]),
    ]
    : [];
  const outcome: BoardOutcome | null = null;

  return (
    <div style={{ padding: 16, fontFamily: "sans-serif" }}>
      <p>
        <button onClick={() => setPeople(people === 4 ? 6 : 4)}>{people} people</button>{" "}
        <button onClick={() => setFilled(!filled)}>{filled ? "with threads" : "empty"}</button>{" "}
        <span>{log}</span>
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        {SIZES.map(([w, h]) => (
          <div key={w} style={{ width: w, height: h, position: "relative", background: "#f7f4ea", border: "2px solid #444", overflow: "hidden" }}>
            <CaseBoard
              board={state(people, threads, filled ? [] : [["p1", "p3"]])}
              outcome={outcome}
              portraits={portraits(people)}
              renderSummary={({ onlyIds, penciled, onTogglePencil }) => (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                  {NOTES.filter((id) => !onlyIds || onlyIds.has(id)).map((id) => (
                    <li key={id}>
                      <label>
                        <input type="checkbox" checked={penciled.has(id)} onChange={(e) => onTogglePencil(id, e.target.checked)} />{" "}
                        Wants the validation step automated ({id}).
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              onTogglePencil={(id, on) => setLog(`pencil ${id} ${on}`)}
              onOpenStakeholder={(id) => setLog(`open ${id}`)}
              onConnect={(a, b, kind) => setLog(`connect ${a} ${b} ${kind}`)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
