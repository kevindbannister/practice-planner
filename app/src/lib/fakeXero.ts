// A stand-in for the Xero bridge in the demo build: one made-up organisation with two years of
// invented books (sales, purchases, overheads, payroll, VAT, loan, accruals, depreciation),
// answered in Xero's own formats so the real import code runs against it. All figures are invented.

import { SCOPE_GROUPS, SealedStore, XeroApi, XeroError, XeroStatus, XeroTenant, Query } from "./xero";

type Acct = { code: string; name: string; type: string; cls: string; sys: string; id: string };
type Line = { code: string; amt: number; tax?: number; rate?: string; desc?: string };
type Entry = { no: number; date: string; type: string; contact?: string; ref?: string; desc?: string; lines: Line[]; reconciled?: boolean };

const ACCOUNTS: Acct[] = [
  ["090", "Business Bank Account", "BANK", "ASSET", ""], ["091", "Business Savings Account", "BANK", "ASSET", ""],
  ["610", "Accounts Receivable", "CURRENT", "ASSET", "DEBTORS"], ["620", "Prepayments", "CURRENT", "ASSET", ""],
  ["720", "Plant and Machinery", "FIXED", "ASSET", ""], ["721", "Plant and Machinery Depreciation", "FIXED", "ASSET", ""],
  ["800", "Accounts Payable", "CURRLIAB", "LIABILITY", "CREDITORS"], ["810", "Accruals", "CURRLIAB", "LIABILITY", ""],
  ["820", "VAT", "CURRLIAB", "LIABILITY", "GST"], ["825", "PAYE Payable", "CURRLIAB", "LIABILITY", ""],
  ["826", "Pensions Payable", "CURRLIAB", "LIABILITY", ""], ["835", "Directors' Loan Account", "CURRLIAB", "LIABILITY", ""],
  ["900", "Bank Loan", "TERMLIAB", "LIABILITY", ""], ["950", "Capital - Ordinary Shares", "EQUITY", "EQUITY", ""],
  ["960", "Retained Earnings", "EQUITY", "EQUITY", "RETAINEDEARNINGS"], ["200", "Sales", "REVENUE", "REVENUE", ""],
  ["310", "Cost of Goods Sold", "DIRECTCOSTS", "EXPENSE", ""], ["401", "Accountancy Fees", "OVERHEADS", "EXPENSE", ""],
  ["404", "Bank Fees", "OVERHEADS", "EXPENSE", ""], ["416", "Depreciation", "DEPRECIATN", "EXPENSE", ""],
  ["437", "Interest Paid", "OVERHEADS", "EXPENSE", ""], ["445", "Light, Power, Heating", "OVERHEADS", "EXPENSE", ""],
  ["461", "Printing & Stationery", "OVERHEADS", "EXPENSE", ""], ["477", "Salaries", "WAGESEXPENSE", "EXPENSE", ""],
  ["478", "Employers National Insurance", "OVERHEADS", "EXPENSE", ""], ["479", "Employers Pensions", "OVERHEADS", "EXPENSE", ""],
  ["489", "Telephone & Internet", "OVERHEADS", "EXPENSE", ""], ["493", "Travel - National", "OVERHEADS", "EXPENSE", ""],
].map(([code, name, type, cls, sys], i) => ({ code, name, type, cls, sys, id: `0000${String(i + 1).padStart(4, "0")}-aaaa-4bbb-8ccc-${String(1000 + i).padStart(12, "0")}` }));

const TENANT: XeroTenant = { id: "c0ffee00-0000-4000-8000-000000000001", tenantId: "d3m0d3m0-0000-4000-8000-000000000083".replace(/m/g, "0"), tenantName: "The Kent Stove Company Ltd (demo figures)", tenantType: "ORGANISATION", createdDateUtc: "2026-10-21T09:00:00" };
const CUSTOMERS = ["Ashford Fireplaces", "Hythe Homes", "Rye Building Supplies", "Tenterden Interiors", "Weald Stove Centre"];
const SUPPLIERS = ["Stovax Supplies", "Kent Steel Fabrication", "Hearth & Home Wholesale"];

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (y: number, m0: number, d: number) => new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10);
const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Invented books from May 2024 to April 2026 (year end 30 April). */
function makeBooks(): Entry[] {
  let seed = 83;
  const rnd = (lo: number, hi: number) => {
    seed = (seed * 9301 + 49297) % 233280;
    return r2(lo + (seed / 233280) * (hi - lo));
  };
  const out: Entry[] = [];
  let no = 1;
  const add = (e: Omit<Entry, "no">) => out.push({ ...e, no: no++ });
  add({ date: "2024-04-30", type: "CONVERSION", desc: "Conversion balances", lines: [
    { code: "090", amt: 25000 }, { code: "720", amt: 30000 }, { code: "721", amt: -12000 }, { code: "950", amt: -100 }, { code: "900", amt: -30000 }, { code: "960", amt: -12900 },
  ] });
  const lastDay = "2026-04-30";
  let inv = 1001, bill = 1;
  for (let k = 0; k < 24; k++) {
    const y = 2024 + Math.floor((4 + k) / 12), m0 = (4 + k) % 12;
    // sales: four invoices a month, paid 30-45 days later
    for (let i = 0; i < 4; i++) {
      const date = iso(y, m0, 3 + i * 7), net = rnd(1500, 6000), vat = r2(net * 0.2), c = CUSTOMERS[(k + i) % CUSTOMERS.length], ref = `INV-${inv++}`;
      add({ date, type: "ACCREC", contact: c, ref, desc: "Stove supply and fitting", lines: [{ code: "200", amt: -net, tax: -vat, rate: "20% (VAT on Income)", desc: "Stove supply and fitting" }, { code: "820", amt: -vat, desc: "VAT" }, { code: "610", amt: r2(net + vat) }] });
      const paid = addDays(date, 30 + ((k + i) % 16));
      if (paid <= "2026-06-30" && !(date > "2026-03-20" && i % 2 === 0)) add({ date: paid, type: "ACCRECPAYMENT", contact: c, ref, desc: "Payment received", lines: [{ code: "090", amt: r2(net + vat) }, { code: "610", amt: -r2(net + vat) }], reconciled: paid < "2026-04-28" });
    }
    // purchases: three bills a month, paid a month later
    for (let i = 0; i < 3; i++) {
      const date = iso(y, m0, 5 + i * 8), net = rnd(800, 3500), vat = r2(net * 0.2), c = SUPPLIERS[i], ref = `BILL-${bill++}`;
      add({ date, type: "ACCPAY", contact: c, ref, desc: "Stock and materials", lines: [{ code: "310", amt: net, tax: vat, rate: "20% (VAT on Expenses)", desc: "Stock and materials" }, { code: "820", amt: vat, desc: "VAT" }, { code: "800", amt: -r2(net + vat) }] });
      const paid = addDays(date, 31);
      if (paid <= lastDay || i === 0) add({ date: paid, type: "ACCPAYPAYMENT", contact: c, ref, desc: "Payment made", lines: [{ code: "800", amt: r2(net + vat) }, { code: "090", amt: -r2(net + vat) }], reconciled: paid < "2026-04-27" });
    }
    // overheads paid from the bank
    const spend = (day: number, code: string, net: number, rate: number, c: string, desc: string) => {
      const vat = r2(net * rate), date = iso(y, m0, day);
      const lines: Line[] = [{ code, amt: net, tax: vat, rate: rate ? `${rate * 100}% (VAT on Expenses)` : "No VAT", desc }];
      if (vat) lines.push({ code: "820", amt: vat, desc: "VAT" });
      lines.push({ code: "090", amt: -r2(net + vat) });
      add({ date, type: "SPEND", contact: c, desc, lines, reconciled: date < "2026-04-26" });
    };
    spend(12, "445", rnd(180, 320), 0.05, "South East Energy", "Electricity");
    spend(14, "489", 62.5, 0.2, "BT Business", "Phone and broadband");
    spend(18, "493", rnd(60, 220), 0, "Southeastern Railway", "Train fares");
    if (k % 3 === 0) spend(20, "461", rnd(40, 120), 0.2, "Viking Direct", "Stationery");
    spend(28, "404", 15, 0, "NatWest", "Account fee");
    spend(28, "437", rnd(110, 130), 0, "NatWest", "Loan interest");
    add({ date: iso(y, m0, 28), type: "SPEND", contact: "NatWest", desc: "Loan repayment", lines: [{ code: "900", amt: 500 }, { code: "090", amt: -500 }], reconciled: true });
    // payroll on the 25th
    const g = [2600, 2250], paye = r2(g.reduce((a, x) => a + (x - 1048) * 0.2, 0)), eeni = r2(g.reduce((a, x) => a + (x - 1048) * 0.08, 0)), erni = r2(g.reduce((a, x) => a + (x - 417) * 0.15, 0));
    const eepen = r2((g[0] + g[1]) * 0.05), erpen = r2((g[0] + g[1]) * 0.03), gross = g[0] + g[1], net = r2(gross - paye - eeni - eepen);
    add({ date: iso(y, m0, 25), type: "PAYRUN", desc: "Pay run", lines: [
      { code: "477", amt: gross }, { code: "478", amt: erni }, { code: "479", amt: erpen }, { code: "825", amt: -r2(paye + eeni + erni) }, { code: "826", amt: -r2(eepen + erpen) }, { code: "090", amt: -net },
    ], reconciled: true });
    // last month's PAYE and pension, paid on the 22nd
    if (k > 0) {
      const due = r2(paye + eeni + erni), pen = r2(eepen + erpen);
      add({ date: iso(y, m0, 22), type: "SPEND", contact: "HMRC PAYE", desc: "PAYE and NI", lines: [{ code: "825", amt: due, rate: "No VAT" }, { code: "090", amt: -due }], reconciled: true });
      add({ date: iso(y, m0, 22), type: "SPEND", contact: "NEST Pensions", desc: "Pension contributions", lines: [{ code: "826", amt: pen, rate: "No VAT" }, { code: "090", amt: -pen }], reconciled: true });
    }
    // directors' drawings now and then
    if (k % 2 === 1) add({ date: iso(y, m0, 15), type: "SPEND", contact: "A French", desc: "Director's drawings", lines: [{ code: "835", amt: 1200, rate: "No VAT" }, { code: "090", amt: -1200 }], reconciled: true });
  }
  // VAT: each quarter (ending Mar, Jun, Sep, Dec) paid five weeks later
  const sorted = () => out.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const qEnds = ["2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"];
  for (const end of qEnds) {
    const bal = r2(sorted().filter((e) => e.date <= end).reduce((a, e) => a + e.lines.filter((l) => l.code === "820").reduce((s, l) => s + l.amt, 0), 0));
    const date = addDays(end, 37);
    if (date > "2026-06-30") continue;
    add({ date, type: "SPEND", contact: "HMRC VAT", desc: `VAT return to ${end}`, lines: [{ code: "820", amt: -bal, rate: "No VAT" }, { code: "090", amt: bal }], reconciled: date < "2026-04-26" });
  }
  // year end journals: accountancy accrual (reversed the next day), depreciation, a prepayment
  for (const [ye, accrual, dep] of [["2025-04-30", 2100, 3600], ["2026-04-30", 2400, 3240]] as const) {
    add({ date: ye, type: "MANJOURNAL", ref: "Accrual", desc: "Accountancy fee accrual", lines: [{ code: "401", amt: accrual }, { code: "810", amt: -accrual }] });
    add({ date: addDays(ye, 1), type: "MANJOURNAL", ref: "Accrual reversed", desc: "Accountancy fee accrual reversed", lines: [{ code: "401", amt: -accrual }, { code: "810", amt: accrual }] });
    add({ date: ye, type: "MANJOURNAL", ref: "Depreciation", desc: "Depreciation for the year", lines: [{ code: "416", amt: dep }, { code: "721", amt: -dep }] });
  }
  add({ date: "2026-04-30", type: "MANJOURNAL", ref: "Prepayment", desc: "Insurance paid in advance", lines: [{ code: "620", amt: 640 }, { code: "445", amt: -640 }] });
  add({ date: "2026-04-15", type: "TRANSFER", desc: "Transfer to savings", lines: [{ code: "091", amt: 5000 }, { code: "090", amt: -5000 }], reconciled: true });
  return sorted().map((e, i) => ({ ...e, no: i + 1 }));
}

const byCode = new Map(ACCOUNTS.map((a) => [a.code, a]));
const PL = new Set(["REVENUE", "DIRECTCOSTS", "OVERHEADS", "DEPRECIATN", "WAGESEXPENSE", "EXPENSE", "OTHERINCOME", "SALES"]);
const fyStart = (d: string) => (d.slice(5) >= "05-01" ? `${d.slice(0, 4)}-05-01` : `${Number(d.slice(0, 4)) - 1}-05-01`);
const xDateOut = (d: string) => `${d}T00:00:00`;

export class FakeXero implements XeroApi {
  private books = makeBooks();
  constructor(private sealed: SealedStore) {}

  private granted(): string[] {
    const s = this.sealed.read();
    if (!s || !s.startsWith("demo:")) return [];
    try {
      return JSON.parse(atob(s.slice(5).replace(/-/g, "+").replace(/_/g, "/"))) as string[];
    } catch {
      return [];
    }
  }
  private need(...groupKeys: string[]) {
    const have = this.granted();
    if (!have.length) throw new XeroError("reconnect", "Connect to Xero first (Settings › Xero).");
    for (const k of groupKeys) {
      const g = SCOPE_GROUPS.find((x) => x.key === k)!;
      if (![...g.scopes, ...(g.classic || [])].some((s) => have.includes(s))) throw new XeroError("scope", "This Xero connection wasn't given access to that information. Tick it in Settings › Xero and connect again.");
    }
  }

  async status(): Promise<XeroStatus> {
    return { configured: true, redirectUri: `${location.origin}/api/xero/callback` };
  }
  async start(scopes: string[]): Promise<string> {
    return `#/settings/xero/connected/demo:${btoa(JSON.stringify(scopes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  }
  async connections() {
    if (!this.granted().length) throw new XeroError("reconnect", "Connect to Xero first (Settings › Xero).");
    return { tenants: [TENANT], scopes: this.granted(), since: "2026-10-21T09:00:00Z" };
  }
  async disconnect(connectionId?: string) {
    if (!connectionId) await this.sealed.write(undefined);
  }

  // ---- the books as Xero would report them

  private balanceAt(code: string, date: string): number {
    const a = byCode.get(code)!;
    let lines = this.books.filter((e) => e.date <= date);
    if (PL.has(a.type)) lines = lines.filter((e) => e.date >= fyStart(date));
    let sum = lines.reduce((t, e) => t + e.lines.filter((l) => l.code === code).reduce((s, l) => s + l.amt, 0), 0);
    if (a.sys === "RETAINEDEARNINGS") {
      // last years' profit and loss closes to retained earnings
      sum += this.books.filter((e) => e.date < fyStart(date)).reduce((t, e) => t + e.lines.filter((l) => PL.has(byCode.get(l.code)!.type)).reduce((s, l) => s + l.amt, 0), 0);
    }
    return r2(sum);
  }

  private report(name: string, head: string[], sections: { title: string; rows: { cells: string[]; id?: string }[] }[]) {
    return {
      Reports: [{
        ReportName: name, ReportType: name.replace(/\s/g, ""), Rows: [
          { RowType: "Header", Cells: head.map((Value) => ({ Value })) },
          ...sections.map((s) => ({ RowType: "Section", Title: s.title, Rows: s.rows.map((r) => ({ RowType: "Row", Cells: r.cells.map((Value, i) => ({ Value, ...(i === 0 && r.id ? { Attributes: [{ Value: r.id, Id: "account" }] } : {}) })) })) })),
        ],
      }],
    };
  }

  private trialBalance(date: string) {
    const groups: Record<string, string> = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", REVENUE: "Revenue", EXPENSE: "Expenses" };
    const sections = Object.entries(groups).map(([cls, title]) => ({
      title,
      rows: ACCOUNTS.filter((a) => a.cls === cls).map((a) => {
        const b = this.balanceAt(a.code, date);
        return b ? { cells: [`${a.name} (${a.code})`, "", "", b > 0 ? b.toFixed(2) : "", b < 0 ? (-b).toFixed(2) : ""], id: a.id } : null;
      }).filter(Boolean) as { cells: string[]; id: string }[],
    }));
    return this.report("Trial Balance", ["Account", "Debit", "Credit", "YTD Debit", "YTD Credit"], sections);
  }

  private accountData(q: Query) {
    let state: { from: string; to: string; sys?: string[]; offset: number };
    if (q.token) state = JSON.parse(atob(String(q.token)));
    else state = { from: String(q.startDate), to: String(q.endDate), sys: q.systemAccountCodes as string[] | undefined, offset: 0 };
    const all: any[] = [];
    for (const e of this.books) {
      if (e.date < state.from || e.date > state.to) continue;
      for (const l of e.lines) {
        const a = byCode.get(l.code)!;
        if (state.sys && !state.sys.includes(a.sys)) continue;
        all.push({
          journalNumber: e.no, journalDate: e.date, description: l.desc || e.desc,
          account: { id: a.id, code: a.code, name: a.name, class: a.cls, type: a.type, status: "ACTIVE", systemAccountCode: a.sys || "NONE" },
          netAmount: { value: Math.abs(l.amt), type: l.amt >= 0 ? "DEBIT" : "CREDIT" }, signedNetAmount: l.amt, signedTaxAmount: l.tax || 0,
          source: { documentType: e.type, contactName: e.contact || null, reference: e.ref || null },
          taxRate: { name: l.rate || null },
        });
      }
    }
    const page = all.slice(state.offset, state.offset + 200);
    const more = state.offset + 200 < all.length;
    return { currencyCode: "GBP", lines: page, pagination: more ? { pageSize: 200, nextToken: btoa(JSON.stringify({ ...state, offset: state.offset + 200 })) } : null };
  }

  private payroll(path: string, q: Query) {
    if (path === "PayRuns") {
      if (Number(q.page || 1) > 1) return { payRuns: [] };
      return { payRuns: this.books.filter((e) => e.type === "PAYRUN").map((e) => ({ payRunID: `9a7e0000-0000-4000-8000-${String(e.no).padStart(12, "0")}`, paymentDate: xDateOut(e.date), payRunStatus: "Posted" })) };
    }
    if (path === "Payslips") {
      if (Number(q.page || 1) > 1) return { paySlips: [] };
      const slip = (first: string, gross: number) => {
        const paye = r2((gross - 1048) * 0.2), eeni = r2((gross - 1048) * 0.08), erni = r2((gross - 417) * 0.15), eepen = r2(gross * 0.05), erpen = r2(gross * 0.03);
        return {
          firstName: first, lastName: "Demo", grossEarnings: gross, totalPay: r2(gross - paye - eeni - eepen),
          employeeTaxLines: [{ description: "PAYE", amount: paye }, { description: "National Insurance", amount: eeni }],
          employerTaxLines: [{ description: "National Insurance", amount: erni, isEmployerTax: true }],
          deductionLines: [{ amount: eepen }], benefitLines: [{ displayName: "Employer pension", amount: erpen }],
        };
      };
      return { paySlips: [slip("Sam", 2600), slip("Jo", 2250)] };
    }
    throw new XeroError("not-found", "Xero returned an error (404).");
  }

  private documents(path: string, q: Query) {
    const where = String(q.where || "");
    const page = Number(q.page || 1);
    const at = (op: string) => { const m = where.match(new RegExp(`\\bDate ${op} DateTime\\((\\d+),(\\d+),(\\d+)\\)`)); return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined; };
    const unreconciled = /IsReconciled == false/.test(where);
    const from = at(">=") || "1900-01-01", to = at("<=") || "2999-12-31";
    const pick = (types: RegExp) => this.books.filter((e) => types.test(e.type) && e.date >= from && e.date <= to && (!unreconciled || e.reconciled === false));
    const acc = (code: string) => ({ AccountID: byCode.get(code)!.id, Code: code, Name: byCode.get(code)!.name });
    const one = (list: any[], key: string) => ({ [key]: page === 1 ? list : [] });
    if (path === "Invoices") {
      return one(pick(/^(ACCREC|ACCPAY)$/).filter((e) => !unreconciled).map((e) => {
        const items = e.lines.filter((l) => !["820", "610", "800"].includes(l.code));
        const total = Math.abs(e.lines.find((l) => l.code === "610" || l.code === "800")!.amt);
        const pays = this.books.filter((p) => /PAYMENT$/.test(p.type) && p.ref === e.ref).map((p) => ({ Date: xDateOut(p.date), Amount: total }));
        return {
          Type: e.type, Status: pays.length ? "PAID" : "AUTHORISED", DateString: xDateOut(e.date), InvoiceNumber: e.ref, Contact: { Name: e.contact }, LineAmountTypes: "Exclusive", Total: total,
          LineItems: items.map((l) => ({ AccountCode: l.code, LineAmount: Math.abs(l.amt), TaxAmount: Math.abs(l.tax || 0), Description: l.desc, TaxType: l.rate })), Payments: pays,
        };
      }), "Invoices");
    }
    if (path === "Payments") {
      return one(pick(/PAYMENT$/).map((e) => {
        const bank = e.lines.find((l) => l.code === "090")!;
        return { PaymentType: e.type, Status: "AUTHORISED", DateString: xDateOut(e.date), Amount: Math.abs(bank.amt), Account: acc("090"), Invoice: { Type: e.type.replace("PAYMENT", ""), InvoiceNumber: e.ref, Contact: { Name: e.contact } }, Reference: e.ref, IsReconciled: e.reconciled !== false };
      }), "Payments");
    }
    if (path === "BankTransactions") {
      return one(pick(/^SPEND$/).map((e) => {
        const bank = e.lines.find((l) => l.code === "090" || l.code === "091")!;
        const items = e.lines.filter((l) => l !== bank && !(l.code === "820" && l.desc === "VAT"));
        const receive = bank.amt > 0;
        return {
          Type: receive ? "RECEIVE" : "SPEND", Status: "AUTHORISED", DateString: xDateOut(e.date), Contact: { Name: e.contact }, Reference: e.desc, BankAccount: acc(bank.code), LineAmountTypes: "Exclusive", Total: Math.abs(bank.amt), IsReconciled: e.reconciled !== false,
          LineItems: items.map((l) => ({ AccountCode: l.code, LineAmount: receive ? -l.amt : l.amt, TaxAmount: receive ? -(l.tax || 0) : l.tax || 0, Description: l.desc || e.desc, TaxType: l.rate })),
        };
      }), "BankTransactions");
    }
    if (path === "BankTransfers") return { BankTransfers: pick(/^TRANSFER$/).map((e) => ({ DateString: xDateOut(e.date), Amount: 5000, FromBankAccount: acc("090"), ToBankAccount: acc("091") })) };
    if (path === "ManualJournals") return one(pick(/^MANJOURNAL$/).map((e) => ({ Status: "POSTED", DateString: xDateOut(e.date), Narration: e.desc, LineAmountTypes: "NoTax", JournalLines: e.lines.map((l) => ({ AccountCode: l.code, LineAmount: l.amt, Description: l.desc || e.desc })) })), "ManualJournals");
    if (path === "CreditNotes") return { CreditNotes: [] };
    throw new XeroError("not-found", "Xero returned an error (404).");
  }

  async get<T = any>(tenantId: string, api: string, path: string, query: Query = {}): Promise<T> {
    if (tenantId !== TENANT.tenantId) throw new XeroError("forbidden", "Xero refused.");
    await new Promise((r) => setTimeout(r, 15));
    if (api === "accounting" && path === "Accounts") {
      this.need("core");
      return { Accounts: ACCOUNTS.map((a) => ({ AccountID: a.id, Code: a.code, Name: a.name, Type: a.type, Class: a.cls, SystemAccount: a.sys || undefined, Status: "ACTIVE" })) } as T;
    }
    if (api === "accounting" && path === "Reports/TrialBalance") {
      this.need("reports");
      return this.trialBalance(String(query.date)) as T;
    }
    if (api === "accounting" && path === "Reports/BankSummary") {
      this.need("reports");
      const from = String(query.fromDate), to = String(query.toDate);
      const rows = ACCOUNTS.filter((a) => a.type === "BANK").map((a) => {
        const open = this.balanceAt(a.code, addDays(from, -1)), close = this.balanceAt(a.code, to);
        let rec = 0, sp = 0;
        for (const e of this.books) if (e.date >= from && e.date <= to) for (const l of e.lines) if (l.code === a.code) (l.amt > 0 ? (rec += l.amt) : (sp -= l.amt));
        return { cells: [a.name, open.toFixed(2), rec.toFixed(2), sp.toFixed(2), close.toFixed(2)], id: a.id };
      });
      return this.report("Bank Summary", ["Bank Accounts", "Opening Balance", "Cash Received", "Cash Spent", "Closing Balance"], [{ title: "", rows }]) as T;
    }
    if (api === "accounting") {
      this.need("documents");
      return this.documents(path, query) as T;
    }
    if (api === "accountdata") {
      this.need("ledger");
      return this.accountData(query) as T;
    }
    if (api === "payroll") {
      this.need("payroll");
      return this.payroll(path, query) as T;
    }
    throw new XeroError("not-found", "Xero returned an error (404).");
  }
}
