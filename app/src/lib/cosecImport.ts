// Historical imports for a company's corporate record. Rows from a spreadsheet, a CSV or the text of a register PDF are turned into
// proposed items; nothing is committed until a person has reviewed and approved them. Pure logic: no storage here.
// Rules: never invent a date, name, holding or event; an item that only shows a balance is an opening balance, not a made-up
// history; an import never prepares a Companies House filing for something that happened in the past.
import { Row } from "./schema";
import { Entry, EntryType, NewEntry, entryProblems, holderId, readEntry, replay } from "./shareLedger";
import { excelDate } from "./xlsxRead";

export type ItemKind = "ledger" | "officer" | "psc";
export type ItemStatus = "pending" | "accepted" | "excluded";
export type Confidence = "supplied" | "extracted" | "low";
export type ImportItem = {
  id: string; kind: ItemKind; status: ItemStatus; fields: Record<string, string>;
  source: { doc: string; page?: number; row?: number; text?: string };
  confidence: Confidence; ambiguity: string[]; /** An existing record this person should be merged into rather than duplicated. */ mergeWith?: string;
};
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const KIND_LABEL: Record<ItemKind, string> = { ledger: "Share ledger entry", officer: "Officer", psc: "Person with significant control" };
export const proposedRecord = (i: ImportItem): string => i.kind === "ledger" ? `${KIND_LABEL.ledger}: ${TYPE_LABEL[normType(i.fields.type) || "opening"]}` : i.kind === "officer" ? `${KIND_LABEL.officer}: ${str(i.fields.role) || "director"}` : KIND_LABEL.psc;
const TYPE_LABEL: Record<EntryType, string> = { opening: "opening balance", allotment: "allotment", bonus: "bonus issue", transfer: "transfer", redemption: "redemption", cancellation: "cancellation" };

// ------------------------------------------------------------------ reading values

/** CSV with quoted fields, commas or semicolons or tabs, and a possible byte-order mark. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const first = t.split(/\r?\n/, 1)[0] || "";
  const sep = [",", ";", "\t"].map((c) => [c, first.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim())); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row.map((x) => x.trim()));
  return rows;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y: number, m: number, d: number) => {
  if (y < 1000 || m < 1 || m > 12 || d < 1 || d > 31) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : "";
};
/** A date as written in the UK (day first), or an ISO date, or "1st January 2020", or an Excel serial. Empty if it can't be read. */
export function readDate(raw: unknown): { date: string; ambiguous: boolean } {
  const s = str(raw);
  if (!s) return { date: "", ambiguous: false };
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/))) return { date: iso(+m[1], +m[2], +m[3]), ambiguous: false };
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/))) {
    const y = m[3].length === 2 ? (+m[3] > 50 ? 1900 : 2000) + +m[3] : +m[3];
    const d = iso(y, +m[2], +m[1]);
    return { date: d, ambiguous: !!d && +m[1] <= 12 && +m[2] <= 12 && +m[1] !== +m[2] };
  }
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/))) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; return { date: mo ? iso(+m[3], mo, +m[1]) : "", ambiguous: false }; }
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 70000) return { date: excelDate(Math.floor(+s)), ambiguous: false };
  return { date: "", ambiguous: false };
}
export function readNumber(raw: unknown): number | undefined {
  const s = str(raw).replace(/[£,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  return Number(s);
}
const TYPE_WORDS: [EntryType, RegExp][] = [
  ["opening", /opening|balance|holding|brought forward|b\/f|incorporation|subscriber/i],
  ["bonus", /bonus|capitalisation/i],
  ["allotment", /allot|issue|subscription|new shares/i],
  ["transfer", /transfer|sale|sold|purchase|gift|assign/i],
  ["redemption", /redeem|redemption|buy.?back|repurchase/i],
  ["cancellation", /cancel|surrender|forfeit/i],
];
export function normType(raw: unknown): EntryType | "" {
  const s = str(raw);
  if (!s) return "";
  for (const [t, re] of TYPE_WORDS) if (re.test(s)) return t;
  return "";
}

// ------------------------------------------------------------------ mapping columns

export const FIELDS: Record<ItemKind, { key: string; label: string; required?: boolean; words: RegExp }[]> = {
  ledger: [
    { key: "date", label: "Date", required: true, words: /^(effective\s*)?date|^when|date of/i },
    { key: "type", label: "Transaction type", required: true, words: /type|transaction|event|nature|action/i },
    { key: "cls", label: "Share class", words: /class|share type|description/i },
    { key: "number", label: "Number of shares", required: true, words: /number|quantity|qty|shares|no\.? of/i },
    { key: "from", label: "From (transferor)", words: /^from|transferor|seller|vendor|disposer/i },
    { key: "to", label: "To (holder)", words: /^to\b|transferee|buyer|purchaser|holder|member|allottee|name/i },
    { key: "nominal", label: "Nominal value each", words: /nominal|par value/i },
    { key: "paid", label: "Paid per share", words: /paid|price|per share/i },
    { key: "consideration", label: "Consideration", words: /consideration|amount|value/i },
    { key: "ref", label: "Reference", words: /ref|certificate|cert/i },
  ],
  officer: [
    { key: "name", label: "Name", required: true, words: /name/i },
    { key: "role", label: "Role", words: /role|position|office|capacity/i },
    { key: "appointedOn", label: "Appointed", words: /appointed|start|from|joined/i },
    { key: "resignedOn", label: "Resigned", words: /resigned|terminated|ceased|end|to\b|left/i },
    { key: "dob", label: "Date of birth", words: /birth|dob/i },
    { key: "nationality", label: "Nationality", words: /nationality/i },
    { key: "occupation", label: "Occupation", words: /occupation/i },
    { key: "country", label: "Country of residence", words: /residence/i },
    { key: "address", label: "Service address", words: /address/i },
  ],
  psc: [
    { key: "name", label: "Name", required: true, words: /name/i },
    { key: "natures", label: "Nature of control", words: /nature|control|interest/i },
    { key: "notifiedOn", label: "Became a PSC", words: /notified|became|start|from|registered/i },
    { key: "ceasedOn", label: "Ceased", words: /ceased|end|to\b/i },
    { key: "dob", label: "Date of birth", words: /birth|dob/i },
    { key: "nationality", label: "Nationality", words: /nationality/i },
    { key: "country", label: "Country of residence", words: /residence/i },
    { key: "address", label: "Service address", words: /address/i },
  ],
};
/** The best guess at which column holds which field. Each column is used once; the reviewer can change any of it. */
export function guessMapping(headers: string[], kind: ItemKind): Record<string, number> {
  const used = new Set<number>();
  const out: Record<string, number> = {};
  for (const f of FIELDS[kind]) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && f.words.test(h.trim()));
    if (i >= 0) { out[f.key] = i; used.add(i); }
  }
  return out;
}
export const missingMapping = (kind: ItemKind, m: Record<string, number>) => FIELDS[kind].filter((f) => f.required && m[f.key] === undefined).map((f) => f.label);

let seq = 0;
const itemId = () => `I${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Turn rows into proposed items. Values that can't be read are left blank and called out, never guessed. */
export function itemsFromRows(rows: string[][], mapping: Record<string, number>, kind: ItemKind, doc: string, firstRow = 2): ImportItem[] {
  return rows.map((r, n) => {
    const get = (k: string) => (mapping[k] === undefined ? "" : str(r[mapping[k]]));
    const ambiguity: string[] = [];
    const fields: Record<string, string> = {};
    for (const f of FIELDS[kind]) fields[f.key] = get(f.key);
    for (const k of Object.keys(fields)) {
      if (!/(date|On)$|^dob$/i.test(k) || !fields[k]) continue;
      const d = readDate(fields[k]);
      if (!d.date) ambiguity.push(`${FIELDS[kind].find((f) => f.key === k)?.label} "${fields[k]}" can't be read as a date.`);
      else if (d.ambiguous) ambiguity.push(`${FIELDS[kind].find((f) => f.key === k)?.label} "${fields[k]}" was read day first (${d.date}).`);
      fields[k] = d.date;
    }
    if (kind === "ledger") {
      const raw = fields.type; const t = normType(raw);
      if (raw && !t) ambiguity.push(`Transaction type "${raw}" isn't recognised.`);
      fields.type = t;
      const num = readNumber(fields.number);
      if (fields.number && num === undefined) ambiguity.push(`Number of shares "${fields.number}" isn't a number.`);
      fields.number = num === undefined ? "" : String(num);
      if (t === "transfer" && !fields.from) ambiguity.push("A transfer needs a transferor.");
    }
    return { id: itemId(), kind, status: "pending" as ItemStatus, fields, source: { doc, row: firstRow + n }, confidence: "supplied" as Confidence, ambiguity };
  }).filter((i) => Object.values(i.fields).some((v) => v));
}

// ------------------------------------------------------------------ reading register PDF text

/**
 * Pull candidate rows out of the text of a register PDF. This is plain text matching, not AI: it only proposes a row where a line holds a date and a
 * recognisable transaction (or a role), and marks every one as extracted from text for checking against the page. It does not join lines, fill in
 * a missing date, or invent a transaction; a balance on its own is proposed as an opening balance, never as a history.
 */
export function itemsFromPdfLines(pages: string[][], doc: string): ImportItem[] {
  const out: ImportItem[] = [];
  pages.forEach((lines, pi) => {
    for (const line of lines) {
      const text = line.replace(/\s+/g, " ").trim();
      if (text.length < 8) continue;
      const dates = [...text.matchAll(/\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4})\b/g)].map((m) => m[1]);
      const read = dates.map((d) => readDate(d)).filter((d) => d.date);
      if (!read.length) continue;
      const rest = text.replace(/\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4})\b/g, " ").replace(/\s+/g, " ").trim();
      const role = rest.match(/\b(director|secretary|member)\b/i);
      const type = normType(rest);
      const numbers = [...rest.matchAll(/\b\d[\d,]*\b/g)].map((m) => readNumber(m[0])).filter((n): n is number => n !== undefined && Number.isInteger(n) && n > 0);
      const src = { doc, page: pi + 1, text };
      if (role && !type) {
        const name = rest.replace(/\b(director|secretary|member|appointed|resigned|terminated|ceased|mr|mrs|ms|miss|dr)\b\.?/gi, " ").replace(/[^A-Za-z'\- ]/g, " ").replace(/\s+/g, " ").trim();
        const ended = /resign|terminat|ceas|former/i.test(rest);
        out.push({ id: itemId(), kind: "officer", status: "pending", fields: { name, role: role[1].toLowerCase(), appointedOn: ended ? "" : read[0].date, resignedOn: ended ? read[read.length - 1].date : read.length > 1 ? read[1].date : "" }, source: src, confidence: "extracted", ambiguity: ["Read from the text of the PDF. Check the name and dates against the page.", ...(ended && read.length === 1 ? ["Only one date is shown; it was taken as the end date. The appointment date is missing."] : []), ...read.filter((d) => d.ambiguous).map(() => "A date was read day first.")] });
      } else if (type && numbers.length) {
        const f: Record<string, string> = { date: read[0].date, type, number: String(numbers[0]), cls: (rest.match(/\b(ordinary|preference|preferred|deferred|[A-Z] ordinary)\b/i) || [""])[0], from: "", to: "", nominal: "", paid: "", consideration: "", ref: "" };
        out.push({ id: itemId(), kind: "ledger", status: "pending", fields: f, source: src, confidence: "low", ambiguity: ["Read from the text of the PDF. The holder names were not separated from the rest of the line: enter who is involved before accepting.", ...(f.cls ? [] : ["The share class isn't stated on this line."]), ...read.filter((d) => d.ambiguous).map(() => "The date was read day first.")] });
      }
    }
  });
  return out;
}

// ------------------------------------------------------------------ checking

export type Existing = { entries: Entry[]; officers: Row[]; pscs: Row[]; classes: string[] };
export type Verdict = { errors: string[]; warnings: string[] };
const nameOf = (r: Row) => [str(r.First), str(r.Last)].filter(Boolean).join(" ") || str(r.CorporateName) || str(r.Title);
export const norm = (s: string) => s.toLowerCase().replace(/\b(mr|mrs|ms|miss|dr|mx)\b\.?/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
export const splitName = (full: string) => { const p = full.replace(/\s+/g, " ").trim().split(" "); return p.length < 2 ? { first: "", last: p[0] || "" } : { first: p.slice(0, -1).join(" "), last: p[p.length - 1] }; };

/** The ledger entry an item stands for, as it would be recorded. */
export function entryOf(i: ImportItem, batch: string): NewEntry {
  const f = i.fields;
  return { type: (normType(f.type) || "opening") as EntryType, date: f.date, cls: f.cls || "Ordinary", number: Number(f.number), from: f.from, to: f.to, nominal: Number(f.nominal) || 0, paid: Number(f.paid) || 0, consideration: f.consideration, notes: [f.ref && `Reference ${f.ref}`, `Imported from ${i.source.doc}${i.source.page ? ` page ${i.source.page}` : i.source.row ? ` row ${i.source.row}` : ""}`].filter(Boolean).join(". "), idem: `import:${batch}:${i.id}`, source: `import:${batch}` };
}

/**
 * What is wrong with each item, and with the batch as a whole. Errors stop an item being accepted; warnings are for the reviewer.
 * The ledger is checked by replaying the existing entries plus the accepted ones, so a negative balance anywhere is caught.
 */
export function check(items: ImportItem[], ex: Existing, batch = "~"): { items: Record<string, Verdict>; batch: string[] } {
  const out: Record<string, Verdict> = {};
  const accepted: Entry[] = [];
  const same = (a: NewEntry, e: Entry) => a.type === e.type && a.date === e.date && a.cls.toLowerCase() === e.cls.toLowerCase() && a.number === e.number && holderId(a.from || "") === holderId(e.from) && holderId(a.to || "") === holderId(e.to);
  const seen: NewEntry[] = [];
  for (const i of items) {
    const v: Verdict = { errors: [], warnings: [...i.ambiguity] };
    out[i.id] = v;
    if (i.kind === "ledger") {
      const e = entryOf(i, batch);
      const type = normType(i.fields.type);
      if (!type) v.errors.push("Choose the transaction type.");
      const p = entryProblems(e, [], ex.classes.length && i.fields.cls ? ex.classes : undefined);
      v.errors.push(...p.filter((x) => !/would be left holding|Shares can only move/.test(x)));
      if (ex.entries.some((x) => x.active && same(e, x))) v.warnings.push("The ledger already has an entry like this. Accepting it would record it twice.");
      if (seen.some((x) => same(e, { ...x } as unknown as Entry))) v.warnings.push("Another row in this import is the same.");
      seen.push(e);
      if (i.status === "accepted" && !v.errors.length) accepted.push(readEntry({ Key: i.id, ClientKey: "~", Type: e.type, EffectiveDate: e.date, Class: e.cls, Number: e.number, FromHolder: e.from, ToHolder: e.to, Status: "active", Created: i.id }));
    } else {
      const f = i.fields;
      if (!str(f.name)) v.errors.push("Enter the name.");
      const dated = i.kind === "officer" ? [f.appointedOn, f.resignedOn] : [f.notifiedOn, f.ceasedOn];
      if (dated[0] && dated[1] && dated[1] < dated[0]) v.errors.push("The end date is before the start date.");
      if (i.kind === "officer" && !f.appointedOn) v.warnings.push("No appointment date. It will be recorded without one rather than guessed.");
      const pool = i.kind === "officer" ? ex.officers : ex.pscs;
      const hit = pool.find((r) => norm(nameOf(r)) === norm(f.name));
      if (hit && !i.mergeWith) {
        const sameRole = i.kind !== "officer" || !f.role || str(hit.Role).toLowerCase() === f.role.toLowerCase();
        v.warnings.push(`${nameOf(hit)} is already on file${sameRole ? "" : ` as a ${str(hit.Role)}`}. Merge, or accept as a separate record.`);
      }
      const clash = items.find((o) => o !== i && o.kind === i.kind && norm(o.fields.name || "") === norm(f.name) && o.status !== "excluded" && overlap(o, i));
      if (clash && i.status !== "excluded") v.warnings.push("Another row for the same person covers overlapping dates (conflicting appointments).");
    }
  }
  const batchProblems: string[] = [];
  if (accepted.length) {
    const before = new Set(replay(ex.entries).problems);
    const r = replay([...ex.entries, ...accepted]);
    for (const p of r.problems) if (!before.has(p)) batchProblems.push(p);
  }
  return { items: out, batch: batchProblems.slice(0, 5) };
}
function overlap(a: ImportItem, b: ImportItem) {
  const [as, ae] = a.kind === "officer" ? [a.fields.appointedOn, a.fields.resignedOn] : [a.fields.notifiedOn, a.fields.ceasedOn];
  const [bs, be] = b.kind === "officer" ? [b.fields.appointedOn, b.fields.resignedOn] : [b.fields.notifiedOn, b.fields.ceasedOn];
  if (!as || !bs) return false;
  return as <= (be || "9999-12-31") && bs <= (ae || "9999-12-31");
}

// ------------------------------------------------------------------ committing

export type Committed = { creates: { list: "CoSecLedger" | "CoSecOfficers" | "CoSecPscs" | "CoSecImports"; row: Row }[]; patches: { list: "CoSecOfficers" | "CoSecPscs"; row: Row; patch: Row }[]; counts: { ledger: number; officers: number; pscs: number; merged: number; excluded: number }; error?: string };

/**
 * The records to write for an approved import. Only accepted items without errors are written; a batch that leaves the ledger unbalanced is refused
 * whole. Merged people only have blank fields filled in on the existing record. An import never creates a filing or a transaction.
 */
export function commit(items: ImportItem[], ex: Existing, clientKey: string, meta: { batch: string; doc: string; method: string; by: string; now: string }): Committed {
  const none: Committed = { creates: [], patches: [], counts: { ledger: 0, officers: 0, pscs: 0, merged: 0, excluded: 0 } };
  const verdict = check(items, ex, meta.batch);
  if (verdict.batch.length) return { ...none, error: `The ledger would not balance: ${verdict.batch[0]}` };
  const blocked = items.filter((i) => i.status === "accepted" && verdict.items[i.id].errors.length);
  if (blocked.length) return { ...none, error: `${blocked.length} accepted row${blocked.length === 1 ? " has" : "s have"} problems to fix first.` };
  const ok = items.filter((i) => i.status === "accepted");
  if (!ok.length) return { ...none, error: "Nothing has been accepted." };
  const out: Committed = { creates: [], patches: [], counts: { ...none.counts, excluded: items.filter((i) => i.status === "excluded").length } };
  const src = `import:${meta.batch}`;
  let n = 0;
  const ledgerKey = () => `SL${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  for (const i of ok) {
    if (i.kind === "ledger") {
      const e = entryOf(i, meta.batch);
      out.creates.push({ list: "CoSecLedger", row: { Key: ledgerKey(), PracticeId: "", ClientKey: clientKey, Type: e.type, EffectiveDate: e.date, Class: e.cls, Number: e.number, FromHolder: e.from || "", FromKey: "", ToHolder: e.to || "", ToKey: "", Currency: "GBP", Nominal: e.nominal || 0, PaidPerShare: e.paid || 0, Premium: 0, Consideration: e.consideration || "", TxKey: "", IdemKey: e.idem, Supersedes: "", Reason: "", Status: "active", Notes: e.notes || "", Source: src, Created: meta.now, CreatedBy: meta.by } });
      out.counts.ledger++;
      continue;
    }
    const f = i.fields; const nm = splitName(f.name);
    const list = i.kind === "officer" ? "CoSecOfficers" as const : "CoSecPscs" as const;
    const base: Row = i.kind === "officer"
      ? { First: nm.first, Last: nm.last, DOB: f.dob, Nationality: f.nationality, Occupation: f.occupation, CountryOfResidence: f.country, ServiceAddress: f.address, AppointedOn: f.appointedOn, ResignedOn: f.resignedOn }
      : { First: nm.first, Last: nm.last, DOB: f.dob, Nationality: f.nationality, CountryOfResidence: f.country, ServiceAddress: f.address, Natures: f.natures, NotifiedOn: f.notifiedOn, CeasedOn: f.ceasedOn };
    if (i.mergeWith) {
      const row = (i.kind === "officer" ? ex.officers : ex.pscs).find((r) => r.Key === i.mergeWith);
      if (!row) return { ...none, error: "A person chosen for merging is no longer on file." };
      const patch: Row = {};
      for (const [k, v] of Object.entries(base)) if (str(v) && !str(row[k])) patch[k] = v;
      if (Object.keys(patch).length) out.patches.push({ list, row, patch: { ...patch, Notes: [str(row.Notes), `Details added by import ${meta.batch}`].filter(Boolean).join("\n"), Updated: meta.now } });
      out.counts.merged++;
      continue;
    }
    const ended = i.kind === "officer" ? !!f.resignedOn : !!f.ceasedOn;
    out.creates.push({ list, row: { Key: `${i.kind === "officer" ? "OF" : "PS"}${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 5)}`, PracticeId: "", ClientKey: clientKey, Kind: "individual", Status: ended ? (i.kind === "officer" ? "resigned" : "ceased") : "current", ...(i.kind === "officer" ? { Role: f.role || "director" } : {}), ...base, Source: src, Notes: `Imported from ${i.source.doc}${i.source.page ? ` page ${i.source.page}` : ""}`, Created: meta.now, Updated: meta.now } });
    out.counts[i.kind === "officer" ? "officers" : "pscs"]++;
  }
  const c = out.counts;
  out.creates.push({ list: "CoSecImports", row: { Key: meta.batch, PracticeId: "", ClientKey: clientKey, Method: meta.method, SourceName: meta.doc, Status: "approved", Summary: `${c.ledger} ledger entries, ${c.officers} officers, ${c.pscs} PSCs, ${c.merged} merged, ${c.excluded} excluded. No Companies House filings were created.`, Items: JSON.stringify(items.map((i) => ({ id: i.id, kind: i.kind, status: i.status, fields: i.fields, source: i.source, confidence: i.confidence, ambiguity: i.ambiguity, mergeWith: i.mergeWith }))).slice(0, 60000), ApprovedBy: meta.by, ApprovedAt: meta.now, Created: meta.now, CreatedBy: meta.by } });
  return out;
}

/** Officers on file against Companies House's current list: who is missing from either side. Compares current appointments only. */
export function compareOfficers(officers: Row[], ch: { name: string; role?: string }[]): { onlyHere: string[]; onlyAtCh: string[]; matched: number } {
  const mine = officers.filter((o) => str(o.Status) === "current");
  const here = new Map(mine.map((o) => [norm(nameOf(o)), nameOf(o)]));
  const there = new Map(ch.map((c) => [norm(c.name.includes(",") ? c.name.split(",").reverse().join(" ") : c.name), c.name]));
  const onlyHere = [...here].filter(([k]) => !there.has(k)).map(([, v]) => v);
  const onlyAtCh = [...there].filter(([k]) => !here.has(k)).map(([, v]) => v);
  return { onlyHere, onlyAtCh, matched: here.size - onlyHere.length };
}
