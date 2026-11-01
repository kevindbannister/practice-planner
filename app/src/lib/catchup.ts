// Catch-up fees: charging for a backlog when a client joins with work already behind them (months of unwritten-up bookkeeping, late years of accounts).
// It works out months x the monthly fee (the client's agreed fee, or what the pricing rule says), with an optional premium, or a typed amount.
// The result is a one-off charge marked "proposed". Nothing counts as agreed revenue until a manager approves it, and nothing is invoiced from here.
// Asking again for the same service and an overlapping period does nothing new, so a double press can't charge twice.
import { FeeLine, periodsPerYear, readCharge } from "./fees";
import { ProposalAction } from "./proposals";
import { Ctx, Written, activityRow } from "./sales";
import { Row } from "./schema";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const money = (n: number) => Math.round(n * 100) / 100;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MAX_MONTHS = 36;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (ym: string) => (MONTH.test(ym) ? `${MONTHS[Number(ym.slice(5)) - 1].slice(0, 3)} ${ym.slice(0, 4)}` : ym);

/** Whole months from `from` to `to`, both included ("2026-01" to "2026-06" is 6). 0 when the range is wrong. */
export function monthsBetween(from: string, to: string): number {
  if (!MONTH.test(from) || !MONTH.test(to)) return 0;
  const n = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5)) - Number(from.slice(5)) + 1;
  return n > 0 ? n : 0;
}

/** What one month of this fee line costs: the agreed fee spread over a month. Undefined for a one-off fee, which has no monthly rate. */
export function monthlyRate(line: FeeLine): number | undefined {
  const per = periodsPerYear(line.period);
  return per && line.fee > 0 ? money((line.fee * per) / 12) : undefined;
}

const marker = (serviceKey: string, from: string, to: string) => `catchup|${serviceKey}|${from}|${to}`;
/** The period a catch-up charge covers, read from its notes. */
export function catchUpPeriod(charge: Row): { serviceKey: string; from: string; to: string } | undefined {
  const m = /catchup\|([^|]*)\|(\d{4}-\d{2})\|(\d{4}-\d{2})/.exec(str(charge.Notes));
  return m ? { serviceKey: m[1], from: m[2], to: m[3] } : undefined;
}
export const isCatchUp = (charge: Row): boolean => !!catchUpPeriod(charge);

export type CatchUpInput = {
  line: FeeLine; from: string; to: string;
  /** "agreed" uses the client's agreed monthly fee; "rule" uses `ruleMonthly` */
  basis: "agreed" | "rule"; ruleMonthly?: number;
  /** extra on top of the monthly rate for work that is late, in percent */
  premiumPct: number;
  /** a typed total that replaces the working */ override?: number;
  vat: string; today: string; serviceName: string;
};
export type CatchUpWorking = { months: number; monthly: number; premiumPct: number; subtotal: number; amount: number; overridden: boolean };

export function catchUpWorking(i: Pick<CatchUpInput, "line" | "from" | "to" | "basis" | "ruleMonthly" | "premiumPct" | "override">): CatchUpWorking | { error: string } {
  const months = monthsBetween(i.from, i.to);
  if (!months) return { error: "Choose the first and last month, and the last can't be before the first." };
  if (months > MAX_MONTHS) return { error: `That is ${months} months. The most one catch-up charge covers is ${MAX_MONTHS}; add a second for the rest.` };
  if (!(i.premiumPct >= 0) || i.premiumPct > 200) return { error: "The premium is a percentage from 0 to 200." };
  const monthly = i.basis === "rule" ? i.ruleMonthly : monthlyRate(i.line);
  if (monthly === undefined || !(monthly > 0)) return { error: i.basis === "rule" ? "The pricing rule has no figure for this client yet." : "This fee has no monthly rate (it is a one-off or has no fee). Type the amount instead." };
  const subtotal = money(monthly * months);
  const calc = money(subtotal * (1 + i.premiumPct / 100));
  const overridden = i.override !== undefined && Number.isFinite(i.override);
  if (overridden && !(i.override! > 0)) return { error: "The amount has to be more than zero." };
  return { months, monthly, premiumPct: i.premiumPct, subtotal, amount: overridden ? money(i.override!) : calc, overridden };
}

/** Existing, not-cancelled catch-up charges for this service whose months overlap the requested ones. */
export function overlapping(charges: Row[], clientKey: string, serviceKey: string, from: string, to: string): Row[] {
  return charges.filter((c) => str(c.ClientKey) === clientKey && str(c.Status) !== "cancelled").filter((c) => {
    const p = catchUpPeriod(c);
    return p && p.serviceKey === serviceKey && p.from <= to && from <= p.to;
  });
}

export function proposeCatchUp(client: Row, i: CatchUpInput, charges: Row[], can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: "Only a manager or partner can add a catch-up fee." };
  if (i.from > i.today.slice(0, 7) || i.to > i.today.slice(0, 7)) return { error: "A catch-up fee is for months that have already happened." };
  const w = catchUpWorking(i);
  if ("error" in w) return w;
  const clash = overlapping(charges, str(client.Key), i.line.serviceKey, i.from, i.to);
  if (clash.length) {
    const p = catchUpPeriod(clash[0])!;
    return { error: `There is already a catch-up charge for ${i.serviceName} covering ${monthName(p.from)} to ${monthName(p.to)}. Cancel it first if it is wrong.` };
  }
  const label = `Catch-up: ${i.serviceName}, ${monthName(i.from)} to ${monthName(i.to)}`;
  const how = i.override !== undefined && w.overridden ? `typed amount (working was ${w.months} months x £${w.monthly}${w.premiumPct ? ` + ${w.premiumPct}%` : ""})` : `${w.months} month${w.months === 1 ? "" : "s"} x £${w.monthly}${w.premiumPct ? ` + ${w.premiumPct}% premium` : ""} (${i.basis === "rule" ? "pricing rule" : "agreed fee"})`;
  const row: Row = {
    Key: o.newKey("FC"), PracticeId: o.pid, ClientKey: str(client.Key), ServiceKey: i.line.serviceKey, Label: label, Amount: w.amount, Vat: i.vat, AgreedOn: "", Status: "proposed", ProposalKey: "",
    Notes: `${marker(i.line.serviceKey, i.from, i.to)}\n${how}`, Created: o.now, CreatedBy: o.actor,
  };
  return {
    patches: [],
    creates: [
      { list: "FeeCharges", row },
      { list: "FeeHistory", row: { Key: o.newKey("FH"), PracticeId: o.pid, ClientKey: str(client.Key), ServiceKey: i.line.serviceKey, At: o.now, Actor: o.actor, Action: "catchup-proposed", Old: "null", New: JSON.stringify({ label, amount: w.amount }), Reason: how, Source: "Manual" } },
    ],
    log: [],
    activities: [activityRow(o, "fee-changed", `Catch-up fee proposed: ${client.Title}`, undefined, { clientKey: str(client.Key) }, `${label}: £${w.amount}`)],
  };
}

/** Approving makes it an agreed one-off charge from today. Only a proposed charge can be approved. */
export function approveCatchUp(charge: Row, client: Row, today: string, can: (x: ProposalAction) => boolean, o: Ctx): Written | { error: string } {
  if (!can("send")) return { error: "Only a manager or partner can approve a catch-up fee." };
  if (str(charge.Status) !== "proposed") return { error: "That charge isn't waiting for approval." };
  const c = readCharge({ ...charge, Status: "agreed" });
  return {
    patches: [{ list: "FeeCharges", row: charge, patch: { Status: "agreed", AgreedOn: today } }],
    creates: [{ list: "FeeHistory", row: { Key: o.newKey("FH"), PracticeId: o.pid, ClientKey: str(client.Key), ServiceKey: str(charge.ServiceKey), At: o.now, Actor: o.actor, Action: "charge-added", Old: "null", New: JSON.stringify({ label: c.label, amount: c.amount }), Reason: "Catch-up fee approved", Source: "Manual" } }],
    log: [],
    activities: [activityRow(o, "fee-changed", `Catch-up fee agreed: ${client.Title}`, undefined, { clientKey: str(client.Key) }, `${c.label}: £${c.amount}`)],
  };
}
