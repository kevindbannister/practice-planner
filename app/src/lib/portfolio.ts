// The Co Sec portfolio: one row per company with the dates a company secretary watches. Accounts and confirmation statement dates
// come from Companies House (kept on the client as CHVerified); until a company has been checked there they fall back to the
// planner's own open job. Tax return and VAT dates come from the planner's jobs: there is no HMRC feed.
import { daysBetween } from "./domain";
import { Row } from "./schema";
import { chNumber } from "./companiesHouse";
import { companyKind, verifiedOf } from "./cosec";
import { addDays, addMonths } from "./planning";
import { isStatutory } from "./workGroups";

export type Tone = "red" | "amber" | "green" | "";
export type Pill = { text: string; tone: Tone; days: number };
export type Cell = { date: string; pill?: Pill; from: "ch" | "app" | "" };
export type PortfolioRow = {
  key: string; name: string; number: string; ard: string;
  accounts: Cell; ct: Cell; ctPay: Cell; payroll: Cell; cis: Cell; other: { label: string; cell: Cell }[]; cs: Cell; csDate: string; vat: Cell; vatNumber: string; status: string; checkedAt: string; openFilings: number;
};

const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** "in 9 months", "in 20 days", "3 days overdue". Red when overdue or within two weeks, amber within about three months. */
export function pillFor(date: string, today: string): Pill | undefined {
  if (!validDate(date)) return undefined;
  const days = daysBetween(today, date);
  if (days < 0) return { text: `${-days} ${days === -1 ? "day" : "days"} overdue`, tone: "red", days };
  if (days === 0) return { text: "today", tone: "red", days };
  const tone: Tone = days <= 14 ? "red" : days <= 100 ? "amber" : "green";
  if (days <= 45) return { text: days === 1 ? "tomorrow" : `in ${days} days`, tone, days };
  const months = Math.round(days / 30.44);
  if (months < 12) return { text: months === 1 ? "in a month" : `in ${months} months`, tone, days };
  const years = Math.round(months / 12);
  return { text: years === 1 ? "in a year" : `in ${years} years`, tone, days };
}

const isOpen = (j: Row) => !["Complete", "Done", "Cancelled"].includes(s(j.Status));
const svc = (key: unknown, name: string) => s(key).toUpperCase() === name;
const DISSOLVED = /dissolved|struck|strike|liquidation|closed/i;

export const isDissolved = (client: Row): boolean => DISSOLVED.test(verifiedOf(client).status || s(client.CHStatus));

/** Statutory work that has its own column; anything else the planner treats as statutory goes under "Other". */
const SHOWN = /^(ACCS|CT600$|CS01$|VAT$|PAYROLL$|CIS$)/;

export function portfolioRows(clients: Row[], jobs: Row[], clientServices: Row[], tx: Row[], today: string, services: Row[] = []): PortfolioRow[] {
  const svcByKey = new Map(services.map((x) => [s(x.Key), x]));
  return clients.filter((c) => companyKind(c) && s(c.CompanyNumber).trim()).map((c) => {
    const v = verifiedOf(c);
    const mine = jobs.filter((j) => j.ClientKey === c.Key && isOpen(j));
    const job = (name: string) => mine.filter((j) => (name === "ACCS" ? s(j.ServiceKey).toUpperCase().startsWith("ACCS") : svc(j.ServiceKey, name))).sort((a, b) => s(a.Deadline).localeCompare(s(b.Deadline)))[0];
    const next = (name: string) => clientServices.find((x) => x.ClientKey === c.Key && svc(x.ServiceKey, name) && s(x.NextDeadline));
    const cell = (ch: string, app: string): Cell => {
      const date = validDate(ch) ? ch : validDate(app) ? app : "";
      return { date, from: validDate(ch) ? "ch" : date ? "app" : "", pill: pillFor(date, today) };
    };
    const acc = job("ACCS");
    const cs = job("CS01");
    const ct = job("CT600");
    const vat = job("VAT");
    const pay = job("PAYROLL"), cis = job("CIS");
    // Corporation tax is paid 9 months and a day after the period ends (for a company that isn't large)
    const ctPayDate = validDate(s(ct?.PeriodEnd)) ? addDays(addMonths(s(ct?.PeriodEnd), 9), 1) : "";
    const other = mine.filter((j) => !SHOWN.test(s(j.ServiceKey)) && isStatutory(svcByKey.get(s(j.ServiceKey)), s(j.ServiceKey)) && validDate(s(j.Deadline)))
      .sort((a, b) => s(a.Deadline).localeCompare(s(b.Deadline)))
      .map((j) => ({ label: s(svcByKey.get(s(j.ServiceKey))?.Title) || s(j.ServiceKey), cell: cell("", s(j.Deadline)) }));
    return {
      key: s(c.Key), name: s(c.Title), number: chNumber(c as any), ard: v.ard || "",
      accounts: cell(s(v.accDue), s(acc?.CHDeadline) || s(acc?.Deadline)),
      cs: cell(s(v.csDue), s(cs?.CHDeadline) || s(cs?.Deadline)),
      csDate: validDate(s(v.csTo)) ? s(v.csTo) : s(cs?.PeriodEnd),
      ct: cell("", s(ct?.Deadline) || s(next("CT600")?.NextDeadline)),
      vat: cell("", s(vat?.Deadline) || s(next("VAT")?.NextDeadline)),
      ctPay: cell("", ctPayDate), payroll: cell("", s(pay?.Deadline) || s(next("PAYROLL")?.NextDeadline)), cis: cell("", s(cis?.Deadline) || s(next("CIS")?.NextDeadline)), other,
      vatNumber: s(c.VATNumber), status: v.status || s(c.CHStatus), checkedAt: s(v.at),
      openFilings: tx.filter((t) => t.ClientKey === c.Key && !["accepted", "external", "declined", "cancelled", "rejected"].includes(s(t.Status).toLowerCase())).length,
    };
  });
}
