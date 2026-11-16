// The top menu: Home, then the three areas as words. Click an area and a gradient panel drops down under it with that
// area's modules, the way the working papers menu button does.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Icon, IconName } from "./bits";
import { clientHref, useWorkClient } from "./WorkClientBar";
import { useData } from "./data";
import { AREAS, LEGACY_WORK_LABELS, LEGACY_WORK_MODULES, MODES, MODULE_LABELS, WORKSPACES, areaOf, isThreeMode, navKeyOf, type AreaId, type MenuKind, type Mode, type NavArea } from "../lib/navAreas";
import { goToMode, useNavState } from "./navPrefs";

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

// The menu style is one of the person's navigation preferences, kept against their account (see navPrefs.tsx).
export type { MenuKind } from "../lib/navAreas";
export { useMenuKind, useMode } from "./navPrefs";

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
   Workspaces: Practice, Work and Advisory. The switcher comes in four styles: the Practice/Work toggle with an
   Advisory button beside it (the default), a three-way switch, a dropdown, and the older two-way toggle (where
   Advisory's modules sit inside Work). In Work the bar turns navy with the client strip below; Advisory keeps the
   glass bar with an indigo accent.
   ------------------------------------------------------------------------------------------------------------------ */
const MODE_TIP: Record<Mode, string> = { practice: "Practice: running the firm", work: "Work: clients' work", advisory: "Advisory: performance and advice" };

/** The control that changes workspace, in the chosen style. Used in the top bar and in the phone's bottom bar. */
export function ModeSwitch({ kind, mode, compact = false }: { kind: MenuKind; mode: Mode; compact?: boolean }) {
  const { prefs } = useNavState();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); box.current?.querySelector<HTMLElement>("button")?.focus(); } };
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", away); document.removeEventListener("touchstart", away); };
  }, [open]);
  const ico = (m: Mode, size = 17) => <Icon name={WORKSPACES[m].icon} size={size} />;

  // three independent buttons, one per workspace
  if (kind === "three") {
    const arrows = (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = MODES[(MODES.indexOf(mode) + step + MODES.length) % MODES.length];
      const group = e.currentTarget;
      goToMode(next);
      window.setTimeout(() => group?.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus(), 0);
    };
    return (
      <div className={`mode-three${compact ? " compact" : ""}`} role="radiogroup" aria-label="Workspace" onKeyDown={arrows}>
        {MODES.map((m) => (
          <button key={m} type="button" role="radio" data-mode={m} aria-checked={mode === m} tabIndex={mode === m ? 0 : -1} className={`mode-opt mode-${m}${mode === m ? " on" : ""}`}
            aria-label={WORKSPACES[m].name} title={MODE_TIP[m]} onClick={() => { if (mode !== m) goToMode(m); }}>
            {ico(m)}<span className="mode-word">{WORKSPACES[m].name}</span>
          </button>
        ))}
      </div>
    );
  }

  // the workspace you are in, with a list of all three
  if (kind === "modedrop") {
    return (
      <div className={`mode-drop${open ? " open" : ""}${compact ? " compact" : ""}`} ref={box}>
        <button type="button" className={`mode-drop-btn mode-${mode}`} aria-haspopup="menu" aria-expanded={open} aria-label={`Workspace: ${WORKSPACES[mode].name}. Change workspace`} onClick={() => setOpen(!open)}>
          {ico(mode)}<span>{WORKSPACES[mode].name}</span>
          <svg className="nv-caret" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        {open && (
          <div className="mode-drop-menu" role="menu" aria-label="Workspace">
            {MODES.map((m) => (
              <button key={m} type="button" role="menuitemradio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => { setOpen(false); if (mode !== m) goToMode(m); }}>
                {ico(m, 18)}<span><strong>{WORKSPACES[m].name}</strong><small>{MODE_TIP[m].split(": ")[1]}</small></span>
                {mode === m && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // the Practice/Work toggle: one click swaps between the two. In Advisory neither side is lit, and a click goes back
  // to whichever of the two you were last in.
  const inAdvisory = mode === "advisory";
  const back = prefs.lastPracticeWorkMode;
  const target: Mode = inAdvisory ? back : mode === "work" ? "practice" : "work";
  const toggle = (
    <button type="button" className={`mode-toggle${inAdvisory ? " idle" : ""}`}
      {...(kind === "toggle" ? { role: "switch", "aria-checked": mode === "work" } : {})}
      aria-label={inAdvisory ? `Advisory is showing. Go back to ${WORKSPACES[back].name}` : `${WORKSPACES[mode].name} is showing. Switch to ${WORKSPACES[target].name}`}
      title={inAdvisory ? `Back to ${WORKSPACES[back].name}` : `Switch to ${WORKSPACES[target].name}`} onClick={() => goToMode(target)}>
      <span className={`mode-opt${mode === "practice" ? " on" : ""}${inAdvisory && back === "practice" ? " was" : ""}`}>{ico("practice")}</span>
      <span className={`mode-opt${mode === "work" ? " on" : ""}${inAdvisory && back === "work" ? " was" : ""}`}>{ico("work")}</span>
    </button>
  );
  if (kind === "toggle") return toggle;
  return (
    <div className={`mode-hybrid${compact ? " compact" : ""}`} role="group" aria-label="Workspace">
      {toggle}
      <button type="button" className={`mode-adv${inAdvisory ? " on" : ""}`} aria-pressed={inAdvisory} aria-label={inAdvisory ? "Advisory is showing" : "Switch to Advisory"} title="Advisory"
        onClick={() => { if (!inAdvisory) goToMode("advisory"); }}>
        {ico("advisory")}
      </button>
    </div>
  );
}

/** The modules of the workspace showing, and what each is called there. */
export function modeModules(kind: MenuKind, mode: Mode): { modules: string[]; label: (k: string) => string } {
  if (!isThreeMode(kind) && mode !== "practice") return { modules: LEGACY_WORK_MODULES, label: (k) => LEGACY_WORK_LABELS[k] || MODULE_LABELS[k] };
  const w = WORKSPACES[mode];
  return { modules: w.modules, label: (k) => w.labels[k] || MODULE_LABELS[k] };
}

export function ModeMenu({ section, mode, kind, chase }: { section: string; mode: Mode; kind: MenuKind; chase: number }) {
  const here = navKeyOf(section);
  const { modules, label } = modeModules(kind, mode);
  const w = WORKSPACES[mode];
  // in Work, once a client is chosen the menu goes to that client's working papers, tax return and so on
  const { data } = useData();
  const workClient = useWorkClient();
  const to = (k: string) => (mode === "work" && workClient ? clientHref(k, workClient, data.payrollSchemes as never) : `#/${k}`);
  return (
    <nav className="nv-nav mode-nav" aria-label={`${w.name} menu`}>
      <ModeSwitch kind={kind} mode={mode} />
      <a className="nv-link nv-home-link" href={w.home} aria-label={w.homeLabel} title={w.homeLabel} aria-current={section === w.homeSection ? "page" : undefined}><Icon name="home" size={18} /></a>
      {modules.map((k) => (
        <a key={k} className="nv-link" href={to(k)} aria-current={here === k ? "page" : undefined}>
          {label(k)}
          {k === "plan" && chase > 0 && <span className="nav-count" aria-label={`${chase} to chase`}>{chase}</span>}
        </a>
      ))}
    </nav>
  );
}
