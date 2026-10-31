// Ways of looking at one account's transactions from Xero, to focus on what matters: a filtered list,
// a summary grouped by month, contact or type, a control account's movement, and the VAT and PAYE
// reconciliations. Pure functions over the ledger lines; the screens are in ui/XeroLedger.tsx.
import { LedgerLine, VatQuarter, r2, vatByQuarter } from "./xero";

export type Filter = { q?: string; type?: string; contact?: string; from?: string; to?: string };

export function filterLines(lines: LedgerLine[], f: Filter, label: (t?: string) => string = (t) => t || ""): LedgerLine[] {
  const s = (f.q || "").trim().toLowerCase();
  return lines.filter((l) => {
    if (f.type && (l.t || "") !== f.type) return false;
    if (f.contact && (l.c || "") !== f.contact) return false;
    if (f.from && l.d < f.from) return false;
    if (f.to && l.d > f.to) return false;
    if (!s) return true;
    return [l.c, l.r, l.x, label(l.t), l.d, l.amt.toFixed(2)].some((v) => String(v || "").toLowerCase().includes(s));
  });
}

export type Group = { key: string; label: string; count: number; dr: number; cr: number; net: number };
export type GroupBy = "month" | "contact" | "type";
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Lines summed under month, contact or type: debits, credits and the net movement. Months run in date order, the rest largest first. */
export function groupLines(lines: LedgerLine[], by: GroupBy, label: (t?: string) => string = (t) => t || ""): Group[] {
  const g = new Map<string, Group>();
  for (const l of lines) {
    const key = by === "month" ? l.d.slice(0, 7) : by === "contact" ? l.c || "(no contact)" : l.t || "(other)";
    const text = by === "month" ? `${MON[Number(key.slice(5, 7)) - 1] || key} ${key.slice(0, 4)}` : by === "type" ? label(l.t) || key : key;
    const x = g.get(key) || { key, label: text, count: 0, dr: 0, cr: 0, net: 0 };
    x.count++;
    if (l.amt > 0) x.dr = r2(x.dr + l.amt);
    else x.cr = r2(x.cr - l.amt);
    x.net = r2(x.net + l.amt);
    g.set(key, x);
  }
  const out = [...g.values()];
  return by === "month" ? out.sort((a, b) => (a.key < b.key ? -1 : 1)) : out.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || (a.label < b.label ? -1 : 1));
}

// ------------------------------------------------------------------ control accounts

export type MoveRow = { label: string; amount: number; count: number; strong?: boolean };

const INVOICE = { debtors: /^ACCREC$/, creditors: /^ACCPAY$/ };
const CREDIT = { debtors: /^ACCRECCREDIT$/, creditors: /^ACCPAYCREDIT$/ };
const PAYMENT = { debtors: /^(ACCRECPAYMENT|ARCREDITPAYMENT|RECEIVE-(OVER|PRE)PAYMENT)$/, creditors: /^(ACCPAYPAYMENT|APCREDITPAYMENT|SPEND-(OVER|PRE)PAYMENT)$/ };

/**
 * A debtors or creditors control account's year: opening, invoices (or bills), credit notes, receipts (or payments),
 * anything else (journals), and the closing balance, all on the account's normal side (a creditor's credit is positive).
 * "closing" is the trial balance figure, shown with the difference when it isn't what the lines add up to.
 */
export function controlMovement(lines: LedgerLine[], kind: "debtors" | "creditors", opening: number, closing: number): { rows: MoveRow[]; ledgerClosing: number; difference: number } {
  const sign = kind === "creditors" ? -1 : 1;
  const sum = { inv: 0, cn: 0, pay: 0, other: 0 }, n = { inv: 0, cn: 0, pay: 0, other: 0 };
  for (const l of lines) {
    const t = l.t || "";
    const k = INVOICE[kind].test(t) ? "inv" : CREDIT[kind].test(t) ? "cn" : PAYMENT[kind].test(t) ? "pay" : "other";
    sum[k] = r2(sum[k] + sign * l.amt);
    n[k]++;
  }
  const open = r2(sign * opening);
  const ledgerClosing = r2(open + sum.inv + sum.cn + sum.pay + sum.other);
  const inv = kind === "debtors" ? "Sales invoices" : "Bills";
  const cn = kind === "debtors" ? "Credit notes issued" : "Supplier credit notes";
  const pay = kind === "debtors" ? "Receipts from customers" : "Payments to suppliers";
  const rows: MoveRow[] = [
    { label: "Opening balance", amount: open, count: 0, strong: true },
    { label: inv, amount: sum.inv, count: n.inv }, { label: cn, amount: sum.cn, count: n.cn }, { label: pay, amount: sum.pay, count: n.pay },
    { label: "Journals and other entries", amount: sum.other, count: n.other },
    { label: "Closing balance per the ledger", amount: ledgerClosing, count: 0, strong: true },
  ];
  return { rows, ledgerClosing, difference: r2(ledgerClosing - sign * closing) };
}

// ------------------------------------------------------------------ VAT

export type VatReconRow = {
  label: string; from: string; to: string;
  ledger: { out: number; inp: number; paid: number; other: number };
  ret?: { out: number; inp: number; paid: number };
  diff?: { out: number; inp: number; paid: number };
  owedEnd: number;
};
export type ReturnLine = { Detail: string; out: number; inp: number; paid: number };

/**
 * The VAT account quarter by quarter: what the ledger holds (output, input, paid to HMRC, other) against what the
 * VAT return schedule says, with the difference and the amount owed at each quarter end (credit balance = owed).
 */
export function vatRecon(lines: LedgerLine[], vatKey: string, from: string, to: string, quarterEnds: number[], returns: ReturnLine[], opening: number): { rows: VatReconRow[]; owedStart: number } {
  const qs: VatQuarter[] = vatByQuarter(lines, vatKey, from, to, quarterEnds);
  let owed = r2(-opening);
  const rows = qs.map((q, i) => {
    const r = returns.find((x) => x.Detail.trim().toLowerCase() === q.label.toLowerCase()) || (returns.length === qs.length ? returns[i] : undefined);
    owed = r2(owed + q.out - q.inp - q.paid - q.other);
    return {
      label: q.label, from: q.from, to: q.to,
      ledger: { out: q.out, inp: q.inp, paid: q.paid, other: q.other },
      ret: r ? { out: r.out, inp: r.inp, paid: r.paid } : undefined,
      diff: r ? { out: r2(q.out - r.out), inp: r2(q.inp - r.inp), paid: r2(q.paid - r.paid) } : undefined,
      owedEnd: owed,
    };
  });
  return { rows, owedStart: r2(-opening) };
}

// ------------------------------------------------------------------ PAYE

export type PayrollMonth = { Detail: string; due: number };
export type PayeRow = { month: string; label: string; due: number; posted: number; paid: number; owedPayroll: number; owedLedger: number; diff: number };

/**
 * PAYE and NI by month. Due is what the payroll records say is owed to HMRC for pay in that month (PAYE, employee NI
 * and employer NI); posted and paid are what the ledger shows as credits and debits on the PAYE account. A payment
 * usually falls in the month after the pay, so the running balances are what to compare.
 */
export function payeRecon(lines: LedgerLine[], from: string, to: string, payroll: PayrollMonth[], opening: number): { rows: PayeRow[]; owedStart: number } {
  const months: string[] = [];
  for (let d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= to.slice(0, 7); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) months.push(d.toISOString().slice(0, 7));
  const dueBy = new Map<string, number>();
  for (const p of payroll) {
    const m = /^([A-Za-z]{3}) (\d{4})$/.exec(p.Detail.trim());
    const key = m ? `${m[2]}-${String(MON.findIndex((x) => x.toLowerCase() === m[1].toLowerCase()) + 1).padStart(2, "0")}` : "";
    if (key) dueBy.set(key, r2((dueBy.get(key) || 0) + p.due));
  }
  const start = r2(-opening);
  let owedP = start, owedL = start;
  const rows = months.map((month) => {
    const mine = lines.filter((l) => l.d.slice(0, 7) === month);
    const posted = r2(mine.reduce((a, l) => a + (l.amt < 0 ? -l.amt : 0), 0)), paid = r2(mine.reduce((a, l) => a + (l.amt > 0 ? l.amt : 0), 0));
    const due = dueBy.get(month) || 0;
    owedP = r2(owedP + due - paid);
    owedL = r2(owedL + posted - paid);
    return { month, label: `${MON[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`, due, posted, paid, owedPayroll: owedP, owedLedger: owedL, diff: r2(owedP - owedL) };
  });
  return { rows, owedStart: start };
}
