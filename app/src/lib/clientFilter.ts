// Filtering the client list, saved views, and what can be done with the result (export, email list, add to a
// group, set importance, a task for each). Pure logic: the screen passes in what it has and gets back what to show
// or what to save.
import { Client, KIND_LABEL, amlLabel, contactName, importanceOf, loeLabel } from "./domain";
import { CustomDef, CustomTest, Values, hasTest, matchCustom } from "./customFields";
import { Row } from "./schema";

export type Criteria = {
  search: string;
  kind: "all" | "companies" | "individuals";
  attention: boolean;
  group: string;
  /** Service keys, and whether the client must have any of them, all of them, or none of them. */
  services: string[];
  serviceMode: "any" | "all" | "none";
  feeMin: number | null;
  feeMax: number | null;
  /** Clients with no annual fee recorded. */
  feeNone: boolean;
  importance: "" | "key" | "normal" | "low";
  vat: "" | "yes" | "no";
  /** Year end month, "01" to "12". */
  yearEnd: string;
  aml: "" | "attention" | "ok";
  loe: "" | "signed" | "missing";
  work: "" | "overdue" | "open" | "none";
  /** Tests on the practice's own client fields. */
  custom: CustomTest[];
};

export const NO_FILTERS: Criteria = {
  search: "", kind: "all", attention: false, group: "", services: [], serviceMode: "any", feeMin: null, feeMax: null, feeNone: false,
  importance: "", vat: "", yearEnd: "", aml: "", loe: "", work: "", custom: [],
};

/** What the screen knows about one client. `services` are the work the client currently has (not stopped). */
export type FilterRow = { client: Client; groups: string[]; services: string[]; attention: boolean; open: number; overdue: number; /** values of the practice's own fields */ custom?: Values };

const isCompany = (c: Client) => c.Kind === "Ltd" || c.Kind === "LLP";

export function matchRow(f: Criteria, r: FilterRow, defs: CustomDef[] = []): boolean {
  const c = r.client;
  if (f.custom.length && !matchCustom(defs, f.custom, r.custom || {})) return false;
  if (f.kind === "companies" && !isCompany(c)) return false;
  if (f.kind === "individuals" && isCompany(c)) return false;
  if (f.attention && !r.attention) return false;
  if (f.group && !r.groups.includes(f.group)) return false;
  if (f.services.length) {
    const has = (k: string) => r.services.includes(k);
    if (f.serviceMode === "any" && !f.services.some(has)) return false;
    if (f.serviceMode === "all" && !f.services.every(has)) return false;
    if (f.serviceMode === "none" && f.services.some(has)) return false;
  }
  const fee = Number(c.AnnualFees) || 0;
  if (f.feeNone && fee > 0) return false;
  if (!f.feeNone) {
    if (f.feeMin !== null && fee < f.feeMin) return false;
    if (f.feeMax !== null && fee > f.feeMax) return false;
  }
  if (f.importance && importanceOf(c) !== f.importance) return false;
  const vat = String(c.VATRegistered || "").trim() !== "";
  if (f.vat === "yes" && !vat) return false;
  if (f.vat === "no" && vat) return false;
  if (f.yearEnd && String(c.YearEnd || "").slice(0, 2) !== f.yearEnd) return false;
  if (f.aml === "attention" && !amlLabel(c.XamaStatus).warn) return false;
  if (f.aml === "ok" && amlLabel(c.XamaStatus).warn) return false;
  if (f.loe === "signed" && loeLabel(c.LoEStatus).warn) return false;
  if (f.loe === "missing" && !loeLabel(c.LoEStatus).warn) return false;
  if (f.work === "overdue" && r.overdue === 0) return false;
  if (f.work === "open" && r.open === 0) return false;
  if (f.work === "none" && r.open > 0) return false;
  const q = f.search.trim().toLowerCase();
  if (q && ![c.Title, c.TradingName, c.CompanyNumber, contactName(c), c.Email].join(" ").toLowerCase().includes(q)) return false;
  return true;
}

/** How many filters are switched on, not counting the search box and the client type buttons (which are always in view). */
export function activeFilters(f: Criteria): number {
  return [
    f.attention, !!f.group, f.services.length > 0, f.feeMin !== null || f.feeMax !== null || f.feeNone, !!f.importance, !!f.vat, !!f.yearEnd, !!f.aml, !!f.loe, !!f.work, f.custom.some(hasTest),
  ].filter(Boolean).length;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

const readTests = (raw: unknown): CustomTest[] => (Array.isArray(raw) ? raw : []).filter((t): t is Record<string, unknown> => !!t && typeof t === "object" && typeof (t as Record<string, unknown>).key === "string").map((t) => ({
  key: String(t.key), min: num(t.min), max: num(t.max), is: typeof t.is === "string" ? t.is : "", from: typeof t.from === "string" ? t.from : "", to: typeof t.to === "string" ? t.to : "",
})).slice(0, 20);

/** Reads saved criteria (older or damaged ones too) into a complete set. */
export function readCriteria(raw: unknown): Criteria {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    search: typeof o.search === "string" ? o.search : "",
    kind: pick(o.kind, ["all", "companies", "individuals"] as const, "all"),
    attention: o.attention === true,
    group: typeof o.group === "string" ? o.group : "",
    services: Array.isArray(o.services) ? o.services.filter((s): s is string => typeof s === "string") : [],
    serviceMode: pick(o.serviceMode, ["any", "all", "none"] as const, "any"),
    feeMin: num(o.feeMin),
    feeMax: num(o.feeMax),
    feeNone: o.feeNone === true,
    importance: pick(o.importance, ["", "key", "normal", "low"] as const, ""),
    vat: pick(o.vat, ["", "yes", "no"] as const, ""),
    yearEnd: typeof o.yearEnd === "string" && /^(0[1-9]|1[0-2])$/.test(o.yearEnd) ? o.yearEnd : "",
    aml: pick(o.aml, ["", "attention", "ok"] as const, ""),
    loe: pick(o.loe, ["", "signed", "missing"] as const, ""),
    work: pick(o.work, ["", "overdue", "open", "none"] as const, ""),
    custom: readTests(o.custom),
  };
}

export type View = { name: string; criteria: Criteria };
export const VIEWS_KEY = "clients.views";

export function readViews(raw: unknown): View[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && typeof (v as Record<string, unknown>).name === "string" && !!String((v as Record<string, unknown>).name).trim())
    .map((v) => ({ name: String(v.name).trim(), criteria: readCriteria(v.criteria) }));
}

/** Saving under a name that exists replaces that view. Names are compared without regard to case. */
export function withView(views: View[], name: string, criteria: Criteria): View[] {
  const n = name.trim();
  if (!n) return views;
  const rest = views.filter((v) => v.name.toLowerCase() !== n.toLowerCase());
  return [...rest, { name: n, criteria }].sort((a, b) => a.name.localeCompare(b.name));
}
export const withoutView = (views: View[], name: string): View[] => views.filter((v) => v.name !== name);

// ---- what to do with the result ----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const yearEndText = (ye?: string): string => {
  const m = /^(\d\d)-(\d\d)$/.exec(String(ye || ""));
  return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1] || ""}`.trim() : "";
};

export type ExportRow = FilterRow & { groupNames: string[]; serviceNames: string[]; nextJob?: string; nextDeadline?: string };
/** The practice's own client fields, as extra columns on the export. */
const withCustom = (table: string[][], rows: ExportRow[], defs: CustomDef[]): string[][] => {
  const mine = defs.filter((d) => d.appliesTo === "client");
  if (!mine.length) return table;
  return table.map((row, i) => [...row, ...(i === 0 ? mine.map((d) => d.label) : mine.map((d) => { const v = String(rows[i - 1].custom?.[d.key] ?? ""); return d.type === "yesno" ? (v === "yes" ? "Yes" : v === "no" ? "No" : "") : v; }))]);
};

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** A cell that opens as text in a spreadsheet, whatever it says (a leading = + - or @ would otherwise run as a formula). */
const cell = (v: string | number): string => {
  const s = String(v ?? "");
  return q(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
};

export const EXPORT_COLUMNS = ["Client", "Type", "Company number", "Year end", "Email", "Mobile", "Groups", "Services", "Annual fees", "Importance", "VAT registered", "AML", "Engagement letter", "Open jobs", "Overdue jobs", "Next job", "Next deadline"];

export function exportTable(rows: ExportRow[], defs: CustomDef[] = []): string[][] {
  return withCustom([
    EXPORT_COLUMNS,
    ...rows.map((r) => {
      const c = r.client;
      return [
        String(c.Title || ""), KIND_LABEL[String(c.Kind || "")] || String(c.Kind || ""), String(c.CompanyNumber || ""), yearEndText(c.YearEnd), String(c.Email || ""), String(c.Mobile || ""),
        r.groupNames.join("; "), r.serviceNames.join("; "), Number(c.AnnualFees) ? String(Number(c.AnnualFees)) : "", importanceOf(c), String(c.VATRegistered || "").trim() ? "Yes" : "No",
        amlLabel(c.XamaStatus).text, loeLabel(c.LoEStatus).text, String(r.open), String(r.overdue), r.nextJob || "", r.nextDeadline || "",
      ];
    }),
  ], rows, defs);
}
export const toCsv = (table: string[][]): string => table.map((row) => row.map(cell).join(",")).join("\r\n");

/** Email addresses of the clients, once each (without regard to case), and how many clients have none. */
export function mailList(rows: { client: Client }[]): { emails: string[]; missing: number } {
  const seen = new Set<string>();
  const emails: string[] = [];
  let missing = 0;
  for (const { client: c } of rows) {
    const e = String(c.Email || "").trim();
    if (!e) { missing++; continue; }
    if (seen.has(e.toLowerCase())) continue;
    seen.add(e.toLowerCase());
    emails.push(e);
  }
  return { emails, missing };
}

const memberKind = (c: Client): string => (c.Kind === "Ltd" ? "Company" : c.Kind === "LLP" ? "LLP" : "Individual");

/** New group member rows for clients who are not in the group yet, and how many already were. */
export function membersToAdd(clients: Client[], groupKey: string, members: Row[], newKey: (p: string) => string): { rows: Row[]; already: number } {
  const have = new Set(members.filter((m) => m.GroupKey === groupKey).map((m) => String(m.MemberKey)));
  const rows: Row[] = [];
  let already = 0;
  for (const c of clients) {
    if (have.has(c.Key)) { already++; continue; }
    have.add(c.Key);
    rows.push({ Key: newKey("GM"), GroupKey: groupKey, MemberKey: c.Key, Kind: memberKind(c), Role: "" });
  }
  return { rows, already };
}

export type TaskDraft = { title: string; type: string; dueDate: string; hours: number | null };

/** One open task per client. Clients who already have an open task with the same name are skipped, so pressing the button twice does nothing the second time. */
export function tasksToCreate(clients: Client[], d: TaskDraft, existing: Row[], newKey: (p: string) => string): { rows: Row[]; skipped: number; problem?: string } {
  const title = d.title.trim();
  if (!title) return { rows: [], skipped: 0, problem: "Give the task a name." };
  const open = new Set(existing.filter((t) => t.Status !== "Done" && t.Status !== "Cancelled" && String(t.Title || "").trim().toLowerCase() === title.toLowerCase()).map((t) => String(t.ClientKey)));
  const rows: Row[] = [];
  let skipped = 0;
  for (const c of clients) {
    if (open.has(c.Key)) { skipped++; continue; }
    rows.push({ Key: newKey("T"), Title: title, ClientKey: c.Key, Type: d.type, Status: "Open", ...(d.dueDate ? { DueDate: d.dueDate } : {}), ...(d.hours ? { EstimateHours: d.hours } : {}) });
  }
  return { rows, skipped };
}
