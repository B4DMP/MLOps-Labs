/** Case board (docs/plans/case-board.md): threads between stakeholders and how they are shown. */

export type ThreadKind = "ally" | "rift" | "chain" | "step";

export interface BoardThread {
  id: string;
  kind: ThreadKind;
  /** For a chain, the one who waits on `b`. */
  a: string;
  b: string;
  target: string;
  a_item_ids: string[];
  b_item_ids: string[];
  via?: string | null;
  /** The challenge's own conflict: pinned for free. */
  on_record?: boolean;
}

/** One row of the answer key, sent only when the dossier debug flag is on. */
export interface BoardDebugRelation extends BoardThread {
  found: boolean;
  /** The player holds a verified note on each side. */
  eligible: boolean;
  /** Names of the people whose verified notes the player still lacks. */
  lacking: string[];
}

export interface BoardState {
  visible: boolean;
  people: string[];
  found: BoardThread[];
  /** Pairs the game says have something between them. Never the kind. */
  hints: string[][];
  attempts_left: number;
  /** How many guesses a challenge starts with. */
  attempts_total?: number;
  /** Notes the player has ticked as covered by the pitch they are building. Theirs alone. */
  penciled?: string[];
  debug?: BoardDebugRelation[];
}

export type ConnectCode =
  | "found" | "already_found" | "wrong_kind" | "nothing" | "not_enough_intel" | "no_attempts";

export interface BoardResult {
  code: ConnectCode;
  relation: BoardThread | null;
  attempts_left: number;
}

export interface ThreadMeta {
  label: string;
  /** The dock's plural. */
  plural: string;
  /** The short tag on the thread. */
  tag: string;
  icon: string;
  color: string;
  /** What the chooser offers. */
  choice: string;
  /** What the thread does in the pitch, in plain words (no numbers). */
  effect: string;
}

export const THREAD_KINDS: ThreadKind[] = ["ally", "rift", "chain", "step"];

export const THREAD_META: Record<ThreadKind, ThreadMeta> = {
  ally: {
    label: "Allies", plural: "Allies", tag: "Same direction", icon: "ph:handshake-duotone", color: "#d99a14",
    choice: "Allies: pushing the same way",
    effect: "When one of them backs your card in the pitch, the other warms to it a little.",
  },
  rift: {
    label: "Rift", plural: "Rifts", tag: "At odds", icon: "ph:lightning-duotone", color: "#c0392b",
    choice: "Rift: opposite asks",
    effect: "If a Trade-off can settle it, the card builder shows the two notes as a compromise pair.",
  },
  chain: {
    label: "Chain", plural: "Chains", tag: "Depends on", icon: "ph:link-simple-duotone", color: "#3b5bdb",
    choice: "Chain: one waits on the other",
    effect: "The card builder notes which change comes after the other person's step, so you see the cap before an objection costs patience.",
  },
  step: {
    label: "Same step", plural: "Steps", tag: "Same step", icon: "ph:stack-duotone", color: "#0f8b8d",
    choice: "Same step: different asks on it",
    effect: "The card builder marks that step with both their names, so changing it never surprises either of them.",
  },
};

/** The message shown for each answer to a guess, with the two people's display names. */
export const resultMessage = (code: ConnectCode, a: string, b: string): string => {
  switch (code) {
    case "found": return "Thread found. The notes behind it are listed below the board.";
    case "already_found": return "You already have that one pinned.";
    case "wrong_kind": return `${a} and ${b} are tied, but not in that way. Look again at what each of them asked for.`;
    case "nothing": return `Nothing you know ties ${a} and ${b} together.`;
    case "not_enough_intel": return `You do not know enough about both ${a} and ${b} yet. Confirm more of their notes first.`;
    case "no_attempts": return "Out of threads for this challenge. Pitch with what you have.";
  }
};
