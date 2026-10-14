// Choose what the cards on the planning board show. Remembered on this device.
import { useEffect, useRef, useState } from "react";
import { Icon } from "./bits";

export type CardField = "type" | "hours" | "client" | "job" | "period" | "stage" | "deadline" | "flags" | "note" | "records" | "subtasks" | "elements";

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
  ["subtasks", "Subtasks ticked off"],
  ["elements", "Elements link"],
];
const DEFAULT: CardField[] = ["type", "hours", "client", "job", "period", "stage", "deadline", "flags", "note", "subtasks"];
const KEY = "pp.plan.card";
const NEW_SINCE: CardField[] = ["subtasks"];
const seen = (f: CardField) => {
  try {
    return (JSON.parse(localStorage.getItem(KEY + ".seen") || "[]") as string[]).includes(f);
  } catch {
    return false;
  }
};

export function useCardFields(): [Set<CardField>, (f: CardField, on: boolean) => void, () => void] {
  const read = (): CardField[] => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "null");
      // fields added since the choice was saved are shown until they're turned off
      return Array.isArray(v) ? [...v, ...NEW_SINCE.filter((f) => !v.includes(f) && !seen(f))] : DEFAULT;
    } catch {
      return DEFAULT;
    }
  };
  const [fields, setFields] = useState<CardField[]>(read);
  const save = (v: CardField[]) => {
    setFields(v);
    try {
      localStorage.setItem(KEY, JSON.stringify(v));
      localStorage.setItem(KEY + ".seen", JSON.stringify(NEW_SINCE));
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
