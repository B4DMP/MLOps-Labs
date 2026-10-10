import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCaseBoard } from "./useCaseBoard";
import type { BoardThread } from "../types/CaseBoard";

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Handler>();
const emit = vi.fn();

const subscribe = (event: string, cb: Handler) => {
  handlers.set(event, cb);
  return () => handlers.delete(event);
};
const socket = { emit, subscribe };

vi.mock("../services/websocket/useGameWebSocket", () => ({ useGameWebSocket: () => socket }));

const thread: BoardThread = {
  id: "t1", kind: "ally", a: "amy", b: "bob", target: "t", a_item_ids: ["i1"], b_item_ids: ["i2"],
};
const send = (event: string, payload: unknown) => act(() => handlers.get(event)?.(payload));

describe("useCaseBoard", () => {
  beforeEach(() => {
    handlers.clear();
    emit.mockClear();
  });

  it("asks for the board of this challenge and shows what the server sends", () => {
    const { result } = renderHook(() => useCaseBoard(2, 1));
    expect(emit).toHaveBeenCalledWith("board:get", { phase_id: 2, challenge_id: 1 });
    expect(result.current.board.visible).toBe(false);

    send("board:state", { visible: true, people: ["amy", "bob", "cat"], found: [], hints: [["amy", "bob"]], attempts_left: 3 });
    expect(result.current.board.people).toHaveLength(3);
    expect(result.current.board.hints).toEqual([["amy", "bob"]]);
  });

  it("sends a guess and folds a found thread and the spent hint into the board", () => {
    const { result } = renderHook(() => useCaseBoard(2, 1));
    send("board:state", { visible: true, people: ["amy", "bob", "cat"], found: [], hints: [["amy", "bob"]], attempts_left: 3 });

    act(() => result.current.connect("amy", "bob", "ally"));
    expect(emit).toHaveBeenCalledWith("board:connect", { phase_id: 2, challenge_id: 1, a: "amy", b: "bob", kind: "ally" });

    send("board:result", { code: "found", relation: thread, attempts_left: 3 });
    expect(result.current.outcome).toMatchObject({ code: "found", a: "amy", b: "bob", seq: 1 });
    expect(result.current.board.found).toEqual([thread]);
    expect(result.current.board.hints).toEqual([]);
  });

  it("spends a guess without adding a thread on a wrong answer", () => {
    const { result } = renderHook(() => useCaseBoard(2, 1));
    send("board:state", { visible: true, people: ["amy", "bob", "cat"], found: [], hints: [], attempts_left: 3 });
    act(() => result.current.connect("amy", "cat", "rift"));
    send("board:result", { code: "nothing", relation: null, attempts_left: 2 });
    expect(result.current.board.found).toHaveLength(0);
    expect(result.current.board.attempts_left).toBe(2);
  });
});
