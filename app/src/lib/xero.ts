// Reading a company's books from Xero, through the app's Xero bridge (/api/xero, which holds the
// Xero app's secret: Xero doesn't allow web pages to call it directly).
//
// What comes in, for a year of working papers:
// - the trial balance at the year end (and last year's, for comparatives)
// - every nominal ledger transaction in the year, from Xero's Account Data API; where that isn't
//   available, the ledger is rebuilt from invoices, bills, credit notes, payments, bank
//   transactions, transfers and manual journals (payroll and fixed asset postings can't be, so
//   each account says whether its transactions reach the trial balance)
// - customers' and suppliers' balances at the year end (debtors and creditors listings)
// - the bank summary and the bank transactions not yet reconciled at the year end
// - VAT by quarter (output, input and payments) from the VAT account
// - payroll by month from pay runs and payslips (UK payroll)
//
// The ledger is saved as a file in OneDrive (it's too big for SharePoint list rows); the trial
// balance, listings, VAT and payroll go into the papers' schedules.

import { acctKey } from "./papers";

// ------------------------------------------------------------------ scopes

export type ScopeGroup = { key: string; label: string; scopes: string[]; classic?: string[]; required?: boolean; offByDefault?: boolean; note?: string };

/** What the app can ask Xero for. "classic" is the older broad scope for apps made before 2 March 2026. */
export const SCOPE_GROUPS: ScopeGroup[] = [
  { key: "core", label: "Organisation details, chart of accounts and contacts", scopes: ["accounting.settings.read", "accounting.contacts.read"], required: true },
  { key: "reports", label: "Trial balance and bank summary reports", scopes: ["accounting.reports.trialbalance.read", "accounting.reports.banksummary.read"], classic: ["accounting.reports.read"] },
  { key: "ledger", label: "Nominal ledger transactions (Xero's Account Data API, in beta)", scopes: ["accountdata.balances.read", "accountdata.transactions.read"], offByDefault: true, note: "Shows every transaction behind each account. It isn't in the list of scopes most Xero apps can pick: Xero has to switch the beta on for your app first. Until then leave it unticked and the ledger is rebuilt from the documents below." },
  { key: "documents", label: "Invoices, bills, credit notes, payments, bank transactions and manual journals", scopes: ["accounting.invoices.read", "accounting.payments.read", "accounting.banktransactions.read", "accounting.manualjournals.read"], classic: ["accounting.transactions.read"], note: "Used for unreconciled bank items, and to rebuild the ledger when the Account Data API isn't available." },
  { key: "payroll", label: "Payroll (UK): pay runs and payslips", scopes: ["payroll.payruns.read", "payroll.payslip.read"] },
  { key: "journals", label: "Full journals (only if Xero has approved your app for the Journals endpoint)", scopes: ["accounting.journals.read"], offByDefault: true, note: "Xero limits this to approved apps on its Advanced tier, and apps made after 2 March 2026 can't ask for it." },
];

export type XeroOptions = { groups: string[]; classic: boolean };
export const DEFAULT_OPTIONS: XeroOptions = { groups: SCOPE_GROUPS.filter((g) => !g.offByDefault).map((g) => g.key), classic: false };

export function scopesFor(o: XeroOptions): string[] {
  const out: string[] = [];
  for (const g of SCOPE_GROUPS) {
    if (!g.required && !o.groups.includes(g.key)) continue;
    out.push(...(o.classic && g.classic ? g.classic : g.scopes));
  }
  return [...new Set(out)];
}

// ------------------------------------------------------------------ talking to the bridge

export type XeroApiName = "accounting" | "accountdata" | "payroll" | "assets";
export type XeroTenant = { id: string; tenantId: string; tenantName: string; tenantType: string; createdDateUtc?: string };
export type XeroStatus = { configured: boolean; redirectUri?: string };
export type Query = Record<string, string | number | boolean | string[] | undefined>;

export class XeroError extends Error {
  constructor(public code: string, message: string, public retryAfter?: number) {
    super(message);
  }
}

export type ScopeCheck = { accepted: string[]; refused: string[]; unsure: string[]; reliable: boolean; warning?: string };

export interface XeroApi {
  status(): Promise<XeroStatus>;
  /** The Xero sign-in page to send the browser to. */
  start(scopes: string[]): Promise<string>;
  /** Which scopes Xero accepts for this app (asked one at a time before connecting). */
  check(scopes: string[]): Promise<ScopeCheck>;
  connections(): Promise<{ tenants: XeroTenant[]; scopes: string[]; since?: string }>;
  disconnect(connectionId?: string): Promise<void>;
  get<T = any>(tenantId: string, api: XeroApiName, path: string, query?: Query): Promise<T>;
}

/** Holds the sealed Xero sign-in (only the server can open it) and keeps it up to date. */
export type SealedStore = { read: () => string | undefined; write: (sealed: string | undefined) => Promise<void> | void };

export class HttpXero implements XeroApi {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private token: () => Promise<string>, private sealed: SealedStore, private sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {}

  private async post(action: string, body: Record<string, unknown> = {}): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`/api/xero/${action}`, {
        method: "POST",
        headers: { "X-PP-Token": await this.token(), Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new XeroError("unreachable", "Couldn't reach the app's server. Check your internet connection.");
    }
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* not JSON: the bridge isn't deployed yet */
    }
    if (json && typeof json.sealed === "string") await this.sealed.write(json.sealed);
    if (res.ok && json) return json;
    if (!json || !json.error) throw new XeroError("no-bridge", "The Xero connection isn't on the server yet. It arrives with the next deployment.");
    if (json.error === "reconnect") await this.sealed.write(undefined);
    throw new XeroError(json.error, json.message || "Xero didn't answer. Try again.", json.retryAfter);
  }

  /** One call at a time, so a renewed sign-in is always used by the next call. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async status(): Promise<XeroStatus> {
    try {
      const res = await fetch(`/api/xero/status?origin=${encodeURIComponent(location.origin)}`, { headers: { Accept: "application/json" } });
      const json = await res.json();
      return { configured: !!json.configured, redirectUri: json.redirectUri };
    } catch {
      return { configured: false };
    }
  }
  async start(scopes: string[]): Promise<string> {
    return (await this.post("start", { scopes, origin: location.origin })).url;
  }
  async check(scopes: string[]): Promise<ScopeCheck> {
    const r = await this.post("check", { scopes, origin: location.origin });
    return { accepted: r.accepted || scopes, refused: r.refused || [], unsure: r.unsure || [], reliable: !!r.reliable, warning: r.warning || undefined };
  }
  connections() {
    return this.serial(async () => {
      const s = this.sealed.read();
      if (!s) throw new XeroError("reconnect", "Connect to Xero first (Settings › Xero).");
      const r = await this.post("connections", { sealed: s });
      return { tenants: r.tenants as XeroTenant[], scopes: (r.scopes || []) as string[], since: r.since as string | undefined };
    });
  }
  disconnect(connectionId?: string) {
    return this.serial(async () => {
      const s = this.sealed.read();
      if (s) await this.post("disconnect", { sealed: s, connectionId });
      if (!connectionId) await this.sealed.write(undefined);
    });
  }
  get<T = any>(tenantId: string, api: XeroApiName, path: string, query?: Query): Promise<T> {
    return this.serial(async () => {
      for (let attempt = 0; ; attempt++) {
        const s = this.sealed.read();
        if (!s) throw new XeroError("reconnect", "Connect to Xero first (Settings › Xero).");
        try {
          return (await this.post("call", { sealed: s, tenantId, api, path, query })).data as T;
        } catch (e) {
          if (e instanceof XeroError && e.code === "rate-limited" && attempt < 4) {
            await this.sleep(Math.min(e.retryAfter || 10, 70) * 1000);
            continue;
          }
          throw e;
        }
      }
    });
  }
}

// ------------------------------------------------------------------ shapes we keep

/** One nominal ledger line. amt is signed: debit positive. a is the account key (code|name). */
export type LedgerLine = { d: string; a: string; amt: number; tax?: number; t?: string; c?: string; r?: string; x?: string; j?: number; rate?: string };
export type XAccount = { id: string; code: string; name: string; type: string; cls: string; sys: string; key: string };
export type BankRow = { account: string; key?: string; opening: number; received: number; spent: number; closing: number };
export type Unreconciled = { d: string; a: string; amt: number; c?: string; r?: string; x?: string; t: string };
export type ContactBalance = { contact: string; balance: number };

/** What's saved to OneDrive for a year: the ledger and the bank detail behind the papers. */
export type XeroBook = {
  v: 1;
  tenantId: string;
  tenantName: string;
  period: string;
  from: string;
  to: string;
  at: string;
  source: "accountdata" | "rebuilt" | "none";
  accounts: XAccount[];
  /** signed balances (debit positive) per account key, from the trial balances */
  opening: Record<string, number>;
  closing: Record<string, number>;
  lines: LedgerLine[];
  unreconciled: Unreconciled[];
  bank: BankRow[];
  notes: string[];
};

export type TbLine = { Code: string; Detail: string; f: { dr?: number; cr?: number; type?: string; xid?: string } };

// ------------------------------------------------------------------ small helpers

export const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Xero's dates: "2026-04-30T00:00:00", "/Date(1556035526223+0000)/" or "2026-04-30". */
export function xDate(v: unknown): string {
  const s = String(v ?? "");
  const m = s.match(/\/Date\((-?\d+)/);
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  return s.slice(0, 10);
}
const whereDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `DateTime(${y},${String(m).padStart(2, "0")},${String(d).padStart(2, "0")})`;
};

/** The first day of the year of papers ending on `period` (a year back, plus a day). */
export function yearStart(period: string): string {
  const d = new Date(`${period}T00:00:00Z`);
  const back = new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), d.getUTCDate() + 1));
  // a year end on the last day of February steps back to the last day of last February
  if (d.getUTCMonth() === 1 && d.getUTCDate() >= 28) return `${d.getUTCFullYear() - 1}-03-01`;
  return back.toISOString().slice(0, 10);
}

const TYPE_LABEL: Record<string, string> = {
  BANK: "Bank", CURRENT: "Current Asset", FIXED: "Fixed Asset", INVENTORY: "Inventory", NONCURRENT: "Non-current Asset", PREPAYMENT: "Prepayment",
  CURRLIAB: "Current Liability", LIABILITY: "Liability", TERMLIAB: "Non-current Liability", PAYGLIABILITY: "Payroll Liability", EQUITY: "Equity",
  DEPRECIATN: "Depreciation", DIRECTCOSTS: "Direct Costs", EXPENSE: "Expense", OVERHEADS: "Overhead", OTHERINCOME: "Other Income", REVENUE: "Revenue",
  SALES: "Sales", WAGESEXPENSE: "Wages Expense", SUPERANNUATIONEXPENSE: "Pension Expense", SUPERANNUATIONLIABILITY: "Pension Liability",
};
export const typeLabel = (t: string) => TYPE_LABEL[String(t || "").toUpperCase()] || t || "";

const isPlType = (t: string) => /^(DEPRECIATN|DIRECTCOSTS|EXPENSE|OVERHEADS|OTHERINCOME|REVENUE|SALES|WAGESEXPENSE|SUPERANNUATIONEXPENSE)$/i.test(t);

export function parseAccounts(json: any): XAccount[] {
  return (json?.Accounts || []).map((a: any) => {
    const code = String(a.Code || "").trim(), name = String(a.Name || "").trim();
    return { id: String(a.AccountID || ""), code, name, type: String(a.Type || ""), cls: String(a.Class || ""), sys: String(a.SystemAccount || ""), key: acctKey(code, name) };
  });
}

// ------------------------------------------------------------------ reports

/** Rows of a Xero report as { title, cells, ids } under their section, skipping headers and totals. */
function reportRows(report: any): { head: string[]; rows: { section: string; cells: string[]; id?: string }[] } {
  const r = report?.Reports?.[0] || report;
  const head: string[] = [];
  const rows: { section: string; cells: string[]; id?: string }[] = [];
  const walk = (list: any[], section: string) => {
    for (const row of list || []) {
      if (row.RowType === "Header") {
        if (!head.length) head.push(...(row.Cells || []).map((c: any) => String(c.Value ?? "")));
      } else if (row.RowType === "Section") walk(row.Rows, row.Title || section);
      else if (row.RowType === "Row") {
        const cells = (row.Cells || []).map((c: any) => String(c.Value ?? ""));
        const id = (row.Cells?.[0]?.Attributes || []).find((x: any) => /account/i.test(String(x.Id)))?.Value;
        rows.push({ section, cells, id });
      }
    }
  };
  walk(r?.Rows || [], "");
  return { head, rows };
}

/** The trial balance report as lines for the papers. Uses the YTD columns (the balance at the date). */
export function parseTrialBalance(report: any, accounts: XAccount[]): TbLine[] {
  const { head, rows } = reportRows(report);
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const ytdDr = col(/^ytd debit/i), ytdCr = col(/^ytd credit/i);
  const dr = ytdDr >= 0 ? ytdDr : col(/^debit/i), cr = ytdCr >= 0 ? ytdCr : col(/^credit/i);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out: TbLine[] = [];
  for (const row of rows) {
    const label = row.cells[0] || "";
    if (!label || /^total/i.test(label)) continue;
    const acct = row.id ? byId.get(row.id) : undefined;
    const m = label.match(/^(.*)\s+\(([^()]+)\)\s*$/);
    const code = acct?.code ?? (m ? m[2].trim() : "");
    const name = acct?.name || (m ? m[1].trim() : label.trim());
    const bal = r2(num(row.cells[dr]) - num(row.cells[cr]));
    if (!bal) continue;
    out.push({ Code: code, Detail: name, f: { dr: bal > 0 ? bal : undefined, cr: bal < 0 ? -bal : undefined, type: typeLabel(acct?.type || "") || row.section, xid: acct?.id || row.id } });
  }
  return out;
}

export function parseBankSummary(report: any, accounts: XAccount[]): BankRow[] {
  const { head, rows } = reportRows(report);
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const o = col(/opening/i), rcv = col(/received/i), sp = col(/spent/i), cl = col(/closing/i);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return rows
    .filter((x) => x.cells[0] && !/^total/i.test(x.cells[0]))
    .map((x) => ({ account: x.cells[0], key: x.id ? byId.get(x.id)?.key : undefined, opening: num(x.cells[o]), received: num(x.cells[rcv]), spent: num(x.cells[sp]), closing: num(x.cells[cl]) }));
}

/** Signed balances (debit positive) per account key, from trial balance lines. */
export function balancesOf(tb: TbLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of tb) out[acctKey(l.Code, l.Detail)] = r2((out[acctKey(l.Code, l.Detail)] || 0) + (l.f.dr || 0) - (l.f.cr || 0));
  return out;
}

// ------------------------------------------------------------------ the Account Data API

export function lineFromAccountData(x: any): LedgerLine {
  const a = x.account || {};
  const src = x.source || {};
  const line: LedgerLine = { d: String(x.journalDate || "").slice(0, 10), a: acctKey(String(a.code || ""), String(a.name || "")), amt: r2(num(x.signedNetAmount)) };
  const tax = r2(num(x.signedTaxAmount));
  if (tax) line.tax = tax;
  if (src.documentType) line.t = String(src.documentType);
  if (src.contactName) line.c = String(src.contactName);
  if (src.reference) line.r = String(src.reference);
  if (x.description) line.x = String(x.description);
  if (x.journalNumber) line.j = Number(x.journalNumber);
  if (x.taxRate?.name) line.rate = String(x.taxRate.name);
  return line;
}

async function accountDataLines(api: XeroApi, tenantId: string, query: Query, onPage?: (n: number) => void): Promise<LedgerLine[]> {
  const out: LedgerLine[] = [];
  let page: any = await api.get(tenantId, "accountdata", "account-transactions", { accountingBasis: "ACCRUAL", ...query });
  for (let guard = 0; guard < 2000; guard++) {
    for (const x of page?.lines || []) out.push(lineFromAccountData(x));
    onPage?.(out.length);
    const next = page?.pagination?.nextToken;
    if (!next) break;
    page = await api.get(tenantId, "accountdata", "account-transactions", { token: next });
  }
  return out;
}

// ------------------------------------------------------------------ rebuilding the ledger from documents

type Doc = Record<string, any>;
export type Documents = { invoices: Doc[]; creditNotes: Doc[]; payments: Doc[]; bankTransactions: Doc[]; bankTransfers: Doc[]; manualJournals: Doc[] };

/**
 * The ledger made from Xero's documents: invoices and bills, credit notes, payments, bank
 * transactions, transfers and manual journals. Payroll, fixed asset depreciation, currency
 * revaluations and conversion balances aren't documents, so they're missing.
 */
export function rebuildLedger(docs: Documents, accounts: XAccount[], from: string, to: string): LedgerLine[] {
  const byCode = new Map(accounts.filter((a) => a.code).map((a) => [a.code.toLowerCase(), a]));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const sys = (s: string) => accounts.find((a) => a.sys === s);
  const vat = sys("GST") || accounts.find((a) => /^vat$|vat control|^vat liability/i.test(a.name));
  const debtors = sys("DEBTORS"), creditors = sys("CREDITORS");
  const keyOf = (code?: string, id?: string, fallback?: string) => {
    const a = (id && byId.get(id)) || (code && byCode.get(String(code).toLowerCase()));
    return a ? a.key : acctKey(String(code || ""), fallback || String(code || "?"));
  };
  const out: LedgerLine[] = [];
  const inYear = (d: string) => d >= from && d <= to;
  const push = (l: LedgerLine) => {
    if (l.amt || l.tax) out.push({ ...l, amt: r2(l.amt), ...(l.tax ? { tax: r2(l.tax) } : {}) });
  };
  const netOf = (li: Doc, types: string) => (types === "Inclusive" ? num(li.LineAmount) - num(li.TaxAmount) : num(li.LineAmount));

  // invoices, bills and credit notes: lines to their accounts, VAT to the VAT account, the total to the control account
  const document = (d: Doc, sign: number, t: string) => {
    const date = xDate(d.DateString || d.Date);
    if (!inYear(date) || !["AUTHORISED", "PAID"].includes(d.Status)) return;
    const c = d.Contact?.Name, ref = d.InvoiceNumber || d.CreditNoteNumber || d.Reference;
    let tax = 0;
    for (const li of d.LineItems || []) {
      const lt = d.LineAmountTypes === "NoTax" ? 0 : num(li.TaxAmount);
      tax += lt;
      push({ d: date, a: keyOf(li.AccountCode, li.AccountID), amt: sign * netOf(li, d.LineAmountTypes), tax: sign * lt, t, c, r: ref, x: li.Description, rate: li.TaxType });
    }
    if (tax && vat) push({ d: date, a: vat.key, amt: sign * tax, t, c, r: ref, x: "VAT" });
    const control = /ACCREC/.test(t) ? debtors : creditors;
    if (control) push({ d: date, a: control.key, amt: -sign * num(d.Total), t, c, r: ref, x: d.Reference || "" });
  };
  for (const d of docs.invoices) document(d, d.Type === "ACCREC" ? -1 : 1, d.Type);
  for (const d of docs.creditNotes) document(d, d.Type === "ACCRECCREDIT" ? 1 : -1, d.Type === "ACCRECCREDIT" ? "ACCRECCREDIT" : "ACCPAYCREDIT");

  // payments: the bank account and the control account
  const moneyIn = /^(ACCRECPAYMENT|APCREDITPAYMENT|APOVERPAYMENTPAYMENT|APPREPAYMENTPAYMENT)$/;
  for (const p of docs.payments) {
    const date = xDate(p.DateString || p.Date);
    if (!inYear(date) || p.Status === "DELETED") continue;
    const amount = num(p.Amount) * (moneyIn.test(p.PaymentType) ? 1 : -1);
    const ar = /^(ACCREC|AR)/.test(p.PaymentType || "") || p.Invoice?.Type === "ACCREC";
    const control = ar ? debtors : creditors;
    const c = p.Invoice?.Contact?.Name || p.CreditNote?.Contact?.Name, ref = p.Invoice?.InvoiceNumber || p.Reference;
    push({ d: date, a: keyOf(p.Account?.Code, p.Account?.AccountID), amt: amount, t: p.PaymentType || "PAYMENT", c, r: ref, x: p.Reference || "Payment" });
    if (control) push({ d: date, a: control.key, amt: -amount, t: p.PaymentType || "PAYMENT", c, r: ref, x: p.Reference || "Payment" });
  }

  // bank transactions (spend and receive money, overpayments and prepayments); transfers come from BankTransfers
  for (const b of docs.bankTransactions) {
    const date = xDate(b.DateString || b.Date);
    if (!inYear(date) || b.Status !== "AUTHORISED" || /TRANSFER/.test(b.Type || "")) continue;
    const sign = /^RECEIVE/.test(b.Type) ? -1 : 1; // money in credits the lines
    const c = b.Contact?.Name, ref = b.Reference;
    let tax = 0;
    for (const li of b.LineItems || []) {
      const lt = b.LineAmountTypes === "NoTax" ? 0 : num(li.TaxAmount);
      tax += lt;
      push({ d: date, a: keyOf(li.AccountCode, li.AccountID), amt: sign * netOf(li, b.LineAmountTypes), tax: sign * lt, t: b.Type, c, r: ref, x: li.Description, rate: li.TaxType });
    }
    if (tax && vat) push({ d: date, a: vat.key, amt: sign * tax, t: b.Type, c, r: ref, x: "VAT" });
    push({ d: date, a: keyOf(b.BankAccount?.Code, b.BankAccount?.AccountID, b.BankAccount?.Name), amt: -sign * num(b.Total), t: b.Type, c, r: ref, x: b.Reference || "" });
  }
  for (const t of docs.bankTransfers) {
    const date = xDate(t.DateString || t.Date);
    if (!inYear(date)) continue;
    push({ d: date, a: keyOf(t.FromBankAccount?.Code, t.FromBankAccount?.AccountID, t.FromBankAccount?.Name), amt: -num(t.Amount), t: "TRANSFER", x: `Transfer to ${t.ToBankAccount?.Name || ""}`.trim(), r: t.Reference });
    push({ d: date, a: keyOf(t.ToBankAccount?.Code, t.ToBankAccount?.AccountID, t.ToBankAccount?.Name), amt: num(t.Amount), t: "TRANSFER", x: `Transfer from ${t.FromBankAccount?.Name || ""}`.trim(), r: t.Reference });
  }

  // manual journals: each line as it is (positive is a debit)
  for (const j of docs.manualJournals) {
    const date = xDate(j.DateString || j.Date);
    if (!inYear(date) || j.Status !== "POSTED") continue;
    let tax = 0;
    for (const li of j.JournalLines || []) {
      const lt = j.LineAmountTypes === "NoTax" || !li.TaxAmount ? 0 : num(li.TaxAmount);
      tax += lt;
      const net = j.LineAmountTypes === "Inclusive" ? num(li.LineAmount) - lt : num(li.LineAmount);
      push({ d: date, a: keyOf(li.AccountCode, li.AccountID), amt: net, tax: lt, t: "MANJOURNAL", r: j.Narration?.slice(0, 60), x: li.Description || j.Narration, rate: li.TaxType });
    }
    if (tax && vat) push({ d: date, a: vat.key, amt: tax, t: "MANJOURNAL", x: "VAT", r: j.Narration?.slice(0, 60) });
  }
  return out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}

// ------------------------------------------------------------------ what the ledger tells us

/** Per account: the ledger's total for the year, and whether it reaches the trial balance. */
export function ledgerCheck(book: Pick<XeroBook, "lines" | "opening" | "closing" | "accounts">) {
  const pl = new Set(book.accounts.filter((a) => isPlType(a.type)).map((a) => a.key));
  const sum = new Map<string, number>();
  for (const l of book.lines) sum.set(l.a, r2((sum.get(l.a) || 0) + l.amt));
  const keys = new Set([...sum.keys(), ...Object.keys(book.closing)]);
  const out = new Map<string, { opening: number; movement: number; closing: number; diff: number }>();
  // last year's profit and loss closes into retained earnings
  const re = book.accounts.find((a) => a.sys === "RETAINEDEARNINGS")?.key;
  const lastYearPl = r2(Object.entries(book.opening).filter(([k]) => pl.has(k)).reduce((t, [, v]) => t + v, 0));
  for (const k of keys) {
    const opening = pl.has(k) ? 0 : r2((book.opening[k] || 0) + (k === re ? lastYearPl : 0));
    const movement = sum.get(k) || 0;
    const closing = book.closing[k] || 0;
    out.set(k, { opening, movement, closing, diff: r2(opening + movement - closing) });
  }
  return out;
}

/** Each contact's balance on the control accounts (signed, debit positive), from ledger lines. */
export function contactBalances(lines: LedgerLine[], controlKey: string): ContactBalance[] {
  const by = new Map<string, number>();
  for (const l of lines) if (l.a === controlKey) by.set(l.c || "(no contact)", r2((by.get(l.c || "(no contact)") || 0) + l.amt));
  return [...by.entries()].filter(([, b]) => Math.abs(b) >= 0.005).map(([contact, balance]) => ({ contact, balance })).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
}

/** Outstanding at the year end from invoices and bills (when there's no ledger): total less payments and credits by then. */
export function outstandingFromInvoices(invoices: Doc[], type: "ACCREC" | "ACCPAY", to: string): ContactBalance[] {
  const by = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.Type !== type || !["AUTHORISED", "PAID"].includes(inv.Status)) continue;
    if (xDate(inv.DateString || inv.Date) > to) continue;
    let left = num(inv.Total);
    for (const p of inv.Payments || []) if (xDate(p.Date) <= to) left -= num(p.Amount);
    for (const cn of [...(inv.CreditNotes || []), ...(inv.Prepayments || []), ...(inv.Overpayments || [])]) if (xDate(cn.Date || cn.DateString) <= to) left -= num(cn.AppliedAmount ?? cn.Total);
    if (Math.abs(left) < 0.005) continue;
    const name = inv.Contact?.Name || "(no contact)";
    by.set(name, r2((by.get(name) || 0) + (type === "ACCREC" ? left : -left)));
  }
  return [...by.entries()].filter(([, b]) => Math.abs(b) >= 0.005).map(([contact, balance]) => ({ contact, balance })).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
}

// ------------------------------------------------------------------ VAT by quarter

export type VatQuarter = { label: string; from: string; to: string; out: number; inp: number; paid: number; other: number };

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthEnd = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).toISOString().slice(0, 10);

/** The VAT quarters (and part quarters at either end) that fall in the year, for a stagger of quarter-end months. */
export function vatPeriods(from: string, to: string, quarterEnds: number[]): { label: string; from: string; to: string }[] {
  const ends = [...quarterEnds].sort((a, b) => a - b); // months 1..12
  const out: { label: string; from: string; to: string }[] = [];
  let start = from;
  const y0 = Number(from.slice(0, 4));
  const cands: string[] = [];
  for (let y = y0; y <= y0 + 2; y++) for (const m of ends) cands.push(monthEnd(y, m - 1));
  cands.sort();
  for (const end of [...cands.filter((e) => e >= from && e < to), to]) {
    if (end < start) continue;
    const a = new Date(`${start}T00:00:00Z`), b = new Date(`${end}T00:00:00Z`);
    const label = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()
      ? `${MONTH[b.getUTCMonth()]} ${String(b.getUTCFullYear()).slice(2)}`
      : `${MONTH[a.getUTCMonth()]} ${String(a.getUTCFullYear()).slice(2)} to ${MONTH[b.getUTCMonth()]} ${String(b.getUTCFullYear()).slice(2)}`;
    out.push({ label, from: start, to: end });
    start = new Date(b.getTime() + 86400000).toISOString().slice(0, 10);
    if (end === to) break;
  }
  return out;
}

const SALES_DOC = /ACCREC|SALE|RECEIVE|ARCREDIT|AR_|RECEIVABLE|CUSTOMER/i;
const PURCHASE_DOC = /ACCPAY|BILL|PURCHASE|SPEND|APCREDIT|AP_|PAYABLE|SUPPLIER|EXPENSE/i;
const BANK_DOC = /PAYMENT|BANK|TRANSFER|SPEND|RECEIVE/i;

/** Output VAT, input VAT, payments and other entries on the VAT account, by quarter. */
export function vatByQuarter(lines: LedgerLine[], vatKey: string, from: string, to: string, quarterEnds: number[]): VatQuarter[] {
  const periods = vatPeriods(from, to, quarterEnds).map((p) => ({ ...p, out: 0, inp: 0, paid: 0, other: 0 }));
  for (const l of lines) {
    if (l.a !== vatKey) continue;
    const p = periods.find((x) => l.d >= x.from && l.d <= x.to);
    if (!p) continue;
    const t = l.t || "";
    const noRate = !l.rate || /no vat|no tax|exempt|none|zero|outside/i.test(l.rate);
    if (l.x === "VAT" || !noRate) {
      if (PURCHASE_DOC.test(t) && !SALES_DOC.test(t)) p.inp = r2(p.inp + l.amt);
      else if (SALES_DOC.test(t)) p.out = r2(p.out - l.amt);
      else if (l.amt < 0) p.out = r2(p.out - l.amt);
      else p.inp = r2(p.inp + l.amt);
    } else if (BANK_DOC.test(t)) p.paid = r2(p.paid + l.amt);
    else p.other = r2(p.other + l.amt);
  }
  return periods;
}

// ------------------------------------------------------------------ payroll by month

export type PayMonth = { label: string; month: string; gross: number; paye: number; studentLoan: number; eeni: number; eepen: number; erni: number; erpen: number; net: number; runs: number };

/** Payslips summed by the month they were paid in. */
export function payrollByMonth(runs: { paymentDate: string; slips: Doc[] }[]): PayMonth[] {
  const by = new Map<string, PayMonth>();
  for (const run of runs) {
    const month = run.paymentDate.slice(0, 7);
    const d = new Date(`${month}-01T00:00:00Z`);
    const m = by.get(month) || { label: `${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`, month, gross: 0, paye: 0, studentLoan: 0, eeni: 0, eepen: 0, erni: 0, erpen: 0, net: 0, runs: 0 };
    m.runs++;
    for (const s of run.slips) {
      m.gross += num(s.grossEarnings ?? s.totalEarnings);
      m.net += num(s.totalPay);
      for (const t of s.employeeTaxLines || []) {
        const name = String(t.description || "");
        if (/student|postgrad/i.test(name)) m.studentLoan += num(t.amount);
        else if (/national insurance|\bni\b|nic/i.test(name)) m.eeni += num(t.amount);
        else m.paye += num(t.amount);
      }
      for (const t of s.employerTaxLines || []) m.erni += num(t.amount);
      for (const dl of s.deductionLines || []) m.eepen += num(dl.amount);
      for (const bl of s.benefitLines || []) if (/pension/i.test(String(bl.displayName || "pension"))) m.erpen += num(bl.amount);
    }
    by.set(month, m);
  }
  return [...by.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).map((m) => ({ ...m, gross: r2(m.gross), paye: r2(m.paye), studentLoan: r2(m.studentLoan), eeni: r2(m.eeni), eepen: r2(m.eepen), erni: r2(m.erni), erpen: r2(m.erpen), net: r2(m.net) }));
}

// ------------------------------------------------------------------ the import

export type ImportPart = "tb" | "ledger" | "lists" | "bank" | "vat" | "payroll";
export type XeroImport = {
  tb: TbLine[];
  priorTb: TbLine[];
  book: XeroBook;
  debtors: ContactBalance[];
  creditors: ContactBalance[];
  vat: VatQuarter[];
  payroll: PayMonth[];
  /** short notes on what came in and what didn't */
  log: string[];
  problems: string[];
};

async function pagedAccounting(api: XeroApi, tenantId: string, path: string, listKey: string, query: Query, onPage?: (n: number) => void): Promise<Doc[]> {
  const out: Doc[] = [];
  for (let page = 1; page < 500; page++) {
    const json: any = await api.get(tenantId, "accounting", path, { ...query, page, pageSize: 500 });
    const list: Doc[] = json?.[listKey] || [];
    out.push(...list);
    onPage?.(out.length);
    const count = json?.pagination?.pageCount;
    if (!list.length || (count && page >= count)) break;
  }
  return out;
}

const scopeMissing = (e: unknown) => e instanceof XeroError && (e.code === "scope" || e.code === "forbidden");

/** Read everything asked for, for one organisation and one year. */
export async function readFromXero(
  api: XeroApi,
  t: { tenantId: string; tenantName: string },
  period: string,
  parts: Set<ImportPart>,
  opts: { quarterEnds: number[]; progress?: (msg: string) => void },
): Promise<XeroImport> {
  const say = opts.progress || (() => undefined);
  const from = yearStart(period), to = period;
  const priorEnd = new Date(new Date(`${from}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  const log: string[] = [], problems: string[] = [];
  const id = t.tenantId;

  say("Reading the chart of accounts…");
  const accounts = parseAccounts(await api.get(id, "accounting", "Accounts"));
  const sys = (s: string) => accounts.find((a) => a.sys === s);

  let tb: TbLine[] = [], priorTb: TbLine[] = [];
  const needTb = parts.has("tb") || parts.has("ledger") || parts.has("bank");
  if (needTb) {
    say("Reading the trial balances…");
    try {
      tb = parseTrialBalance(await api.get(id, "accounting", "Reports/TrialBalance", { date: to }), accounts);
      priorTb = parseTrialBalance(await api.get(id, "accounting", "Reports/TrialBalance", { date: priorEnd }), accounts);
      const dr = r2(tb.reduce((a, l) => a + (l.f.dr || 0), 0)), cr = r2(tb.reduce((a, l) => a + (l.f.cr || 0), 0));
      log.push(`Trial balance at ${to}: ${tb.length} accounts, debits ${dr.toFixed(2)}, credits ${cr.toFixed(2)}${Math.abs(dr - cr) > 0.004 ? " (doesn't balance)" : ""}. Last year's: ${priorTb.length} accounts.`);
    } catch (e) {
      if (!scopeMissing(e)) throw e;
      problems.push("The trial balance couldn't be read: tick \"Trial balance and bank summary reports\" in Settings › Xero and connect again.");
    }
  }

  const book: XeroBook = {
    v: 1, tenantId: id, tenantName: t.tenantName, period, from, to, at: new Date().toISOString(), source: "none",
    accounts, opening: balancesOf(priorTb), closing: balancesOf(tb), lines: [], unreconciled: [], bank: [], notes: [],
  };

  // the nominal ledger
  let docs: Documents | null = null;
  const docGaps: string[] = [];
  let docWhy = "";
  const readDocs = async (): Promise<Documents | null> => {
    if (docs) return docs;
    const between = `Date >= ${whereDate(from)} AND Date <= ${whereDate(to)}`;
    // each kind is read on its own: Xero can refuse one (a user without bank access, say) and still allow the rest
    const part = async <T,>(label: string, fn: () => Promise<T>, empty: T): Promise<T> => {
      say(`Reading ${label}…`);
      try {
        return await fn();
      } catch (e) {
        if (!scopeMissing(e)) throw e;
        docGaps.push(label);
        if (!docWhy && e instanceof XeroError) docWhy = e.message;
        return empty;
      }
    };
    const invoices = await part("invoices and bills", () => pagedAccounting(api, id, "Invoices", "Invoices", { where: between }, (n) => say(`Reading invoices and bills… ${n}`)), [] as Doc[]);
    if (docGaps.includes("invoices and bills")) return null;
    const creditNotes = await part("credit notes", () => pagedAccounting(api, id, "CreditNotes", "CreditNotes", { where: between }), [] as Doc[]);
    const payments = await part("payments", () => pagedAccounting(api, id, "Payments", "Payments", { where: between }, (n) => say(`Reading payments… ${n}`)), [] as Doc[]);
    const bankTransactions = await part("bank transactions", () => pagedAccounting(api, id, "BankTransactions", "BankTransactions", { where: between }, (n) => say(`Reading bank transactions… ${n}`)), [] as Doc[]);
    const bankTransfers = await part("bank transfers", async () => ((await api.get(id, "accounting", "BankTransfers", { where: between })) as any)?.BankTransfers || [], [] as Doc[]);
    const manualJournals = await part("manual journals", () => pagedAccounting(api, id, "ManualJournals", "ManualJournals", { where: between }), [] as Doc[]);
    docs = { invoices, creditNotes, payments, bankTransactions, bankTransfers, manualJournals };
    return docs;
  };

  let ledgerFromApi = false;
  if (parts.has("ledger") || parts.has("vat") || parts.has("lists")) {
    say("Reading the nominal ledger…");
    try {
      book.lines = await accountDataLines(api, id, { startDate: from, endDate: to }, (n) => say(`Reading the nominal ledger… ${n} lines`));
      book.source = "accountdata";
      ledgerFromApi = true;
      log.push(`Nominal ledger: ${book.lines.length} transaction lines from Xero's Account Data API.`);
    } catch (e) {
      if (!scopeMissing(e) && !(e instanceof XeroError && e.code === "not-found")) throw e;
      const d = await readDocs();
      if (d) {
        book.lines = rebuildLedger(d, accounts, from, to);
        book.source = "rebuilt";
        log.push(`Nominal ledger: ${book.lines.length} lines rebuilt from ${d.invoices.length} invoices and bills, ${d.payments.length} payments, ${d.bankTransactions.length} bank transactions and ${d.manualJournals.length} manual journals (the Account Data API isn't available to this connection).`);
        if (docGaps.length) book.notes.push(`Xero wouldn't let this connection read ${docGaps.join(", ")}, so the ledger is missing those.`);
        book.notes.push("Rebuilt from documents: payroll postings, fixed asset depreciation, currency revaluations and conversion balances aren't included, so some accounts won't reach the trial balance.");
      } else {
        problems.push(`The nominal ledger couldn't be read. ${docWhy || (e instanceof XeroError ? e.message : "")} If you've already ticked "Nominal ledger transactions" or "Invoices, bills…" in Settings › Xero and connected again, check your Xero user can see this organisation's invoices (Xero refuses a user with limited access, even when the app has the scope).`.replace(/\s+/g, " "));
      }
    }
    if (book.lines.length && tb.length) {
      const off = [...ledgerCheck(book).entries()].filter(([, c]) => Math.abs(c.diff) > 0.005);
      if (off.length) book.notes.push(`${off.length} account${off.length === 1 ? "" : "s"} where the year's transactions don't reach the trial balance movement.`);
    }
  }

  // debtors and creditors at the year end
  let debtors: ContactBalance[] = [], creditors: ContactBalance[] = [];
  if (parts.has("lists")) {
    const dc = sys("DEBTORS"), cc = sys("CREDITORS");
    say("Working out customers' and suppliers' balances…");
    let done = false;
    if (ledgerFromApi) {
      try {
        const all = await accountDataLines(api, id, { startDate: "2000-01-01", endDate: to, systemAccountCodes: ["DEBTORS", "CREDITORS"] }, (n) => say(`Reading the control accounts… ${n} lines`));
        if (dc) debtors = contactBalances(all, dc.key);
        if (cc) creditors = contactBalances(all, cc.key).map((x) => ({ ...x, balance: -x.balance }));
        done = true;
      } catch (e) {
        if (!scopeMissing(e)) throw e;
      }
    }
    if (!done) {
      try {
        const open = `Date <= ${whereDate(to)} AND (Status == "AUTHORISED" OR FullyPaidOnDate > ${whereDate(to)})`;
        const invs = await pagedAccounting(api, id, "Invoices", "Invoices", { where: open }, (n) => say(`Reading unpaid invoices… ${n}`));
        debtors = outstandingFromInvoices(invs, "ACCREC", to);
        creditors = outstandingFromInvoices(invs, "ACCPAY", to).map((x) => ({ ...x, balance: -x.balance }));
        done = true;
        book.notes.push("Customers' and suppliers' balances are from invoices and bills less payments and credits dated by the year end; unallocated credit notes and overpayments aren't included.");
      } catch (e) {
        if (!scopeMissing(e)) throw e;
        problems.push("Customers' and suppliers' balances couldn't be worked out without the ledger or the invoices.");
      }
    }
    if (done) {
      const sumOf = (l: ContactBalance[]) => r2(l.reduce((a, x) => a + x.balance, 0));
      log.push(`Debtors listing: ${debtors.length} customers, ${sumOf(debtors).toFixed(2)}${dc ? ` (trial balance ${(book.closing[dc.key] || 0).toFixed(2)})` : ""}. Creditors listing: ${creditors.length} suppliers, ${sumOf(creditors).toFixed(2)}${cc ? ` (trial balance ${(-(book.closing[cc.key] || 0)).toFixed(2)})` : ""}.`);
    }
  }

  // bank: summary and the transactions not yet reconciled at the year end
  if (parts.has("bank")) {
    say("Reading the bank summary…");
    try {
      book.bank = parseBankSummary(await api.get(id, "accounting", "Reports/BankSummary", { fromDate: from, toDate: to }), accounts);
      log.push(`Bank summary: ${book.bank.length} bank account${book.bank.length === 1 ? "" : "s"}.`);
    } catch (e) {
      if (!scopeMissing(e)) throw e;
      problems.push("The bank summary couldn't be read (needs the reports access).");
    }
    say("Finding unreconciled bank items…");
    try {
      const where = `IsReconciled == false AND Date <= ${whereDate(to)}`;
      const txns = await pagedAccounting(api, id, "BankTransactions", "BankTransactions", { where: `${where} AND Status == "AUTHORISED"` });
      const pays = await pagedAccounting(api, id, "Payments", "Payments", { where: `${where} AND Status == "AUTHORISED"` });
      const keyOf = (code?: string, aid?: string, name?: string) => accounts.find((a) => (aid && a.id === aid) || (code && a.code === code))?.key || acctKey(code || "", name || "");
      for (const b of txns) {
        const sign = /^RECEIVE/.test(b.Type) ? 1 : -1;
        book.unreconciled.push({ d: xDate(b.DateString || b.Date), a: keyOf(b.BankAccount?.Code, b.BankAccount?.AccountID, b.BankAccount?.Name), amt: r2(sign * num(b.Total)), c: b.Contact?.Name, r: b.Reference, x: b.LineItems?.[0]?.Description, t: b.Type });
      }
      for (const p of pays) {
        const sign = /^(ACCRECPAYMENT|APCREDITPAYMENT|APOVERPAYMENTPAYMENT|APPREPAYMENTPAYMENT)$/.test(p.PaymentType) ? 1 : -1;
        book.unreconciled.push({ d: xDate(p.DateString || p.Date), a: keyOf(p.Account?.Code, p.Account?.AccountID), amt: r2(sign * num(p.Amount)), c: p.Invoice?.Contact?.Name, r: p.Invoice?.InvoiceNumber || p.Reference, x: p.Reference, t: p.PaymentType || "PAYMENT" });
      }
      book.unreconciled.sort((a, b) => (a.d < b.d ? -1 : 1));
      log.push(`Unreconciled bank items dated by the year end: ${book.unreconciled.length}.`);
      book.notes.push("Unreconciled items are those Xero still shows as unreconciled today; items dated before the year end and reconciled since then don't appear.");
    } catch (e) {
      if (!scopeMissing(e)) throw e;
      problems.push("Unreconciled bank items couldn't be read (needs \"Invoices, bills… bank transactions\").");
    }
  }

  // VAT by quarter, from the VAT account's lines
  let vat: VatQuarter[] = [];
  if (parts.has("vat")) {
    const v = sys("GST") || accounts.find((a) => /^vat$|vat control|^vat liability/i.test(a.name));
    if (!v) problems.push("No VAT account was found in the chart of accounts.");
    else if (!book.lines.length) problems.push("VAT needs the nominal ledger, which couldn't be read.");
    else {
      vat = vatByQuarter(book.lines, v.key, from, to, opts.quarterEnds);
      log.push(`VAT: ${vat.length} periods from the ${v.name} account.`);
    }
  }

  // payroll by month
  let payroll: PayMonth[] = [];
  if (parts.has("payroll")) {
    say("Reading pay runs…");
    try {
      const runs: Doc[] = [];
      for (let page = 1; page < 50; page++) {
        const j: any = await api.get(id, "payroll", "PayRuns", { page });
        const list: Doc[] = j?.payRuns || [];
        runs.push(...list);
        if (!list.length || (j?.pagination?.pageCount && page >= j.pagination.pageCount)) break;
      }
      const inYear = runs.filter((r) => /posted/i.test(String(r.payRunStatus || "posted")) && xDate(r.paymentDate) >= from && xDate(r.paymentDate) <= to);
      const withSlips: { paymentDate: string; slips: Doc[] }[] = [];
      for (const [i, r] of inYear.entries()) {
        say(`Reading payslips… pay run ${i + 1} of ${inYear.length}`);
        const slips: Doc[] = [];
        for (let page = 1; page < 50; page++) {
          const j: any = await api.get(id, "payroll", "Payslips", { PayRunID: r.payRunID, page });
          const list: Doc[] = j?.paySlips || [];
          slips.push(...list);
          if (!list.length || (j?.pagination?.pageCount && page >= j.pagination.pageCount) || list.length < 100) break;
        }
        withSlips.push({ paymentDate: xDate(r.paymentDate), slips });
      }
      payroll = payrollByMonth(withSlips);
      log.push(`Payroll: ${inYear.length} pay run${inYear.length === 1 ? "" : "s"} in the year, ${payroll.length} month${payroll.length === 1 ? "" : "s"}.`);
    } catch (e) {
      if (!scopeMissing(e) && !(e instanceof XeroError && e.code === "not-found")) throw e;
      problems.push("Payroll couldn't be read: tick \"Payroll (UK)\" in Settings › Xero and connect again (and Xero Payroll has to be used for this company).");
    }
  }

  return { tb, priorTb, book, debtors, creditors, vat, payroll, log, problems };
}

// ------------------------------------------------------------------ linking companies to Xero organisations

const normCo = (s: string) => s.toLowerCase().replace(/\b(limited|ltd|the|plc|llp|co|company|uk)\b/g, "").replace(/[^a-z0-9]+/g, "");

/** The likely Practice Planner client for a Xero organisation, by name. */
export function matchClient<T extends { Key: string; Title: string }>(tenantName: string, clients: T[]): T | undefined {
  const n = normCo(tenantName);
  if (!n) return undefined;
  return clients.find((c) => normCo(c.Title) === n) || clients.find((c) => { const m = normCo(c.Title); return m.length > 4 && (m.startsWith(n) || n.startsWith(m)); });
}

export const LEDGER_FOLDER = "Practice Planner Xero";
/** The ledger file's OneDrive item path (add ":/content" to upload to it). */
export const ledgerItem = (clientKey: string, period: string) => `/me/drive/root:/${encodeURIComponent(LEDGER_FOLDER)}/${encodeURIComponent(clientKey)}/${encodeURIComponent(`${period} ledger.json`)}`;
