const LABEL = {
  tab_switch: "left the page (switched tab or minimised)",
  window_blur: "switched to another window",
  copy: "tried to copy",
  cut: "tried to cut",
  paste: "tried to paste",
  context_menu: "used right-click",
};
const PHASE = { mcq: "Multiple-choice", voice: "Voice" };

/** What was recorded about rule breaks, shown with the results. Shows nothing for a clean interview. */
export default function ViolationLog({ state }) {
  const v = state.violations;
  const items = v?.items ?? [];
  if (!state.autoSubmitted && items.length === 0) return null;
  return (
    <section className="mt-6 rounded-lg border border-line bg-surface p-4" data-testid="violation-log">
      {state.autoSubmitted && (
        <p className="font-medium" data-testid="auto-submitted">
          This interview was submitted automatically because of repeated rule breaks, so it ends with a verdict of Reject.
        </p>
      )}
      {items.length > 0 && (
        <>
          <p className="mt-1 text-sm text-muted">
            Recorded during the interview ({v.count} of {v.limit} warnings used):
          </p>
          <ul className="mt-1 text-sm">
            {items.map((i, n) => (
              <li key={n}>
                {PHASE[i.phase]} question {i.questionNumber}: you {LABEL[i.type]}.{i.counted ? "" : " (not counted)"}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
