// Asking a client for the invoices and receipts behind a list of transactions. A spreadsheet of transactions (a bank export,
// an Xero or QuickBooks "missing receipts" report, or a list typed up by hand) is read here: the header row is found, the date,
// description and amount columns are guessed (and can be changed), and each row becomes a transaction. The email to the client
// and the spreadsheet attached to it are built from the ones chosen. Nothing here touches the screen or the network.
import { excelDate } from "./xlsxRead";

export type Grid = (string | number | undefined)[][];
export type Txn = { row: number; date: string; description: string; reference: string; amount: number };
/** Column positions (0-based), -1 for none. "amount" is one signed column; "out" and "in" are separate money out / money in columns. */
export type ColumnMap = { date: number; description: number; reference: number; amount: number; out: number; in: number };
export const NO_COLUMN = -1;

/* ---------- reading the file ---------- */

/** A CSV file as rows of cells (quotes, doubled quotes and line breaks inside quotes handled; commas or semicolons). */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/, 1)[0] || "";
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const words = (v: unknown) => String(v ?? "").trim().toLowerCase();
const DATE_WORDS = /^(date|transaction date|posted|posting date|value date|txn date|date paid|paid on)$|\bdate\b/;
const DESC_WORDS = /descr|details|narrative|payee|merchant|name|memo|particulars|transaction$|contact|supplier/;
const REF_WORDS = /^(ref|reference|cheque|check|invoice|inv no|number|no\.?)$|reference/;
const AMOUNT_WORDS = /^(amount|value|net|gross|total|sum|amount \(gbp\)|amount gbp|£)$|amount/;
const OUT_WORDS = /debit|money out|paid out|withdrawal|spent|payments?$|out$/;
const IN_WORDS = /credit|money in|paid in|deposit|receipts?$|in$/;

/** The header row: the first of the first 15 rows that names a date and an amount (or money out) column. */
export function findHeader(rows: Grid): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(words);
    const date = cells.some((c) => DATE_WORDS.test(c));
    const money = cells.some((c) => AMOUNT_WORDS.test(c) || OUT_WORDS.test(c));
    if (date && money) return i;
  }
  return 0;
}

/** Which column is which, from the header's words. */
export function guessColumns(header: (string | number | undefined)[]): ColumnMap {
  const cells = header.map(words);
  const pick = (re: RegExp, not: number[] = []) => cells.findIndex((c, i) => !not.includes(i) && c !== "" && re.test(c));
  const date = pick(DATE_WORDS);
  const out = pick(OUT_WORDS, [date]);
  const inn = pick(IN_WORDS, [date, out]);
  const amount = out >= 0 ? NO_COLUMN : pick(AMOUNT_WORDS, [date]);
  const description = pick(DESC_WORDS, [date, out, inn, amount]);
  const reference = pick(REF_WORDS, [date, out, inn, amount, description]);
  return { date, description, reference, amount, out, in: inn };
}

/** A date cell as yyyy-mm-dd: an Excel serial number, 31/01/2026, 31-01-26, 31 Jan 2026 or 2026-01-31. "" if it isn't a date. */
export function readDate(v: unknown): string {
  if (typeof v === "number" && v > 20000 && v < 80000) return excelDate(v);
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase()) + 1;
    if (mon) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${String(mon).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return readDate(Number(s));
  return "";
}

/** A money cell as a number: £1,234.50, -12, (12.00) for a negative, 12.00 DR / CR. undefined if empty or not money. */
export function readMoney(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  let s = String(v ?? "").trim();
  if (!s) return undefined;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/\bdr$/i.test(s)) { sign = -1; s = s.replace(/\s*dr$/i, ""); }
  s = s.replace(/\s*cr$/i, "");
  s = s.replace(/[£$€,\s]/g, "");
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return undefined;
  return sign * Number(s);
}

/**
 * The transactions under the header. A row needs a date and an amount. With separate money out and money in columns, money out
 * is negative. Total and balance lines (no date) are left out.
 */
export function toTransactions(rows: Grid, headerIndex: number, map: ColumnMap): Txn[] {
  const out: Txn[] = [];
  const at = (r: Grid[number], c: number) => (c >= 0 ? r[c] : undefined);
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = readDate(at(r, map.date));
    if (!date) continue;
    let amount: number | undefined;
    if (map.amount >= 0) amount = readMoney(at(r, map.amount));
    else {
      const o = readMoney(at(r, map.out)), n = readMoney(at(r, map.in));
      amount = o ? -Math.abs(o) : n ? Math.abs(n) : undefined;
    }
    if (amount === undefined || amount === 0) continue;
    out.push({ row: i + 1, date, description: String(at(r, map.description) ?? "").trim(), reference: String(at(r, map.reference) ?? "").trim(), amount: Math.round(amount * 100) / 100 });
  }
  return out;
}

/* ---------- the email and the attachment ---------- */

export const gbp = (n: number) => `£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const addDays = (iso: string, n: number) => { const t = new Date(`${iso}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** How many transactions are written out in the email itself (all of them are always in the attachment). */
export const LIST_IN_EMAIL = 10;

export function requestEmail(o: { greeting: string; txns: Txn[]; today: string; replyDays?: number; signName?: string; fileName: string; period?: string }): { subject: string; body: string; replyBy: string } {
  const n = o.txns.length;
  const total = o.txns.reduce((s, t) => s + Math.abs(t.amount), 0);
  const replyBy = addDays(o.today, o.replyDays ?? 14);
  const listed = o.txns.slice(0, LIST_IN_EMAIL).map((t) => `- ${shortDate(t.date)}: ${t.description || "(no description)"}, ${gbp(t.amount)}`);
  const lines = [
    o.greeting,
    "",
    `We need the invoice or receipt for ${n === 1 ? "one transaction" : `${n} transactions`}${o.period ? ` from ${o.period}` : ""}, ${gbp(total)} in all. ${n === 1 ? "It's" : "They're"} listed in the attached spreadsheet (${o.fileName}).`,
    "",
    ...(n <= LIST_IN_EMAIL ? listed : [...listed, `- and ${n - LIST_IN_EMAIL} more in the spreadsheet`]),
    "",
    `Could you send them to us by ${shortDate(replyBy)}? A photo or a PDF of each is fine. If there isn't one for a transaction, just tell us what it was for in the Notes column of the spreadsheet and send it back.`,
    "",
    "Thank you,",
    (o.signName || "").split(" ")[0] || "",
  ];
  return { subject: `Receipts and invoices needed: ${n === 1 ? "1 transaction" : `${n} transactions`}`, body: lines.join("\n").replace(/\n+$/, ""), replyBy };
}

/** The attachment's rows: a heading row, one row per transaction with space for the client's answer, and a total. */
export function requestSheet(txns: Txn[]): (string | number)[][] {
  const rows: (string | number)[][] = [["Date", "Description", "Reference", "Amount (£)", "Receipt or invoice sent? (Yes / No)", "Notes: what it was for, if there's no receipt"]];
  for (const t of txns) rows.push([t.date, t.description, t.reference, t.amount, "", ""]);
  rows.push(["", "Total", "", Math.round(txns.reduce((s, t) => s + t.amount, 0) * 100) / 100, "", ""]);
  return rows;
}

export const requestFileName = (clientName: string, today: string) =>
  `Receipts needed - ${clientName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "client"} - ${today}.xlsx`;
