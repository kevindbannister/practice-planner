// Dormant (never traded) company accounts. This prepares and tracks the work; it does not file anything. The rules used are Companies House's:
// a company is dormant if it had no significant accounting transactions in the period (filing fees, late filing penalties and the money paid for
// shares at incorporation don't count); dormant accounts need a balance sheet and notes, with prior-year comparatives, but no profit and loss
// account or directors' report; the balance sheet says the company was dormant throughout the period; a director signs for the board; filing is
// due nine months after the accounting reference date (first accounts covering more than 12 months: the later of 21 months after incorporation
// or three months after the reference date). From 1 April 2028 accounts must be filed through commercial software. An accounts job is only
// finished when Companies House has accepted the filing; producing the PDF is the start of the process, not the end.
// Wording of the statements below is standard small-company wording and is shown to the director to read before signing.
import { Entry, replay } from "./shareLedger";
import { Row } from "./schema";
import { Block, textPdf } from "./cosecDocs";

const str = (v: unknown): string => (v == null ? "" : String(v).trim());
const json = <T,>(v: unknown, f: T): T => { try { const x = JSON.parse(str(v)); return x == null ? f : x; } catch { return f; } };
const isoOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const addDays = (d: string, n: number) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const lastOfMonth = (d: string) => { const t = new Date(`${d}T00:00:00Z`); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); };
/** Months later, keeping the same day, or the last day of the month when the start was a month end (or the day doesn't exist). */
export function addMonths(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`); const day = t.getUTCDate(); const monthEnd = day === lastOfMonth(d);
  t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() + n);
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(monthEnd ? last : Math.min(day, last));
  return t.toISOString().slice(0, 10);
}
export const dmy = (s: string) => (s ? s.split("-").reverse().join("/") : "");
export const SOFTWARE_ONLY_FROM = "2028-04-01";

export type Period = { start: string; end: string; incorporated: string };
export const isFirst = (p: Period) => !!p.incorporated && p.start <= p.incorporated;
/** When the accounts are due at Companies House. */
export function deadline(p: Period): string {
  const std = addMonths(p.end, 9);
  if (isFirst(p) && p.end > addDays(addMonths(p.start, 12), -1)) {
    const longer = addMonths(p.incorporated, 21), alt = addMonths(p.end, 3);
    return longer > alt ? longer : alt;
  }
  return std;
}
export type Penalty = { pounds: number; tier: string };
/** The late filing penalty for a private company if filed on a date; doubled if the accounts were also late the year before. */
export function penalty(due: string, filedOn: string, lateLastYear = false): Penalty {
  if (filedOn <= due) return { pounds: 0, tier: "On time" };
  const m = (n: number) => addMonths(due, n);
  const [p, tier] = filedOn <= m(1) ? [150, "Up to 1 month late"] : filedOn <= m(3) ? [375, "1 to 3 months late"] : filedOn <= m(6) ? [750, "3 to 6 months late"] : [1500, "More than 6 months late"];
  return { pounds: (p as number) * (lateLastYear ? 2 : 1), tier: tier as string };
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export type Status = "draft" | "confirmed" | "prepared" | "approved" | "filed" | "rejected" | "complete" | "cancelled";
export const STATUS_LABEL: Record<Status, string> = { draft: "Checking eligibility", confirmed: "Ready to prepare", prepared: "Waiting for director's approval", approved: "Approved, ready to file", filed: "Filed, waiting for Companies House", rejected: "Rejected, needs refiling", complete: "Accepted by Companies House", cancelled: "Cancelled" };
export type Confirmations = { neverTraded: boolean; noTransactions: boolean; qualifies: boolean; by: string; at: string; director: string };
export type Dormant = { key: string; clientKey: string; start: string; end: string; status: Status; conf: Confirmations; figures: Figures | null; preparedOn: string; approvedBy: string; approvedOn: string; signedRef: string; filedOn: string; filedVia: string; filedRef: string; acceptedOn: string; evidence: string; notes: string; lateLastYear: boolean };
const noConf: Confirmations = { neverTraded: false, noTransactions: false, qualifies: false, by: "", at: "", director: "" };
export const readDormant = (r: Row): Dormant => ({ key: str(r.Key), clientKey: str(r.ClientKey), start: str(r.PeriodStart).slice(0, 10), end: str(r.PeriodEnd).slice(0, 10), status: (str(r.Status) || "draft") as Status, conf: { ...noConf, ...json<Partial<Confirmations>>(r.Confirmations, {}) }, figures: json<Figures | null>(r.Figures, null), preparedOn: str(r.PreparedOn), approvedBy: str(r.ApprovedBy), approvedOn: str(r.ApprovedOn).slice(0, 10), signedRef: str(r.SignedRef), filedOn: str(r.FiledOn).slice(0, 10), filedVia: str(r.FiledVia), filedRef: str(r.FiledRef), acceptedOn: str(r.AcceptedOn).slice(0, 10), evidence: str(r.Evidence), notes: str(r.Notes), lateLastYear: str(r.LateLastYear) === "yes" });
export const isOpen = (d: Dormant) => d.status !== "complete" && d.status !== "cancelled";

// ------------------------------------------------------------------ figures

export type ClassLine = { cls: string; shares: number; nominal: number; calledUpMicro: string; unpaidMicro: string };
export type Figures = { asAt: string; classes: ClassLine[]; calledUp: string; unpaid: string; paid: string; unknownPaid: boolean; wholePence: boolean };
const micro = (x: number) => BigInt(Math.round(x * 1e6));
const toPence = (m: bigint) => (m + 5000n) / 10000n;
/** Share capital at a date from the ledger. Anything with no paid amount recorded is treated as unpaid, and flagged. */
export function figuresAt(entries: Entry[], clientKey: string, asAt: string, classes: Row[]): Figures {
  const mine = entries.filter((e) => e.clientKey === clientKey && e.active && e.date <= asAt);
  const held = replay(mine.map((e) => e), asAt).holdings.filter((h) => h.number > 0);
  const byClass = new Map<string, number>(); for (const h of held) byClass.set(h.cls, (byClass.get(h.cls) || 0) + h.number);
  const lines: ClassLine[] = []; let unknownPaid = false; let calledMicro = 0n, unpaidMicro = 0n;
  for (const [cls, shares] of [...byClass.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const adds = mine.filter((e) => ["opening", "allotment", "bonus"].includes(e.type) && e.cls.toLowerCase() === cls.toLowerCase());
    const nominal = Number(classes.find((c) => str(c.Name).toLowerCase() === cls.toLowerCase())?.NominalValue) || adds.find((a) => a.nominal)?.nominal || 0;
    const totalAdded = adds.reduce((s, a) => s + a.number, 0) || 1;
    let un = 0n;
    for (const a of adds) { const nom = a.nominal || nominal; if (!a.paid) unknownPaid = true; un += BigInt(a.number) * (micro(nom) - micro(Math.min(a.paid, nom))); }
    // scale if transfers/removals changed the count (never traded companies rarely have these)
    const calledUp = BigInt(shares) * micro(nominal); const unpaid = (un * BigInt(shares)) / BigInt(totalAdded);
    lines.push({ cls, shares, nominal, calledUpMicro: calledUp.toString(), unpaidMicro: unpaid.toString() }); calledMicro += calledUp; unpaidMicro += unpaid;
  }
  const wholePence = calledMicro % 10000n === 0n && unpaidMicro % 10000n === 0n;
  const cu = toPence(calledMicro), up = toPence(unpaidMicro);
  return { asAt, classes: lines, calledUp: cu.toString(), unpaid: up.toString(), paid: (cu - up).toString(), unknownPaid, wholePence };
}
export const gbp = (pence: string | bigint) => { const p = BigInt(pence); return `${(p / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(p % 100n).toString().padStart(2, "0")}`; };

// ------------------------------------------------------------------ eligibility

export type CheckState = "ok" | "blocked" | "attention";
export type Check = { id: string; title: string; state: CheckState; detail: string };
export type AssessIn = { client: Row; verified: { status?: string; accTo?: string; accDue?: string }; period: Period; entries: Entry[]; classes: Row[]; dividends: Row[]; officers: Row[]; conf: Confirmations; today: string; others: Dormant[] };
export type Assessment = { checks: Check[]; blockers: Check[]; due: string; figures: Figures; prior: Figures | null; directors: string[] };

const personName = (r: Row) => [str(r.Title), str(r.First), str(r.Last)].filter(Boolean).join(" ") || str(r.CorporateName);
export function assess(i: AssessIn): Assessment {
  const { period: p } = i; const checks: Check[] = []; const add = (id: string, title: string, state: CheckState, detail: string) => checks.push({ id, title, state, detail });
  const periodOk = isoOk(p.start) && isoOk(p.end) && p.start <= p.end;
  const months = periodOk ? (Date.parse(p.end) - Date.parse(p.start)) / 86400000 / 30.4375 : 0;
  add("period", "Accounting period", !periodOk ? "blocked" : months > 18.2 ? "blocked" : "ok", !periodOk ? "Give the first and last day of the accounting period." : months > 18.2 ? "An accounting period can't be longer than 18 months." : `${dmy(p.start)} to ${dmy(p.end)}.`);
  if (periodOk && i.period.incorporated && p.start < i.period.incorporated) add("start", "Period starts before the company existed", "blocked", `The company was incorporated on ${dmy(i.period.incorporated)}.`);
  add("today", "Period has ended", periodOk && p.end > i.today ? "blocked" : "ok", periodOk && p.end > i.today ? "The accounting period hasn't finished yet." : "Accounts can only be prepared once the period has ended.");
  const st = i.verified.status || "";
  add("active", "Company is active", st && st !== "active" ? "blocked" : st ? "ok" : "attention", st && st !== "active" ? `Companies House shows the company as ${st}.` : st ? "Companies House shows the company as active." : "Companies House hasn't been checked for this company yet.");
  if (i.verified.accTo) {
    if (periodOk && i.verified.accTo > p.end) add("accepted", "Companies House already has these accounts", "blocked", `Companies House now expects accounts for the period ending ${dmy(i.verified.accTo)}, so this period is already filed.`);
    else if (periodOk && i.verified.accTo !== p.end) add("expects", "Period matches what Companies House expects", "attention", `Companies House expects accounts for the period ending ${dmy(i.verified.accTo)}, not ${dmy(p.end)}.`);
    else add("expects", "Period matches what Companies House expects", "ok", `Due ${dmy(i.verified.accDue || deadline(p))}.`);
  } else add("expects", "Period matches what Companies House expects", "attention", "Companies House's expected period isn't recorded: refresh from Companies House.");
  const dup = i.others.find((o) => o.start === p.start && o.end === p.end && isOpen(o));
  if (dup) add("dup", "Already in progress", "blocked", "There is already a dormant accounts job for this period.");

  // activity in the period
  const mine = i.entries.filter((e) => e.clientKey === str(i.client.Key) && e.active && periodOk && e.date >= p.start && e.date <= p.end);
  const after = mine.filter((e) => e.date > (p.incorporated || "0000"));
  const moves = after.filter((e) => e.type !== "transfer"), transfers = after.filter((e) => e.type === "transfer");
  add("shares", "No share issues, bonus issues, redemptions or cancellations after incorporation", moves.length ? "blocked" : "ok", moves.length ? `The ledger has ${moves.map((e) => `${e.type} of ${e.number} ${e.cls} on ${dmy(e.date)}`).join("; ")}. Money received for later shares is a transaction, so the company may not be dormant: a person must decide.` : "Only the shares issued when the company was set up appear in the period.");
  if (transfers.length) add("transfers", "Transfers between shareholders", "attention", `${transfers.length} transfer${transfers.length > 1 ? "s" : ""} in the period. These are between shareholders and don't involve the company, but check no stamp duty or company payment was involved.`);
  const prem = i.entries.some((e) => e.clientKey === str(i.client.Key) && e.active && e.premium > 0);
  add("premium", "No share premium", prem ? "blocked" : "ok", prem ? "A share premium is recorded, so the balance sheet needs a share premium account. Not supported here." : "No share premium is recorded.");
  const divs = i.dividends.filter((d) => str(d.ClientKey) === str(i.client.Key) && ["declared", "paid"].includes(str(d.Status)) && periodOk && ((str(d.DeclaredOn) >= p.start && str(d.DeclaredOn) <= p.end) || (str(d.RecordDate) >= p.start && str(d.RecordDate) <= p.end)));
  add("dividends", "No dividends", divs.length ? "blocked" : "ok", divs.length ? `${divs.length} dividend${divs.length > 1 ? "s" : ""} declared or paid in the period. A company that pays dividends hasn't been dormant.` : "No dividends in the period.");

  const figures = figuresAt(i.entries, str(i.client.Key), periodOk ? p.end : i.today, i.classes);
  const first = isFirst(p);
  const priorDate = periodOk ? addDays(p.start, -1) : "";
  const prior = periodOk && !first ? figuresAt(i.entries, str(i.client.Key), priorDate, i.classes) : null;
  add("capital", "Share capital on the ledger", figures.classes.length ? "ok" : "blocked", figures.classes.length ? `${figures.classes.map((c) => `${c.shares.toLocaleString("en-GB")} ${c.cls}`).join(", ")} in issue at the end of the period.` : "No shares are on the share ledger at the end of the period, so there is nothing to put on the balance sheet.");
  if (figures.unknownPaid && figures.classes.length) add("paid", "Whether the shares are paid", "attention", "The ledger doesn't say how much was paid on some shares. They are treated as unpaid on the balance sheet. Correct the ledger entry if they were paid.");
  if (figures.classes.length && !figures.wholePence) add("pence", "Share capital isn't a whole number of pence", "attention", "The nominal values give fractions of a penny; the balance sheet rounds to the nearest penny.");
  if (prior && JSON.stringify(prior.classes) !== JSON.stringify(figures.classes) && !moves.length) add("compare", "Comparatives differ from the current year", "attention", "The share capital at the start of the period differs from the end without a share issue in the ledger. Check the ledger.");

  const directors = i.officers.filter((o) => str(o.ClientKey) === str(i.client.Key) && str(o.Status) === "current" && /director/i.test(str(o.Role))).map(personName);
  add("directors", "A director to sign", directors.length ? "ok" : "blocked", directors.length ? `Director${directors.length > 1 ? "s" : ""}: ${directors.join(", ")}.` : "No current director is recorded for the company.");
  const c = i.conf;
  const done = c.neverTraded && c.noTransactions && c.qualifies && !!c.by && !!c.director;
  add("confirm", "Confirmed by a person", done ? "ok" : "blocked", done ? `Confirmed by ${c.by}${c.at ? ` on ${dmy(c.at.slice(0, 10))}` : ""}; signing director ${c.director}.` : "A person must confirm the three statements below and choose the signing director. The system can't tell whether the company has traded.");
  const due = periodOk ? deadline(p) : "";
  if (due && due < i.today) add("late", "Deadline", "attention", `Due ${dmy(due)}: already past. A late filing penalty applies until the accounts are accepted.`);
  else if (due) add("late", "Deadline", "ok", `Due ${dmy(due)}.`);
  add("route", "How it will be filed", "attention", `This system doesn't file accounts with Companies House. ${i.today < SOFTWARE_ONLY_FROM ? `Until 1 April 2028 dormant accounts can be filed using Companies House's online dormant accounts template (WebFiling); from 1 April 2028 accounts have to be filed using commercial software.` : "Since 1 April 2028 accounts have to be filed using commercial software."} Record the filing here once it is done.`);
  return { checks, blockers: checks.filter((x) => x.state === "blocked"), due, figures, prior, directors };
}
export const STATEMENTS: [keyof Pick<Confirmations, "neverTraded" | "noTransactions" | "qualifies">, string][] = [
  ["neverTraded", "The company has never traded since it was incorporated."],
  ["noTransactions", "Throughout this period the company had no significant accounting transactions: nothing it had to record in its accounting records, other than the filing fees, late filing penalties and share subscription money that don't count."],
  ["qualifies", "The company is a private company that qualifies for the small companies regime (not a subsidiary preparing group accounts, not a public company, and not a bank, insurer or other excluded company), and none of its members has asked for an audit."],
];

// ------------------------------------------------------------------ workflow

export type Written = { error?: string; creates: Row[]; patches: { row: Row; patch: Row }[] };
const fail = (error: string): Written => ({ error, creates: [], patches: [] });

export function start(client: Row, period: Period, others: Row[], by: string, now: string): Written {
  if (!isoOk(period.start) || !isoOk(period.end) || period.start > period.end) return fail("Give the first and last day of the accounting period.");
  if (others.some((r) => str(r.ClientKey) === str(client.Key) && str(r.PeriodStart).slice(0, 10) === period.start && str(r.PeriodEnd).slice(0, 10) === period.end && !["cancelled"].includes(str(r.Status)))) return fail("There is already a dormant accounts job for that period.");
  return { creates: [{ Key: `DA${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, PracticeId: "", ClientKey: str(client.Key), PeriodStart: period.start, PeriodEnd: period.end, Kind: "dormant", Status: "draft", Confirmations: JSON.stringify(noConf), Figures: "", Deadline: deadline(period), Created: now, CreatedBy: by, Updated: now }], patches: [] };
}
export function confirm(row: Row, c: { neverTraded: boolean; noTransactions: boolean; qualifies: boolean; director: string }, by: string, now: string): Written {
  const d = readDormant(row);
  if (!["draft", "confirmed", "prepared"].includes(d.status)) return fail("This can't be changed now.");
  if (!c.neverTraded || !c.noTransactions || !c.qualifies) return fail("Tick all three statements, or this isn't a dormant company for accounts purposes.");
  if (!c.director.trim()) return fail("Choose the director who will sign.");
  return { creates: [], patches: [{ row, patch: { Confirmations: JSON.stringify({ ...c, by, at: now }), Status: d.status === "draft" ? "confirmed" : d.status, Updated: now } }] };
}
/** Prepare the accounts: only when nothing blocks, and the figures are kept so any later change to the ledger is noticed. */
export function prepare(row: Row, a: Assessment, now: string): Written {
  const d = readDormant(row);
  if (!["confirmed", "prepared"].includes(d.status)) return fail(d.status === "draft" ? "Confirm the statements first." : "The accounts are already past this stage.");
  if (a.blockers.length) return fail(`Not ready: ${a.blockers[0].title}. ${a.blockers[0].detail}`);
  return { creates: [], patches: [{ row, patch: { Status: "prepared", Figures: JSON.stringify(a.figures), PreparedOn: now, Deadline: a.due, Updated: now } }] };
}
export function drifted(row: Row, a: Assessment): boolean { const d = readDormant(row); return !!d.figures && JSON.stringify(d.figures) !== JSON.stringify(a.figures); }
export function approve(row: Row, a: Assessment, director: string, date: string, signedRef: string, today: string, now: string): Written {
  const d = readDormant(row);
  if (d.status !== "prepared") return fail("Prepare the accounts first.");
  if (drifted(row, a)) return fail("The share ledger has changed since the accounts were prepared. Prepare them again so the director signs the right figures.");
  if (a.blockers.length) return fail(`Not ready: ${a.blockers[0].title}.`);
  if (!director.trim()) return fail("Say which director approved the accounts.");
  if (!isoOk(date) || date > today) return fail("Give the date the director signed (not in the future).");
  if (date < d.preparedOn.slice(0, 10)) return fail("The accounts can't have been signed before they were prepared.");
  if (!signedRef.trim()) return fail("Save the signed copy to the client's documents and note its name here. Approval can't be recorded without it.");
  return { creates: [], patches: [{ row, patch: { Status: "approved", ApprovedBy: director.trim(), ApprovedOn: date, SignedRef: signedRef.trim(), Updated: now } }] };
}
export const FILED_VIA = [["webfiling", "Companies House online dormant accounts (WebFiling)"], ["software", "Commercial accounts software"], ["paper", "Paper (only while still allowed)"]] as const;
export function filed(row: Row, date: string, via: string, ref: string, today: string, now: string): Written {
  const d = readDormant(row);
  if (!["approved", "rejected"].includes(d.status)) return fail("The accounts need the director's approval recorded before they can be marked as filed.");
  if (!isoOk(date) || date > today) return fail("Give the date it was filed (not in the future).");
  if (date < d.approvedOn) return fail("It can't have been filed before the director approved it.");
  if (!FILED_VIA.some(([k]) => k === via)) return fail("Say how it was filed.");
  if (via !== "software" && date >= SOFTWARE_ONLY_FROM) return fail("From 1 April 2028 accounts have to be filed using commercial software.");
  return { creates: [], patches: [{ row, patch: { Status: "filed", FiledOn: date, FiledVia: via, FiledRef: ref.trim(), Updated: now } }] };
}
export function rejected(row: Row, reason: string, now: string): Written {
  const d = readDormant(row);
  if (d.status !== "filed") return fail("Only a filed set of accounts can be rejected.");
  if (!reason.trim()) return fail("Say why Companies House rejected it.");
  return { creates: [], patches: [{ row, patch: { Status: "rejected", Notes: `${d.notes ? d.notes + "\n" : ""}Rejected: ${reason.trim()}`, Updated: now } }] };
}
/** Finished only on evidence that Companies House accepted the filing: either its record now expects the next period, or a person records the acceptance. */
export function accepted(row: Row, verified: { accTo?: string; at?: string }, manual: { date: string; evidence: string } | null, today: string, now: string): Written {
  const d = readDormant(row);
  if (d.status !== "filed") return fail(d.status === "approved" ? "It hasn't been filed yet." : "Only filed accounts can be marked accepted.");
  const auto = !!verified.accTo && verified.accTo > d.end;
  if (!auto) {
    if (!manual) return fail("Companies House's record still shows these accounts as outstanding. Refresh from Companies House, or record the acceptance email or filing history entry below.");
    if (!isoOk(manual.date) || manual.date > today) return fail("Give the date Companies House accepted it (not in the future).");
    if (manual.date < d.filedOn) return fail("It can't have been accepted before it was filed.");
    if (!manual.evidence.trim()) return fail("Note the evidence: the acceptance email, or the entry in the filing history.");
  }
  return { creates: [], patches: [{ row, patch: { Status: "complete", AcceptedOn: auto ? (verified.at || now).slice(0, 10) : manual!.date, Evidence: auto ? `Companies House record now expects accounts for the period ending ${verified.accTo}.` : manual!.evidence.trim(), Updated: now } }] };
}
export function cancel(row: Row, reason: string, now: string): Written {
  const d = readDormant(row);
  if (!isOpen(d)) return fail("Already finished.");
  if (["filed"].includes(d.status)) return fail("Filed accounts can't be cancelled: mark them rejected or accepted.");
  if (!reason.trim()) return fail("Say why.");
  return { creates: [], patches: [{ row, patch: { Status: "cancelled", Notes: `${d.notes ? d.notes + "\n" : ""}Cancelled: ${reason.trim()}`, Updated: now } }] };
}

// ------------------------------------------------------------------ documents

export type DocIn = { company: { name: string; number: string }; d: Dormant; fig: Figures; prior: Figures | null; period: Period; director: string; approvedOn: string };
const money = (p: string | undefined) => (p === undefined ? "" : gbp(p));
export async function accountsPdf(i: DocIn): Promise<Uint8Array> {
  const approved = !!i.approvedOn; const cur = i.fig, pr = i.prior;
  const periodText = `${dmy(i.period.start)} to ${dmy(i.period.end)}`;
  const row = (label: string, a: string, b: string): Block => ({ t: "row", cells: [label, a, b] });
  const head = (title: string): Block[] => [{ t: "h1", text: i.company.name }, { t: "small", text: `Company number ${i.company.number}` }, { t: "gap" }, { t: "h2", text: title }, ...(approved ? [] : [{ t: "p", text: "DRAFT: not yet approved or signed by a director." } as Block]), { t: "gap" }];
  const bs: Block[] = [
    ...head(`Balance sheet as at ${dmy(i.period.end)}`),
    row("", `${dmy(i.period.end)}`, pr ? dmy(pr.asAt) : "Comparative"), { t: "gap" },
    ...(BigInt(cur.unpaid) > 0n || (pr && BigInt(pr.unpaid) > 0n) ? [row("Called up share capital not paid", `£${money(cur.unpaid)}`, pr ? `£${money(pr.unpaid)}` : "n/a")] : []),
    ...(BigInt(cur.paid) > 0n || (pr && BigInt(pr.paid) > 0n) ? [row("Cash at bank and in hand", `£${money(cur.paid)}`, pr ? `£${money(pr.paid)}` : "n/a")] : []),
    row("Net assets", `£${money(cur.calledUp)}`, pr ? `£${money(pr.calledUp)}` : "n/a"), { t: "gap" },
    { t: "h2", text: "Capital and reserves" },
    row("Called up share capital (note 2)", `£${money(cur.calledUp)}`, pr ? `£${money(pr.calledUp)}` : "n/a"),
    row("Profit and loss account", "£0.00", pr ? "£0.00" : "n/a"),
    row("Shareholders' funds", `£${money(cur.calledUp)}`, pr ? `£${money(pr.calledUp)}` : "n/a"), { t: "gap" },
    ...(pr ? [] : [{ t: "small", text: `This is the company's first accounting period, so there are no comparative figures.` } as Block]),
    { t: "p", text: "The company was dormant throughout the accounting period." },
    { t: "p", text: `For the period ended ${dmy(i.period.end)} the company was entitled to exemption from audit under section 480 of the Companies Act 2006 relating to dormant companies.` },
    { t: "p", text: "The members have not required the company to obtain an audit of its accounts for the period in question in accordance with section 476." },
    { t: "p", text: "The directors acknowledge their responsibilities for complying with the requirements of the Act with respect to accounting records and the preparation of accounts." },
    { t: "p", text: "These accounts have been prepared in accordance with the provisions applicable to companies subject to the small companies regime." },
    { t: "gap" },
    { t: "p", text: approved ? `Approved by the board of directors on ${dmy(i.approvedOn)} and signed on its behalf by:` : "Approved by the board of directors on ______________ and signed on its behalf by:" }, { t: "gap" }, { t: "gap" },
    { t: "p", text: "______________________" }, { t: "p", text: i.director }, { t: "p", text: "Director" }, { t: "gap" },
    { t: "small", text: `Company registration number ${i.company.number}. The notes form part of these accounts.` },
  ];
  const notes: Block[] = [
    ...head(`Notes to the accounts for the period ${periodText}`),
    { t: "h2", text: "1. Accounting policies" },
    { t: "p", text: "The company was dormant throughout the period: it had no significant accounting transactions. These accounts are prepared under the historical cost convention and in accordance with the Companies Act 2006 provisions for small companies and Section 1A of FRS 102." }, { t: "gap" },
    { t: "h2", text: "2. Called up share capital" },
    { t: "row", cells: ["Class", "Number", "Nominal value", "Called up"] },
    ...cur.classes.map((c): Block => ({ t: "row", cells: [c.cls, c.shares.toLocaleString("en-GB"), `£${c.nominal}`, `£${gbp(toPence(BigInt(c.calledUpMicro)))}`] })),
    { t: "gap" }, { t: "p", text: `Called up share capital not paid at the period end: £${money(cur.unpaid)}.` },
    { t: "gap" }, { t: "h2", text: "3. Employees" }, { t: "p", text: "The company had no employees during the period." },
  ];
  return textPdf([bs, notes], `${i.company.name} - dormant accounts ${dmy(i.period.end)}${approved ? "" : " - DRAFT"}`);
}
/** A cover note for the director: what is being signed, what the system could and couldn't check, and what happens next. */
export async function coverPdf(i: DocIn, a: Assessment): Promise<Uint8Array> {
  const b: Block[] = [
    { t: "h1", text: i.company.name }, { t: "small", text: `Company number ${i.company.number}` }, { t: "gap" },
    { t: "h2", text: `Dormant accounts for the period ${dmy(i.period.start)} to ${dmy(i.period.end)}: note for the director` }, { t: "gap" },
    { t: "p", text: "Please read the draft accounts. By signing the balance sheet you confirm, on the board's behalf, that the company was dormant throughout the period." },
    { t: "p", text: "A person at the practice confirmed the following. We can't check these from our records, so please be sure they are right:" },
    ...STATEMENTS.map(([, t]): Block => ({ t: "p", text: `- ${t}` })),
    { t: "gap" }, { t: "p", text: `Accounts are due at Companies House by ${dmy(a.due)}. A late filing penalty for a private company starts at £150 and rises to £1,500 the longer they are late; it doubles if the accounts were also late the year before.` },
    { t: "p", text: "Sign the balance sheet, then return the signed copy to us. We will then file the accounts and tell you when Companies House has accepted them." },
    { t: "gap" }, { t: "small", text: "Company accounts don't remove the duty to file a confirmation statement." },
  ];
  return textPdf([b], `${i.company.name} - note for the director`);
}
