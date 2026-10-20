// Working papers, built from Kevin's Excel working paper. A company's paper for a year end is a
// list of sections (Information, Budget, Disclosure checklist, the accounts and tax drafts, queries,
// the lead schedules, VAT, wages, control accounts, trial balance, journals...). Sections can be
// turned off for a company (and stay off the next year). Each section is made of schedules of a
// few kinds: a list of lines, an asset register with depreciation, an account with a balance
// brought and carried forward, a VAT return summary, a payroll analysis, an expense with accruals,
// a trial balance, journals, opening balances, the final trial balance (worked out), a checklist,
// questions with answers, a budget, the job details, or a pasted report. Lead schedules add their
// schedules up, with last year beside them. Every section has a Prepared / Reviewed sign-off.
import { Row } from "./schema";

export type PaperStatus = "todo" | "doing" | "done" | "na";
export const STATUS_LABEL: Record<PaperStatus, string> = { todo: "Not started", doing: "In progress", done: "Done", na: "Not needed" };

export type Kind =
  | "list" | "register" | "account" | "vat" | "payroll" | "expense" | "tb" | "journals" | "opening" | "finaltb"
  | "checklist" | "questions" | "budget" | "info" | "report" | "queries";

export type Sub = {
  key: string; title: string; kind: Kind;
  after?: boolean; // due after more than one year (creditors)
  normal?: "dr" | "cr"; // which side an account's balance normally sits (liabilities: cr)
  split?: boolean; // an account whose balance is split between within and after one year (HP, loans)
  custom?: boolean; // added for this company
};
/** lead: a lead schedule adding up its schedules. assets: the fixed asset summary (cost, depreciation, NBV by class). */
export type Section = { key: string; title: string; group: string; summary?: "lead" | "assets"; subs: Sub[]; offByDefault?: boolean; canAdd?: boolean };

const sub = (key: string, title: string, kind: Kind = "list", more: Partial<Sub> = {}): Sub => ({ key, title, kind, ...more });
const sec = (key: string, title: string, group: string, subs: Sub[], more: Partial<Section> = {}): Section => ({ key, title, group, subs, ...more });
const lead = (key: string, title: string, group: string, subs: Sub[], more: Partial<Section> = {}) => sec(key, title, group, subs, { summary: "lead", canAdd: true, ...more });

export const SECTIONS: Section[] = [
  sec("info", "Job information", "Job", [sub("main", "Job information", "info")]),
  sec("kyc", "Know your client", "Job", [sub("main", "Know your client", "questions")]),
  sec("budget", "Budget", "Job", [sub("main", "Budget", "budget")]),
  sec("disclosure", "Disclosure checklist", "Job", [sub("main", "Disclosure checklist", "checklist")]),
  sec("draft-accounts", "Draft accounts", "Accounts and tax", []),
  sec("review-accounts", "Post review accounts", "Accounts and tax", []),
  sec("final-accounts", "Final accounts", "Accounts and tax", []),
  sec("draft-tax", "Draft tax computation", "Accounts and tax", []),
  sec("review-tax", "Post review tax computation", "Accounts and tax", []),
  sec("final-tax", "Final tax computation", "Accounts and tax", []),
  sec("queries", "Queries for principal", "Notes", [sub("main", "Queries", "queries")]),
  sec("review-notes", "Review notes", "Notes", [sub("main", "Review notes", "queries")]),
  sec("client-notes", "Client notes", "Notes", []),
  sec("goodwill", "Goodwill and intangibles", "Balance sheet", [sub("goodwill", "Goodwill", "register"), sub("intangible", "Intangible assets", "register")], { summary: "assets", offByDefault: true }),
  sec("fixed", "Fixed assets", "Balance sheet", [
    sub("freehold", "Freehold property", "register"), sub("motor", "Motor vehicles", "register"), sub("fixtures", "Fixtures and fittings", "register"),
    sub("plant", "Plant and machinery", "register"), sub("computer", "Computer equipment", "register"), sub("additions", "This year's additions"),
  ], { summary: "assets" }),
  lead("investments", "Investments", "Balance sheet", [sub("main", "Investments")], { offByDefault: true }),
  lead("stock", "Stock and work in progress", "Balance sheet", [sub("stock", "Stock"), sub("wip", "Work in progress")], { offByDefault: true }),
  lead("debtors", "Debtors and prepayments", "Balance sheet", [
    sub("trade", "Trade debtors"), sub("prepayments", "Prepayments"), sub("accrued", "Accrued income"), sub("other", "Other debtors"),
    sub("aged", "Aged debtors report", "report"),
  ]),
  lead("bank", "Bank balances and cash", "Balance sheet", [
    sub("current", "Current account"), sub("deposit", "Deposit account"), sub("eur", "EUR account"), sub("usd", "USD account"), sub("cash", "Cash in hand"),
  ]),
  lead("creditors", "Creditors and accruals", "Balance sheet", [
    sub("trade", "Trade creditors"), sub("accruals", "Accruals"), sub("dla", "Directors' current account", "account", { normal: "cr" }),
    sub("ssot", "Social security and other taxes"), sub("tax", "Taxation"), sub("other", "Other creditors"),
    sub("hp", "Hire purchase", "account", { normal: "cr", split: true }), sub("loan", "Bank loan", "account", { normal: "cr", split: true }),
    sub("aged", "Aged creditors report", "report"),
  ]),
  lead("loans", "Long term loans", "Balance sheet", [sub("main", "Long term loans", "list", { after: true })], { offByDefault: true }),
  lead("capital", "Capital and reserves", "Balance sheet", [sub("shares", "Share capital"), sub("reserves", "Reserves"), sub("accounts", "Capital accounts", "account", { normal: "cr" })]),
  sec("statutory", "Statutory lead schedule", "Balance sheet", [sub("main", "Companies House details and filing history", "report")]),
  lead("income", "Income", "Profit and loss", [sub("sales", "Sales"), sub("interest", "Interest received"), sub("other", "Other income")]),
  lead("expenditure", "Expenditure", "Profit and loss", [sub("cos", "Cost of sales"), sub("tb", "Expenses per trial balance"), sub("accountancy", "Accountancy", "expense")]),
  sec("vat", "VAT", "Other schedules", [sub("control", "VAT control account", "account", { normal: "cr" }), sub("returns", "VAT return summary", "vat")]),
  sec("workings", "Accounts working papers", "Other schedules", [sub("receipts", "Receipts"), sub("payments", "Payments"), sub("sundry", "Sundry")], { offByDefault: true, canAdd: true }),
  sec("wages", "Wages and PAYE", "Other schedules", [
    sub("control", "Wages control account", "account", { normal: "cr" }), sub("directors", "Directors' remuneration", "payroll"), sub("records", "Wages records", "payroll"),
  ], { offByDefault: true }),
  sec("creditors-ca", "Creditors control account", "Other schedules", [sub("main", "Creditors control account", "account", { normal: "cr" })], { offByDefault: true }),
  sec("debtors-ca", "Debtors control account", "Other schedules", [sub("main", "Debtors control account", "account", { normal: "dr" })], { offByDefault: true }),
  sec("tb", "Year end trial balance", "Trial balance", [sub("main", "Trial balance from the software", "tb")]),
  sec("journals", "Journals", "Trial balance", [sub("main", "Journals", "journals"), sub("review", "Review journals", "journals"), sub("final", "Final journals", "journals")]),
  sec("opening", "Opening balances", "Trial balance", [sub("main", "Opening balances", "opening")], { offByDefault: true }),
  sec("final-tb", "Final trial balance", "Trial balance", [sub("main", "Final trial balance", "finaltb")]),
];

export const GROUPS = [...new Set(SECTIONS.map((x) => x.group))];
export const KIND_NAMES: Partial<Record<Kind, string>> = { list: "List of lines", account: "Account (b/f, entries, c/f)", expense: "Expense with accruals", register: "Asset register", report: "Pasted report", payroll: "Payroll analysis" };

// ------------------------------------------------------------------ setup kept per company and year
// The section row (WorkingPapers, ItemKey = section key) holds status, notes and sign-off. Settings
// for a schedule (depreciation method, balance b/f, fee...) are on a row with ItemKey "section/sub";
// the sections turned off are on the row "_sections". Settings are JSON in the Setup column.

export type Setup = Record<string, unknown>;
export const setupKey = (sectionKey: string, subKey?: string) => (subKey ? `${sectionKey}/${subKey}` : sectionKey);

export function setupRow(rows: Row[], clientKey: string, period: string, itemKey: string): Row | undefined {
  return rows.find((r) => r.ClientKey === clientKey && r.PeriodEnd === period && r.ItemKey === itemKey);
}
export function readSetup(row?: Row): Setup {
  if (!row?.Setup) return {};
  try {
    const v = JSON.parse(String(row.Setup));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
export const setupOf = (rows: Row[], clientKey: string, period: string, itemKey: string) => readSetup(setupRow(rows, clientKey, period, itemKey));
const num = (v: unknown): number | undefined => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? undefined : Number(v));
const n0 = (v: unknown) => num(v) ?? 0;

/** The sections turned off for this company: this year's choice, else last year's, else the usual ones. */
export function sectionsOff(rows: Row[], clientKey: string, period: string): Set<string> {
  for (let p = period, i = 0; i < 4; i++, p = priorPeriod(p)) {
    const row = setupRow(rows, clientKey, p, "_sections");
    if (row) return new Set((readSetup(row).off as string[]) || []);
  }
  return new Set(SECTIONS.filter((x) => x.offByDefault).map((x) => x.key));
}

/** Schedules added for this company (e.g. more expense headings), carried from year to year. */
export function subsFor(section: Section, rows: Row[], clientKey: string, period: string): Sub[] {
  let extra: Sub[] = [];
  for (let p = period, i = 0; i < 4; i++, p = priorPeriod(p)) {
    const row = setupRow(rows, clientKey, p, section.key);
    const list = readSetup(row).extra;
    if (Array.isArray(list)) {
      extra = list.filter((x) => x && typeof x.key === "string" && typeof x.title === "string").map((x) => ({ key: x.key, title: x.title, kind: (x.kind as Kind) || "list", custom: true, normal: x.normal, after: !!x.after }));
      break;
    }
  }
  const removed = new Set((setupOf(rows, clientKey, period, section.key).hidden as string[]) || []);
  return [...section.subs, ...extra].filter((s) => !removed.has(s.key));
}

// ------------------------------------------------------------------ periods

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** A company's year ends from "MM-DD": the most recent ones on or before `today`, newest first, and the next to come. */
export function yearEnds(yearEnd: string | undefined, today: string, back = 3): string[] {
  const m = /^(\d{2})-(\d{2})$/.exec(yearEnd || "");
  if (!m) return [];
  const mo = Number(m[1]), da = Number(m[2]);
  // a year end on the last day of its month stays the last day, leap years included
  const monthEnd = da >= lastDay(2001, mo);
  const on = (y: number) => `${y}-${pad(mo)}-${pad(monthEnd ? lastDay(y, mo) : Math.min(da, lastDay(y, mo)))}`;
  const y = Number(today.slice(0, 4));
  const all = [on(y + 1), on(y), on(y - 1), on(y - 2), on(y - 3), on(y - 4)].sort((a, b) => b.localeCompare(a));
  const past = all.filter((d) => d <= today);
  const next = all.filter((d) => d > today).slice(-1);
  return [...next, ...past.slice(0, back)];
}

/** The year end a year before this one ("2026-03-31" → "2025-03-31"). */
export function priorPeriod(period: string): string {
  const y = Number(period.slice(0, 4)), mo = Number(period.slice(5, 7)), da = Number(period.slice(8, 10));
  const monthEnd = da >= lastDay(y, mo);
  return `${y - 1}-${pad(mo)}-${pad(monthEnd ? lastDay(y - 1, mo) : Math.min(da, lastDay(y - 1, mo)))}`;
}

// ------------------------------------------------------------------ money

const round2 = (n: number) => Math.round(n * 100) / 100;
export const total = (lines: { Amount?: number }[]) => round2(lines.reduce((t, l) => t + (Number.isFinite(l.Amount) ? (l.Amount as number) : 0), 0));

/** Amounts are typed freely: "£1,234.50", "(200)" for minus, "-5". Empty is no figure. */
export function parseAmount(text: string): number | undefined {
  const t = text.replace(/[£,\s]/g, "");
  if (!t) return undefined;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Number(t.replace(/[()\-]/g, ""));
  return Number.isFinite(n) ? round2(neg ? -n : n) : undefined;
}

export function money(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "";
  const t = Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${t})` : t;
}


// ------------------------------------------------------------------ lines
// A line of a schedule is a PaperLines row. Code, Detail and Amount are columns of their own (so a
// list of lines reads well in SharePoint); the other figures are JSON in the Figures column.

export type Line = { Key: string; Code: string; Detail: string; Amount: number | undefined; Remark: string; Done: boolean; Seq: number; f: Record<string, unknown>; row: Row };

function figuresOf(r: Row): Record<string, unknown> {
  if (!r.Figures) return {};
  try {
    const v = JSON.parse(String(r.Figures));
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function linesFor(rows: Row[], clientKey: string, period: string, sectionKey: string, subKey: string): Line[] {
  return rows
    .filter((r) => r.ClientKey === clientKey && r.PeriodEnd === period && r.SectionKey === sectionKey && (r.SubKey || "main") === subKey)
    .map((r) => ({
      Key: String(r.Key), Code: String(r.Code || ""), Detail: String(r.Detail || ""), Amount: num(r.Amount),
      Remark: String(r.Remark || ""), Done: r.Done === true || r.Done === "true", Seq: Number(r.Seq) || 0, f: figuresOf(r), row: r,
    }))
    .sort((a, b) => a.Seq - b.Seq || a.Detail.localeCompare(b.Detail));
}

/** A value of a line by column key: its own columns first, then the figures. */
export function cell(l: Line, key: string): unknown {
  if (key === "Code") return l.Code;
  if (key === "Detail") return l.Detail;
  if (key === "Amount") return l.Amount;
  if (key === "Remark") return l.Remark;
  if (key === "Done") return l.Done;
  return l.f[key];
}

// ------------------------------------------------------------------ columns of each kind of schedule

export type ColType = "text" | "money" | "int" | "date" | "status" | "pct";
export type Col = { key: string; label: string; type: ColType; calc?: (l: Line, s: Setup) => number | undefined; total?: boolean; wide?: boolean; options?: string[] };

const m = (key: string, label: string, more: Partial<Col> = {}): Col => ({ key, label, type: "money", total: true, ...more });
const t = (key: string, label: string, more: Partial<Col> = {}): Col => ({ key, label, type: "text", ...more });
const v = (l: Line, k: string) => n0(cell(l, k));

/** Depreciation for the year on one asset, as the working paper works it out. */
export function depreciation(l: Line, s: Setup): number {
  const method = String(s.method || "none"), rate = n0(s.rate) / 100;
  const months = num(cell(l, "months")) ?? 12;
  const costCf = v(l, "costBf") + v(l, "add") - v(l, "disp");
  const nbvLeft = costCf - (v(l, "depBf") - v(l, "depDisp"));
  if (method === "none" || !rate || nbvLeft <= 0) return 0;
  // reducing balance: on what's left; straight line: on cost (an addition from when it was bought)
  const charge = method === "rb" ? nbvLeft * rate * (months / 12) : costCf * rate * (months / 12);
  return round2(Math.max(0, Math.min(charge, nbvLeft)));
}
const regCostCf = (l: Line) => round2(v(l, "costBf") + v(l, "add") - v(l, "disp"));
const regDepCf = (l: Line, s: Setup) => round2(v(l, "depBf") - v(l, "depDisp") + depreciation(l, s));

export const KIND_COLS: Partial<Record<Kind, Col[]>> = {
  list: [t("Code", "Code"), t("Detail", "Detail", { wide: true }), m("Amount", "Amount")],
  register: [
    { key: "date", label: "Date", type: "date" }, t("Detail", "Asset", { wide: true }), t("Remark", "Details"),
    m("costBf", "Cost b/f"), m("depBf", "Dep'n b/f"), m("nbvBf", "NBV b/f", { calc: (l) => round2(v(l, "costBf") - v(l, "depBf")) }),
    m("add", "Additions"), m("disp", "Disposals (cost)"), m("costCf", "Cost c/f", { calc: regCostCf }),
    m("depDisp", "Dep'n on disposals"), { key: "months", label: "Months", type: "int" },
    m("charge", "Charge for year", { calc: depreciation }), m("depCf", "Dep'n c/f", { calc: regDepCf }),
    m("nbvCf", "NBV c/f", { calc: (l, s) => round2(regCostCf(l) - regDepCf(l, s)) }),
  ],
  account: [{ key: "date", label: "Date", type: "date" }, t("Detail", "Detail", { wide: true }), m("dr", "Debit"), m("cr", "Credit")],
  vat: [
    t("Detail", "Period"), m("out", "Output VAT"), m("in", "Input VAT"),
    m("due", "Payable / (repayable)", { calc: (l) => round2(v(l, "out") - v(l, "in")) }), m("paid", "Paid / (received)"),
    m("diff", "Owed at the end", { calc: (l) => round2(v(l, "out") - v(l, "in") - v(l, "paid")) }),
  ],
  payroll: [
    t("Detail", "Week / month"), m("gross", "Gross"), m("paye", "PAYE"), m("eeni", "Employee NI"), m("eepen", "Employee pension"),
    m("net", "Net pay", { calc: (l) => round2(v(l, "gross") - v(l, "paye") - v(l, "eeni") - v(l, "eepen")) }),
    m("erni", "Employer NI"), m("erpen", "Employer pension"),
    m("liability", "Due to HMRC", { calc: (l) => round2(v(l, "paye") + v(l, "eeni") + v(l, "erni")) }),
  ],
  expense: [
    t("Code", "Invoice"), t("Detail", "Detail", { wide: true }), m("gross", "Gross"), m("vat", "VAT"),
    m("Amount", "Net", { calc: (l) => (l.f.gross === undefined && l.f.vat === undefined ? l.Amount : round2(v(l, "gross") - v(l, "vat"))) }),
  ],
  tb: [t("Code", "Code"), t("Detail", "Account", { wide: true }), t("type", "Type"), m("dr", "Debit"), m("cr", "Credit")],
  journals: [{ key: "no", label: "Journal", type: "int" }, t("Code", "Code"), t("Detail", "Details", { wide: true }), m("dr", "Debit"), m("cr", "Credit")],
  opening: [
    t("Code", "Client code"), t("Detail", "Account", { wide: true }), m("cdr", "Client debit"), m("ccr", "Client credit"),
    m("adr", "Adjustment debit", { calc: (l) => Math.max(0, round2(v(l, "odr") - v(l, "ocr") - (v(l, "cdr") - v(l, "ccr")))) }),
    m("acr", "Adjustment credit", { calc: (l) => Math.max(0, round2(v(l, "cdr") - v(l, "ccr") - (v(l, "odr") - v(l, "ocr")))) }),
    t("ocode", "Our code"), m("odr", "Our debit"), m("ocr", "Our credit"),
  ],
  checklist: [t("Code", "Area"), t("Detail", "Disclosure item", { wide: true }), { key: "status", label: "Status", type: "status", options: ["", "✔", "⚠", "✘", "n/a"] }, t("Remark", "Issue / observation", { wide: true }), t("review", "Reviewer comments", { wide: true })],
  questions: [t("Detail", "Question", { wide: true }), t("Remark", "Answer", { wide: true })],
  budget: [t("Detail", "Description", { wide: true }), m("budget", "Budget"), m("actual", "Actual")],
};

export const colTotal = (lines: Line[], c: Col, s: Setup) => round2(lines.reduce((sum, l) => sum + n0(c.calc ? c.calc(l, s) : cell(l, c.key)), 0));
export const colValue = (l: Line, c: Col, s: Setup) => (c.calc ? c.calc(l, s) : cell(l, c.key));

// ------------------------------------------------------------------ what each schedule comes to

/** An account's balance carried forward, on its normal side (a creditor's credit balance is positive). */
export function accountCf(lines: Line[], s: Setup, normal: "dr" | "cr" = "cr"): number {
  const dr = lines.reduce((a, l) => a + v(l, "dr"), 0), cr = lines.reduce((a, l) => a + v(l, "cr"), 0);
  return round2(n0(s.bf) + (normal === "cr" ? cr - dr : dr - cr));
}

export type AssetTotals = { costBf: number; add: number; disp: number; costCf: number; depBf: number; charge: number; depDisp: number; depCf: number; nbvCf: number; nbvBf: number };
export function registerTotals(lines: Line[], s: Setup): AssetTotals {
  const sum = (f: (l: Line) => number) => round2(lines.reduce((a, l) => a + f(l), 0));
  const costBf = sum((l) => v(l, "costBf")), add = sum((l) => v(l, "add")), disp = sum((l) => v(l, "disp"));
  const depBf = sum((l) => v(l, "depBf")), depDisp = sum((l) => v(l, "depDisp")), charge = sum((l) => depreciation(l, s));
  const costCf = round2(costBf + add - disp), depCf = round2(depBf - depDisp + charge);
  return { costBf, add, disp, costCf, depBf, charge, depDisp, depCf, nbvCf: round2(costCf - depCf), nbvBf: round2(costBf - depBf) };
}

/** The expense for the year: invoices (net) less the opening accrual plus the closing accrual. */
export function expenseCharge(lines: Line[], s: Setup): number {
  const net = colTotal(lines, KIND_COLS.expense![4], s);
  return round2(net - n0(s.openingAccrual) + n0(s.closingAccrual));
}

export function vatOwed(lines: Line[], s: Setup): number {
  return round2(n0(s.bf) + lines.reduce((a, l) => a + v(l, "out") - v(l, "in") - v(l, "paid"), 0));
}

/** The figure a schedule puts on its lead schedule. */
export function subValue(sb: Sub, lines: Line[], s: Setup): number {
  switch (sb.kind) {
    case "list": return total(lines);
    case "register": return registerTotals(lines, s).nbvCf;
    case "account": return accountCf(lines, s, sb.normal);
    case "expense": return expenseCharge(lines, s);
    case "vat": return vatOwed(lines, s);
    default: return 0;
  }
}

/** The kinds of schedule that put a figure on the lead schedule (and so open from it). */
export const LEAD_KINDS = ["list", "register", "account", "expense", "vat"];

export type LeadRow = { sub: Sub; label: string; now: number; before: number | undefined; after: boolean; priorTyped: boolean };

/**
 * The rows of a lead schedule, this year and last. Last year comes from last year's paper; with no
 * paper for last year (the first year in the planner), the figure typed on this year's lead is used.
 * A split account (HP, loans) gives two rows: due within one year and after one year.
 */
export function leadRows(section: Section, rows: Row[], lines: Row[], clientKey: string, period: string): LeadRow[] {
  const prior = priorPeriod(period);
  const out: LeadRow[] = [];
  for (const sb of subsFor(section, rows, clientKey, period)) {
    if (!LEAD_KINDS.includes(sb.kind)) continue;
    const s = setupOf(rows, clientKey, period, setupKey(section.key, sb.key));
    const ps = setupOf(rows, clientKey, prior, setupKey(section.key, sb.key));
    const nowLines = linesFor(lines, clientKey, period, section.key, sb.key);
    const priorLines = linesFor(lines, clientKey, prior, section.key, sb.key);
    const hasPrior = priorLines.length > 0 || Object.keys(ps).length > 0;
    const now = subValue(sb, nowLines, s);
    const before = hasPrior ? subValue(sb, priorLines, ps) : num(s.prior);
    if (sb.split) {
      const within = n0(s.within), pWithin = hasPrior ? n0(ps.within) : num(s.priorWithin);
      out.push({ sub: sb, label: `${sb.title} (within one year)`, now: within, before: pWithin, after: false, priorTyped: !hasPrior });
      out.push({ sub: sb, label: `${sb.title} (after one year)`, now: round2(now - within), before: before === undefined ? undefined : round2(before - (pWithin ?? 0)), after: true, priorTyped: !hasPrior });
    } else out.push({ sub: sb, label: sb.title, now, before, after: !!sb.after, priorTyped: !hasPrior });
  }
  return out;
}

// ------------------------------------------------------------------ the final trial balance

export type TbRow = { code: string; account: string; tbDr: number; tbCr: number; jDr: number; jCr: number; dr: number; cr: number };

/** The software's trial balance with the journals put through it, account by account (matched on code, else name). */
export function finalTb(tb: Line[], journals: Line[]): TbRow[] {
  const by = new Map<string, TbRow>();
  const key = (l: Line) => (l.Code.trim() || l.Detail.trim().toLowerCase());
  for (const l of tb) {
    const k = key(l);
    if (!k) continue;
    const r = by.get(k) || { code: l.Code, account: l.Detail, tbDr: 0, tbCr: 0, jDr: 0, jCr: 0, dr: 0, cr: 0 };
    r.tbDr = round2(r.tbDr + v(l, "dr"));
    r.tbCr = round2(r.tbCr + v(l, "cr"));
    by.set(k, r);
  }
  for (const l of journals) {
    const k = key(l);
    if (!k || (!v(l, "dr") && !v(l, "cr"))) continue;
    const r = by.get(k) || { code: l.Code, account: l.Detail || l.Code, tbDr: 0, tbCr: 0, jDr: 0, jCr: 0, dr: 0, cr: 0 };
    r.jDr = round2(r.jDr + v(l, "dr"));
    r.jCr = round2(r.jCr + v(l, "cr"));
    by.set(k, r);
  }
  return [...by.values()].map((r) => {
    const net = round2(r.tbDr - r.tbCr + r.jDr - r.jCr);
    return { ...r, dr: net > 0 ? net : 0, cr: net < 0 ? -net : 0 };
  }).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.account.localeCompare(b.account));
}

/** Each journal's debits and credits, to show any that don't balance. */
export function journalTotals(lines: Line[]): { no: number; dr: number; cr: number }[] {
  const by = new Map<number, { no: number; dr: number; cr: number }>();
  for (const l of lines) {
    const no = n0(l.f.no);
    const r = by.get(no) || { no, dr: 0, cr: 0 };
    r.dr = round2(r.dr + v(l, "dr"));
    r.cr = round2(r.cr + v(l, "cr"));
    by.set(no, r);
  }
  return [...by.values()].sort((a, b) => a.no - b.no);
}

// ------------------------------------------------------------------ starting a year from last year

/** New lines for this year from last year's, for a kind of schedule (what carries forward and what starts empty). */
export function carryLines(kind: Kind, prior: Line[], ps: Setup): { Code?: string; Detail: string; Amount?: number; Remark?: string; f?: Record<string, unknown> }[] {
  switch (kind) {
    case "register":
      // each asset still held: cost and depreciation brought forward
      return prior.filter((l) => regCostCf(l) !== 0).map((l) => ({
        Detail: l.Detail, Remark: l.Remark, f: { date: l.f.date, costBf: regCostCf(l), depBf: regDepCf(l, ps), months: 12 },
      }));
    case "checklist":
      return prior.map((l) => ({ Code: l.Code, Detail: l.Detail }));
    case "questions":
      return prior.map((l) => ({ Detail: l.Detail, Remark: l.Remark }));
    case "budget":
      return prior.map((l) => ({ Detail: l.Detail, f: { budget: l.f.budget } }));
    case "account": case "vat": case "payroll": case "tb": case "journals": case "opening": case "expense": case "report": case "finaltb": case "info": case "queries":
      return [];
    default:
      return prior.filter((l) => l.Detail.trim()).map((l) => ({ Code: l.Code, Detail: l.Detail }));
  }
}

/** This year's settings from last year's: depreciation carries on, balances brought forward are last year's carried forward. */
export function carrySetup(sb: Sub, prior: Line[], ps: Setup): Setup {
  switch (sb.kind) {
    case "register": return { method: ps.method, rate: ps.rate };
    case "account": return { bf: accountCf(prior, ps, sb.normal) };
    case "vat": return { bf: vatOwed(prior, ps) };
    case "expense": return { openingAccrual: ps.closingAccrual };
    case "budget": return { fee: ps.fee };
    case "info": return { ...ps, preparedBy: undefined, reviewedBy: undefined };
    default: return {};
  }
}

// ------------------------------------------------------------------ starting lists
// Questions and checklist items from the working paper, used the first time.

export const DEFAULT_LINES: Partial<Record<Kind, { Code?: string; Detail: string }[]>> = {
  questions: [
    "Client name (registered)", "Client name (trading, if different)", "Client address and postcode", "Business structure (sole trader, partnership, LLP, limited company, other)",
    "How long has the business been in existence?", "Nature of the business", "Company number", "Country of registration", "VAT registered? VAT number",
    "Year end", "Owners / shareholders", "Directors, members or proprietor", "Other branches or offices", "Individuals with significant influence",
    "Types of transactions", "Main source of finance", "Main suppliers (type and location)", "Main customers (type and location)", "Accounting systems in use",
    "Risk: is the business structure complex or unusual?", "Risk: transactions with countries with weak money laundering rules?", "Risk: is control remote?",
    "Risk: are client monies held?", "Overall risk (high / low)", "Are standard procedures acceptable?", "Other comments",
  ].map((Detail) => ({ Detail })),
  checklist: [
    ["Companies Act s477/476", "Audit exemption statement and acknowledgement of directors' responsibilities"],
    ["FRS 102 1A.5/1A.6", "Statement that the accounts are prepared under FRS 102 Section 1A (small entities)"],
    ["Company information", "Registered name and number, registered office, directors"],
    ["Directors' report", "Principal activity, directors, statement of directors' responsibilities, small companies provisions"],
    ["Income statement", "Separate tax line disclosed"],
    ["Employees", "Average number of employees"],
    ["Accounting policies: basis", "Historical cost / revaluation basis explained"],
    ["Accounting policies: going concern", "Explicit going concern policy"],
    ["Accounting policies: revenue", "Revenue recognition policy"],
    ["Accounting policies: depreciation", "Useful lives / rates for each class of asset"],
    ["Accounting policies: investments", "Classification and measurement basis"],
    ["Tangible fixed assets", "Revaluation disclosures (date, valuer, method, carrying amount under cost model)"],
    ["Tangible fixed assets", "Land not depreciated; land and buildings shown separately"],
    ["Investments", "Carrying amount is not negative"],
    ["Share capital", "Classes, number and nominal value of shares"],
    ["Related parties (FRS 102 1A.35)", "Directors' loans and related party balances"],
    ["Dividends", "Amounts recognised in the year"],
    ["Creditors due within one year", "Categories disclosed"],
    ["Post balance sheet events", "Material events"],
  ].map(([Code, Detail]) => ({ Code, Detail })),
  budget: ["Time on ledger to be recovered", "Accounts preparation", "Manager review", "Partner review", "Finalisation"].map((Detail) => ({ Detail })),
};

/** The job details asked for on the Information sheet. */
export const INFO_FIELDS: { key: string; label: string; options?: string[]; wide?: boolean }[] = [
  { key: "software", label: "Accounting software", options: ["", "Xero", "Sage", "QuickBooks", "FreeAgent", "Manual cashbook", "Other"] },
  { key: "softwareRef", label: "Software reference / user name" },
  { key: "periodType", label: "Year or period", options: ["Year", "Period", "52 weeks"] },
  { key: "months", label: "Number of months" },
  { key: "vat", label: "VAT registered", options: ["", "Yes", "No"] },
  { key: "nature", label: "Nature of business", wide: true },
  { key: "preparedBy", label: "Prepared by" },
  { key: "reviewedBy", label: "Reviewed by" },
];

/** Pasted rows from Excel: "detail <tab> amount" or "code <tab> detail <tab> amount", one per line. */
export function parsePasted(text: string): { Code: string; Detail: string; Amount: number | undefined }[] {
  const out: { Code: string; Detail: string; Amount: number | undefined }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = raw.includes("\t") ? raw.split("\t") : raw.split(/\s{2,}|,(?=[^,]*$)/);
    const clean = cells.map((c) => c.trim());
    const last = clean[clean.length - 1];
    const amount = clean.length > 1 ? parseAmount(last) : undefined;
    const rest = amount !== undefined || last === "" ? clean.slice(0, -1) : clean;
    const [a, b] = rest.length >= 2 ? [rest[0], rest.slice(1).join(" ")] : ["", rest[0] || ""];
    if (!b) continue;
    out.push({ Code: a, Detail: b, Amount: amount });
  }
  return out;
}

/** Pasted rows for any kind: the cells in column order (tabs between them). Rows with nothing in them are skipped. */
export function parseGrid(text: string): string[][] {
  return text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.split("\t").map((c) => c.trim())).filter((r) => r.some((c) => c));
}

/** Last year's figure for the same detail line, if there was one. */
export function priorFor(rows: Row[], clientKey: string, period: string, sectionKey: string, subKey: string, detail: string): number | undefined {
  const prior = priorPeriod(period);
  const want = detail.trim().toLowerCase();
  if (!want) return undefined;
  const hit = linesFor(rows, clientKey, prior, sectionKey, subKey).find((l) => l.Detail.trim().toLowerCase() === want);
  return hit?.Amount;
}

// ------------------------------------------------------------------ status and sign-off

export type SectionState = { status: PaperStatus; note: string; preparedBy: string; preparedOn: string; reviewedBy: string; reviewedOn: string; link: string; row?: Row };

export function stateOf(rows: Row[], clientKey: string, period: string, sectionKey: string): SectionState {
  const row = setupRow(rows, clientKey, period, sectionKey);
  const st = String(row?.Status || "todo");
  return {
    status: (st in STATUS_LABEL ? st : "todo") as PaperStatus, note: String(row?.Note || ""),
    preparedBy: String(row?.PreparedBy || ""), preparedOn: String(row?.PreparedOn || ""),
    reviewedBy: String(row?.ReviewedBy || ""), reviewedOn: String(row?.ReviewedOn || ""),
    link: String(readSetup(row).link || ""), row,
  };
}

/** How far on a paper is: sections in use that are finished (or not needed), out of the sections in use. */
export function progress(clientKey: string, period: string, rows: Row[]): { done: number; started: number; total: number } {
  const off = sectionsOff(rows, clientKey, period);
  let done = 0, started = 0, totalN = 0;
  for (const s of SECTIONS) {
    if (off.has(s.key)) continue;
    totalN++;
    const { status } = stateOf(rows, clientKey, period, s.key);
    if (status === "done" || status === "na") done++;
    else if (status === "doing") started++;
  }
  return { done, started, total: totalN };
}
