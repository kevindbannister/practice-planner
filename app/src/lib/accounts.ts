// Statutory accounts, made from a company's working papers. Pure logic: the setup kept for a company and year, the
// statements worked out from the final trial balance (income statement, balance sheet, detailed profit and loss), the
// notes and policies, the checks before the accounts go to the client, and the pages of the PDF as a DocContent.
// docPdf.ts draws it. Wording is standard UK small-company wording as a starting point: the accountant checks it
// against the facts and the standard before relying on it. Nothing here files anything anywhere.
import { Block, Cell, DocContent, Run } from "./docModel";
import { AssetTotals } from "./papers";
import { AccountsFigures, ChartRow, DESTS, DEST_BY_KEY, Mapping, irisRangeDest } from "./tbMap";

export const ACCOUNTS_SETUP_ITEM = "_acc";

export const ACCOUNT_TYPES = ["small", "micro", "dormant", "llp"] as const;
export type AccountsType = (typeof ACCOUNT_TYPES)[number];
export const TYPE_NAMES: Record<AccountsType, string> = {
  small: "Small company (FRS 102 Section 1A)", micro: "Micro-entity (FRS 105)", dormant: "Dormant company", llp: "Limited liability partnership (small LLP)",
};
const STANDARD: Record<AccountsType, string> = { small: "FRS 102 Section 1A", micro: "FRS 105", dormant: "FRS 102 Section 1A", llp: "FRS 102 Section 1A" };

export type Director = { name: string; role: string; appointed: string; resigned: string };
export const INCLUDE_KEYS = [
  { key: "contents", label: "Table of contents" }, { key: "info", label: "Company information" }, { key: "report", label: "Directors' (or members') report" },
  { key: "accountants", label: "Accountants' report" }, { key: "income", label: "Income statement" }, { key: "balance", label: "Statement of financial position" },
  { key: "notes", label: "Notes to the accounts" }, { key: "detailed", label: "Detailed profit and loss account" },
] as const;
export type IncludeKey = (typeof INCLUDE_KEYS)[number]["key"];
export type Piece = { on?: boolean; text?: string };

export type AccSetup = {
  type: AccountsType;
  abridged: boolean;
  cover: boolean;
  include: Record<IncludeKey, boolean>;
  comparatives: boolean;
  draft: boolean;
  auditExempt: boolean;
  activity: string;
  signer: string;
  approved: string; // date the board approved
  registeredOffice: string;
  accountant: string; // firm shown on the company information page
  secretary: string;
  directors: Director[];
  employees: { now: string; before: string };
  shares: { count: string; class: string; nominal: string };
  policies: Record<string, Piece>;
  notes: Record<string, Piece>;
  exported: string; // date marked as put into IRIS Elements for comparison
};

export const typeDefaults = (type: AccountsType): Pick<AccSetup, "include" | "abridged"> => ({
  abridged: type === "micro" || type === "dormant",
  include: {
    contents: true, info: true, report: true, accountants: false, income: type !== "dormant", balance: true, notes: true, detailed: type === "small" || type === "llp",
  },
});
export const emptySetup = (type: AccountsType = "small"): AccSetup => ({
  type, ...typeDefaults(type), cover: true, comparatives: true, draft: true, auditExempt: true, activity: "", signer: "", approved: "", registeredOffice: "", accountant: "", secretary: "",
  directors: [], employees: { now: "", before: "" }, shares: { count: "", class: "ordinary", nominal: "1" }, policies: {}, notes: {}, exported: "",
});

const s = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");
const iso = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
const pieces = (v: unknown): Record<string, Piece> => {
  const out: Record<string, Piece> = {};
  if (v && typeof v === "object") for (const [k, p] of Object.entries(v as Record<string, unknown>).slice(0, 80)) {
    const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    out[k.slice(0, 40)] = { ...(typeof o.on === "boolean" ? { on: o.on } : {}), ...(typeof o.text === "string" ? { text: o.text.slice(0, 6000) } : {}) };
  }
  return out;
};
/** The setup read from what was saved: anything missing or wrong falls back to the default for the type. */
export function readAccSetup(raw: Record<string, unknown> | undefined, fallbackType: AccountsType = "small"): AccSetup {
  const o = raw || {};
  const type = ACCOUNT_TYPES.includes(o.type as AccountsType) ? (o.type as AccountsType) : fallbackType;
  const d = emptySetup(type);
  const inc = (o.include && typeof o.include === "object" ? o.include : {}) as Record<string, unknown>;
  const include = { ...d.include };
  for (const k of INCLUDE_KEYS) if (typeof inc[k.key] === "boolean") include[k.key] = inc[k.key] as boolean;
  const dirs = Array.isArray(o.directors) ? o.directors.slice(0, 40).map((x) => {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    return { name: s(r.name, 120), role: s(r.role, 60), appointed: iso(r.appointed), resigned: iso(r.resigned) };
  }).filter((x) => x.name) : d.directors;
  const em = (o.employees && typeof o.employees === "object" ? o.employees : {}) as Record<string, unknown>;
  const sh = (o.shares && typeof o.shares === "object" ? o.shares : {}) as Record<string, unknown>;
  return {
    type, abridged: typeof o.abridged === "boolean" ? o.abridged : d.abridged, cover: typeof o.cover === "boolean" ? o.cover : d.cover, include,
    comparatives: typeof o.comparatives === "boolean" ? o.comparatives : d.comparatives, draft: typeof o.draft === "boolean" ? o.draft : d.draft,
    auditExempt: typeof o.auditExempt === "boolean" ? o.auditExempt : d.auditExempt, activity: s(o.activity, 600), signer: s(o.signer, 120), approved: iso(o.approved),
    registeredOffice: s(o.registeredOffice, 400), accountant: s(o.accountant, 400), secretary: s(o.secretary, 120), directors: dirs,
    employees: { now: s(em.now, 10), before: s(em.before, 10) }, shares: { count: s(sh.count, 14) || d.shares.count, class: s(sh.class, 60) || d.shares.class, nominal: s(sh.nominal, 10) || d.shares.nominal },
    policies: pieces(o.policies), notes: pieces(o.notes), exported: iso(o.exported),
  };
}
/** The saved setup after changing the type: the contents choices follow the new type, everything the person typed stays. */
export const withType = (a: AccSetup, type: AccountsType): AccSetup => ({ ...a, type, ...typeDefaults(type) });

// ------------------------------------------------------------------ figures

const r0 = (n: number) => Math.round(n);
export function fmt(n: number | undefined): string {
  if (n === undefined) return "";
  const v = Math.abs(r0(n));
  if (!v) return "-";
  const t = v.toLocaleString("en-GB");
  return n < 0 ? `(${t})` : t;
}
const longDate = (d: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
export const dateLong = longDate;
const yearOf = (d: string) => (d ? d.slice(0, 4) : "");

export type StRow = { label: string; note?: string; /** the working paper section the figures come from */ section?: string; now?: number; prior?: number; kind?: "head" | "line" | "sub" | "total" | "gap" };

type F = AccountsFigures;
const R = (f: F | undefined, pick: (f: F) => number) => (f ? r0(pick(f)) : undefined);
/** One statement row from a figure in each year; the totals are added up from the rounded lines so the page casts. */
function row(label: string, now: F, prior: F | undefined, pick: (f: F) => number, kind: StRow["kind"] = "line", note?: string, section?: string): StRow {
  return { label, note, section, kind, now: r0(pick(now)), prior: R(prior, pick) };
}
const zeroBoth = (r: StRow) => !r.now && !r.prior;

export function incomeStatement(f: F, prior: F | undefined, type: AccountsType): StRow[] {
  if (type === "dormant") return [];
  const out: StRow[] = [];
  const keep = (r: StRow) => { if (!zeroBoth(r)) out.push(r); };
  const tn = r0(f.turnover), tp = prior ? r0(prior.turnover) : undefined;
  const cn = r0(f.costOfSales), cp = prior ? r0(prior.costOfSales) : undefined;
  const en = r0(f.expenses), ep = prior ? r0(prior.expenses) : undefined;
  const on = r0(f.otherIncome), op = prior ? r0(prior.otherIncome) : undefined;
  const xn = r0(f.tax), xp = prior ? r0(prior.tax) : undefined;
  const sum = (...v: (number | undefined)[]) => v.reduce<number>((a, b) => a + (b ?? 0), 0);
  const has = prior !== undefined;
  out.push({ label: "Turnover", now: tn, prior: tp, kind: "line", section: "income" });
  if (type === "micro") {
    keep({ label: "Other income", now: on, prior: op, section: "income" });
    keep({ label: "Cost of sales and other expenses", now: -sum(cn, en), prior: has ? -sum(cp, ep) : undefined, section: "expenditure" });
    out.push({ label: "Profit before taxation", now: sum(tn, on, -cn, -en), prior: has ? sum(tp, op, -cp, -ep) : undefined, kind: "sub" });
  } else {
    if (cn || cp) {
      out.push({ label: "Cost of sales", now: -cn, prior: has ? -(cp as number) : undefined, section: "expenditure" });
      out.push({ label: "Gross profit", now: tn - cn, prior: has ? (tp as number) - (cp as number) : undefined, kind: "sub" });
    }
    keep({ label: "Administrative expenses", now: -en, prior: has ? -(ep as number) : undefined, section: "expenditure" });
    keep({ label: "Other operating income", now: on, prior: op, section: "income" });
    out.push({ label: type === "llp" ? "Profit for the financial year before taxation" : "Profit before taxation", now: sum(tn, -cn, -en, on), prior: has ? sum(tp, -cp, -ep, op) : undefined, kind: "sub" });
  }
  const pbtN = sum(tn, -cn, -en, on), pbtP = has ? sum(tp, -cp, -ep, op) : undefined;
  if (xn || xp || type !== "llp") out.push({ label: "Tax on profit", now: -xn, prior: has ? -(xp as number) : undefined, section: "taxation" });
  out.push({
    label: type === "llp" ? "Profit for the financial year before members' remuneration and profit shares" : "Profit for the financial year",
    now: pbtN - xn, prior: has ? (pbtP as number) - (xp as number) : undefined, kind: "total",
  });
  return out;
}

export type NoteRefs = Partial<Record<"tangible" | "investments" | "stock" | "debtors" | "creditors" | "creditorsAfter" | "provisions" | "shares", string>>;

export function balanceSheet(f: F, prior: F | undefined, type: AccountsType, refs: NoteRefs = {}): StRow[] {
  const out: StRow[] = [];
  const has = prior !== undefined;
  const ln = (label: string, pick: (f: F) => number, note?: string, always = false, section?: string) => { const r = row(label, f, prior, pick, "line", note, section); if (always || !zeroBoth(r)) out.push(r); };
  const tot = (label: string, now: number, before: number | undefined, kind: StRow["kind"]) => out.push({ label, now, prior: has ? before : undefined, kind });
  const v = (pick: (g: F) => number) => r0(pick(f)), p = (pick: (g: F) => number) => (prior ? r0(pick(prior)) : 0);
  const sum2 = (picks: ((g: F) => number)[], g: "now" | "prior") => picks.reduce((a, k) => a + (g === "now" ? v(k) : p(k)), 0);

  out.push({ label: "Fixed assets", kind: "head" });
  ln("Tangible assets", (g) => g.fixed, refs.tangible, false, "fixed");
  ln("Investments", (g) => g.investments, refs.investments, false, "investments");
  const fa = [(g: F) => g.fixed, (g: F) => g.investments];
  tot("", sum2(fa, "now"), sum2(fa, "prior"), "sub");
  out.push({ label: "Current assets", kind: "head" });
  ln("Stocks", (g) => g.stock, refs.stock, false, "stock");
  ln("Debtors", (g) => g.debtors, refs.debtors, false, "debtors");
  ln("Cash at bank and in hand", (g) => g.bank, undefined, false, "bank");
  const ca = [(g: F) => g.stock, (g: F) => g.debtors, (g: F) => g.bank];
  tot("", sum2(ca, "now"), sum2(ca, "prior"), "sub");
  out.push({ label: "Creditors: amounts falling due within one year", now: -v((g) => g.creditorsWithin), prior: has ? -p((g) => g.creditorsWithin) : undefined, note: refs.creditors, kind: "line", section: "creditors" });
  const ncN = sum2(ca, "now") - v((g) => g.creditorsWithin), ncP = sum2(ca, "prior") - p((g) => g.creditorsWithin);
  tot("Net current assets", ncN, ncP, "sub");
  const talN = sum2(fa, "now") + ncN, talP = sum2(fa, "prior") + ncP;
  tot("Total assets less current liabilities", talN, talP, "sub");
  if (v((g) => g.creditorsAfter) || p((g) => g.creditorsAfter)) out.push({ label: "Creditors: amounts falling due after more than one year", now: -v((g) => g.creditorsAfter), prior: has ? -p((g) => g.creditorsAfter) : undefined, note: refs.creditorsAfter, kind: "line", section: "creditors" });
  if (v((g) => g.provisions) || p((g) => g.provisions)) out.push({ label: "Provisions for liabilities", now: -v((g) => g.provisions), prior: has ? -p((g) => g.provisions) : undefined, note: refs.provisions, kind: "line", section: "provisions" });
  const naN = talN - v((g) => g.creditorsAfter) - v((g) => g.provisions), naP = talP - p((g) => g.creditorsAfter) - p((g) => g.provisions);
  tot(type === "llp" ? "Net assets attributable to members" : "Net assets", naN, naP, "total");
  out.push({ label: "", kind: "gap" });
  if (type === "llp") {
    out.push({ label: "Represented by:", kind: "head" });
    ln("Loans and other debts due to members", (g) => g.capitalAccounts, undefined, false, "capital");
    out.push({ label: "Members' other interests", kind: "head" });
    ln("Members' capital", (g) => g.shares, refs.shares, false, "capital");
    ln("Other reserves", (g) => g.reservesCf, undefined, false, "capital");
    const tot2 = (g: "now" | "prior") => sum2([(x) => x.capitalAccounts, (x) => x.shares, (x) => x.reservesCf], g);
    tot("Total members' interests", tot2("now"), tot2("prior"), "total");
  } else {
    out.push({ label: "Capital and reserves", kind: "head" });
    ln("Called up share capital", (g) => g.shares, refs.shares, false, "capital");
    ln("Profit and loss account", (g) => g.reservesCf, undefined, true, "capital");
    ln("Other reserves", (g) => g.capitalAccounts, undefined, false, "capital");
    const tot2 = (g: "now" | "prior") => sum2([(x) => x.shares, (x) => x.reservesCf, (x) => x.capitalAccounts], g);
    tot("Shareholders' funds", tot2("now"), tot2("prior"), "total");
  }
  return out;
}

/** The profit and loss detail by account from the mapped final trial balance, grouped as the destinations are. */
export type DetailItem = { label: string; amount: number; iris: string; code: string };
export type DetailGroup = { key: string; title: string; section: string; items: DetailItem[]; total: number };
/** How the detailed profit and loss is ordered (set in Settings › Detailed P&L): the headings, and the accounts under each. */
export type DetailOrder = { groups?: string[]; items?: "name" | "iris" | "code"; /** every IRIS code in the order the user dragged them to (a line not in it goes after, in the `items` order) */ lines?: string[] };

/** Every heading the detailed profit and loss can have, in the order they show until the user changes it. */
export const DETAIL_HEADINGS: { key: string; title: string; bucket: string }[] = DESTS
  .filter((d) => ["income", "expenditure", "taxation"].includes(d.section) && d.key !== "ignore")
  .map((d) => ({ key: d.key, title: d.label.split("›").pop()?.trim() || d.label, bucket: d.section === "income" ? (["income/sales", "income/fees", "income/reimbursed"].includes(d.key) ? "income" : "other") : d.section === "taxation" ? "tax" : d.key === "expenditure/cos" ? "costs" : "expenses" }));

/** The saved heading order with any heading it doesn't mention (a new one) added at the end in the default order. */
export function headingOrder(saved?: string[]): string[] {
  const all = DETAIL_HEADINGS.map((h) => h.key);
  const known = (saved || []).filter((k) => all.includes(k));
  return [...known, ...all.filter((k) => !known.includes(k))];
}

/** Compares two lines by the order dragged in Settings, then (for lines not in it) by name, IRIS code or code as chosen. */
export function itemCmp(order?: DetailOrder) {
  const idx = new Map((order?.lines || []).map((c, i) => [c, i]));
  const how = order?.items || "name";
  return (a: { iris: string; label: string; code?: string }, b: { iris: string; label: string; code?: string }): number => {
    const ia = a.iris ? idx.get(a.iris) : undefined, ib = b.iris ? idx.get(b.iris) : undefined;
    if (ia !== undefined && ib !== undefined) return ia - ib;
    if (ia !== undefined) return -1;
    if (ib !== undefined) return 1;
    if (how === "iris" || how === "code") return byCodeThenName(a.iris || "\uffff", b.iris || "\uffff") || a.label.localeCompare(b.label);
    return a.label.localeCompare(b.label);
  };
}

/** Every profit and loss line on the IRIS chart with the heading it belongs under, in the order the report shows them. */
export function detailLines(chart: ChartRow[], order?: DetailOrder): { code: string; name: string; heading: string }[] {
  const keys = new Set(DETAIL_HEADINGS.map((h) => h.key));
  const out: { code: string; name: string; heading: string }[] = [];
  for (const c of chart) {
    const heading = c.dest || irisRangeDest(c.code, c.name, 0);
    if (heading && keys.has(heading) && !out.some((x) => x.code === c.code)) out.push({ code: c.code, name: c.name, heading });
  }
  const cmp = itemCmp(order);
  return out.sort((a, b) => cmp({ iris: a.code, label: a.name }, { iris: b.code, label: b.name }));
}

const byCodeThenName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function detailGroups(maps: Mapping[], order?: DetailOrder): { income: DetailGroup[]; costs: DetailGroup[]; expenses: DetailGroup[]; other: DetailGroup[]; tax: DetailGroup[] } {
  const by = new Map<string, DetailGroup>();
  const out = { income: [] as DetailGroup[], costs: [] as DetailGroup[], expenses: [] as DetailGroup[], other: [] as DetailGroup[], tax: [] as DetailGroup[] };
  for (const m of maps) {
    const d = DEST_BY_KEY.get(m.dest);
    if (!d || !m.balance || !["income", "expenditure", "taxation"].includes(d.section)) continue;
    const credit = d.section === "income";
    const amount = Math.round((credit ? -m.balance : m.balance) * 100) / 100;
    const bucket = d.section === "income" ? (["income/sales", "income/fees", "income/reimbursed"].includes(d.key) ? "income" : "other") : d.section === "taxation" ? "tax" : d.key === "expenditure/cos" ? "costs" : "expenses";
    const id = `${bucket}|${d.key}`;
    let g = by.get(id);
    if (!g) { g = { key: d.key, title: d.label.split("›").pop()?.trim() || d.label, section: d.section, items: [], total: 0 }; by.set(id, g); out[bucket].push(g); }
    // the detailed profit and loss is by IRIS line, not by the software's accounts: accounts on the same IRIS code are added together
    const label = m.iris ? (m.irisName || m.iris) : `${m.acct.account || m.acct.code} (no IRIS code)`;
    const same = m.iris ? g.items.find((x) => x.iris === m.iris) : undefined;
    if (same) same.amount = Math.round((same.amount + amount) * 100) / 100;
    else g.items.push({ label, amount, iris: m.iris || "", code: m.iris || "" });
    g.total = Math.round((g.total + amount) * 100) / 100;
  }
  const rank = new Map(headingOrder(order?.groups).map((k, i) => [k, i]));
  const cmp = itemCmp(order);
  for (const k of Object.keys(out) as (keyof typeof out)[]) {
    out[k].sort((a, b) => (rank.get(a.key) ?? 999) - (rank.get(b.key) ?? 999));
    for (const g of out[k]) g.items.sort(cmp);
  }
  return out;
}

// ------------------------------------------------------------------ policies and notes

export type PolicyDef = { key: string; title: string; text: (t: AccountsType) => string; on: boolean; types?: AccountsType[] };
export const POLICIES: PolicyDef[] = [
  {
    key: "basis", title: "Basis of preparation", on: true,
    text: (t) => t === "micro"
      ? "These financial statements have been prepared in accordance with FRS 105 The Financial Reporting Standard applicable to the Micro-entities Regime and the Companies Act 2006. The financial statements have been prepared under the historical cost convention. The financial statements are prepared in sterling, which is the functional currency of the company."
      : t === "llp"
        ? "These financial statements have been prepared in accordance with FRS 102 Section 1A Small Entities, the Statement of Recommended Practice Accounting by Limited Liability Partnerships and the Companies Act 2006 as applied to limited liability partnerships. The financial statements have been prepared under the historical cost convention. The financial statements are prepared in sterling, which is the functional currency of the LLP."
        : "These financial statements have been prepared in accordance with FRS 102 Section 1A Small Entities and the Companies Act 2006. The financial statements have been prepared under the historical cost convention. The financial statements are prepared in sterling, which is the functional currency of the company.",
  },
  { key: "goingconcern", title: "Going concern", on: false, text: () => "The financial statements have been prepared on a going concern basis. The directors have a reasonable expectation that the company has adequate resources to continue in operational existence for the foreseeable future." },
  { key: "turnover", title: "Turnover", on: true, types: ["small", "micro", "llp"], text: () => "Turnover is measured at the fair value of the consideration received or receivable for goods supplied and services provided, net of VAT and trade discounts. Revenue from the sale of goods is recognised when the goods are delivered. Revenue from services is recognised as the services are performed." },
  { key: "tangible", title: "Tangible fixed assets and depreciation", on: true, types: ["small", "micro", "llp"], text: () => "Tangible fixed assets are stated at cost less accumulated depreciation and impairment. Depreciation is provided at rates calculated to write off the cost, less estimated residual value, of each asset over its expected useful life as follows:\nPlant and machinery: 25% reducing balance\nFixtures and fittings: 25% reducing balance\nMotor vehicles: 25% reducing balance\nComputer equipment: 33% straight line" },
  { key: "stocks", title: "Stocks", on: false, types: ["small", "micro", "llp"], text: () => "Stocks are valued at the lower of cost and estimated selling price less costs to complete and sell." },
  { key: "debtors", title: "Debtors", on: false, types: ["small", "llp"], text: () => "Short term debtors are measured at transaction price, less any impairment." },
  { key: "creditors", title: "Creditors", on: false, types: ["small", "llp"], text: () => "Short term creditors are measured at the transaction price." },
  { key: "tax", title: "Taxation", on: true, types: ["small", "micro"], text: () => "Tax is recognised in the income statement, except that a charge attributable to an item of income and expense recognised as other comprehensive income or to an item recognised directly in equity is also recognised in other comprehensive income or directly in equity respectively. The current income tax charge is calculated on the basis of tax rates and laws that have been enacted or substantively enacted by the reporting date." },
  { key: "pensions", title: "Pensions", on: false, types: ["small", "micro", "llp"], text: () => "The company operates a defined contribution pension scheme. Contributions are charged to the income statement in the period in which they become payable." },
  { key: "dormant", title: "Dormant company", on: true, types: ["dormant"], text: () => "The company was dormant throughout the year: it had no significant accounting transactions. No income statement is prepared." },
];
export const policiesFor = (a: AccSetup) => POLICIES.filter((p) => !p.types || p.types.includes(a.type));
export function policyList(a: AccSetup): { key: string; title: string; text: string; on: boolean }[] {
  return policiesFor(a).map((p) => ({ key: p.key, title: p.title, on: a.policies[p.key]?.on ?? p.on, text: a.policies[p.key]?.text ?? p.text(a.type) }));
}

export type NoteDef = { key: string; title: string; on: boolean; auto?: boolean; types?: AccountsType[]; check?: boolean; text: string };
const FREE = (key: string, title: string, text: string, types?: AccountsType[]): NoteDef => ({ key, title, on: false, text, types, check: true });
export const NOTES: NoteDef[] = [
  { key: "info", title: "General information", on: true, auto: true, text: "" },
  { key: "policies", title: "Accounting policies", on: true, auto: true, text: "" },
  { key: "employees", title: "Employees", on: true, auto: true, types: ["small", "micro", "llp"], text: "" },
  { key: "tangible", title: "Tangible fixed assets", on: true, auto: true, types: ["small", "micro", "llp"], text: "" },
  { key: "debtors", title: "Debtors", on: true, auto: true, types: ["small", "llp"], text: "" },
  { key: "creditors", title: "Creditors: amounts falling due within one year", on: true, auto: true, types: ["small", "llp"], text: "" },
  { key: "creditorsAfter", title: "Creditors: amounts falling due after more than one year", on: true, auto: true, types: ["small", "llp"], text: "" },
  { key: "shares", title: "Share capital", on: true, auto: true, types: ["small", "micro", "dormant"], text: "" },
  FREE("intangibles", "Intangible assets", "Intangible assets are stated at cost less accumulated amortisation.", ["small", "llp"]),
  FREE("investments", "Fixed asset investments", "Fixed asset investments are stated at cost less any provision for impairment.", ["small", "llp"]),
  FREE("stock", "Stocks", "Stocks are stated at the lower of cost and net realisable value.", ["small", "llp"]),
  FREE("deferredtax", "Deferred tax", "The deferred tax provision is made up of accelerated capital allowances.", ["small"]),
  FREE("provisions", "Provisions for liabilities", "", ["small", "llp"]),
  FREE("loans", "Advances and credits to directors", "During the year the directors took advances from the company. The balance on the directors' loan accounts at the year end is shown below.", ["small", "micro", "dormant"]),
  FREE("commitments", "Capital commitments", "", ["small", "llp"]),
  FREE("leases", "Operating lease commitments", "", ["small", "llp"]),
  FREE("contingent", "Contingent liabilities", "", ["small", "llp"]),
  FREE("guarantees", "Guarantees and other financial commitments", "", ["small", "micro", "llp"]),
  FREE("related", "Related party transactions", "", ["small", "llp"]),
  FREE("controlling", "Ultimate controlling party", "The company is controlled by its directors.", ["small", "micro", "dormant", "llp"]),
  FREE("events", "Events after the reporting date", "", ["small", "micro", "llp"]),
];
export const notesFor = (a: AccSetup) => NOTES.filter((n) => !n.types || n.types.includes(a.type));
const isOn = (a: AccSetup, n: NoteDef) => a.notes[n.key]?.on ?? n.on;

export type Note = { key: string; no: number; title: string; blocks: Block[] };

// ------------------------------------------------------------------ document blocks

const run = (t: string, o: Partial<Run> = {}): Run => ({ t, ...o });
const P = (t: string, o: Partial<Run> = {}, align?: "left" | "center" | "right" | "justify"): Block => ({ type: "p", runs: [run(t, o)], align });
const H = (t: string, level: 1 | 2 | 3 = 1): Block => ({ type: "h", level, runs: [run(t)], align: level === 1 ? "center" : undefined });
const multi = (t: string): Block[] => t.split(/\n+/).map((x) => x.trim()).filter(Boolean).map((x) => P(x, {}, "justify"));
const cellT = (t: string, o: Partial<Run> = {}, align?: Cell["align"], rule?: Cell["rule"]): Cell => ({ runs: [run(t, o)], align, rule });

/** A statement as a plain table: description, note, this year and last year. */
export function statementTable(rows: StRow[], cols: { now: string; prior?: string }, hasNotes: boolean, link?: (section: string) => string | undefined): Block {
  const comp = cols.prior !== undefined;
  const head: Cell[] = [cellT(""), ...(hasNotes ? [cellT("Notes", { b: true }, "center")] : []), cellT(cols.now, { b: true }, "right"), ...(comp ? [cellT(cols.prior as string, { b: true }, "right")] : [])];
  const body = rows.map((r): Cell[] => {
    if (r.kind === "gap") return [cellT(" "), ...(hasNotes ? [cellT("")] : []), cellT(""), ...(comp ? [cellT("")] : [])];
    const bold = r.kind === "head" || r.kind === "total";
    const rule = r.kind === "total" ? "double" : r.kind === "sub" ? "top" : undefined;
    const url = r.section && link ? link(r.section) : undefined;
    const fig = (n: number | undefined): Cell => { const c = cellT(fmt(n), { b: bold, ...(url ? { color: "#1a4f8b" } : {}) }, "right", rule); if (url) c.link = url; return c; };
    const figs = r.kind === "head" ? [cellT(""), ...(comp ? [cellT("")] : [])] : [fig(r.now), ...(comp ? [fig(r.prior)] : [])];
    return [cellT(r.label, { b: bold }), ...(hasNotes ? [cellT(r.note || "", {}, "center")] : []), ...figs];
  });
  const widths = hasNotes ? (comp ? [54, 8, 19, 19] : [62, 8, 30]) : comp ? [60, 20, 20] : [70, 30];
  return { type: "table", header: false, plain: true, widths, rows: [head, ...body] };
}

export type Facts = {
  name: string; number: string; start: string; end: string; priorEnd: string;
  firm: string; firmAddress: string; kind: string;
};
export type AccountsInput = {
  facts: Facts; setup: AccSetup; figures: AccountsFigures; prior?: AccountsFigures; maps?: Mapping[]; priorMaps?: Mapping[]; assets?: AssetTotals; priorAssets?: AssetTotals; /** how the detailed profit and loss is ordered */ detailOrder?: DetailOrder;
  /** the web address of a working paper section (the figures in the PDF link to it) */ link?: (section: string) => string | undefined;
};
export type Section = { key: string; title: string; blocks: Block[] };

const periodName = (f: Facts) => `${longDate(f.end)}`;
const yearHead = (f: Facts) => `for the year ended ${longDate(f.end)}`;
const compOn = (i: AccountsInput) => i.setup.comparatives && !!i.prior;
const names = (a: AccSetup) => a.directors.map((d) => d.name);
const kindWord = (a: AccSetup) => (a.type === "llp" ? "member" : "director");

function directorsServed(a: AccSetup, start: string, end: string): Director[] {
  return a.directors.filter((d) => (!d.appointed || d.appointed <= end) && (!d.resigned || d.resigned >= start));
}
const dirLine = (d: Director) => `${d.name}${d.appointed ? ` (appointed ${longDate(d.appointed)})` : ""}${d.resigned ? ` (resigned ${longDate(d.resigned)})` : ""}`;

function refsFor(i: AccountsInput): NoteRefs {
  const notes = noteList(i), no = (k: string) => String(notes.find((n) => n.key === k)?.no || "") || undefined;
  return { tangible: no("tangible"), debtors: no("debtors"), creditors: no("creditors"), creditorsAfter: no("creditorsAfter"), shares: no("shares") };
}

/** The notes that are switched on, numbered in order. Their content is built when the notes section is. */
export function noteList(i: AccountsInput): Note[] {
  const a = i.setup, f = i.figures, p = i.prior;
  const on = notesFor(a).filter((n) => isOn(a, n)).filter((n) => {
    if (n.key === "tangible") return !!f.fixed || !!p?.fixed;
    if (n.key === "debtors") return !!f.debtors || !!p?.debtors;
    if (n.key === "creditors") return !!f.creditorsWithin || !!p?.creditorsWithin;
    if (n.key === "creditorsAfter") return !!f.creditorsAfter || !!p?.creditorsAfter;
    if (n.key === "shares") return !!f.shares || !!p?.shares || !!a.shares.count;
    if (n.key === "policies") return policyList(a).some((x) => x.on);
    return true;
  });
  return on.map((n, k) => ({ key: n.key, no: k + 1, title: n.title, blocks: [] }));
}

function noteBlocks(n: Note, i: AccountsInput): Block[] {
  const a = i.setup, f = i.figures, p = i.prior, comp = compOn(i), F = i.facts;
  const yr = { now: yearOf(F.end), prior: comp ? yearOf(F.priorEnd) : undefined };
  const yrHead = { now: `${yr.now}`, prior: yr.prior };
  const custom = a.notes[n.key]?.text;
  const def = NOTES.find((x) => x.key === n.key) as NoteDef;
  const free = custom ?? def.text;
  const out: Block[] = [];
  switch (n.key) {
    case "info":
      out.push(...multi(custom ?? `${F.name} is a ${F.kind === "LLP" ? "limited liability partnership" : "private company limited by shares"} incorporated in England and Wales (registered number ${F.number}). The address of its registered office is ${(a.registeredOffice || "").replace(/\s*\n\s*/g, ", ") || "[registered office]"}.`));
      break;
    case "policies":
      for (const x of policyList(a).filter((y) => y.on)) { out.push(P(x.title, { b: true })); out.push(...multi(x.text)); }
      break;
    case "employees": {
      const nowN = a.employees.now.trim(), before = a.employees.before.trim();
      out.push(...multi(custom ?? `The average number of persons employed by the ${F.kind === "LLP" ? "LLP" : "company"} (including ${kindWord(a)}s) during the year was ${nowN || "[number]"} (${yearOf(F.priorEnd)} - ${before || "[number]"}).`));
      break;
    }
    case "tangible": {
      const t = i.assets;
      if (t) {
        const rows: Cell[][] = [[cellT("", {}), cellT("Total", { b: true }, "right")]];
        const add = (l: string, v: number, b = false, rule?: Cell["rule"]) => rows.push([cellT(l, { b }), cellT(fmt(v), { b }, "right", rule)]);
        out.push(P("Cost", { b: true }));
        add("At start of year", t.costBf); add("Additions", t.add); if (t.disp) add("Disposals", -t.disp); add("At end of year", t.costCf, true, "top");
        out.push(P("Depreciation", { b: true }));
        add("At start of year", t.depBf); add("Charge for the year", t.charge); if (t.depDisp) add("On disposals", -t.depDisp); add("At end of year", t.depCf, true, "top");
        out.push(P("Net book value", { b: true }));
        add(`At ${longDate(F.end)}`, t.nbvCf, true, "double"); if (t.nbvBf || (p && p.fixed)) add(`At ${longDate(F.priorEnd)}`, t.nbvBf, true);
        out.push({ type: "table", header: false, plain: true, widths: [70, 30], rows: rows.slice(1) });
      } else out.push(statementTable([{ label: "Net book value", now: f.fixed, prior: p?.fixed, kind: "total", section: "fixed" }], yrHead, false, i.link));
      if (custom) out.push(...multi(custom));
      break;
    }
    case "debtors":
      out.push(statementTable([{ label: "Total debtors", now: f.debtors, prior: comp ? p?.debtors : undefined, kind: "total", section: "debtors" }], yrHead, false, i.link));
      if (custom) out.push(...multi(custom));
      break;
    case "creditors":
      out.push(statementTable([{ label: "Total creditors falling due within one year", now: f.creditorsWithin, prior: comp ? p?.creditorsWithin : undefined, kind: "total", section: "creditors" }], yrHead, false, i.link));
      if (custom) out.push(...multi(custom));
      break;
    case "creditorsAfter":
      out.push(statementTable([{ label: "Total creditors falling due after more than one year", now: f.creditorsAfter, prior: comp ? p?.creditorsAfter : undefined, kind: "total", section: "creditors" }], yrHead, false, i.link));
      if (custom) out.push(...multi(custom));
      break;
    case "shares": {
      const cnt = Number(a.shares.count.replace(/,/g, ""));
      const nominal = a.shares.nominal.trim() || "1";
      out.push(...multi(custom ?? (cnt > 0
        ? `Allotted, called up and fully paid: ${cnt.toLocaleString("en-GB")} ${a.shares.class} shares of £${nominal} each, £${fmt(f.shares)}.`
        : `Called up share capital: £${fmt(f.shares)}.`)));
      break;
    }
    default:
      out.push(...multi(free || "[Add the details for this note]"));
  }
  return out;
}

const heading = (title: string, F: Facts, sub?: string): Block[] => [H(title), P(sub ?? yearHead(F), { b: true }, "center")];

/** Every page of the accounts, as sections (each starts on a new page). The contents page is added by assemble(). */
export function buildSections(i: AccountsInput): Section[] {
  const a = i.setup, F = i.facts, f = i.figures;
  const comp = compOn(i), year = { now: yearOf(F.end) || "£", prior: comp ? yearOf(F.priorEnd) : undefined };
  const money = (c: string) => `${c} £`;
  const cols = { now: money(year.now || ""), prior: comp ? money(year.prior || "") : undefined };
  const out: Section[] = [];
  const notes = noteList(i), refs = refsFor(i);
  const unaudited = a.auditExempt ? "UNAUDITED " : "";
  const dirs = directorsServed(a, F.start, F.end);
  const dirsWord = a.type === "llp" ? "members" : "directors";
  const company = a.type === "llp" ? "LLP" : "company";

  if (a.include.info) {
    const rows: Cell[][] = [];
    const add = (l: string, v: string | string[]) => { for (const [k, x] of (Array.isArray(v) ? v : [v]).entries()) rows.push([cellT(k ? "" : l, { b: true }), cellT(x, {}, "left")]); };
    add("Registered number", F.number || "[number]");
    add(a.type === "llp" ? "Members" : "Directors", dirs.length ? dirs.map((d) => d.name) : ["[add the " + dirsWord + "]"]);
    if (a.secretary) add("Company secretary", a.secretary);
    add("Registered office", (a.registeredOffice || "[registered office]").split(/\r?\n/).map((x) => x.trim()).filter(Boolean));
    if (a.accountant || F.firm) add("Accountants", [F.firm, ...(a.accountant || F.firmAddress).split(/\r?\n/).map((x) => x.trim()).filter(Boolean)].filter(Boolean));
    out.push({ key: "info", title: "Company information", blocks: [...heading("Company information", F, ""), { type: "table", header: false, plain: true, widths: [28, 72], rows }] });
  }

  if (a.include.report) {
    const b: Block[] = [...heading(a.type === "llp" ? "Members' report" : "Directors' report", F)];
    b.push(...multi(`The ${dirsWord} present their report together with the ${a.type === "dormant" ? "dormant " : ""}financial statements of ${F.name} for the year ended ${longDate(F.end)}.`));
    b.push(H("Principal activity", 3));
    b.push(...multi(a.type === "dormant" ? `The ${company} was dormant throughout the year.` : a.activity || "[Describe the principal activity of the company]"));
    b.push(H(a.type === "llp" ? "Members" : "Directors", 3));
    b.push(...multi(`The ${dirsWord} who held office during the year were:`));
    b.push({ type: "list", ordered: false, items: (dirs.length ? dirs.map(dirLine) : ["[add the " + dirsWord + "]"]).map((x) => [run(x)]) });
    b.push(H(`Statement of ${dirsWord}' responsibilities`, 3));
    b.push(...multi(`The ${dirsWord} are responsible for preparing the financial statements in accordance with applicable law and regulations. ${a.type === "llp" ? "Limited liability partnership law" : "Company law"} requires the ${dirsWord} to prepare financial statements for each financial year. Under that law the ${dirsWord} have elected to prepare the financial statements in accordance with United Kingdom Generally Accepted Accounting Practice (United Kingdom Accounting Standards, comprising ${STANDARD[a.type]}). Under ${a.type === "llp" ? "that law" : "company law"} the ${dirsWord} must not approve the financial statements unless they are satisfied that they give a true and fair view of the state of affairs of the ${company} and of the profit or loss of the ${company} for that period.`));
    b.push(...multi(`In preparing these financial statements, the ${dirsWord} are required to:`));
    b.push({ type: "list", ordered: false, items: ["select suitable accounting policies and then apply them consistently;", "make judgements and accounting estimates that are reasonable and prudent;", `prepare the financial statements on the going concern basis unless it is inappropriate to presume that the ${company} will continue in business.`].map((x) => [run(x)]) });
    b.push(...multi(`The ${dirsWord} are responsible for keeping adequate accounting records that are sufficient to show and explain the ${company}'s transactions and disclose with reasonable accuracy at any time the financial position of the ${company} and enable them to ensure that the financial statements comply with the applicable legislation. They are also responsible for safeguarding the assets of the ${company} and hence for taking reasonable steps for the prevention and detection of fraud and other irregularities.`));
    b.push(H("Small companies exemption", 3));
    b.push(...multi(a.type === "micro" ? "This report has been prepared in accordance with the provisions applicable to companies entitled to the small companies exemption and the micro-entities regime." : "This report has been prepared in accordance with the provisions applicable to companies entitled to the small companies exemption."));
    b.push(...multi(`This report was approved by the board on ${longDate(a.approved) || "[date approved]"} and signed on its behalf by:`));
    b.push(P(" "), P(a.signer || "[Name of signing " + kindWord(a) + "]", { b: true }), P(a.type === "llp" ? "Designated member" : "Director"));
    out.push({ key: "report", title: a.type === "llp" ? "Members' report" : "Directors' report", blocks: b });
  }

  if (a.include.accountants) {
    const b: Block[] = [...heading(`Accountants' report to the ${dirsWord} of ${F.name}`, F, "on the preparation of the unaudited statutory financial statements")];
    b.push(...multi(`In order to assist you to fulfil your duties under the Companies Act 2006, we have prepared for your approval the financial statements of ${F.name} for the year ended ${longDate(F.end)} which comprise the Income Statement, the Statement of Financial Position and the related notes from the ${company}'s accounting records and from information and explanations you have given us.`));
    b.push(...multi(`This report is made solely to the ${dirsWord} of ${F.name}, as a body, in accordance with the terms of our engagement. Our work has been undertaken solely to prepare for your approval the financial statements of the ${company} and state those matters that we have agreed to state to the ${dirsWord} of the ${company}, as a body, in this report in accordance with the requirements of our professional body. To the fullest extent permitted by law, we do not accept or assume responsibility to anyone other than the ${company} and its ${dirsWord}, as a body, for our work or for this report.`));
    b.push(...multi(`It is your duty to ensure that the ${company} has kept adequate accounting records and to prepare statutory financial statements that give a true and fair view of the assets, liabilities, financial position and profit of the ${company}. You consider that the ${company} is exempt from the statutory requirement for an audit for this year. We have not been instructed to carry out an audit or a review of the financial statements. For this reason, we have not verified the accuracy or completeness of the accounting records or information and explanations you have given to us and we do not, therefore, express any opinion on the financial statements.`));
    b.push(P(" "), P(F.firm || "[Accountants]", { b: true }), ...(F.firmAddress ? multi(F.firmAddress) : []), P(longDate(a.approved) || "[date]"));
    out.push({ key: "accountants", title: "Accountants' report", blocks: b });
  }

  if (a.include.income && a.type !== "dormant") {
    const rows = incomeStatement(f, comp ? i.prior : undefined, a.type);
    out.push({ key: "income", title: "Income statement", blocks: [...heading("Income statement", F), statementTable(rows, cols, false, i.link)] });
  }

  if (a.include.balance) {
    const rows = balanceSheet(f, comp ? i.prior : undefined, a.type, refs);
    const hasNotes = rows.some((r) => r.note);
    const b: Block[] = [...heading(a.type === "micro" ? "Balance sheet" : "Statement of financial position", F, `as at ${longDate(F.end)}`), statementTable(rows, cols, hasNotes, i.link), P(" ")];
    b.push(...multi(a.auditExempt
      ? a.type === "dormant"
        ? `For the year ended ${longDate(F.end)} the ${company} was entitled to exemption from audit under section 480 of the Companies Act 2006 relating to dormant companies. The members have not required the ${company} to obtain an audit of its financial statements for the year in question in accordance with section 476. The ${dirsWord} acknowledge their responsibilities for complying with the requirements of the Act with respect to accounting records and the preparation of financial statements.`
        : `For the year ended ${longDate(F.end)} the ${company} was entitled to exemption from audit under section 477 of the Companies Act 2006 relating to small companies. The members have not required the ${company} to obtain an audit of its financial statements for the year in question in accordance with section 476. The ${dirsWord} acknowledge their responsibilities for complying with the requirements of the Act with respect to accounting records and the preparation of financial statements.`
      : "[This company is not audit exempt: the audit report is not produced here]"));
    b.push(...multi(a.type === "micro" ? "These financial statements have been prepared in accordance with the micro-entity provisions and in accordance with FRS 105 The Financial Reporting Standard applicable to the Micro-entities Regime." : `These financial statements have been prepared in accordance with the provisions applicable to ${a.type === "llp" ? "limited liability partnerships subject to the small LLP regime" : "companies subject to the small companies regime"} and in accordance with ${STANDARD[a.type]}.`));
    b.push(...multi(`The financial statements were approved by the ${a.type === "llp" ? "members" : "board of directors"} and authorised for issue on ${longDate(a.approved) || "[date approved]"} and are signed on ${a.type === "llp" ? "their" : "its"} behalf by:`));
    b.push(P(" "), P(a.signer || "[Name of signing " + kindWord(a) + "]", { b: true }), P(a.type === "llp" ? "Designated member" : "Director"), P(`Registered number: ${F.number}`));
    out.push({ key: "balance", title: a.type === "micro" ? "Balance sheet" : "Statement of financial position", blocks: b });
  }

  if (a.include.notes && notes.length) {
    const b: Block[] = [...heading("Notes to the financial statements", F)];
    for (const n of notes) { b.push(H(`${n.no}. ${n.title}`, 3)); b.push(...noteBlocks(n, i)); }
    out.push({ key: "notes", title: "Notes to the financial statements", blocks: b });
  }

  if (a.include.detailed && a.type !== "dormant" && i.maps) {
    const g = detailGroups(i.maps, i.detailOrder), pg = i.priorMaps ? detailGroups(i.priorMaps, i.detailOrder) : undefined;
    const rows: StRow[] = [];
    const priorFor = (list: DetailGroup[] | undefined, title: string, item?: string) => (!comp || !list ? undefined : item === undefined ? list.find((x) => x.title === title)?.total ?? 0 : list.find((x) => x.title === title)?.items.find((y) => y.label === item)?.amount ?? 0);
    const block = (title: string, list: DetailGroup[], plist: DetailGroup[] | undefined, withItems: boolean) => {
      for (const grp of list) {
        if (withItems) rows.push({ label: grp.title, kind: "head" });
        for (const it of grp.items) rows.push({ label: it.label, now: it.amount, prior: priorFor(plist, grp.title, it.label), kind: "line", section: grp.section });
      }
      return title;
    };
    const sales = g.income.reduce((n, x) => n + x.total, 0), salesP = comp && pg ? pg.income.reduce((n, x) => n + x.total, 0) : undefined;
    rows.push({ label: "Turnover", now: sales, prior: salesP, kind: "total", section: "income" });
    const cos = g.costs.reduce((n, x) => n + x.total, 0), cosP = comp && pg ? pg.costs.reduce((n, x) => n + x.total, 0) : undefined;
    if (cos || cosP) {
      rows.push({ label: "Cost of sales", kind: "head" });
      block("", g.costs, pg?.costs, false);
      rows.push({ label: "Gross profit", now: sales - cos, prior: salesP !== undefined ? salesP - (cosP || 0) : undefined, kind: "sub" });
    }
    const ex = g.expenses.reduce((n, x) => n + x.total, 0), exP = comp && pg ? pg.expenses.reduce((n, x) => n + x.total, 0) : undefined;
    rows.push({ label: "Administrative expenses", kind: "head" });
    block("", g.expenses, pg?.expenses, false);
    rows.push({ label: "Total administrative expenses", now: ex, prior: exP, kind: "sub" });
    const oi = g.other.reduce((n, x) => n + x.total, 0), oiP = comp && pg ? pg.other.reduce((n, x) => n + x.total, 0) : undefined;
    if (oi || oiP) { rows.push({ label: "Other income", kind: "head" }); block("", g.other, pg?.other, false); }
    const pbt = sales - cos - ex + oi, pbtP = salesP !== undefined ? salesP - (cosP || 0) - (exP || 0) + (oiP || 0) : undefined;
    rows.push({ label: "Profit before taxation", now: pbt, prior: pbtP, kind: "sub" });
    const tx = g.tax.reduce((n, x) => n + x.total, 0), txP = comp && pg ? pg.tax.reduce((n, x) => n + x.total, 0) : undefined;
    if (tx || txP) rows.push({ label: "Tax on profit", now: -tx, prior: txP !== undefined ? -txP : undefined, kind: "line" });
    rows.push({ label: "Profit for the financial year", now: pbt - tx, prior: pbtP !== undefined ? pbtP - (txP || 0) : undefined, kind: "total" });
    out.push({
      key: "detailed", title: "Detailed profit and loss account",
      blocks: [...heading("Detailed profit and loss account", F), P("This page does not form part of the statutory financial statements.", { i: true }, "center"), statementTable(rows, cols, false, i.link)],
    });
  }
  return out;
}

export type ContentsLine = { title: string; page?: number };
/** The sections in order, with a contents page first when switched on. `starts` is the page each section starts on (index 0 is the contents page, or the first section when there is no contents). */
export function assemble(sections: Section[], includeContents: boolean, F: Facts, starts?: number[], coverOffset = 0): { content: DocContent; titles: string[] } {
  const parts: { title: string; blocks: Block[] }[] = [];
  if (includeContents) {
    const lines: ContentsLine[] = sections.map((s, k) => ({ title: s.title, page: starts ? starts[k + 1] + coverOffset : undefined }));
    const rows: Cell[][] = lines.map((l) => [cellT(l.title), cellT(l.page ? String(l.page) : "", {}, "right")]);
    parts.push({
      title: "Contents",
      blocks: [H("Contents"), ...(rows.length ? [{ type: "table", header: false, plain: true, widths: [85, 15], rows } as Block] : [])],
    });
  }
  parts.push(...sections);
  const blocks: Block[] = [];
  parts.forEach((p, k) => { if (k) blocks.push({ type: "break" }); blocks.push(...p.blocks); });
  void F;
  return { content: { blocks }, titles: parts.map((p) => p.title) };
}

// ------------------------------------------------------------------ Check & File

export type Check = { level: "error" | "warn" | "ok"; text: string };
export function checkAccounts(i: AccountsInput & { problems?: string[]; draftOk?: boolean }): Check[] {
  const a = i.setup, F = i.facts, f = i.figures, out: Check[] = [];
  const add = (level: Check["level"], text: string) => out.push({ level, text });
  if (!i.maps) add("error", "There is no trial balance for this year yet, so there are no figures to put in the accounts.");
  else {
    if (Math.abs(f.difference) > 1) add("error", `The balance sheet does not balance: net assets are £${fmt(f.netAssets)} but capital and reserves are £${fmt(f.capitalAndReserves)} (a difference of £${fmt(f.difference)}).`);
    else add("ok", "Net assets agree to capital and reserves.");
    if (Math.abs(f.leftOut) > 1) add("warn", `£${fmt(f.leftOut)} of the trial balance is placed nowhere in the accounts (accounts marked "Leave out" or without a place).`);
  }
  for (const p of i.problems || []) add("error", p);
  if (!F.number) add("error", "The company number is missing."); else add("ok", "Company number present.");
  if (!F.start || !F.end || F.start > F.end) add("error", "The accounting period dates are not valid.");
  const dirs = directorsServed(a, F.start, F.end);
  if (!dirs.length) add("error", `No ${a.type === "llp" ? "members" : "directors"} are listed for the year.`); else add("ok", `${dirs.length} ${a.type === "llp" ? "member" : "director"}${dirs.length > 1 ? "s" : ""} listed.`);
  if (!a.registeredOffice.trim()) add("error", "The registered office address is missing.");
  if (a.include.report && a.type !== "dormant" && !a.activity.trim()) add("warn", "The principal activity is not filled in.");
  if (!a.signer.trim()) add("error", "Choose the director who signs the accounts.");
  else if (!dirs.some((d) => d.name === a.signer)) add("warn", "The signing person is not one of the people listed for the year.");
  if (!a.approved) add("warn", "No date of approval yet. The date is needed before the accounts are signed and filed.");
  else if (a.approved < F.end) add("error", "The approval date is before the end of the accounting period.");
  if (a.draft) add("warn", "The DRAFT watermark is on. Turn it off for the final PDF.");
  if (a.type === "dormant" && (Math.abs(f.turnover) > 0.5 || Math.abs(f.expenses) > 0.5 || Math.abs(f.costOfSales) > 0.5)) add("error", "This is set up as a dormant company but the trial balance has income or expenses in the year.");
  if (a.type === "micro" && !a.auditExempt) add("warn", "Micro-entities are normally audit exempt. Check that this is intended.");
  if (a.type === "micro" && (Math.abs(f.turnover) > 1_000_000)) add("warn", "Turnover is over £1m, above the micro-entity limit (check the size tests for two years running).");
  if (a.type === "small" && Math.abs(f.turnover) > 15_000_000) add("warn", "Turnover is over £15m, above the small company limit (check the size tests for two years running).");
  if (a.type !== "dormant" && a.type !== "micro" && !a.employees.now.trim() && a.include.notes) add("warn", "The average number of employees is not filled in (note Employees).");
  if (a.comparatives && !i.prior) add("warn", "Comparatives are on but there is no trial balance for the previous year, so the last-year column is left out.");
  for (const n of notesFor(a)) if (n.check && isOn(a, n) && a.notes[n.key]?.text === undefined) add("warn", `The note "${n.title}" is on but still has its starting wording. Check it is right for this company.`);
  if (out.every((c) => c.level !== "error")) add("ok", "No errors found. Compare the PDF with Elements before relying on it.");
  return out;
}
export const hasErrors = (c: Check[]) => c.some((x) => x.level === "error");
