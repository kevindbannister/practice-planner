// Level 1 validation: are the accounts complete, internally consistent and entitled to what they claim? Pure; reads only the model.
// Each issue names the field it is about so the screen can take the person to it. Nothing here ever adjusts a figure to make it agree.
import { AccountsModel, Column } from "./model";

export type Issue = { id: string; severity: "error" | "warning"; field: string; message: string };
const isoOk = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const int = (n: number) => Number.isSafeInteger(n);

function column(c: Column, label: string, out: Issue[]) {
  const f = label === "current" ? "figures" : "comparatives";
  const nums: [string, number][] = [["called up share capital not paid", c.calledUpNotPaid], ["cash", c.cash], ["liabilities", c.liabilities], ["net assets", c.netAssets], ["share capital", c.shareCapital], ["profit and loss", c.profitAndLoss], ["shareholders' funds", c.shareholdersFunds]];
  for (const [n, v] of nums) if (!int(v) || v < 0) out.push({ id: `${label}-${n}`, severity: "error", field: f, message: `The ${label}-year ${n} isn't a valid amount in whole pence.` });
  if (c.netAssets !== c.calledUpNotPaid + c.cash - c.liabilities) out.push({ id: `${label}-netassets`, severity: "error", field: f, message: `The ${label}-year net assets don't equal assets less liabilities.` });
  if (c.shareholdersFunds !== c.shareCapital + c.profitAndLoss) out.push({ id: `${label}-funds`, severity: "error", field: f, message: `The ${label}-year shareholders' funds don't equal share capital plus reserves.` });
  if (c.netAssets !== c.shareholdersFunds) out.push({ id: `${label}-balance`, severity: "error", field: f, message: `The ${label}-year balance sheet doesn't balance: net assets are £${(c.netAssets / 100).toFixed(2)} but shareholders' funds are £${(c.shareholdersFunds / 100).toFixed(2)}. It can't be filed with a difference left unexplained.` });
  if (c.liabilities !== 0 || c.profitAndLoss !== 0) out.push({ id: `${label}-dormant-nonzero`, severity: "error", field: f, message: `A dormant company has no liabilities or reserves other than share capital, but the ${label}-year figures show some.` });
}

export function validateModel(m: AccountsModel): Issue[] {
  const out: Issue[] = [];
  const { period: p } = m;
  if (!m.company.name.trim()) out.push({ id: "name", severity: "error", field: "company", message: "The company name is missing." });
  if (!/^[A-Z0-9]{8}$/i.test(m.company.number.replace(/\s/g, ""))) out.push({ id: "number", severity: "error", field: "company", message: "The company number should be 8 characters." });
  if (!isoOk(p.start) || !isoOk(p.end) || p.start > p.end) out.push({ id: "period", severity: "error", field: "period", message: "The accounting period dates are not valid." });
  if (!isoOk(m.current.asAt) || m.current.asAt !== p.end) out.push({ id: "bsdate", severity: "error", field: "period", message: "The balance sheet date must be the last day of the accounting period." });
  column(m.current, "current", out);
  if (m.type !== "dormant") out.push({ id: "type", severity: "error", field: "type", message: "Only dormant accounts can be prepared here." });

  if (p.first && m.comparative) out.push({ id: "cmp-first", severity: "error", field: "comparatives", message: "This is the first accounting period, so it can't have comparative figures." });
  if (!p.first) {
    if (!m.comparative) out.push({ id: "cmp-missing", severity: "error", field: "comparatives", message: "Comparative figures for the previous year are missing." });
    else {
      column(m.comparative, "previous", out);
      if (isoOk(p.start) && m.comparative.asAt >= p.start) out.push({ id: "cmp-date", severity: "error", field: "comparatives", message: "The comparative balance sheet date must be before this period starts." });
      if (m.comparative.shareCapital !== m.current.shareCapital) out.push({ id: "cmp-capital", severity: "error", field: "comparatives", message: "Share capital changed between the two years, so the company can't be dormant for this period (shares issued after incorporation are a transaction)." });
    }
  }

  // share classes agree with the totals
  const sum = (k: "calledUpPence" | "unpaidPence") => m.classes.reduce((t, c) => t + c[k], 0);
  if (!m.classes.length) out.push({ id: "no-classes", severity: "error", field: "share-capital", message: "No share capital is recorded." });
  for (const c of m.classes) {
    if (!int(c.shares) || c.shares <= 0) out.push({ id: `shares-${c.cls}`, severity: "error", field: "share-capital", message: `The number of ${c.cls} shares isn't valid.` });
    if (!(c.nominalMicro > 0)) out.push({ id: `nominal-${c.cls}`, severity: "error", field: "share-capital", message: `The nominal value of ${c.cls} shares is missing.` });
    if (c.unpaidPence > c.calledUpPence || c.unpaidPence < 0) out.push({ id: `unpaid-${c.cls}`, severity: "error", field: "share-capital", message: `More is shown unpaid than is called up on ${c.cls} shares.` });
    if ((BigInt(c.shares) * BigInt(c.nominalMicro) + 5000n) / 10000n !== BigInt(c.calledUpPence)) out.push({ id: `product-${c.cls}`, severity: "error", field: "share-capital", message: `${c.cls}: shares times nominal value doesn't equal the called up amount.` });
  }
  if (m.classes.length && sum("calledUpPence") !== m.current.shareCapital) out.push({ id: "cap-total", severity: "error", field: "share-capital", message: "The share capital in the note doesn't agree with the balance sheet." });
  if (m.classes.length && sum("unpaidPence") !== m.current.calledUpNotPaid) out.push({ id: "unpaid-total", severity: "error", field: "share-capital", message: "The unpaid share capital in the note doesn't agree with the balance sheet." });

  // statements and exemptions
  const s = m.statements;
  if (!(s.dormantThroughout && s.auditExemptS480 && s.membersNoAuditS476 && s.directorsResponsibilities && s.smallCompaniesRegime))
    out.push({ id: "statements", severity: "error", field: "confirmations", message: "The statutory statements can't be included until a person has confirmed the dormant, audit exemption and small companies statements." });
  if (!int(m.employees.average) || m.employees.average !== 0) out.push({ id: "employees", severity: "error", field: "employees", message: "A dormant company has no employees: the average number must be 0." });

  // signing
  if (!m.signing.director.trim()) out.push({ id: "director", severity: "error", field: "signing", message: "A director has not been chosen to sign." });
  if (m.signing.date) {
    if (!isoOk(m.signing.date)) out.push({ id: "signdate", severity: "error", field: "signing", message: "The approval date is not a valid date." });
    else if (isoOk(p.end) && m.signing.date <= p.end) out.push({ id: "signdate-early", severity: "error", field: "signing", message: "The accounts can't be approved on or before the balance sheet date." });
  }
  return out;
}
export const errorsOf = (i: Issue[]) => i.filter((x) => x.severity === "error");
