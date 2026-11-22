/* Decides from MediaPipe face data whether a candidate is looking at the screen.
   Everything here is plain arithmetic on numbers, so it is easy to test without a camera.

   IMPORTANT: the limits in CONFIG are starting values chosen from how MediaPipe's outputs are normally
   scaled. They have not been tuned on real people yet. If they flag honest candidates, or miss someone
   clearly looking elsewhere, change the numbers here and nothing else. */

export const SAMPLE_MS = 2000; // the camera image is checked about every 2 seconds

export const CONFIG = Object.freeze({
  yawDeg: 30, // head turned left or right by more than this
  pitchDeg: 25, // head tilted up or down by more than this
  eyeH: 0.45, // eyes pointing left or right by more than this (scale 0 to 1)
  eyeV: 0.5, // eyes pointing up or down by more than this (scale 0 to 1)
  blink: 0.6, // both eyes at least this closed counts as a blink
  awaySamples: 2, // this many checks in a row are needed before it counts as an event
  baselineLimit: Object.freeze({ yaw: 20, pitch: 20, h: 0.3, v: 0.3 }), // a "normal" posture must be within these
});

const ZERO = Object.freeze({ yaw: 0, pitch: 0, h: 0, v: 0 });
const DEG = 180 / Math.PI;
const EVENT_OF = { away: "looking_away", no_face: "no_face", multiple_faces: "multiple_faces" };

/** Head turn (yaw) and tilt (pitch) in degrees from MediaPipe's 4x4 face transformation matrix (column-major).
    The third column is the direction the face points in, so only its direction matters, not its sign or scale. */
export function headAngles(matrix) {
  if (!matrix || typeof matrix.length !== "number" || matrix.length < 16) return null;
  const x = Number(matrix[8]);
  const y = Number(matrix[9]);
  const z = Number(matrix[10]);
  if (![x, y, z].every(Number.isFinite)) return null;
  return { yaw: Math.atan2(x, Math.abs(z)) * DEG, pitch: Math.atan2(y, Math.hypot(x, z)) * DEG };
}

/** Where the eyes point, from MediaPipe's blendshape scores. "Left" and "right" are the person's own left and right.
    h is positive when looking to the person's right; v is positive when looking up. */
export function eyeDirection(categories) {
  if (!Array.isArray(categories) || categories.length === 0) return null;
  const m = {};
  for (const c of categories) m[c.categoryName] = c.score;
  const s = (k) => (Number.isFinite(m[k]) ? m[k] : 0);
  const right = (s("eyeLookInLeft") + s("eyeLookOutRight")) / 2;
  const left = (s("eyeLookOutLeft") + s("eyeLookInRight")) / 2;
  const up = (s("eyeLookUpLeft") + s("eyeLookUpRight")) / 2;
  const down = (s("eyeLookDownLeft") + s("eyeLookDownRight")) / 2;
  return { h: right - left, v: up - down, blink: Math.min(s("eyeBlinkLeft"), s("eyeBlinkRight")) };
}

/** Reduces one MediaPipe result to the few numbers we need. */
export function featuresFromResult(res) {
  const faces = res?.faceLandmarks?.length ?? 0;
  if (faces !== 1) return { faces };
  const eyes = eyeDirection(res.faceBlendshapes?.[0]?.categories);
  const head = headAngles(res.facialTransformationMatrixes?.[0]?.data);
  return { faces, yaw: head?.yaw ?? null, pitch: head?.pitch ?? null, h: eyes?.h ?? null, v: eyes?.v ?? null, blink: eyes?.blink ?? 0 };
}

/** One check: no_face | multiple_faces | unknown (cannot tell, for example a blink) | away | on_screen. */
export function classify(f, base = ZERO, cfg = CONFIG) {
  if (!f || f.faces === 0) return "no_face";
  if (f.faces > 1) return "multiple_faces";
  const off = (value, from, limit) => value !== null && value !== undefined && Math.abs(value - from) > limit;
  const blinking = f.blink > cfg.blink;
  const headAway = off(f.yaw, base.yaw, cfg.yawDeg) || off(f.pitch, base.pitch, cfg.pitchDeg);
  const eyesAway = !blinking && (off(f.h, base.h, cfg.eyeH) || off(f.v, base.v, cfg.eyeV)); // closed eyes say nothing about direction
  if (headAway || eyesAway) return "away";
  const hasData = [f.yaw, f.pitch, f.h, f.v].some((x) => x !== null && x !== undefined);
  return hasData && !blinking ? "on_screen" : "unknown";
}

/** Turns a stream of checks into events: looking away, no face in view, or more than one face in view.
    A single check is never enough, so a glance, a blink or one bad frame does not count. */
export class GazeMonitor {
  constructor(cfg = CONFIG) {
    this.cfg = cfg;
    this.baseline = { ...ZERO };
    this.recent = [];
    this.cur = null;
    this.q = { start: 0, samples: 0, faceSamples: 0, events: [] };
  }

  /** Call when a new question appears. Times are in milliseconds from any steady clock. */
  startQuestion(t) {
    this.cur = null;
    this.q = { start: t, samples: 0, faceSamples: 0, events: [] };
  }

  ingest(features, t) {
    const state = classify(features, this.baseline, this.cfg);
    this.q.samples += 1;
    if (features && features.faces > 0) this.q.faceSamples += 1;
    if (state === "on_screen") {
      this.recent.push(features);
      if (this.recent.length > 5) this.recent.shift();
    }
    if (state === "unknown") return state; // ignored: it neither starts nor ends an event
    const type = EVENT_OF[state];
    if (!type) {
      this._close();
      this.cur = null;
    } else if (this.cur && this.cur.type === type) {
      this.cur.lastAt = t;
      this.cur.count += 1;
    } else {
      this._close();
      this.cur = { type, firstAt: t, lastAt: t, count: 1 };
    }
    return state;
  }

  _close() {
    const c = this.cur;
    if (c && c.count >= this.cfg.awaySamples) {
      this.q.events.push({
        type: c.type,
        atMs: Math.max(0, Math.round(c.firstAt - this.q.start)),
        durationMs: Math.round(c.lastAt - c.firstAt + SAMPLE_MS),
      });
    }
  }

  /** Learns what "looking at the screen" looks like for this person, from the last few normal checks.
      Returns false if there were not enough, or if they were too extreme to be a normal posture. */
  calibrate() {
    const lim = this.cfg.baselineLimit;
    const within = (v, l) => v === null || v === undefined || Math.abs(v) <= l;
    const ok = this.recent.filter((f) => within(f.yaw, lim.yaw) && within(f.pitch, lim.pitch) && within(f.h, lim.h) && within(f.v, lim.v));
    if (ok.length < 2) return false;
    const median = (k) => {
      const xs = ok.map((f) => f[k]).filter(Number.isFinite).sort((a, b) => a - b);
      if (xs.length === 0) return 0;
      const mid = xs.length >> 1;
      return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
    };
    this.baseline = { yaw: median("yaw"), pitch: median("pitch"), h: median("h"), v: median("v") };
    return true;
  }

  /** Ends the current question: returns what was noticed and starts counting again from t. */
  drain(t) {
    this._close();
    this.cur = null;
    const out = { samples: this.q.samples, faceSamples: this.q.faceSamples, events: this.q.events };
    this.q = { start: t, samples: 0, faceSamples: 0, events: [] };
    return out;
  }
}
