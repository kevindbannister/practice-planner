// The top menu: three areas, each with its own modules. Home is the logo; Settings and the Development Hub are in the profile menu.

export type AreaId = "run" | "deliver" | "grow";

export interface NavArea { id: AreaId; name: string; short: string; modules: string[] }

export const AREAS: NavArea[] = [
  { id: "run", name: "Practice", short: "Practice", modules: ["plan", "clients", "sales", "comms", "practice", "aml"] },
  { id: "deliver", name: "Work", short: "Work", modules: ["papers", "tax", "payroll", "cosec"] },
  { id: "grow", name: "Advise", short: "Advise", modules: ["reporting", "advisory", "taxplan"] },
];

export const MODULE_LABELS: Record<string, string> = {
  home: "Home", plan: "Plan", clients: "Clients", sales: "Sales", comms: "Email", practice: "Practice view", aml: "AML", papers: "Papers", tax: "Tax",
  payroll: "Payroll", cosec: "Co Sec", reporting: "Reporting", advisory: "Advisory", taxplan: "Tax planning", settings: "Settings",
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

/* ------------------------------------------------------------------------------------------------------------------
   Workspaces: Practice (running the firm), Work (doing clients' work) and Advisory (analysing performance and
   advising). One place says what each is called, where it lands, which modules it holds and how it is themed.
   ------------------------------------------------------------------------------------------------------------------ */
export type Mode = "practice" | "work" | "advisory";
export const MODES: Mode[] = ["practice", "work", "advisory"];

export interface Workspace {
  id: Mode;
  name: string;
  /** Icon name from the app's icon set. */
  icon: "building" | "briefcase" | "chart";
  /** Where the workspace lands. */
  home: string;
  /** The route section of its landing page. */
  homeSection: string;
  homeLabel: string;
  modules: string[];
  /** Module names that differ inside this workspace. */
  labels: Record<string, string>;
  /** Theme id: sets the header treatment and accent. */
  theme: "glass" | "navy" | "indigo";
}

export const WORKSPACES: Record<Mode, Workspace> = {
  practice: { id: "practice", name: "Practice", icon: "building", home: "#/", homeSection: "home", homeLabel: "Home", modules: ["plan", "clients", "sales", "comms", "practice", "aml"], labels: {}, theme: "glass" },
  work: { id: "work", name: "Work", icon: "briefcase", home: "#/work", homeSection: "work", homeLabel: "Work home", modules: ["clients", "papers", "tax", "payroll", "cosec"], labels: { papers: "Working papers" }, theme: "navy" },
  advisory: { id: "advisory", name: "Advisory", icon: "chart", home: "#/advisory-overview", homeSection: "advisory-overview", homeLabel: "Advisory overview", modules: ["clients", "reporting", "advisory", "taxplan"], labels: { advisory: "Freedom Plans" }, theme: "indigo" },
};
/** The older two-way switch keeps Advisory's modules inside Work. */
export const LEGACY_WORK_MODULES = ["clients", "papers", "tax", "payroll", "cosec", "reporting", "advisory", "taxplan"];
export const LEGACY_WORK_LABELS: Record<string, string> = { papers: "Working papers", reporting: "Reports" };

/** Every menu style. The last three switch between the three workspaces. */
export type MenuKind = "drop" | "named" | "two" | "pick" | "toggle" | "toggle-advisory" | "three" | "modedrop";
export const MENU_KINDS: [MenuKind, string][] = [
  ["toggle-advisory", "Practice/Work + Advisory icon"], ["three", "Three-way mode switch"], ["modedrop", "Mode dropdown"],
  ["drop", "Drop-down areas"], ["named", "Drop-down, shows where you are"], ["two", "Two lines"], ["pick", "Area picker"], ["toggle", "Practice and Work switch"],
];
export const DEFAULT_MENU: MenuKind = "toggle-advisory";
export const isMenuKind = (v: unknown): v is MenuKind => MENU_KINDS.some(([k]) => k === v);
/** Styles that switch between workspaces (rather than listing the three areas). */
export const isModeKind = (k: MenuKind) => k === "toggle" || k === "toggle-advisory" || k === "three" || k === "modedrop";
/** Styles where Advisory is its own workspace (in the older two-way switch it is part of Work). */
export const isThreeMode = (k: MenuKind) => k !== "toggle";
const isMode = (v: unknown): v is Mode => v === "practice" || v === "work" || v === "advisory";

/** The route section of an address: "#/plan/week?x=1" is "plan"; "#/" is "home". */
export function sectionOfHash(hash: string): string {
  const path = String(hash || "").replace(/^#\/?/, "").split("?")[0];
  return path.split("/").filter(Boolean)[0] || "home";
}

/** The workspace a page belongs to. Shared pages (Clients, Settings and so on) belong to none: they keep whichever
 *  workspace you were in. With `three` false (the older two-way switch) Advisory's pages count as Work. */
export function modeOfSection(section: string, three = true): Mode | undefined {
  if (section === "clients" || section === "groups") return undefined;
  for (const m of MODES) if (WORKSPACES[m].homeSection === section) return !three && m === "advisory" ? "work" : m;
  const a = areaOf(section);
  if (a === "run") return "practice";
  if (a === "deliver") return "work";
  if (a === "grow") return three ? "advisory" : "work";
  return undefined;
}

/** What is remembered about how one person moves around the app. Saved against their account. */
export interface NavPrefs {
  v: 1;
  menuStyle: MenuKind;
  lastMode: Mode;
  lastPracticeWorkMode: "practice" | "work";
  lastVisited: Partial<Record<Mode, string>>;
  /** When this was last changed (ISO): the later save wins between devices. */
  updated: string;
}
export const defaultPrefs = (now = ""): NavPrefs => ({ v: 1, menuStyle: DEFAULT_MENU, lastMode: "practice", lastPracticeWorkMode: "practice", lastVisited: {}, updated: now });

/** The Settings key holding one account's preferences. The id is the Microsoft 365 account id, never the display name. */
export const prefsKey = (userId: string) => `navPrefs:${userId}`;

/** Reads saved preferences, putting right anything missing or not understood. Undefined when there is nothing usable. */
export function readPrefs(raw: unknown): NavPrefs | undefined {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return undefined; } }
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (!isMenuKind(o.menuStyle)) return undefined;
  const visited: Partial<Record<Mode, string>> = {};
  const lv = (o.lastVisited && typeof o.lastVisited === "object" ? o.lastVisited : {}) as Record<string, unknown>;
  for (const m of MODES) if (typeof lv[m] === "string" && String(lv[m]).startsWith("#/")) visited[m] = String(lv[m]);
  return {
    v: 1, menuStyle: o.menuStyle, lastMode: isMode(o.lastMode) ? o.lastMode : "practice",
    lastPracticeWorkMode: o.lastPracticeWorkMode === "work" ? "work" : "practice", lastVisited: visited, updated: typeof o.updated === "string" ? o.updated : "",
  };
}

/** What this browser remembered before preferences were kept against the account. */
export interface LegacyNav { menu?: string | null; mode?: string | null; lastPractice?: string | null; lastWork?: string | null }

/** First preferences for an account, from what the browser remembered. No saved style, or the older two-way switch,
 *  becomes the new default; any other style the person chose is kept. */
export function migrateLegacy(l: LegacyNav, now: string): NavPrefs {
  const p = defaultPrefs(now);
  if (isMenuKind(l.menu) && l.menu !== "toggle") p.menuStyle = l.menu;
  if (l.mode === "work") { p.lastMode = "work"; p.lastPracticeWorkMode = "work"; }
  const ok = (h: unknown, m: Mode) => typeof h === "string" && h.startsWith("#/") && modeOfSection(sectionOfHash(h)) === m;
  if (ok(l.lastPractice, "practice")) p.lastVisited.practice = String(l.lastPractice);
  if (ok(l.lastWork, "work")) p.lastVisited.work = String(l.lastWork);
  return p;
}

/** The workspace showing on a page: the page's own, or on a shared page the one you were last in. */
export function effectiveMode(p: NavPrefs, section: string, three = true): Mode {
  const own = modeOfSection(section, three);
  if (own) return own;
  return !three && p.lastMode === "advisory" ? p.lastPracticeWorkMode : p.lastMode;
}

/** Notes a page visit. Returns the same object when nothing changed, so nothing is saved for it. */
export function noteVisit(p: NavPrefs, section: string, hash: string, now: string): NavPrefs {
  const m = modeOfSection(section);
  if (!m) return p;
  const at = hash && hash.startsWith("#") ? hash : WORKSPACES[m].home;
  const pw = m === "advisory" ? p.lastPracticeWorkMode : m;
  if (p.lastMode === m && p.lastPracticeWorkMode === pw && p.lastVisited[m] === at) return p;
  return { ...p, lastMode: m, lastPracticeWorkMode: pw, lastVisited: { ...p.lastVisited, [m]: at }, updated: now };
}

/** Where switching to a workspace goes: the last page you were on there if it still belongs to it, otherwise its landing page. */
export function landing(p: NavPrefs, mode: Mode, three = true): string {
  const last = p.lastVisited[mode];
  if (last && modeOfSection(sectionOfHash(last), three) === mode) return last;
  // with the older two-way switch, Work also remembers a page in Advisory's modules
  if (!three && mode === "work") { const adv = p.lastVisited.advisory; if (adv && p.lastMode === "advisory") return adv; }
  return WORKSPACES[mode].home;
}

/** Where the Practice/Work control goes when you are in Advisory: back to whichever of the two you were last in. */
export const backFromAdvisory = (p: NavPrefs): "practice" | "work" => p.lastPracticeWorkMode;

/** Between two saved copies, the one to keep: the later change wins; a tie keeps the account's copy. */
export function newerPrefs(account: NavPrefs, local: NavPrefs): NavPrefs {
  return local.updated > account.updated ? local : account;
}
