// The profit and loss account for the iXBRL accounts and computation, built from the final trial balance.
//  - the statement lines (turnover ... profit for the year) with the FRC UK GAAP element that tags each
//  - the detail underneath (every trial balance account, under the heading it sits in), with a DPL element where one is known
// The element names are the FRC taxonomy's as they were remembered, NOT checked against the taxonomy package (it isn't in the CT600 pack).
// Every tag here carries `verified: false` until the package is loaded and a test compares the names to it.
import { SECTIONS } from "./papers";
import { DEST_BY_KEY, Mapping, onSide } from "./tbMap";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type PlTag = { element: string; verified: false };
const frc = (element: string): PlTag => ({ element: `core:${element}`, verified: false });

/** The statement lines, in order. */
export const STATEMENT = {
  turnover: frc("TurnoverRevenue"),
  costOfSales: frc("CostSales"),
  grossProfit: frc("GrossProfitLoss"),
  distribution: frc("DistributionCosts"),
  admin: frc("AdministrativeExpenses"),
  otherIncome: frc("OtherOperatingIncomeFormat1"),
  operatingProfit: frc("OperatingProfitLoss"),
  investmentIncome: frc("IncomeFromSharesInGroupUndertakings"),
  interestReceivable: frc("InterestReceivableSimilarIncomeFinanceIncome"),
  interestPayable: frc("InterestPayableSimilarChargesFinanceCosts"),
  profitBeforeTax: frc("ProfitLossOnOrdinaryActivitiesBeforeTax"),
  tax: frc("TaxTaxCreditOnProfitOrLossOnOrdinaryActivities"),
  profit: frc("ProfitLoss"),
} as const;
export type StatementKey = keyof typeof STATEMENT;

/** Which statement line each IRIS profit and loss heading (the schedule's group) adds up to. */
const HEADING: Record<string, StatementKey> = {
  "Turnover": "turnover", "Other operating income": "otherIncome", "Investment income": "investmentIncome", "Interest receivable": "interestReceivable",
  "Cost of sales": "costOfSales", "Distribution costs": "distribution", "Administrative expenses": "admin", "Interest payable": "interestPayable",
};

/** The detailed element for a schedule's lines, where there is one in the accounts' notes (staff costs). The rest need the DPL package. */
const DETAIL: Record<string, PlTag> = {
  "expenditure/employee": frc("StaffCostsEmployeeBenefitsExpense"),
  "expenditure/directors": frc("StaffCostsEmployeeBenefitsExpense"),
};

export type PlLine = { key: StatementKey; label: string; amount: number; element: string; verified: false };
export type PlDetail = { code: string; account: string; line: StatementKey; schedule: string; amount: number; element?: string; needsElement: boolean };
export type Pl = { statement: PlLine[]; detail: PlDetail[]; /** accounts on the profit and loss that no schedule heading covers */ unplaced: { code: string; account: string; dest: string; amount: number }[] };

const LABEL: Record<StatementKey, string> = {
  turnover: "Turnover", costOfSales: "Cost of sales", grossProfit: "Gross profit", distribution: "Distribution costs", admin: "Administrative expenses",
  otherIncome: "Other operating income", operatingProfit: "Operating profit", investmentIncome: "Income from investments", interestReceivable: "Interest receivable and similar income",
  interestPayable: "Interest payable and similar expenses", profitBeforeTax: "Profit before tax", tax: "Tax on profit", profit: "Profit for the financial year",
};

/** The profit and loss account from the mapped final trial balance. Costs are positive; the tax charge is positive. */
export function buildPl(maps: Mapping[]): Pl {
  const heading = new Map<string, { line: StatementKey; schedule: string }>();
  for (const sec of SECTIONS) {
    if (sec.group !== "Profit and loss") continue;
    for (const sb of sec.subs) {
      if (sec.key === "taxation") heading.set(`${sec.key}/${sb.key}`, { line: "tax", schedule: sb.title });
      else if (sb.group && HEADING[sb.group]) heading.set(`${sec.key}/${sb.key}`, { line: HEADING[sb.group], schedule: sb.title });
    }
  }
  const sum: Record<StatementKey, number> = Object.fromEntries(Object.keys(STATEMENT).map((k) => [k, 0])) as Record<StatementKey, number>;
  const detail: PlDetail[] = [], unplaced: Pl["unplaced"] = [];
  for (const m of maps) {
    const d = DEST_BY_KEY.get(m.dest);
    if (!d || d.key === "ignore" || !m.balance) continue;
    if (!/^(income|expenditure|taxation)\//.test(d.key)) continue;
    const amount = onSide(m.balance, d.side);
    const h = heading.get(d.key);
    if (!h) { unplaced.push({ code: m.acct.code, account: m.acct.account, dest: d.key, amount }); continue; }
    sum[h.line] = round2(sum[h.line] + amount);
    const tag = DETAIL[d.key];
    detail.push({ code: m.acct.code, account: m.acct.account, line: h.line, schedule: h.schedule, amount, element: tag?.element, needsElement: !tag });
  }
  const gross = round2(sum.turnover - sum.costOfSales);
  const operating = round2(gross - sum.distribution - sum.admin + sum.otherIncome);
  const before = round2(operating + sum.investmentIncome + sum.interestReceivable - sum.interestPayable);
  const values: Record<StatementKey, number> = { ...sum, grossProfit: gross, operatingProfit: operating, profitBeforeTax: before, profit: round2(before - sum.tax) };
  const ORDER: StatementKey[] = ["turnover", "costOfSales", "grossProfit", "distribution", "admin", "otherIncome", "operatingProfit", "investmentIncome", "interestReceivable", "interestPayable", "profitBeforeTax", "tax", "profit"];
  const statement = ORDER.filter((k) => values[k] !== 0 || ["turnover", "grossProfit", "operatingProfit", "profitBeforeTax", "profit"].includes(k))
    .map((k) => ({ key: k, label: LABEL[k], amount: values[k], element: STATEMENT[k].element, verified: false as const }));
  return { statement, detail, unplaced };
}
