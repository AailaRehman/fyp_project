import { createContext, useContext, useEffect, useState, useCallback } from "react";

const KEY = "si_theme";
const ORDER = ["system", "light", "dark"];
const ThemeContext = createContext(null);
export const useTheme = () => useContext(ThemeContext);

const readMode = () => {
  try { const v = localStorage.getItem(KEY); return ORDER.includes(v) ? v : "system"; } catch { return "system"; }
};

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(readMode);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle("dark", mode === "dark" || (mode === "system" && mq.matches));
    apply();
    if (mode !== "system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);

  const cycle = useCallback(() => {
    setMode((m) => {
      const next = ORDER[(ORDER.indexOf(m) + 1) % ORDER.length];
      try { localStorage.setItem(KEY, next); } catch {}
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ mode, cycle }}>{children}</ThemeContext.Provider>;
}
