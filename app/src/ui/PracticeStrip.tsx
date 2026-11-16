// In Practice, a strip under the menu says which section you are in and holds that section's tabs. It is built the
// same way as the client strip in Work: the same height, with the icon and name in the same place.
import { fmtDate, todayIso } from "../lib/domain";
import { MODULE_LABELS } from "../lib/navAreas";
import { Icon, IconName } from "./bits";
import { setStripSlot } from "./StripSlot";

const SETTINGS = new Set(["settings", "checklists", "dependencies", "portal"]);
const NAMES: Record<string, string> = { groups: "Clients", chase: "Chase", actions: "Actions", compliance: "Compliance", setup: "Setup" };
const ICONS: Record<string, IconName> = { home: "home", plan: "plan", clients: "clients", groups: "clients", sales: "chart", comms: "mail", practice: "layout", aml: "scale", chase: "mail", actions: "check", compliance: "scale", settings: "cog" };

export function PracticeStrip({ section }: { section: string }) {
  const key = SETTINGS.has(section) ? "settings" : section || "home";
  const name = NAMES[key] || MODULE_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
  const root = key === "home" ? "#/" : key === "groups" ? "#/clients" : `#/${key}`;
  return (
    <header className="paper-top work-client practice-strip" aria-label="Where you are">
      <a className="paper-top-icon" href={root} title={name} aria-label={name}><Icon name={ICONS[key] || "list"} size={20} /></a>
      <strong className="wc-name">{name}</strong>
      {key === "home" && <span className="chip">{fmtDate(todayIso(), { weekday: true })}</span>}
      <div className="ps-tabs" ref={setStripSlot} />
    </header>
  );
}
