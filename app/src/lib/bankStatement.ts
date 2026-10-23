// Bank statements for clients whose books are kept as manual records: read a statement (a text
// PDF's words with their positions, or a CSV), check it adds up, sort each transaction into a
// category, and build a trial balance (plus a cash book) from it for the working papers.
//
// Nothing here guesses at figures. Amounts come straight from the statement and every row is checked
// against the running balance; categories are suggested (rules first, then AI) and reviewed by you.
const r2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ reading a statement

/** A piece of text on a PDF page: x is its distance from the left edge. */
export type Item = { x: number; text: string; w?: number };
export type Txn = { date: string; detail: string; amount: number; balance?: number; type?: string; bankCategory?: string; row: number };
export type Statement = {
  txns: Txn[];
  opening?: number;
  closing?: number;
  from?: string;
  to?: string;
  in: number;
  out: number;
  problems: string[];
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** dd/mm/yyyy, dd-mm-yy, dd Mon yyyy or yyyy-mm-dd as yyyy-mm-dd; undefined if it isn't a date. */
export function toDate(raw: string): string | undefined {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2}|\d{4})$/.exec(s))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  } else if ((m = /^(\d{1,2})[ \-/]([A-Za-z]{3})[a-z]*[ \-/,]*(\d{2}|\d{4})$/.exec(s))) {
    d = Number(m[1]);
    mo = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    y = Number(m[3]);
    if (y < 100) y += 2000;
  } else return undefined;
  if (!mo || mo > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "-£1,047.50", "1,047.50 DR", "(12.00)", "+£7,170.03" as a number (credits positive); undefined if not an amount. */
export function toAmount(raw: string): number | undefined {
  let s = raw.trim();
  if (!s) return undefined;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\b(dr|db|debit)\b\.?$/i.test(s)) { neg = true; s = s.replace(/\s*\b(dr|db|debit)\b\.?$/i, ""); }
  s = s.replace(/\s*\b(cr|credit)\b\.?$/i, "");
  if (s.startsWith("-") || s.startsWith("−")) { neg = !neg; s = s.slice(1); }
  else if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/^[£$€]\s*/, "");
  if (s.startsWith("-") || s.startsWith("−")) { neg = !neg; s = s.slice(1); }
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const n = Number(s.replace(/,/g, ""));
  return r2(neg ? -n : n);
}

type Col = { kind: "date" | "type" | "detail" | "category" | "value" | "in" | "out" | "balance"; x: number; end: number };

const HEADERS: [Col["kind"], RegExp][] = [
  ["date", /^(date|transaction date|posted|posting date)$/i],
  ["type", /^(type|transaction type)$/i],
  ["detail", /^(transaction|description|details|narrative|reference|payee|transaction description)$/i],
  ["category", /^(category|spending category)$/i],
  ["balance", /^(balance|running balance|balance after)$/i],
  ["value", /^(value|amount|money|amount \(gbp\)|total)$/i],
  ["in", /^(paid in|money in|credit|credits|in|receipts|deposits)$/i],
  ["out", /^(paid out|money out|debit|debits|out|payments|withdrawals)$/i],
];
const headerKind = (t: string) => HEADERS.find(([, re]) => re.test(t.trim()))?.[0];

/** Joins the words on a line into cells: words close together are one cell. */
function cells(line: Item[]): Item[] {
  const out: Item[] = [];
  const sorted = [...line].sort((a, b) => a.x - b.x);
  let lastEnd = -1e9;
  for (const it of sorted) {
    const last = out[out.length - 1];
    const w = it.w ?? it.text.length * 4.5;
    if (last && it.x - lastEnd < 6) last.text += ` ${it.text}`;
    else out.push({ x: it.x, text: it.text });
    lastEnd = it.x + w;
  }
  return out;
}

/** Looks for the table's header line and returns its columns. */
function findColumns(lines: Item[][]): { cols: Col[]; at: number } | undefined {
  for (let i = 0; i < lines.length; i++) {
    const cs = cells(lines[i]);
    const found: Col[] = [];
    for (const c of cs) {
      const k = headerKind(c.text);
      if (k && !found.some((f) => f.kind === k)) found.push({ kind: k, x: c.x, end: 1e9 });
    }
    const hasMoney = found.some((c) => c.kind === "value") || (found.some((c) => c.kind === "in") && found.some((c) => c.kind === "out"));
    if (found.some((c) => c.kind === "date") && hasMoney) {
      found.sort((a, b) => a.x - b.x);
      return { cols: found, at: i };
    }
  }
  return undefined;
}

/**
 * Reads a table out of a statement's lines of positioned words. The columns come from the header
 * line (DATE, TYPE, TRANSACTION, CATEGORY, VALUE, BALANCE; or Paid in / Paid out). A new row starts
 * at each line beginning with a date; lines under it add to its text (long descriptions wrap).
 */
export function parseLines(lines: Item[][]): Statement {
  const problems: string[] = [];
  const hdr = findColumns(lines);
  if (!hdr) return { txns: [], in: 0, out: 0, problems: ["No table of transactions found: a statement needs a header line with a Date and Amount (or Paid in and Paid out) column. If this is a scanned image, it can't be read yet."] };
  const cols = hdr.cols;
  // a column owns the text from slightly left of its heading to the next heading; numbers are right-aligned
  // under their heading, so money columns own text that ends near their heading's start
  cols.forEach((c, i) => { c.end = i + 1 < cols.length ? cols[i + 1].x : 1e9; });
  const colOf = (x: number, text: string): Col => {
    const money = toAmount(text) !== undefined;
    if (money) {
      const m = cols.filter((c) => c.kind === "value" || c.kind === "in" || c.kind === "out" || c.kind === "balance");
      // the nearest money heading to the left of or at the text's start; right-aligned figures start left of
      // their heading, so look at the heading nearest to the figure's centre
      const centre = x + text.length * 2.6;
      return m.reduce((best, c) => (Math.abs(c.x + 18 - centre) < Math.abs(best.x + 18 - centre) ? c : best), m[0]);
    }
    let pick = cols[0];
    for (const c of cols) if (x >= c.x - 4) pick = c;
    return pick;
  };

  type Raw = { date: string; cell: Partial<Record<Col["kind"], string[]>>; row: number };
  const rows: Raw[] = [];
  let current: Raw | undefined;
  for (let i = hdr.at + 1; i < lines.length; i++) {
    const cs = cells(lines[i]);
    if (!cs.length) continue;
    const first = cs[0];
    const dateCol = cols.find((c) => c.kind === "date")!;
    const d = Math.abs(first.x - dateCol.x) < 25 ? toDate(first.text) : undefined;
    if (findColumns([lines[i]])) { current = undefined; continue; } // the header repeated on a new page
    if (d) {
      current = { date: d, cell: {}, row: rows.length + 1 };
      rows.push(current);
      for (const c of cs.slice(1)) {
        const col = colOf(c.x, c.text);
        (current.cell[col.kind] ||= []).push(c.text);
      }
    } else if (current) {
      // wrapped text under a row; page furniture ends the row instead
      const text = cs.map((c) => c.text).join(" ");
      if (/^(page \d|generated|this document|starling bank|we are authorised|and regulated|statement|transaction export|period\b)/i.test(text)) { current = undefined; continue; }
      if (cs.some((c) => toAmount(c.text) !== undefined && colOf(c.x, c.text).kind !== "detail")) continue;
      for (const c of cs) {
        const col = colOf(c.x, c.text);
        (current.cell[col.kind] ||= []).push(c.text);
      }
    }
  }

  const txns: Txn[] = [];
  for (const r of rows) {
    const one = (k: Col["kind"]) => (r.cell[k] || []).join(" ").replace(/\s+/g, " ").trim();
    let amount: number | undefined;
    if (r.cell.value) amount = toAmount(one("value"));
    else {
      const i = toAmount(one("in")), o = toAmount(one("out"));
      if (i !== undefined || o !== undefined) amount = r2(Math.abs(i || 0) - Math.abs(o || 0));
    }
    if (amount === undefined) { problems.push(`Row ${r.row} (${r.date}) has no amount I could read.`); continue; }
    const bal = r.cell.balance ? toAmount(one("balance")) : undefined;
    txns.push({ date: r.date, detail: one("detail"), amount, balance: bal, type: one("type") || undefined, bankCategory: one("category") || undefined, row: r.row });
  }
  return finish(txns, problems);
}

/** Totals and checks on a list of transactions. */
export function finish(txns: Txn[], problems: string[]): Statement {
  const sorted = txns; // statements may run newest first: put them in date order only if the balances say so
  let list = sorted;
  const withBal = list.filter((t) => t.balance !== undefined);
  if (withBal.length > 1) {
    const forwards = continuity(list);
    const backwards = continuity([...list].reverse());
    if (backwards < forwards) list = [...list].reverse();
  }
  const out: Statement = {
    txns: list, in: r2(list.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0)), out: r2(-list.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0)), problems,
  };
  if (!list.length) return out;
  out.from = list.reduce((a, t) => (t.date < a ? t.date : a), list[0].date);
  out.to = list.reduce((a, t) => (t.date > a ? t.date : a), list[0].date);
  if (list[0].balance !== undefined) out.opening = r2(list[0].balance - list[0].amount);
  const last = list[list.length - 1];
  if (last.balance !== undefined) out.closing = last.balance;
  if (withBal.length) {
    const breaks: string[] = [];
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (a.balance !== undefined && b.balance !== undefined && Math.abs(a.balance + b.amount - b.balance) > 0.005) breaks.push(`${b.date.split("-").reverse().join("/")} ${b.detail || ""}`.trim());
    }
    if (breaks.length) problems.push(`${breaks.length} row${breaks.length === 1 ? "" : "s"} where the balance doesn't follow from the one before (a transaction may be missing or misread): ${breaks.slice(0, 4).join("; ")}${breaks.length > 4 ? "…" : ""}`);
    else if (out.opening !== undefined && out.closing !== undefined && Math.abs(out.opening + out.in - out.out - out.closing) > 0.005) problems.push("The transactions don't add up to the change in balance.");
  } else problems.push("The statement has no balance column, so the transactions can't be checked against a running balance. Check the opening and closing balances yourself.");
  return out;
}

function continuity(list: Txn[]): number {
  let breaks = 0;
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    if (a.balance !== undefined && b.balance !== undefined && Math.abs(a.balance + b.amount - b.balance) > 0.005) breaks++;
  }
  return breaks;
}

// ------------------------------------------------------------------ CSV

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  const delim = (src.split("\n", 1)[0].match(/;/g) || []).length > (src.split("\n", 1)[0].match(/,/g) || []).length ? ";" : ",";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** A bank's CSV export: headers in the first rows, then one transaction a row. */
export function parseCsv(text: string): Statement {
  const rows = parseCsvRows(text);
  let h = -1;
  let map: Partial<Record<Col["kind"], number>> = {};
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const m: Partial<Record<Col["kind"], number>> = {};
    rows[i].forEach((c, j) => { const k = headerKind(c); if (k && m[k] === undefined) m[k] = j; });
    if (m.date !== undefined && (m.value !== undefined || (m.in !== undefined && m.out !== undefined))) { h = i; map = m; break; }
  }
  if (h < 0) return { txns: [], in: 0, out: 0, problems: ["No header row found: a CSV needs columns for Date and Amount (or Paid in and Paid out)."] };
  const problems: string[] = [];
  const txns: Txn[] = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = toDate(r[map.date!] || "");
    if (!date) continue;
    let amount: number | undefined;
    if (map.value !== undefined) amount = toAmount(r[map.value] || "");
    else {
      const inn = toAmount(r[map.in!] || ""), out = toAmount(r[map.out!] || "");
      if (inn !== undefined || out !== undefined) amount = r2(Math.abs(inn || 0) - Math.abs(out || 0));
    }
    if (amount === undefined) { problems.push(`Row ${i + 1} (${date}) has no amount I could read.`); continue; }
    txns.push({
      date, amount, detail: (r[map.detail ?? -1] || "").trim(), type: map.type !== undefined ? (r[map.type] || "").trim() || undefined : undefined,
      bankCategory: map.category !== undefined ? (r[map.category] || "").trim() || undefined : undefined,
      balance: map.balance !== undefined ? toAmount(r[map.balance] || "") : undefined, row: txns.length + 1,
    });
  }
  return finish(txns, problems);
}

// ------------------------------------------------------------------ categories

/**
 * What a transaction can be. Each category is one account in the trial balance built from the
 * statement: its name, its place in the accounts, the IRIS code it maps to and whether money in or
 * out is normal for it.
 */
export type Category = { key: string; name: string; type: "income" | "expense" | "balance"; iris: string; irisName: string; side: "in" | "out" | "either"; hint: string };

export const CATEGORIES: Category[] = [
  { key: "sales", name: "Sales", type: "income", iris: "1", irisName: "Sales", side: "in", hint: "Money received from customers" },
  { key: "interest", name: "Bank interest received", type: "income", iris: "130", irisName: "Deposit account interest", side: "in", hint: "Interest paid by the bank" },
  { key: "wages", name: "Wages and salaries", type: "expense", iris: "255", irisName: "Wages", side: "out", hint: "Pay to employees" },
  { key: "dirpay", name: "Directors' remuneration", type: "expense", iris: "254/1*1", irisName: "Directors' remuneration", side: "out", hint: "Salary paid to a director" },
  { key: "pension", name: "Pension contributions", type: "expense", iris: "257", irisName: "Pensions", side: "out", hint: "Employer pension payments" },
  { key: "dividends", name: "Dividends", type: "balance", iris: "471/1", irisName: "Dividends - interim", side: "out", hint: "Dividends paid to shareholders" },
  { key: "paye", name: "PAYE and NI paid to HMRC", type: "balance", iris: "755", irisName: "Social security and other tax", side: "out", hint: "PAYE, NI and student loan payments (HMRC's payroll account)" },
  { key: "vat", name: "VAT paid to / from HMRC", type: "balance", iris: "735", irisName: "VAT", side: "either", hint: "VAT returns paid or refunded" },
  { key: "ct", name: "Corporation tax paid", type: "balance", iris: "747", irisName: "Tax", side: "out", hint: "Corporation tax payments" },
  { key: "dla", name: "Directors' loan account", type: "balance", iris: "727/1*1", irisName: "Directors' curr accs less 1yr - Balance brought forward", side: "either", hint: "Money lent to or taken from the company by a director" },
  { key: "shares", name: "Share capital introduced", type: "balance", iris: "966/1", irisName: "Called up share capital - Share capital 1", side: "in", hint: "Shares paid for" },
  { key: "loan", name: "Loan received / repaid", type: "balance", iris: "700", irisName: "Bank loan", side: "either", hint: "Loan drawn down or repaid" },
  { key: "loaninterest", name: "Loan interest", type: "expense", iris: "414", irisName: "Bank loan interest", side: "out", hint: "Interest on loans" },
  { key: "hp", name: "Hire purchase payments", type: "balance", iris: "909", irisName: "HP - gross - less than 1 yr", side: "out", hint: "Hire purchase and finance lease payments" },
  { key: "assets", name: "Equipment purchased", type: "balance", iris: "526/2", irisName: "Computer equipment Additions", side: "out", hint: "Computers, tools, machinery, furniture" },
  { key: "vehicle", name: "Vehicle purchased", type: "balance", iris: "525/2", irisName: "Motor vehicles Additions", side: "out", hint: "Cars and vans bought" },
  { key: "subcon", name: "Subcontractors", type: "expense", iris: "53", irisName: "Sub contractors", side: "out", hint: "Payments to subcontractors" },
  { key: "purchases", name: "Purchases", type: "expense", iris: "27", irisName: "Purchases", side: "out", hint: "Goods bought for resale or materials" },
  { key: "rent", name: "Rent", type: "expense", iris: "227", irisName: "Other operating leases - rent", side: "out", hint: "Rent of premises or equipment" },
  { key: "rates", name: "Rates and water", type: "expense", iris: "230", irisName: "Rates and water", side: "out", hint: "Business rates, water" },
  { key: "utilities", name: "Light and heat", type: "expense", iris: "233", irisName: "Light and heat", side: "out", hint: "Electricity, gas" },
  { key: "insurance", name: "Insurance", type: "expense", iris: "232", irisName: "Insurance", side: "out", hint: "Business insurance" },
  { key: "phone", name: "Telephone and internet", type: "expense", iris: "263", irisName: "Telephone", side: "out", hint: "Phone, broadband, mobile" },
  { key: "post", name: "Post and stationery", type: "expense", iris: "264", irisName: "Post and stationery", side: "out", hint: "Postage, printing, stationery" },
  { key: "advertising", name: "Advertising and marketing", type: "expense", iris: "265", irisName: "Advertising", side: "out", hint: "Advertising, website, marketing" },
  { key: "motor", name: "Motor and travel", type: "expense", iris: "267", irisName: "Motor and travel expenses", side: "out", hint: "Fuel, parking, train, hotels, vehicle costs" },
  { key: "repairs", name: "Repairs and renewals", type: "expense", iris: "272", irisName: "Repairs and renewals", side: "out", hint: "Repairs and maintenance" },
  { key: "computer", name: "Computer costs and software", type: "expense", iris: "279", irisName: "Computer costs", side: "out", hint: "Software subscriptions, hosting, IT" },
  { key: "accountancy", name: "Accountancy", type: "expense", iris: "285", irisName: "Accountancy", side: "out", hint: "Accountants' fees, accounting software (e.g. Adfin / GoCardless for accountants)" },
  { key: "legal", name: "Legal and professional fees", type: "expense", iris: "290", irisName: "Legal and professional fees", side: "out", hint: "Solicitors, professional bodies, registrations" },
  { key: "entertainment", name: "Entertainment", type: "expense", iris: "321", irisName: "Entertainment", side: "out", hint: "Client entertainment" },
  { key: "training", name: "Staff welfare and training", type: "expense", iris: "325", irisName: "Staff welfare and training", side: "out", hint: "Training, subsistence, staff costs" },
  { key: "bankcharges", name: "Bank charges", type: "expense", iris: "378", irisName: "Bank Charges", side: "out", hint: "Bank and card fees" },
  { key: "sundry", name: "Sundry expenses", type: "expense", iris: "280", irisName: "Sundry expenses", side: "out", hint: "Anything else for the business" },
  { key: "transfer", name: "Transfer between accounts", type: "balance", iris: "693", irisName: "Bank account no. 2", side: "either", hint: "Money moved to or from another of the company's accounts" },
  { key: "suspense", name: "Unknown / query for client", type: "balance", iris: "786", irisName: "Accrued expenses", side: "either", hint: "Can't tell: ask the client" },
];
export const CATEGORY_BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));

/** Rules that settle the obvious ones; whatever they don't catch goes to the AI, then to you. */
const RULES: [RegExp, string][] = [
  [/\b(salary|payroll|wages)\b.*\b(director)\b|\b(director)\b.*\b(salary|wages)\b|\blam salary\b/i, "dirpay"],
  [/dividend/i, "dividends"],
  [/hmrc.*(paye|ni\b|payroll|cumbernauld)|paye|\bnic?\b.*hmrc/i, "paye"],
  [/hmrc.*(vat)|\bvat\b.*hmrc|hmrc vat/i, "vat"],
  [/hmrc.*(corp|ct\b)|corporation tax/i, "ct"],
  [/\bhmrc\b/i, "suspense"],
  [/pension|nest\b|aviva|scottish widows|royal london|standard life|now pensions|smart pension|people'?s pension/i, "pension"],
  [/gocardless.*accurate|stripe.*adfin|adfin|xero|quickbooks|freeagent|sage\b|accountant|accurateacco/i, "accountancy"],
  [/interest (paid|earned|received)|gross interest|credit interest/i, "interest"],
  [/\bch\b.*fees?|companies house/i, "legal"],
  [/\b(monthly|account|card|overdraft|maintenance|service) fee|bank charge/i, "bankcharges"],
  [/loan repayment|\bloan\b.*(repay|instal)/i, "loan"],
  [/\b(shell|bp|esso|texaco|tesco fuel|sainsbury'?s fuel|petrol|diesel|parking|ncp|trainline|tfl|uber|national rail|dvla|congestion)\b/i, "motor"],
  [/\b(ee|vodafone|o2|three|bt|sky broadband|virgin media|plusnet|talktalk)\b/i, "phone"],
  [/\b(octopus energy|british gas|edf|e\.?on|scottish power|bulb|ovo|utility warehouse)\b/i, "utilities"],
  [/\b(hiscox|axa|aviva insurance|direct line|zurich|insurance)\b/i, "insurance"],
  [/\b(royal mail|post office|vistaprint|staples|viking direct)\b/i, "post"],
  [/\b(google ads|facebook ads|meta ads|linkedin ads|mailchimp|canva|wix|squarespace)\b/i, "advertising"],
  [/\b(microsoft|adobe|dropbox|google workspace|zoom|slack|aws|amazon web)\b/i, "computer"],
  [/\bcompanies house|ico\b|solicitor|legal\b|gmc|bma\b|gdc\b|rcvs|professional (body|subs)/i, "legal"],
];

/** Suggests a category for a transaction from its text and direction; undefined if the rules can't tell. */
export function ruleCategory(t: Pick<Txn, "detail" | "type" | "amount" | "bankCategory">, saved: Record<string, string> = {}): string | undefined {
  const k = merchantKey(t.detail);
  if (saved[k] && CATEGORY_BY_KEY.has(saved[k])) return saved[k];
  const text = `${t.detail} ${t.bankCategory || ""}`;
  for (const [re, cat] of RULES) {
    if (!re.test(text)) continue;
    const c = CATEGORY_BY_KEY.get(cat)!;
    if (c.side === "out" && t.amount > 0 && cat !== "suspense") continue;
    if (c.side === "in" && t.amount < 0) continue;
    return cat;
  }
  // money in that isn't anything else is almost always sales
  if (t.amount > 0 && /revenue|income|sales|invoice|payment (from|received)/i.test(`${t.bankCategory || ""} ${t.detail}`)) return "sales";
  return undefined;
}

/** The part of a description that identifies who it's with: references and numbers in brackets are dropped. */
export function merchantKey(detail: string): string {
  return detail.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[0-9*#]+/g, " ").replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

export type Sorted = Txn & { cat?: string; how?: "rule" | "ai" | "saved" | "you" };

export function sortTxns(txns: Txn[], saved: Record<string, string> = {}): Sorted[] {
  return txns.map((t) => {
    const cat = ruleCategory(t, saved);
    return cat ? { ...t, cat, how: saved[merchantKey(t.detail)] === cat ? "saved" : "rule" } : { ...t };
  });
}

// ------------------------------------------------------------------ the papers

export type TbOut = { Code: string; Detail: string; f: { dr?: number; cr?: number; type?: string; iris?: string } };

export type Built = {
  tb: TbOut[];
  cash: { Detail: string; Amount: number; Remark: string; f: Record<string, unknown> }[];
  receipts: number;
  payments: number;
  uncategorised: number;
  balancingFigure: number;
};

/**
 * The trial balance a statement supports: each category as an account (income and expenses as
 * the period's totals), the bank account at the closing balance, and the opening position
 * as a balancing figure through reserves (profit and loss b/fwd) unless you give it.
 * `priorReserves` is the prior year's retained profit, if known: any difference is then shown as unexplained.
 * VAT is not split out: a statement only shows the gross amounts.
 */
export function buildPapers(items: Sorted[], opening: number | undefined, bankName: string, bankIris = "692"): Built {
  const by = new Map<string, number>();
  let unsorted = 0;
  for (const t of items) {
    const k = t.cat || "suspense";
    if (!t.cat || t.cat === "suspense") unsorted++;
    by.set(k, r2((by.get(k) || 0) + t.amount));
  }
  const move = r2(items.reduce((a, t) => a + t.amount, 0));
  const closing = r2((opening ?? 0) + move);
  const tb: TbOut[] = [];
  let dr = 0, cr = 0;
  const put = (Code: string, Detail: string, f: TbOut["f"]) => { tb.push({ Code, Detail, f }); dr = r2(dr + (f.dr || 0)); cr = r2(cr + (f.cr || 0)); };
  // bank at the end: a positive balance is a debit
  put("BANK", bankName, closing >= 0 ? { dr: closing, type: "Bank", iris: bankIris } : { cr: -closing, type: "Bank", iris: bankIris });
  for (const c of CATEGORIES) {
    const v = by.get(c.key);
    if (v === undefined || v === 0) continue;
    // money in credits an account (income, loans received); money out debits it
    const f: TbOut["f"] = v > 0 ? { cr: v } : { dr: -v };
    put(c.key.toUpperCase(), c.name, { ...f, type: c.type === "income" ? "Revenue" : c.type === "expense" ? "Expense" : "Balance sheet", iris: c.iris });
  }
  // what's left to make it balance is the position before the period (retained profit b/fwd), if the books started earlier
  const diff = r2(dr - cr);
  if (Math.abs(diff) > 0.004) put("BFWD", "Opening position (balancing figure)", diff > 0 ? { cr: diff, type: "Equity", iris: "968/1" } : { dr: -diff, type: "Equity", iris: "968/1" });
  const cash = CATEGORIES.map((c) => ({ c, v: by.get(c.key) || 0 })).filter((x) => x.v !== 0).map(({ c, v }) => ({
    Detail: c.name, Amount: v, Remark: `${items.filter((t) => t.cat === c.key).length} transaction${items.filter((t) => t.cat === c.key).length === 1 ? "" : "s"}`, f: { in: v > 0 ? v : 0, out: v < 0 ? -v : 0 },
  }));
  return {
    tb, cash, receipts: r2(items.filter((t) => t.amount > 0).reduce((a, t) => a + t.amount, 0)), payments: r2(-items.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0)),
    uncategorised: unsorted, balancingFigure: diff,
  };
}
