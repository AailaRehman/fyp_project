import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, homeFor } from "../context/AuthContext.jsx";
import { errorMessage } from "../utils/api.js";
import { AuthShell, Field, primaryBtn } from "../components/AuthForm.jsx";

const ROLES = [
  { value: "candidate", label: "Candidate", hint: "Take interviews and see my results" },
  { value: "recruiter", label: "Recruiter", hint: "Create sessions and review candidates" },
];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "candidate" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const user = await register(form);
      navigate(homeFor(user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Create your account">
      <form onSubmit={submit} className="space-y-4">
        <fieldset className="grid grid-cols-2 gap-3">
          <legend className="mb-1 text-sm font-medium text-ink">I am a</legend>
          {ROLES.map((r) => (
            <label key={r.value}
              className={`cursor-pointer rounded-md border p-3 text-sm ${form.role === r.value ? "border-brand bg-surface" : "border-line"}`}>
              <input type="radio" name="role" value={r.value} checked={form.role === r.value} onChange={set("role")} className="sr-only" />
              <span className="block font-medium">{r.label}</span>
              <span className="text-muted">{r.hint}</span>
            </label>
          ))}
        </fieldset>
        <Field id="name" label="Full name" autoComplete="name" required minLength={2} value={form.name} onChange={set("name")} />
        <Field id="email" label="Email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
        <Field id="password" label="Password (8+ chars, a letter and a number)" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set("password")} />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button disabled={busy} className={primaryBtn}>{busy ? "Creating..." : "Create account"}</button>
      </form>
      <p className="mt-4 text-sm text-muted">
        Already registered? <Link to="/login" className="text-brand underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
