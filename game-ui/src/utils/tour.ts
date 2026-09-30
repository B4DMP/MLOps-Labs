import introJs from "intro.js";

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
  const tour = introJs.tour();
  let narrationCancel: () => void = () => {};
  let lastNarratedText: string | null = null;
  const stopNarration = () => {
    narrationCancel();
    narrationCancel = () => {};
  };

  let finished = false;
  let observer: MutationObserver | null = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    stopNarration();
    observer?.disconnect();
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
    if (text && text !== lastNarratedText) {
      lastNarratedText = text;
      stopNarration();
      if (options.narrate) narrationCancel = options.narrate(text);
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
  // position - `sync()`'s dedup check (comparing against `lastNarratedText`) means this is the
  // same call `sync()` would otherwise make once the tooltip appears, just given a head start
  // equal to however long `.start()`'s own layout/positioning work takes. Without this, that work
  // raced the narration's own network fetch, and a slow enough race read as a dropped/failed
  // request and fell back to the browser's own (lower-quality) built-in voice.
  const steps = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-intro-group="${group}"]`)
  ).sort((a, b) => Number(a.getAttribute("data-step") || 0) - Number(b.getAttribute("data-step") || 0));
  const firstText = steps[0]?.getAttribute("data-intro");
  if (firstText && options.narrate) {
    lastNarratedText = firstText;
    narrationCancel = options.narrate(firstText);
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
