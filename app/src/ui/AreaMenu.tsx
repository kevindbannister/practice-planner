// The top menu: Home, then the three areas as words. Click an area and a gradient panel drops down under it with that
// area's modules, the way the working papers menu button does.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, IconName } from "./bits";
import { AREAS, MODULE_LABELS, areaOf, navKeyOf, type AreaId } from "../lib/navAreas";

const ICONS: Record<string, IconName> = { plan: "plan", clients: "clients", sales: "chart", comms: "mail", practice: "layout", papers: "list", tax: "calc", payroll: "coins", cosec: "building", reporting: "chart", advisory: "flag" };

export function AreaMenu({ section, chase = 0, children }: { section: string; chase?: number; children?: ReactNode }) {
  const [open, setOpen] = useState<AreaId | null>(null);
  const box = useRef<HTMLElement>(null);
  const here = areaOf(section);
  const current = navKeyOf(section);
  useEffect(() => setOpen(null), [section]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", away);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", away); };
  }, [open]);
  return (
    <nav className="nv-nav" aria-label="Main" ref={box} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(null); }}>
      <a className="nv-link" href="#/home" aria-current={section === "home" ? "page" : undefined}>Home</a>
      {AREAS.map((a) => (
        <div key={a.id} className={`nv-item${open === a.id ? " open" : ""}${here === a.id ? " here" : ""}`} onMouseEnter={() => { if (open) setOpen(a.id); }}>
          <button type="button" className="nv-link" aria-expanded={open === a.id} aria-controls={`nv-panel-${a.id}`} onClick={() => setOpen(open === a.id ? null : a.id)}>
            {a.name}
            <svg className="nv-caret" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="nv-panel" id={`nv-panel-${a.id}`} aria-hidden={open !== a.id}>
            <div className="nv-grid">
              {a.modules.map((k) => (
                <a key={k} href={`#/${k}`} tabIndex={open === a.id ? 0 : -1} aria-current={current === k ? "page" : undefined} onClick={() => setOpen(null)}>
                  <Icon name={ICONS[k] || "list"} size={18} /> {MODULE_LABELS[k]}
                  {k === "plan" && chase > 0 && <span className="nav-count" aria-label={`${chase} to chase`}>{chase}</span>}
                </a>
              ))}
            </div>
          </div>
        </div>
      ))}
      {children}
    </nav>
  );
}
