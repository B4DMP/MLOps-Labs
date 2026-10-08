// Copy for the composer hint button and the MLOps Graph cheat sheet tab (guide hints: COMPOSE_GUIDE in helpCopy).
// Rules: no digits, no em dashes, option names instead of level numbers.

export const GRAPH_HINTS: readonly string[] = [
  "Reread what Bruce refuses to accept in your dossier notes.",
  "Look at Data Validation. Bruce cares about it.",
  "Give Data Validation at least Implement It Manually.",
];

export const GRAPH_HINT_TARGET = "data.validation";
export const GRAPH_HINT_OPTION = "Implement It Manually";

export const GRAPH_DEFINITIONS: ReadonlyArray<{ term: string; text: string }> = [
  { term: "Component", text: "One building block of the pipeline, such as Data Ingestion Pipeline or Data Validation." },
  { term: "Hand-off", text: "The line between two components, where one passes its result to the next." },
  { term: "Stage", text: "A group of components that belong to one phase of the project." },
  { term: "Automation", text: "Who does the work. A person doing it by hand, or tooling doing it for them." },
  { term: "Governance", text: "Who checks the work. The steps on offer differ per component, so read its own options." },
];

export const GRAPH_EXAMPLE = {
  title: "Worked example: the Honey Vault pitch",
  steps: [
    "Bruce wants Data Ingestion automated, so pick Automate It on Data Ingestion Pipeline.",
    "Governance (who checks the work) can wait. With four slots, answer the one who can stop you first.",
    "Bruce also refuses to accept some things. Your dossier notes say which, and the lines on the canvas show what feeds on what.",
    "Four changes fit in a proposal. Confirm it and see how the room reacts.",
  ],
} as const;
