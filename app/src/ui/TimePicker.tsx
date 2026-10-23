// The one-tap time picker: quick lengths plus a box to type your own. Kept apart from the rest of
// the time-spent screens so the job and task panels can use it without a circular import.
import { useId } from "react";
import { fmtHours } from "../lib/domain";
import { QUICK_HOURS, hoursText, parseDuration } from "../lib/timeSpent";

/** Quick lengths plus a box to type your own ("1h30", "90m", "1.5"). The text is the value. */
export function TimePicker({ value, onChange, estimate, label = "How long did it take?" }: { value: string; onChange: (v: string) => void; estimate?: number; label?: string }) {
  const id = useId();
  const picks = [...QUICK_HOURS];
  if (estimate && estimate > 0 && !picks.includes(estimate)) picks.push(estimate);
  picks.sort((a, b) => a - b);
  const now = parseDuration(value);
  return (
    <div className="time-picker">
      <span className="muted" id={id} style={{ fontSize: 12 }}>{label}</span>
      <div className="time-picks" role="group" aria-labelledby={id}>
        {picks.map((h) => (
          <button key={h} type="button" className="time-pick" aria-pressed={now === h} onClick={() => onChange(hoursText(h))}>
            {fmtHours(h)}
            {estimate === h ? <span className="time-est"> est.</span> : null}
          </button>
        ))}
      </div>
      <input className="input time-input" inputMode="decimal" placeholder="or type it, e.g. 1h30" aria-label="Time taken" value={value} onChange={(e) => onChange(e.target.value)} />
      {value.trim() && now === undefined && <span className="error-text" role="alert" style={{ fontSize: 12 }}>I couldn't read that. Try 1.5, 1h30 or 90m.</span>}
    </div>
  );
}
