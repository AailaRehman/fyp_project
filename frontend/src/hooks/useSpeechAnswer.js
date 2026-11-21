import { useCallback, useEffect, useRef, useState } from "react";
import { PauseTracker } from "../utils/pauseTracker.js";
import { getRecognition } from "../utils/speech.js";

/* Listens to one spoken answer with the browser's speech recognition and measures pauses while it listens.
   There is no text input anywhere: the answer can only come from the microphone.
   Chrome ends recognition on its own now and then, so it is restarted while the answer is still open. */
export function useSpeechAnswer() {
  const Ctor = getRecognition();
  const [state, setState] = useState("idle"); // idle | listening | error
  const [error, setError] = useState(null); // denied | no_mic | network | unstable | unknown
  const [text, setText] = useState("");
  const [hint, setHint] = useState(null); // null | initial | mid
  const r = useRef({
    rec: null, active: false, running: false, ended: null, timer: null,
    committed: "", sessionFinal: "", interim: "", lastLen: 0, restarts: [],
    tracker: new PauseTracker(),
  }).current;

  const fullText = () => `${r.committed} ${r.sessionFinal} ${r.interim}`.replace(/\s+/g, " ").trim();
  const stopTimer = () => {
    clearInterval(r.timer);
    r.timer = null;
  };

  const fail = (code) => {
    r.active = false;
    stopTimer();
    setHint(null);
    setError(code);
    setState("error");
    try { r.rec?.abort(); } catch { /* already stopped */ }
  };

  const restart = () => {
    const now = performance.now();
    r.restarts = r.restarts.filter((t) => now - t < 10000);
    r.restarts.push(now);
    if (r.restarts.length > 8) return fail("unstable"); // it keeps stopping straight away
    setTimeout(() => {
      if (!r.active) return;
      try { r.rec.start(); } catch { /* already running */ }
    }, 150);
  };

  const createRecognition = () => {
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.maxAlternatives = 1;
    rec.onstart = () => { r.running = true; };
    rec.onspeechstart = () => r.tracker.activity(performance.now());
    rec.onresult = (e) => {
      let fin = "";
      let intr = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0]?.transcript || "";
        if (res.isFinal) fin += `${t} `;
        else intr += t;
      }
      r.sessionFinal = fin;
      r.interim = intr;
      const full = fullText();
      // Only new words count as "heard": a final result repeating the last interim text is not new speech.
      if (full.length > r.lastLen) r.tracker.activity(performance.now());
      r.lastLen = full.length;
      setText(full);
    };
    rec.onerror = (e) => {
      const code = e.error;
      if (code === "no-speech" || code === "aborted") return;
      if (code === "not-allowed" || code === "service-not-allowed") fail("denied");
      else if (code === "audio-capture") fail("no_mic");
      else if (code === "network") fail("network");
      else fail("unknown");
    };
    rec.onend = () => {
      r.running = false;
      const pending = `${r.sessionFinal} ${r.interim}`.trim();
      if (pending) r.committed = `${r.committed} ${pending}`.trim();
      r.sessionFinal = "";
      r.interim = "";
      if (r.ended) {
        r.ended();
        r.ended = null;
      }
      if (r.active) restart();
    };
    return rec;
  };

  /** Start listening for a new answer. Returns false if the browser cannot do speech recognition. */
  const begin = useCallback(() => {
    if (!Ctor) return false;
    stopTimer();
    r.committed = ""; r.sessionFinal = ""; r.interim = ""; r.lastLen = 0; r.restarts = [];
    setText("");
    setError(null);
    setHint(null);
    r.tracker.begin(performance.now());
    if (!r.rec) r.rec = createRecognition();
    r.active = true;
    try { r.rec.start(); } catch { /* already running */ }
    setState("listening");
    r.timer = setInterval(() => setHint(r.tracker.hint(performance.now())), 400);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Ctor]);

  /** Stop listening and return everything that was said, together with the measured pauses. */
  const finish = useCallback(async () => {
    const t = performance.now();
    r.active = false;
    stopTimer();
    setHint(null);
    if (r.running) {
      const ended = new Promise((resolve) => {
        r.ended = resolve;
        setTimeout(resolve, 1500); // do not wait for ever for the last words
      });
      try { r.rec.stop(); } catch { /* already stopped */ }
      await ended;
    }
    const p = r.tracker.finish(t);
    setState("idle");
    return { text: fullText(), pauses: { initialPauseMs: p.initialPauseMs, midPausesMs: p.midPausesMs } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Stop listening and throw the answer away. */
  const cancel = useCallback(() => {
    r.active = false;
    stopTimer();
    setHint(null);
    try { r.rec?.abort(); } catch { /* already stopped */ }
    setState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    r.active = false;
    stopTimer();
    try { r.rec?.abort(); } catch { /* already stopped */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { supported: !!Ctor, state, error, text, hint, begin, finish, cancel };
}
