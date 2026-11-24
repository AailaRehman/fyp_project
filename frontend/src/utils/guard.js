// Turns raw browser events into rule-break reports. It touches no browser objects itself (the timer and the visibility
// check are handed in), so the tricky timing can be tested exactly.
//
// Switching tabs fires BOTH a "blur" and a "visibility hidden" event. That is one incident, so a blur is held back for
// a moment: if the tab turns out to be hidden, only "tab_switch" is reported. A blur that is quickly followed by
// focus again (a click on the browser's own buttons, a pop-up) is not reported at all.
export const BLUR_DEBOUNCE_MS = 200;

export function createGuard({ report, setTimer = setTimeout, clearTimer = clearTimeout, isVisible = () => document.visibilityState === "visible" }) {
  let blurTimer = null;
  const cancelBlur = () => {
    if (blurTimer !== null) {
      clearTimer(blurTimer);
      blurTimer = null;
    }
  };
  return {
    /** The window lost focus (for example the candidate clicked into another application). */
    blur() {
      cancelBlur();
      blurTimer = setTimer(() => {
        blurTimer = null;
        if (isVisible()) report("window_blur");
      }, BLUR_DEBOUNCE_MS);
    },
    /** The window got focus back. */
    focus() {
      cancelBlur();
    },
    /** The tab was hidden or shown. Only hiding is a rule break. */
    visibility(hidden) {
      if (!hidden) return;
      cancelBlur();
      report("tab_switch");
    },
    /** kind is "copy", "cut" or "paste". */
    clipboard(kind) {
      report(kind);
    },
    contextMenu() {
      report("context_menu");
    },
    dispose() {
      cancelBlur();
    },
  };
}
