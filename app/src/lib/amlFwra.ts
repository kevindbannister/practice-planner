// The firm-wide risk assessment, written from answers. It follows ACCA's template (May 2026): the six risk areas (clients, geography,
// products and services, transactions, delivery channels, proliferation financing), an overall assessment and an actions list. Facts the
// firm has already given in the policy builder are reused rather than asked again, and the client risk percentages come from the ratings
// held in the planner. The risk ratings are the firm's own judgement: nothing here rates a risk for it. Some control wording is taken
// from the firm's own draft assessment and offered as a suggestion only.
import { Answers, GAP, Opt, Q, SECTORS, SERVICES, Step, arr, fmtDate, has, join, labelOf, list, need, o, str } from "./amlBuilder";

const RAT = o(["Low", "Low"], ["Medium", "Medium"], ["High", "High"]);
const rating = (k: string, hint: string): Q => ({ k, label: "How do you rate this risk for the firm?", type: "one", need: true, options: RAT, help: hint });
const labels = (q: Q | Opt[], a: Answers, k: string) => arr(a, k).map((v) => labelOf(Array.isArray(q) ? { k: "", label: "", type: "many", options: q } : q, v));
const area = (title: string, a: Answers, rk: string, risk: string, controls: string) =>
  join([`## ${title}`, `Rating: ${str(a, rk) || GAP(`${title.toLowerCase()} rating`)}.`, risk, controls]);

const HIGH_SERVICES: Record<string, string> = {
  formation: "company formation", registered: "registered office, director, secretary or nominee services", payroll: "payroll", tax: "tax advice",
  bookkeeping: "bookkeeping, which can be used to legitimise records", accounts: "accounts preparation, which can be used to legitimise records", advisory: "business advice",
};

const CLIENT_TYPES = o(["individuals", "Individuals and sole traders"], ["companies", "Limited companies"], ["partnerships", "Partnerships and LLPs"], ["landlords", "Landlords"], ["charities", "Charities and community groups"], ["trusts", "Trusts"]);
const CLIENT_CTRL = o(["cdd", "Identify and verify the client and its beneficial owners before work starts"], ["rate", "Give every client a documented risk rating"], ["edd", "Apply enhanced due diligence to high-risk clients"], ["screen", "Screen for sanctions, PEP status and adverse information"], ["review", "Review clients periodically and when something changes"], ["train", "Train everyone who works on client files"]);
const GEO_SOURCES: Opt[] = [
  { v: "hmt", label: "HM Treasury's high-risk third countries advisory notice", url: "https://www.gov.uk/government/publications/money-laundering-advisory-notice-high-risk-third-countries--2" },
  { v: "fatf", label: "FATF's lists of high-risk and monitored jurisdictions", url: "https://www.fatf-gafi.org/en/countries/black-and-grey-lists.html" },
  { v: "sanctions", label: "The UK Sanctions List", url: "https://www.gov.uk/government/publications/the-uk-sanctions-list" },
  { v: "cpi", label: "Transparency International's Corruption Perceptions Index", url: "https://www.transparency.org/en/cpi" },
];
const SVC_CTRL = o(["accept", "Engagement acceptance and a client risk assessment before work"], ["owners", "Verify ownership, PSC and purpose for company services"], ["records", "Reconcile records to source documents and investigate unsupported entries"], ["payroll", "Check payroll changes and payment instructions through a second channel"], ["escalate", "Escalate unusual tax or company formation requests to the MLRO"], ["nominee", "Not act as a nominee or take control of client assets unless separately assessed and approved"], ["train", "Staff training covers the risks of these services"]);
const CHAN_CTRL = o(["video", "Video meetings before acceptance"], ["eid", "Electronic identity verification"], ["contact", "Check the client controls the email and phone given"], ["docs", "Additional documents for clients not met in person"], ["resolve", "Resolve any discrepancy before accepting the client"], ["access", "Restrict access to client files and review access"]);

const clientCtrlQ: Q = { k: "f_clientCtrl", label: "What do you do to reduce client risk?", type: "many", need: true, options: CLIENT_CTRL, suggest: CLIENT_CTRL.map((x) => x.v), source: "ACCA: set out what you actually do, for example when risk assessments are completed, what due diligence is done and when, and what training staff get." };
const geoSrcQ: Q = { k: "f_geoSources", label: "Which sources do you check?", type: "many", need: true, options: GEO_SOURCES, suggest: GEO_SOURCES.map((x) => x.v), source: "ACCA says the firm must consider these four sources when assessing geography." };
const svcCtrlQ: Q = { k: "f_svcCtrl", label: "What do you do to reduce the risk from these services?", type: "many", need: true, options: SVC_CTRL, suggest: ["accept", "owners", "records", "payroll", "escalate", "nominee"] };
const chanCtrlQ: Q = { k: "f_chanCtrl", label: "What do you do to reduce the risk of clients you have not met?", type: "many", options: CHAN_CTRL, suggest: ["eid", "contact", "resolve", "access"], show: (a) => a.meet === "mixed" || a.meet === "remote" };

export const FWRA_STEPS: Step[] = [
  {
    id: "f_client", title: "Client risk", covers: "Risk from the firm's clients",
    intro: "ACCA calls this the most significant section. Your earlier answers about sectors and politically exposed persons are used here, so you only add what is missing.",
    questions: [
      { k: "f_clientTypes", label: "What kinds of client do you act for?", type: "many", need: true, options: CLIENT_TYPES },
      { k: "f_mainSector", label: "What sector do most of your clients work in?", type: "text", need: true, placeholder: "For example small trading businesses and landlords", help: "ACCA's example: being familiar with the usual activity of your main sector is itself a control." },
      { k: "f_newOutside", label: "Have you taken on new clients outside your normal client base?", type: "one", need: true, options: o(["no", "No"], ["yes", "Yes"]) },
      { k: "f_history", label: "Do you know of any client with a history of criminal activity or adverse media?", type: "one", need: true, options: o(["no", "No"], ["yes", "Yes"], ["unchecked", "I haven't checked"]) },
      { k: "f_concentration", label: "Does any client make up a large share of your fees?", type: "long", placeholder: "For example three clients are each over 15% of fees", help: "Concentration is not a money laundering factor in itself, but it can make it harder to challenge a client." },
      clientCtrlQ,
      rating("f_clientRating", "ACCA expects you to explain why. A small, familiar client base can reasonably be low or medium; give your reasons in the next box."),
      { k: "f_clientWhy", label: "Explain the rating: what do your clients look like, and why does that give this rating?", type: "long", need: true,
        help: "Use the figures above. Say what kinds of client you have (individuals, small companies, trusts, higher-risk types such as politically exposed persons or complex structures), how many are rated high, and how well you know them (how long you have acted, whether you have met them). Then say why that adds up to the rating.",
        placeholder: "Low example: Mostly long-standing owner-managed companies and sole traders that we know well. Few are rated high, and none are politically exposed persons or complex structures.\nMedium example: A mix of established clients and some new start-ups. A small number involve overseas owners or trusts and are rated high." },
    ],
    write: (a) => {
      const sectors = arr(a, "sectors").map((v) => SECTORS.find((x) => x.v === v)?.label.replace(/ \(.*\)$/, "").toLowerCase() || v);
      const risk = [
        `The firm acts for ${arr(a, "f_clientTypes").length ? labels(CLIENT_TYPES, a, "f_clientTypes").join(", ").toLowerCase() : GAP("kinds of client")}${str(a, "f_mainSector") ? `. Most work in ${str(a, "f_mainSector")}` : ""}.`,
        a.sectors === undefined ? GAP("sectors the firm acts in") : sectors.length ? `Clients in sectors ACCA lists as higher risk: ${sectors.join(", ")}.` : "No clients are in the sectors ACCA lists as higher risk (cash-intensive, high-value goods, property, import and export, money service businesses, cryptocurrency, visa and immigration, investment, precious metals, charities).",
        a.pep === "no" ? "No clients, or their owners, are politically exposed persons." : a.pep === "yes" ? "Some clients, or their owners, are politically exposed persons and are treated as high risk." : a.pep === "unchecked" ? "The firm has not yet checked whether any clients are politically exposed persons. This is an action below." : GAP("politically exposed persons"),
        a.f_history === "no" ? "No client is known to have a history of criminal activity." : a.f_history === "yes" ? "At least one client has a known history of criminal activity or adverse media and is treated as high risk." : a.f_history === "unchecked" ? "The firm has not yet checked clients for criminal history or adverse media. This is an action below." : "",
        a.f_newOutside === "yes" ? "The firm has taken on new clients outside its normal client base, which are looked at more closely." : a.f_newOutside === "no" ? "No new clients have been taken on outside the firm's normal client base." : "",
        str(a, "f_concentration") ? `Fee concentration: ${str(a, "f_concentration")}.` : "",
        str(a, "f_clientWhy") || GAP("why the client risk is rated this way"),
      ].filter(Boolean).join(" ");
      return area("Client risk", a, "f_clientRating", risk, arr(a, "f_clientCtrl").length ? `To reduce it, the firm will: ${labels(clientCtrlQ, a, "f_clientCtrl").map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join("; ")}.` : GAP("how client risk is reduced"));
    },
  },
  {
    id: "f_geo", title: "Geography risk", covers: "Risk from the countries clients are linked to",
    intro: "ACCA requires enhanced due diligence for clients with links to high-risk countries, so the firm must know where its clients and their owners are linked to.",
    questions: [
      { k: "f_geoPlace", label: "Where are your clients and their owners based or doing business?", type: "text", need: true, placeholder: "For example all in the UK", help: "What you said earlier about overseas links is used below." },
      { k: "f_geoHigh", label: "Are any linked to a high-risk or sanctioned country?", type: "one", need: true, options: o(["no", "No"], ["yes", "Yes"], ["unchecked", "I haven't checked"]) },
      geoSrcQ,
      { k: "f_geoExtra", label: "What extra do you do if a client has links to a high-risk country?", type: "long", need: true, suggest: "Apply enhanced due diligence, record the countries linked to the client, its owners, funds, suppliers and customers, check the sources again at each review, and record the date and result of each check." },
      rating("f_geoRating", "ACCA: assess in depth where clients have links to, and the nature and purpose of any overseas activity."),
    ],
    write: (a) => {
      const risk = [
        `Clients and their owners are based or active in: ${need(a, "f_geoPlace", "where clients are based")}.`,
        a.overseas === "none" ? "No clients are known to have links outside the UK." : a.overseas === "few" || a.overseas === "several" ? `${a.overseas === "few" ? "A few" : "Several"} clients have links outside the UK${str(a, "overseasWhich") ? ` (${str(a, "overseasWhich")})` : ""}.` : a.overseas === "unknown" ? "The firm has not yet confirmed which clients have overseas links. This is an action below." : "",
        a.f_geoHigh === "no" ? "None are linked to a high-risk or sanctioned country." : a.f_geoHigh === "yes" ? "Some are linked to a high-risk or sanctioned country and are treated as high risk." : a.f_geoHigh === "unchecked" ? "The firm has not yet checked for links to high-risk countries. This is an action below." : GAP("links to high-risk countries"),
      ].filter(Boolean).join(" ");
      const ctrl = `${arr(a, "f_geoSources").length ? `At onboarding and whenever risk changes, the firm checks: ${labels(geoSrcQ, a, "f_geoSources").join("; ")}.` : GAP("which sources are checked")} ${str(a, "f_geoExtra") || GAP("extra checks for high-risk countries")}`;
      return area("Geography risk", a, "f_geoRating", risk, ctrl);
    },
  },
  {
    id: "f_svc", title: "Products and services risk", covers: "Risk from the services the firm offers",
    intro: "ACCA names company formation, registered office and director services, payroll, tax advice that reduces liability, and bookkeeping that could legitimise records as higher risk. Your services come from the policy builder.",
    questions: [
      { k: "f_tcsp", label: "If you provide company or trust services, what are they and for how many clients?", type: "long", show: (a) => has(a, "services", "formation") || has(a, "services", "registered"), need: true, placeholder: "For example company formation for 3 new clients a year" },
      { k: "f_standalone", label: "Is company formation offered on its own or only with ongoing services?", type: "one", show: (a) => has(a, "services", "formation"), need: true, options: o(["alone", "On its own"], ["ongoing", "Only for clients who also use ongoing services"], ["both", "Both"]) },
      svcCtrlQ,
      rating("f_svcRating", "Your draft rated this medium to high because of company formation and payroll."),
      { k: "f_svcWhy", label: "Explain the rating: which of your services could be misused, and why is the risk this level?", type: "long", need: true,
        help: "Say which services you provide and which could be used to hide where money comes from or who owns something: for example forming companies, acting as registered office, holding client money, or handling payments. Say how many clients use those services, then why that gives this rating. Ordinary accounts, tax and payroll work is usually lower risk.",
        placeholder: "Low example: We mainly provide accounts, tax and payroll. We do not hold client money or form companies for clients we do not otherwise act for.\nMedium example: As well as accounts and tax we provide registered offices and file confirmation statements for about 30 clients, and handle client money for a few." },
    ],
    write: (a) => {
      const hi = arr(a, "services").map((s) => HIGH_SERVICES[s]).filter(Boolean);
      const risk = [
        arr(a, "services").length ? `The firm provides ${arr(a, "services").map((s) => SERVICES.find((x) => x.v === s)?.label.toLowerCase() || s).join(", ")}. Services ACCA treats as attractive to criminals: ${hi.length ? [...new Set(hi)].join("; ") : "none"}.` : GAP("services provided (policy builder, first step)"),
        str(a, "f_tcsp") ? `Company or trust services: ${str(a, "f_tcsp")}.` : "",
        a.f_standalone === "alone" ? "Company formation is offered on its own, which is higher risk." : a.f_standalone === "ongoing" ? "Company formation is offered only to clients who also use ongoing services, which lowers the risk." : a.f_standalone === "both" ? "Company formation is offered on its own and with ongoing services." : "",
        has(a, "services", "registered") ? "" : "The firm does not provide a registered office service.",
        str(a, "f_svcWhy") || GAP("why the services risk is rated this way"),
      ].filter(Boolean).join(" ");
      return area("Products and services risk", a, "f_svcRating", risk, arr(a, "f_svcCtrl").length ? `To reduce it, the firm will: ${labels(svcCtrlQ, a, "f_svcCtrl").map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join("; ")}.` : GAP("how services risk is reduced"));
    },
  },
  {
    id: "f_trans", title: "Transactions risk", covers: "Risk from client money and payments",
    intro: "ACCA says client accounts are a risk in the sector, and clients should not be able to use one as a banking facility. Your earlier answer about client money is used here.",
    questions: [
      { k: "f_transUse", label: "What is the money used for, how often, and who operates it?", type: "long", show: (a) => a.clientMoney === "some", need: true },
      { k: "f_transCheck", label: "What do you check before and when money moves?", type: "long", show: (a) => a.clientMoney === "some", need: true, suggest: "Understand why the client is using the account before the transaction, check where the funds came from, and do not allow it to be used as a banking facility.", source: "ACCA: understand the rationale for the transaction before it is initiated." },
      { k: "f_payroll", label: "Do you make or authorise payroll or tax payments for clients?", type: "one", need: true, options: o(["no", "No"], ["yes", "Yes"]) },
      rating("f_transRating", "A firm that never holds or moves client money will usually rate this low."),
    ],
    write: (a) => {
      const risk = [
        a.clientMoney === "none" ? "No client money passes through the firm. Clients pay their own tax, payroll and suppliers." : a.clientMoney === "some" ? `Client money passes through the firm: ${need(a, "f_transUse", "what client money is used for")}.` : GAP("whether client money passes through the firm (policy builder, first step)"),
        a.f_payroll === "yes" ? "The firm makes or authorises some payroll or tax payments for clients, so payment instructions are a risk." : a.f_payroll === "no" ? "The firm does not make or authorise payments for clients." : "",
      ].filter(Boolean).join(" ");
      return area("Transactions risk", a, "f_transRating", risk, a.clientMoney === "some" ? str(a, "f_transCheck") || GAP("checks on client money") : "The firm will escalate any transaction without a clear commercial reason, unexplained cash, third-party payments, and unusual changes to payees or bank details.");
    },
  },
  {
    id: "f_chan", title: "Delivery channels risk", covers: "Risk from how clients are met and served",
    intro: "Clients not met face to face can be harder to identify. ACCA wants to know how many, how and why clients came to you, and what you do about it.",
    questions: [
      { k: "f_chanCount", label: "How many clients have you not met face to face?", type: "text", show: (a) => a.meet === "mixed" || a.meet === "remote", need: true },
      { k: "f_chanHow", label: "How do clients usually come to you?", type: "text", need: true, placeholder: "For example by recommendation or from the website" },
      { k: "f_tools", label: "Which platforms, portals or e-verification services do you use?", type: "long", placeholder: "For example client portal, e-signature, electronic ID provider" },
      chanCtrlQ,
      rating("f_chanRating", "A small firm that meets most clients may rate this low or medium."),
    ],
    write: (a) => {
      const risk = [
        a.meet === "face" ? "Clients are met face to face." : a.meet === "mixed" ? `Some clients are not met face to face (${str(a, "f_chanCount") || GAP("how many clients are not met")}).` : a.meet === "remote" ? `Clients are mostly not met face to face (${str(a, "f_chanCount") || GAP("how many clients are not met")}).` : GAP("how clients are met (policy builder, first step)"),
        `Clients usually come to the firm ${need(a, "f_chanHow", "how clients come to the firm")}.`,
        str(a, "f_tools") ? `Tools used: ${str(a, "f_tools")}.` : "",
      ].filter(Boolean).join(" ");
      const ctrl = a.meet === "face" ? "Because clients are met in person, identity and credibility can be checked directly. Access to client files and SAR records is restricted and reviewed." : `${arr(a, "f_chanCtrl").length ? `For clients not met in person, the firm will: ${labels(chanCtrlQ, a, "f_chanCtrl").map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join("; ")}.` : GAP("how remote clients are checked")} ${str(a, "remoteHow")}`.trim();
      return area("Delivery channels risk", a, "f_chanRating", risk, ctrl);
    },
  },
  {
    id: "f_pf", title: "Proliferation financing risk", covers: "Risk of the firm being used to enable proliferation financing",
    intro: "Every firm must assess this. ACCA says for most firms it will be low, but the firm must still write down why. It means funds or services used for weapons of mass destruction.",
    questions: [
      { k: "f_pfLinks", label: "Do any clients deal in dual-use goods, trade with sanctioned or high-risk countries, or have opaque ownership?", type: "one", need: true, options: o(["no", "No"], ["yes", "Yes"], ["unchecked", "I haven't checked"]) },
      rating("f_pfRating", "ACCA: for the majority of firms this will be low risk."),
      { k: "f_pfWhy", label: "Explain the rating: what did you look at, and what did you find?", type: "long", need: true,
        help: "Two or three sentences are enough. Say what you checked (the countries your clients are in or trade with, whether any deal in goods that could be used for weapons, how clear the ownership is, whether you screen against the UK Sanctions List) and what that showed. If you rated it low, say why it is low. If medium or high, say which clients or activities raise it. Don't name individual clients or record any suspicion here.",
        placeholder: "Low example: All clients are UK-based small businesses. None export or deal in dual-use goods, and all owners are identified. Every client is screened against the UK Sanctions List when taken on and when details change.\nMedium example: Two clients export engineering parts to countries outside the UK, so those are treated as higher risk and reviewed yearly. The rest are UK businesses with clear ownership.",
        source: "ACCA: for most firms the rating will be low, but the reasons must be written down." },
      { k: "f_pfCtrl", label: "What do you do about it?", type: "long", suggest: "Screen geography, ownership, services and transactions for links to sanctioned persons and countries and dual-use goods, keep the UK Sanctions List under review, and escalate any concern to the MLRO." },
    ],
    write: (a) => {
      const risk = [
        has(a, "sectors", "dual") ? "At least one client deals in dual-use goods." : "",
        a.f_pfLinks === "no" ? "No clients deal in dual-use goods, trade with sanctioned or high-risk countries, or have opaque ownership." : a.f_pfLinks === "yes" ? "Some clients deal in dual-use goods, trade with sanctioned or high-risk countries, or have opaque ownership and are treated as higher risk." : a.f_pfLinks === "unchecked" ? "The firm has not yet checked clients for these links. This is an action below." : GAP("links to proliferation financing indicators"),
        str(a, "f_pfWhy") || GAP("why the proliferation financing risk is rated this way"),
      ].filter(Boolean).join(" ");
      return area("Proliferation financing risk", a, "f_pfRating", risk, str(a, "f_pfCtrl") || GAP("how proliferation financing is addressed"));
    },
  },
  {
    id: "f_overall", title: "Overall assessment", covers: "Summary of the key risks and changes",
    intro: "A short summary of the risks above. The client percentages come from the risk ratings in the planner, so they are only as complete as those ratings.",
    questions: [
      { k: "f_newRisks", label: "What new risks have appeared since the last assessment?", type: "long", placeholder: "Write 'none' if there are none. For a first assessment, write 'first assessment'", need: true },
      { k: "f_lastDate", label: "Date of the last assessment, if any", type: "date" },
      { k: "f_overallRating", label: "Overall inherent risk", type: "one", need: true, options: RAT, help: "Your draft rated this medium." },
      { k: "f_conclusion", label: "Anything else to say about the firm's profile or the biggest risks?", type: "long", suggest: "This assessment is not evidence that controls have been carried out. Residual risk will be rated once the client portfolio, geographies, payment handling and the operation of the controls have been confirmed." },
    ],
    write: (a) => {
      const n = Number(a._n) || 0, hi = Number(a._high) || 0, md = Number(a._med) || 0, lo = Number(a._low) || 0, unrated = Number(a._unrated) || 0;
      const pct = (x: number) => `${Math.round((x / n) * 100)}%`;
      const rated = hi + md + lo;
      const riskier = [["Client risk", "f_clientRating"], ["Geography risk", "f_geoRating"], ["Products and services risk", "f_svcRating"], ["Transactions risk", "f_transRating"], ["Delivery channels risk", "f_chanRating"], ["Proliferation financing risk", "f_pfRating"]].filter(([, k]) => str(a, k) === "High" || str(a, k) === "Medium").map(([t]) => t.toLowerCase());
      return join([
        "## Overall assessment",
        `Overall inherent risk: ${str(a, "f_overallRating") || GAP("overall risk rating")}.`,
        rated === 0 ? (n ? GAP("client risk ratings (none are recorded in the planner yet)") : GAP("client risk ratings")) : `Of ${n} active clients, ${pct(hi)} are rated high risk, ${pct(md)} medium and ${pct(lo)} low${unrated ? `. ${unrated} ${unrated === 1 ? "has" : "have"} no approved rating yet` : ""}.`,
        str(a, "f_lastDate") ? `The last assessment was on ${fmtDate(str(a, "f_lastDate"))}. New risks since then: ${need(a, "f_newRisks", "new risks")}` : `This is the first assessment on record. ${str(a, "f_newRisks") ? `Note: ${str(a, "f_newRisks")}` : ""}`.trim(),
        str(a, "f_mainSector") ? `Most clients work in ${str(a, "f_mainSector")}, so the firm knows the usual activity and services.` : "",
        riskier.length ? `The areas rated medium or high, and so the biggest risks to the firm, are: ${riskier.join(", ")}.` : "No area is rated above low.",
        str(a, "f_conclusion"),
      ]);
    },
  },
  {
    id: "f_actions", title: "Actions and sign-off", covers: "Actions, who did the assessment, and when it is next reviewed",
    intro: "ACCA ends with a short list of actions, who carried out the assessment, who it was shared with and when it is next reviewed.",
    questions: [
      { k: "f_by", label: "Who carried out the assessment?", type: "text", need: true, suggest: "The MLRO" },
      { k: "f_shared", label: "Who was it shared with?", type: "text", need: true, suggest: "The director", placeholder: "For example the partners and directors" },
      { k: "f_next", label: "Next review date", type: "date", need: true, help: "ACCA: at least yearly, and when a trigger event happens." },
      { k: "f_actReview", label: "Annual compliance review (MLRO report) due", type: "date" },
      { k: "f_actTrain", label: "AML training due", type: "date" },
      { k: "f_actPol", label: "Review of AML policies and procedures due", type: "date" },
      { k: "f_actOther", label: "Other actions, one per line, with an owner and date", type: "long", placeholder: "For example Confirm countries for every client. Owner: MLRO. By 31 January 2027" },
    ],
    write: (a) => {
      const acts = [
        ["Perform annual compliance review (MLRO report)", "f_actReview"], ["Conduct AML training", "f_actTrain"], ["Review AML policies and procedures", "f_actPol"],
      ].map(([t, k]) => `${t}, due ${str(a, k) ? fmtDate(str(a, k)) : GAP(`date for ${t.toLowerCase()}`)}, owner ${str(a, "f_by").replace(/^The /, "the ") || "the MLRO"}`);
      acts.push(`Keep a copy of this assessment on file when the next one is done`);
      const other = str(a, "f_actOther").split(/\n+/).map((x) => x.trim()).filter(Boolean);
      return join([
        "## Actions",
        list([...acts, ...other]),
        "## Sign-off",
        `Assessment carried out by ${need(a, "f_by", "who carried out the assessment")}. Shared with ${need(a, "f_shared", "who it was shared with").replace(/^The /, "the ")}. Completed on ${str(a, "_date") ? fmtDate(str(a, "_date")) : GAP("assessment date (choose it at the top of the page)")}. Next review: ${str(a, "f_next") ? fmtDate(str(a, "f_next")) : GAP("next review date")}.`,
      ].filter(Boolean) as string[]);
    },
  },
];
