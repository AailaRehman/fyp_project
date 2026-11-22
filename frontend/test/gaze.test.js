import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG, GazeMonitor, SAMPLE_MS, classify, eyeDirection, featuresFromResult, headAngles } from "../src/utils/gaze.js";

const RAD = Math.PI / 180;
// 4x4 matrix, column-major, for a head turned `yaw` degrees and tilted `pitch` degrees (scale optional)
function matrix(yawDeg, pitchDeg = 0, scale = 1) {
  const y = yawDeg * RAD, p = pitchDeg * RAD;
  const f = [Math.sin(y) * Math.cos(p), -Math.sin(p), Math.cos(y) * Math.cos(p)]; // where the face points
  return [1, 0, 0, 0, 0, 1, 0, 0, ...f.map((v) => v * scale), 0, 0, 0, 0, 1];
}
const cats = (o) => Object.entries(o).map(([categoryName, score]) => ({ categoryName, score }));
const face = (over = {}) => ({ faces: 1, yaw: 0, pitch: 0, h: 0, v: 0, blink: 0, ...over });
const NO_FACE = { faces: 0 };
const TWO = { faces: 2 };

test("head angles come out right for a head turned and tilted", () => {
  const a = headAngles(matrix(40, 0));
  assert.ok(Math.abs(Math.abs(a.yaw) - 40) < 0.001 && Math.abs(a.pitch) < 0.001);
  const b = headAngles(matrix(0, 30));
  assert.ok(Math.abs(Math.abs(b.pitch) - 30) < 0.001 && Math.abs(b.yaw) < 0.001);
  const c = headAngles(matrix(0, 0));
  assert.ok(Math.abs(c.yaw) < 0.001 && Math.abs(c.pitch) < 0.001);
});

test("the size of the matrix and which way it faces do not matter", () => {
  assert.ok(Math.abs(headAngles(matrix(25, 10, 7)).yaw - headAngles(matrix(25, 10, 1)).yaw) < 0.001);
  const flipped = matrix(25, 0).map((v, i) => (i >= 8 && i <= 10 ? -v : v)); // a model that faces the other way
  assert.ok(Math.abs(Math.abs(headAngles(flipped).yaw) - 25) < 0.001);
});

test("bad matrices give no angles instead of nonsense", () => {
  for (const m of [null, undefined, [], [1, 2, 3], new Array(16).fill(NaN), "abc"]) assert.equal(headAngles(m), null);
  assert.ok(headAngles(new Float32Array(16).fill(0.5)));
});

test("eye direction: right, left, up, down and blinking", () => {
  assert.ok(Math.abs(eyeDirection(cats({ eyeLookInLeft: 0.6, eyeLookOutRight: 0.6 })).h - 0.6) < 1e-9);
  assert.ok(Math.abs(eyeDirection(cats({ eyeLookOutLeft: 0.8, eyeLookInRight: 0.4 })).h + 0.6) < 1e-9);
  assert.ok(Math.abs(eyeDirection(cats({ eyeLookUpLeft: 0.5, eyeLookUpRight: 0.5 })).v - 0.5) < 1e-9);
  assert.ok(Math.abs(eyeDirection(cats({ eyeLookDownLeft: 0.7, eyeLookDownRight: 0.7 })).v + 0.7) < 1e-9);
  assert.equal(eyeDirection(cats({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.3 })).blink, 0.3); // both eyes must be closed
  assert.equal(eyeDirection([]), null);
  assert.equal(eyeDirection(undefined), null);
});

test("features are read from a MediaPipe-shaped result", () => {
  const res = {
    faceLandmarks: [[{}]],
    faceBlendshapes: [{ categories: cats({ eyeLookInLeft: 0.4, eyeLookOutRight: 0.4 }) }],
    facialTransformationMatrixes: [{ data: matrix(10, 0) }],
  };
  const f = featuresFromResult(res);
  assert.equal(f.faces, 1);
  assert.ok(Math.abs(Math.abs(f.yaw) - 10) < 0.001);
  assert.ok(Math.abs(f.h - 0.4) < 1e-9);
  assert.deepEqual(featuresFromResult({ faceLandmarks: [] }), { faces: 0 });
  assert.deepEqual(featuresFromResult({ faceLandmarks: [[{}], [{}]] }), { faces: 2 });
  assert.deepEqual(featuresFromResult(undefined), { faces: 0 });
  const bare = featuresFromResult({ faceLandmarks: [[{}]] }); // blendshapes and matrix switched off
  assert.deepEqual([bare.yaw, bare.h, bare.blink], [null, null, 0]);
});

test("classify: facing the screen is fine, turning past the limit is not", () => {
  assert.equal(classify(face()), "on_screen");
  assert.equal(classify(face({ yaw: CONFIG.yawDeg - 1 })), "on_screen");
  assert.equal(classify(face({ yaw: CONFIG.yawDeg + 1 })), "away");
  assert.equal(classify(face({ yaw: -(CONFIG.yawDeg + 1) })), "away");
  assert.equal(classify(face({ pitch: CONFIG.pitchDeg + 1 })), "away");
  assert.equal(classify(face({ h: CONFIG.eyeH + 0.05 })), "away");
  assert.equal(classify(face({ h: -(CONFIG.eyeH + 0.05) })), "away");
  assert.equal(classify(face({ v: -(CONFIG.eyeV + 0.05) })), "away");
});

test("classify: no face, two faces, and checks that say nothing", () => {
  assert.equal(classify(NO_FACE), "no_face");
  assert.equal(classify(undefined), "no_face");
  assert.equal(classify(TWO), "multiple_faces");
  assert.equal(classify({ faces: 1, yaw: null, pitch: null, h: null, v: null, blink: 0 }), "unknown");
});

test("classify: a blink is not looking away, but a turned head still is", () => {
  assert.equal(classify(face({ blink: 0.9 })), "unknown");
  assert.equal(classify(face({ blink: 0.9, h: 0.9 })), "unknown"); // closed eyes cannot show direction
  assert.equal(classify(face({ blink: 0.9, yaw: 50 })), "away");
});

test("classify: a personal baseline moves the limits", () => {
  const base = { yaw: 12, pitch: 0, h: 0, v: -0.2 };
  assert.equal(classify(face({ yaw: 40, v: -0.2 }), base), "on_screen"); // 28 degrees from where they normally sit
  assert.equal(classify(face({ yaw: 40, v: -0.2 })), "away");
  assert.equal(classify(face({ yaw: 45, v: -0.2 }), base), "away");
});

// ---------- the monitor ----------
const T = (n) => n * SAMPLE_MS;
function feed(m, states, from = 0) {
  const map = { on: face(), away: face({ yaw: 50 }), none: NO_FACE, two: TWO, blink: face({ blink: 0.9 }) };
  states.forEach((s, i) => m.ingest(map[s], from + T(i)));
}

test("one glance away is not an event, two checks in a row are", () => {
  const m = new GazeMonitor();
  m.startQuestion(0);
  feed(m, ["on", "away", "on", "on", "away", "away", "on"]);
  const r = m.drain(T(7));
  assert.deepEqual(r.events, [{ type: "looking_away", atMs: T(4), durationMs: T(1) + SAMPLE_MS }]);
});

test("a long spell away is one event whose length covers every check in it", () => {
  const m = new GazeMonitor();
  m.startQuestion(0);
  feed(m, ["on", "away", "away", "away", "away", "on"]);
  assert.deepEqual(m.drain(T(6)).events, [{ type: "looking_away", atMs: T(1), durationMs: T(3) + SAMPLE_MS }]);
});

test("blinks are ignored: they neither start nor break a spell away", () => {
  const m = new GazeMonitor();
  m.startQuestion(0);
  feed(m, ["away", "blink", "away", "blink", "on"]);
  const r = m.drain(T(5));
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].type, "looking_away");
  assert.equal(r.samples, 5); // blinks still count as checks that ran
});

test("no face and two faces are separate kinds of event", () => {
  const m = new GazeMonitor();
  m.startQuestion(0);
  feed(m, ["on", "none", "none", "on", "two", "two", "two", "on"]);
  assert.deepEqual(m.drain(T(8)).events.map((e) => e.type), ["no_face", "multiple_faces"]);
});

test("changing from one kind of trouble to another closes the first event", () => {
  const m = new GazeMonitor();
  m.startQuestion(0);
  feed(m, ["away", "away", "none", "none", "on"]);
  assert.deepEqual(m.drain(T(5)).events.map((e) => e.type), ["looking_away", "no_face"]);
});

test("a spell still going when the question ends is closed and reported", () => {
  const m = new GazeMonitor();
  m.startQuestion(0);
  feed(m, ["on", "away", "away"]);
  assert.equal(m.drain(T(3)).events.length, 1);
  assert.equal(m.drain(T(3)).events.length, 0); // and it does not leak into the next question
});

test("event times are measured from the start of each question", () => {
  const m = new GazeMonitor();
  m.startQuestion(10000);
  feed(m, ["on", "away", "away", "on"], 10000);
  assert.equal(m.drain(20000).events[0].atMs, T(1));
  feed(m, ["on", "on", "away", "away", "on"], 20000);
  assert.equal(m.drain(40000).events[0].atMs, T(2));
});

test("the counts say how many checks ran and how many had a face", () => {
  const m = new GazeMonitor();
  m.startQuestion(0);
  feed(m, ["on", "none", "none", "on", "two"]);
  const r = m.drain(T(5));
  assert.equal(r.samples, 5);
  assert.equal(r.faceSamples, 3);
});

test("calibration learns how this person normally sits", () => {
  const m = new GazeMonitor();
  m.startQuestion(0);
  [12, 14, 13, 12].forEach((yaw, i) => m.ingest(face({ yaw, v: -0.2 }), T(i)));
  assert.equal(m.calibrate(), true);
  assert.ok(Math.abs(m.baseline.yaw - 12.5) < 1e-9);
  feed(m, ["on"], T(5));
  m.drain(T(6));
  m.ingest(face({ yaw: 40, v: -0.2 }), T(7)); m.ingest(face({ yaw: 40, v: -0.2 }), T(8));
  assert.equal(m.drain(T(9)).events.length, 0); // 40 degrees is fine for someone who sits at 12
  m.ingest(face({ yaw: 50, v: -0.2 }), T(10)); m.ingest(face({ yaw: 50, v: -0.2 }), T(11));
  assert.equal(m.drain(T(12)).events.length, 1);
});

test("calibration refuses too little data and extreme postures", () => {
  const m = new GazeMonitor();
  assert.equal(m.calibrate(), false);
  m.ingest(face(), 0);
  assert.equal(m.calibrate(), false); // one check is not enough
  const m2 = new GazeMonitor(); // someone already sitting well off to the side is not "normal"
  [25, 26, 25].forEach((yaw, i) => m2.ingest(face({ yaw }), T(i)));
  assert.equal(m2.calibrate(), false);
  assert.deepEqual(m2.baseline, { yaw: 0, pitch: 0, h: 0, v: 0 });
});
