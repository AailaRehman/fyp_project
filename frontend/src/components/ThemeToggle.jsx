import { useTheme } from "../context/ThemeContext.jsx";

const icons = {
  light: <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />,
  dark: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  system: <path d="M3 5h18v11H3zM8 20h8m-4-4v4" />,
};
const labels = { system: "Match system", light: "Light", dark: "Dark" };

export default function ThemeToggle() {
  const { mode, cycle } = useTheme();
  return (
    <button
      type="button"
      onClick={cycle}
      title={`Theme: ${labels[mode]}. Click to change.`}
      aria-label={`Theme: ${labels[mode]}. Click to change.`}
      className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-2.5 text-sm text-muted hover:text-ink"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {icons[mode]}
      </svg>
      <span className="hidden sm:inline">{labels[mode]}</span>
    </button>
  );
}
