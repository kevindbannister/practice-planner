// Dividends. The arithmetic is whole numbers only (BigInt, pence), so the same inputs always give the same answer to the penny. Who is
// entitled comes from the share ledger as at the record date, not from today's register. A dividend can only be declared after someone
// has confirmed that distributable profits were reviewed; that confirmation is recorded with who and when. A waiver needs a reference
// to the signed document. This does not decide whether the company can lawfully pay, or how it is taxed: that is for the reviewer.
import { Row } from "./schema";
import { Entry, Holding, replay } from "./shareLedger";
import { Rights } from "./cosecShares";
import { Block, textPdf } from "./cosecDocs";

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
export type DivStatus = "draft" | "declared" | "paid" | "cancelled";
export const DIV_LABEL: Record<DivStatus, string> = { draft: "Draft", declared: "Declared", paid: "Paid", cancelled: "Cancelled" };
export type DivType = "interim" | "final";

/** A rate in pounds per share as text ("0.0125") becomes millionths of a pound. Text, not floating point, so nothing is lost. */
export function parseRate(s: string): bigint | null {
  const m = s.trim().replace(/^£/, "").match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) return null;
  return BigInt(m[1]) * 1000000n + BigInt((m[2] || "").padEnd(6, "0"));
}
/** Pounds and pence as text ("1,250.50") to whole pence. */
export function parsePounds(s: string): bigint | null {
  const m = s.trim().replace(/^£/, "").replace(/,/g, "").match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  return BigInt(m[1]) * 100n + BigInt((m[2] || "").padEnd(2, "0"));
}
export const pounds = (pence: bigint | number) => { const p = BigInt(pence); const neg = p < 0n; const a = neg ? -p : p; return `${neg ? "-" : ""}£${(a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(a % 100n).toString().padStart(2, "0")}`; };

export type Waiver = { holderId: string; holder: string; cls: string; docRef: string };
export type Basis = { mode: "per-share"; rates: Record<string, string> } | { mode: "aggregate"; total: string };
export type Line = { holderId: string; holder: string; holderKey: string; cls: string; shares: number; entitlementPence: string; waived: boolean; paidPence: string; waiverRef: string };
export type Calc = { lines: Line[]; totalPence: string; waivedPence: string; excluded: { cls: string; shares: number; why: string }[]; problems: string[] };

/**
 * Work out who gets what. Per-share: each class has its own rate and each line is shares x rate, rounded to the nearest penny (halves up).
 * Aggregate: one total is shared equally across every share that carries dividend rights, using exact fractions with the leftover pence
 * handed one at a time to the largest remainders (ties by holder name), so the lines always add up exactly to the total.
 * A waived line is paid nothing; the others are not increased.
 */
export function calculate(entries: Entry[], clientKey: string, recordDate: string, basis: Basis, rights: Map<string, Rights>, waivers: Waiver[] = []): Calc {
  const problems: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)) return { lines: [], totalPence: "0", waivedPence: "0", excluded: [], problems: ["Give the record date."] };
  const r = replay(entries.filter((e) => e.clientKey === clientKey), recordDate);
  problems.push(...r.problems.map((p) => `The share ledger has a problem: ${p}`));
  const excluded: Calc["excluded"] = [];
  const eligible: Holding[] = [];
  for (const h of r.holdings.filter((x) => x.number > 0).sort((a, b) => a.name.localeCompare(b.name) || a.cls.localeCompare(b.cls))) {
    const rt = rights.get(h.cls.toLowerCase());
    if (rt && !rt.dividends) { excluded.push({ cls: h.cls, shares: h.number, why: "This class doesn't carry dividend rights." }); continue; }
    eligible.push(h);
  }
  if (!eligible.length) problems.push("No shares carry dividend rights on the record date.");
  const ent = new Map<Holding, bigint>();
  if (basis.mode === "per-share") {
    for (const h of eligible) {
      const raw = basis.rates[h.cls] ?? basis.rates[h.cls.toLowerCase()];
      if (raw === undefined || raw.trim() === "") { problems.push(`Give a rate for ${h.cls} shares.`); ent.set(h, 0n); continue; }
      const rate = parseRate(raw);
      if (rate === null) { problems.push(`The rate for ${h.cls} isn't a valid amount (pounds per share, up to six decimal places).`); ent.set(h, 0n); continue; }
      ent.set(h, (BigInt(h.number) * rate + 5000n) / 10000n);
    }
  } else {
    const total = parsePounds(basis.total);
    if (total === null || total <= 0n) { problems.push("The total must be an amount above zero, in pounds and pence."); eligible.forEach((h) => ent.set(h, 0n)); }
    else {
      const all = eligible.reduce((s, h) => s + BigInt(h.number), 0n);
      const parts = eligible.map((h) => { const num = total * BigInt(h.number); return { h, floor: num / all, rem: num % all }; });
      let left = total - parts.reduce((s, p) => s + p.floor, 0n);
      const byRem = [...parts].sort((a, b) => (a.rem === b.rem ? 0 : a.rem > b.rem ? -1 : 1) || a.h.name.localeCompare(b.h.name) || a.h.cls.localeCompare(b.h.cls));
      const extra = new Map<Holding, bigint>();
      for (const p of byRem) { if (left <= 0n) break; extra.set(p.h, 1n); left -= 1n; }
      parts.forEach((p) => ent.set(p.h, p.floor + (extra.get(p.h) || 0n)));
    }
  }
  const lines: Line[] = []; let tot = 0n, waived = 0n;
  for (const h of eligible) {
    const e = ent.get(h) || 0n;
    const w = waivers.find((x) => x.holderId === h.id && (!x.cls || x.cls.toLowerCase() === h.cls.toLowerCase()));
    if (w && !w.docRef.trim()) problems.push(`The waiver for ${h.name} needs a reference to the signed waiver document.`);
    const isW = !!w && !!w.docRef.trim();
    const paid = isW ? 0n : e;
    tot += paid; if (isW) waived += e;
    lines.push({ holderId: h.id, holder: h.name, holderKey: h.key, cls: h.cls, shares: h.number, entitlementPence: e.toString(), waived: isW, paidPence: paid.toString(), waiverRef: isW ? w!.docRef.trim() : "" });
  }
  for (const w of waivers) if (!lines.some((l) => l.holderId === w.holderId)) problems.push(`${w.holder || "A waiver"} holds no shares carrying dividend rights on the record date, so the waiver does nothing.`);
  return { lines, totalPence: tot.toString(), waivedPence: waived.toString(), excluded, problems };
}

export type Dividend = { key: string; clientKey: string; ref: string; type: DivType; recordDate: string; declaredOn: string; paidOn: string; basis: Basis | null; lines: Line[]; totalPence: string; waivers: Waiver[]; reviewedBy: string; reviewedAt: string; reviewNote: string; status: DivStatus; notes: string; currency: string };
const json = <T,>(s: unknown, d: T): T => { try { return s ? (JSON.parse(String(s)) as T) : d; } catch { return d; } };
export const readDividend = (r: Row): Dividend => ({ key: str(r.Key), clientKey: str(r.ClientKey), ref: str(r.Ref), type: (str(r.Type) || "interim") as DivType, recordDate: str(r.RecordDate).slice(0, 10), declaredOn: str(r.DeclaredOn).slice(0, 10), paidOn: str(r.PaidOn).slice(0, 10), basis: json<Basis | null>(r.Rates, null), lines: json<Line[]>(r.Lines, []), totalPence: str(r.TotalPence) || "0", waivers: json<Waiver[]>(r.Waivers, []), reviewedBy: str(r.ReviewedBy), reviewedAt: str(r.ReviewedAt), reviewNote: str(r.ReviewNote), status: (str(r.Status) || "draft") as DivStatus, notes: str(r.Notes), currency: str(r.Currency) || "GBP" });

export const nextRef = (rows: Row[], clientKey: string, year: number) => {
  const used = rows.filter((r) => str(r.ClientKey) === clientKey).map((r) => str(r.Ref));
  let n = 1; while (used.includes(`DIV-${year}-${String(n).padStart(2, "0")}`)) n++;
  return `DIV-${year}-${String(n).padStart(2, "0")}`;
};

export type DivInput = { type: DivType; recordDate: string; basis: Basis; waivers: Waiver[]; notes?: string };
/** Create a draft dividend with its calculation stored as lines. Drafts can be recalculated; nothing is declared. */
export function draft(inp: DivInput, rows: Row[], clientKey: string, entries: Entry[], rights: Map<string, Rights>, by: string, now: string): { error?: string; row?: Row; calc: Calc } {
  const calc = calculate(entries, clientKey, inp.recordDate, inp.basis, rights, inp.waivers);
  if (calc.problems.length) return { error: calc.problems.join(" "), calc };
  if (BigInt(calc.totalPence) <= 0n) return { error: "The dividend comes to nothing.", calc };
  const row: Row = { Key: `DV${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, PracticeId: "", ClientKey: clientKey, Ref: nextRef(rows, clientKey, Number(inp.recordDate.slice(0, 4))), Type: inp.type, RecordDate: inp.recordDate, DeclaredOn: "", PaidOn: "", Currency: "GBP", Rates: JSON.stringify(inp.basis), Lines: JSON.stringify(calc.lines), TotalPence: calc.totalPence, Waivers: JSON.stringify(inp.waivers), ReviewedBy: "", ReviewedAt: "", ReviewNote: "", Status: "draft", Notes: inp.notes || "", Created: now, CreatedBy: by, Updated: now };
  return { row, calc };
}

/** Record that distributable profits have been reviewed. Required before declaring; the person and time are kept. */
export function review(row: Row, confirmed: boolean, note: string, by: string, now: string): { error?: string; patch?: Row } {
  const d = readDividend(row);
  if (d.status !== "draft") return { error: "Only a draft dividend can be reviewed." };
  if (!confirmed) return { error: "Tick the box to confirm that distributable profits have been reviewed." };
  if (!note.trim()) return { error: "Note what was reviewed (for example the accounts or management figures used and the profits available)." };
  return { patch: { ReviewedBy: by, ReviewedAt: now, ReviewNote: note.trim(), Updated: now } };
}

/** Check a stored dividend still matches the ledger: the calculation is redone from the ledger and compared line by line. */
export function verify(row: Row, entries: Entry[], rights: Map<string, Rights>): { ok: boolean; problems: string[] } {
  const d = readDividend(row);
  if (!d.basis) return { ok: false, problems: ["No calculation basis is stored."] };
  const c = calculate(entries, d.clientKey, d.recordDate, d.basis, rights, d.waivers);
  const problems = [...c.problems];
  const a = JSON.stringify(c.lines.map((l) => [l.holderId, l.cls, l.shares, l.paidPence])), b = JSON.stringify(d.lines.map((l) => [l.holderId, l.cls, l.shares, l.paidPence]));
  if (a !== b || c.totalPence !== d.totalPence) problems.push("The share ledger has changed since this dividend was calculated, so the amounts no longer match.");
  return { ok: !problems.length, problems };
}

/** Declare: needs the profits review, a declaration date, and a calculation that still matches the ledger. */
export function declare(row: Row, date: string, entries: Entry[], rights: Map<string, Rights>, now: string): { error?: string; patch?: Row } {
  const d = readDividend(row);
  if (d.status !== "draft") return { error: `This dividend is already ${DIV_LABEL[d.status].toLowerCase()}.` };
  if (!d.reviewedBy) return { error: "Review distributable profits before declaring the dividend." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Give the date of declaration." };
  const v = verify(row, entries, rights); if (!v.ok) return { error: v.problems.join(" ") };
  return { patch: { Status: "declared", DeclaredOn: date, Updated: now } };
}
export function markPaid(row: Row, date: string, now: string): { error?: string; patch?: Row } {
  const d = readDividend(row);
  if (d.status !== "declared") return { error: "Only a declared dividend can be marked paid." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Give the date it was paid." };
  if (date < d.declaredOn) return { error: "It can't have been paid before it was declared." };
  return { patch: { Status: "paid", PaidOn: date, Updated: now } };
}
export function cancelDividend(row: Row, reason: string, now: string): { error?: string; patch?: Row } {
  const d = readDividend(row);
  if (d.status === "paid") return { error: "A dividend that has been paid can't be cancelled: record the correction separately." };
  if (d.status === "cancelled") return { error: "Already cancelled." };
  if (!reason.trim()) return { error: "Say why it is being cancelled." };
  return { patch: { Status: "cancelled", Notes: `${d.notes ? d.notes + "\n" : ""}Cancelled: ${reason.trim()}`, Updated: now } };
}
/** A declared dividend can't be reviewed or changed in place; to alter it, cancel and draft again. */

const dmy = (s: string) => (s ? s.split("-").reverse().join("/") : "");
export async function dividendDocs(company: { name: string; number: string }, d: Dividend, directors: string[]): Promise<{ minutes: Uint8Array; schedule: Uint8Array; vouchers: Uint8Array }> {
  const head = (title: string): Block[] => [{ t: "h1", text: company.name }, { t: "small", text: `Company number ${company.number}` }, { t: "gap" }, { t: "h2", text: title }, { t: "gap" }];
  const draftNote: Block[] = d.status === "draft" ? [{ t: "p", text: "DRAFT: this dividend has not been declared." }] : [];
  const basisText = d.basis?.mode === "per-share" ? `at the following rates per share: ${Object.entries(d.basis.rates).map(([k, v]) => `${k} £${v}`).join(", ")}` : d.basis ? `as a total of ${pounds(parsePounds(d.basis.total) || 0n)} shared equally across the shares carrying dividend rights` : "";
  const waived = d.lines.filter((l) => l.waived);
  const minutes = await textPdf([[
    ...head(`Minutes of a meeting of the directors held on ${dmy(d.declaredOn) || "[date]"}`), ...draftNote,
    { t: "p", text: `Present: ${directors.join(", ") || "[directors]"}.` }, { t: "gap" },
    { t: "p", text: `It was noted that the directors had reviewed the company's distributable profits using: ${d.reviewNote || "[not yet recorded]"}${d.reviewedBy ? ` (reviewed by ${d.reviewedBy} on ${dmy(d.reviewedAt.slice(0, 10))})` : ""}.` },
    { t: "p", text: `IT WAS RESOLVED that an ${d.type} dividend (${d.ref}) totalling ${pounds(BigInt(d.totalPence))} be declared ${basisText}, payable to the shareholders on the register of members on ${dmy(d.recordDate)}.` },
    ...(waived.length ? [{ t: "p", text: `The following shareholders have waived their entitlement by documents held by the company: ${waived.map((l) => `${l.holder} (${l.cls}, ref ${l.waiverRef})`).join("; ")}.` } as Block] : []),
    { t: "gap" }, { t: "gap" }, { t: "p", text: "Signed: ______________________  Chair" }, { t: "p", text: `Date: ______________` },
  ]], `${company.name} - ${d.ref} minutes`);
  const schedule = await textPdf([[
    ...head(`Dividend schedule ${d.ref}`), ...draftNote,
    { t: "p", text: `${d.type === "final" ? "Final" : "Interim"} dividend. Record date ${dmy(d.recordDate)}. Declared ${dmy(d.declaredOn) || "not yet"}. ${d.paidOn ? `Paid ${dmy(d.paidOn)}.` : ""}` }, { t: "gap" },
    { t: "row", cells: ["Shareholder", "Class", "Shares", "Entitlement", "Paid"] },
    ...d.lines.map((l): Block => ({ t: "row", cells: [l.holder, l.cls, l.shares.toLocaleString("en-GB"), pounds(BigInt(l.entitlementPence)), l.waived ? `Waived (${l.waiverRef})` : pounds(BigInt(l.paidPence))] })),
    { t: "gap" }, { t: "p", text: `Total payable: ${pounds(BigInt(d.totalPence))}` },
    { t: "small", text: "Amounts are calculated from the share ledger as at the record date, in whole pence." },
  ]], `${company.name} - ${d.ref} schedule`);
  const vouchers = await textPdf((d.lines.filter((l) => !l.waived && BigInt(l.paidPence) > 0n).length ? d.lines.filter((l) => !l.waived && BigInt(l.paidPence) > 0n) : []).map((l): Block[] => [
    ...head("Dividend voucher"), ...draftNote,
    { t: "row", cells: ["Shareholder", l.holder] }, { t: "row", cells: ["Dividend reference", d.ref] }, { t: "row", cells: ["Type", d.type === "final" ? "Final" : "Interim"] },
    { t: "row", cells: ["Record date", dmy(d.recordDate)] }, { t: "row", cells: ["Date of payment", dmy(d.paidOn) || dmy(d.declaredOn) || "to be confirmed"] },
    { t: "row", cells: ["Shares held", `${l.shares.toLocaleString("en-GB")} ${l.cls}`] }, { t: "row", cells: ["Dividend payable", pounds(BigInt(l.paidPence))] }, { t: "gap" },
    { t: "small", text: "Keep this voucher for your tax records. The company doesn't give tax advice; speak to your adviser about how this dividend is taxed." },
  ]).concat(d.lines.some((l) => !l.waived && BigInt(l.paidPence) > 0n) ? [] : [[{ t: "p", text: "No vouchers: nobody is receiving a payment." } as Block]]), `${company.name} - ${d.ref} vouchers`);
  return { minutes, schedule, vouchers };
}
