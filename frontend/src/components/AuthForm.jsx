export function Field({ label, id, ...props }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">{label}</label>
      <input id={id} {...props}
        className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-200" />
    </div>
  );
}

export function AuthShell({ title, children }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">{title}</h1>
      {children}
    </main>
  );
}

export const primaryBtn =
  "w-full rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700 disabled:opacity-60";
