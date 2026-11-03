// Company Secretarial dividends for a shareholder, as they go into their personal tax return. A dividend counts in the tax year
// in which it was paid (or declared, if not yet paid). Waived lines and drafts are left out. Whole pence throughout.
import { Row } from "./schema";
import { DivStatus, DivType, readDividend } from "./cosecDividends";

export type CosecDividendItem = {
  ref: string; companyKey: string; company: string; type: DivType; status: DivStatus;
  declaredOn: string; paidOn: string; recordDate: string; cls: string; shares: number; amount: number; date: string;
};

/** The tax year named by its ending year (2024 is 2023-24): 6 April of the year before to 5 April. */
export const taxYearWindow = (year: number) => ({ from: `${year - 1}-04-06`, to: `${year}-04-05` });

/** The dividends this person received from the companies on the Company Secretarial side, in the tax year, earliest first. */
export function cosecDividendsFor(personKey: string, year: number, rows: Row[], companyName: (key: string) => string): CosecDividendItem[] {
  if (!personKey) return [];
  const { from, to } = taxYearWindow(year);
  const out: CosecDividendItem[] = [];
  for (const row of rows) {
    const d = readDividend(row);
    if (d.status === "draft") continue;
    const date = d.paidOn || d.declaredOn;
    if (!date || date < from || date > to) continue;
    for (const l of d.lines) {
      if (l.holderKey !== personKey || l.waived) continue;
      const pence = Number(l.paidPence);
      if (!pence) continue;
      out.push({ ref: d.ref, companyKey: d.clientKey, company: companyName(d.clientKey), type: d.type, status: d.status, declaredOn: d.declaredOn, paidOn: d.paidOn, recordDate: d.recordDate, cls: l.cls, shares: l.shares, amount: pence / 100, date });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
}
