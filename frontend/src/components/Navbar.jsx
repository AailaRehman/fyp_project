import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth, homeFor } from "../context/AuthContext.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <path d="M4 5h18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H12l-5 4v-4H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" fill="var(--brand)" />
        <circle cx="13" cy="11.5" r="3" fill="var(--bg)" />
      </svg>
      Smart Interview AI
    </Link>
  );
}

const linkCls = ({ isActive }) =>
  `rounded-md px-3 py-2 text-sm ${isActive ? "font-semibold text-ink" : "text-muted hover:text-ink"}`;

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const handleLogout = () => { logout(); close(); navigate("/"); };

  const links = user ? (
    <>
      <NavLink to={homeFor(user.role)} className={linkCls} onClick={close}>Dashboard</NavLink>
      <span className="px-3 py-2 text-sm text-muted">
        {user.name} <span className="text-muted/80">({user.role})</span>
      </span>
      <button onClick={handleLogout} className="rounded-md px-3 py-2 text-left text-sm text-muted hover:text-ink">Log out</button>
    </>
  ) : (
    <>
      <Link to="/#how-it-works" className="rounded-md px-3 py-2 text-sm text-muted hover:text-ink" onClick={close}>How it works</Link>
      <NavLink to="/login" className={linkCls} onClick={close}>Sign in</NavLink>
      <Link to="/register" onClick={close}
        className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-ink hover:opacity-90">
        Create account
      </Link>
    </>
  );

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-bg/90 backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <div className="hidden items-center gap-1 md:flex">
          {links}
          <div className="ml-2"><ThemeToggle /></div>
        </div>
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            type="button" onClick={() => setOpen((o) => !o)}
            aria-expanded={open} aria-controls="mobile-menu" aria-label="Menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-muted hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>
      {open && (
        <div id="mobile-menu" className="flex flex-col items-start gap-1 border-t border-line px-4 py-3 md:hidden">
          {links}
        </div>
      )}
    </header>
  );
}
