import { useCallback, useEffect, useRef, useState } from "react";

/** Camera and microphone access. status: idle | asking | on | denied | error | ended */
export function useCamera() {
  const [status, setStatus] = useState("idle");
  const [stream, setStream] = useState(null);
  const ref = useRef(null);

  const stop = useCallback(() => {
    ref.current?.getTracks().forEach((t) => t.stop());
    ref.current = null;
    setStream(null);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (ref.current?.active) return ref.current;
    setStatus("asking");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: true,
      });
      ref.current = s;
      setStream(s);
      setStatus("on");
      s.getTracks().forEach((t) => t.addEventListener("ended", () => setStatus("ended")));
      return s;
    } catch (e) {
      setStatus(e?.name === "NotAllowedError" || e?.name === "SecurityError" ? "denied" : "error");
      return null;
    }
  }, []);

  useEffect(() => () => ref.current?.getTracks().forEach((t) => t.stop()), []);

  return { status, stream, start, stop };
}
