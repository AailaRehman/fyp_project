import { useCallback, useEffect, useRef, useState } from "react";
import { GazeMonitor, SAMPLE_MS, featuresFromResult } from "../utils/gaze.js";
import { getFaceLandmarker } from "../utils/mediapipe.js";

/* Watches where the candidate looks, using the camera stream that is already on for the interview.
   If MediaPipe cannot load or stops working, status becomes "unavailable" and the interview carries on without it.
   status: idle | loading | on | unavailable */
export function useGazeTracker(stream) {
  const [status, setStatus] = useState("idle");
  const statusRef = useRef("idle");
  const reasonRef = useRef("");
  const monitor = useRef(new GazeMonitor()).current;

  const update = (s, reason = "") => {
    statusRef.current = s;
    reasonRef.current = reason;
    setStatus(s);
  };

  useEffect(() => {
    if (!stream) {
      update("idle");
      return undefined;
    }
    let stopped = false;
    let timer = null;
    let video = null;
    let errors = 0;
    update("loading");

    (async () => {
      try {
        const landmarker = await getFaceLandmarker();
        if (stopped) return;
        // A hidden copy of the camera picture, so the check does not depend on what is on screen.
        video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        Object.assign(video.style, { position: "fixed", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" });
        document.body.appendChild(video);
        await video.play();
        if (stopped) return;
        monitor.startQuestion(performance.now());
        update("on");

        const check = () => {
          try {
            if (video.readyState < 2 || video.videoWidth === 0) return; // no picture yet
            const t = performance.now();
            monitor.ingest(featuresFromResult(landmarker.detectForVideo(video, t)), t);
            errors = 0;
          } catch {
            errors += 1;
            if (errors >= 3) {
              clearInterval(timer);
              update("unavailable", "tracking_error");
            }
          }
        };
        setTimeout(check, 800); // first look early, so the ready screen can learn how the candidate sits
        timer = setInterval(check, SAMPLE_MS);
      } catch (e) {
        if (!stopped) update("unavailable", e?.message === "timeout" ? "timeout" : "load_failed");
      }
    })();

    return () => {
      stopped = true;
      clearInterval(timer);
      if (video) {
        video.srcObject = null;
        video.remove();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  /** Call when a new question appears. */
  const startQuestion = useCallback(() => monitor.startQuestion(performance.now()), [monitor]);
  /** Call when the candidate sits at the screen normally, for example when they press Start. */
  const calibrate = useCallback(() => monitor.calibrate(), [monitor]);
  /** Ends the question and returns what to send to the server. "unavailable" means nothing was checked. */
  const drain = useCallback(() => {
    const r = monitor.drain(performance.now());
    if (statusRef.current !== "on") {
      return { status: "unavailable", reason: reasonRef.current || "not_running", samples: 0, faceSamples: 0, events: [] };
    }
    return { status: "on", samples: r.samples, faceSamples: r.faceSamples, events: r.events };
  }, [monitor]);

  return { status, startQuestion, calibrate, drain };
}
