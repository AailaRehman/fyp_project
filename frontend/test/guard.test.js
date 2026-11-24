import { test } from "node:test";
import assert from "node:assert/strict";
import { BLUR_DEBOUNCE_MS, createGuard } from "../src/utils/guard.js";

function harness() {
  const reports = [];
  const timers = new Map();
  let now = 0, next = 0, visible = true;
  const guard = createGuard({
    report: (type) => reports.push(type),
    setTimer: (fn, ms) => { const id = ++next; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    isVisible: () => visible,
  });
  const tick = (ms) => {
    now += ms;
    for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
  };
  return { guard, reports, tick, setVisible: (v) => { visible = v; }, pending: () => timers.size };
}

test("a window that stays out of focus is reported once the debounce has passed", () => {
  const h = harness();
  h.guard.blur();
  h.tick(BLUR_DEBOUNCE_MS - 1);
  assert.deepEqual(h.reports, []);
  h.tick(1);
  assert.deepEqual(h.reports, ["window_blur"]);
});

test("a blur followed quickly by focus is a flicker, not a violation", () => {
  const h = harness();
  h.guard.blur();
  h.tick(100);
  h.guard.focus();
  h.tick(1000);
  assert.deepEqual(h.reports, []);
});

test("a tab switch (blur, then hidden) is reported once, as a tab switch", () => {
  const h = harness();
  h.guard.blur();
  h.tick(50);
  h.setVisible(false);
  h.guard.visibility(true);
  h.tick(1000);
  assert.deepEqual(h.reports, ["tab_switch"]);
  assert.equal(h.pending(), 0);
});

test("hiding the tab with no blur is reported straight away", () => {
  const h = harness();
  h.guard.visibility(true);
  assert.deepEqual(h.reports, ["tab_switch"]);
});

test("coming back to the tab is not a violation", () => {
  const h = harness();
  h.guard.visibility(false);
  h.guard.focus();
  h.tick(1000);
  assert.deepEqual(h.reports, []);
});

test("a blur is not reported if the tab is already hidden by the time it is due", () => {
  const h = harness();
  h.guard.blur();
  h.setVisible(false); // the visibility event itself will report this
  h.tick(BLUR_DEBOUNCE_MS);
  assert.deepEqual(h.reports, []);
});

test("repeated blurs restart the wait and give one report", () => {
  const h = harness();
  h.guard.blur();
  h.tick(150);
  h.guard.blur();
  h.tick(150);
  assert.deepEqual(h.reports, []);
  h.tick(50);
  assert.deepEqual(h.reports, ["window_blur"]);
});

test("copy, cut, paste and right-click are reported by name", () => {
  const h = harness();
  h.guard.clipboard("copy");
  h.guard.clipboard("cut");
  h.guard.clipboard("paste");
  h.guard.contextMenu();
  assert.deepEqual(h.reports, ["copy", "cut", "paste", "context_menu"]);
});

test("disposing cancels a report that is still waiting", () => {
  const h = harness();
  h.guard.blur();
  h.guard.dispose();
  h.tick(1000);
  assert.deepEqual(h.reports, []);
});
