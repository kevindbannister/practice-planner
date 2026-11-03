// The payments, credits and charges on a client's HMRC Self Assessment account, copied from the agent services page and pasted in.
// Each line is a date, what it is and an amount. parseAccount reads the lines, planAccount works out which tax year each one belongs
// to and whether it matches what that year's return expects, and applyAccount puts them on the returns. Nothing is saved here:
// the import dialog shows the plan first so each line can be checked or moved.
import { PaymentLine, TaxReturn, compute, emptyReturn, newId, paymentLines } from "./tax";
import { YEARS, yearLabel, yearOf } from "./taxRates";

/** "allocation": a line of the breakdown of a year's payments (what each payment was allocated to) */
export type AccountKind = "payment" | "interest" | "charge" | "repayment" | "other" | "allocation";
export type AccountRow = {
  date: string; description: string; amount: number; kind: AccountKind; key: string; text: string;
  /** breakdown lines: the due date of what was paid, the payment it came from, and what it is */
  due?: string; from?: number; alloc?: "poa1" | "poa2" | "balancing" | "other";
};
/** what a line is, and the tax year (ending year) it belongs to */
export type Role = { kind: "poa1" | "poa2" | "balancing" | "payment" | "charge" | "credit"; year: number };
export type PlanRow = {
  row: AccountRow;
  /** undefined: not applied (already imported, outside the years held, or skipped by the person) */
  role?: Role;
  /** system: the same payment is already in the return, so it is not added again */
  status: "match" | "check" | "already" | "system" | "covered" | "outside" | "skip";
  /** what the return already has for this line: a payment entered, or a payment on account still to pay */
  system?: string;
  note: string;
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const LINE = /^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})\s+(.+?)\s+£?(-?[\d,]*\.?\d+)$/;
const p2 = (v: number) => Math.round(v * 100) / 100;
const heldYear = (y: number) => YEARS.some((r) => r.year === y);

/** Reads the pasted lines. Lines that aren't a date, a description and an amount (headings, blank lines) are left out; the
 * lines that couldn't be read are returned so they can be shown. */
export function parseAccount(text: string): { rows: AccountRow[]; skipped: string[] } {
  const rows: AccountRow[] = [], skipped: string[] = [];
  const seen = new Map<string, number>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = LINE.exec(line.replace(/\t+/g, " "));
    const month = m && MONTHS[m[2].toLowerCase()];
    if (!m || !month) { skipped.push(line); continue; }
    const day = m[1].padStart(2, "0"), mm = String(month).padStart(2, "0");
    const description = m[4].trim().replace(/\s+/g, " ");
    const amount = Number(m[5].replace(/,/g, ""));
    if (!Number.isFinite(amount)) { skipped.push(line); continue; }
    const d = description.toLowerCase();
    const kind: AccountKind = /charged|penalt|surcharge|late payment/.test(d) ? "charge"
      : /repayment supplement|interest/.test(d) ? "interest"
      : /^repayment/.test(d) ? "repayment"
      : /^payment/.test(d) ? "payment" : "other";
    // the same line pasted twice is still two lines: the second gets a number, so both are kept the first time
    const base = `${m[3]}-${mm}-${day}|${description}|${p2(amount)}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    rows.push({ date: `${m[3]}-${mm}-${day}`, description, amount: p2(amount), kind, key: count > 1 ? `${base}#${count}` : base, text: line });
  }
  return { rows, skipped };
}

/** The tax year a date falls in (the 6 April boundary, as the app keeps it). */
const taxYear = (iso: string) => yearOf(iso);

/** What a year's return expects for its payments on account and its balancing payment (undefined where not known yet). */
export function knownFor(returns: Map<number, TaxReturn>, y: number): { poa1?: number; poa2?: number; balancing?: number } {
  const r = returns.get(y);
  if (!r) return {};
  const lines = paymentLines(r, y);
  const amount = (kind: "poa1" | "poa2") => lines.find((l) => l.kind === kind)?.amount ?? (kind === "poa1" ? r.payments.expectedPoa1 : r.payments.expectedPoa2);
  const poa1 = amount("poa1"), poa2 = amount("poa2");
  if (poa1 === undefined || poa2 === undefined) return { poa1, poa2 };
  // the balance is what the year owes before any payments on account, less those payments
  const before = compute({ ...r, payments: { ...r.payments, lines: [] } }, y).balancing;
  const balancing = p2(before - poa1 - poa2);
  return { poa1, poa2, balancing: balancing > 0 ? balancing : undefined };
}

/** The tax years a line could belong to, most likely first. */
function candidates(row: AccountRow): Role[] {
  const y = Number(row.date.slice(0, 4)), m = Number(row.date.slice(5, 7));
  const ty = taxYear(row.date);
  switch (row.kind) {
    case "interest":
    case "repayment": return [{ kind: "credit", year: ty }];
    case "charge": return [{ kind: "charge", year: ty }];
    case "payment": {
      if (row.amount <= 0) return [{ kind: "payment", year: ty }];
      // payments on account fall due 31 January and 31 July; the balance for a year is due 31 January after it ends
      if (m === 7 || m === 8) return [{ kind: "poa2", year: y }];
      if (m === 1) return [{ kind: "poa1", year: y }, { kind: "balancing", year: y - 1 }];
      if (m === 2 || m === 3) return [{ kind: "balancing", year: y - 1 }];
      return [{ kind: "payment", year: ty }];
    }
    default: return [];
  }
}

function expectedFor(returns: Map<number, TaxReturn>, role: Role): number | undefined {
  const k = knownFor(returns, role.year);
  return role.kind === "poa1" ? k.poa1 : role.kind === "poa2" ? k.poa2 : role.kind === "balancing" ? k.balancing : undefined;
}

const LABEL: Record<Role["kind"], string> = {
  poa1: "First payment on account", poa2: "Second payment on account", balancing: "Balancing payment", payment: "Payment", charge: "Late payment interest or penalty", credit: "Interest or repayment received",
};

/** The figures in the return that a line from the account is (or might be the same as). `same` is false when the return has a payment
 * on account of that kind with a different amount, which needs checking rather than skipping. */
function systemMatch(returns: Map<number, TaxReturn>, role: Role, row: AccountRow): { text: string; same: boolean } | undefined {
  const r = returns.get(role.year);
  if (!r) return undefined;
  const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.005;
  if (role.kind === "credit") {
    const c = (r.payments.credits || []).find((x) => x.key === row.key || (x.date === row.date && near(x.amount, row.amount)));
    return c ? { text: `interest or repayment of ${money(c.amount)} on ${c.date}`, same: true } : undefined;
  }
  const lines = paymentLines(r, role.year);
  if (role.kind === "charge") {
    const l = lines.find((x) => x.late !== undefined && near(x.late, row.amount) && x.date === row.date);
    return l ? { text: `${l.label} of ${money(l.late)} on ${l.date}`, same: true } : undefined;
  }
  if (role.kind === "poa1" || role.kind === "poa2") {
    const made = lines.find((x) => x.kind === role.kind && x.paid);
    if (!made) return undefined;
    return { text: `${made.label}, paid ${made.date} for ${money(made.amount)}`, same: near(made.amount, row.amount) };
  }
  const l = lines.find((x) => x.kind === "other" && x.paid && near(x.amount, row.amount) && x.date === row.date);
  return l ? { text: `${l.label}, paid ${l.date} for ${money(l.amount)}`, same: true } : undefined;
}

const money = (v: number | undefined) => `£${(v ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The role of each line: the first tax year it could belong to that the app holds and whose figures it matches, otherwise the
 * most likely one flagged to check. `choose` replaces the role for a line (by its index); null skips it. A line whose payment is
 * already in the return is marked system and is not applied again. */
export function planAccount(rows: AccountRow[], returns: Map<number, TaxReturn>, imported: Set<string>, choose: Record<number, Role | null> = {}, covered: Set<string> = new Set()): PlanRow[] {
  const base = (row: AccountRow, i: number): PlanRow => {
    if (i in choose) {
      const role = choose[i];
      if (!role) return { row, status: "skip", note: "Left out" };
      return heldYear(role.year)
        ? { row, role, status: "check", note: `Set by hand to ${LABEL[role.kind]}, ${yearLabel(role.year)}` }
        : { row, status: "outside", note: `${yearLabel(role.year)} isn't held` };
    }
    if (imported.has(row.key)) return { row, status: "already", note: "Already brought in" };
    if (covered.has(`${row.date}|${row.amount}`)) return { row, status: "covered", note: "Covered by the breakdown: applied from there" };
    const cands = candidates(row);
    if (!cands.length) return { row, status: "skip", note: "Not a payment, interest or charge: left out" };
    const held = cands.filter((c) => heldYear(c.year));
    if (!held.length) return { row, status: "outside", note: `${yearLabel(cands[0].year)} isn't held (the years held start at 2019-20)` };
    const hit = held.find((c) => { const e = expectedFor(returns, c); return e !== undefined && Math.abs(e - row.amount) < 0.005; });
    if (hit) return { row, role: hit, status: "match", note: `Matches what ${yearLabel(hit.year)} expects` };
    const pick = held[0];
    if (pick.kind === "credit" || pick.kind === "charge") return { row, role: pick, status: "match", note: pick.kind === "credit" ? "Interest or repayment: not part of the tax" : "Paid to HMRC on top of the tax" };
    const e = expectedFor(returns, pick);
    const note = e !== undefined
      ? `Not the ${LABEL[pick.kind].toLowerCase()} the return expects (${money(e)}): check it`
      : `${LABEL[pick.kind]} for ${yearLabel(pick.year)}: no figures to check against`;
    return { row, role: pick, status: "check", note };
  };
  return rows.map((row, i): PlanRow => {
    const p = base(row, i);
    if (p.status === "covered") return p;
    if (!p.role || !heldYear(p.role.year) || p.status === "already") return p;
    const sys = systemMatch(returns, p.role, row);
    if (!sys) {
      // nothing paid yet: a payment on account still to pay is what this line will tick
      const open = p.role.kind === "poa1" || p.role.kind === "poa2" ? paymentLines(returns.get(p.role.year) || emptyReturn(), p.role.year).find((l) => l.kind === p.role!.kind && !l.paid) : undefined;
      return open ? { ...p, system: `${open.label}, due ${open.date}${open.amount !== undefined ? ` for ${money(open.amount)}` : ""}` } : p;
    }
    return sys.same
      ? { ...p, status: "system", system: sys.text, note: `Already in the return: ${sys.text}` }
      : { ...p, status: "check", system: sys.text, note: `The return already has ${sys.text}. Approve only if this is a further payment` };
  });
}

/** Puts the approved lines onto the returns: a payment ticks the matching payment on account that is still to pay (or adds the
 * payment), a balance or other payment adds a paid line, a late charge adds a late increase, interest and repayments go to the
 * credits. A line already in the return (status system), already brought in, or without a role is not applied. Years with no return
 * yet get a blank one. Returns only the returns that changed; the inputs are not changed. */
export function applyAccount(plan: PlanRow[], returns: Map<number, TaxReturn>): Map<number, TaxReturn> {
  const out = new Map<number, TaxReturn>();
  const get = (y: number): TaxReturn => {
    let r = out.get(y);
    if (!r) { r = structuredClone(returns.get(y) ?? emptyReturn()); out.set(y, r); }
    return r;
  };
  for (const { row, role, status } of plan) {
    if (!role || !heldYear(role.year) || status === "system" || status === "already") continue;
    const r = get(role.year);
    const imported = r.payments.imported || [];
    if (imported.includes(row.key)) continue;
    let lines: PaymentLine[] = paymentLines(r, role.year).map((l) => ({ ...l }));
    if (row.kind === "allocation") {
      // the breakdown says what the year's payment was: an unpaid payment on account of that kind is replaced by it
      if (role.kind === "poa1" || role.kind === "poa2") lines = lines.filter((l) => !(l.kind === role.kind && !l.paid));
      const label = role.kind === "balancing" ? `Balancing payment (due ${fmtDue(row.due)})` : `${LABEL[role.kind]} (due ${fmtDue(row.due)})`;
      lines.push({ id: newId(), kind: role.kind === "poa1" || role.kind === "poa2" ? role.kind : "other", label, date: row.date, amount: row.amount, paid: true, hmrcKey: row.key });
    } else if (role.kind === "credit") {
      r.payments.credits = [...(r.payments.credits || []), { date: row.date, description: row.description, amount: row.amount, key: row.key }];
    } else if (role.kind === "charge") {
      lines.push({ id: newId(), kind: "other", label: `${row.description} (from the HMRC account)`, date: row.date, late: row.amount, paid: true, hmrcKey: row.key });
    } else if (role.kind === "poa1" || role.kind === "poa2") {
      const open = lines.find((l) => l.kind === role.kind && !l.paid);
      if (open) Object.assign(open, { paid: true, date: row.date, amount: row.amount, hmrcKey: row.key });
      else lines.push({ id: newId(), kind: role.kind, label: LABEL[role.kind], date: row.date, amount: row.amount, paid: true, hmrcKey: row.key });
    } else {
      lines.push({ id: newId(), kind: "other", label: `${LABEL[role.kind]} (from the HMRC account)`, date: row.date, amount: row.amount, paid: true, hmrcKey: row.key });
    }
    r.payments.lines = lines;
    r.payments.imported = [...imported, row.key];
  }
  return out;
}

/** The keys of every line already brought in, across the years held for a client. */
export function importedKeys(returns: Map<number, TaxReturn>): Set<string> {
  return new Set([...returns.values()].flatMap((r) => r.payments.imported || []));
}

const fmtDue = (iso?: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

/** The tax year (ending year) a breakdown line belongs to, from what it was due for: a balance is due 31 January after its year ends,
 * a first payment on account is due in the year it is named for, and a second payment on account is due 31 July of that year or,
 * when it was deferred into the next January, 31 January after it. */
export function allocationYear(alloc: NonNullable<AccountRow["alloc"]>, due: string): number {
  const y = Number(due.slice(0, 4)), m = Number(due.slice(5, 7));
  if (alloc === "balancing") return y - 1;
  if (alloc === "poa1") return y;
  if (alloc === "poa2") return m === 1 ? y - 1 : y;
  return taxYear(due);
}

/** Reads a breakdown of a client's payments, copied from the HMRC account: one line for each payment, with what it was allocated to,
 * the due date and the payment it came from. The total line is read too, so it can be checked against the lines. */
export function parseBreakdown(text: string): { rows: AccountRow[]; skipped: string[]; total?: number } {
  const rows: AccountRow[] = [], skipped: string[] = [];
  let total: number | undefined;
  const seen = new Map<string, number>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const t = /^total\b[\s\t]*£?([\d,]*\.?\d+)$/i.exec(line);
    if (t) { total = Number(t[1].replace(/,/g, "")); continue; }
    const m = LINE.exec(line.replace(/\t+/g, " "));
    const month = m && MONTHS[m[2].toLowerCase()];
    if (!m || !month) { skipped.push(line); continue; }
    const date = `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const description = m[4].trim().replace(/\s+/g, " ");
    const amount = p2(Number(m[5].replace(/,/g, "")));
    const due = /due (\d{1,2}) ([A-Za-z]{3}) (\d{4})/.exec(description);
    const dueIso = due && MONTHS[due[2].toLowerCase()] ? `${due[3]}-${String(MONTHS[due[2].toLowerCase()]).padStart(2, "0")}-${due[1].padStart(2, "0")}` : undefined;
    const from = /from payment\/credit £([\d,]*\.?\d+)/i.exec(description);
    const d = description.toLowerCase();
    const alloc: NonNullable<AccountRow["alloc"]> = /^first payment on account/.test(d) ? "poa1" : /^second payment on account/.test(d) ? "poa2" : /^balancing payment/.test(d) ? "balancing" : "other";
    if (!dueIso) { skipped.push(line); continue; }
    const base = `alloc|${date}|${description}|${amount}`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    rows.push({ date, description: description.replace(/\s*\(from payment.*$/i, ""), amount, kind: "allocation", alloc, due: dueIso, from: from ? p2(Number(from[1].replace(/,/g, ""))) : undefined, key: count > 1 ? `${base}#${count}` : base, text: line });
  }
  return { rows, skipped, total };
}

/** The account lines a breakdown covers in full (its allocations add up to the payment): these are not applied a second time. */
export function coveredBy(breakdown: AccountRow[]): Set<string> {
  const sums = new Map<string, { date: string; from: number; sum: number }>();
  for (const b of breakdown) {
    if (b.from === undefined) continue;
    const k = `${b.date}|${p2(b.from)}`;
    const cur = sums.get(k) || { date: b.date, from: p2(b.from), sum: 0 };
    cur.sum = p2(cur.sum + b.amount);
    sums.set(k, cur);
  }
  return new Set([...sums.values()].filter((x) => Math.abs(x.sum - x.from) < 0.005).map((x) => `${x.date}|${x.from}`));
}

/** The breakdown lines' roles: each line goes to the tax year its due date belongs to. A line already in the return (paid, with the
 * same date and amount) is not added again. */
export function planBreakdown(rows: AccountRow[], returns: Map<number, TaxReturn>, imported: Set<string>, choose: Record<number, Role | null> = {}): PlanRow[] {
  return rows.map((row, i): PlanRow => {
    const alloc = row.alloc || "other";
    const year = allocationYear(alloc, row.due || row.date);
    if (i in choose) {
      const role = choose[i];
      if (!role) return { row, status: "skip", note: "Left out" };
      return heldYear(role.year) ? { row, role, status: "check", note: `Set by hand to ${LABEL[role.kind]}, ${yearLabel(role.year)}` } : { row, status: "outside", note: `${yearLabel(role.year)} isn't held` };
    }
    if (imported.has(row.key)) return { row, status: "already", note: "Already brought in" };
    if (!heldYear(year)) return { row, status: "outside", note: `${yearLabel(year)} isn't held (the years held start at 2019-20)` };
    const role: Role = { kind: alloc === "poa1" || alloc === "poa2" || alloc === "balancing" ? alloc : "payment", year };
    const r = returns.get(year);
    const lines = r ? paymentLines(r, year) : [];
    const made = lines.find((l) => l.paid && Math.abs(n0(l.amount) - row.amount) < 0.005 && l.date === row.date && (alloc === "poa1" || alloc === "poa2" ? l.kind === alloc : l.kind === "other"));
    if (made) return { row, role, status: "system", system: `${made.label}, paid ${made.date}`, note: `Already in the return: ${made.label}, paid ${made.date}` };
    return { row, role, status: "match", note: `${LABEL[role.kind]} for ${yearLabel(year)}, due ${fmtDue(row.due)}` };
  });
}

const n0 = (v: number | undefined) => v ?? 0;
