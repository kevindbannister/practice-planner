// The Settings tab bar, apart from the Settings page so that showing it above Checks and the Client portal doesn't load every settings screen.
import { href } from "./bits";
import { usePortal } from "./portalKit";

export const TABS: [string, string][] = [
  ["week", "Your week"], ["firm", "Your firm"], ["work", "Types of work"], ["services", "Services & pricing"], ["fields", "Your own fields"], ["pricing", "Pricing rules"], ["design", "Document design"], ["clearance", "Clearance points"], ["adfin", "Adfin"], ["engagement", "Engagement letters"], ["onboarding", "Onboarding"], ["calendar", "Calendar"], ["companies-house", "Companies House"], ["letters", "Letters and email"], ["forms", "Forms"], ["xero", "Xero"], ["detailedpl", "Detailed P&L"], ["hmrc", "HMRC"], ["cosec", "Co Sec"], ["xama", "Xama"], ["sales", "Sales"], ["backups", "Backups"],
];
// These two have their own pages; they sit with Settings rather than in the main bar.
export const PAGE_TABS: [string, string, string][] = [["checklists", "Checks", "#/checklists"], ["dependencies", "Dependencies", "#/dependencies"], ["portal", "Client portal", "#/portal"]];

/** The Settings tab bar, also shown above Checks and the Client portal so they read as part of Settings. */
export function SettingsTabs({ current }: { current: string }) {
  const waiting = usePortal().overview?.attention.length || 0;
  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="page-head"><h1>Settings</h1></div>
      <nav className="tabs" aria-label="Settings sections">
        {TABS.map(([k, label]) => <a key={k} href={href("settings", k)} aria-current={current === k ? "page" : undefined}>{label}</a>)}
        {PAGE_TABS.map(([k, label, to]) => <a key={k} href={to} aria-current={current === k ? "page" : undefined}>{label}{k === "portal" && waiting > 0 ? ` (${waiting})` : ""}</a>)}
      </nav>
    </div>
  );
}

