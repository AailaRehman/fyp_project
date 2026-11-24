const WHAT = {
  tab_switch: "You left the interview page.",
  window_blur: "The interview window lost focus.",
  copy: "Copying is not allowed.",
  cut: "Cutting is not allowed.",
  paste: "Pasting is not allowed.",
  context_menu: "Right-click is turned off during the interview. This is recorded but does not count as a warning.",
};

function noticeText(n, limit) {
  if (n.type === "context_menu") return WHAT.context_menu;
  const l = n.limit ?? limit;
  const which = n.count ? ` Warning ${n.count} of ${l}.` : " This is recorded.";
  return `${WHAT[n.type]}${which} After ${l} warnings your interview is submitted automatically.`;
}

/** A warning when something was recorded, and a running count of warnings used. */
export default function IntegrityBanner({ notice, count, limit }) {
  return (
    <div>
      {notice && (
        <p role="alert" data-testid="integrity-notice" className="mt-4 rounded-md border border-line bg-surface p-3 text-sm text-signal">
          {noticeText(notice, limit)}
        </p>
      )}
      {count > 0 && (
        <p className="mt-2 text-xs text-muted" data-testid="strikes">
          Warnings used: {count} of {limit}
        </p>
      )}
    </div>
  );
}
