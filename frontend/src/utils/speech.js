// Small helpers around the browser's Web Speech API.
export const getRecognition = () =>
  typeof window === "undefined" ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null;

export const canSpeak = () =>
  typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";

/** True when the browser can do a voice interview: speech recognition, plus camera and microphone access. */
export const supportsVoiceInterview = () =>
  !!getRecognition() && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/** Reads text aloud. Always resolves (also on error or timeout), so a missing voice never blocks the interview. */
export function speak(text, { timeoutMs = 25000 } = {}) {
  if (!canSpeak()) return Promise.resolve();
  const synth = window.speechSynthesis;
  synth.cancel();
  return new Promise((resolve) => {
    const u = new window.SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 1;
    let timer;
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    timer = setTimeout(() => {
      synth.cancel();
      done();
    }, timeoutMs);
    synth.speak(u);
  });
}

export const stopSpeaking = () => {
  if (canSpeak()) window.speechSynthesis.cancel();
};
