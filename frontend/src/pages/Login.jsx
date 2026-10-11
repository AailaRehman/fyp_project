import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth, homeFor } from "../context/AuthContext.jsx";
import { errorMessage } from "../utils/api.js";
import { AuthShell, Field, primaryBtn } from "../components/AuthForm.jsx";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const user = await login(form.email, form.password);
      navigate(location.state?.from || homeFor(user.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Sign in">
      <form onSubmit={submit} className="space-y-4">
        <Field id="email" label="Email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} />
        <Field id="password" label="Password" type="password" autoComplete="current-password" required value={form.password} onChange={set("password")} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className={primaryBtn}>{busy ? "Signing in..." : "Sign in"}</button>
      </form>
      <p className="mt-4 text-sm text-slate-600">
        No account? <Link to="/register" className="text-indigo-600 underline">Create one</Link>
      </p>
    </AuthShell>
  );
}
