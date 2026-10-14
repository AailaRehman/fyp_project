import { useAuth } from "../context/AuthContext.jsx";

export default function RecruiterDashboard() {
  const { user, logout } = useAuth();
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Recruiter dashboard</h1>
      <p className="mt-2 text-muted">Signed in as {user.name} ({user.email}).</p>
      <p className="mt-2 text-muted">Sessions and candidate reports will appear here (Steps 11-12).</p>
      <button onClick={logout} className="mt-6 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface">Log out</button>
    </main>
  );
}
