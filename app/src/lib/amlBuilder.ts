// The AML policy builder. Instead of a blank page, the firm answers plain questions, one area at a time, and the policy is written from
// the answers. The areas and the questions follow ACCA's AML policy and procedures factsheet (April 2026), its firm-wide risk assessment,
// client risk, MLRO and training factsheets, and the CCAB guidance they point to. ACCA's point is that a generic policy is not enough:
// each section must say what this firm really does, so every section has to be confirmed by the person who answers it, and anything
// unanswered shows as a gap. Nothing here is legal advice, and a built policy is not evidence that a control has been carried out.
import { Block } from "./amlPack";

export type Answers = Record<string, string | string[]>;
export type Opt = { v: string; label: string };
export type Q = {
  k: string; label: string; type: "one" | "many" | "text" | "long" | "date" | "number";
  options?: Opt[];
  /** The suggested answer (ACCA's own example or common sense). Used only when the person chooses to accept suggestions. */
  suggest?: string | string[];
  help?: string;
  /** Where the question comes from, so the person can see it isn't ours. */
  source?: string;
  /** Needed before the section can be called complete. */
  need?: boolean;
  show?: (a: Answers) => boolean;
  placeholder?: string;
};
export type Step = { id: string; title: string; covers: string; intro: string; questions: Q[]; write: (a: Answers) => string };

export const GAP = (label: string) => `[[Answer needed: ${label}]]`;
export const str = (a: Answers, k: string): string => { const v = a[k]; return Array.isArray(v) ? v.join(", ") : (v || "").trim(); };
export const arr = (a: Answers, k: string): string[] => { const v = a[k]; return Array.isArray(v) ? v : v ? [v] : []; };
export const has = (a: Answers, k: string, v: string) => arr(a, k).includes(v);
/** The answer, or a visible gap that says what is missing. */
export const need = (a: Answers, k: string, label: string) => str(a, k) || GAP(label);
export const o = (...pairs: [string, string][]): Opt[] => pairs.map(([v, label]) => ({ v, label }));
export const mid = (s: string) => s.replace(/^The /, "the ").replace(/^Only /, "only ");
export const list = (items: string[]) => items.map((i) => `- ${i}`).join("\n");
export const join = (parts: (string | false | undefined | "")[]) => parts.filter(Boolean).join("\n\n");
export const labelOf = (q: Q, v: string) => q.options?.find((x) => x.v === v)?.label || v;

// ------------------------------------------------------------------ who works here: decides how much of the policy is about staff

export type Team = "alone" | "others" | "relevant" | "";
export const teamOf = (a: Answers): Team => (a.team === "alone" || a.team === "others" || a.team === "relevant" ? a.team : "");
const solo = (a: Answers) => teamOf(a) !== "relevant";
export const fmtDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : d);

export const SERVICES = o(["bookkeeping", "Bookkeeping"], ["accounts", "Accounts preparation"], ["tax", "Tax returns and tax advice"], ["payroll", "Payroll"], ["cosec", "Company secretarial work"], ["formation", "Company formation"], ["registered", "Registered office, or acting as director, secretary or nominee"], ["advisory", "Business advice or advisory work"]);
export const SECTORS = o(
  ["cash", "Cash-intensive businesses (takeaways, retail, scrap metal, car washes, nail bars)"], ["highvalue", "High-value goods (jewellers, car dealers, art, antiques)"], ["property", "Property (selling and renting)"],
  ["import", "Import and export, haulage, freight and shipping"], ["msb", "Money service businesses"], ["crypto", "Cryptocurrency"], ["visa", "Visa and immigration services"], ["metals", "Precious metals"],
  ["charity", "Charities"], ["investment", "Investment services"], ["gambling", "Gambling"], ["dual", "Dual-use goods"],
);
const SERVICE_CONTROLS: Record<string, string> = {
  bookkeeping: "Bookkeeping and accounts: Understand the business and expected income and expense profile; retain source records; investigate unsupported, inconsistent, unusual or unexplained entries; do not knowingly create or endorse misleading records.",
  accounts: "Bookkeeping and accounts: Understand the business and expected income and expense profile; retain source records; investigate unsupported, inconsistent, unusual or unexplained entries; do not knowingly create or endorse misleading records.",
  tax: "Tax work: Understand the commercial and factual basis of positions; challenge inconsistent information; document advice and client explanations; escalate suspected evasion or proceeds-of-crime concerns.",
  payroll: "Payroll: Verify the employer and authorised contacts; verify changes to employee identity, bank or payee details and payment instructions using a second channel; investigate unusual changes or third-party requests.",
  cosec: "Company secretarial: Verify authority and purpose for filings and changes; review changes to directors, shareholders, persons with significant control and registered details; investigate unusual or opaque ownership changes.",
  formation: "Company formation: Complete CDD on the instructing party and the intended owners and controllers before formation; understand the purpose, ownership and intended activity; screen relevant persons and jurisdictions; document the decision and the monitoring after formation. Do not form structures designed to obscure ownership or facilitate wrongdoing.",
  registered: "Registered office, director, secretary or nominee services: These carry higher risk. Do not provide them unless the MLRO has assessed the client and the purpose, recorded the approval, and set enhanced monitoring.",
  advisory: "Business advice: Understand the purpose of the advice and the source of any funds involved; escalate transactions without a clear commercial rationale.",
};

// ------------------------------------------------------------------ the questions

export const STEPS: Step[] = [
  {
    id: "firm", title: "About the firm", covers: "The facts the rest of the policy depends on",
    intro: "A few facts about the practice. The answers change how the policy is written: for example, a firm with nobody else working in it has no staff to train or to report to, and ACCA treats it differently.",
    questions: [
      { k: "firmName", label: "Firm name", type: "text", need: true },
      { k: "tradingName", label: "Trading name, if different", type: "text" },
      { k: "firmId", label: "ACCA firm ID", type: "text" },
      {
        k: "team", label: "Who works in the practice besides you?", type: "one", need: true,
        options: o(["alone", "Nobody. I work alone"], ["others", "Others help, but none of them touch client work or AML"], ["relevant", "Others do client work or support AML compliance (employees, subcontractors, partners, directors)"]),
        source: "ACCA: a relevant employee is anyone whose work is relevant to compliance with the Money Laundering Regulations or can help identify and reduce the risks. Sole practitioners with no relevant employees are not required to complete independent reviews or MLRO reports unless ACCA instructs it, though ACCA says reviewing the controls every year is good practice.",
      },
      { k: "staffCount", label: "How many relevant people besides you?", type: "number", show: (a) => a.team === "relevant", need: true },
      { k: "services", label: "Which services do you provide?", type: "many", options: SERVICES, need: true, source: "ACCA's firm-wide risk assessment names company formation, registered office, director services, payroll and tax advice as higher-risk services." },
      {
        k: "clientMoney", label: "Does client money pass through the firm?", type: "one", need: true,
        options: o(["none", "No. Clients pay their own tax, payroll and suppliers"], ["some", "Sometimes. For example I pay HMRC, staff or suppliers from client funds, or hold a client account"]),
        help: "ACCA treats client accounts as a risk in the sector and says clients should not be able to use one as a banking facility.",
      },
      { k: "clientMoneyHow", label: "What passes through, how often, and who authorises it?", type: "long", show: (a) => a.clientMoney === "some", need: true },
      {
        k: "meet", label: "How do you usually meet clients?", type: "one", need: true,
        options: o(["face", "Face to face"], ["mixed", "Some face to face, some remotely"], ["remote", "Mostly remotely"]),
        source: "ACCA: clients you have not met face to face can be harder to identify, so the firm-wide risk assessment must say how many there are.",
      },
      { k: "remoteHow", label: "For clients you have not met in person, what extra checks do you carry out?", type: "long", show: (a) => a.meet === "mixed" || a.meet === "remote", placeholder: "For example video meetings, electronic ID checks, additional documents" },
      {
        k: "overseas", label: "Do any clients or their owners have links to countries outside the UK?", type: "one", need: true,
        options: o(["none", "None that I know of"], ["few", "A few"], ["several", "Several"], ["unknown", "I haven't checked"]),
      },
      { k: "overseasWhich", label: "Which countries?", type: "text", show: (a) => a.overseas === "few" || a.overseas === "several" },
      { k: "sectors", label: "Do you act for clients in any of these sectors?", type: "many", options: SECTORS, help: "Leave blank if none. ACCA lists these as typical higher-risk sectors.", need: true },
      { k: "pep", label: "Are any clients, or their owners, politically exposed persons (PEPs) or close associates of one?", type: "one", need: true, options: o(["no", "No"], ["yes", "Yes"], ["unchecked", "I haven't checked"]) },
    ],
    write: (a) => join([
      `${need(a, "firmName", "firm name")}${str(a, "tradingName") ? `, trading as ${str(a, "tradingName")}` : ""}${str(a, "firmId") ? ` (ACCA firm ID ${str(a, "firmId")})` : ""} is supervised for anti-money laundering by ACCA.`,
      teamOf(a) === "alone" ? "The firm is run by one person, who is the sole practitioner. There are no other employees." : teamOf(a) === "others" ? "Other people help in the practice, but none of them does client work or anything that bears on AML compliance." : teamOf(a) === "relevant" ? `The firm has relevant employees (${str(a, "staffCount") || "number needed"} besides the MLRO), who must follow this policy.` : GAP("who works in the practice"),
      a.services ? `The firm provides: ${arr(a, "services").map((s) => SERVICES.find((x) => x.v === s)?.label.toLowerCase() || s).join(", ")}.` : GAP("services provided"),
    ]),
  },
  {
    id: "mlro", title: "Money laundering reporting officer (MLRO)", covers: "The MLRO and their responsibilities",
    intro: "The firm must appoint an MLRO, and a partner or senior manager must hold overall responsibility for AML compliance. In a sole practice both are the same person.",
    questions: [
      { k: "mlro", label: "Who is the MLRO?", type: "text", need: true },
      { k: "mlroEmail", label: "MLRO email", type: "text" },
      { k: "mlroPhone", label: "MLRO telephone", type: "text" },
      { k: "mlroSkills", label: "Why is this person suitable? (understanding of the business, seniority, authority, time and resources)", type: "long", suggest: "The MLRO is the owner and director of the firm, understands its services and clients, has the authority to direct all work, and has the time and resources to carry out the role.", source: "ACCA, The role of the MLRO: the person appointed must understand the business, be senior enough to direct staff, have the authority to ensure compliance, and have the time, capacity and resources." },
      { k: "deputy", label: "Is there an alternate (deputy) MLRO?", type: "one", need: true, options: o(["no", "No"], ["yes", "Yes"]), source: "ACCA: an alternate may cover absences but does not remove the MLRO's overall responsibility." },
      { k: "deputyName", label: "Who is the alternate?", type: "text", show: (a) => a.deputy === "yes", need: true },
      { k: "away", label: "What happens when the MLRO is away?", type: "long", show: (a) => a.deputy === "no", placeholder: "For example how a suspicion is held and recorded until you return, and who to contact if consent is urgent" },
      { k: "senior", label: "Who holds overall responsibility for AML compliance, if not the MLRO?", type: "text", show: (a) => teamOf(a) === "relevant", suggest: "The MLRO" },
    ],
    write: (a) => join([
      `## Money laundering reporting officer`,
      `The money laundering reporting officer (MLRO) is ${need(a, "mlro", "MLRO name")}${str(a, "mlroEmail") ? `, ${str(a, "mlroEmail")}` : ""}${str(a, "mlroPhone") ? `, ${str(a, "mlroPhone")}` : ""}.`,
      str(a, "mlroSkills") || GAP("why the MLRO is suitable"),
      a.deputy === "yes" ? `The alternate MLRO is ${need(a, "deputyName", "alternate MLRO")}. The alternate covers the MLRO's absence. The MLRO keeps overall responsibility.` : a.deputy === "no" ? `The firm has no alternate MLRO.${str(a, "away") ? ` ${str(a, "away")}` : ""}` : GAP("whether there is an alternate MLRO"),
      solo(a) ? "As sole practitioner, the MLRO is also the person with overall responsibility for the firm's AML compliance and is personally responsible for it." : `Overall responsibility for AML compliance sits with ${str(a, "senior") || "the MLRO"}.`,
      "## Responsibilities of the MLRO",
      "The MLRO's responsibilities include, but are not limited to, the following (taken from the CCAB guidance for the accountancy sector):",
      list([
        "have oversight of, and be involved in, money laundering and terrorist financing risk assessments",
        "take reasonable steps to access any relevant information about the business",
        "obtain and use national and international findings to inform their performance of the role",
        "create and maintain the firm's risk-based approach to preventing money laundering and terrorist financing",
        "develop and implement systems, controls, policies and procedures that suit each part of the business",
        "take reasonable steps to ensure the creation and maintenance of AML documentation",
        "develop customer due diligence (CDD) policies and procedures",
        "ensure the systems and controls exist for internal suspicious activity reports (SARs) to be made in line with the Proceeds of Crime Act 2002",
        "receive internal SARs and make external SARs to the National Crime Agency (NCA)",
        "take remedial action where controls are ineffective, and say where controls work and where they could improve",
        "take reasonable steps to establish and maintain adequate arrangements for awareness and training",
        "receive the findings of relevant audits and compliance reviews and pass them to the firm's management",
        solo(a) ? "review the AML systems and controls at least annually and record the result" : "report to management in writing at least annually on how well the AML systems and controls operate",
      ]),
    ]),
  },
  {
    id: "report", title: "MLRO report and independent review", covers: "MLRO report; independent assessments (control assurance)",
    intro: "How the firm checks, every year, that its AML controls actually work. ACCA's rules depend on who works in the firm.",
    questions: [
      { k: "reportDue", label: "When is the next annual review or MLRO report due?", type: "date", need: true },
      { k: "reportTo", label: "Who receives the MLRO's written report?", type: "text", show: (a) => teamOf(a) === "relevant", need: true, suggest: "The directors and partners" },
      {
        k: "independent", label: "Who will carry out the independent review?", type: "one", need: true,
        show: (a) => teamOf(a) === "relevant",
        options: o(["senior", "A partner or senior manager who is not involved in AML policies, controls and procedures"], ["external", "An external reviewer"]),
        source: "ACCA: for most firms, a partner or senior manager not involved with AML policies, controls and procedures can carry out the review, with sample checks each year. It does not need to be external.",
      },
      { k: "independentName", label: "Name of the reviewer", type: "text", show: (a) => teamOf(a) === "relevant" },
      {
        k: "extraReview", label: "Will you still arrange an independent review?", type: "one", need: true,
        show: (a) => solo(a) && !!teamOf(a),
        options: o(["no", "No. I will review the controls myself each year"], ["yes", "Yes, as good practice or because ACCA has asked"]),
        source: "ACCA, The role of the MLRO: sole practitioners with no relevant employees are not required to complete independent reviews or MLRO reports unless instructed by ACCA.",
      },
      { k: "extraName", label: "Who will carry out the independent review?", type: "text", show: (a) => solo(a) && a.extraReview === "yes" },
    ],
    write: (a) => join([
      "## MLRO report",
      teamOf(a) === "relevant"
        ? `Every year the MLRO reports in writing to ${mid(need(a, "reportTo", "who receives the report"))} on how well the firm's AML systems and controls operate. The report covers: a summary of serious weaknesses and the action taken; the number and quality of internal SARs (if there are none, whether training has been sufficient); the number of external SARs; the number of clients declined because of unsatisfactory information; staff training; any extra resource needed; a sample check of CDD files and client risk ratings; and whether the AML policy and procedures and the firm-wide risk assessment are up to date. The next report is due ${fmtDate(str(a, "reportDue")) || GAP("next report date")}.`
        : teamOf(a)
          ? `The firm has no relevant employees, so ACCA does not require a written MLRO report to management unless it instructs the firm to. As good practice, the MLRO reviews the firm's AML systems and controls at least once a year, using ACCA's MLRO report template, and keeps a record of the review. The next review is due ${fmtDate(str(a, "reportDue")) || GAP("next review date")}.`
          : GAP("who works in the practice"),
      "## Independent review (control assurance)",
      teamOf(a) === "relevant"
        ? `The firm has a regular independent review of the adequacy and effectiveness of its AML systems and controls, including a sample of files each year. It is carried out by ${a.independent === "external" ? "an external reviewer" : "a partner or senior manager who is not involved in the AML policies, controls and procedures"}${str(a, "independentName") ? ` (${str(a, "independentName")})` : ""}. Findings and actions are recorded and followed up.`
        : a.extraReview === "yes"
          ? `Although ACCA does not require it of a firm without relevant employees, the firm arranges an independent review of its AML controls${str(a, "extraName") ? `, carried out by ${str(a, "extraName")}` : ""}. The MLRO cannot be the independent reviewer. Findings and actions are recorded and followed up.`
          : a.extraReview === "no" ? "The firm has no relevant employees, so an independent review is not required by ACCA unless it instructs the firm to carry one out. The MLRO reviews the controls each year instead and the firm will arrange an independent review if ACCA asks for one." : GAP("whether an independent review will be arranged"),
    ]),
  },
  {
    id: "fwra", title: "Firm-wide risk assessment", covers: "Firm-wide risk assessment, including proliferation financing",
    intro: "The firm must have a written risk assessment of its own exposure to money laundering. This step describes how it is done and kept up to date. The risk assessment itself is on the Risk assessment tab.",
    questions: [
      { k: "fwraWhen", label: "How often is it reviewed?", type: "one", need: true, options: o(["annual", "At least once a year"]), suggest: "annual", source: "ACCA: review the policy and the assessment periodically, ideally annually." },
      {
        k: "fwraTriggers", label: "What also makes you review it straight away?", type: "many", need: true,
        options: o(["law", "A change in legislation or guidance"], ["risk", "A new or emerging money laundering risk"], ["systems", "New systems or processes in the firm"], ["service", "A new service or a new type of client"], ["failure", "A control failure or a breach"], ["intel", "Relevant intelligence or findings from a reviewer"]),
        suggest: ["law", "risk", "systems", "service", "failure"], source: "ACCA: trigger events such as a change in legislation or guidance, a new or emerging risk, or new systems and processes must prompt an update.",
      },
      { k: "fwraShared", label: "Who is it shared with?", type: "text", suggest: "The MLRO and the director", show: (a) => teamOf(a) === "relevant" },
      { k: "pf", label: "How is proliferation financing assessed?", type: "one", need: true, options: o(["within", "As part of the firm-wide risk assessment"], ["separate", "In a separate assessment"]), source: "ACCA: some firms combine the proliferation financing assessment with the firm-wide risk assessment. For most firms the risk will be low, but it must still be assessed and the reason recorded." },
    ],
    write: (a) => join([
      "## Firm-wide risk assessment",
      `The MLRO keeps a written firm-wide risk assessment that considers the risks from the firm's clients, the countries and areas it works in, its services, its transactions, its delivery channels and its exposure to proliferation financing. It states what controls reduce each risk. It is reviewed ${a.fwraWhen === "annual" ? "at least once a year" : GAP("how often it is reviewed")}, and straight away when any of these happens:`,
      arr(a, "fwraTriggers").length ? list(arr(a, "fwraTriggers").map((t) => labelOf(STEPS[3].questions[1], t).replace(/^A /, "a ").replace(/^New /, "new ").replace(/^Relevant /, "relevant "))) : GAP("what triggers an early review"),
      `${str(a, "fwraShared") ? `It is shared with ${mid(str(a, "fwraShared"))}. ` : ""}Earlier versions are kept on file.`,
      "## Proliferation financing risk assessment",
      a.pf === "within" ? "The firm assesses its exposure to proliferation financing, meaning funds or financial services used for weapons of mass destruction, as part of the firm-wide risk assessment. It considers links to sanctioned and high-risk jurisdictions, dual-use goods, and clients' counterparties and ownership, and records why the risk is or is not low." : a.pf === "separate" ? "The firm assesses its exposure to proliferation financing, meaning funds or financial services used for weapons of mass destruction, in a separate written assessment. It considers links to sanctioned and high-risk jurisdictions, dual-use goods, and clients' counterparties and ownership, and records why the risk is or is not low." : GAP("how proliferation financing is assessed"),
    ]),
  },
  {
    id: "clientrisk", title: "Client risk assessment", covers: "Client risk assessment",
    intro: "Every client is given a risk rating before work starts and again at each review. The rating decides how much due diligence applies. ACCA expects most clients to be medium, some to be high, and low to be rare.",
    questions: [
      {
        k: "highFactors", label: "Which of these make a client high risk?", type: "many", need: true,
        options: o(
          ["unusual", "The relationship is conducted in unusual circumstances"], ["geo", "The client lives in, or deals with, a high-risk country or area"], ["cash", "Cash-intensive business"], ["structure", "Unusual or excessively complex ownership structure"],
          ["hnw", "High-net-worth individual"], ["pep", "Politically exposed person (PEP), including close relatives and associates"], ["highvalue", "High-value goods business"], ["sector", "A sector at high risk of money laundering"], ["remote", "Non-face-to-face relationship"],
        ),
        suggest: ["unusual", "geo", "cash", "structure", "hnw", "pep", "highvalue", "sector", "remote"],
        source: "ACCA, Identifying client risk (April 2026). A high rating does not mean a client is involved in money laundering. It means the firm must take extra steps.",
      },
      { k: "hnwThreshold", label: "What counts as high net worth for the firm? (assets over)", type: "text", show: (a) => has(a, "highFactors", "hnw"), placeholder: "For example £1 million" },
      { k: "extraHigh", label: "Any other high-risk factors specific to your clients?", type: "long", placeholder: "For example a client who changes the nature of their business quickly, or transactions that make no commercial sense" },
      { k: "lowUse", label: "Do you ever rate a client low risk?", type: "one", need: true, options: o(["never", "No. Anyone without high-risk factors is medium"], ["rare", "Only public bodies, publicly owned enterprises and companies listed on a regulated market"]), suggest: "rare", source: "ACCA: low risk should be a rare exception, because low-risk clients are typically subject to simplified due diligence." },
      { k: "signoff", label: "Who signs off each client's risk rating?", type: "text", need: true, suggest: "The MLRO", source: "ACCA: the assessment should be signed off by a partner, senior manager or the MLRO, with the reasons recorded on the client file." },
    ],
    write: (a) => {
      const hi = arr(a, "highFactors").map((f) => labelOf(STEPS[4].questions[0], f).replace(/^High-net-worth individual$/, a.hnwThreshold ? `High-net-worth individual (assets over ${str(a, "hnwThreshold")})` : "High-net-worth individual"));
      return join([
        "## Client risk assessment",
        "Client risk is the overall risk of money laundering or terrorist financing that a client brings. The question the firm asks is whether the client or its beneficial owners have attributes known to be used by money launderers or terrorist financiers. Every client is given a risk rating of high, medium or low before work starts, and the rating is reviewed at each ongoing review and whenever circumstances change. The reasons for the rating are written on the client file, even when nothing has changed. " + `${need(a, "signoff", "who signs off the rating")} signs off each rating.`,
        "## High-risk clients",
        "Any client with one or more of the following is treated as high risk:",
        hi.length || str(a, "extraHigh") ? list([...hi, ...(str(a, "extraHigh") ? str(a, "extraHigh").split(/\n+/).map((x) => x.trim()).filter(Boolean) : [])]) : GAP("what makes a client high risk"),
        "## Low-risk clients",
        a.lowUse === "rare" ? "A client is rated low risk only if it is a public administration, a publicly owned enterprise, or a company whose securities are listed on a regulated market. Low risk is a rare exception and the reason is recorded." : a.lowUse === "never" ? "The firm does not rate clients as low risk. A client with no high-risk factors is rated medium." : GAP("whether any clients are rated low risk"),
        "## Medium-risk clients",
        "Any client who has no high-risk or low-risk factors is rated medium risk.",
      ]);
    },
  },
  {
    id: "dd", title: "Customer due diligence", covers: "Due diligence (CDD, EDD, SDD)",
    intro: "What the firm checks before it accepts a client, what extra it does for high-risk clients, and when it may do less. ACCA says this must describe what the firm really does: which documents, which checks, who does them and where the records are kept.",
    questions: [
      { k: "who", label: "Who carries out due diligence and approves acceptance?", type: "text", need: true, suggest: "The MLRO" },
      { k: "idDocs", label: "What do you accept to identify an individual?", type: "many", need: true, options: o(["passport", "Passport"], ["licence", "Photocard driving licence"], ["eid", "National identity card"], ["electronic", "Electronic identity verification service"]), },
      { k: "eidTool", label: "Which electronic service?", type: "text", show: (a) => has(a, "idDocs", "electronic") },
      { k: "address", label: "What do you accept as proof of address?", type: "many", need: true, options: o(["utility", "Recent utility bill"], ["bank", "Recent bank or card statement"], ["council", "Council tax bill"], ["gov", "Government letter"], ["electronic", "Electronic address check"]) },
      { k: "entity", label: "For a company or other entity, what do you check?", type: "many", need: true, options: o(["ch", "Companies House record"], ["psc", "Persons with significant control (PSC) register"], ["owners", "Who owns and controls it, down to the individuals"], ["authority", "Who has authority to act for it"], ["purpose", "What it does and why it wants our services"]), suggest: ["ch", "psc", "owners", "authority", "purpose"] },
      { k: "discrepancy", label: "What do you do if the PSC register disagrees with what you find?", type: "long", suggest: "The MLRO investigates the difference with the client, records the explanation, and reports a material discrepancy to Companies House where required.", source: "ACCA's CDD guidance and the policy example refer to checking there are no discrepancies on the PSC register." },
      { k: "purposeCheck", label: "What do you record about the purpose of the relationship and expected activity?", type: "long", suggest: "The services requested, the expected income and activity of the client, the countries involved, and where relevant the source of funds or wealth.", need: true },
      { k: "beforeWork", label: "Can work start before due diligence is complete?", type: "one", need: true, options: o(["no", "No. Work does not start until CDD is complete"], ["limited", "Only in limited cases the MLRO approves and records, with the reasons"]), suggest: "no" },
      {
        k: "edd", label: "What extra do you do for a high-risk client?", type: "many", need: true,
        options: o(["id", "Obtain additional identity or ownership evidence"], ["sof", "Establish source of funds and source of wealth"], ["scrutiny", "Examine the purpose and expected activity in more depth"], ["approval", "Record senior approval"], ["monitor", "Monitor more often"], ["other", "Other measures tailored to the identified risk"]),
        suggest: ["id", "sof", "scrutiny", "approval", "monitor", "other"], source: "ACCA: EDD must be done for all high-risk clients, and the measures should address the specific risk factors found.",
      },
      { k: "sdd", label: "Do you ever use simplified due diligence (SDD)?", type: "one", need: true, options: o(["never", "No"], ["rare", "Only for clients rated low risk, with the reason recorded"]), suggest: "never", source: "ACCA: it is rare for a firm to use SDD, but it is good practice to document the position. SDD applies only to clients rated low risk." },
      { k: "records", label: "Where are the due diligence records kept?", type: "text", need: true, placeholder: "For example the client's AML file in the practice planner, with restricted access" },
    ],
    write: (a) => join([
      "## Due diligence policy",
      `Due diligence is carried out by ${mid(need(a, "who", "who carries out due diligence"))}. Before the firm starts work, it identifies the client, checks who owns and controls it, understands why the client wants the firm's services, and records the result. ${a.beforeWork === "no" ? "Work does not start until due diligence is complete." : a.beforeWork === "limited" ? "Work starts before due diligence is complete only in limited cases that the MLRO approves and records, with the reasons." : GAP("whether work can start before CDD is complete")} The records are kept ${need(a, "records", "where records are kept")}.`,
      "## Customer due diligence (CDD)",
      "CDD is carried out for every client.",
      list([
        `Identify and verify individuals using reliable, independent documents or data. Accepted identity: ${arr(a, "idDocs").length ? arr(a, "idDocs").map((i) => labelOf(STEPS[5].questions[1], i).toLowerCase()).join(", ") + (str(a, "eidTool") ? ` (${str(a, "eidTool")})` : "") : GAP("accepted identity documents")}.`,
        `Proof of address: ${arr(a, "address").length ? arr(a, "address").map((i) => labelOf(STEPS[5].questions[3], i).toLowerCase()).join(", ") : GAP("accepted proof of address")}.`,
        `For a company or other entity, check: ${arr(a, "entity").length ? arr(a, "entity").map((i) => labelOf(STEPS[5].questions[4], i).replace(/^Who /, "who ").replace(/^What /, "what ").replace(/^Companies House/, "the Companies House").replace(/^Persons with/, "the persons with").toLowerCase().replace(/^the /, "the ")).join(", ") : GAP("entity checks")}. ${str(a, "discrepancy")}`.trim(),
        `Record the purpose of the relationship and expected activity: ${str(a, "purposeCheck") || GAP("what is recorded about purpose and expected activity")}`,
        "Screen the client, its beneficial owners and relevant controllers against the UK Sanctions List and for PEP status and adverse information (see sanctions screening), and record the tool or source, date, search terms and result.",
        "Complete the client risk assessment and have it signed off, then record the decision to accept or decline, with the reason and the date of the first review.",
      ]),
      "## Enhanced due diligence (EDD)",
      `EDD is carried out for every high-risk client. ${arr(a, "edd").length ? "It includes:" : GAP("what EDD includes")}`,
      arr(a, "edd").length ? list(arr(a, "edd").map((i) => labelOf(STEPS[5].questions[8], i))) : "",
      "## Simplified due diligence (SDD)",
      a.sdd === "never" ? "The firm does not use simplified due diligence. Every client has full CDD, and high-risk clients have EDD." : a.sdd === "rare" ? "Simplified due diligence is used only for clients rated low risk, where the conditions are met and low risk is supported by a documented assessment. The reason is recorded and enough information is kept to understand the client." : GAP("whether SDD is used"),
    ].filter(Boolean) as string[]),
  },
  {
    id: "services", title: "Service-specific controls", covers: "Controls for the services the firm provides",
    intro: "Different services carry different risks. The controls below are chosen from the services you ticked on the first step. Add anything particular to how you work.",
    questions: [
      { k: "serviceExtra", label: "Anything to add about how you control these services?", type: "long", placeholder: "For example how payroll payment changes are confirmed, or how you decide whether to accept a company formation" },
    ],
    write: (a) => {
      const picked = arr(a, "services");
      const seen = new Set<string>();
      const lines = picked.map((s) => SERVICE_CONTROLS[s]).filter((x) => x && !seen.has(x) && seen.add(x));
      return join(["## Service-specific procedures", lines.length ? list(lines) : GAP("services provided (first step)"), str(a, "serviceExtra")]);
    },
  },
  {
    id: "monitor", title: "Ongoing monitoring", covers: "Ongoing monitoring",
    intro: "How often each client is reviewed, what the review checks, and what makes the firm review a client sooner.",
    questions: [
      { k: "high", label: "Review high-risk clients every", type: "one", need: true, options: o(["3 months", "3 months"], ["6 months", "6 months"], ["12 months", "12 months"]), suggest: "6 months", source: "ACCA's example: high-risk clients every six months, medium and low every 12 months." },
      { k: "medium", label: "Review medium-risk clients every", type: "one", need: true, options: o(["12 months", "12 months"], ["24 months", "24 months"]), suggest: "12 months" },
      { k: "low", label: "Review low-risk clients every", type: "one", options: o(["12 months", "12 months"], ["24 months", "24 months"]), suggest: "12 months", show: (a) => a.lowUse === "rare" },
      { k: "checks", label: "What does a review check?", type: "many", need: true, options: o(["id", "Identification and address are still valid"], ["psc", "No discrepancies on the PSC register"], ["owners", "Directors, owners and controllers are unchanged"], ["turnover", "Turnover and activity are in line with what we expect"], ["screen", "Sanctions, PEP and adverse information are rechecked"], ["services", "The services and the risk rating are still right"]), suggest: ["id", "psc", "owners", "turnover", "screen", "services"] },
      { k: "triggers", label: "What makes you review a client immediately?", type: "many", need: true, options: o(["identity", "A change in the client's identity"], ["owners", "A change in beneficial ownership"], ["service", "A change in the service provided"], ["inconsistent", "Information that doesn't fit what we know about the client"], ["unusual", "Unusual or unexplained activity"], ["adverse", "Adverse news, a sanctions alert or a PEP match"], ["bank", "A change to bank details or payment instructions"]), suggest: ["identity", "owners", "service", "inconsistent", "unusual", "adverse"] },
    ],
    write: (a) => join([
      "## Ongoing monitoring policy",
      `The MLRO schedules and records ongoing reviews. High-risk clients are reviewed every ${need(a, "high", "how often high-risk clients are reviewed")}, medium-risk clients every ${need(a, "medium", "how often medium-risk clients are reviewed")}${a.lowUse === "rare" ? `, and low-risk clients every ${need(a, "low", "how often low-risk clients are reviewed")}` : ""}. A review ensures that the due diligence information is still relevant and up to date. It checks:`,
      arr(a, "checks").length ? list(arr(a, "checks").map((c) => labelOf(STEPS[7].questions[3], c))) : GAP("what a review checks"),
      "Even if nothing has changed, the review is recorded on the ongoing client review form.",
      "Events that prompt an immediate review:",
      arr(a, "triggers").length ? list(arr(a, "triggers").map((c) => labelOf(STEPS[7].questions[4], c))) : GAP("what prompts an immediate review"),
    ]),
  },
  {
    id: "sanctions", title: "Sanctions screening", covers: "Sanctions screening",
    intro: "The firm must comply with UK sanctions. ACCA asks how the firm checks the lists, when, who is covered, and what happens when there is a match.",
    questions: [
      { k: "method", label: "How do you check?", type: "one", need: true, options: o(["manual", "Search the UK Sanctions List on GOV.UK myself"], ["tool", "A screening service"]) },
      { k: "tool", label: "Which service?", type: "text", show: (a) => a.method === "tool", need: true },
      { k: "when", label: "When do you screen?", type: "many", need: true, options: o(["onboard", "Before accepting a client"], ["review", "At each ongoing review"], ["change", "When a client's ownership, control or activity changes"], ["alert", "When the sanctions list changes or an alert comes in"]), suggest: ["onboard", "review", "change", "alert"] },
      { k: "who", label: "Who do you screen?", type: "many", need: true, options: o(["client", "The client"], ["owners", "Beneficial owners"], ["controllers", "Directors and other controllers"], ["counterparties", "Significant counterparties, for higher-risk clients"]), suggest: ["client", "owners", "controllers"] },
      { k: "record", label: "Where is each check recorded?", type: "text", suggest: "On the sanctions and PEP screening record in the practice planner" },
    ],
    write: (a) => join([
      "## Sanctions screening",
      `The firm complies with sanctions, embargoes and restrictions that the UK applies to people, entities and countries. The UK Sanctions List is the UK source for designations. The firm checks ${a.method === "manual" ? "the UK Sanctions List on GOV.UK" : a.method === "tool" ? `using ${need(a, "tool", "screening service")}` : GAP("how sanctions are checked")}.`,
      `It screens ${arr(a, "who").length ? arr(a, "who").map((w) => labelOf(STEPS[8].questions[3], w).toLowerCase()).join(", ") : GAP("who is screened")}, at these times: ${arr(a, "when").length ? arr(a, "when").map((w) => labelOf(STEPS[8].questions[2], w).replace(/^B/, "b").replace(/^A/, "a").replace(/^W/, "w")).join("; ") : GAP("when screening happens")}.`,
      `Each check is recorded with the source or tool, the date, the search terms used and the result${str(a, "record") ? `: ${str(a, "record")}` : ""}.`,
      "If there is a possible match, the MLRO reviews the evidence and records the reason for the decision. If there is a confirmed match, the firm stops the affected work where the law requires, tells the MLRO straight away, and considers the reporting obligations to OFSI, the NCA and ACCA. The client is not told anything that could prejudice an investigation.",
    ]),
  },
  {
    id: "sar", title: "Suspicious activity reporting", covers: "Suspicious activity reporting, internal and external",
    intro: "How a suspicion is reported inside the firm, who decides whether to report it to the NCA, and the two offences everyone must know: failing to report, and tipping off.",
    questions: [
      { k: "portal", label: "Is the firm registered with the NCA SAR Portal?", type: "one", need: true, options: o(["yes", "Yes"], ["no", "Not yet"]), help: "If not, register before a report is needed." },
      { k: "formWhere", label: "Where is the internal SAR form kept?", type: "text", show: (a) => teamOf(a) === "relevant", need: true },
      { k: "restricted", label: "Where are SAR records kept? (they must be restricted and kept apart from general files)", type: "text", need: true, suggest: "In a separate restricted folder that only the MLRO can open" },
      { k: "log", label: "Do you keep a log of internal and external SARs and the decisions?", type: "one", need: true, options: o(["yes", "Yes"], ["no", "Not yet"]), suggest: "yes", source: "ACCA recommends a full record of all SARs, with the written reasons for the decision whether to report, and a record of verbal discussions about suspicions." },
    ],
    write: (a) => join([
      "## Suspicious activity reporting (SAR)",
      teamOf(a) === "relevant"
        ? `Everyone in the firm must tell the MLRO immediately if they know or suspect, or have reasonable grounds to know or suspect, that money laundering or terrorist financing is involved. They do this by completing the internal SAR form, which is kept ${need(a, "formWhere", "where the internal SAR form is kept")}, and sending it to the MLRO as soon as possible, in confidence.`
        : "The MLRO must report knowledge or suspicion of money laundering or terrorist financing. In this firm the MLRO is also the person who would otherwise receive an internal report, so the MLRO records any suspicion, and the decision on it, directly on the MLRO decision form.",
      "The MLRO considers each report, decides whether to submit an external SAR to the NCA, and writes down the information considered, the decision and the reasons, whether or not a SAR is submitted. If consent is needed to act (a defence against money laundering request), the MLRO acts as the firm's contact with the NCA and the firm does not act until consent is given or the notice period has passed.",
      `${a.portal === "yes" ? "The firm is registered with the NCA SAR Portal." : a.portal === "no" ? "The MLRO will register the firm with the NCA SAR Portal." : GAP("whether the firm is registered with the NCA SAR Portal")} ${a.log === "yes" ? "A log of all internal and external SARs, and the decisions on them, is kept." : a.log === "no" ? "The MLRO will keep a log of all internal and external SARs and the decisions on them." : GAP("whether a SAR log is kept")} SAR records are kept ${need(a, "restricted", "where SAR records are kept")}, apart from the general client and staff files.`,
      "## Consequence of failing to report",
      "Under section 330 of the Proceeds of Crime Act 2002, a person commits an offence if, in the course of business, they come to know or suspect (or have reasonable grounds to suspect) that another person is engaged in money laundering and they do not make the required disclosure as soon as practicable. It is an offence whether or not it later turns out that money laundering took place. The required disclosure is to the MLRO or the NCA.",
      "## Tipping off",
      "Under section 333 of the same Act, a person commits an offence if they know or suspect that a disclosure has been made and they make a disclosure that is likely to prejudice any investigation that might follow. Under section 342, it is also an offence to prejudice a confiscation, civil recovery, detained cash or money laundering investigation, or to falsify, conceal or destroy relevant documents. Nobody may tell a client, or anyone else, that a report has been made or is being considered.",
    ]),
  },
  {
    id: "training", title: "Training", covers: "Training",
    intro: "ACCA expects annual training for relevant staff and new starters, covering set topics, with records and a test. Reading the policy or an informal chat is not training.",
    questions: [
      { k: "provider", label: "How is training delivered?", type: "one", need: true, options: o(["external", "An external provider"], ["internal", "Training we prepare ourselves"], ["both", "Both"]), source: "ACCA: firms may produce their own material as long as it covers the required topics in enough detail. A simple presentation can be enough." },
      { k: "providerName", label: "Which provider or materials?", type: "text", show: (a) => a.provider === "external" || a.provider === "both" },
      { k: "topics", label: "Which topics does it cover?", type: "many", need: true, options: o(["flags", "Money laundering red flags"], ["law", "The law and regulations, in the context of the firm's work"], ["cdd", "Customer due diligence and ongoing monitoring"], ["sar", "Suspicious activity reporting and handling suspicious transactions"], ["tipping", "Tipping off"], ["records", "Record keeping and data protection"], ["trends", "New trends and risks"]), suggest: ["flags", "law", "cdd", "sar", "tipping", "records", "trends"], source: "ACCA, AML training FAQs (April 2026): the minimum topics are red flags, the law, CDD and ongoing monitoring, SARs, tipping off, and record keeping and data protection." },
      { k: "test", label: "Is there a test at the end?", type: "one", need: true, options: o(["yes", "Yes"], ["no", "Not yet"]), suggest: "yes", source: "ACCA recommends a post-course assessment to show people understood." },
      { k: "log", label: "Where is the training log kept?", type: "text", need: true, suggest: "On the training record in the practice planner" },
      { k: "mlroReading", label: "Which wider sources does the MLRO keep up to date with?", type: "many", options: o(["mlr", "The Money Laundering Regulations 2017"], ["ccab", "CCAB guidance for the accountancy sector"], ["nra", "HM Treasury national risk assessment"], ["fatf", "FATF guidance for the accounting profession"], ["nca", "NCA website and materials"]), suggest: ["mlr", "ccab", "nra", "fatf", "nca"], source: "ACCA expects the MLRO to be familiar with these, especially a sole practitioner." },
    ],
    write: (a) => join([
      "## Training",
      teamOf(a) === "relevant" ? "The MLRO makes sure every relevant employee, including new starters as soon as reasonably convenient, is trained in how to recognise and deal with money laundering and terrorist financing, at least once a year and whenever there is an important update to the regulations." : "The MLRO is trained in how to recognise and deal with money laundering and terrorist financing, at least once a year and whenever there is an important update to the regulations. Anyone who later does client work for the firm is trained before they start, or as soon as reasonably convenient.",
      `Training is ${a.provider === "external" ? "provided by an external provider" : a.provider === "internal" ? "prepared and delivered by the firm" : a.provider === "both" ? "provided by an external provider and by material the firm prepares" : GAP("how training is delivered")}${str(a, "providerName") ? ` (${str(a, "providerName")})` : ""}. It covers:`,
      arr(a, "topics").length ? list(arr(a, "topics").map((t) => labelOf(STEPS[10].questions[2], t))) : GAP("training topics"),
      `${a.test === "yes" ? "Training ends with a test to confirm understanding. " : a.test === "no" ? "The firm will add a test at the end of training to confirm understanding. " : ""}Reading this policy, or informal instruction, does not count as training. A log records who was trained, what the training was, when it took place and the result of any assessment, and training materials are kept. The log is kept ${need(a, "log", "where the training log is kept")}.`,
      arr(a, "mlroReading").length ? `The MLRO keeps up to date with: ${arr(a, "mlroReading").map((t) => labelOf(STEPS[10].questions[5], t)).join("; ")}.` : "",
    ].filter(Boolean) as string[]),
  },
  {
    id: "records", title: "Record keeping", covers: "Record keeping",
    intro: "How long AML records are kept, where, who can see them, and how they are removed when the time is up.",
    questions: [
      { k: "where", label: "Where are AML records kept?", type: "text", need: true, placeholder: "For example the client's AML file in the practice planner, with restricted access" },
      { k: "access", label: "Who can open them?", type: "text", need: true, suggest: "The MLRO only" },
      { k: "disposal", label: "What happens when the retention period ends?", type: "one", need: true, options: o(["delete", "They are deleted, unless there is a legal reason to keep them"], ["review", "The MLRO reviews them and decides"]), suggest: "delete", source: "ACCA: CDD records are kept for five years from the end of the client relationship, along with other AML documents such as training logs, risk assessments and internal reports." },
    ],
    write: (a) => join([
      "## Record keeping policy",
      "CDD records, and records of transactions and of the business relationship, are kept for five years from the end of the client relationship (or from the completion of a one-off transaction). The firm also keeps its risk assessments, this policy and its earlier versions, training logs, ongoing monitoring reviews, screening records and internal and external SAR records.",
      `Records are kept ${need(a, "where", "where AML records are kept")}. They can be opened by ${mid(need(a, "access", "who can open AML records"))}. They can be retrieved promptly if ACCA, the NCA or another authority asks for them. SAR records are kept separately and are restricted (see suspicious activity reporting).`,
      a.disposal === "delete" ? "When the retention period ends, the records are deleted unless there is a legal reason to keep them, in line with data protection requirements." : a.disposal === "review" ? "When the retention period ends, the MLRO reviews the records and decides whether they are deleted, in line with data protection requirements." : GAP("what happens at the end of the retention period"),
    ]),
  },
  {
    id: "version", title: "Approval and review of the policy", covers: "Version control, approval and review",
    intro: "Who approves the policy, how people are told where it is, and when it is next reviewed. The version table at the end of the policy is filled in each time you save a version.",
    questions: [
      { k: "approver", label: "Who approves the policy?", type: "text", need: true, suggest: "The MLRO" },
      { k: "nextReview", label: "When is the next review?", type: "date", need: true, source: "ACCA: review and update the policy periodically, ideally annually, and whenever a trigger event happens." },
      { k: "tell", label: "How are people told where the policy is kept?", type: "text", show: (a) => teamOf(a) === "relevant", need: true, placeholder: "For example by email to everyone, and when someone joins" },
      { k: "understand", label: "How do you confirm people understand it?", type: "text", show: (a) => teamOf(a) === "relevant", need: true, placeholder: "For example a short test or a signed confirmation after training" },
      { k: "breach", label: "What do you do when a control fails or the policy is breached?", type: "long", suggest: "The MLRO records the failure, contains it, considers the effect on clients and any reporting duty, finds the cause, and agrees and records the corrective action. The risk assessment and this policy are reviewed if the failure shows a gap.", need: true },
    ],
    write: (a) => join([
      "## Approval, review and breaches",
      `This policy is approved by ${mid(need(a, "approver", "who approves the policy"))}. It is reviewed at least once a year, next by ${fmtDate(str(a, "nextReview")) || GAP("next review date")}, and straight away when the law or guidance changes, a new risk is identified, or the firm's systems or processes change.`,
      teamOf(a) === "relevant" ? `All relevant employees, including new starters, are told where the policy is kept: ${need(a, "tell", "how people are told where the policy is kept")}. The firm confirms their understanding: ${need(a, "understand", "how understanding is confirmed")}.` : "",
      `Control failures, missed due diligence, possible sanctions matches, data access incidents and training gaps are recorded. ${need(a, "breach", "what happens when a control fails")}`,
    ].filter(Boolean) as string[]),
  },
];
STEPS.forEach((s, i) => { if (!s.id) throw new Error(`step ${i}`); });
export const stepById = (id: string) => STEPS.find((s) => s.id === id);

// ------------------------------------------------------------------ what is shown, what is missing

export type Built = { id: string; title: string; text: string; gaps: string[]; unanswered: string[]; confirmed: boolean; edited: boolean };
export type State = { answers: Answers; edits: Record<string, string>; confirmed: Record<string, boolean> };
export const EMPTY: State = { answers: {}, edits: {}, confirmed: {} };
export const readState = (v: unknown): State => {
  const s = (v || {}) as Partial<State>;
  return { answers: s.answers && typeof s.answers === "object" ? s.answers : {}, edits: s.edits && typeof s.edits === "object" ? s.edits : {}, confirmed: s.confirmed && typeof s.confirmed === "object" ? s.confirmed : {} };
};

/** Questions that apply, given the answers so far. */
export const shown = (step: Step, a: Answers): Q[] => step.questions.filter((q) => !q.show || q.show(a));
const answered = (q: Q, a: Answers) => (Array.isArray(a[q.k]) ? (a[q.k] as string[]).length > 0 : !!String(a[q.k] ?? "").trim());
/** Questions marked as needed that have no answer yet. */
export const unanswered = (step: Step, a: Answers): string[] => shown(step, a).filter((q) => q.need && !answered(q, a)).map((q) => q.label);
const GAPS = /\[\[Answer needed: ([^\]]+)\]\]/g;

export function build(state: State, steps: Step[] = STEPS): Built[] {
  return steps.map((step) => {
    const generated = step.write(state.answers);
    const edited = typeof state.edits[step.id] === "string" && state.edits[step.id] !== "";
    const text = edited ? state.edits[step.id] : generated;
    return { id: step.id, title: step.title, text, gaps: [...text.matchAll(GAPS)].map((m) => m[1]), unanswered: unanswered(step, state.answers), confirmed: !!state.confirmed[step.id], edited };
  });
}
/** What is still missing before the policy can be called complete. */
export function outstanding(built: Built[]): { unconfirmed: string[]; gaps: number } {
  return { unconfirmed: built.filter((b) => !b.confirmed).map((b) => b.title), gaps: built.reduce((n, b) => n + b.gaps.length + b.unanswered.length, 0) };
}

/** Accept ACCA's suggestions for the questions that have none yet. Never overwrites an answer the person gave. */
export function withSuggestions(step: Step, a: Answers): Answers {
  const out: Answers = { ...a };
  for (const q of shown(step, a)) if (!answered(q, a) && q.suggest !== undefined) out[q.k] = q.suggest;
  return out;
}

// ------------------------------------------------------------------ the document

export type Version = { v: string; date: string; note: string; by: string; approved: boolean };
export const nextVersion = (versions: Version[]): string => {
  const last = versions.map((x) => x.v).sort((a, b) => Number(b.replace(/[^\d.]/g, "")) - Number(a.replace(/[^\d.]/g, "")))[0];
  if (!last) return "1.0";
  const [maj, min] = last.split(".").map((x) => parseInt(x, 10) || 0);
  return `${maj}.${(min || 0) + 1}`;
};

const flowBlocks = (text: string): Block[] => {
  const out: Block[] = [];
  let bullets: string[] = [];
  const flush = () => { if (bullets.length) out.push({ t: "bullets", items: bullets }), (bullets = []); };
  for (const raw of text.replace(/\[\[/g, "[").replace(/\]\]/g, "]").split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = /^##\s+(.*)$/.exec(line);
    const b = /^[-•*]\s+(.*)$/.exec(line);
    if (h) { flush(); out.push({ t: "h", text: h[1], level: 2 }); }
    else if (b) bullets.push(b[1]);
    else { flush(); out.push({ t: "p", text: line }); }
  }
  flush();
  return out;
};

export function policyBlocks(built: { title: string; text: string }[], head: { firm: string; version: string; updated: string; approvedBy: string }, versions: Version[]): Block[] {
  const out: Block[] = [
    { t: "p", text: `Version ${head.version || "draft"}. ${head.updated ? `Created or updated ${head.updated}. ` : ""}${head.approvedBy ? `Approved by ${head.approvedBy}.` : "Not yet approved."}`, small: true },
    { t: "h", text: "Contents", level: 2 },
    { t: "bullets", items: built.map((b, i) => `${i + 1}. ${b.title}`) },
  ];
  built.forEach((b, i) => { out.push({ t: "h", text: `${i + 1}. ${b.title}`, level: 1 }); out.push(...flowBlocks(b.text).filter((x, j) => !(j === 0 && x.t === "h" && x.text.toLowerCase().startsWith(b.title.toLowerCase().slice(0, 12))))); });
  out.push({ t: "h", text: "Version control", level: 1 });
  out.push({ t: "table", head: ["Date", "Version", "Amendment or review", "Person responsible"], rows: versions.map((v) => [fmtDate(v.date), v.v, v.note, v.by]) });
  return out;
}
