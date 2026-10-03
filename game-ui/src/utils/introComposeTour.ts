// Module-level so reopening the composer doesn't replay the demo; replay resets it.
let started = false;

export const INTRO_COMPOSE_TOUR_GROUP = "introCompose";

export function markIntroComposeTourStarted(): boolean {
  if (started) return false;
  started = true;
  return true;
}

export function resetIntroComposeTour(): void {
  started = false;
}
