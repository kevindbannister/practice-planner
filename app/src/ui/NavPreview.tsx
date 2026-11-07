// A trial of a different top menu: Home, then the three areas as words. Hover or click an area and a gradient panel
// drops down under it with that area's modules, the way the working papers menu button does.
import { useEffect, useRef, useState } from "react";
import { Brand, Icon, IconName } from "./bits";
import { AREAS, MODULE_LABELS, type AreaId } from "../lib/navAreas";
import { useChaseCount } from "./ChasePage";

const ICONS: Record<string, IconName> = { plan: "plan", clients: "clients", sales: "chart", comms: "mail", practice: "layout", papers: "list", tax: "calc", payroll: "coins", cosec: "building", reporting: "chart", advisory: "flag" };

export function NavPreview() {
  const [open, setOpen] = useState<AreaId | null>(null);
  const bar = useRef<HTMLElement>(null);
  const timer = useRef<number>();
  const chase = useChaseCount();
  const show = (id: AreaId) => { window.clearTimeout(timer.current); setOpen(id); };
  const hideSoon = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(null), 260); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    const away = (e: MouseEvent) => { if (bar.current && !bar.current.contains(e.target as Node)) setOpen(null); };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", away);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", away); };
  }, [open]);
  return (
    <>
      <header className="topbar nv-bar" ref={bar} onMouseLeave={hideSoon} onBlur={(e) => { if (!bar.current?.contains(e.relatedTarget as Node | null)) setOpen(null); }}>
        <div className="topbar-left">
          <Brand />
          <nav className="nv-nav" aria-label="Main">
            <a className="nv-link" href="#/home" onMouseEnter={() => setOpen(null)}>Home</a>
            {AREAS.map((a) => (
              <div key={a.id} className={`nv-item${open === a.id ? " open" : ""}`} onMouseEnter={() => show(a.id)}>
                <button type="button" className="nv-link" aria-expanded={open === a.id} aria-controls={`nv-panel-${a.id}`} onClick={() => (open === a.id ? setOpen(null) : show(a.id))}>
                  {a.name}
                  <svg className="nv-caret" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <div className="nv-panel" id={`nv-panel-${a.id}`} aria-hidden={open !== a.id}>
                  <div className="nv-grid">
                    {a.modules.map((k) => (
                      <a key={k} href={`#/${k}`} tabIndex={open === a.id ? 0 : -1} onClick={() => setOpen(null)}>
                        <Icon name={ICONS[k] || "list"} size={18} /> {MODULE_LABELS[k]}
                        {k === "plan" && chase > 0 && <span className="nav-count" aria-label={`${chase} to chase`}>{chase}</span>}
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </nav>
        </div>
        <div className="topbar-right">
          <a className="btn small" href="#/home">Back to the normal menu</a>
        </div>
      </header>
      <main className="page">
        <div className="page-head">
          <h1>Menu trial</h1>
          <p className="muted">Hover over, or click, Run Practice, Deliver Work or Grow &amp; Advise above. The panel slides down with that area's modules, like the menu button in working papers.</p>
        </div>
        <section className="card pad stack">
          <h2 className="sec-h">What to look at</h2>
          <ul className="muted" style={{ margin: 0, paddingLeft: 20 }}>
            <li>Home is a plain link. Settings and the Development Hub stay in the profile menu on the normal pages.</li>
            <li>Moving to another area switches the panel; moving away or pressing Escape closes it.</li>
            <li>The links go to the real pages, which show the normal menu. This trial is only this page.</li>
          </ul>
        </section>
      </main>
    </>
  );
}
