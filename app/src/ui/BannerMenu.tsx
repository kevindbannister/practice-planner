// The menu icon at the right of a banner (working papers): hover it, or click it, and the main menu slides down on a
// gradient panel under the banner. It slides away again when the pointer leaves, on Escape, or when focus moves out.
import { Fragment, useEffect, useRef, useState } from "react";
import { Icon, IconName } from "./bits";
import { AREAS, MODULE_LABELS, navKeyOf } from "../lib/navAreas";

const ICONS: Record<string, IconName> = { home: "home", plan: "plan", clients: "clients", sales: "chart", comms: "mail", practice: "layout", aml: "scale", papers: "list", tax: "calc", payroll: "coins", cosec: "building", reporting: "chart", advisory: "flag", settings: "settings", taxplan: "calc" };

export function BannerMenu({ current = "papers" }: { current?: string }) {
  const cur = navKeyOf(current);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(undefined);
  const show = () => { window.clearTimeout(timer.current); setOpen(true); };
  const hideSoon = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setOpen(false), 260); };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); (box.current?.querySelector("button.banner-menu-btn") as HTMLElement | null)?.focus(); } };
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", key);
    document.addEventListener("mousedown", away);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", away); };
  }, [open]);
  return (
    <div className={`banner-menu${open ? " open" : ""}`} ref={box} onMouseEnter={show} onMouseLeave={hideSoon}
      onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <button type="button" className="paper-top-icon banner-menu-btn" aria-expanded={open} aria-controls="banner-menu-panel" aria-label="Menu" title="Menu" onClick={show}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
      <nav className="banner-menu-panel" id="banner-menu-panel" aria-label="Main" aria-hidden={!open}>
        <div className="banner-menu-grid">
          {["home"].map((k) => (
            <a key={k} href={`#/${k}`} tabIndex={open ? 0 : -1} aria-current={k === cur ? "page" : undefined} onClick={() => setOpen(false)}>
              <Icon name={ICONS[k] || "list"} size={18} /> {MODULE_LABELS[k]}
            </a>
          ))}
          {AREAS.map((a) => (
            <Fragment key={a.id}>
              <div className="bm-head">{a.name}</div>
              {a.modules.map((k) => (
                <a key={k} href={`#/${k}`} tabIndex={open ? 0 : -1} aria-current={k === cur ? "page" : undefined} onClick={() => setOpen(false)}>
              <Icon name={ICONS[k] || "list"} size={18} /> {MODULE_LABELS[k]}
            </a>
              ))}
            </Fragment>
          ))}
          {["settings"].map((k) => (
            <a key={k} href={`#/${k}`} tabIndex={open ? 0 : -1} aria-current={k === cur ? "page" : undefined} onClick={() => setOpen(false)}>
              <Icon name={ICONS[k] || "list"} size={18} /> {MODULE_LABELS[k]}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
