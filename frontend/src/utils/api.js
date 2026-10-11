const API = import.meta.env.VITE_API_URL || "http://localhost:5000";
const TOKEN_KEY = "si_token";

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch {} },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch {} },
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `http_${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  const token = tokenStore.get();
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(body && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: "network_error" });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export function errorMessage(e) {
  const b = e?.body;
  if (b?.issues?.length) return b.issues.map((i) => i.message).join(". ");
  const map = {
    email_taken: "An account with this email already exists.",
    invalid_credentials: "Incorrect email or password.",
    network_error: "Cannot reach the server. Is the backend running?",
    too_many_requests: "Too many attempts. Please wait a few minutes.",
  };
  return map[e?.message] || "Something went wrong. Please try again.";
}
