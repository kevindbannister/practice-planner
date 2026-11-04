"use strict";
// Builds the CT600 (company tax return) body, IRenvelope, laid out to HMRC's published CT schema V1.994
// (api/filing/rim/ct600-2026-v1-994), and works out the Corporation Tax for the cases it supports.
// It covers only what is in SUPPORTED. Anything else is returned in `unsupported` and the build is refused, so a partial return is never
// produced as complete. The GovTalk message class and keys are NOT in HMRC's RIM pack, so this is not registered as an adapter yet.
// The company's accounts and computations must be attached as iXBRL, which the planner cannot make: the caller supplies them or the build says so.

const NS = "http://www.govtalk.gov.uk/taxation/CT/5";
const SUPPORTED = ["Company details and accounting period (12 months or less)", "Trading profit, trading losses brought forward, qualifying donations", "Corporation Tax at the main rate, or the small profits rate (profits outside the marginal relief band)", "Declaration", "Attaching iXBRL accounts and a tax computation that you supply (the planner does not make them and does not check their content)"];
// Rates and limits for financial years 2023 to 2026 (FY2023 = 1 April 2023 to 31 March 2024): GOV.UK 'Corporation Tax rates and allowances' lists the same
// rates and limits for each of them. 2027 is not listed there, so a period reaching 1 April 2027 is refused.
const RATES = { main: 25, small: 19, lower: 50000, upper: 250000 };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const whole = (n) => Math.floor(Number(n) || 0).toFixed(2);
const pence = (n) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const day = 86400000;
const d = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const days = (from, to) => Math.round((d(to) - d(from)) / day) + 1;
const fyOf = (s) => (+s.slice(5, 7) >= 4 ? +s.slice(0, 4) : +s.slice(0, 4) - 1);
const utrOk = (v) => {
  if (!/^\d{10}$/.test(v) || /^([1-9])\1{9}$/.test(v)) return false;
  const w = [6, 7, 8, 9, 10, 5, 4, 3, 2];
  return "21987654321"[w.reduce((a, x, i) => a + x * Number(v[i + 1]), 0) % 11] === v[0];
};

/**
 * Corporation Tax for a period of up to 12 months, split by financial year. Returns { years:[{year, days, profit, rate, tax}], tax, marginal }.
 * `marginal` is true when any year's profit falls inside the marginal relief band, which this does not present (see build()).
 * Limits are divided by (1 + associated companies) and scaled by the days of the period in the financial year.
 */
function computeTax(from, to, profit, associated = 0) {
  const total = days(from, to);
  const share = 1 + (Number(associated) || 0);
  const years = [];
  let cursor = d(from), left = Math.floor(profit), marginal = false;
  const end = d(to);
  while (cursor <= end) {
    const y = fyOf(iso(cursor));
    const fyEnd = Math.min(Date.UTC(y + 1, 2, 31), end);
    const n = Math.round((fyEnd - cursor) / day) + 1;
    const isLast = fyEnd === end;
    const part = isLast ? left : Math.floor(profit * (n / total));
    left -= part;
    // The limits for the part of the period in this financial year are the full-year limits (shared between associated companies)
    // scaled by the days in the period that fall in that year over the days in the year. This also covers a period shorter than a year.
    const fyDays = Math.round((Date.UTC(y + 1, 2, 31) - Date.UTC(y, 3, 1)) / day) + 1;
    const lo = (RATES.lower / share) * (n / fyDays), up = (RATES.upper / share) * (n / fyDays);
    let rate;
    if (part <= lo) rate = RATES.small; else if (part >= up) rate = RATES.main; else { rate = null; marginal = true; }
    years.push({ year: y, days: n, profit: part, rate, tax: rate === null ? 0 : Math.round(part * rate) / 100 });
    cursor = fyEnd + day;
  }
  return { years, tax: years.reduce((a, y) => a + y.tax, 0), marginal };
}

const MONEY = (name, v) => (Number(v) > 0 ? `<${name}>${whole(v)}</${name}>` : "");
const NAME_OK = /^[^<>]*$/;

/** What is wrong with the input and what it holds that this builder cannot express. */
function problems(c) {
  const bad = [], un = [];
  const co = c.company || {}, p = c.period || {};
  if (!String(co.name || "").trim()) bad.push("The company has no name.");
  if (!utrOk(String(co.utr || "").replace(/\s/g, ""))) bad.push("The company's Corporation Tax UTR isn't valid (10 digits with a correct check digit).");
  if (co.number && !/^([0-9]{8}|[A-Z]{2}[0-9]{6})$/.test(String(co.number).toUpperCase())) bad.push("The company number isn't in Companies House's form (8 characters).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(p.to || "")) bad.push("The accounting period dates are missing.");
  else {
    const n = days(p.from, p.to);
    if (n < 1) bad.push("The accounting period ends before it starts.");
    if (n > 366) un.push("An accounting period over 12 months (it has to be split into two returns)");
    if (fyOf(p.from) < 2023) un.push("Accounting periods before 1 April 2023 (different rates)");
    if (fyOf(p.to) > 2026) un.push("Accounting periods reaching 1 April 2027 (HMRC hasn't published those rates)");
  }
  if (!c.declaration || !String(c.declaration.name || "").trim() || !String(c.declaration.status || "").trim()) bad.push("The declaration needs the name and status (for example Director) of the person signing.");
  const f = c.figures || {};
  for (const k of ["turnover", "tradingProfit", "lossesBf", "qualifyingDonations"]) if (f[k] !== undefined && !(Number(f[k]) >= 0)) bad.push(`${k} can't be negative here (a loss is not a profit figure: use the loss route).`);
  const other = c.other || {};
  for (const [k, label] of [["property", "UK property income"], ["gains", "Chargeable gains"], ["interest", "Interest and other non-trading income"], ["dividends", "Dividends received"], ["groupRelief", "Group relief"], ["rd", "Research and development relief"], ["overseas", "Overseas income or double tax relief"], ["lossCarriedBack", "Losses carried back"], ["closeCompanyLoans", "Loans to participators (CT600A)"], ["distributions", "Distributions (they change the marginal relief limits)"], ["instalments", "Large or very large company instalments"]])
    if (other[k]) un.push(label);
  if (c.amended) un.push("Amended returns");
  // HMRC rules 9113 and 9965: iXBRL accounts and a tax computation must come with the return. The planner cannot make them, so they must be supplied.
  for (const [k, label] of [["accounts", "iXBRL accounts"], ["computation", "iXBRL tax computation"]]) {
    const a = c.attachments?.[k];
    if (!a || !a.filename || !a.content || !String(a.content).length) bad.push(`The ${label} aren't attached: HMRC requires them with the return, and the planner cannot produce them.`);
    else if (!/^[A-Za-z0-9_.\-]+\.x?html?$/i.test(a.filename)) bad.push(`The ${label} file name must be a simple .xhtml or .html name.`);
  }
  if (Number(co.associated) > 0 && !Number.isInteger(Number(co.associated))) bad.push("Associated companies must be a whole number.");
  if (!bad.length && !un.length) {
    const profit = Math.max(0, Math.floor(f.tradingProfit || 0) - Math.floor(f.lossesBf || 0)) - Math.floor(f.qualifyingDonations || 0);
    if (profit < 0) un.push("Qualifying donations larger than the profits (that is a non-trade charge relief claim)");
    else if (computeTax(p.from, p.to, profit, co.associated).marginal) un.push("Profits within the marginal relief band (how HMRC wants marginal relief shown isn't in the RIM pack)");
  }
  return { bad, un };
}

/**
 * c: { company:{name, number, utr, type, associated}, period:{from,to}, figures:{turnover, tradingProfit, lossesBf, qualifyingDonations},
 *      declaration:{name,status}, sender, accounts:{xbrl|pdf...}, other:{...unsupported flags} }
 * Returns { xml, errors, unsupported, supported, tax }.
 */
function build(c, ctx = {}) {
  const { bad, un } = problems(c);
  if (bad.length || un.length) return { xml: "", errors: bad, unsupported: un, supported: SUPPORTED, tax: null };
  const co = c.company, p = c.period, f = c.figures || {};
  const trading = Math.floor(f.tradingProfit || 0), lossBf = Math.min(Math.floor(f.lossesBf || 0), trading);
  const net = trading - lossBf, donations = Math.floor(f.qualifyingDonations || 0);
  const chargeable = net - donations;
  const t = computeTax(p.from, p.to, chargeable, co.associated);
  const agent = ctx.sender === "Agent";
  const att = (k, el) => { const a = c.attachments[k]; return `<${el}><Instance><EncodedInlineXBRLDocument Filename="${esc(a.filename)}" entryPoint="yes">${Buffer.from(a.content).toString("base64")}</EncodedInlineXBRLDocument></Instance></${el}>`; };
  const yearXml = (y) => `<Year>${y.year}</Year><Details><Profit>${whole(y.profit)}</Profit><TaxRate>${y.rate.toFixed(2)}</TaxRate><Tax>${pence(y.tax)}</Tax></Details>`;
  const ys = t.years.filter((y) => y.profit > 0 || t.years.length === 1);
  const utr = String(co.utr).replace(/\s/g, "");
  const smallRate = ys.length && ys.every((y) => y.rate === RATES.small);
  const body =
    `<IRenvelope xmlns="${NS}"><IRheader><Keys><Key Type="UTR">${utr}</Key></Keys><PeriodEnd>${esc(p.to)}</PeriodEnd><DefaultCurrency>GBP</DefaultCurrency><Sender>${agent ? "Agent" : "Company"}</Sender></IRheader>` +
    `<CompanyTaxReturn ReturnType="new"><CompanyInformation><CompanyName>${esc(co.name)}</CompanyName>${co.number ? `<RegistrationNumber>${esc(String(co.number).toUpperCase())}</RegistrationNumber>` : ""}<Reference>${utr}</Reference><CompanyType>${Number.isInteger(co.type) ? co.type : 0}</CompanyType><PeriodCovered><From>${esc(p.from)}</From><To>${esc(p.to)}</To></PeriodCovered></CompanyInformation>` +
    `<ReturnInfoSummary><ThisPeriod>yes</ThisPeriod><Accounts><ThisPeriodAccounts>yes</ThisPeriodAccounts></Accounts><Computations><ThisPeriodComputations>yes</ThisPeriodComputations></Computations></ReturnInfoSummary>` +
    (Number(f.turnover) > 0 ? `<Turnover><Total>${whole(f.turnover)}</Total></Turnover>` : "") +
    "<CompanyTaxCalculation><Income>" + (trading ? `<Trading><Profits>${whole(trading)}</Profits>${MONEY("LossesBroughtForward", lossBf)}<NetProfits>${whole(net)}</NetProfits></Trading>` : "") + "</Income>" +
    "<ChargeableGains><NetChargeableGains>0.00</NetChargeableGains></ChargeableGains>" +
    (net ? `<ProfitsBeforeOtherDeductions>${whole(net)}</ProfitsBeforeOtherDeductions>` : "") +
    // HMRC rule 9320: box 300 is required whenever box 235 has an amount.
    (net ? `<ChargesAndReliefs><ProfitsBeforeDonationsAndGroupRelief>${whole(net)}</ProfitsBeforeDonationsAndGroupRelief>${MONEY("QualifyingDonations", donations)}</ChargesAndReliefs>` : "") +
    `<ChargeableProfits>${whole(chargeable)}</ChargeableProfits>` +
    (chargeable > 0 ? `<CorporationTaxChargeable><AssociatedCompanies><ThisPeriod>${Number(co.associated) || 0}</ThisPeriod>${smallRate ? "<StartingOrSmallCompaniesRate>yes</StartingOrSmallCompaniesRate>" : ""}</AssociatedCompanies><FinancialYearOne>${yearXml(ys[0])}</FinancialYearOne>${ys[1] ? `<FinancialYearTwo>${yearXml(ys[1])}</FinancialYearTwo>` : ""}</CorporationTaxChargeable><CorporationTax>${pence(t.tax)}</CorporationTax>` : "") +
    `<NetCorporationTaxChargeable>${pence(t.tax)}</NetCorporationTaxChargeable></CompanyTaxCalculation>` +
    `<CalculationOfTaxOutstandingOrOverpaid><NetCorporationTaxLiability>${pence(t.tax)}</NetCorporationTaxLiability><TaxChargeable>${pence(t.tax)}</TaxChargeable><TaxPayable>${pence(t.tax)}</TaxPayable></CalculationOfTaxOutstandingOrOverpaid>` +
    `<Declaration><AcceptDeclaration>yes</AcceptDeclaration><Name>${esc(c.declaration.name)}</Name><Status>${esc(c.declaration.status)}</Status></Declaration>` +
    `<AttachedFiles><XBRLsubmission>${att("computation", "Computation")}${att("accounts", "Accounts")}</XBRLsubmission></AttachedFiles></CompanyTaxReturn></IRenvelope>`;
  return { xml: body, errors: [], unsupported: [], supported: SUPPORTED, tax: t };
}

module.exports = { build, problems, computeTax, utrOk, NS, SUPPORTED, RATES };
