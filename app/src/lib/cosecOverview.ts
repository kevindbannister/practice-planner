// What the company overview shows: directors, shareholders with shares and percentages, and dividends for the current and previous year.
// The year is the company's accounting year when Companies House's accounts period is known, otherwise the calendar year. Pure logic.
import { Row } from "./schema";
import { Entry } from "./shareLedger";
import { owners } from "./cosecShares";
import { addMonths } from "./cosecDormant";
import { readDividend } from "./cosecDividends";

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

export type Year = { label: string; start: string; end: string };
/** The 12-month year containing today and the one before, lined up with the accounts period end when it's known. */
export function years(accTo: string | undefined, today: string): { current: Year; prior: Year } {
  let end: string;
  if (accTo && /^\d{4}-\d{2}-\d{2}$/.test(accTo)) {
    end = accTo;
    let guard = 0;
    while (end < today && guard++ < 200) end = addMonths(end, 12);
    while (addMonths(end, -12) >= today && guard++ < 400) end = addMonths(end, -12);
  } else end = `${today.slice(0, 4)}-12-31`;
  const mk = (e: string): Year => { const start = addDays(addMonths(e, -12), 1); return { label: `${start.split("-").reverse().join("/")} to ${e.split("-").reverse().join("/")}`, start, end: e }; };
  return { current: mk(end), prior: mk(addMonths(end, -12)) };
}

export type DivRow = { key: string; ref: string; type: string; date: string; totalPence: string; status: string };
export type DivYear = Year & { rows: DivRow[]; totalPence: string; drafts: number };
/** Dividends declared or paid in each year, by the date declared. Drafts and cancelled ones aren't counted; drafts are noted. */
export function dividendYears(rows: Row[], clientKey: string, accTo: string | undefined, today: string): { current: DivYear; prior: DivYear } {
  const ys = years(accTo, today); const mine = rows.filter((r) => str(r.ClientKey) === clientKey).map(readDividend);
  const pick = (y: Year): DivYear => {
    const live = mine.filter((d) => (d.status === "declared" || d.status === "paid") && d.declaredOn >= y.start && d.declaredOn <= y.end).sort((a, b) => a.declaredOn.localeCompare(b.declaredOn));
    const drafts = mine.filter((d) => d.status === "draft" && d.recordDate >= y.start && d.recordDate <= y.end).length;
    return { ...y, rows: live.map((d) => ({ key: d.key, ref: d.ref, type: d.type, date: d.declaredOn, totalPence: d.totalPence, status: d.status })), totalPence: live.reduce((s, d) => s + BigInt(d.totalPence), 0n).toString(), drafts };
  };
  return { current: pick(ys.current), prior: pick(ys.prior) };
}

export type Holder = { name: string; shares: number; percent: number; votePercent?: number; classes: string };
/** Shareholders with shares and percentage: from the share ledger when it has entries, otherwise from the shareholders register. */
export function shareholders(entries: Entry[], classes: Row[], register: Row[], clientKey: string, asOf: string): { holders: Holder[]; issued: number; source: "ledger" | "register" | "none" } {
  if (entries.some((e) => e.clientKey === clientKey)) {
    const o = owners(entries, classes, clientKey, asOf);
    return { holders: o.owners.map((x) => ({ name: x.name, shares: x.shares, percent: x.sharePercent, votePercent: x.votePercent, classes: x.classes.map((c) => `${c.number.toLocaleString("en-GB")} ${c.cls}`).join(", ") })), issued: o.issued, source: "ledger" };
  }
  const cur = register.filter((r) => str(r.ClientKey) === clientKey && str(r.Status) === "current");
  const by = new Map<string, { name: string; shares: number; cls: Map<string, number> }>();
  for (const r of cur) {
    const id = str(r.HolderKey) || str(r.Holder).toLowerCase(); const n = Number(r.Number) || 0;
    const h = by.get(id) || { name: str(r.Holder), shares: 0, cls: new Map() }; h.shares += n; h.cls.set(str(r.Class), (h.cls.get(str(r.Class)) || 0) + n); by.set(id, h);
  }
  const issued = [...by.values()].reduce((s, h) => s + h.shares, 0);
  const holders = [...by.values()].filter((h) => h.shares > 0).sort((a, b) => b.shares - a.shares || a.name.localeCompare(b.name)).map((h) => ({ name: h.name, shares: h.shares, percent: issued ? Math.round((h.shares / issued) * 10000) / 100 : 0, classes: [...h.cls].map(([c, n]) => `${n.toLocaleString("en-GB")} ${c}`).join(", ") }));
  return { holders, issued, source: holders.length ? "register" : "none" };
}

export type Person = { name: string; role: string; appointed: string; id: string };
const nm = (r: Row) => [str(r.Title), str(r.First), str(r.Last)].filter(Boolean).join(" ") || str(r.CorporateName) || str(r.Name);
export function officers(rows: Row[], clientKey: string): { directors: Person[]; others: Person[] } {
  const cur = rows.filter((r) => str(r.ClientKey) === clientKey && str(r.Status) === "current").map((r): Person => ({ name: nm(r), role: str(r.Role) || "director", appointed: str(r.AppointedOn).slice(0, 10), id: str(r.IdStatus) }));
  const isDir = (p: Person) => /director|member/i.test(p.role);
  const by = (a: Person, b: Person) => a.name.localeCompare(b.name);
  return { directors: cur.filter(isDir).sort(by), others: cur.filter((p) => !isDir(p)).sort(by) };
}
