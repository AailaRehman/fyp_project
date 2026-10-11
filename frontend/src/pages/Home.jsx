import { Link } from "react-router-dom";
import { useAuth, homeFor } from "../context/AuthContext.jsx";

export default function Home() {
  const { user } = useAuth();
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-semibold">Smart Interview AI</h1>
      <p className="mt-2 text-slate-600">Landing page and navbar arrive in Step 3.</p>
      <div className="mt-6 flex gap-3">
        {user ? (
          <Link className="rounded-md bg-indigo-600 px-4 py-2 text-white" to={homeFor(user.role)}>Go to dashboard</Link>
        ) : (
          <>
            <Link className="rounded-md bg-indigo-600 px-4 py-2 text-white" to="/login">Sign in</Link>
            <Link className="rounded-md border border-slate-300 px-4 py-2" to="/register">Register</Link>
          </>
        )}
      </div>
    </main>
  );
}
