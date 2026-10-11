import { useAuth } from "../context/AuthContext.jsx";

export default function CandidateDashboard() {
  const { user, logout } = useAuth();
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Candidate dashboard</h1>
      <p className="mt-2 text-slate-600">Signed in as {user.name} ({user.email}).</p>
      <p className="mt-2 text-slate-500">Interview history and roadmap will appear here (Step 13).</p>
      <button onClick={logout} className="mt-6 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50">Log out</button>
    </main>
  );
}
