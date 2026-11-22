// Loads MediaPipe's face tracker from a CDN when the interview starts. Nothing is installed or bundled, and no
// camera picture ever leaves the browser: the model runs on this computer.
// The version is pinned so that a new release cannot change how the interview behaves overnight.
export const MEDIAPIPE_VERSION = "1.2.2";
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}`;
export const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const LOAD_TIMEOUT_MS = 30000;

function withTimeout(promise, ms) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

async function load() {
  const vision = await import(/* @vite-ignore */ `${CDN}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  return vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" }, // one check every 2 seconds is easy for the CPU
    runningMode: "VIDEO",
    numFaces: 2, // two, so that a second person in view can be noticed
    outputFaceBlendshapes: true, // where the eyes point
    outputFacialTransformationMatrixes: true, // how the head is turned
  });
}

let loading = null;

/** Resolves to a face tracker, or rejects (for example when offline or blocked). Only loads once per page. */
export function getFaceLandmarker() {
  if (!loading) {
    loading = withTimeout(load(), LOAD_TIMEOUT_MS).catch((e) => {
      loading = null; // allow a later try
      throw e;
    });
  }
  return loading;
}
