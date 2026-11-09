// Pick one answer by pressing a button, for questions with only a few answers (Yes/No, Low/Normal/High...). Pressing the chosen one again clears it.
export function Choice({ options, value, onChange, label, disabled }: { options: string[]; value: string; onChange: (v: string) => void; label: string; disabled?: boolean }) {
  return (
    <div className="seg choice" role="group" aria-label={label} style={{ flexWrap: "wrap", maxWidth: "100%" }}>
      {options.map((o) => <button key={o} type="button" disabled={disabled} aria-pressed={value === o} onClick={() => onChange(value === o ? "" : o)}>{o}</button>)}
    </div>
  );
}
/** Few enough answers to show as buttons; more than this stay a drop-down. */
export const fewOptions = (options: string[] | undefined) => !!options && options.length <= 5;
