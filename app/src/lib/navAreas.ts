// The top menu: three areas, each with its own modules. Home is the logo; Settings and the Development Hub are in the profile menu.

export type AreaId = "run" | "deliver" | "grow";

export interface NavArea { id: AreaId; name: string; short: string; modules: string[] }

export const AREAS: NavArea[] = [
  { id: "run", name: "Run Practice", short: "Run", modules: ["plan", "clients", "sales", "comms", "practice"] },
  { id: "deliver", name: "Deliver Work", short: "Deliver", modules: ["papers", "tax", "payroll", "cosec"] },
  { id: "grow", name: "Grow & Advise", short: "Grow", modules: ["reporting", "advisory"] },
];

export const MODULE_LABELS: Record<string, string> = {
  home: "Home", plan: "Plan", clients: "Clients", sales: "Sales", comms: "Email", practice: "Practice", papers: "Papers", tax: "Tax",
  payroll: "Payroll", cosec: "Co Sec", reporting: "Reporting", advisory: "Advisory", settings: "Settings",
};

/** The menu item a page belongs to: some screens sit under another item. */
export function navKeyOf(section: string): string {
  if (section === "groups") return "clients";
  if (section === "compliance") return "practice";
  if (section === "chase") return "plan";
  if (section === "checklists" || section === "portal") return "settings";
  return section;
}

/** The area a page belongs to, or undefined for Home, Settings and anything outside the three areas. */
export function areaOf(section: string): AreaId | undefined {
  const key = navKeyOf(section);
  return AREAS.find((a) => a.modules.includes(key))?.id;
}

export function isAreaId(v: unknown): v is AreaId {
  return v === "run" || v === "deliver" || v === "grow";
}
