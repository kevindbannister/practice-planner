// Choose what the cards on the planning board show. Remembered on this device.
import { useEffect, useRef, useState } from "react";
import { Icon } from "./bits";

export type CardField = "type" | "hours" | "client" | "job" | "period" | "stage" | "deadline" | "flags" | "note" | "records";

export const CARD_FIELDS: [CardField, string][] = [
  ["type", "Type of work"],
  ["hours", "Hours"],
  ["client", "Client"],
  ["job", "Job name"],
  ["period", "Period end"],
  ["stage", "Stage"],
  ["deadline", "Deadline"],
  ["flags", "Urgent, late and tight"],
  ["note", "Card note"],
  ["records", "Records in or not"],
];
const DEFAULT: CardField[] = ["type", "hours", "client", "job", "period", "stage", "deadline", "flags", "note"];
const KEY = "pp.plan.card";

export function useCardFields(): [Set<CardField>, (f: CardField, on: boolean) => void, () => void] {
  const read = (): CardField[] => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "null");
      return Array.isArray(v) ? v : DEFAULT;
    } catch {
      return DEFAULT;
    }
  };
  const [fields, setFields] = useState<CardField[]>(read);
  const save = (v: CardField[]) => {
    setFields(v);
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
    } catch {
      /* this visit only */
    }
  };
  const toggle = (f: CardField, on: boolean) => save(on ? [...new Set([...fields, f])] : fields.filter((x) => x !== f));
  return [new Set(fields), toggle, () => save(DEFAULT)];
}

export function CardOptions({ fields, toggle, reset }: { fields: Set<CardField>; toggle: (f: CardField, on: boolean) => void; reset: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="typefilter cardopts" ref={ref}>
      <button type="button" className="btn" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        <Icon name="list" />Card details
      </button>
      {open && (
        <div className="typefilter-pop" role="group" aria-label="Show on each card">
          <div className="typefilter-head">
            <strong style={{ fontSize: 13 }}>Show on each card</strong>
            <button type="button" className="linkbtn" style={{ minHeight: 0, padding: 0, fontSize: 13 }} onClick={reset}>Reset</button>
          </div>
          <ul>
            {CARD_FIELDS.map(([k, label]) => (
              <li key={k}>
                <label>
                  <input type="checkbox" checked={fields.has(k)} onChange={(e) => toggle(k, e.target.checked)} />
                  <span className="typefilter-name">{label}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
