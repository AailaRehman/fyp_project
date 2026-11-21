import { test } from "node:test";
import assert from "node:assert/strict";
import { PauseTracker, LONG_INITIAL_MS, LONG_MID_MS } from "../src/utils/pauseTracker.js";

const tracker = (at = 1000) => {
  const p = new PauseTracker();
  p.begin(at);
  return p;
};

test("the time before the first word is the initial pause", () => {
  const p = tracker(1000);
  p.activity(7500);
  assert.equal(p.finish(20000).initialPauseMs, 6500);
});

test("someone who never speaks has an initial pause as long as the whole wait", () => {
  const p = tracker(1000);
  assert.deepEqual(p.finish(13000), { initialPauseMs: 12000, midPausesMs: [], hadSpeech: false });
});

test("a gap of 3 seconds or more in the middle of an answer is logged", () => {
  const p = tracker(0);
  [1000, 1500, 2000, 5000, 5500, 9000].forEach((t) => p.activity(t));
  assert.deepEqual(p.finish(10000).midPausesMs, [3000, 3500]);
});

test("shorter gaps are not logged", () => {
  const p = tracker(0);
  [500, 1000, 3999].forEach((t) => p.activity(t));
  assert.deepEqual(p.finish(5000).midPausesMs, []);
});

test("silence at the end of the answer is not a pause", () => {
  const p = tracker(0);
  [500, 1000].forEach((t) => p.activity(t));
  assert.deepEqual(p.finish(60000).midPausesMs, []);
});

test("hint: nothing at first, then a long-wait message after 5 seconds", () => {
  const p = tracker(0);
  assert.equal(p.hint(1000), null);
  assert.equal(p.hint(LONG_INITIAL_MS), null); // exactly 5 seconds is not "more than 5"
  assert.equal(p.hint(LONG_INITIAL_MS + 1), "initial");
});

test("hint: a pause message appears 3 seconds after the candidate stops, and goes when they speak again", () => {
  const p = tracker(0);
  p.activity(1000);
  assert.equal(p.hint(3999), null);
  assert.equal(p.hint(1000 + LONG_MID_MS), "mid");
  p.activity(6000);
  assert.equal(p.hint(6500), null);
});

test("the initial-wait message goes away as soon as the candidate starts speaking", () => {
  const p = tracker(0);
  assert.equal(p.hint(8000), "initial");
  p.activity(8200);
  assert.equal(p.hint(8300), null);
});

test("nothing is recorded before listening begins", () => {
  const p = new PauseTracker();
  p.activity(500);
  assert.equal(p.hasSpoken, false);
  assert.equal(p.hint(9000), null);
});

test("begin() starts a fresh answer", () => {
  const p = tracker(0);
  p.activity(1000); p.activity(6000);
  p.begin(10000);
  assert.deepEqual(p.finish(10500), { initialPauseMs: 500, midPausesMs: [], hadSpeech: false });
});
