
import introJs from "intro.js";
import { getSpeechGeneration, onNarrationEvent, waitForNarrationIdle } from "./speech";

/**
 * Shared driver for every `data-intro-group` guided tour in the app (see PrePhaseDialog,
 * StakeholderInteractionArea, offline_intel_gathering, pitch_debate, ComposeActionProposalModal,
 * ac_simulation). Before this existed, each call site built its own `introJs()` with a repeated
 * `{ exitOnEsc: false, exitOnOverlayClick: false }` literal and no way to actually leave a tour -
 * intro.js's own "Skip" link was globally hidden by CSS. This gives every tour the same two
 * explicit ways out (skip this one tooltip, skip this page's demo) and the same narration
 * hookup, instead of each screen reinventing both.
 *
 * There used to be a third, broader tier ("skip the whole intro demo", persisted across every
 * page for the rest of the run). It was removed: skipping is localized to one page's tour at a
 * time, same as the native "x" already did, so clicking it can never silently disable a *later*
 * page's demo the player hasn't even seen yet - the exact bug a persistent flag caused.
 */

export interface StartTourOptions {
  /** Fires once the tour ends, however it ends (finished, skipped, or force-exited). Mirrors
   *  what every existing call site already did with oncomplete/onexit: treat both the same. */
  onFinish?: () => void;
  /** Reads a step's own `data-intro` text aloud in the narrator voice; returns a cancel function
   *  the same shape `useSpeech().speak` already does. Passed in by the caller (a plain utility
   *  module cannot call the `useSpeech` hook itself), so narration still goes through whichever
   *  settings/backend that component's own `useSpeech()` resolves to. */
  narrate?: (text: string) => () => void;
  /** Awaited before the tour touches the DOM or narrates, e.g. the narrator start gate
   *  (`requestNarratorGate`). Resolving `false` runs the tour silently (player chose to read). */
  beforeStart?: () => Promise<boolean | void>;
}

function makeControlButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mlops-tour-control-btn";
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}

/**
 * Starts (or no-ops) the intro.js tour for `group`. Steps come from that group's own
 * `data-intro`/`data-intro-group`/`data-step`/`data-position` markup, exactly as before - this
 * only standardizes the options, the skip controls, and the narration around it.
 *
 * intro.js v8 re-renders its own tooltip DOM through an internal reactive layer rather than
 * leaving it as static markup a caller can safely append to once - a one-shot injection in
 * `onAfterChange` was found to get silently wiped by that re-render. A `MutationObserver`
 * sidesteps needing to know exactly when v8 considers a step "settled": it just keeps
 * re-asserting our controls row and re-checking the narrated text every time *anything* in the
 * tooltip changes, which is idempotent and therefore safe to over-call.
 */
export function startTour(group: string, options: StartTourOptions = {}): void {
  const { beforeStart, ...rest } = options;
  if (!beforeStart) {
    startTourNow(group, rest);
    return;
  }
  beforeStart().then(
    (allowed) => startTourNow(group, allowed === false ? { ...rest, narrate: undefined } : rest),
    () => startTourNow(group, rest),
  );
}

function startTourNow(group: string, options: StartTourOptions): void {
  const tour = introJs.tour();
  let narrationCancel: () => void = () => { };
  // The step text whose narration was last attempted, and whether it is confirmed audible.
  let attemptedText: string | null = null;
  let confirmed = false;
  let retried = false;
  let ownCancel = false;
  let attemptId = 0;
  let trackedGeneration: number | null = null;
  const stopNarration = () => {
    ownCancel = true;
    try {
      narrationCancel();
    } finally {
      ownCancel = false;
    }
    narrationCancel = () => { };
  };

  const currentStepText = () =>
    document.querySelector<HTMLElement>(".introjs-showElement[data-intro]")?.getAttribute("data-intro") ?? null;

  /** Starts narrating `text` once nothing else is speaking. It only counts as narrated after a
   *  sentence or the end is reported; a first line cancelled before that is retried once. */
  const beginNarration = (text: string) => {
    if (!options.narrate) return;
    const narrate = options.narrate;
    const id = ++attemptId;
    attemptedText = text;
    confirmed = false;
    trackedGeneration = null;
    stopNarration();
    void waitForNarrationIdle().then(() => {
      if (finished || id !== attemptId) return;
      const before = getSpeechGeneration();
      narrationCancel = narrate(text);
      // No new line means narration is muted or skipped: nothing to confirm or retry.
      if (getSpeechGeneration() === before) confirmed = true;
      else trackedGeneration = getSpeechGeneration();
    });
  };

  const unsubscribeNarration = onNarrationEvent((e) => {
    if (trackedGeneration === null || e.generation < trackedGeneration || confirmed) return;
    if (e.type === "sentence" || e.type === "end") {
      confirmed = true;
    } else if (e.type === "cancel" && !e.handedOff && !ownCancel && !retried) {
      const text = attemptedText;
      window.setTimeout(() => {
        if (!text || finished || confirmed || retried || text !== attemptedText || currentStepText() !== text) return;
        retried = true;
        beginNarration(text);
      }, 250);
    }
  });

  let finished = false;
  let observer: MutationObserver | null = null;
  // Watches whichever element is currently highlighted for size changes - a hero icon/lottie
  // animation, an async image, or anything else inside it that finishes loading/laying out after
  // intro.js already measured and drew the highlight box around it. Re-attached to the new target
  // on every step change by `sync()` below; the fixed-delay `refresh(true)` further down covers
  // the gap before this observer's first callback can fire, not a substitute for it.
  let resizeObserver: ResizeObserver | null = null;
  let resizeObservedElement: Element | null = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    stopNarration();
    unsubscribeNarration();
    observer?.disconnect();
    resizeObserver?.disconnect();
    options.onFinish?.();
  };

  const skipMessage = () => {
    tour.nextStep();
  };
  const skipPage = () => {
    tour.exit(true);
  };

  /** Re-asserts the controls row and (re-)narrates the currently-highlighted step's text.
   *  Called on every relevant DOM mutation, so it must be cheap and idempotent. */
  const sync = () => {
    const tooltip = document.querySelector(".introjs-tooltip");
    const buttonsBar = tooltip?.querySelector(".introjs-tooltipbuttons");
    if (tooltip && buttonsBar && !tooltip.querySelector(".mlops-tour-controls")) {
      const row = document.createElement("div");
      row.className = "mlops-tour-controls";
      row.appendChild(makeControlButton("Skip message", "Move on from this message", skipMessage));
      row.appendChild(makeControlButton("Skip this page's demo", "Skip the rest of this page's demo", skipPage));
      tooltip.insertBefore(row, buttonsBar);
    }

    const activeElement = document.querySelector<HTMLElement>(".introjs-showElement[data-intro]");
    const text = activeElement?.getAttribute("data-intro") ?? null;
    if (text && text !== attemptedText) {
      retried = false;
      beginNarration(text);
    }

    if (activeElement && activeElement !== resizeObservedElement) {
      resizeObserver?.disconnect();
      resizeObservedElement = activeElement;
      resizeObserver = new ResizeObserver(() => {
        if (!finished) tour.refresh(true);
      });
      resizeObserver.observe(activeElement);
    }
  };

  tour.setOptions({
    group,
    exitOnEsc: false,
    exitOnOverlayClick: false,
    showProgress: true,
    showBullets: false,
  });

  tour.onExit(finish);
  tour.onComplete(finish);

  // Start narrating the first step's text now, before intro.js has even computed the tooltip's
  // position - `sync()`'s dedup check (comparing against `attemptedText`) means this is the
  // same call `sync()` would otherwise make once the tooltip appears, just given a head start
  // equal to however long `.start()`'s own layout/positioning work takes. Without this, that work
  // raced the narration's own network fetch, and a slow enough race read as a dropped/failed
  // request and fell back to the browser's own (lower-quality) built-in voice.
  const steps = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-intro-group="${group}"]`)
  ).sort((a, b) => Number(a.getAttribute("data-step") || 0) - Number(b.getAttribute("data-step") || 0));
  const firstText = steps[0]?.getAttribute("data-intro");
  if (firstText && options.narrate) beginNarration(firstText);

  // intro.js's `.start()` resolves even when `group` matches nothing, but never calls
  // onComplete/onExit in that case (there is nothing to complete or exit from) - so without this,
  // a caller whose own UI is gated on `onFinish` (narration unlocking only after the tour, e.g.
  // PrePhaseDialog) stays blocked forever. Finishing immediately here covers that race without
  // waiting on intro.js to ever call back.
  if (steps.length === 0) {
    finish();
    return;
  }

  tour.start().then(() => {
    if (finished) return;
    observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    sync();

    // The highlighted target's own layout can still be settling when `.start()` resolves (a
    // parent's entrance transition still running, or its real content/width still arriving after
    // the tooltip already opened) - intro.js only measures position once, so it never notices a
    // resize afterward on its own. `refresh(true)` re-measures every step against current layout;
    // matches the previously-reported "phase rail wasn't fully loaded" misalignment.
    window.setTimeout(() => {
      if (!finished) tour.refresh(true);
    }, 400);
  });
}
