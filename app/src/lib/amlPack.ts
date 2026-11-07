// The practice's own AML pack: the firm-wide risk assessment, the policies and procedures, ongoing client reviews, screening records,
// training, the actions register, the MLRO's annual report and the independent review. Each is a form of fields and tick boxes that is
// filled in, saved with its date, and exported to Word or PDF. The suspicious activity forms are only ever printed blank: the firm's own
// policy says reports and the register are restricted and must not sit in general files, so the planner does not store them.
// Nothing here is evidence that a control has been carried out: the pack records what the firm says it has done.
import { zip } from "./xlsx";

// ------------------------------------------------------------------ the forms

export type Col = { k: string; label: string; type?: "text" | "date" | "one" | "client"; options?: string[] };
export type Field =
  | { k: string; label: string; type: "text" | "date" | "client"; hint?: string }
  | { k: string; label: string; type: "long"; hint?: string; flow?: boolean }
  | { k: string; label: string; type: "one" | "many"; options: string[]; hint?: string }
  | { k: string; label: string; type: "grid"; items: string[]; options: string[]; multi?: boolean; noteLabel: string }
  | { k: string; label: string; type: "table"; cols: Col[]; blank: number }
  | { k: string; label: string; type: "info" };
export type Section = { title: string; intro?: string; fields: Field[] };
export type Values = Record<string, unknown>;
export type FormDef = {
  id: string; title: string; blurb: string; noun: string; sections: Section[];
  /** False for forms that are only printed blank (the suspicious activity forms and the client onboarding form). */
  stored: boolean; restricted?: boolean;
  /** One record that is added to, not a new record each time (training, actions). */
  single?: boolean;
  /** The date field that says when this is next due for review. */
  reviewKey?: string;
  seed?: () => Values;
};
export type Rec = { id: string; created: string; status: "Draft" | "Approved"; values: Values };
export type Store = { records: Rec[] };

const text = (k: string, label: string, hint?: string): Field => ({ k, label, type: "text", hint });
const date = (k: string, label: string): Field => ({ k, label, type: "date" });
const long = (k: string, label: string, hint?: string): Field => ({ k, label, type: "long", hint });
const one = (k: string, label: string, options: string[]): Field => ({ k, label, type: "one", options });
const YNN = ["Yes", "No", "N/A"];
const LMH = ["Low", "Medium", "High"];
const info = (k: string, label: string): Field => ({ k, label, type: "info" });

export const FORMS: FormDef[] = [
  {
    id: "registrations", title: "Registrations and approvals", noun: "register", stored: true, single: true,
    blurb: "What the firm and the people in it must be registered, approved or cleared for, with the date and the next one due. This records what you tell it: check each item with ACCA, Companies House or HMRC, and keep the evidence outside the planner.",
    seed: () => ({ items: [{"item": "ACCA supervision for AML", "what": "The firm is supervised by ACCA for AML purposes. Keep the firm's ACCA registration number and renewal date here.", "status": "", "ref": "", "on": "", "next": "", "notes": ""}, {"item": "Owners, officers and managers (BOOMs) cleared by ACCA", "what": "Every beneficial owner, officer and manager of the firm must be a fit and proper person, which includes a criminality check. List each person in the table below and keep the evidence. Ask ACCA what it needs if anyone does not hold an ACCA practising certificate.", "status": "", "ref": "", "on": "", "next": "", "notes": ""}, {"item": "ACCA annual AML return", "what": "Completed every year through ACCA, with the current risk assessment and policy uploaded. Record the date ACCA gives you. The ACCA return tab here prepares the answers.", "status": "", "ref": "", "on": "", "next": "", "notes": ""}, {"item": "Trust or company service provider (TCSP) work", "what": "Company formation, a registered office address, acting as director or secretary, nominee services and trustee work. A firm already supervised by ACCA does not register with HMRC for this: ACCA supervises it and the firm reports volumes in the annual return.", "status": "", "ref": "", "on": "", "next": "", "notes": ""}, {"item": "Companies House authorised corporate service provider (ACSP)", "what": "Needed to file for clients as an agent once Companies House requires it, and to verify identities for Companies House. The firm must be AML supervised and the person registering must verify their own identity first. Check the current date and rules on GOV.UK.", "status": "", "ref": "", "on": "", "next": "", "notes": ""}, {"item": "Own identity verified with Companies House", "what": "Each director or person with significant control of the firm must verify their identity with Companies House. Record the date and the personal code reference, not the code itself.", "status": "", "ref": "", "on": "", "next": "", "notes": ""}, {"item": "NCA SAR Portal registration", "what": "Needed before the firm can send a suspicious activity report or a request for consent online. Register before a report is needed.", "status": "", "ref": "", "on": "", "next": "", "notes": ""}, {"item": "HMRC Trust Registration Service", "what": "Only if the firm acts for trusts. Record who registers and updates each trust and where the proof is kept.", "status": "", "ref": "", "on": "", "next": "", "notes": ""}], ids: [{ who: "", on: "", method: "", where: "", until: "" }] }),
    sections: [
      { title: "Registrations and approvals", fields: [{ k: "items", label: "Items", type: "table", blank: 1, cols: [{ k: "item", label: "Item" }, { k: "what", label: "What it is and why it matters" }, { k: "status", label: "Status", type: "one", options: ["Done", "In progress", "Not done", "Not sure", "Not needed"] }, { k: "ref", label: "Reference" }, { k: "on", label: "Date", type: "date" }, { k: "next", label: "Next due", type: "date" }, { k: "notes", label: "Notes" }] }] },
      { title: "Owners, officers and managers (BOOMs)", intro: "Anyone who owns, controls or manages the firm. ACCA's annual return asks for the names of any who do not hold an ACCA practising certificate.", fields: [{ k: "booms", label: "People", type: "table", blank: 1, cols: [{ k: "who", label: "Name" }, { k: "role", label: "Role" }, { k: "pc", label: "ACCA practising certificate", type: "one", options: ["Yes", "No"] }, { k: "evidence", label: "Approval or criminality check, and where the evidence is" }, { k: "on", label: "Date", type: "date" }, { k: "next", label: "Next check", type: "date" }] }] },
      { title: "Companies House register discrepancies reported", intro: "When what you find about a company's ownership or control materially differs from the Companies House register, the discrepancy must be reported. Record each one.", fields: [{ k: "disc", label: "Reports", type: "table", blank: 1, cols: [{ k: "client", label: "Client", type: "client" }, { k: "found", label: "Date found", type: "date" }, { k: "what", label: "What differs" }, { k: "reported", label: "Date reported", type: "date" }, { k: "ref", label: "Reference or outcome" }] }] },
      { title: "Identity checks done for Companies House", intro: "If the firm verifies identities as an authorised corporate service provider, the records of each check, including copies of the documents, must be kept for seven years.", fields: [{ k: "ids", label: "Checks", type: "table", blank: 1, cols: [{ k: "who", label: "Person" }, { k: "on", label: "Date checked", type: "date" }, { k: "method", label: "How it was checked" }, { k: "where", label: "Where the evidence is kept" }, { k: "until", label: "Keep until", type: "date" }] }] },
    ],
  },
  {
    id: "annualreturn", title: "ACCA annual AML return", noun: "return", stored: true, reviewKey: "next",
    blurb: "A worksheet for ACCA's annual AML return (the 2026/27 questions). Where the planner has the figure it shows it beside the question so you can use it after checking it. The return itself is completed on ACCA's site.",
    sections: [
      { title: "Firm and individual", fields: [{ k: "firmNo", label: "ACCA firm registration number", type: "text" }, { k: "tradingYear", label: "Has the firm been trading for more than 12 months?", type: "one", options: ["Yes", "No"] }, { k: "mlro", label: "MLRO name", type: "text" }, { k: "mlroContact", label: "MLRO email and phone", type: "text" }, { k: "boomNon", label: "Does the firm have any BOOMs who are not ACCA practising certificate holders?", type: "one", options: ["Yes", "No"] }, { k: "boomNames", label: "Their names", type: "long" }] },
      { title: "Clients and staff", intro: "ACCA's return asks for bands. Enter the figure and choose the matching band on ACCA's form.", fields: [{ k: "staff", label: "Additional partners, directors, employees and subcontractors", type: "text" }, { k: "revenue", label: "Total revenue for the last financial year", type: "text" }, { k: "clients12", label: "Clients served in the past 12 months", type: "text" }, { k: "big15", label: "Clients representing more than 15% of total revenue", type: "text" }] },
      { title: "Client categories", intro: "Approximate number of clients in each category.", fields: [{ k: "c_cash", label: "Cash-based businesses", type: "text" }, { k: "c_hv", label: "High-value dealers", type: "text" }, { k: "c_prop", label: "Properties", type: "text" }, { k: "c_imp", label: "Import and export", type: "text" }, { k: "c_msb", label: "Money service businesses", type: "text" }, { k: "c_crypto", label: "Cryptocurrency", type: "text" }, { k: "c_visa", label: "Visa and immigration services", type: "text" }, { k: "c_inv", label: "Investment services", type: "text" }, { k: "c_char", label: "Charities", type: "text" }, { k: "c_metal", label: "Precious metals", type: "text" }, { k: "c_wealthy", label: "Wealthy individuals", type: "text" }, { k: "c_big", label: "Clients with annual revenue over \u00a310 million", type: "text" }, { k: "c_pep", label: "Politically exposed persons (including by association)", type: "text" }] },
      { title: "Higher-risk indicators", fields: [{ k: "convicted", label: "Existing clients convicted of a financial-related crime or on a sanctions list?", type: "one", options: ["Yes", "No"] }, { k: "convictedWhat", label: "Details", type: "long" }, { k: "overseas", label: "Clients predominantly based outside the UK", type: "text" }, { k: "hrtc", label: "Clients associated with HM Treasury's high-risk third countries", type: "text" }, { k: "sars", label: "Suspicious activity reports filed with the NCA in the past two years, including consent requests", type: "text", hint: "Aggregate counts only. Do not record details of any report here." }, { k: "isars", label: "Internal reports escalated to and documented by the MLRO in the past two years", type: "text", hint: "Aggregate counts only." }, { k: "money", label: "Held client money, securities or other assets in the past two years?", type: "one", options: ["Yes", "No"] }, { k: "moneyWhy", label: "Main reason", type: "one", options: ["HMRC refunds", "Payroll processing", "Probate and estate", "Investments", "Other"] }, { k: "payroll", label: "Clients provided payroll services in the past two years", type: "text" }] },
      { title: "Company and trust services", fields: [{ k: "reg", label: "Provides a registered office address to clients", type: "one", options: ["Yes", "No"] }, { k: "regN", label: "Clients given a registered office address in the past two years", type: "text" }, { k: "trustf", label: "Offers trust formation services", type: "one", options: ["Yes", "No"] }, { k: "trustfN", label: "Clients given trust formation services in the past two years", type: "text" }, { k: "dir", label: "Arranges or acts as director or secretary for clients", type: "one", options: ["Yes", "No"] }, { k: "dirN", label: "Clients arranged or acted for as director or secretary in the past two years", type: "text" }, { k: "trustee", label: "Acts as trustee for clients", type: "one", options: ["Yes", "No"] }, { k: "trusteeN", label: "Clients acted for as trustee in the past two years", type: "text" }, { k: "form", label: "Offers company formation services", type: "one", options: ["Yes", "No"] }, { k: "formN", label: "Clients given company formation services in the past two years", type: "text" }] },
      { title: "Controls and legal requirements", fields: [{ k: "fwra", label: "Has the MLRO conducted and documented a firm-wide risk assessment?", type: "one", options: ["Yes, updated periodically", "Yes, conducted once", "No"] }, { k: "pol", label: "Does the firm have documented AML policies and procedures?", type: "one", options: ["Yes, updated periodically", "Yes, conducted once", "No"] }, { k: "portal", label: "Registered with the NCA online SAR system?", type: "one", options: ["Yes", "No"] }, { k: "train", label: "Has AML training been provided to all relevant employees?", type: "text", hint: "Choose the matching option on ACCA's form" }, { k: "pf", label: "Has the MLRO conducted and documented a proliferation financing risk assessment?", type: "one", options: ["Yes, updated periodically", "Yes, conducted once", "No"] }, { k: "report", label: "Has the MLRO produced a written report on the operation and effectiveness of AML systems and controls?", type: "one", options: ["Yes, updated periodically", "Yes, conducted once", "No"] }, { k: "mlroTrain", label: "Has the MLRO completed formal AML training in the past two years?", type: "one", options: ["Yes", "No"] }, { k: "reporting", label: "Is there a formal process for employees to report suspicious activity to the MLRO?", type: "one", options: ["Yes", "No"] }, { k: "onboard", label: "Information and evidence obtained when onboarding clients", type: "many", options: ["Proof of identification", "Proof of address", "Source of wealth and/or source of funds", "Company structure", "PSC Register check", "Electronic verification", "Adverse media checks", "None of the above"] }, { k: "monitor", label: "Frequency of ongoing client monitoring", type: "one", options: ["6-12 months", "1-2 years", "2-5 years", "Updated only when notified", "Varies by risk", "Review at onboarding only"] }, { k: "categorise", label: "Does the firm categorise clients by risk level?", type: "one", options: ["Yes", "No"] }, { k: "highPct", label: "Approximate percentage of high-risk clients", type: "text" }, { k: "lowPct", label: "Approximate percentage of low-risk clients", type: "text" }, { k: "independent", label: "Does the firm conduct and document an independent assessment of its AML controls?", type: "one", options: ["Yes", "No"] }] },
      { title: "Documents and submission", fields: [info("uploads", "ACCA asks for the current firm-wide risk assessment and the current AML policy and procedures to be uploaded. Export them from the Risk assessment and Policies tabs."), date("submitted", "Date submitted to ACCA"), text("by", "Submitted by"), date("next", "Next return due")] },
    ],
  },
  {
    id: "reviews", title: "Ongoing client reviews", noun: "review", stored: true, reviewKey: "next",
    blurb: "One record for each periodic review of a client: are the facts still true, have the checks been refreshed, has the risk changed. Proposed intervals: high risk every six months, medium every year, low every two years.",
    sections: [
      {
        title: "Ongoing client review",
        fields: [
          { k: "client", label: "Client", type: "client" }, date("on", "Review date"), text("reviewer", "Reviewer"), text("rating", "Risk rating and last review date"),
          {
            k: "q", label: "Review questions", type: "grid", options: ["Yes", "No"], noteLabel: "Explain, with evidence and dates",
            items: [
              "Services and expected activity still accurate?", "Identity, address, ownership, directors and PSC current?", "Geography, PEP, sanctions and adverse information rechecked?",
              "Transactions and accounts consistent with the expected profile?", "Source of funds or wealth, or an EDD refresh, needed?", "New service, payment authority, or client money or assets?",
              "Any suspicion? (If yes, use the restricted SAR process. Do not describe it here.)",
            ],
          },
          one("newRating", "Updated client risk rating", LMH), long("decision", "Decision, actions and next review"), date("next", "Next review date"), text("approval", "Approval (MLRO)"),
        ],
      },
    ],
  },
  {
    id: "screening", title: "Sanctions and PEP screening", noun: "check", stored: true,
    blurb: "A record of each sanctions, PEP or adverse-media check: what was searched, where, and what was decided about any match.",
    sections: [
      {
        title: "Screening record",
        fields: [
          { k: "client", label: "Client", type: "client" }, text("who", "Person or entity checked"), text("role", "Role or relationship", "Client, beneficial owner, controller, other"), date("on", "Date checked"),
          text("source", "Source or tool", "UK Sanctions List, screening provider, PEP or adverse-media source"), long("terms", "Search terms and identifiers used", "Name, date of birth, nationality, company number"),
          one("result", "Result", ["No match", "Possible match", "Confirmed match", "Further review"]), long("resolution", "Review and match resolution", "Evidence, rationale, a second reviewer if available"),
          long("escalation", "Escalation or action", "Pause affected work where legally required; consider OFSI, NCA and supervisor obligations"), text("by", "Reviewed by"), text("trigger", "Next review trigger", "A scheduled date or an event"),
        ],
      },
    ],
  },
  {
    id: "training", title: "Training and learning record", noun: "record", stored: true, single: true,
    blurb: "Formal AML training for the MLRO and anyone who joins. Reading the policy alone is not formal training: record the course, the date and the result.",
    seed: () => ({ people: [{ person: "Kevin Bannister", course: "", on: "", result: "", file: "", next: "" }] }),
    sections: [
      { title: "Training record", fields: [{ k: "people", label: "People", type: "table", blank: 2, cols: [{ k: "person", label: "Person" }, { k: "course", label: "Course or provider, and topics" }, { k: "on", label: "Date", type: "date" }, { k: "result", label: "Assessment or result" }, { k: "file", label: "Certificate location" }, { k: "next", label: "Next refresher", type: "date" }] }] },
      { title: "MLRO check", fields: [one("twoYears", "MLRO formal AML training in the past two years?", ["Yes", "No", "Verify"]), text("evidence", "Evidence reference", "Certificate or provider record"), long("refresh", "Topics needing refresh"), text("completed", "Completed by and date")] },
    ],
  },
  {
    id: "actions", title: "AML actions and evidence register", noun: "register", stored: true, single: true,
    blurb: "What the firm still has to do to have the AML controls in place. Mark an action done only when there is evidence, and record where the evidence is.",
    seed: () => ({
      actions: [
        ["A1", "Complete and approve the firm-wide risk assessment, including proliferation financing", "MLRO"], ["A2", "Approve and implement the AML policies and procedures", "Director / MLRO"],
        ["A3", "Reconcile client risk and CDD files", "MLRO"], ["A4", "Confirm NCA SAR Portal registration", "MLRO"], ["A5", "Obtain formal AML training evidence", "MLRO"], ["A6", "Appoint an independent reviewer and complete the review", "Director"],
      ].map(([ref, action, owner]) => ({ ref, action, owner, due: "", status: "Open", evidence: "" })),
    }),
    sections: [
      {
        title: "Actions",
        intro: "Update the status only when evidence is available. Do not put suspicious activity details in this general register.",
        fields: [{ k: "actions", label: "Actions", type: "table", blank: 3, cols: [{ k: "ref", label: "Ref" }, { k: "action", label: "Action or control" }, { k: "owner", label: "Owner" }, { k: "due", label: "Due date", type: "date" }, { k: "status", label: "Status", type: "one", options: ["Open", "In progress", "Done"] }, { k: "evidence", label: "Evidence or closure" }] }],
      },
    ],
  },
  {
    id: "mlro", title: "MLRO annual report", noun: "report", stored: true, reviewKey: "nextReport",
    blurb: "ACCA's template for the MLRO's yearly report on how well the AML controls worked. Required when the firm has relevant employees; for a firm without them it is good practice and ACCA can still ask for it. A blank report is not evidence that a review took place.",
    seed: () => ({ preparedBy: "Kevin Bannister (ACCA 1543478)" }),
    sections: [
      { title: "The report", fields: [text("period", "Compliance period", "From and to"), text("preparedBy", "MLRO"), date("prepared", "Date"), date("nextReport", "Date of next report")] },
      { title: "1. MLRO", fields: [{ k: "q0", label: "Questions", type: "grid", options: ["Yes", "No"], noteLabel: "Details", items: ["Has there been a change in the identity of the MLRO within this period?", "Have all staff been reminded of the identity of the MLRO?", "Have all staff been reminded of the responsibilities of the MLRO?", "Has the MLRO completed any specific AML training within this period?", "Has the MLRO kept up to date with money-laundering risks and trends?", "Does the MLRO have the time, capacity and resources to fulfil their obligations?"] }, long("sum0", "Summary")] },
      { title: "2. Firm-wide risk assessment (FWRA)", fields: [{ k: "q1", label: "Questions", type: "grid", options: ["Yes", "No"], noteLabel: "Details", items: ["Is the FWRA still relevant and up to date?", "Have any new risks been identified?", "Have actions been taken to mitigate these risks?", "Has the FWRA been shared with relevant stakeholders, for example directors or partners?"] }, long("sum1", "Summary")] },
      { title: "3. AML policy and procedures (P&Ps)", fields: [{ k: "q2", label: "Questions", type: "grid", options: ["Yes", "No"], noteLabel: "Details", items: ["Are the P&Ps relevant and up to date?", "Have any changes been made to the P&Ps?", "Have employees, including new members of staff, confirmed they have read and understood the P&Ps?", "Do employees know where the P&Ps are kept?", "Do the P&Ps cover due diligence, firm-wide risk assessment, client risk assessment, training, record keeping, suspicious activity reports, ongoing monitoring, sanctions screening, the MLRO report and independent assessments?", "Have any new systems or processes been incorporated into the P&Ps?", "Has any new or updated legislation or guidance been incorporated into the P&Ps?", "Is it documented that the P&Ps have been reviewed and approved by the MLRO?", "Is it documented when the P&Ps will next be reviewed?"] }, long("sum2", "Summary")] },
      { title: "4. Customer due diligence (CDD)", fields: [{ k: "q3", label: "Questions", type: "grid", options: ["Yes", "No"], noteLabel: "Details", items: ["Is the CDD process still relevant?", "Have there been any changes to the CDD process?", "Have any new clients been declined because of unsatisfactory information?"] }, long("sum3", "Summary")] },
      { title: "5. Sample check of CDD files", fields: [{ k: "q4", label: "Questions", type: "grid", options: ["Yes", "No"], noteLabel: "Details", items: ["Do the CDD files contain all relevant information and documentation as per the CDD process?", "Is all information relevant and up to date (for example identification still valid, records match Companies House, all ultimate beneficial owners and directors identified)?", "Is the risk rating of each client appropriate?", "Have any process improvements been identified?", "Have any training needs been identified?"] }, long("sum4", "Summary")] },
      { title: "6. Client risk assessment", fields: [{ k: "q5", label: "Questions", type: "grid", options: ["Yes", "No"], noteLabel: "Details", items: ["Is the client risk assessment process still relevant and up to date?", "Have there been any changes to the client risk assessment?", "Have any new clients been categorised as high risk?", "Has the risk rating of any existing clients changed?", "Have any new trends or risks been considered and applied to the client risk assessment process?"] }, long("sum5", "Summary")] },
      { title: "7. Suspicious activity report (SAR)", fields: [{ k: "q6", label: "Questions", type: "grid", options: ["Yes", "No"], noteLabel: "Details", items: ["Is the current internal SAR process relevant and up to date?", "Have all staff, including new joiners, been reminded of the SAR process?", "Have any internal SARs been received?", "If none have been received, is the MLRO satisfied with the training provided to staff regarding suspicious activity?", "Has the MLRO submitted any SARs to the National Crime Agency?"] }, long("sum6", "Summary")] },
      { title: "8. AML training", fields: [{ k: "q7", label: "Questions", type: "grid", options: ["Yes", "No"], noteLabel: "Details", items: ["Is the current AML training programme up to date and relevant?", "Have all new staff received AML training?", "Have all relevant staff received AML training within the past 12 months?", "Has evidence of AML training completion and understanding been obtained for all relevant staff?", "Have there been any issues identified within the AML training programme?", "Does the training programme cover red flags, relevant AML regulations, tipping off, CDD, SARs, how to deal with suspicious transactions and new trends and risks?"] }, long("sum7", "Summary")] },
      { title: "9. Sanctions screening", fields: [{ k: "q8", label: "Questions", type: "grid", options: ["Yes", "No"], noteLabel: "Details", items: ["Is the current sanctions screening process relevant and up to date?", "Have there been any positive matches from the completed sanctions screening?"] }, long("sum8", "Summary")] },
      { title: "10. Control assurance", fields: [{ k: "q9", label: "Questions", type: "grid", options: ["Yes", "No"], noteLabel: "Details", items: ["Has an independent audit of the firm's AML controls been completed?", "Were there any adverse findings from the report?", "Is an independent audit going to be completed periodically?"] }, long("sum9", "Summary")] },
      { title: "11. Record keeping", fields: [{ k: "q10", label: "Questions", type: "grid", options: ["Yes", "No"], noteLabel: "Details", items: ["Is the firm's record-keeping process still relevant and up to date?", "Are records easily accessible?", "Have records been kept for the appropriate period of time?"] }, long("sum10", "Summary")] },
      { title: "12. MLRO summary", fields: [info("g12", "The executive summary for the compliance period, highlighting any serious compliance deficiencies, together with remedial actions and any additional action points."), long("summary", "Executive summary")] },
      { title: "Sign-off", fields: [text("signed", "Signed and date", "Complete after the report has genuinely been carried out"), { k: "directors", label: "Report read and understood by directors or partners", type: "table", blank: 2, cols: [{ k: "name", label: "Name" }, { k: "date", label: "Date", type: "date" }] }] },
    ],
  },
  {
    id: "independent", title: "Independent AML controls review", noun: "review", stored: true, reviewKey: "followUp",
    blurb: "A competent person who is independent of the controls tested reviews them. The MLRO must not sign as the independent reviewer.",
    sections: [
      {
        title: "The review",
        intro: "The reviewer must be competent and independent of the controls tested. With one person in the practice, appoint someone separate.",
        fields: [text("reviewer", "Reviewer name or firm"), long("independence", "Competence and independence statement", "Describe AML experience and confirm no responsibility for the controls reviewed"), text("period", "Review period and date"), long("scope", "Scope and method", "File sample, interviews, document review, control testing"), long("sample", "Sample details", "Client files, size, selection method")],
      },
      {
        title: "What was checked",
        fields: [{
          k: "checks", label: "Checks", type: "grid", options: YNN, noteLabel: "Evidence or notes",
          items: [
            "FWRA current, approved and tailored", "AML policies and procedures current, approved and aligned to the FWRA", "Client onboarding and risk rating evidence complete", "CDD and beneficial ownership checks evidenced",
            "EDD applied and recorded when needed", "Ongoing monitoring and sanctions checks evidenced", "SAR arrangements, confidentiality and records effective", "Training completed and evidenced", "Retention and file access controls appropriate", "Actions from the prior review closed or tracked",
          ],
        }],
      },
      { title: "Findings", fields: [{ k: "findings", label: "Findings", type: "table", blank: 3, cols: [{ k: "finding", label: "Finding or test" }, { k: "evidence", label: "Evidence examined" }, { k: "risk", label: "Risk or impact" }, { k: "action", label: "Action, owner and due date" }] }] },
      { title: "Conclusion and sign-off", fields: [one("opinion", "Overall opinion", ["Effective", "Partially effective", "Not effective", "Unable to conclude"]), text("signed", "Reviewer signature and date"), long("response", "Management response and approval"), date("followUp", "Follow-up date")] },
    ],
  },
  // ---- printed blank only
  {
    id: "sar1", title: "Form 1: Internal suspicious activity report", noun: "form", stored: false, restricted: true,
    blurb: "For anyone in the firm to report a suspicion to the MLRO. Print it blank and keep completed forms in a restricted place: they are not stored in the planner.",
    sections: [{
      title: "Internal suspicious activity report",
      intro: "Submit promptly and confidentially to the MLRO. Do not investigate beyond your authority or discuss the disclosure with the client. In this firm the sole practitioner is also the MLRO: document personal suspicions directly using Form 2.",
      fields: [text("a", "Reporter name and role"), text("b", "Date and time of disclosure"), text("c", "Client or subject"), text("d", "Relevant account, transaction or service"), long("e", "What happened and when?", "Objective facts; separate facts from assumptions"), long("f", "Why is it suspicious?", "Explain indicators and context"), long("g", "People, entities and locations involved"), text("h", "Amounts, dates, references"), long("i", "Documents and records available", "List; attach securely"), text("j", "Urgent deadline or proposed act", "State if action is pending"), text("k", "Reporter signature and date")],
    }],
  },
  {
    id: "sar2", title: "Form 2: MLRO decision and external reporting record", noun: "form", stored: false, restricted: true,
    blurb: "The MLRO's decision on an internal report and any external SAR or DAML request. Print blank; keep completed forms and the register restricted.",
    sections: [
      {
        title: "MLRO decision and external reporting record",
        intro: "Maintain a separate restricted register of internal disclosures, decisions, external SARs and DAML requests. Record only aggregate counts for the ACCA annual return, without disclosing confidential details in general files.",
        fields: [text("a", "Internal report reference", "Restricted unique ID"), text("b", "Date received or identified"), long("c", "Information reviewed", "List sources"), long("d", "Assessment and rationale"), one("e", "Decision", ["External SAR", "DAML request", "No external SAR", "Further information needed"]), long("f", "Reason and legal considerations", "Seek advice if uncertain"), one("g", "NCA SAR Portal account registered", ["Yes", "No", "Verify"]), text("h", "Submission date and NCA reference", "Restricted"), long("i", "DAML decision, notice and timing", "Record dates and do not act until permitted"), long("j", "Client or service action taken", "Record without disclosing the SAR"), text("k", "Confidentiality and access controls", "Who can access?"), text("l", "MLRO signature and date"), text("m", "Review or closure date")],
      },
      { title: "Confidential SAR register", fields: [{ k: "reg", label: "Register", type: "table", blank: 4, cols: [{ k: "ref", label: "Internal ref" }, { k: "on", label: "Date" }, { k: "client", label: "Client code" }, { k: "decision", label: "Decision" }, { k: "ext", label: "External SAR or DAML ref" }, { k: "status", label: "Status or closure" }] }] },
    ],
  },
  {
    id: "onboarding", title: "Client onboarding and risk form", noun: "form", stored: false,
    blurb: "A blank copy of the onboarding form. A client's live onboarding and risk assessment is on the client's own AML tab, which this pack does not duplicate.",
    sections: [
      {
        title: "A. Engagement and client details",
        fields: [text("a1", "Client or entity legal name"), text("a2", "Trading name"), text("a3", "Company number and entity type"), text("a4", "Registered and operating address"), text("a5", "Main contact and role"), { k: "a6", label: "Services requested", type: "many", options: ["Bookkeeping", "Accounts", "Tax", "Payroll", "Company secretarial", "Company formation"] }, text("a7", "Engagement purpose and expected start"), text("a8", "Expected activity and transaction profile"), text("a9", "Countries connected to the client, owners or activity"), text("a10", "Prepared by and date")],
      },
      {
        title: "B. Identity, ownership and authority checks",
        fields: [{
          k: "b", label: "Checks", type: "grid", options: YNN, noteLabel: "Evidence and notes",
          items: ["Client identity and address verified", "Entity existence and registered details checked", "Directors and persons acting for the client identified", "Beneficial owners and control identified and verified", "PSC information checked; discrepancies resolved", "Purpose, nature and expected activity understood", "PEP, sanctions and adverse-media checks completed", "Source of funds or wealth considered where appropriate"],
        }],
      },
      {
        title: "C. Client risk assessment",
        intro: "Record actual factors, not just a score. A high-risk factor may require EDD. A low-risk rating must be exceptional and justified. Client risk is separate from suspicion.",
        fields: [
          { k: "c", label: "Factors", type: "grid", options: LMH, noteLabel: "Evidence and effect on rating", items: ["Client and service sector", "Countries and geographic exposure", "Ownership, control and transparency", "Transactions and source or use of funds", "Delivery channel and non-face-to-face factors", "PEP, sanctions or adverse information", "Company formation, payroll or company secretarial exposure", "Other relevant ML, TF or PF indicators"] },
          one("c1", "Overall rating", LMH), long("c2", "Rationale", "Explain the client's inherent risk and why the final rating is appropriate"), one("c3", "CDD decision", ["Standard CDD", "EDD", "SDD (legal basis and rationale required)"]), long("c4", "Additional information and actions"), one("c5", "Acceptance decision", ["Accept", "Decline", "Pending"]), text("c6", "Approved by and date"), text("c7", "Initial review date", "Proposed: high 6 months, medium 12 months, low 24 months"),
        ],
      },
      {
        title: "D. EDD record (complete for high risk)",
        fields: [{ k: "d", label: "EDD", type: "grid", options: YNN, noteLabel: "Evidence or notes", items: ["Additional identity or ownership evidence obtained", "Source of funds or wealth established where relevant", "Purpose and expected activity examined in more depth", "Senior approval documented", "Enhanced monitoring frequency set", "Other measures tailored to the identified risk"] }, long("d1", "EDD rationale and evidence"), text("d2", "EDD approval (MLRO signature and date)")],
      },
      { title: "E. Review record", fields: [{ k: "e", label: "Reviews", type: "table", blank: 3, cols: [{ k: "on", label: "Review date" }, { k: "trigger", label: "Trigger or scheduled" }, { k: "cdd", label: "CDD refreshed and screening" }, { k: "outcome", label: "Risk rating or outcome" }, { k: "by", label: "Reviewer" }] }] },
      { title: "F. Data handling", fields: [info("f", "Store this form and the supporting verification evidence in the client's AML file with restricted access. Record the retention end date under the AML policy. Do not place SAR or DAML information in this form or in the client file.")] },
    ],
  },
];
export const formById = (id: string) => FORMS.find((f) => f.id === id);

// ------------------------------------------------------------------ records

export const newRec = (def: FormDef, today: string, copyOf?: Rec): Rec => ({
  id: `${def.id}-${Date.now().toString(36)}`, created: today, status: "Draft",
  values: copyOf ? JSON.parse(JSON.stringify(copyOf.values)) : (def.seed ? def.seed() : {}),
});
export const readStore = (v: unknown): Store => ({ records: Array.isArray((v as Store | undefined)?.records) ? (v as Store).records : [] });
export const settingKey = (id: string) => `aml.${id}`;

export type Standing = "none" | "draft" | "overdue" | "soon" | "ok";
/** Where a form stands: nothing yet, not approved, review overdue, review soon, or in date. */
export function standing(def: FormDef, store: Store, today: string): { state: Standing; text: string; latest?: Rec } {
  const latest = [...store.records].sort((a, b) => b.created.localeCompare(a.created))[0];
  if (!latest) return { state: "none", text: "Not started" };
  if (def.single) return { state: "ok", text: "Started", latest };
  const key = def.reviewKey;
  const due = key ? String(latest.values[key] || "") : "";
  if (latest.status !== "Approved") return { state: "draft", text: "Draft, not approved", latest };
  if (!due) return { state: "ok", text: "Approved", latest };
  const days = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (days < 0) return { state: "overdue", text: `Review overdue since ${due}`, latest };
  if (days <= 30) return { state: "soon", text: `Review due ${due}`, latest };
  return { state: "ok", text: `Approved, next review ${due}`, latest };
}

// ------------------------------------------------------------------ the document: one description, written out as Word or as a print page

export type Block =
  | { t: "h"; text: string; level: 1 | 2 }
  | { t: "p"; text: string; bold?: boolean; small?: boolean }
  | { t: "bullets"; items: string[] }
  | { t: "kv"; rows: [string, string][] }
  | { t: "table"; head: string[]; rows: string[][] };
export type Meta = { firm: string; title: string; status: string; date: string; restricted?: boolean; blank?: boolean; today: string };

const box = (on: boolean) => (on ? "☒" : "☐");
const ticks = (options: string[], chosen: string[]) => options.map((o) => `${box(chosen.includes(o))} ${o}`).join("   ");
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const rowsOf = (v: unknown): Record<string, string>[] => (Array.isArray(v) ? (v as Record<string, string>[]) : []);
const fmtD = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : d);

/** Free text as paragraphs and bullet lists. */
export function flow(textIn: string): Block[] {
  const out: Block[] = [];
  let bullets: string[] = [];
  const flush = () => { if (bullets.length) out.push({ t: "bullets", items: bullets }), (bullets = []); };
  for (const raw of textIn.split(/\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const b = /^[-•*]\s+(.*)$/.exec(line);
    if (b) bullets.push(b[1]);
    else { flush(); out.push({ t: "p", text: line }); }
  }
  flush();
  return out;
}

export function blocks(def: FormDef, values: Values, clientName: (k: string) => string, blank: boolean): Block[] {
  const out: Block[] = [];
  const val = (k: string) => (blank ? undefined : values[k]);
  for (const s of def.sections) {
    out.push({ t: "h", text: s.title, level: 2 });
    if (s.intro) out.push({ t: "p", text: s.intro, small: true });
    const kv: [string, string][] = [];
    const flushKv = () => { if (kv.length) out.push({ t: "kv", rows: kv.splice(0) }); };
    for (const f of s.fields) {
      if (f.type === "info") { flushKv(); out.push({ t: "p", text: f.label, small: true }); continue; }
      if (f.type === "long" && f.flow) { flushKv(); out.push(...flow(str(val(f.k)))); if (blank) out.push({ t: "p", text: " " }); continue; }
      if (f.type === "table") {
        flushKv();
        const have = rowsOf(val(f.k)).map((r) => f.cols.map((c) => (c.type === "date" ? fmtD(str(r[c.k])) : c.type === "one" && c.options ? ticks(c.options, asList(r[c.k])) : c.type === "client" ? clientName(str(r[c.k])) : str(r[c.k]))));
        const pad = Math.max(0, (blank ? f.blank : Math.min(f.blank, 2)) - have.length);
        out.push({ t: "table", head: f.cols.map((c) => c.label), rows: [...have, ...Array.from({ length: pad }, () => f.cols.map(() => ""))] });
        continue;
      }
      if (f.type === "grid") {
        flushKv();
        const g = (val(f.k) || {}) as Record<string, { c?: string[] | string; n?: string }>;
        out.push({ t: "table", head: [f.label, "Status", f.noteLabel], rows: f.items.map((it, i) => [it, ticks(f.options, asList(g[i]?.c)), str(g[i]?.n)]) });
        continue;
      }
      const v = val(f.k);
      const shown = f.type === "one" || f.type === "many" ? ticks(f.options, asList(v)) : f.type === "date" ? fmtD(str(v)) : f.type === "client" ? clientName(str(v)) : str(v);
      kv.push([f.label, shown]);
    }
    flushKv();
  }
  return out;
}

export function docBlocks(def: FormDef, rec: Rec | undefined, meta: Meta, clientName: (k: string) => string): Block[] {
  const blank = !rec || !!meta.blank;
  const head: Block[] = [{ t: "p", text: def.blurb, small: true }];
  if (meta.restricted) head.push({ t: "p", text: "RESTRICTED. Keep completed copies in a restricted place. Do not store them in a general client or staff file.", bold: true });
  if (!blank) head.push({ t: "p", text: `${rec!.status === "Approved" ? "Approved" : "Draft for completion and approval"}. Dated ${fmtD(rec!.created)}.`, small: true });
  else head.push({ t: "p", text: "Blank form. Complete, check against the firm's records, approve and put the controls into operation before relying on it as evidence.", small: true });
  return [...head, ...blocks(def, rec?.values || {}, clientName, blank)];
}

// ------------------------------------------------------------------ Word

const esc = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const runs = (s: string, o: { bold?: boolean; size?: number; color?: string } = {}) =>
  s.split("\n").map((l, i) => `${i ? "<w:r><w:br/></w:r>" : ""}<w:r><w:rPr>${o.bold ? "<w:b/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}${o.size ? `<w:sz w:val="${o.size}"/>` : ""}</w:rPr><w:t xml:space="preserve">${esc(l)}</w:t></w:r>`).join("");
const para = (s: string, o: { style?: string; bold?: boolean; size?: number; color?: string; after?: number; keep?: boolean } = {}) =>
  `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ""}${o.keep ? "<w:keepNext/>" : ""}${o.after !== undefined ? `<w:spacing w:after="${o.after}"/>` : ""}</w:pPr>${runs(s, o)}</w:p>`;
const BORDER = ["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="9DB4C8"/>`).join("");
function table(widths: number[], head: string[] | undefined, rows: string[][], shadeFirst: boolean): string {
  const cell = (t: string, w: number, h: boolean, shade: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${h ? '<w:shd w:val="clear" w:color="auto" w:fill="12304F"/>' : shade ? '<w:shd w:val="clear" w:color="auto" w:fill="EAF4FA"/>' : ""}</w:tcPr>${(t || " ").split("\n").map((l) => `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>${runs(l || " ", { bold: h, color: h ? "FFFFFF" : undefined, size: 19 })}</w:p>`).join("")}</w:tc>`;
  const tr = (cells: string[], h: boolean) => `<w:tr><w:trPr><w:cantSplit/>${h ? "<w:tblHeader/>" : ""}${!h && cells.every((c) => !c.trim()) ? '<w:trHeight w:val="560" w:hRule="atLeast"/>' : ""}</w:trPr>${cells.map((c, i) => cell(c, widths[i], h, !h && shadeFirst && i === 0)).join("")}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${BORDER}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${head ? tr(head, true) : ""}${rows.map((r) => tr(r, false)).join("")}</w:tbl>${para("", { after: 80 })}`;
}
const split = (total: number, n: number, first = 0): number[] => {
  const w = first ? [first, ...Array.from({ length: n - 1 }, () => Math.floor((total - first) / (n - 1)))] : Array.from({ length: n }, () => Math.floor(total / n));
  w[w.length - 1] += total - w.reduce((a, b) => a + b, 0);
  return w;
};

/** Column widths that follow how much each column holds, so a date or a reference isn't as wide as a description. */
const weighted = (total: number, head: string[], rows: string[][]): number[] => {
  const w = head.map((h, i) => Math.min(42, Math.max(10, ...rows.map((r) => (r[i] || "").length), Math.min(h.length, 16))));
  const sum = w.reduce((a, b) => a + b, 0);
  const out = w.map((x) => Math.floor((x / sum) * total));
  out[out.length - 1] += total - out.reduce((a, b) => a + b, 0);
  return out;
};

export async function toDocx(list: Block[], meta: Meta): Promise<Uint8Array> {
  const landscape = list.some((b) => b.t === "table" && b.head.length >= 6);
  const total = landscape ? 14400 : 9900;
  let body = para(meta.firm, { size: 18, color: "5F6F86", after: 40 }) + para(meta.title, { style: "Title" });
  for (const b of list) {
    if (b.t === "h") body += para(b.text, { style: b.level === 1 ? "Heading1" : "Heading2", keep: true });
    else if (b.t === "p") body += para(b.text, { bold: b.bold, size: b.small ? 19 : undefined, color: b.small ? "44546A" : undefined, after: 100 });
    else if (b.t === "bullets") body += b.items.map((i) => `<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr>${runs(i)}</w:p>`).join("");
    else if (b.t === "kv") body += table(split(total, 2, Math.floor(total * 0.34)), ["Field", "Entry"], b.rows.map((r) => [r[0], r[1]]), true);
    else body += table(b.head.length === 3 && b.head[1] === "Status" ? split(total, 3, Math.floor(total * 0.4)).map((w, i) => (i === 1 ? Math.floor(total * 0.25) : w)) : weighted(total, b.head, b.rows), b.head, b.rows, false);
  }
  const sect = landscape ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' : '<w:pgSz w:w="11906" w:h="16838"/>';
  const margin = landscape ? 1134 : 1003;
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rId2"/>${sect}<w:pgMar w:top="1134" w:right="${margin}" w:bottom="1134" w:left="${margin}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const foot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="5F6F86"/></w:rPr><w:t xml:space="preserve">${esc(meta.firm)} | ${esc(meta.title)}${meta.restricted ? " | RESTRICTED" : ""} | Page </w:t></w:r><w:r><w:rPr><w:sz w:val="16"/><w:color w:val="5F6F86"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:b/><w:color w:val="12304F"/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="12304F"/><w:sz w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="0C7FA8"/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="60"/></w:pPr></w:style></w:styles>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="540" w:hanging="270"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const enc = new TextEncoder();
  const NS = "http://schemas.openxmlformats.org/package/2006/relationships";
  const files = [
    { name: "[Content_Types].xml", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`) },
    { name: "_rels/.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`) },
    { name: "word/document.xml", data: enc.encode(xml) }, { name: "word/styles.xml", data: enc.encode(styles) }, { name: "word/numbering.xml", data: enc.encode(numbering) }, { name: "word/footer1.xml", data: enc.encode(foot) },
  ];
  return zip(files);
}

// ------------------------------------------------------------------ PDF (the browser's print window)

const h = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const lineBreaks = (s: string) => h(s).replace(/\n/g, "<br>");

export function toHtml(list: Block[], meta: Meta): string {
  const wide = list.some((b) => b.t === "table" && b.head.length >= 6);
  const body = list.map((b) => {
    if (b.t === "h") return `<h${b.level + 1}>${h(b.text)}</h${b.level + 1}>`;
    if (b.t === "p") return `<p class="${b.small ? "small" : ""}">${b.bold ? "<strong>" : ""}${lineBreaks(b.text)}${b.bold ? "</strong>" : ""}</p>`;
    if (b.t === "bullets") return `<ul>${b.items.map((i) => `<li>${h(i)}</li>`).join("")}</ul>`;
    if (b.t === "kv") return `<table class="kv"><thead><tr><th>Field</th><th>Entry</th></tr></thead><tbody>${b.rows.map((r) => `<tr><th scope="row">${h(r[0])}</th><td>${lineBreaks(r[1]) || "&nbsp;"}</td></tr>`).join("")}</tbody></table>`;
    return `<table><thead><tr>${b.head.map((c) => `<th>${h(c)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${lineBreaks(c) || "&nbsp;"}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }).join("\n");
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(meta.title)}</title>
<style>@page{size:A4 ${wide ? "landscape" : "portrait"};margin:16mm 15mm}body{font:11pt/1.45 Calibri,"Segoe UI",system-ui,sans-serif;color:#1f2c40;margin:0;background:#e9ecef}main{max-width:${wide ? 1100 : 780}px;margin:0 auto;padding:28px 34px;background:#fff}
.noprint{max-width:${wide ? 1100 : 780}px;margin:12px auto 0;text-align:right}button{font:inherit;padding:6px 14px}
.firm{color:#5f6f86;font-size:9pt;margin:0}h1{color:#12304f;font-size:21pt;margin:2px 0 8px}h2{color:#12304f;font-size:14pt;margin:18px 0 6px}h3{color:#0c7fa8;font-size:12pt;margin:16px 0 5px;break-after:avoid}
p{margin:0 0 6px}p.small{color:#44546a;font-size:10pt}ul{margin:0 0 8px;padding-left:20px}table{width:100%;border-collapse:collapse;margin:0 0 10px;font-size:10pt}
th,td{border:1px solid #9db4c8;padding:4px 7px;vertical-align:top;text-align:left}thead th{background:#12304f;color:#fff}table.kv th[scope=row]{background:#eaf4fa;width:34%}tr{break-inside:avoid}td{min-height:20px}
.foot{margin-top:18px;border-top:1px solid #d5e5f2;padding-top:6px;color:#5f6f86;font-size:8.5pt}@media print{body{background:#fff}main{max-width:none;padding:0}.noprint{display:none}}</style></head>
<body><div class="noprint"><button onclick="window.print()">Print or save as PDF</button></div><main><p class="firm">${h(meta.firm)}</p><h1>${h(meta.title)}</h1>${body}
<p class="foot">${meta.restricted ? "RESTRICTED. " : ""}${h(meta.firm)} | ${h(meta.title)} | Printed ${h(fmtD(meta.today))}</p></main></body></html>`;
}

export const fileName = (title: string, today: string, ext: string) => `${title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${today}.${ext}`;
