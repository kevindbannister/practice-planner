// Starter checklists. They are sensible example workflows to edit or replace, not a statement of everything a
// regulator expects. A starter becomes a real template the first time it is used (see checklistKit).
import { Role, Rule, TItem, TSection, Template, templateHours } from "./checklist";

type O = Partial<Omit<TItem, "id" | "title" | "after">> & { id?: string; after?: string | string[] };
const it = (title: string, o: O = {}): [string, O] => [title, o];
type Item = ReturnType<typeof it>;

function section(n: number, title: string, items: Item[], prevLast?: string): TSection {
  let last = prevLast;
  const out: TItem[] = items.map(([t, o], i) => {
    const id = o.id || `s${n}i${i + 1}`;
    const after = o.after === "prev" ? (last ? [last] : []) : Array.isArray(o.after) ? o.after : o.after ? [o.after] : [];
    last = id;
    const { id: _id, after: _a, ...rest } = o;
    return { id, title: t, mandatory: true, hours: 0.25, after, ...rest } as TItem;
  });
  return { id: `sec${n}`, title, items: out };
}

const VAT: Rule[] = [{ attr: "vat", is: true }];
const PAYROLL: Rule[] = [{ attr: "payroll", is: true }];
const ASSETS: Rule[] = [{ attr: "fixedAssets", is: true }];
const OUTSOURCED: Rule[] = [{ attr: "outsourced", is: true }];
const DORMANT: Rule[] = [{ attr: "dormant", is: true }];
const NOT_DORMANT: Rule[] = [{ attr: "dormant", is: false }];

const REVIEW_SECTION = (n: number, prevIds: string[]) => section(n, "Review", [
  it("Complete preparer checks", { id: `r${n}1`, role: "preparer", after: prevIds }),
  it("Resolve outstanding queries", { id: `r${n}2`, role: "preparer", paper: { section: "queries" }, after: `r${n}1` }),
  it("Review the work", { id: `r${n}4`, role: "reviewer", hours: 0.75, review: "review", after: `r${n}2` }),
  it("Address reviewer comments", { id: `r${n}5`, role: "preparer", paper: { section: "review-notes" }, after: `r${n}4` }),
  it("Obtain reviewer approval", { id: `r${n}6`, role: "reviewer", review: "approve", after: `r${n}5` }),
]);

export type Starter = Omit<Template, "id" | "version" | "active" | "isDefault" | "created" | "updated" | "jobType"> & { starter: string; match: RegExp; not?: RegExp };
const mk = (starter: string, name: string, description: string, match: RegExp, clientKinds: string[], sections: TSection[], when?: Rule[], not?: RegExp): Starter =>
  ({ starter, name, description, match, not, clientKinds, when, sections, hours: templateHours({ sections }) });
/** Whether a job type's name suits this starter. */
export const suits = (s: Starter, jobName: string) => s.match.test(jobName) && !(s.not && s.not.test(jobName));

export const STARTERS: Starter[] = [
  mk("ltd-accounts", "Limited company annual accounts", "Year-end accounts preparation, review and filing for a limited company.", /(limited|ltd|company).*accounts|annual accounts|^accounts/i, ["Ltd"], [
    section(1, "Pre-preparation", [
      it("Confirm accounting period", { id: "a1", role: "preparer", hours: 0.1 }),
      it("Confirm records received", { id: "a2", role: "preparer", needsClient: "Bank statements, sales and purchase records for the year", after: "a1" }),
      it("Obtain trial balance", { id: "a3", role: "preparer", paper: { section: "tb" }, after: "a2" }),
      it("Check prior-year accounts", { id: "a4", role: "preparer", hours: 0.25 }),
      it("Review outstanding client queries", { id: "a5", role: "preparer", paper: { section: "queries" } }),
    ]),
    section(2, "Accounts preparation", [
      it("Review bookkeeping", { id: "b1", role: "preparer", hours: 1, after: "a3" }),
      it("Reconcile bank balances", { id: "b2", role: "preparer", paper: { section: "bank" }, hours: 0.75, needsClient: "Year-end bank statements", after: "b1" }),
      it("Review debtors and creditors", { id: "b3", role: "preparer", paper: { section: "debtors" }, hours: 0.75, after: "b1" }),
      it("Review fixed assets", { id: "b4", role: "preparer", paper: { section: "fixed" }, when: ASSETS, hours: 0.5, needsClient: "Invoices for additions and disposals", after: "b1" }),
      it("Calculate depreciation", { id: "b5", role: "preparer", when: ASSETS, hours: 0.5, after: "b4" }),
      it("Review accruals and prepayments", { id: "b6", role: "preparer", paper: { section: "creditors" }, hours: 0.5, after: "b1" }),
      it("VAT reconciliation", { id: "b7", role: "preparer", paper: { section: "vat" }, when: VAT, hours: 0.5, after: "b1" }),
      it("Payroll reconciliation", { id: "b8", role: "preparer", paper: { section: "wages" }, when: PAYROLL, hours: 0.5, needsClient: "Payroll reports and P11D details", after: "b1" }),
      it("Post adjusting journals", { id: "b9", role: "preparer", paper: { section: "journals" }, after: ["b2", "b3", "b6"] }),
      it("Complete working papers", { id: "b10", role: "preparer", paper: { section: "final-tb" }, after: "b9" }),
    ]),
    section(3, "Outsourced preparation", [
      it("Send records to the outsourced preparer", { id: "o1", role: "owner", when: OUTSOURCED, hours: 0.25, after: "a2" }),
      it("Internal review of outsourced work", { id: "o2", role: "reviewer", when: OUTSOURCED, hours: 1, review: "review", after: "o1" }),
    ]),
    REVIEW_SECTION(4, ["b10"]),
    section(5, "Completion", [
      it("Generate draft accounts", { id: "c1", role: "preparer", hours: 0.5, after: "r46" }),
      it("Send accounts for client approval", { id: "c2", role: "preparer", hours: 0.25, needsClient: "Client approval of the draft accounts", after: "c1" }),
      it("Record signed approval", { id: "c3", role: "preparer", hours: 0.1, after: "c2" }),
      it("Complete applicable filing steps", { id: "c4", role: "preparer", hours: 0.5, after: "c3" }),
      it("Close the job", { id: "c5", role: "preparer", hours: 0.1, after: "c4" }),
    ]),
  ]),
  mk("dormant-accounts", "Dormant company accounts", "A shorter workflow for a company with no transactions in the year.", /dormant|(limited|ltd|company).*accounts|annual accounts|^accounts/i, ["Ltd"], [
    section(1, "Dormancy checks", [
      it("Confirm no transactions in the period", { id: "d1", role: "preparer", needsClient: "Confirmation there were no bank transactions or trading", hours: 0.25 }),
      it("Confirm no bank account activity", { id: "d2", role: "preparer", after: "d1" }),
      it("Check prior-year accounts and share capital", { id: "d3", role: "preparer", after: "d1" }),
    ]),
    REVIEW_SECTION(2, ["d2", "d3"]),
    section(3, "Completion", [
      it("Generate dormant accounts", { id: "dc1", role: "preparer", after: "r26" }),
      it("Send to client for approval", { id: "dc2", role: "preparer", needsClient: "Client approval", after: "dc1" }),
      it("File with Companies House", { id: "dc3", role: "preparer", after: "dc2" }),
      it("Close the job", { id: "dc4", role: "preparer", hours: 0.1, after: "dc3" }),
    ]),
  ], DORMANT),
  mk("sole-trader", "Sole trader accounts", "Accounts and tax figures for a self-employed individual.", /sole trader|self.?employ/i, ["Individual"], [
    section(1, "Records", [
      it("Confirm accounting period", { id: "t1", role: "preparer", hours: 0.1 }),
      it("Confirm records received", { id: "t2", role: "preparer", needsClient: "Income and expense records, bank statements", after: "t1" }),
      it("Check prior-year figures", { id: "t3", role: "preparer" }),
    ]),
    section(2, "Preparation", [
      it("Review income and expenses", { id: "t4", role: "preparer", hours: 1, after: "t2" }),
      it("Reconcile bank and cash", { id: "t5", role: "preparer", paper: { section: "bank" }, hours: 0.5, after: "t4" }),
      it("Check private use and drawings", { id: "t6", role: "preparer", hours: 0.25, after: "t4" }),
      it("Capital allowances", { id: "t7", role: "preparer", when: ASSETS, hours: 0.5, after: "t4" }),
      it("VAT reconciliation", { id: "t8", role: "preparer", when: VAT, hours: 0.5, after: "t4" }),
      it("Complete working papers", { id: "t9", role: "preparer", after: ["t5", "t6"] }),
    ]),
    REVIEW_SECTION(3, ["t9"]),
    section(4, "Completion", [
      it("Send accounts to client", { id: "tc1", role: "preparer", after: "r36" }),
      it("Record client approval", { id: "tc2", role: "preparer", needsClient: "Client approval", after: "tc1" }),
      it("Close the job", { id: "tc3", role: "preparer", hours: 0.1, after: "tc2" }),
    ]),
  ]),
  mk("partnership", "Partnership accounts", "Accounts and the partnership profit split.", /partnership/i, ["Partnership"], [
    section(1, "Records", [
      it("Confirm accounting period and partners", { id: "p1", role: "preparer", hours: 0.1 }),
      it("Confirm records received", { id: "p2", role: "preparer", needsClient: "Records, bank statements and partners' drawings", after: "p1" }),
      it("Check partnership agreement and profit share", { id: "p3", role: "preparer" }),
    ]),
    section(2, "Preparation", [
      it("Review bookkeeping", { id: "p4", role: "preparer", hours: 1, after: "p2" }),
      it("Reconcile bank balances", { id: "p5", role: "preparer", paper: { section: "bank" }, hours: 0.75, after: "p4" }),
      it("Allocate profit between partners", { id: "p6", role: "preparer", hours: 0.5, after: "p4" }),
      it("Reconcile partners' capital and current accounts", { id: "p7", role: "preparer", paper: { section: "capital" }, after: "p6" }),
      it("Fixed assets and capital allowances", { id: "p8", role: "preparer", when: ASSETS, hours: 0.5, after: "p4" }),
      it("VAT reconciliation", { id: "p9", role: "preparer", when: VAT, hours: 0.5, after: "p4" }),
    ]),
    REVIEW_SECTION(3, ["p5", "p7"]),
    section(4, "Completion", [
      it("Send accounts to the partners", { id: "pc1", role: "preparer", after: "r36" }),
      it("Record partners' approval", { id: "pc2", role: "preparer", needsClient: "Approval from the partners", after: "pc1" }),
      it("Close the job", { id: "pc3", role: "preparer", hours: 0.1, after: "pc2" }),
    ]),
  ], undefined, /tax return|vat|payroll|bookkeeping/i),
  mk("ct", "Corporation tax return", "Computation and CT600 for a company.", /corporation tax|ct600|\bct\b/i, ["Ltd", "LLP"], [
    section(1, "Preparation", [
      it("Confirm accounting period and filing deadline", { id: "x1", role: "preparer", hours: 0.1 }),
      it("Obtain approved accounts", { id: "x2", role: "preparer", after: "x1" }),
      it("Prepare the tax computation", { id: "x3", role: "preparer", paper: { section: "draft-tax" }, hours: 1.5, after: "x2" }),
      it("Capital allowances", { id: "x4", role: "preparer", when: ASSETS, hours: 0.5, after: "x2" }),
      it("Check losses, group relief and prior-year figures", { id: "x5", role: "preparer", hours: 0.5, after: "x3" }),
    ]),
    REVIEW_SECTION(2, ["x3", "x5"]),
    section(3, "Filing", [
      it("Send computation to client for approval", { id: "xc1", role: "preparer", needsClient: "Client approval of the computation", after: "r26" }),
      it("File the return", { id: "xc2", role: "preparer", hours: 0.5, after: "xc1" }),
      it("Record the tax due and payment date", { id: "xc3", role: "preparer", hours: 0.1, after: "xc2" }),
      it("Close the job", { id: "xc4", role: "preparer", hours: 0.1, after: "xc3" }),
    ]),
  ]),
  mk("sa", "Personal tax return", "Self assessment return for an individual.", /personal tax|self assessment|\bsa\b|tax return/i, ["Individual"], [
    section(1, "Information", [
      it("Confirm tax year and deadline", { id: "y1", role: "preparer", hours: 0.1 }),
      it("Obtain income and gains information", { id: "y2", role: "preparer", needsClient: "P60/P45, interest and dividend vouchers, rental and other income details", after: "y1" }),
      it("Obtain reliefs and payments on account details", { id: "y3", role: "preparer", needsClient: "Pension, gift aid and other relief details", after: "y1" }),
      it("Check prior-year return", { id: "y4", role: "preparer" }),
    ]),
    section(2, "Preparation", [
      it("Prepare the return", { id: "y5", role: "preparer", hours: 1.25, after: ["y2", "y3"] }),
      it("Check the calculation against prior year", { id: "y6", role: "preparer", hours: 0.25, after: "y5" }),
    ]),
    REVIEW_SECTION(3, ["y6"]),
    section(4, "Filing", [
      it("Send to client for approval", { id: "yc1", role: "preparer", needsClient: "Client approval of the return", after: "r36" }),
      it("Obtain authority to file", { id: "yc2", role: "preparer", after: "yc1" }),
      it("File the return", { id: "yc3", role: "preparer", hours: 0.25, after: "yc2" }),
      it("Advise the client of the tax and payment dates", { id: "yc4", role: "preparer", hours: 0.1, after: "yc3" }),
      it("Close the job", { id: "yc5", role: "preparer", hours: 0.1, after: "yc4" }),
    ]),
  ], undefined, /corporation|company|\bct\b|partnership|vat/i),
  mk("vat", "VAT return", "Quarterly or monthly VAT return.", /vat/i, [], [
    section(1, "Records", [
      it("Confirm the VAT period", { id: "v1", role: "preparer", hours: 0.1 }),
      it("Confirm records received", { id: "v2", role: "preparer", needsClient: "Sales and purchase records for the period", after: "v1" }),
    ]),
    section(2, "Preparation", [
      it("Review sales and purchases for VAT treatment", { id: "v3", role: "preparer", hours: 0.5, after: "v2" }),
      it("Reconcile to the VAT control account", { id: "v4", role: "preparer", paper: { section: "vat" }, hours: 0.25, after: "v3" }),
      it("Check unusual items and partial exemption", { id: "v5", role: "preparer", mandatory: false, hours: 0.25, after: "v3" }),
      it("Prepare the return", { id: "v6", role: "preparer", hours: 0.25, after: "v4" }),
    ]),
    section(3, "Review and filing", [
      it("Review the return", { id: "vr1", role: "reviewer", hours: 0.25, review: "review", after: "v6" }),
      it("Send the figures to the client for approval", { id: "vr2", role: "preparer", needsClient: "Client approval of the VAT figures", after: "vr1" }),
      it("Submit the return", { id: "vr3", role: "preparer", hours: 0.1, after: "vr2" }),
      it("Tell the client the amount and payment date", { id: "vr4", role: "preparer", hours: 0.1, after: "vr3" }),
      it("Close the job", { id: "vr5", role: "preparer", hours: 0.1, after: "vr4" }),
    ]),
  ]),
  mk("bookkeeping", "Monthly bookkeeping", "A month's bookkeeping and reconciliations.", /bookkeeping|book-keeping/i, [], [
    section(1, "Records", [
      it("Confirm bank statements and records received", { id: "k1", role: "preparer", needsClient: "Bank statements and receipts for the month", hours: 0.1 }),
      it("Import and code bank transactions", { id: "k2", role: "preparer", hours: 1, after: "k1" }),
    ]),
    section(2, "Reconciliations", [
      it("Reconcile bank accounts", { id: "k3", role: "preparer", paper: { section: "bank" }, hours: 0.5, after: "k2" }),
      it("Reconcile sales and purchase ledgers", { id: "k4", role: "preparer", hours: 0.5, after: "k2" }),
      it("VAT control account check", { id: "k5", role: "preparer", when: VAT, hours: 0.25, after: "k3" }),
      it("Payroll control account check", { id: "k6", role: "preparer", when: PAYROLL, hours: 0.25, after: "k3" }),
      it("Chase unexplained items with the client", { id: "k7", role: "preparer", mandatory: false, needsClient: "Explanations for unmatched items", hours: 0.25, after: "k3" }),
    ]),
    section(3, "Completion", [
      it("Review the month's figures", { id: "kc1", role: "reviewer", hours: 0.25, review: "review", after: ["k3", "k4"] }),
      it("Send the monthly report to the client", { id: "kc2", role: "preparer", hours: 0.1, after: "kc1" }),
      it("Close the job", { id: "kc3", role: "preparer", hours: 0.1, after: "kc2" }),
    ]),
  ]),
  mk("payroll", "Payroll processing", "A pay run, with RTI submission and payment dates.", /payroll|paye|wages/i, [], [
    section(1, "Inputs", [
      it("Confirm pay period and pay date", { id: "w1", role: "preparer", hours: 0.1 }),
      it("Receive hours, starters, leavers and changes", { id: "w2", role: "preparer", needsClient: "Hours, starters, leavers and pay changes", after: "w1" }),
    ]),
    section(2, "Processing", [
      it("Enter changes and run payroll", { id: "w3", role: "preparer", hours: 0.5, after: "w2" }),
      it("Check gross to net against the previous run", { id: "w4", role: "preparer", hours: 0.25, after: "w3" }),
      it("Pension contributions and statutory pay checks", { id: "w5", role: "preparer", hours: 0.25, after: "w3" }),
    ]),
    section(3, "Sign-off and filing", [
      it("Review the payroll", { id: "wr1", role: "reviewer", hours: 0.25, review: "review", after: ["w4", "w5"] }),
      it("Send payslips and the summary to the client", { id: "wr2", role: "preparer", needsClient: "Client approval to pay", after: "wr1" }),
      it("Submit the RTI return", { id: "wr3", role: "preparer", hours: 0.1, after: "wr2" }),
      it("Tell the client the amounts due to HMRC", { id: "wr4", role: "preparer", hours: 0.1, after: "wr3" }),
      it("Close the job", { id: "wr5", role: "preparer", hours: 0.1, after: "wr4" }),
    ]),
  ]),
  mk("confirmation", "Confirmation statement", "Annual confirmation statement for a company.", /confirmation statement/i, ["Ltd", "LLP"], [
    section(1, "Checks", [
      it("Check Companies House record", { id: "z1", role: "preparer", hours: 0.1 }),
      it("Confirm directors, shareholders and PSCs with the client", { id: "z2", role: "preparer", needsClient: "Confirmation of directors, shareholders and people with significant control", after: "z1" }),
      it("Confirm registered office and SIC codes", { id: "z3", role: "preparer", hours: 0.1, after: "z1" }),
    ]),
    section(2, "Filing", [
      it("Obtain client approval", { id: "z4", role: "preparer", after: ["z2", "z3"] }),
      it("File the confirmation statement", { id: "z5", role: "preparer", hours: 0.1, after: "z4" }),
      it("Record the filing and close the job", { id: "z6", role: "preparer", hours: 0.1, after: "z5" }),
    ]),
  ]),
  mk("onboarding", "New client onboarding", "Taking on a new client.", /onboarding|new client/i, [], [
    section(1, "Acceptance", [
      it("Complete anti-money-laundering checks", { id: "n1", role: "manager", hours: 0.5 }),
      it("Complete client acceptance and conflict checks", { id: "n2", role: "partner", hours: 0.25 }),
      it("Agree the scope and fees", { id: "n3", role: "partner", hours: 0.5, after: "n2" }),
    ]),
    section(2, "Engagement", [
      it("Send the engagement letter", { id: "n4", role: "manager", hours: 0.25, after: "n3" }),
      it("Receive the signed engagement letter", { id: "n5", role: "manager", needsClient: "Signed engagement letter", after: "n4" }),
      it("Obtain HMRC authorisations", { id: "n6", role: "preparer", needsClient: "Authority to act for the client with HMRC", after: "n5" }),
      it("Contact the previous accountant", { id: "n7", role: "manager", mandatory: false, hours: 0.25, after: "n5" }),
    ]),
    section(3, "Set-up", [
      it("Set up the client record and services", { id: "n8", role: "preparer", hours: 0.5, after: "n5" }),
      it("Obtain opening records and prior-year accounts", { id: "n9", role: "preparer", needsClient: "Prior-year accounts and opening records", after: "n5" }),
      it("Set up bookkeeping software access", { id: "n10", role: "preparer", mandatory: false, hours: 0.25, after: "n5" }),
      it("Welcome the client and agree timetable", { id: "n11", role: "manager", hours: 0.25, after: ["n8", "n9"] }),
    ]),
  ]),
];

/** The starter that suits a job type's name and the client type, if any. A dormant company gets the dormant one. */
export function starterFor(jobName: string, kind: string, dormant = false): Starter | undefined {
  const fits = STARTERS.filter((s) => suits(s, jobName) && (!s.when || dormant) && (!s.clientKinds.length || s.clientKinds.includes(kind)));
  return (dormant && fits.find((s) => s.when)) || fits.find((s) => !s.when) || fits[0];
}
export const roleOf = (r: Role | "") => r;
