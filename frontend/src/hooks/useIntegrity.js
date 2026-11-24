import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../utils/api.js";
import { createGuard } from "../utils/guard.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_TRIES = 5;
const NOTICE_MS = 10000;

/* Layer 1 anti-cheating in the browser: watches for tab switches, lost focus, copy, cut, paste and right-click while
   an interview is active, blocks the clipboard and right-click, and reports each event to the server.
   The server decides what counts and when the interview must end; the browser only reports.
   Reports that fail because of the network are retried, so a bad connection cannot hide a violation. */
export function useIntegrity({ id, active, limit = 3, serverCount = 0, onAutoSubmit }) {
  const [notice, setNotice] = useState(null); // { type, count, limit }
  const [localCount, setLocalCount] = useState(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const idRef = useRef(id);
  idRef.current = id;
  const autoRef = useRef(onAutoSubmit);
  autoRef.current = onAutoSubmit;
  const queue = useRef([]);
  const busy = useRef(false);

  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      while (queue.current.length) {
        const item = queue.current[0];
        try {
          const out = await api(`/api/interview/${idRef.current}/violations`, {
            method: "POST",
            body: { type: item.type, agoMs: Math.min(120000, Math.round(performance.now() - item.t)) },
          });
          queue.current.shift();
          setLocalCount((c) => Math.max(c, out.count));
          if (out.counted) setNotice({ type: item.type, count: out.count, limit: out.limit });
          if (out.autoSubmitted && out.state) {
            queue.current = [];
            autoRef.current?.(out.state);
          }
        } catch (e) {
          if (e.status === 409 && e.body?.error === "not_in_progress") {
            queue.current = []; // the interview is already over: nothing more to report
            break;
          }
          if (e.status && e.status !== 409 && e.status < 500) {
            queue.current.shift(); // refused for good, retrying would not help
            continue;
          }
          item.tries = (item.tries || 0) + 1; // network problem or a clash with another request: try again
          if (item.tries >= MAX_TRIES) queue.current.shift();
          else await sleep(1500);
        }
      }
    } finally {
      busy.current = false;
    }
  }, []);

  const report = useCallback(
    (type) => {
      if (!activeRef.current) return;
      setNotice({ type, count: null, limit }); // say something at once; the count follows from the server
      queue.current.push({ type, t: performance.now() });
      flush();
    },
    [flush, limit]
  );

  useEffect(() => {
    if (!active) return undefined;
    const guard = createGuard({ report });
    const onVisibility = () => guard.visibility(document.visibilityState === "hidden");
    const onBlur = () => guard.blur();
    const onFocus = () => guard.focus();
    const block = (kind) => (e) => {
      e.preventDefault(); // copy, cut and paste do nothing
      guard.clipboard(kind);
    };
    const onCopy = block("copy");
    const onCut = block("cut");
    const onPaste = block("paste");
    const onMenu = (e) => {
      e.preventDefault(); // no right-click menu
      guard.contextMenu();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onMenu);
    return () => {
      guard.dispose();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onMenu);
    };
  }, [active, report]);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  return { notice, count: Math.max(serverCount, localCount), limit };
}
