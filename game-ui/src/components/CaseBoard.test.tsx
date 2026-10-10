import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import CaseBoard, { type BoardPortrait, type SummaryContext } from "./CaseBoard";
import type { BoardState, BoardThread } from "../types/CaseBoard";
import { layoutPortraits } from "../utils/caseBoardLayout";
import type { BoardOutcome } from "./useCaseBoard";

// jsdom has no PointerEvent, so a drag would reach the handlers without its coordinates.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  (window as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill;
}

const portraits: BoardPortrait[] = ["amy", "bob", "cat", "dan"].map((id) => ({
  id, name: `${id.toUpperCase()} Smith`, color: "#38bdf8", face: "calm", highPower: id === "amy",
}));

const thread: BoardThread = {
  id: "t1", kind: "rift", a: "amy", b: "bob", target: "data.validation",
  a_item_ids: ["i1", "i2"], b_item_ids: ["i3"],
};

const board = (over: Partial<BoardState> = {}): BoardState => ({
  visible: true, people: portraits.map((p) => p.id), found: [], hints: [], attempts_left: 3, ...over,
});

interface Extra {
  outcome?: BoardOutcome | null;
  onConnect?: () => void;
  onOpenStakeholder?: (id: string) => void;
  onTogglePencil?: (id: string, on: boolean) => void;
}

// The dossier's summary, reduced to a list so the test can see what the board narrowed it to.
const summary = ({ onlyIds, activeStakeholder, penciled, onTogglePencil }: SummaryContext) => (
  <ul data-testid="summary" data-active={activeStakeholder ?? ""}>
    {["i1", "i2", "i3", "i4"].filter((id) => !onlyIds || onlyIds.has(id)).map((id) => (
      <li key={id}>
        Note {id}
        <input type="checkbox" aria-label={`pencil ${id}`} checked={penciled.has(id)} onChange={(e) => onTogglePencil(id, e.target.checked)} />
      </li>
    ))}
  </ul>
);

const boardElement = (state: BoardState, extra: Extra) => (
  <CaseBoard
    board={state}
    outcome={extra.outcome ?? null}
    portraits={portraits}
    renderSummary={summary}
    onOpenStakeholder={extra.onOpenStakeholder ?? vi.fn()}
    onConnect={extra.onConnect ?? vi.fn()}
    onTogglePencil={extra.onTogglePencil ?? vi.fn()}
  />
);

// An outcome is an answer that arrives while the board is open, so mount first and deliver it after.
const renderBoard = (state: BoardState, { outcome, ...extra }: Extra = {}) => {
  const view = render(boardElement(state, extra));
  if (outcome) view.rerender(boardElement(state, { ...extra, outcome }));
  return view;
};

const portrait = (id: string) => screen.getByTestId(`portrait-${id}`);
const space = (id: string) => fireEvent.keyDown(portrait(id), { key: " " });

describe("CaseBoard people", () => {
  it("opens a person's page when they are clicked", () => {
    const onOpenStakeholder = vi.fn();
    renderBoard(board(), { onOpenStakeholder });
    fireEvent.click(portrait("cat"));
    expect(onOpenStakeholder).toHaveBeenCalledWith("cat");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("breaks a name after the role word so a long one fits the card", () => {
    renderBoard(board());
    const lines = within(portrait("amy")).getByText("AMY").parentElement!;
    expect(lines.textContent).toBe("AMYSmith");
    expect(lines.querySelectorAll("span")).toHaveLength(2);
  });
});

describe("CaseBoard connecting", () => {
  it("ties two people by drag, from one portrait to another", () => {
    const onConnect = vi.fn();
    const onOpenStakeholder = vi.fn();
    renderBoard(board(), { onConnect, onOpenStakeholder });
    const places = layoutPortraits(portraits.map((p) => p.id));

    // jsdom has no layout, so the board reads client coordinates as board coordinates.
    fireEvent.pointerDown(portrait("amy"), { clientX: places.amy.x, clientY: places.amy.y, pointerId: 1 });
    fireEvent.pointerMove(screen.getByTestId("portrait-amy").parentElement!, { clientX: places.cat.x, clientY: places.cat.y, pointerId: 1 });
    fireEvent.pointerUp(screen.getByTestId("portrait-amy").parentElement!, { clientX: places.cat.x, clientY: places.cat.y, pointerId: 1 });
    fireEvent.click(portrait("amy")); // the click a real drag also produces is not an "open"

    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(5); // four kinds and Cancel
    fireEvent.click(within(menu).getByText("Same step: different asks on it"));
    expect(onConnect).toHaveBeenCalledWith("amy", "cat", "step");
    expect(onOpenStakeholder).not.toHaveBeenCalled();
  });

  it("ties two people from the keyboard: Space on one, then Space on the other", () => {
    const onConnect = vi.fn();
    renderBoard(board(), { onConnect });

    space("amy");
    expect(portrait("amy").getAttribute("aria-pressed")).toBe("true");
    space("cat");
    fireEvent.click(within(screen.getByRole("menu")).getByText("Chain: one waits on the other"));

    expect(onConnect).toHaveBeenCalledWith("amy", "cat", "chain");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps every choice on one line", () => {
    renderBoard(board());
    space("amy");
    space("bob");
    for (const item of within(screen.getByRole("menu")).getAllByRole("menuitem")) {
      expect(item.textContent).not.toMatch(/\n/);
    }
  });

  it("closes the chooser on Escape without guessing", () => {
    const onConnect = vi.fn();
    renderBoard(board(), { onConnect });
    space("amy");
    space("bob");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("Space on the picked person again cancels the pick", () => {
    renderBoard(board());
    space("amy");
    space("amy");
    expect(portrait("amy").getAttribute("aria-pressed")).toBe("false");
  });

  it("opens the chooser from a hint without naming a kind", () => {
    const onConnect = vi.fn();
    renderBoard(board({ hints: [["bob", "cat"]] }), { onConnect });
    const hint = screen.getByTestId("hint-bob-cat");
    expect(hint.textContent).toContain("Something here?");
    fireEvent.click(hint);
    fireEvent.click(within(screen.getByRole("menu")).getByText("Rift: opposite asks"));
    expect(onConnect).toHaveBeenCalledWith("bob", "cat", "rift");
  });
});

describe("CaseBoard summary and feedback", () => {
  it("shows every confirmed note until a thread is picked, then only the ones behind it", () => {
    renderBoard(board({ found: [thread] }));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);

    fireEvent.click(screen.getByTestId("thread-t1"));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Note i1", "Note i2", "Note i3"]);
    expect(screen.getByText(/compromise pair/)).toBeTruthy();

    fireEvent.click(screen.getByText("Show all"));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("picking the same thread again shows everything again", () => {
    renderBoard(board({ found: [thread] }));
    fireEvent.click(screen.getByTestId("thread-t1"));
    fireEvent.click(screen.getByTestId("thread-t1"));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("counts threads by kind and never shows a total to find", () => {
    renderBoard(board({ found: [thread] }));
    expect(screen.getByText(/1 thread found/)).toBeTruthy();
    expect(screen.queryByText(/ of \d+ threads/)).toBeNull();
    expect(screen.getByText(/Rifts/).textContent).toContain("1");
  });

  it("says what each answer means and narrows the summary to a found thread", () => {
    const outcome: BoardOutcome = {
      code: "found", relation: thread, attempts_left: 3, seq: 1, a: "amy", b: "bob",
    };
    renderBoard(board({ found: [thread] }), { outcome });
    expect(screen.getByRole("status").textContent).toContain("Thread found");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("does not replay an answer that was already shown when the board is opened again", () => {
    const outcome: BoardOutcome = { code: "nothing", relation: null, attempts_left: 2, seq: 1, a: "amy", b: "cat" };
    render(boardElement(board(), { outcome }));
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it.each([
    ["nothing", /Nothing you know ties AMY Smith and CAT Smith/],
    ["not_enough_intel", /do not know enough about both AMY Smith and CAT Smith/],
    ["wrong_kind", /tied, but not in that way/],
    ["no_attempts", /Out of threads/],
  ] as const)("explains a %s answer", (code, pattern) => {
    const outcome: BoardOutcome = { code, relation: null, attempts_left: 0, seq: 1, a: "amy", b: "cat" };
    renderBoard(board(), { outcome });
    expect(screen.getByRole("status").textContent).toMatch(pattern);
  });

  it("shows the guesses left as pins", () => {
    renderBoard(board({ attempts_left: 1 }));
    expect(screen.getByLabelText("1 left")).toBeTruthy();
  });
});

describe("CaseBoard pencil and highlighting", () => {
  it("passes the pencil marks down and reports a tick", () => {
    const onTogglePencil = vi.fn();
    renderBoard(board({ penciled: ["i2"] }), { onTogglePencil });
    expect((screen.getByLabelText("pencil i2") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("pencil i1") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText("pencil i1"));
    expect(onTogglePencil).toHaveBeenCalledWith("i1", true);
  });

  it("lights the summary's person while a portrait is hovered or focused, and clears it after", () => {
    renderBoard(board());
    expect(screen.getByTestId("summary").getAttribute("data-active")).toBe("");
    fireEvent.mouseEnter(portrait("bob"));
    expect(screen.getByTestId("summary").getAttribute("data-active")).toBe("bob");
    fireEvent.mouseLeave(portrait("bob"));
    expect(screen.getByTestId("summary").getAttribute("data-active")).toBe("");
    fireEvent.focus(portrait("cat"));
    expect(screen.getByTestId("summary").getAttribute("data-active")).toBe("cat");
  });

  it("explains the pencil boxes once, then stays quiet once dismissed", () => {
    window.localStorage.removeItem("caseBoardPencilHintSeen");
    const { unmount } = renderBoard(board());
    expect(screen.getByText(/Pencil in your pitch/)).toBeTruthy();
    fireEvent.click(screen.getByText("Got it"));
    expect(screen.queryByText(/Pencil in your pitch/)).toBeNull();
    unmount();
    renderBoard(board());
    expect(screen.queryByText(/Pencil in your pitch/)).toBeNull();
  });
});
