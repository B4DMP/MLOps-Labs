// Copy for the composer walkthrough, hint button and the MLOps Graph cheat sheet tab.
// Rules: no digits, no em dashes, option names instead of level numbers.

export const GRAPH_TOUR = {
  stages:
    "The tabs are the pipeline stages. Only the stage for your current phase can be changed, the others are view only so you can see what depends on what.",
  canvas:
    "Each box is a component of the pipeline. Each line is a hand-off, the moment one component passes its result to the next. Click a box or the handle on a line to look closer.",
  dials:
    "Every box and every hand-off has two dials. Automation is who does the work: a person, or tooling. Governance is who checks the work. The legend explains the colours.",
  select:
    "Try it. Click Data Ingestion, then pick Automate It on the right and it lands in a slot. Bruce wants this one, so it is a good first change.",
  governance:
    "Governance is the second dial. In the Data stage the only step is Spot Checks, one way to give Mark a say. It unlocks once the component is actually implemented.",
  feeds:
    "The lines show what feeds on what. Something downstream only works as well as what feeds it. Your dossier notes, especially Bruce's, tell you what else must be in place.",
  slots:
    "Every change takes a slot, and one proposal holds three changes at most. Use them well, then confirm to take the proposal to the room.",
} as const;

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
    "Mark wants a say. Spot Checks on ingestion is one way to give it to him.",
    "Bruce also refuses to accept some things. Your dossier notes say which, and the lines on the canvas show what feeds on what.",
    "Three changes fit in a proposal. Confirm it and see how the room reacts.",
  ],
} as const;
