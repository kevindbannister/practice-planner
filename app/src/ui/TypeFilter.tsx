// Pick one or more types of work to show. The choice is remembered on this device.
import { useEffect, useRef, useState } from "react";
import { svcClass } from "../lib/serviceColour";
import { Icon } from "./bits";

export type TypeOption = { key: string; name: string; count: number };

export function useRememberedTypes(storageKey: string): [string[], (v: string[]) => void] {
  const read = (): string[] => {
    try {
      const v = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  };
  const [types, setTypes] = useState<string[]>(read);
  const set = (v: string[]) => {
    setTypes(v);
    try {
      localStorage.setItem(storageKey, JSON.stringify(v));
    } catch {
      /* remembered for this visit only */
    }
  };
  return [types, set];
}

export function TypeFilter({ options, selected, onChange }: { options: TypeOption[]; selected: string[]; onChange: (v: string[]) => void }) {
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
  // only count choices that are still on offer
  const active = selected.filter((k) => options.some((o) => o.key === k));
  const label = !active.length ? "All types of work" : active.length === 1 ? options.find((o) => o.key === active[0])?.name || "1 type" : `${active.length} types of work`;
  const toggle = (k: string) => onChange(active.includes(k) ? active.filter((x) => x !== k) : [...active, k]);

  return (
    <div className="typefilter" ref={ref}>
      <button type="button" className={`btn small typefilter-btn${active.length ? " on" : ""}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}>
        {active.length > 0 && (
          <span className="typefilter-dots" aria-hidden="true">
            {active.slice(0, 4).map((k) => <span key={k} className={`svc-dot ${svcClass(k)}`} />)}
          </span>
        )}
        <span className="typefilter-label">{label}</span>
        <Icon name="down" size={14} />
      </button>
      {open && (
        <div className="typefilter-pop" role="group" aria-label="Types of work to show">
          <div className="typefilter-head">
            <strong style={{ fontSize: 13 }}>Show these types of work</strong>
            <button type="button" className="linkbtn" style={{ minHeight: 0, padding: 0, fontSize: 13 }} onClick={() => onChange([])}>
              {active.length ? "Show all" : "All shown"}
            </button>
          </div>
          <ul>
            {options.map((o) => (
              <li key={o.key}>
                <label>
                  <input type="checkbox" checked={active.includes(o.key)} onChange={() => toggle(o.key)} />
                  <span className={`svc-dot ${svcClass(o.key)}`} aria-hidden="true" />
                  <span className="typefilter-name">{o.name}</span>
                  <span className="muted mono" style={{ fontSize: 12 }}>{o.count}</span>
                </label>
              </li>
            ))}
            {!options.length && <li className="muted" style={{ padding: 8, fontSize: 13 }}>Nothing to filter.</li>}
          </ul>
          <p className="muted" style={{ margin: 0, padding: "6px 10px 10px", fontSize: 12 }}>Tick none to show everything.</p>
        </div>
      )}
    </div>
  );
}
