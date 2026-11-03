// The client's copy of an agreed tax plan: a short letter setting out the salaries and dividends recommended for the year, what each
// person can expect to take home, the company's side, the options considered and the points to watch. Laid out by the documents
// designer with the practice's branding (ui/docsKit makePdf). It says plainly that it is based on the figures given and current rates.
import { Block, Cell, DocContent, Run } from "./docModel";
import { AIMS, OptionResult, Outcome, PlanInput } from "./taxPlanning";
import { yearLabel } from "./taxRates";

const gbp = (n: number) => (n < 0 ? "-£" : "£") + Math.round(Math.abs(n)).toLocaleString("en-GB");
const p = (t: string): Block => ({ type: "p", runs: [{ t }] });
const h = (t: string, level: 1 | 2 | 3 = 2): Block => ({ type: "h", level, runs: [{ t }] });
const cell = (t: string, b = false, align: Cell["align"] = "left"): Cell => ({ runs: [{ t, b } as Run], align });
const table = (head: string[], rows: string[][], boldLast = false): Block => ({
  type: "table", header: true,
  rows: [head.map((x, i) => cell(x, true, i ? "right" : "left")), ...rows.map((r, ri) => r.map((x, i) => cell(x, boldLast && ri === rows.length - 1, i ? "right" : "left")))],
});

export type LetterInput = { plan: PlanInput; chosen: OptionResult; options: OptionResult[]; outcome: Outcome; clientName: string; practiceName: string; signatory: string; date: string };
export function planLetter(i: LetterInput): DocContent {
  const o = i.outcome, c = o.company, y = yearLabel(i.plan.year);
  const aim = AIMS.find((a) => a[0] === i.plan.aim);
  const people = o.people.filter((x) => x.salary || x.dividends || x.loanCash);
  const blocks: Block[] = [
    h(`Salary and dividend plan for ${y}`, 1),
    p(`This sets out how we recommend ${i.clientName} pays its directors and shareholders for the tax year ${y} (6 April ${i.plan.year - 1} to 5 April ${i.plan.year}). It is based on the figures you have given us: expected profit of ${gbp(i.plan.profit)} before directors' pay and tax${i.plan.reservesBf ? `, and ${gbp(i.plan.reservesBf)} of profits kept from earlier years` : ""}.`),
    p(`The aim: ${aim ? aim[1].toLowerCase() : ""}. ${aim ? aim[2] : ""}`),
    h("What we recommend"),
    table(["Person", "Salary", "Dividends", ...(people.some((x) => x.loanCash) ? ["Loan repaid"] : []), "Income tax", "Employee NI", "Take-home"],
      [...people.map((x) => [x.name, gbp(x.salary), gbp(x.dividends), ...(people.some((z) => z.loanCash) ? [gbp(x.loanCash)] : []), gbp(x.incomeTax), gbp(x.employeeNi), gbp(x.takeHome)]),
        ["Total", gbp(c.salaries), gbp(c.dividends - c.dividendsToOthers), ...(people.some((x) => x.loanCash) ? [gbp(c.loansRepaid)] : []), gbp(people.reduce((a, x) => a + x.incomeTax, 0)), gbp(people.reduce((a, x) => a + x.employeeNi, 0)), gbp(o.takeHome)]], true),
    p(`Salaries would be paid ${i.plan.people.some((x) => x.salaried) ? "through the payroll each month on the agreed paydays" : "as agreed"}. Dividends need a board decision and a voucher each time, and can only be paid from profits available for distribution.`),
    h("The company"),
    table(["", "Amount"], [
      ["Profit before directors' pay", gbp(c.profit)],
      ["Salaries", gbp(-c.salaries)],
      [`Employer NI${c.eaUsed ? " (after Employment Allowance)" : ""}`, gbp(-c.employerNi)],
      ...(c.pensions ? [["Employer pension contributions", gbp(-c.pensions)]] : []),
      ...(c.class1A ? [["Class 1A NI on benefits", gbp(-c.class1A)]] : []),
      ["Corporation tax", gbp(-c.ct)],
      ["Dividends", gbp(-c.dividends)],
      ["Profit kept in the company", gbp(c.retained)],
    ], true),
    h("Other options we looked at"),
    table(["Option", "Take-home", "Kept in the company", "Total tax"], i.options.filter((x) => x.key !== "custom" || x.key === i.chosen.key).map((x) => [x.label + (x.key === i.chosen.key ? " (recommended)" : ""), gbp(x.likely.takeHome), gbp(x.likely.company.retained), gbp(x.likely.totalTax)])),
  ];
  const notes = [...new Set([...o.warnings, ...o.people.flatMap((x) => x.warnings.map((w) => `${x.name}: ${w}`))])];
  if (notes.length) { blocks.push(h("Points to watch")); blocks.push({ type: "list", ordered: false, items: notes.map((t) => [{ t }]) }); }
  blocks.push(h("Please note"));
  blocks.push(p(`These figures use the tax rates and allowances for ${y} and the information you have given us about each person's other income. If the profit or anyone's circumstances change during the year, the plan may need to change too, so please tell us. Tax is due under Self Assessment on dividends over the allowance by 31 January after the end of the tax year.`));
  blocks.push(p(`Please let us know if you are happy for us to go ahead on this basis.`));
  blocks.push(p(i.signatory || i.practiceName));
  return { blocks };
}
