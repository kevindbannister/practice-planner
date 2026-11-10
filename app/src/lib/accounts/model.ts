// The structured accounts for one filing. This is the ONE place the numbers live: the PDF, the validation, and (Phase 3) the iXBRL are all produced from
// this object, so they cannot disagree. Money is whole pence (integers); nothing here uses floating-point arithmetic on money.
// Only "dormant" is supported. Other accounts types are added as new `type` values with their own builder, validation and taxonomy mapping, and are not
// switched on until all three exist.
import type { Figures } from "../cosecDormant";

export type AccountsType = "dormant";
export type Column = {
  asAt: string;
  calledUpNotPaid: number;     // asset: called up share capital not paid
  cash: number;                // asset: cash at bank and in hand
  liabilities: number;         // always 0 for a dormant company
  netAssets: number;
  shareCapital: number;        // capital and reserves: called up share capital
  profitAndLoss: number;       // 0 for a dormant company
  shareholdersFunds: number;
};
export type ShareClass = { cls: string; shares: number; nominalMicro: number; calledUpPence: number; unpaidPence: number };
export type Statements = { dormantThroughout: boolean; auditExemptS480: boolean; membersNoAuditS476: boolean; directorsResponsibilities: boolean; smallCompaniesRegime: boolean };
export type AccountsModel = {
  schemaVersion: 1;
  type: AccountsType;
  company: { name: string; number: string };
  period: { start: string; end: string; incorporated: string; first: boolean };
  current: Column;
  comparative: Column | null;
  classes: ShareClass[];
  comparativeClasses: ShareClass[];
  employees: { average: number };
  statements: Statements;
  signing: { director: string; date: string };   // date "" until approved
  confirmedBy: string;
};

const pence = (s: string): number => Number(BigInt(s));
const column = (f: Figures): Column => {
  const calledUp = pence(f.calledUp), unpaid = pence(f.unpaid), cash = pence(f.paid);
  return { asAt: f.asAt, calledUpNotPaid: unpaid, cash, liabilities: 0, netAssets: unpaid + cash, shareCapital: calledUp, profitAndLoss: 0, shareholdersFunds: calledUp };
};
const classes = (f: Figures): ShareClass[] => f.classes.map((c) => ({ cls: c.cls, shares: c.shares, nominalMicro: Math.round(c.nominal * 1e6), calledUpPence: Number((BigInt(c.calledUpMicro) + 5000n) / 10000n), unpaidPence: Number((BigInt(c.unpaidMicro) + 5000n) / 10000n) }));

export type BuildIn = { company: { name: string; number: string }; period: { start: string; end: string; incorporated: string }; fig: Figures; prior: Figures | null; director: string; approvedOn: string; confirmedBy?: string; confirmedAll?: boolean; employees?: number };
/** Builds the dormant accounts from the confirmed facts. The statements are true only if a person confirmed the three dormant statements. */
export function buildDormantModel(i: BuildIn): AccountsModel {
  const first = !!i.period.incorporated && i.period.start <= i.period.incorporated;
  const yes = !!i.confirmedAll;
  return {
    schemaVersion: 1, type: "dormant", company: i.company, period: { ...i.period, first },
    current: column(i.fig), comparative: i.prior ? column(i.prior) : null, classes: classes(i.fig), comparativeClasses: i.prior ? classes(i.prior) : [],
    employees: { average: i.employees ?? 0 },
    statements: { dormantThroughout: yes, auditExemptS480: yes, membersNoAuditS476: yes, directorsResponsibilities: yes, smallCompaniesRegime: yes },
    signing: { director: i.director, date: i.approvedOn }, confirmedBy: i.confirmedBy || "",
  };
}

/** Canonical JSON (sorted keys) so the same accounts always give the same text, and so the same hash. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
/** SHA-256 of the canonical accounts, as hex: what a director's approval is tied to. */
export async function modelHash(m: AccountsModel): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(m)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** The figures that matter to the director's approval: who signed and when are excluded, so signing doesn't change what was approved. */
export const approvableCopy = (m: AccountsModel): AccountsModel => ({ ...m, signing: { director: "", date: "" } });
