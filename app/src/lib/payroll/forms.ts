// End-of-year and leaver documents from the payroll: the P60 (pay and deductions for the tax year, for everyone employed on 5 April, by
// 31 May) and the leaver's P45 details (parts 1A, 2 and 3 for the employee to keep and pass on; part 1 is reported to HMRC on the FPS).
// The P60 can be in the employer's own format if it holds the required details. A P45 on plain paper needs HMRC's approval of the
// substitute form, so check that before handing one over as the official P45. Laid out by the documents designer (ui/docsKit makePdf).
import { Block, Cell, DocContent } from "../docModel";
import { Line, Ytd } from "./engine";
import { PersonRec, SchemeRec, fullName } from "./records";

const gbp = (n: number) => (n < 0 ? "-£" : "£") + Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const p = (t: string, b = false): Block => ({ type: "p", runs: [{ t, b }] });
const h = (t: string, level: 1 | 2 | 3 = 2): Block => ({ type: "h", level, runs: [{ t }] });
const c = (t: string, b = false, right = false): Cell => ({ runs: [{ t, b }], align: right ? "right" : "left" });
const kv = (rows: [string, string][]): Block => ({ type: "table", header: false, rows: rows.map(([k, v]) => [c(k), c(v, true, true)]) });
const yearText = (year: number) => `6 April ${year - 1} to 5 April ${year}`;
const fmt = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
const codeText = (l: Line) => `${l.code.regime}${l.code.fps}${l.code.nonCum ? " W1/M1" : ""}`;

const STAT: [keyof Ytd["stat"], string][] = [["smp", "Statutory Maternity Pay"], ["spp", "Statutory Paternity Pay"], ["sap", "Statutory Adoption Pay"], ["shpp", "Statutory Shared Parental Pay"], ["spbp", "Statutory Parental Bereavement Pay"], ["sncp", "Statutory Neonatal Care Pay"]];

export function p60(s: SchemeRec, person: PersonRec, last: Line, year: number, employerAddress = ""): DocContent {
  const y = last.ytd;
  const blocks: Block[] = [
    h(`P60 End of Year Certificate, tax year ${year - 1} to ${year}`, 1),
    p(`Tax year ${yearText(year)}. Keep this certificate in a safe place: you may need it to check your tax, claim tax credits or benefits, or show your income.`),
    h("Employee"),
    kv([["Name", fullName(person)], ["National Insurance number", person.nino || "Not known"], ["Payroll ID", person.payId]]),
    h("Pay and income tax in this employment"),
    kv([["Pay", gbp(y.taxablePay - y.benefits)], ...(y.benefits ? [["Benefits taxed through the payroll", gbp(y.benefits)] as [string, string]] : []), ["Tax deducted", gbp(y.tax)], ["Final tax code", codeText(last)]]),
    h("National Insurance contributions in this employment"),
    { type: "table", header: true, rows: [["NI category", "Earnings at the LEL", "Above the LEL up to the PT", "Above the PT up to the UEL", "Employee contributions above the PT"].map((x, i) => c(x, true, i > 0)), [person.niLetter, gbp(y.atLel), gbp(y.lelToPt), gbp(y.ptToUel), gbp(y.ee)].map((x, i) => c(x, false, i > 0))] },
  ];
  const stat = STAT.filter(([k]) => y.stat[k]);
  if (stat.length || y.sl || y.pgl) {
    blocks.push(h("Statutory payments and loans"));
    blocks.push(kv([...stat.map(([k, l]) => [l, gbp(y.stat[k])] as [string, string]), ...(y.sl ? [["Student loan deductions", gbp(y.sl)] as [string, string]] : []), ...(y.pgl ? [["Postgraduate loan deductions", gbp(y.pgl)] as [string, string]] : [])]));
  }
  blocks.push(h("Employer"));
  blocks.push(kv([["Employer", s.name], ["PAYE reference", `${s.officeNo}/${s.payeRef}`], ...(employerAddress ? [["Address", employerAddress] as [string, string]] : [])]));
  blocks.push(p("Certificate by employer: this form shows your total pay for income tax purposes in this employment for the year. Any overtime, bonus, commission and so on, statutory payments and benefits taxed through the payroll are included."));
  return { blocks };
}

export function p45(s: SchemeRec, person: PersonRec, last: Line, year: number, leavingDate: string, freq: "M1" | "W1" | "W2" | "W4"): DocContent {
  const y = last.ytd;
  const periodText = freq === "M1" ? `Month ${last.period}` : `Week ${last.period}`;
  const part = (title: string, intro: string): Block[] => [
    h(title),
    p(intro),
    kv([
      ["Employer PAYE reference", `${s.officeNo}/${s.payeRef}`], ["Employee's NI number", person.nino || "Not known"], ["Name", fullName(person)], ["Payroll ID", person.payId],
      ["Leaving date", fmt(leavingDate)], ["Student loan deductions to continue", person.studentPlan ? `Yes (${person.studentPlan.replace("plan", "Plan ")})` : "No"], ["Postgraduate loan deductions to continue", person.postgrad ? "Yes" : "No"],
      ["Tax code at leaving date", codeText(last)], ["Last entries: week or month number", periodText],
      ["Total pay to date", gbp(y.taxablePay - y.benefits)], ["Total tax to date", gbp(y.tax)],
    ]),
  ];
  return { blocks: [
    h(`P45 Details of employee leaving work, tax year ${year - 1} to ${year}`, 1),
    p("Part 1 has been sent to HMRC on the Full Payment Submission. Parts 1A, 2 and 3 are below."),
    ...part("Part 1A: for the employee to keep", "Keep this part. You may need it to check your tax or claim a refund."),
    { type: "break" },
    ...part("Part 2: for the new employer", "Give parts 2 and 3 to your new employer, or to Jobcentre Plus if you are claiming benefits."),
    ...part("Part 3: new employer's copy", "The new employer completes the rest of part 3 and keeps it."),
    p(`Employer: ${s.name}`),
  ] };
}
