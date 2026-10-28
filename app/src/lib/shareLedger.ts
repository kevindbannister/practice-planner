// The share transaction ledger: the source of truth for who holds what. Holdings and ownership at any date are worked out by
// replaying the entries, never stored as the only copy. Entries are not edited: a correction is a new entry that supersedes the
// old one, with a reason. Pure logic: no storage here.
import { Row } from "./schema";

export type EntryType = "opening" | "allotment" | "bonus" | "transfer" | "redemption" | "cancellation";
export const ENTRY_LABEL: Record<EntryType, string> = { opening: "Opening balance", allotment: "Allotment", bonus: "Bonus issue", transfer: "Transfer", redemption: "Redemption", cancellation: "Cancellation" };
const ADDS: EntryType[] = ["opening", "allotment", "bonus"];
const REMOVES: EntryType[] = ["redemption", "cancellation"];

export type Entry = {
  key: string; clientKey: string; type: EntryType; date: string; cls: string; number: number;
  from: string; fromKey: string; to: string; toKey: string; currency: string; nominal: number; paid: number; premium: number; consideration: string;
  txKey: string; idem: string; supersedes: string; reason: string; active: boolean; created: string; notes: string;
};
const str = (v: unknown) => (v == null ? "" : String(v));
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function readEntry(r: Row): Entry {
  return {
    key: str(r.Key), clientKey: str(r.ClientKey), type: (str(r.Type) || "opening") as EntryType, date: str(r.EffectiveDate).slice(0, 10), cls: str(r.Class), number: num(r.Number),
    from: str(r.FromHolder), fromKey: str(r.FromKey), to: str(r.ToHolder), toKey: str(r.ToKey), currency: str(r.Currency) || "GBP", nominal: num(r.Nominal), paid: num(r.PaidPerShare), premium: num(r.Premium),
    consideration: str(r.Consideration), txKey: str(r.TxKey), idem: str(r.IdemKey), supersedes: str(r.Supersedes), reason: str(r.Reason), active: str(r.Status) !== "superseded", created: str(r.Created), notes: str(r.Notes),
  };
}

/** One identity for a holder: the linked record when there is one, otherwise the name, ignoring case and spacing. */
export const holderId = (name: string, key = "") => (key ? `k:${key}` : `n:${name.trim().toLowerCase().replace(/\s+/g, " ")}`);
const slot = (cls: string, id: string) => `${cls.trim().toLowerCase()}|${id}`;

export type Holding = { id: string; name: string; key: string; cls: string; number: number };
export type Replay = { holdings: Holding[]; problems: string[] };

const order = (a: Entry, b: Entry) => a.date.localeCompare(b.date) || a.created.localeCompare(b.created) || a.key.localeCompare(b.key);

/** What each holder has as at a date (inclusive). Reports any point where someone would hold fewer than nothing. */
const nameKey = (n: string) => n.trim().toLowerCase().replace(/\s+/g, " ");
/** Entries where the same person is sometimes named with a record key and sometimes by name alone are treated as one holder: a name learned with a key stands for that key. */
export function canon(entries: Entry[]): Entry[] {
  const keys = new Map<string, Set<string>>();
  const learn = (name: string, key: string) => { if (!name.trim() || !key) return; const k = nameKey(name); keys.set(k, (keys.get(k) || new Set()).add(key)); };
  for (const e of entries) { learn(e.from, e.fromKey); learn(e.to, e.toKey); }
  const pick = (name: string, key: string) => { if (key || !name.trim()) return key; const s = keys.get(nameKey(name)); return s && s.size === 1 ? [...s][0] : key; };
  return entries.map((e) => (e.fromKey && e.toKey) || (!e.from && !e.to) ? e : { ...e, fromKey: pick(e.from, e.fromKey), toKey: pick(e.to, e.toKey) });
}
export function replay(entriesIn: Entry[], asOf = "9999-12-31"): Replay {
  const entries = canon(entriesIn);
  const bal = new Map<string, Holding>();
  const problems: string[] = [];
  const move = (e: Entry, name: string, key: string, delta: number) => {
    const id = holderId(name, key);
    const k = slot(e.cls, id);
    const cur = bal.get(k) || { id, name: name.trim(), key, cls: e.cls.trim(), number: 0 };
    cur.number += delta;
    if (key && !cur.key) cur.key = key;
    bal.set(k, cur);
    if (cur.number < 0) problems.push(`${name || "A holder"} would hold ${cur.number} ${e.cls} shares on ${e.date}.`);
  };
  for (const e of entries.filter((x) => x.active).sort(order)) {
    if (e.date > asOf) continue;
    if (ADDS.includes(e.type)) move(e, e.to, e.toKey, e.number);
    else if (REMOVES.includes(e.type)) move(e, e.from, e.fromKey, -e.number);
    else if (e.type === "transfer") { move(e, e.from, e.fromKey, -e.number); move(e, e.to, e.toKey, e.number); }
  }
  return { holdings: [...bal.values()].filter((h) => h.number !== 0).sort((a, b) => a.cls.localeCompare(b.cls) || b.number - a.number || a.name.localeCompare(b.name)), problems };
}

export type Ownership = { id: string; name: string; total: number; percent: number; byClass: { cls: string; number: number; percentOfClass: number }[] };
/** Share of issued shares by number of shares. Voting and dividend rights are not modelled yet, so this is not a control test. */
export function ownership(holdings: Holding[]): { issued: number; byClass: { cls: string; issued: number }[]; holders: Ownership[] } {
  const issued = holdings.reduce((s, h) => s + h.number, 0);
  const classes = [...new Set(holdings.map((h) => h.cls))];
  const classTotal = (c: string) => holdings.filter((h) => h.cls === c).reduce((s, h) => s + h.number, 0);
  const ids = [...new Set(holdings.map((h) => h.id))];
  const holders = ids.map((id) => {
    const mine = holdings.filter((h) => h.id === id);
    const total = mine.reduce((s, h) => s + h.number, 0);
    return { id, name: mine[0].name, total, percent: issued ? Math.round((total / issued) * 10000) / 100 : 0, byClass: mine.map((h) => ({ cls: h.cls, number: h.number, percentOfClass: classTotal(h.cls) ? Math.round((h.number / classTotal(h.cls)) * 10000) / 100 : 0 })) };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { issued, byClass: classes.map((c) => ({ cls: c, issued: classTotal(c) })), holders };
}

export type NewEntry = { type: EntryType; date: string; cls: string; number: number; from?: string; fromKey?: string; to?: string; toKey?: string; currency?: string; nominal?: number; paid?: number; premium?: number; consideration?: string; txKey?: string; idem?: string; notes?: string; source?: string };

/** Problems with a proposed entry, judged against the existing ledger. Empty means it can be recorded. */
export function entryProblems(e: NewEntry, existing: Entry[], classes?: string[]): string[] {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || Number.isNaN(Date.parse(e.date))) out.push("Enter the effective date.");
  if (!e.cls.trim()) out.push("Choose the share class.");
  else if (classes && classes.length && !classes.some((c) => c.toLowerCase() === e.cls.trim().toLowerCase())) out.push(`${e.cls} isn't one of this company's share classes.`);
  if (!(e.number > 0) || !Number.isInteger(e.number)) out.push("Enter a whole number of shares above nothing.");
  if (ADDS.includes(e.type) && !(e.to || "").trim()) out.push("Enter who receives the shares.");
  if (REMOVES.includes(e.type) && !(e.from || "").trim()) out.push("Enter whose shares these are.");
  if (e.type === "transfer") {
    if (!(e.from || "").trim()) out.push("Enter who is transferring.");
    if (!(e.to || "").trim()) out.push("Enter who receives the shares.");
    if (holderId(e.from || "", e.fromKey) === holderId(e.to || "", e.toKey) && (e.from || "").trim()) out.push("A holder can't transfer shares to themselves.");
  }
  if (out.length) return out;
  const probe: Entry = { key: "~new", clientKey: "", type: e.type, date: e.date, cls: e.cls, number: e.number, from: e.from || "", fromKey: e.fromKey || "", to: e.to || "", toKey: e.toKey || "", currency: e.currency || "GBP", nominal: e.nominal || 0, paid: e.paid || 0, premium: e.premium || 0, consideration: e.consideration || "", txKey: "", idem: "", supersedes: "", reason: "", active: true, created: "9999-12-31T23:59:59.999Z", notes: "" };
  const before = new Set(replay(existing).problems);
  const added = replay([...existing, probe]).problems.filter((p) => !before.has(p));
  return added.length ? [added[0].replace("would hold", "would be left holding"), "Shares can only move if the holder has them on that date, and every later date."].slice(0, 2) : [];
}

export type Written = { creates: Row[]; patches: { row: Row; patch: Row }[]; skipped: number };
let counter = 0;
const newKey = () => `SL${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
export function entryRow(e: NewEntry, clientKey: string, by: string, now: string, key = newKey()): Row {
  return { Key: key, PracticeId: "", ClientKey: clientKey, Type: e.type, EffectiveDate: e.date, Class: e.cls.trim(), Number: e.number, FromHolder: e.from || "", FromKey: e.fromKey || "", ToHolder: e.to || "", ToKey: e.toKey || "", Currency: e.currency || "GBP", Nominal: e.nominal || 0, PaidPerShare: e.paid || 0, Premium: e.premium || 0, Consideration: e.consideration || "", TxKey: e.txKey || "", IdemKey: e.idem || "", Supersedes: "", Reason: "", Status: "active", Notes: e.notes || "", Source: e.source || "", Created: now, CreatedBy: by };
}

/** Record an entry once: the same idempotency key (a retry, a page refresh) is skipped. */
export function record(e: NewEntry, clientKey: string, existing: Entry[], classes: string[] | undefined, by: string, now: string): { error?: string; row?: Row; skipped?: boolean } {
  if (e.idem && existing.some((x) => x.idem === e.idem && x.clientKey === clientKey)) return { skipped: true };
  const scoped = existing.filter((x) => x.clientKey === clientKey);
  const p = entryProblems(e, scoped, classes);
  if (p.length) return { error: p.join(" ") };
  return { row: entryRow(e, clientKey, by, now) };
}

/** Correct an entry: the old one is marked superseded and a replacement is added, with the reason. Nothing is deleted. */
export function supersede(old: Entry, oldRow: Row, replacement: NewEntry, existing: Entry[], by: string, now: string, reason: string): { error?: string; patch?: Row; row?: Row } {
  if (!reason.trim()) return { error: "Give the reason for the correction." };
  if (!old.active) return { error: "That entry has already been corrected." };
  const rest = existing.filter((x) => x.clientKey === old.clientKey && x.key !== old.key);
  const p = entryProblems(replacement, rest);
  if (p.length) return { error: p.join(" ") };
  const row = entryRow(replacement, old.clientKey, by, now);
  row.Supersedes = old.key;
  row.Reason = reason.trim();
  return { patch: { Status: "superseded" }, row };
}

export type Difference = { holder: string; cls: string; register: number; ledger: number; kind: "differs" | "register-only" | "ledger-only" };
/** Compare the working register (CoSecShares rows that are current) with what the ledger says today. */
export function reconcile(register: Row[], entries: Entry[], asOf = "9999-12-31"): { differences: Difference[]; matches: number } {
  const reg = new Map<string, { holder: string; cls: string; n: number }>();
  for (const r of register.filter((x) => str(x.Status) === "current")) {
    const id = holderId(str(r.Holder), str(r.HolderKey));
    const k = slot(str(r.Class), id);
    const cur = reg.get(k) || { holder: str(r.Holder), cls: str(r.Class).trim(), n: 0 };
    cur.n += num(r.Number);
    reg.set(k, cur);
  }
  const led = new Map(replay(entries, asOf).holdings.map((h) => [slot(h.cls, h.id), h]));
  const out: Difference[] = [];
  let matches = 0;
  for (const [k, r] of reg) {
    const l = led.get(k);
    if (!l) out.push({ holder: r.holder, cls: r.cls, register: r.n, ledger: 0, kind: "register-only" });
    else if (l.number !== r.n) out.push({ holder: r.holder, cls: r.cls, register: r.n, ledger: l.number, kind: "differs" });
    else matches++;
  }
  for (const [k, l] of led) if (!reg.has(k)) out.push({ holder: l.name, cls: l.cls, register: 0, ledger: l.number, kind: "ledger-only" });
  return { differences: out.sort((a, b) => a.holder.localeCompare(b.holder)), matches };
}

/** Opening-balance entries for register holdings the ledger doesn't hold yet, so the existing register is carried in, not lost. The user confirms the date. */
export function openingFromRegister(register: Row[], entries: Entry[], clientKey: string, openingDate: string, by: string, now: string): Row[] {
  const { differences } = reconcile(register, entries);
  const rows: Row[] = [];
  for (const d of differences) {
    if (d.kind === "ledger-only") continue;
    const gap = d.register - d.ledger;
    if (gap <= 0) continue;
    const src = register.find((r) => str(r.Status) === "current" && str(r.Holder) === d.holder && str(r.Class).trim() === d.cls);
    rows.push(entryRow({ type: "opening", date: openingDate, cls: d.cls, number: gap, to: d.holder, toKey: str(src?.HolderKey), currency: str(src?.Currency) || "GBP", nominal: num(src?.NominalValue), paid: num(src?.PaidPerShare), idem: `opening:${clientKey}:${holderId(d.holder, str(src?.HolderKey))}:${d.cls.toLowerCase()}`, notes: "Carried in from the working register. Earlier history not recorded." }, clientKey, by, now));
  }
  return rows;
}
