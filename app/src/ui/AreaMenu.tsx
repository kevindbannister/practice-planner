// The top menu: Home, then the three areas as words. Click an area and a gradient panel drops down under it with that
// area's modules, the way the working papers menu button does.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon, IconName } from "./bits";
import { AREAS, MODULE_LABELS, areaOf, navKeyOf, type AreaId, type NavArea } from "../lib/navAreas";

const ICONS: Record<string, IconName> = { plan: "plan", clients: "clients", sales: "chart", comms: "mail", practice: "layout", aml: "scale", papers: "list", tax: "calc", payroll: "coins", cosec: "building", reporting: "chart", advisory: "flag", taxplan: "calc" };

export function AreaMenu({ section, chase = 0, rename = false, children }: { section: string; chase?: number; rename?: boolean; children?: ReactNode }) {
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
      <a className="nv-link nv-home" href="#/home" aria-label="Home" title="Home" aria-current={section === "home" ? "page" : undefined}><Icon name="home" size={20} /></a>
      {AREAS.map((a) => (
        <div key={a.id} className={`nv-item${open === a.id ? " open" : ""}${here === a.id ? " here" : ""}`} onMouseEnter={() => { if (open) setOpen(a.id); }}>
          <button type="button" className="nv-link" aria-expanded={open === a.id} aria-controls={`nv-panel-${a.id}`} aria-label={rename && here === a.id ? `${MODULE_LABELS[current]}, in ${a.name}. Open the ${a.name} menu` : undefined} title={rename && here === a.id ? `${a.name} menu` : undefined} onClick={() => setOpen(open === a.id ? null : a.id)}>
            {rename && here === a.id && MODULE_LABELS[current] ? MODULE_LABELS[current] : a.name}
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

/** Which menu is showing: the drop-down one, or the two-line trial. Kept in this browser. */
export type MenuKind = "drop" | "named" | "two" | "pick" | "toggle";
const read = (): MenuKind => { try { const v = localStorage.getItem("pp.menu"); return v === "two" || v === "pick" || v === "named" || v === "toggle" ? v : "drop"; } catch { return "drop"; } };
const subscribe = (cb: () => void) => { window.addEventListener("pp-menu", cb); return () => window.removeEventListener("pp-menu", cb); };
export function useMenuKind(): [MenuKind, (k: MenuKind) => void] {
  const kind = useSyncExternalStore(subscribe, read, () => "drop" as MenuKind);
  return [kind, (k) => { try { localStorage.setItem("pp.menu", k); } catch { /* this visit only */ } window.dispatchEvent(new Event("pp-menu")); }];
}

/** Two-line trial, first line: Home and the three areas as words. Choosing one changes the second line. */
export function TwoLineAreas({ section, area, onPick }: { section: string; area: NavArea; onPick: (id: AreaId) => void }) {
  const here = areaOf(section);
  return (
    <nav className="nv-nav" aria-label="Areas">
      <a className="nv-link nv-home" href="#/home" aria-label="Home" title="Home" aria-current={section === "home" ? "page" : undefined}><Icon name="home" size={20} /></a>
      {AREAS.map((a) => (
        <button key={a.id} type="button" className={`nv-link${a.id === area.id ? " tl-on" : ""}${a.id === here ? " tl-here" : ""}`} aria-pressed={a.id === area.id} onClick={() => onPick(a.id)}>{a.name}</button>
      ))}
    </nav>
  );
}

/** Two-line trial, second line: the modules of the chosen area. */
export function TwoLineModules({ section, area, chase = 0 }: { section: string; area: NavArea; chase?: number }) {
  const current = navKeyOf(section);
  return (
    <nav className="tl-row hide-phone" aria-label={`${area.name} modules`}>
      {area.modules.map((k) => (
        <a key={k} href={`#/${k}`} aria-current={current === k ? "page" : undefined}>
          <Icon name={ICONS[k] || "list"} size={16} /> {MODULE_LABELS[k]}
          {k === "plan" && chase > 0 && <span className="nav-count" aria-label={`${chase} to chase`}>{chase}</span>}
        </a>
      ))}
    </nav>
  );
}

/** Area picker trial: one drop-down chooses the area, and the modules beside it change to match. */
export function AreaPicker({ section, area, onPick, chase = 0 }: { section: string; area: NavArea; onPick: (id: AreaId) => void; chase?: number }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = navKeyOf(section);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", away);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", away); };
  }, [open]);
  return (
    <div className="pk" ref={box}>
      <a className="nv-link nv-home" href="#/home" aria-label="Home" title="Home" aria-current={section === "home" ? "page" : undefined}><Icon name="home" size={20} /></a>
      <div className={`nv-item${open ? " open" : ""}`}>
        <button type="button" className="nv-link pk-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
          {area.name}
          <svg className="nv-caret" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="nv-panel" aria-hidden={!open}>
          <div className="nv-grid pk-list" role="listbox" aria-label="Area">
            {AREAS.map((a) => (
              <button key={a.id} type="button" role="option" aria-selected={a.id === area.id} tabIndex={open ? 0 : -1} onClick={() => { onPick(a.id); setOpen(false); }}>{a.name}</button>
            ))}
          </div>
        </div>
      </div>
      <nav className="pk-mods" aria-label={`${area.name} modules`}>
        {area.modules.map((k) => (
          <a key={k} className="nv-link" href={`#/${k}`} aria-current={current === k ? "page" : undefined}>
            {MODULE_LABELS[k]}
            {k === "plan" && chase > 0 && <span className="nav-count" aria-label={`${chase} to chase`}>{chase}</span>}
          </a>
        ))}
      </nav>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------------------------
   Practice / Work toggle: two modes instead of three areas. Practice is running the firm; Work is doing clients' work
   (Work and Advise together). In Work the bar turns navy and the client you are working on sits just below it.
   ------------------------------------------------------------------------------------------------------------------ */
export type Mode = "practice" | "work";
export const PRACTICE_MODULES = ["plan", "clients", "sales", "comms", "practice", "aml"];
export const WORK_MODULES = ["clients", "papers", "tax", "payroll", "cosec", "reporting", "advisory", "taxplan"];
const WORK_LABELS: Record<string, string> = { papers: "Working papers", reporting: "Reports" };

export function modeOf(section: string): Mode | undefined {
  const a = areaOf(section);
  return a === "deliver" || a === "grow" ? "work" : a === "run" ? "practice" : undefined;
}
const readMode = (): Mode => { try { return localStorage.getItem("pp.mode") === "work" ? "work" : "practice"; } catch { return "practice"; } };
const keepMode = (m: Mode) => { try { localStorage.setItem("pp.mode", m); } catch { /* this visit only */ } };
/** The mode shown: the page's own mode, or (on Home, Clients, Settings…) the one last chosen. */
export function useMode(section: string): Mode {
  const own = section === "clients" ? undefined : modeOf(section);
  if (own) keepMode(own);
  return own || readMode();
}
const lastPage = (m: Mode): string => { try { return localStorage.getItem(`pp.mode.last.${m}`) || (m === "work" ? "#/papers" : "#/plan"); } catch { return m === "work" ? "#/papers" : "#/plan"; } };
export function rememberPage(section: string) {
  const m = section === "clients" ? undefined : modeOf(section);
  if (m) { try { localStorage.setItem(`pp.mode.last.${m}`, window.location.hash || "#/"); } catch { /* fine */ } }
}

export function ModeMenu({ section, mode, chase }: { section: string; mode: Mode; chase: number }) {
  const here = navKeyOf(section);
  const mods = mode === "work" ? WORK_MODULES : PRACTICE_MODULES;
  const pick = (m: Mode) => {
    if (m === mode) return;
    keepMode(m);
    window.location.hash = lastPage(m);
    window.dispatchEvent(new Event("pp-menu"));
  };
  return (
    <nav className="nv-nav mode-nav" aria-label="Main">
      <div className="mode-toggle" role="group" aria-label="Practice or work">
        <button type="button" aria-pressed={mode === "practice"} title="Practice: running the firm" onClick={() => pick("practice")}>
          <Icon name="building" size={17} /><span className="sr-only">Practice</span>
        </button>
        <button type="button" aria-pressed={mode === "work"} title="Work: clients' work" onClick={() => pick("work")}>
          <Icon name="briefcase" size={17} /><span className="sr-only">Work</span>
        </button>
      </div>
      {mods.map((k) => (
        <a key={k} className="nv-link" href={`#/${k}`} aria-current={here === k ? "page" : undefined}>
          {(mode === "work" && WORK_LABELS[k]) || MODULE_LABELS[k]}
          {k === "plan" && chase > 0 && <span className="nav-count" aria-label={`${chase} to chase`}>{chase}</span>}
        </a>
      ))}
    </nav>
  );
}
