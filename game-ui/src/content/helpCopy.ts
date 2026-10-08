// Copy for the intro coach tips, the guided pitch session and veto feedback.
// Rules: no digits, no em dashes, no thresholds. Counts come from live state as parameters.
// The demo resets when it ends, so consequences are phrased "in the real game".

/** What the guide knows about why a component comes first, from live notes. */
export interface GuideWhy {
  fact?: string;
  driver?: { who: string; text: string; canStop?: boolean };
}

const sentence = (s: string): string => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : t + ".";
};

export interface CoachTipCopy {
  title: string;
  body: string;
}

export const COACH_TIPS = {
  cardCost: (cost: number, left: number): CoachTipCopy => ({
    title: "Not enough tokens",
    body: `That card costs ${cost} and you have ${left} left. Pick a cheaper one, or save what you have for the pitch.`,
  }),
  cardUsed: (): CoachTipCopy => ({
    title: "Already played",
    body: "You have used that card this round. Try another one, or open the Pitch Deck when you are ready.",
  }),
  thinIntel: (): CoachTipCopy => ({
    title: "Thin on verified intel",
    body: "Most of your notes are still unconfirmed. Play Verify Intel on one you are unsure about first, or go in anyway and see how the room reacts.",
  }),
  cappedStep: (name: string, upstream?: string): CoachTipCopy => ({
    title: "That step will fall short",
    body: `${name} will only run as far as what feeds it allows${upstream ? `, and ${upstream} sits in front of it` : ""}. Fix ${upstream ?? "what feeds it"} first, then this step can take full effect.`,
  }),
  likelyVeto: (): CoachTipCopy => ({
    title: "Someone will say no",
    body: "Open their page and reread what they refuse to accept, or commit anyway to see what a veto is. Nothing here carries into the real game.",
  }),
} as const;

export const PITCH_GUIDE = {
  cast: "Two people sit at this table. Next to each name you will find a little bolt and an eye: hover them to see how much power and interest that person has. The radar from your briefing is the reference: power is who can stop you, interest is how strongly they react.",
  castTitle: "The Cast",
  verify: {
    title: "Check before you trust",
    body: "Some of your notes are only hearsay. Play Verify Intel on the one you doubt: click the card or drag it onto the table, then pick the note.",
  },
  verifyRight: {
    title: "That one held up",
    body: "That note held up. Confirmed notes are safe to build a proposal on.",
  },
  verifyWrong: {
    title: "Good thing you asked",
    body: "Glad you checked. That note was filed under the wrong type, and now it is corrected. Unchecked notes can mislead you.",
  },
  talk: (name: string, cardTitle?: string): CoachTipCopy => ({
    title: "Talk to whoever can stop you",
    body: cardTitle
      ? `Click ${cardTitle}, then pick ${name} when it asks who to talk to. You can also drag the card onto the table, it will still ask who.`
      : `Play a conversation card and pick ${name} when it asks who to talk to. Ask what they will not accept.`,
  }),
  ask: (name: string, example?: string): CoachTipCopy => ({
    title: "Pick a question",
    body: example
      ? `Each button is a topic, a part of the pipeline. Pick the one closest to today's problem, for example "${example}". ${name} answers with something you can file in the dossier, and you only get one question, so aim.`
      : `Each button is a topic, a part of the pipeline. Pick the one closest to today's problem. ${name} answers with something you can file in the dossier, and you only get one question, so aim.`,
  }),
  reveal: {
    title: "Peek at their page",
    body: "Open their page and read what they said. Somewhere in there is a line they will not let you cross.",
  },
  deck: {
    title: "Time to build",
    body: "Open the Pitch Deck, change the pipeline, and take it to the room.",
  },
  reactions: {
    title: "Read the room",
    body: "The meter on each page shows where someone stands: five notches, from against you to fully behind you. Change your proposal and watch it move. When you are ready, commit to hear the decision.",
  },
  dismiss: "Got it",
  skip: "Skip the guide",
  skipStep: "Skip this step",
} as const;

/** Composer guide hints. Names and options come from live state; no level numbers. */
export const COMPOSE_GUIDE = {
  canvas: {
    title: "Meet the pipeline",
    body: "This is the pipeline. Each box is a component, and each line is a hand-off, the moment one box passes its result to the next. Click a box, or the little handle on a line, to look closer.",
  },
  dials: {
    title: "Two dials on everything",
    body: "The legend is open for you. Every box and hand-off has two dials: automation is who does the work, a person or tooling, and governance is who checks it. The colours show where each one stands today.",
  },
  pickNode: (name: string, why: GuideWhy = {}): CoachTipCopy => {
    const lines: string[] = [];
    if (why.fact) lines.push(sentence(why.fact));
    // The note already names its author ("Bruce proposed ..."), so it is not wrapped in a "says".
    if (why.driver) lines.push(sentence(why.driver.text));
    if (!why.fact && !why.driver) lines.push(`This challenge is about ${name}, and it is where the trouble starts.`);
    lines.push(
      why.driver?.canStop
        ? "Everything downstream leans on what feeds it, and the one asking can stop the whole plan, so this is where you start."
        : "Everything downstream leans on what feeds it, so this is where you start.",
    );
    lines.push(`Click ${name} on the canvas.`);
    return { title: `Why ${name} first`, body: lines.join(" ") };
  },
  pickOption: (option: string, name: string, what: string, who?: string): CoachTipCopy => ({
    title: "Pick a step",
    body: `${option} means ${what}. ${who ? `That is what ${who} is after, and it` : "It"} takes the weight off people so they can do other work. On the right, press Add next to ${option}; it takes one slot for ${name} and you can take it back out any time.`,
  }),
  raiseMore: (name: string, first: string, wanted: string, broken: boolean, what: string, who?: string): CoachTipCopy => ({
    title: "One more step",
    body: `${name} ${broken ? "is broken" : "is not built yet"}, so ${who ? `${who}'s ask` : "this ask"} takes two steps in two slots: first ${first}, then ${wanted} (${what}). You have taken the first. Press Add next to ${wanted}; that still leaves a slot for the stakeholder's other concern.`,
  }),
  governance: (name: string, option: string | undefined, locked: boolean): CoachTipCopy => ({
    title: "The second dial",
    body:
      (option
        ? `Governance is who checks the work. On ${name} the step on offer is ${option}.`
        : `Governance is who checks the work, and ${name} has its own steps for it.`) +
      (locked
        ? " It unlocks once the component is actually implemented."
        : " You only have four slots, so answer the person who can stop you first and leave this for later."),
  }),
  feeds: {
    title: "What feeds on what",
    body: "Follow the lines: something downstream only works as well as what feeds it. The stakeholder's notes in the dossier say what else must be in place, so go and read them. Still stuck? The Hint button at the bottom nudges you.",
  },
  slots: {
    title: "Slots, then the room",
    body: "Every change takes a slot, and one proposal holds three at most, so spend them well. When you are ready, press Confirm proposal to take it to the room.",
  },
} as const;

/** Small label above a hint title. */
export const COACH_EYEBROW = { guide: "A little nudge", mistake: "Heads up" } as const;

export const SEAT_CHIPS = {
  power: {
    high: "High power: can stop the whole plan.",
    low: "Low power: can only grumble, cannot block the plan.",
  },
  interest: {
    high: "High interest: cares a lot, so your words and proposal move their mood strongly.",
    low: "Low interest: cares less, so your words and proposal move their mood gently.",
  },
} as const;

export const ESCALATIONS = {
  label: "Escalations",
  hint: (left: number, name?: string) =>
    left > 0
      ? `Spend one Escalation Point (${left} left) to push this exact card through anyway. ${name || "They"} will remember it.`
      : "No Escalation Points left this playthrough.",
  chipHint: (left: number) =>
    left > 0
      ? `Spend one Escalation Point (${left} left) after a veto to push this exact card through anyway. People will remember it.`
      : "No Escalation Points left this playthrough.",
} as const;

export const TABLE_IT = {
  button: "Table It",
  hint: "End this challenge with nothing agreed. No Escalation Point is spent, but people will remember it.",
  ceiling: {
    PASS: "A proposal this room accepts does exist. Keep revising.",
    SOFT_PASS: "The best this room allows is a reluctant yes: someone is always left unhappy. A proposal like that can still get through.",
    VETO: "Nothing we tried clears this room. Pushing it through costs an Escalation Point and someone will remember it. Tabling it ends the challenge with nothing agreed.",
  },
} as const;

export const VETO_FEEDBACK = {
  meansLabel: "What it means",
  means: "Someone with high power can stop the whole plan, and here you cannot push past them. Their objection tells you what to fix.",
  changeLabel: "What you could change",
  boundary: (component: string, option: string) => `Give ${component} at least ${option}.`,
  driver: (component: string, option: string, first?: { option: string; broken: boolean }) =>
    `They asked for ${option} on ${component}.` +
    (first
      ? ` ${component} ${first.broken ? "is broken" : "is not built yet"}, so that takes two steps in two slots: first ${first.option}, then ${option}.`
      : ""),
  boundaryNoOption: (component: string) => `Look again at ${component}. Their note says what it must be.`,
  fallback: "Reread their objection, then change the proposal to answer it.",
  repeat: (component?: string) =>
    component
      ? `Same objection again. Open the proposal on ${component} and raise it before you pitch.`
      : "Same objection again. Answer it directly before you pitch.",
  showObjection: "Show me the objection",
  revise: "Revise proposal",
  introFooter: "Revise your proposal to answer the objection, then pitch again. There is no way around a veto in this walkthrough.",
} as const;
