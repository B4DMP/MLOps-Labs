// Copy for the intro coach tips, the guided pitch session and veto feedback.
// Rules: no digits, no em dashes, no thresholds. Counts come from live state as parameters.
// The demo resets when it ends, so consequences are phrased "in the real game".

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
  likelyVeto: (): CoachTipCopy => ({
    title: "Someone will say no",
    body: "Open their page and reread what they refuse to accept, or commit anyway to see what a veto is. Nothing here carries into the real game.",
  }),
} as const;

export const PITCH_GUIDE = {
  cast: "Two people sit at this table. Their nameplates show how much power and interest they have. Power decides who can stop you. A short guide follows.",
  castTitle: "The Cast",
  explainerOpen: "Power and interest guide",
  explainerDone: "Got it",
  verify: {
    title: "Verify first",
    body: "Play Verify Intel on the note you are unsure about. Click the card or drag it onto the table, then pick the note.",
  },
  talk: (name: string): CoachTipCopy => ({
    title: "Talk to the one who can stop you",
    body: `Now play a conversation card on ${name}. Ask what they will not accept.`,
  }),
  reveal: {
    title: "Check their page",
    body: "What you learn lands in their page. Look for the boundary, a line they will not let you cross.",
  },
  deck: {
    title: "Build your proposal",
    body: "Open the Pitch Deck, change the pipeline, and take it to the room.",
  },
  reactions: {
    title: "Read the room",
    body: "The buy-in gauge on each page shows how someone is leaning, in words. When you are ready, commit to hear the decision.",
  },
  dismiss: "Got it",
  skip: "Skip the guide",
} as const;

export const SEAT_CHIPS = {
  power: (high: boolean) => (high ? "High power" : "Low power"),
  interest: (high: boolean) => (high ? "High interest" : "Low interest"),
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

export const VETO_FEEDBACK = {
  meansLabel: "What it means",
  means: "Someone with high power can stop the whole plan, and here you cannot push past them. Their objection tells you what to fix.",
  changeLabel: "What you could change",
  boundary: (component: string, option: string) => `Give ${component} at least ${option}.`,
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
