/** Whether a stakeholder's buy-in reading is shown (not blurred) in the dossier. */
export function isReadRevealed(a: { spokeNow: boolean; quiet: boolean; spokeEarlier: boolean }): boolean {
  // A quiet stakeholder never speaks in the newest pitch; their earlier reading still stands.
  return a.spokeNow || (a.quiet && a.spokeEarlier);
}
