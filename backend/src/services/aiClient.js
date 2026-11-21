import { env } from "../config/env.js";

export class AiError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind; // "unavailable" | "bad_response"
  }
}

export function makeAiClient({ baseUrl = env.AI_SERVICE_URL, timeoutMs = 25000, fetchImpl = globalThis.fetch } = {}) {
  async function post(path, body) {
    let res;
    try {
      res = await fetchImpl(baseUrl + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AiError("unavailable");
    }
    if (res.status === 502) throw new AiError("bad_response"); // the AI service could not get a usable reply
    if (res.status >= 500) throw new AiError("unavailable");
    if (!res.ok) throw new AiError("bad_response"); // 4xx means our own request was wrong
    try {
      return await res.json();
    } catch {
      throw new AiError("bad_response");
    }
  }
  return {
    generateMcq: (body) => post("/generate-mcq", body),
    generateQuestion: (body) => post("/generate-question", body),
    evaluateAnswer: (body) => post("/evaluate-answer", body),
  };
}
