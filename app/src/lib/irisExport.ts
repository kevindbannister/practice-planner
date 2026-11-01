// The mapped final trial balance as a CSV for IRIS Elements Accounts Production ("Import trial balance data from a CSV file").
// IRIS's own help describes the file: columns Account, Description and "Year End dd/mm/YYYY", with credits as negative numbers.
// Accounts that share an IRIS code are added together, since Elements holds one balance per IRIS account. Accounts with no IRIS
// code can't be imported and are listed so they can be given one first.
import type { Mapping } from "./tbMap";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type IrisLine = { code: string; description: string; amount: number; accounts: string[] };
export type IrisExport = { lines: IrisLine[]; /** accounts with a balance but no IRIS code */ unmapped: { account: string; code: string; balance: number }[]; /** total of the lines: nil when the export balances */ difference: number; csv: string };

/** 2026-03-31 as 31/03/2026. */
export const irisDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

const text = (s: string) => {
  const t = s.replace(/[\r\n]+/g, " ").trim();
  // a leading = + - or @ would run as a formula if the file is opened in a spreadsheet first
  const safe = /^[=+\-@]/.test(t) ? ` ${t}` : t;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function irisTrialBalance(maps: Mapping[], periodEnd: string): IrisExport {
  const by = new Map<string, IrisLine>();
  const unmapped: IrisExport["unmapped"] = [];
  for (const m of maps) {
    const amount = round2(m.balance);
    if (amount === 0) continue; // nothing to import
    const code = m.iris.trim();
    if (!code) { unmapped.push({ account: m.acct.account, code: m.acct.code, balance: amount }); continue; }
    const line = by.get(code) || { code, description: m.irisName.trim(), amount: 0, accounts: [] };
    line.amount = round2(line.amount + amount);
    line.accounts.push(m.acct.account);
    if (!line.description) line.description = m.acct.account;
    by.set(code, line);
  }
  // codes are kept in the order IRIS numbers them: 523 before 523/21, 99 before 100
  const lines = [...by.values()].filter((l) => l.amount !== 0 || l.accounts.length > 0).sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const difference = round2(lines.reduce((t, l) => t + l.amount, 0));
  const csv = ["Account,Description," + `Year End ${irisDate(periodEnd)}`, ...lines.map((l) => `${text(l.code)},${text(l.description)},${l.amount.toFixed(2)}`)].join("\r\n");
  return { lines, unmapped, difference, csv };
}
