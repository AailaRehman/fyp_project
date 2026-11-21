// Measures pauses in a spoken answer. It only does arithmetic on timestamps handed to it, so it is easy to test.
// Rules from the project spec: silence of more than 5 seconds before answering is a long pause,
// and silence of 3 seconds or more in the middle of an answer is logged.
export const LONG_INITIAL_MS = 5000;
export const LONG_MID_MS = 3000;

export class PauseTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.startedAt = null; // when the microphone started listening
    this.lastActivity = null; // the last moment the candidate was heard
    this.initialPauseMs = null;
    this.midPausesMs = [];
  }

  begin(t) {
    this.reset();
    this.startedAt = t;
  }

  /** Call whenever the candidate is heard speaking. */
  activity(t) {
    if (this.startedAt === null) return;
    if (this.lastActivity === null) {
      this.initialPauseMs = Math.max(0, t - this.startedAt);
    } else {
      const gap = t - this.lastActivity;
      if (gap >= LONG_MID_MS) this.midPausesMs.push(gap);
    }
    this.lastActivity = t;
  }

  get hasSpoken() {
    return this.lastActivity !== null;
  }

  silentMs(t) {
    if (this.startedAt === null) return 0;
    return Math.max(0, t - (this.lastActivity ?? this.startedAt));
  }

  /** What to show the candidate right now: nothing, a long wait before starting, or a pause in the middle. */
  hint(t) {
    if (this.startedAt === null) return null;
    const silent = this.silentMs(t);
    if (!this.hasSpoken) return silent > LONG_INITIAL_MS ? "initial" : null;
    return silent >= LONG_MID_MS ? "mid" : null;
  }

  /** Silence at the very end of an answer is not a pause, so it is not recorded. */
  finish(t) {
    const initial = this.hasSpoken ? this.initialPauseMs : Math.max(0, t - (this.startedAt ?? t));
    return { initialPauseMs: Math.round(initial), midPausesMs: this.midPausesMs.map(Math.round), hadSpeech: this.hasSpoken };
  }
}
