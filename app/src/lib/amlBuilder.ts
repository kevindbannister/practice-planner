// The AML policy builder. Instead of a blank page, the firm answers plain questions, one area at a time, and the policy is written from
// the answers. The areas and the questions follow ACCA's AML policy and procedures factsheet (April 2026), its firm-wide risk assessment,
// client risk, MLRO and training factsheets, and the CCAB guidance they point to. ACCA's point is that a generic policy is not enough:
// each section must say what this firm really does, so every section has to be confirmed by the person who answers it, and anything
// unanswered shows as a gap. Nothing here is legal advice, and a built policy is not evidence that a control has been carried out.
import { Block } from "./amlPack";
import { TRIGGER_KINDS } from "./amlReview";

export type Answers = Record<string, string | string[]>;
export type Opt = { v: string; label: string; /** Where the person can read the source. */ url?: string };
export type Q = {
  k: string; label: string; type: "one" | "many" | "text" | "long" | "date" | "number";
  options?: Opt[];
  /** The suggested answer (ACCA's own example or common sense). Used only when the person chooses to accept suggestions. */
  suggest?: string | string[];
  /** Example wording for the "Add example wording" button on an empty text box. Unlike suggest, the bulk fill button never uses it. */
  example?: string;
  help?: string;
  /** Where the question comes from, so the person can see it isn't ours. */
  source?: string;
  /** Pages worth reading before answering. */
  links?: { label: string; url: string }[];
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
      { k: "clientMoneyHow", example: "Client money is held only to pay tax and other bills on the client's behalf. It is received into the client account, paid out on the client's written instruction, and every payment is recorded against the client.", label: "What passes through, how often, and who authorises it?", type: "long", show: (a) => a.clientMoney === "some", need: true },
      {
        k: "meet", label: "How do you usually meet clients?", type: "one", need: true,
        options: o(["face", "Face to face"], ["mixed", "Some face to face, some remotely"], ["remote", "Mostly remotely"]),
        source: "ACCA: clients you have not met face to face can be harder to identify, so the firm-wide risk assessment must say how many there are.",
      },
      { k: "remoteHow", example: "We hold a video meeting, check the person's identity electronically, and ask for certified copies of identity documents before any work starts.", label: "For clients you have not met in person, what extra checks do you carry out?", type: "long", show: (a) => a.meet === "mixed" || a.meet === "remote", placeholder: "For example video meetings, electronic ID checks, additional documents" },
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
      { k: "away", example: "The alternate MLRO acts in their place. Any suspicion is recorded and held until the MLRO returns, and any urgent request for consent is passed to the alternate straight away.", label: "What happens when the MLRO is away?", type: "long", show: (a) => a.deputy === "no", placeholder: "For example how a suspicion is held and recorded until you return, and who to contact if consent is urgent" },
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
    intro: "The firm must have a written risk assessment of its own exposure to money laundering. This step describes how it is done and kept up to date. The questions that write the risk assessment itself are on the Risk assessment tab.",
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
      { k: "hnwThreshold", example: "£1 million", label: "What counts as high net worth for the firm? (assets over)", type: "text", show: (a) => has(a, "highFactors", "hnw"), placeholder: "For example £1 million" },
      { k: "extraHigh", example: "A client who changes the nature of their business quickly, or whose transactions make no commercial sense.", label: "Any other high-risk factors specific to your clients?", type: "long", placeholder: "For example a client who changes the nature of their business quickly, or transactions that make no commercial sense" },
      { k: "lowUse", label: "Do you ever rate a client low risk?", type: "one", need: true, options: o(["never", "No. Anyone without high-risk factors is medium"], ["rare", "Only public bodies, publicly owned enterprises and companies listed on a regulated market"], ["own", "Yes. Those, and any other client we assess as low risk after looking at the risk factors, with the reasons recorded"]), suggest: "rare", source: "ACCA: low risk should be a rare exception, because low-risk clients are typically subject to simplified due diligence. A firm can rate other clients low risk if it has assessed them and recorded why." },
      { k: "lowWhen", example: "Known to us for over two years, UK-based, simple ownership with the owners identified, ordinary accounts and tax work, no cash, no politically exposed person, and no adverse media or sanctions hits.", label: "What makes one of your clients low risk?", type: "long", need: true, show: (a) => a.lowUse === "own", help: "List the conditions a client must meet, so that two people would reach the same rating. Include what rules a client out.", placeholder: "For example: known to us for over two years, UK-based, simple ownership with owners identified, ordinary accounts and tax work, no cash, no politically exposed person, and no adverse media or sanctions hits." },
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
        a.lowUse === "rare" ? "A client is rated low risk only if it is a public administration, a publicly owned enterprise, or a company whose securities are listed on a regulated market. Low risk is a rare exception and the reason is recorded." : a.lowUse === "own" ? `A client is rated low risk if it is a public administration, a publicly owned enterprise or a company listed on a regulated market, or if the firm has assessed it as low risk because: ${str(a, "lowWhen") || GAP("what makes a client low risk")} The reasons for each low-risk rating are recorded on the client file, and a client with any high-risk factor is never rated low.` : a.lowUse === "never" ? "The firm does not rate clients as low risk. A client with no high-risk factors is rated medium." : GAP("whether any clients are rated low risk"),
        "## Medium-risk clients",
        "Any client who has no high-risk factors and does not meet the low-risk conditions is rated medium risk.",
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
      { k: "records", example: "The client's AML file in the practice planner, with restricted access.", label: "Where are the due diligence records kept?", type: "text", need: true, placeholder: "For example the client's AML file in the practice planner, with restricted access" },
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
      "EDD is also required by law where a client or transaction involves a country on the FATF \"call for action\" list, where the client or a beneficial owner is a politically exposed person (or a family member or known close associate of one), and for any transaction that is unusually complex or unusually large for its nature, or has an unusual pattern or no apparent economic or legal purpose. The firm's own risk assessment may also treat other higher-risk countries as needing EDD.",
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
      { k: "serviceExtra", example: "Payroll payment changes are confirmed with the client by phone before they are made, and every company formation request is reviewed by the MLRO before we accept it.", label: "Anything to add about how you control these services?", type: "long", placeholder: "For example how payroll payment changes are confirmed, or how you decide whether to accept a company formation" },
    ],
    write: (a) => {
      const picked = arr(a, "services");
      const seen = new Set<string>();
      const lines = picked.map((s) => SERVICE_CONTROLS[s]).filter((x) => x && !seen.has(x) && seen.add(x));
      return join(["## Service-specific procedures", lines.length ? list(lines) : GAP("services provided (first step)"), str(a, "serviceExtra")]);
    },
  },
  {
    id: "monitor", title: "Ongoing monitoring", covers: "Ongoing monitoring: how often each client is reviewed, and what makes a review happen sooner",
    intro: "You set how often each risk level is reviewed, and what makes the firm review a client straight away. The planner uses your review periods to set each client's review date when their AML is approved, and your triggers to open a review when one happens.",
    questions: [
      { k: "mHigh", label: "Review high-risk clients at least every (months)", type: "number", need: true, suggest: "6", source: "ACCA's example policy: high-risk clients every six months, medium and low every twelve. That is an example. Your frequency must be justified by your own risk assessment, and you must then follow it.", help: "A whole number of months. This sets the review date on each high-risk client." },
      { k: "mMed", label: "Review medium-risk clients at least every (months)", type: "number", need: true, suggest: "12", help: "A whole number of months." },
      { k: "mLow", label: "Review low-risk clients at least every (months)", type: "number", show: (a) => a.lowUse === "rare" || a.lowUse === "own", need: true, suggest: "12", help: "Only asked because you said some clients are rated low risk." },
      { k: "checks", label: "What does a review check?", type: "many", need: true, options: o(["id", "Identification and address are still valid"], ["psc", "No discrepancies on the PSC register"], ["owners", "Directors, owners and controllers are unchanged"], ["turnover", "Turnover and activity are in line with what we expect"], ["screen", "Sanctions, PEP and adverse information are rechecked"], ["services", "The services and the risk rating are still right"]), suggest: ["id", "psc", "owners", "turnover", "screen", "services"] },
      { k: "triggers", label: "What makes you review a client straight away, without waiting for the next date?", type: "many", need: true, options: TRIGGER_KINDS.map((t) => ({ v: t.v, label: t.label })), suggest: TRIGGER_KINDS.map((t) => t.v), help: "Changes to directors, owners and persons with significant control, and new services, are spotted by the planner. The rest are raised by a person on the client's AML record.", source: "The CCAB guidance for the accountancy sector expects ongoing monitoring to include scrutiny of activity and keeping due diligence up to date, with reviews prompted by changes in risk." },
      { k: "triggerOwn", example: "A client who changes the nature of their business quickly, or asks for work that does not fit what we know about them.", label: "Any other triggers specific to your clients?", type: "long", placeholder: "For example a client who changes the nature of their business quickly" },
      { k: "triggerDays", label: "How many days do you allow to complete a triggered review?", type: "number", need: true, suggest: "14", help: "The review is given this due date when it is opened. The more serious the trigger, the shorter it should be." },
    ],
    write: (a) => {
      const num = (k: string, label: string) => (/^\d+/.test(str(a, k)) ? String(parseInt(str(a, k), 10)) : GAP(label));
      return join([
        "## Ongoing monitoring policy",
        `The MLRO schedules and records ongoing reviews of every client. Reviews are set by risk rating: high-risk clients at least every ${num("mHigh", "months between high-risk reviews")} months, medium-risk clients at least every ${num("mMed", "months between medium-risk reviews")} months${a.lowUse === "rare" || a.lowUse === "own" ? `, and low-risk clients at least every ${num("mLow", "months between low-risk reviews")} months` : ""}. The next review date is set when a client's assessment is approved and is recorded on the client's AML record. A review ensures that the due diligence information is still relevant and up to date. It checks:`,
        arr(a, "checks").length ? list(arr(a, "checks").map((c) => labelOf(STEPS[7].questions[3], c))) : GAP("what a review checks"),
        "Even if nothing has changed, the review is recorded, with the date and the next review date.",
        "## Review triggers",
        "A client is also reviewed straight away, without waiting for the next scheduled date, when any of the following happens:",
        arr(a, "triggers").length || str(a, "triggerOwn") ? list([...arr(a, "triggers").map((c) => labelOf(STEPS[7].questions[4], c)), ...str(a, "triggerOwn").split(/\n+/).map((x) => x.trim()).filter(Boolean)]) : GAP("what prompts an immediate review"),
        `When a trigger happens, a review is opened on the client's AML record with a due date. It must be completed within ${num("triggerDays", "days allowed to complete a triggered review")} days. The review looks at what changed, whether the risk rating is still right and whether extra due diligence is needed, and ends with a new approved assessment and a new next review date. Details of any suspicion are not recorded in the review: they go to the MLRO under the suspicious activity reporting procedure.`,
      ]);
    },
  },
  {
    id: "sanctions", title: "Sanctions screening", covers: "Sanctions screening",
    intro: "The firm must comply with UK sanctions. ACCA asks how the firm checks the lists, when, who is covered, and what happens when there is a match.",
    questions: [
      { k: "method", label: "How do you check?", type: "one", need: true, links: [{ label: "The UK Sanctions List (GOV.UK)", url: "https://www.gov.uk/government/publications/the-uk-sanctions-list" }], options: o(["manual", "Search the UK Sanctions List on GOV.UK myself"], ["tool", "A screening service"]) },
      { k: "tool", label: "Which service?", type: "text", show: (a) => a.method === "tool", need: true },
      { k: "when", label: "When do you screen?", type: "many", need: true, options: o(["onboard", "Before accepting a client"], ["review", "At each ongoing review"], ["change", "When a client's ownership, control or activity changes"], ["alert", "When the sanctions list changes or an alert comes in"]), suggest: ["onboard", "review", "change", "alert"] },
      { k: "who", label: "Who do you screen?", type: "many", need: true, options: o(["client", "The client"], ["owners", "Beneficial owners"], ["controllers", "Directors and other controllers"], ["counterparties", "Significant counterparties, for higher-risk clients"]), suggest: ["client", "owners", "controllers"] },
      { k: "record", label: "Where is each check recorded?", type: "text", suggest: "On the sanctions and PEP screening record in the practice planner" },
      { k: "sHigh", label: "Re-screen high-risk clients at least every (months)", type: "number", need: true, suggest: "12", help: "Sets when the planner shows a client's sanctions and PEP screening as due. A whole number of months.", source: "There is no fixed legal frequency: it is risk-based, set in your policy and applied consistently. Sanctions breaches can be strict liability, so many firms also use ongoing monitoring between re-screens." },
      { k: "sMed", label: "Re-screen medium-risk clients at least every (months)", type: "number", need: true, suggest: "24", help: "A whole number of months." },
      { k: "sLow", label: "Re-screen low-risk clients at least every (months)", type: "number", need: true, suggest: "36", help: "A whole number of months." },
      { k: "monitorRisk", label: "Which clients does your screening service keep watching between re-screens (ongoing monitoring)?", type: "many", show: (a) => a.method === "tool", need: true, options: o(["high", "High-risk clients"], ["medium", "Medium-risk clients"], ["low", "Low-risk clients"], ["none", "None: we rely on the re-screens and the triggers"]), suggest: ["high"], help: "For the risk levels you tick, the planner switches on Xama's automatic refresh when it runs a new AML check. That may use Xama credits." },
    ],
    write: (a) => join([
      "## Sanctions screening",
      `The firm complies with sanctions, embargoes and restrictions that the UK applies to people, entities and countries. The UK Sanctions List is the UK source for designations. The firm checks ${a.method === "manual" ? "the UK Sanctions List on GOV.UK" : a.method === "tool" ? `using ${need(a, "tool", "screening service")}` : GAP("how sanctions are checked")}.`,
      `It screens ${arr(a, "who").length ? arr(a, "who").map((w) => labelOf(STEPS[8].questions[3], w).toLowerCase()).join(", ") : GAP("who is screened")}, at these times: ${arr(a, "when").length ? arr(a, "when").map((w) => labelOf(STEPS[8].questions[2], w).replace(/^B/, "b").replace(/^A/, "a").replace(/^W/, "w")).join("; ") : GAP("when screening happens")}.`,
      `Each check is recorded with the source or tool, the date, the search terms used and the result${str(a, "record") ? `: ${str(a, "record")}` : ""}.`,
      `Clients are re-screened by risk rating: high-risk at least every ${/^\d+/.test(str(a, "sHigh")) ? parseInt(str(a, "sHigh"), 10) : GAP("months between high-risk re-screens")} months, medium-risk at least every ${/^\d+/.test(str(a, "sMed")) ? parseInt(str(a, "sMed"), 10) : GAP("months between medium-risk re-screens")} months and low-risk at least every ${/^\d+/.test(str(a, "sLow")) ? parseInt(str(a, "sLow"), 10) : GAP("months between low-risk re-screens")} months, and straight away when a trigger happens.${(() => { const m = arr(a, "monitorRisk").filter((x) => x !== "none"); return m.length ? ` Between re-screens the screening service monitors ${m.length === 3 ? "all clients" : m.map((x) => `${x}-risk`).join(" and ") + " clients"} continuously and alerts the firm to any new sanctions designation or PEP status${m.length < 3 ? "; other clients rely on the re-screens and the review triggers" : ""}.` : arr(a, "monitorRisk").includes("none") ? " The firm does not use ongoing monitoring between re-screens, so it relies on the re-screens and the review triggers." : ""; })()}`,
      "If there is a possible match, the MLRO reviews the evidence and records the reason for the decision. If there is a confirmed match, the firm stops the affected work where the law requires, tells the MLRO straight away, and considers the reporting obligations to OFSI, the NCA and ACCA. The client is not told anything that could prejudice an investigation.",
    ]),
  },
  {
    id: "sar", title: "Suspicious activity reporting", covers: "Suspicious activity reporting, internal and external",
    intro: "How a suspicion is reported inside the firm, who decides whether to report it to the NCA, and the two offences everyone must know: failing to report, and tipping off.",
    questions: [
      { k: "portal", label: "Is the firm registered with the NCA SAR Portal?", type: "one", need: true, options: o(["yes", "Yes"], ["no", "Not yet"]), help: "If not, register before a report is needed." },
      { k: "formWhere", example: "In the AML area of the practice planner, as a blank form that can be printed.", label: "Where is the internal SAR form kept?", type: "text", show: (a) => teamOf(a) === "relevant", need: true },
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
    id: "staff", title: "Screening of staff", covers: "Screening of relevant employees (regulation 21)",
    intro: "Before taking on anyone whose work is relevant to AML, and while they work for the firm, the regulations expect you to assess their skills, knowledge, conduct and integrity. If nobody else works in the firm, the policy says so and says what happens when you recruit.",
    questions: [
      { k: "screen", label: "What do you check before someone starts?", type: "many", show: (a) => teamOf(a) === "relevant", need: true, options: o(["id", "Identity and right to work"], ["refs", "References from previous employers"], ["quals", "Qualifications and relevant experience"], ["criminal", "Criminal record check where the law allows it"], ["conduct", "A declaration of any conflicts of interest or past conduct issues"], ["train", "AML training before they handle client files"]), suggest: ["id", "refs", "quals", "criminal", "conduct", "train"], source: "Regulation 21 of the Money Laundering Regulations 2017: screen relevant employees for skills, knowledge and expertise, and for conduct and integrity, before and during their work." },
      { k: "screenOngoing", label: "How do you keep checking after they start?", type: "long", show: (a) => teamOf(a) === "relevant", need: true, suggest: "Performance and conduct are reviewed at least once a year, the MLRO is told of any concern about integrity, and training and understanding are re-checked each year." },
      { k: "contractors", label: "Do subcontractors, locums or outsourced staff who work on client files follow the same checks?", type: "one", show: (a) => teamOf(a) === "relevant", need: true, options: o(["yes", "Yes"], ["no", "No"], ["none", "The firm doesn't use any"]) },
      { k: "future", label: "If you take someone on later, who will do the screening?", type: "text", show: (a) => solo(a), suggest: "The MLRO" },
    ],
    write: (a) => join([
      "## Screening of staff",
      teamOf(a) === "relevant"
        ? `Before a relevant employee starts, and while they work for the firm, the firm assesses their skills, knowledge, conduct and integrity. Before they start it checks: ${arr(a, "screen").length ? arr(a, "screen").map((v) => labelOf(STEPS[11].questions[0], v).replace(/^A /, "a ").replace(/^An /, "an ").replace(/^Identity/, "identity").replace(/^References/, "references").replace(/^Qualifications/, "qualifications").replace(/^Criminal/, "criminal").replace(/^AML/, "AML")).join("; ") : GAP("what is checked before someone starts")}. After they start: ${str(a, "screenOngoing") || GAP("how staff are checked after they start")}${a.contractors === "yes" ? " Subcontractors and outsourced staff who work on client files follow the same checks." : a.contractors === "no" ? " Subcontractors and outsourced staff are not currently covered by these checks, and the firm will review this." : ""}`
        : teamOf(a) ? `The firm has no relevant employees, so there is nobody to screen at present. If the firm takes anyone on whose work bears on AML, ${mid(str(a, "future") || "the MLRO")} will check their identity, right to work, references, qualifications and conduct before they start, and they will be trained before they handle client files.` : GAP("who works in the practice"),
    ]),
  },
  {
    id: "reliance", title: "Reliance on others", covers: "Reliance on third parties and outsourced checks (regulation 39)",
    intro: "Some firms rely on another regulated firm's due diligence, or use a provider for identity checks. The regulations allow this only on conditions, and the firm remains responsible for the result.",
    questions: [
      { k: "rely", label: "Do you ever rely on another firm's customer due diligence instead of doing your own?", type: "one", need: true, options: o(["never", "No. We always do our own"], ["sometimes", "Sometimes"]), suggest: "never", source: "Regulation 39: reliance is allowed only on another regulated firm, with a written agreement, and the relying firm stays liable for any failure." },
      { k: "relyWho", example: "We do not rely on other firms for client due diligence. We carry out and keep our own checks.", label: "Who do you rely on, and for what?", type: "long", show: (a) => a.rely === "sometimes", need: true },
      { k: "relyTerms", label: "What conditions apply?", type: "many", show: (a) => a.rely === "sometimes", need: true, options: o(["supervised", "The other firm is supervised for AML in the UK or an equivalent country"], ["agreement", "There is a written agreement"], ["copies", "Copies of the evidence are available straight away on request"], ["responsible", "We stay responsible and check the quality of what we are given"]), suggest: ["supervised", "agreement", "copies", "responsible"] },
      { k: "outsource", label: "Do you use a provider for identity checks or screening?", type: "one", need: true, options: o(["no", "No"], ["yes", "Yes"]) },
      { k: "outsourceWho", example: "Our practice management and electronic ID providers. Before using each one we checked how it protects client data and that it does what we need, and we review it every year.", label: "Which provider, and what do you do to check it works?", type: "long", show: (a) => a.outsource === "yes", need: true },
    ],
    write: (a) => join([
      "## Reliance on third parties and outsourcing",
      a.rely === "never" ? "The firm does not rely on another firm's customer due diligence. It carries out its own checks on every client." : a.rely === "sometimes" ? `The firm sometimes relies on another firm's customer due diligence: ${need(a, "relyWho", "who is relied on")}. It does so only when ${arr(a, "relyTerms").length ? arr(a, "relyTerms").map((v) => labelOf(STEPS[12].questions[2], v).replace(/^The /, "the ").replace(/^There /, "there ").replace(/^Copies/, "copies").replace(/^We /, "we ")).join("; ") : GAP("conditions for reliance")}. The firm remains responsible for any failure in the checks.` : GAP("whether the firm relies on others"),
      a.outsource === "yes" ? `The firm uses an outside provider for identity checks or screening: ${need(a, "outsourceWho", "which provider")}. Using a provider does not transfer responsibility: the firm checks that the results are reliable and keeps the records.` : a.outsource === "no" ? "The firm does not use an outside provider for identity checks or screening." : GAP("whether a provider is used"),
    ]),
  },
  {
    id: "ch", title: "Companies House filing and identity verification", covers: "Companies House filings, authorised corporate service provider status, identity verification and register discrepancies",
    intro: "Since 18 November 2025 directors and people with significant control have had to verify their identity with Companies House, and Companies House has said that firms filing for clients as an agent must register as an authorised corporate service provider. The date for agents is one to check on GOV.UK. If you file for clients, the policy needs to say how.",
    questions: [
      { k: "files", label: "Do you file at Companies House for clients?", type: "one", need: true, options: o(["yes", "Yes, using the firm's own login or authentication codes"], ["some", "Some clients only"], ["no", "No. Clients file themselves"]), },
      { k: "acsp", label: "Where is the firm with authorised corporate service provider (ACSP) registration?", type: "one", show: (a) => a.files === "yes" || a.files === "some", need: true, options: o(["no", "Not registered. Clients verify their own identity and we only submit their codes"], ["registered", "Registered"], ["applied", "Applied, waiting"], ["planned", "Not yet. I will register before it is required"], ["unsure", "I'm not sure"]), source: "A firm that only submits filings using the codes clients give it, and does not verify identities itself, may not need to be an ACSP today. Companies House has said agents filing for clients will need to register, no sooner than November 2027 (put back a year in August 2026, with at least six months' notice promised); check the date and conditions on GOV.UK. To register the firm must be AML supervised (ACCA) and the person registering must first verify their own identity." },
      { k: "acspRef", label: "ACSP reference or date registered", type: "text", show: (a) => a.acsp === "registered" },
      { k: "idMethod", label: "How is a director's or owner's identity verified for Companies House?", type: "one", show: (a) => a.files === "yes" || a.files === "some", need: true, options: o(["chservice", "The person verifies directly with Companies House and gives us their personal code, and we do not verify identity ourselves"], ["own", "The firm does the checks as an ACSP, with the evidence kept"], ["both", "A mix, depending on the client"]), suggest: "chservice" },
      { k: "codeUse", label: "What do you check before filing with a client's code?", type: "long", show: (a) => (a.files === "yes" || a.files === "some") && a.idMethod !== "own", need: true, suggest: "That the client has given the personal code for this filing, that the name matches the director or person with significant control being filed for, and that the client has confirmed in writing that they verified their own identity. The code is used only for that filing and is not kept." },
      { k: "codes", label: "Who holds authentication codes and personal codes, and how are they protected?", type: "long", show: (a) => a.files === "yes" || a.files === "some", need: true, suggest: "Only the MLRO holds the firm's authentication codes. They are kept in a password manager, never emailed, and changed when someone leaves. A client's personal code is used only for the filing it was given for and not kept afterwards." },
      { k: "discrep", label: "What do you do if the Companies House register disagrees with what you find about a company's ownership or control?", type: "long", need: true, suggest: "The MLRO checks the difference with the client, records the explanation, and where it is a material discrepancy reports it to Companies House as required. The report and date are recorded on the Registrations and returns tab.", source: "Regulation 30A of the Money Laundering Regulations 2017 requires material discrepancies in beneficial ownership information to be reported to Companies House." },
    ],
    write: (a) => join([
      "## Companies House filings and identity verification",
      a.files === "no" ? "The firm does not file at Companies House on clients' behalf. Clients make their own filings. If that changes, the MLRO will check Companies House's rules for agents, and register as an authorised corporate service provider (ACSP) if needed, before the firm files." : a.files === "yes" || a.files === "some" ? join([
        `The firm files at Companies House ${a.files === "yes" ? "for clients" : "for some clients"}. ${a.acsp === "no" ? "The firm is not registered as an authorised corporate service provider (ACSP)." : a.acsp === "registered" ? `It is registered as an authorised corporate service provider${str(a, "acspRef") ? ` (${str(a, "acspRef")})` : ""}.` : a.acsp === "applied" ? "It has applied to register as an authorised corporate service provider and will not rely on that status until it is confirmed." : a.acsp === "planned" ? "It will register as an authorised corporate service provider before it is required." : a.acsp === "unsure" ? GAP("whether the firm is registered as an ACSP") : GAP("ACSP status")}`,
        a.idMethod === "chservice" ? `The firm does not verify identities for Companies House. Each director and person with significant control verifies their own identity directly with Companies House and gives the firm their personal code for the filing. Before filing the firm checks: ${str(a, "codeUse") || GAP("what is checked before filing with a client's code")} The MLRO will check Companies House's rules for agents when they change, and will register as an ACSP before the firm needs to be one.` : a.idMethod === "own" ? "The firm verifies identities for Companies House as an ACSP. Records of each check, including copies of the documents, are kept for seven years from the date the checks were completed (see the Registrations tab)." : a.idMethod === "both" ? `Some clients verify their own identity directly with Companies House and give the firm their personal code. For the others the firm verifies identity as an ACSP and keeps the records, including copies of the documents, for seven years from the date of the checks. Before filing with a client's code the firm checks: ${str(a, "codeUse") || GAP("what is checked before filing with a client's code")}` : GAP("how identity is verified for Companies House"),
        `Authentication codes and personal codes: ${str(a, "codes") || GAP("how codes are protected")}`,
      ]) : GAP("whether the firm files at Companies House"),
      `Register discrepancies: ${str(a, "discrep") || GAP("what happens when the register disagrees")}`,
    ]),
  },
  {
    id: "tcsp", title: "Company and trust services", covers: "Trust or company service provider work and supervision",
    intro: "Company formation, a registered office address, acting or arranging for someone to act as director or secretary, nominee services and acting as a trustee are 'trust or company service provider' work. A firm already supervised by ACCA does not register with HMRC for this: ACCA supervises the work and asks about it in the annual return.",
    questions: [
      { k: "tcspWhich", label: "Which of these does the firm provide?", type: "many", need: true, options: o(["formation", "Company formation"], ["office", "A registered office or business address"], ["director", "Acting or arranging for someone to act as director or secretary"], ["nominee", "Nominee shareholder services"], ["trustee", "Acting as a trustee, or trust formation"], ["none", "None of these"]), source: "ACCA's annual return asks how many clients received each of these in the past two years, so the firm needs to be able to count them." },
      { k: "tcspCount", label: "Roughly how many clients a year receive these services?", type: "text", show: (a) => arr(a, "tcspWhich").some((v) => v !== "none") && arr(a, "tcspWhich").length > 0 },
      { k: "tcspApproval", label: "What must happen before the firm accepts company or trust work?", type: "long", show: (a) => arr(a, "tcspWhich").some((v) => v !== "none") && arr(a, "tcspWhich").length > 0, need: true, suggest: "Full due diligence on the client and everyone who owns or controls it is complete first. The MLRO approves the purpose, the expected activity and the reason for using the firm, and records the decision. The firm does not act as nominee, director, secretary or trustee, or provide an address, unless the MLRO has assessed it separately and recorded the approval." },
      { k: "tcspDecline", label: "When would you decline?", type: "long", show: (a) => arr(a, "tcspWhich").some((v) => v !== "none") && arr(a, "tcspWhich").length > 0, suggest: "Ownership is hidden or unnecessarily complex, the purpose isn't clear, the client is in a high-risk country or is sanctioned, or the client won't give the information needed." },
      { k: "tcspSup", label: "Has ACCA confirmed how it treats the firm's company formation work?", type: "one", show: (a) => arr(a, "tcspWhich").some((v) => v !== "none") && arr(a, "tcspWhich").length > 0, need: true, options: o(["yes", "Yes"], ["no", "Not yet. I will check with ACCA"]) },
    ],
    write: (a) => join([
      "## Company and trust services",
      arr(a, "tcspWhich").length === 0 ? GAP("which company or trust services the firm provides") : arr(a, "tcspWhich").every((v) => v === "none") ? "The firm does not provide company formation, a registered office, director or secretary services, nominee services or trustee services." : `The firm provides: ${arr(a, "tcspWhich").filter((v) => v !== "none").map((v) => labelOf(STEPS[14].questions[0], v).replace(/^Acting/, "acting").replace(/^Company/, "company").replace(/^A registered/, "a registered").replace(/^Nominee/, "nominee")).join("; ")}.${str(a, "tcspCount") ? ` Roughly ${str(a, "tcspCount")} clients a year receive these services.` : ""} These are trust or company service provider services. The firm is supervised for AML by ACCA, so it does not register separately with HMRC for this work, and it reports its volumes to ACCA in the annual AML return. ${a.tcspSup === "no" ? "The MLRO will confirm with ACCA how the firm's company formation work is treated." : ""}`.trim(),
      arr(a, "tcspWhich").some((v) => v !== "none") ? `Before accepting this work: ${str(a, "tcspApproval") || GAP("what must happen before accepting company or trust work")}` : "",
      str(a, "tcspDecline") && arr(a, "tcspWhich").some((v) => v !== "none") ? `The firm declines if: ${str(a, "tcspDecline")}` : "",
    ].filter(Boolean) as string[]),
  },
  {
    id: "trustreg", title: "Trusts and the Trust Registration Service", covers: "Trusts and HMRC's Trust Registration Service",
    intro: "If the firm acts for trusts, the trustees may have to register the trust and keep it up to date on HMRC's Trust Registration Service. The firm needs to know who is responsible for that.",
    questions: [
      { k: "trusts", label: "Does the firm act for trusts?", type: "one", need: true, options: o(["no", "No"], ["yes", "Yes"]) },
      { k: "trustWho", label: "Who registers and updates the trust?", type: "one", show: (a) => a.trusts === "yes", need: true, options: o(["trustees", "The trustees do it themselves"], ["firm", "The firm does it as their agent"], ["varies", "It varies"]) },
      { k: "trustCheck", label: "How do you check the trust is registered and the details are current?", type: "long", show: (a) => a.trusts === "yes", need: true, suggest: "At onboarding and at each annual review the MLRO asks for the trust's registration reference and a copy of the registered details, compares them to the trust deed and to what the client has told us, and records any difference." },
    ],
    write: (a) => join([
      "## Trusts and the Trust Registration Service",
      a.trusts === "no" ? "The firm does not act for trusts at present. If that changes, the MLRO will identify the settlor, trustees, beneficiaries and anyone else who controls the trust, and check its registration on HMRC's Trust Registration Service, before work starts." : a.trusts === "yes" ? `The firm acts for trusts. Registration and updates to the Trust Registration Service are done by ${a.trustWho === "firm" ? "the firm as the trustees' agent" : a.trustWho === "trustees" ? "the trustees themselves" : a.trustWho === "varies" ? "either the trustees or the firm, agreed in each engagement" : GAP("who registers the trust")}. ${str(a, "trustCheck") || GAP("how registration is checked")}` : GAP("whether the firm acts for trusts"),
    ]),
  },
  {
    id: "cfa", title: "Preventing the facilitation of tax evasion", covers: "Criminal Finances Act 2017: failure to prevent the facilitation of tax evasion",
    intro: "This is separate from money laundering. A firm commits an offence if someone working for it, such as an employee or subcontractor, facilitates a client's tax evasion and the firm had no reasonable prevention procedures. HMRC's guidance sets out six principles: risk assessment, proportionate procedures, top-level commitment, due diligence, communication and training, and monitoring and review.",
    questions: [
      { k: "cfaLead", label: "Who is responsible at the top of the firm?", type: "text", need: true, suggest: "The director and MLRO" },
      { k: "cfaRisk", label: "Where could someone working for the firm help a client evade tax?", type: "many", need: true, options: o(["advice", "Tax advice and planning"], ["returns", "Preparing tax returns and accounts"], ["payroll", "Payroll, including cash or off-payroll payments"], ["introducers", "Introducers, referrers and subcontractors"], ["overseas", "Work involving overseas structures or income"], ["cash", "Clients who deal mostly in cash"]), suggest: ["advice", "returns", "payroll", "introducers", "overseas", "cash"], source: "HMRC's guidance on the corporate offences of failure to prevent the criminal facilitation of tax evasion." },
      { k: "cfaProc", label: "What does the firm do to prevent it?", type: "many", need: true, options: o(["accept", "Understand the client's affairs and why they want the work before accepting"], ["challenge", "Challenge anything that doesn't make commercial sense"], ["records", "Prepare returns only from records we can support"], ["decline", "Decline or stop work if a client won't correct a known error or omission"], ["report", "Report suspicions of evasion to the MLRO straight away"], ["fees", "No unusual fee arrangements or payments to introducers"]), suggest: ["accept", "challenge", "records", "decline", "report", "fees"] },
      { k: "cfaTrain", label: "How are people who might be affected told and trained?", type: "text", need: true, suggest: "Covered in the annual AML training and the policy is shared with anyone who joins" },
      { k: "cfaReview", label: "How is it monitored and reviewed?", type: "text", need: true, suggest: "Reviewed with the firm-wide risk assessment each year and after any concern about a client" },
    ],
    write: (a) => join([
      "## Preventing the facilitation of tax evasion",
      "Under the Criminal Finances Act 2017, the firm commits an offence if a person associated with it, such as an employee, subcontractor or agent, criminally facilitates a client's tax evasion and the firm did not have reasonable prevention procedures. The firm does not tolerate the facilitation of tax evasion.",
      `Responsibility sits with ${mid(need(a, "cfaLead", "who is responsible"))}.`,
      "Areas where the firm is exposed:",
      arr(a, "cfaRisk").length ? list(arr(a, "cfaRisk").map((v) => labelOf(STEPS[16].questions[1], v))) : GAP("where the firm is exposed"),
      "Procedures to prevent it:",
      arr(a, "cfaProc").length ? list(arr(a, "cfaProc").map((v) => labelOf(STEPS[16].questions[2], v))) : GAP("what the firm does to prevent it"),
      `People who work for the firm are told and trained: ${need(a, "cfaTrain", "how people are told and trained")}. Monitoring and review: ${need(a, "cfaReview", "how it is monitored and reviewed")}.`,
    ]),
  },
  {
    id: "dp", title: "Data protection and AML records", covers: "Personal data used for AML, client information, and requests for access",
    intro: "Personal information collected to meet the AML rules has its own rules: clients must be told, it can only be used for AML unless another law allows, and a request for access must never reveal a suspicious activity report.",
    questions: [
      { k: "notice", label: "How are clients told their data is used for AML checks?", type: "one", need: true, options: o(["letter", "In the engagement letter"], ["notice", "In a privacy notice we give every new client"], ["both", "Both"], ["not", "Not yet"]), source: "Regulation 41 of the Money Laundering Regulations 2017: new clients must be told that their personal data will be processed for AML, and it may not be used for anything else unless the law allows it or the client agrees." },
      { k: "basis", label: "What lawful basis does the firm record for AML processing?", type: "text", need: true, suggest: "Legal obligation (Money Laundering Regulations 2017)" },
      { k: "sar", label: "What happens if a client asks to see their personal data?", type: "long", need: true, suggest: "The request is passed to the MLRO before any reply, so that nothing is disclosed that would reveal a suspicious activity report or an investigation. The firm does not confirm or deny that a report exists.", source: "Disclosing a report would risk the tipping-off offence." },
      { k: "protect", label: "How are AML records protected?", type: "long", need: true, suggest: "Access is limited to the MLRO, files are stored on encrypted systems, and records are deleted at the end of the retention period." },
    ],
    write: (a) => join([
      "## Data protection and AML records",
      a.notice === "letter" ? "New clients are told in the engagement letter that their personal data will be used for the purpose of preventing money laundering and terrorist financing." : a.notice === "notice" ? "New clients are given a privacy notice that says their personal data will be used for the purpose of preventing money laundering and terrorist financing." : a.notice === "both" ? "New clients are told in the engagement letter and in the privacy notice that their personal data will be used for the purpose of preventing money laundering and terrorist financing." : a.notice === "not" ? "The firm will tell new clients, in the engagement letter or a privacy notice, that their personal data will be used for the purpose of preventing money laundering and terrorist financing." : GAP("how clients are told about AML use of data"),
      `The firm uses personal data collected for AML only for AML unless the law allows otherwise or the client agrees. The lawful basis recorded is ${need(a, "basis", "lawful basis")}.`,
      `Requests for access: ${str(a, "sar") || GAP("what happens to requests for access")}`,
      `Protection: ${str(a, "protect") || GAP("how AML records are protected")}`,
    ]),
  },
  {
    id: "records", title: "Record keeping", covers: "Record keeping",
    intro: "How long AML records are kept, where, who can see them, and how they are removed when the time is up.",
    questions: [
      { k: "where", example: "The client's AML file in the practice planner, with restricted access.", label: "Where are AML records kept?", type: "text", need: true, placeholder: "For example the client's AML file in the practice planner, with restricted access" },
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
      { k: "tell", example: "By email to everyone, and when someone joins.", label: "How are people told where the policy is kept?", type: "text", show: (a) => teamOf(a) === "relevant", need: true, placeholder: "For example by email to everyone, and when someone joins" },
      { k: "understand", example: "A short test or a signed confirmation after training.", label: "How do you confirm people understand it?", type: "text", show: (a) => teamOf(a) === "relevant", need: true, placeholder: "For example a short test or a signed confirmation after training" },
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
export type State = { answers: Answers; edits: Record<string, string>; confirmed: Record<string, boolean>; /** The date the person gives the document (an ISO date). */ date?: string };
export const EMPTY: State = { answers: {}, edits: {}, confirmed: {} };
export const readState = (v: unknown): State => {
  const s = (v || {}) as Partial<State>;
  return { answers: s.answers && typeof s.answers === "object" ? s.answers : {}, edits: s.edits && typeof s.edits === "object" ? s.edits : {}, confirmed: s.confirmed && typeof s.confirmed === "object" ? s.confirmed : {}, date: typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : undefined };
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
/** Questions on this step that have a suggestion and are still blank, so the fill button knows what it will do. */
export const fillable = (step: Step, a: Answers): Q[] => shown(step, a).filter((q) => q.suggest !== undefined && !answered(q, a));
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
    { t: "p", text: `Version ${head.version || "draft"}. ${head.updated ? `Dated ${fmtDate(head.updated)}. ` : ""}${head.approvedBy ? `Approved by ${head.approvedBy}.` : "Not yet approved."}`, small: true },
    { t: "h", text: "Contents", level: 2 },
    { t: "bullets", items: built.map((b, i) => `${i + 1}. ${b.title}`) },
  ];
  built.forEach((b, i) => { out.push({ t: "h", text: `${i + 1}. ${b.title}`, level: 1 }); out.push(...flowBlocks(b.text).filter((x, j) => !(j === 0 && x.t === "h" && x.text.toLowerCase().startsWith(b.title.toLowerCase().slice(0, 12))))); });
  out.push({ t: "h", text: "Version control", level: 1 });
  out.push({ t: "table", head: ["Date", "Version", "Amendment or review", "Person responsible"], rows: versions.map((v) => [fmtDate(v.date), v.v, v.note, v.by]) });
  return out;
}
