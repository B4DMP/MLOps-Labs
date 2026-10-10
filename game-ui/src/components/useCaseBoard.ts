import { useCallback, useEffect, useRef, useState } from "react";
import { useGameWebSocket } from "../services/websocket/useGameWebSocket";
import type { BoardResult, BoardState, ThreadKind } from "../types/CaseBoard";

export interface BoardOutcome extends BoardResult {
  /** Bumps on every answer, so the same message twice in a row still shows. */
  seq: number;
  a: string;
  b: string;
}

const EMPTY: BoardState = { visible: false, people: [], found: [], hints: [], attempts_left: 0 };

/** Case board state for one challenge: loaded on open, kept live by the server's pushes. */
export function useCaseBoard(phase: number, challenge: number) {
  const { emit, subscribe } = useGameWebSocket();
  const [board, setBoard] = useState<BoardState>(EMPTY);
  const [outcome, setOutcome] = useState<BoardOutcome | null>(null);
  const lastGuess = useRef<{ a: string; b: string }>({ a: "", b: "" });
  const seq = useRef(0);

  // A new challenge starts from an empty board until the server answers.
  useEffect(() => {
    setBoard(EMPTY);
    setOutcome(null);
    emit("board:get", { phase_id: phase, challenge_id: challenge });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, challenge]);

  useEffect(() => {
    const offState = subscribe<BoardState>("board:state", (data) => setBoard(data));
    const offResult = subscribe<BoardResult>("board:result", (data) => {
      seq.current += 1;
      setOutcome({ ...data, seq: seq.current, ...lastGuess.current });
      setBoard((prev) => {
        const found = data.relation && !prev.found.some((t) => t.id === data.relation!.id)
          ? [...prev.found, data.relation]
          : prev.found;
        return {
          ...prev,
          found,
          attempts_left: data.attempts_left,
          hints: data.code === "found" && data.relation
            ? prev.hints.filter((p) => !(p.includes(data.relation!.a) && p.includes(data.relation!.b)))
            : prev.hints,
        };
      });
    });
    return () => {
      offState();
      offResult();
    };
  }, [subscribe]);

  const connect = useCallback(
    (a: string, b: string, kind: ThreadKind) => {
      lastGuess.current = { a, b };
      emit("board:connect", { phase_id: phase, challenge_id: challenge, a, b, kind });
    },
    [emit, phase, challenge],
  );

  // Optimistic: the tick shows at once, and the server's board:state confirms it.
  const togglePencil = useCallback(
    (itemId: string, on: boolean) => {
      setBoard((prev) => {
        const rest = (prev.penciled ?? []).filter((id) => id !== itemId);
        return { ...prev, penciled: on ? [...rest, itemId] : rest };
      });
      emit("board:pencil", { phase_id: phase, challenge_id: challenge, item_id: itemId, on });
    },
    [emit, phase, challenge],
  );

  return { board, outcome, connect, togglePencil };
}
