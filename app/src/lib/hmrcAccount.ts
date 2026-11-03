// The payments, credits and charges on a client's HMRC Self Assessment account, copied from the agent services page and pasted in.
// Each line is a date, what it is and an amount. parseAccount reads the lines, planAccount works out which tax year each one belongs
// to and whether it matches what that year's return expects, and applyAccount puts them on the returns. Nothing is saved here:
// the import dialog shows the plan first so each line can be checked or moved.
import { PaymentLine, TaxReturn, compute, emptyReturn, newId, paymentLines } from "./tax";
import { YEARS, yearLabel, yearOf } from "./taxRates";

export type AccountKind = "payment" | "interest" | "charge" | "repayment" | "other";
export type AccountRow = { date: string; description: string; amount: number; kind: AccountKind; key: string; text: string };
/** what a line is, and the tax year (ending year) it belongs to */
export type Role = { kind: "poa1" | "poa2" | "balancing" | "payment" | "charge" | "credit"; year: number };
export type PlanRow = {
  row: AccountRow;
  /** undefined: not applied (already imported, outside the years held, or skipped by the person) */
  role?: Role;
  status: "match" | "check" | "already" | "outside" | "skip";
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

/** The role of each line: the first tax year it could belong to that the app holds and whose figures it matches, otherwise the
 * most likely one flagged to check. `choose` replaces the role for a line (by its index); null skips it. */
export function planAccount(rows: AccountRow[], returns: Map<number, TaxReturn>, imported: Set<string>, choose: Record<number, Role | null> = {}): PlanRow[] {
  return rows.map((row, i): PlanRow => {
    if (i in choose) {
      const role = choose[i];
      if (!role) return { row, status: "skip", note: "Left out" };
      return heldYear(role.year)
        ? { row, role, status: "check", note: `Set by hand to ${LABEL[role.kind]}, ${yearLabel(role.year)}` }
        : { row, status: "outside", note: `${yearLabel(role.year)} isn't held` };
    }
    if (imported.has(row.key)) return { row, status: "already", note: "Already brought in" };
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
      ? `Not the ${LABEL[pick.kind].toLowerCase()} the return expects (£${e.toLocaleString("en-GB", { minimumFractionDigits: 2 })}): check it`
      : `${LABEL[pick.kind]} for ${yearLabel(pick.year)}: no figures to check against`;
    return { row, role: pick, status: "check", note };
  });
}

/** Puts the applied lines onto the returns: a payment ticks the matching payment on account (or adds the payment), a balance or
 * other payment adds a paid line, a late charge adds a late increase, interest and repayments go to the credits. Years with no
 * return yet get a blank one. Returns only the returns that changed; the inputs are not changed. */
export function applyAccount(plan: PlanRow[], returns: Map<number, TaxReturn>): Map<number, TaxReturn> {
  const out = new Map<number, TaxReturn>();
  const get = (y: number): TaxReturn => {
    let r = out.get(y);
    if (!r) { r = structuredClone(returns.get(y) ?? emptyReturn()); out.set(y, r); }
    return r;
  };
  for (const { row, role } of plan) {
    if (!role || !heldYear(role.year)) continue;
    const r = get(role.year);
    const imported = r.payments.imported || [];
    if (imported.includes(row.key)) continue;
    const lines: PaymentLine[] = paymentLines(r, role.year).map((l) => ({ ...l }));
    if (role.kind === "credit") {
      r.payments.credits = [...(r.payments.credits || []), { date: row.date, description: row.description, amount: row.amount, key: row.key }];
    } else if (role.kind === "charge") {
      lines.push({ id: newId(), kind: "other", label: `${row.description} (from the HMRC account)`, date: row.date, late: row.amount, paid: true });
    } else if (role.kind === "poa1" || role.kind === "poa2") {
      const open = lines.find((l) => l.kind === role.kind && !l.paid);
      if (open) Object.assign(open, { paid: true, date: row.date, amount: row.amount });
      else lines.push({ id: newId(), kind: role.kind, label: LABEL[role.kind], date: row.date, amount: row.amount, paid: true });
    } else {
      lines.push({ id: newId(), kind: "other", label: `${LABEL[role.kind]} (from the HMRC account)`, date: row.date, amount: row.amount, paid: true });
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
