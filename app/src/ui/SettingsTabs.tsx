// The Settings tab bar, apart from the Settings page so that showing it above Checks and the Client portal doesn't load every settings screen.
import { GroupedTabs, TabGroup, href } from "./bits";
import { usePortal } from "./portalKit";

export const TABS: [string, string][] = [
  ["week", "Your week"], ["firm", "Your firm"], ["work", "Types of work"], ["services", "Services & pricing"], ["fields", "Your own fields"], ["pricing", "Pricing rules"], ["design", "Document design"], ["clearance", "Clearance points"], ["adfin", "Adfin"], ["engagement", "Engagement letters"], ["onboarding", "Onboarding"], ["calendar", "Calendar"], ["companies-house", "Companies House"], ["letters", "Letters and email"], ["forms", "Forms"], ["xero", "Xero"], ["detailedpl", "Detailed P&L"], ["hmrc", "HMRC"], ["cosec", "Co Sec"], ["xama", "Xama"], ["sales", "Sales"], ["backups", "Backups"],
];
// These two have their own pages; they sit with Settings rather than in the main bar.
export const PAGE_TABS: [string, string, string][] = [["checklists", "Checks", "#/checklists"], ["dependencies", "Dependencies", "#/dependencies"], ["portal", "Client portal", "#/portal"]];

const SECTION_OF: [string, string[]][] = [
  ["Firm", ["week", "firm", "calendar", "backups"]],
  ["Work and pricing", ["work", "fields", "services", "pricing", "clearance", "sales"]],
  ["Documents and email", ["design", "letters", "forms", "engagement", "onboarding"]],
  ["Connections", ["xero", "adfin", "hmrc", "companies-house", "cosec", "xama", "detailedpl"]],
];
/** Settings in groups: the same screens as before, each under one of five headings. */
export function settingsGroups(portalWaiting = 0): TabGroup[] {
  const label = (k: string) => TABS.find(([x]) => x === k)?.[1] || k;
  const groups: TabGroup[] = SECTION_OF.map(([name, keys]) => ({ label: name, items: keys.map((k) => ({ key: k, label: label(k), to: href("settings", k) })) }));
  groups.push({ label: "Checks and portal", items: PAGE_TABS.map(([k, l, to]) => ({ key: k, label: l, to, badge: k === "portal" ? portalWaiting : 0 })) });
  return groups;
}
/** The Settings tab bar, also shown above Checks and the Client portal so they read as part of Settings. */
export function SettingsTabs({ current }: { current: string }) {
  const waiting = usePortal().overview?.attention.length || 0;
  return <div className="page" style={{ paddingBottom: 0 }}><GroupedTabs groups={settingsGroups(waiting)} current={current} label="Settings" heading="Settings" /></div>;
}
