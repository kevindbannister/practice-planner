// AI writing bridge for Practice Planner: drafts and amends letters and emails with OpenAI.
//
// The OpenAI key lives in the Azure setting OPENAI_API_KEY and never reaches the browser.
// Only Kevin's Microsoft sign-in for this app can use it (see ../shared/signin.js).
//
//   GET  /api/ai/status  -> { configured, model, models }
//   POST /api/ai/write   -> { subject, body, model }
//        { kind: "letter" | "email", mode: "draft" | "amend", brief?, instruction?,
//          current?: { subject, body }, context?: {...}, style?, model? }
//
// What's sent to OpenAI: the brief or the change asked for, the current text when amending,
// and the client details the app passes in context (names, address, jobs and deadlines).

const { createSignIn, reply } = require("../shared/signin.js");

const OPENAI = "https://api.openai.com/v1";
// tried in this order when no model is chosen in Settings or OPENAI_MODEL
const PREFERRED = ["gpt-5-mini", "gpt-5.1-mini", "gpt-5", "gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"];
const NOT_TEXT = /audio|realtime|image|dall|tts|transcribe|whisper|embedding|search|moderation|codex|computer|instruct|vision|preview/i;
const EFFORTS = ["minimal", "low", "medium", "high"];
const MODELS_FOR_MS = 60 * 60 * 1000;

const LIMITS = { brief: 4000, instruction: 2000, style: 2000, subject: 300, body: 20000, context: 20000 };

const SYSTEM = [
  "You write letters and emails for a small UK accountancy and advisory practice, to send to its clients.",
  "Use British English and UK accounting and tax terms (HMRC, Companies House, Self Assessment, corporation tax, year end).",
  "Be clear, warm and professional; plain words, short paragraphs, no jargon the client wouldn't know.",
  "Use only facts given to you. Never invent figures, fees, dates, deadlines, reference numbers or tax rules. Where something needed isn't given, write a placeholder in square brackets, such as [amount] or [date], for the accountant to fill in.",
  "Format the body as plain text: paragraphs separated by a blank line; bullet points as lines starting with \"- \"; **bold** only for the odd key phrase. No headings, no markdown links, no tables.",
  "For a letter, write only the body: no addresses, date, \"Dear ...\" line, subject line or sign-off. Those are added separately.",
  "For an email, start with a greeting line (for example \"Hi Tristan,\" or \"Dear Mr Walters,\", matching the salutation given) and end with a short sign-off and the sender's first name; leave out any signature block.",
  "When asked to change existing text, make that change and keep everything else as it was unless the change needs it.",
  "Reply with a JSON object only: {\"subject\": \"...\", \"body\": \"...\"}. The subject is a short, specific subject line.",
].join("\n");

const SYSTEM_ASSIST = [
  "You are the assistant inside Practice Planner, the planner a sole UK accountant uses to run his day. You answer questions about his work and propose changes to the planner.",
  "You are given a JSON snapshot: today's date, today's kind of day, his plan for today with reasons, open jobs and tasks (each with a key), clients, business projects, kinds of day, and recently finished work.",
  "Use British English. Be brief and direct. Use only the snapshot: never invent work, clients, dates or figures. If you aren't sure which item is meant, ask in your reply instead of guessing.",
  "Propose changes only when he asks for something to be changed or created. He approves each one before anything happens, so propose exactly what he asked for and no more.",
  "Dates are YYYY-MM-DD. Work out \"tomorrow\", \"Friday\", \"next week\" from today's date in the snapshot. Refer to items and clients only by the keys in the snapshot.",
  "Reply with a JSON object only: {\"reply\": \"...\", \"actions\": [...]}. actions may be empty. Each action is one of:",
  "{\"type\":\"create_task\",\"title\":\"...\",\"client\":\"client key, optional\",\"project\":\"project key, optional\",\"planned\":\"date, optional\",\"due\":\"date, optional\",\"hours\":number optional}",
  "{\"type\":\"plan\",\"item\":\"item key\",\"date\":\"date\"}  (plan it on a day)",
  "{\"type\":\"set_waiting\",\"item\":\"item key\",\"on\":\"Client|HMRC|Companies House|Someone else\",\"until\":\"chase date\",\"reason\":\"optional\"}",
  "{\"type\":\"resume\",\"item\":\"item key\"}  (take it off hold or stop waiting)",
  "{\"type\":\"set_day_type\",\"date\":\"date\",\"dayType\":\"kind-of-day key\"}",
  "{\"type\":\"log_time\",\"item\":\"item key\",\"hours\":number}",
  "{\"type\":\"set_urgent\",\"item\":\"item key\",\"urgent\":true or false}",
].join("\n");

const ASSIST_TYPES = {
  create_task: ["title"], plan: ["item", "date"], set_waiting: ["item", "on", "until"], resume: ["item"],
  set_day_type: ["date", "dayType"], log_time: ["item", "hours"], set_urgent: ["item", "urgent"],
};
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const WAIT_ON = ["Client", "HMRC", "Companies House", "Someone else"];

/** Pull {reply, actions} out of the model's answer, keeping only actions that are complete and well formed. */
function parseAssist(text) {
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = typeof text === "string" && text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        obj = null;
      }
    }
  }
  if (!obj || typeof obj.reply !== "string") return null;
  const actions = [];
  for (const a of Array.isArray(obj.actions) ? obj.actions.slice(0, 10) : []) {
    if (!a || !ASSIST_TYPES[a.type]) continue;
    const need = ASSIST_TYPES[a.type];
    if (need.some((f) => a[f] === undefined || a[f] === null || a[f] === "")) continue;
    const out = { type: a.type };
    for (const f of ["item", "client", "project", "title", "reason", "dayType"]) if (typeof a[f] === "string" && a[f].trim()) out[f] = a[f].trim().slice(0, 300);
    for (const f of ["date", "planned", "due", "until"]) if (isDate(a[f])) out[f] = a[f];
    if (typeof a.on === "string" && WAIT_ON.includes(a.on)) out.on = a.on;
    if (typeof a.urgent === "boolean") out.urgent = a.urgent;
    const h = Number(a.hours);
    if (Number.isFinite(h) && h > 0 && h <= 24) out.hours = h;
    if (need.some((f) => out[f] === undefined)) continue; // a needed field was malformed
    actions.push(out);
  }
  return { reply: obj.reply.trim(), actions };
}

/** The messages for one chat turn: the system prompt, a little history, then the snapshot and question. */
function assistMessages(b) {
  const history = (Array.isArray(b.history) ? b.history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-8)
    .map((m) => ({ role: m.role, content: clip(m.content, 1500) }));
  const snapshot = JSON.stringify(b.context && typeof b.context === "object" ? b.context : {}).slice(0, 60000);
  return [
    { role: "system", content: SYSTEM_ASSIST },
    ...history,
    { role: "user", content: `Snapshot of the planner:\n${snapshot}\n\nHis message: ${clip(b.message, 2000)}` },
  ];
}

const SYSTEM_EMAILS = [
  "You help a sole UK accountant decide which of his recent emails need him to do something. For each email you get its id, sender, client (if known), subject and a short preview.",
  "Use British English. Use only what is given: never invent facts. Judge from the subject and preview whether the email asks for work, a reply, or a decision from him (needsAction true), or is just information, thanks or marketing (false).",
  "For ones that need action give a short task title that starts with a verb (for example \"Send Acme the VAT figures\"), a due date as YYYY-MM-DD only if the email states or clearly implies one, an estimate in hours (0.25 to 4) and a few words on why.",
  "Reply with a JSON object only: {\"emails\": [{\"id\": \"...\", \"needsAction\": true, \"title\": \"...\", \"due\": \"YYYY-MM-DD\", \"hours\": 0.5, \"why\": \"...\"}]} with one entry per email given.",
].join("\n");

/** The AI's verdicts on a batch of emails, checked: only ids that were asked about, sensible values. */
function parseEmails(text, ids) {
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = typeof text === "string" && text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        obj = null;
      }
    }
  }
  if (!obj || !Array.isArray(obj.emails)) return null;
  const out = [];
  for (const e of obj.emails) {
    if (!e || typeof e.id !== "string" || !ids.includes(e.id) || typeof e.needsAction !== "boolean") continue;
    const v = { id: e.id, needsAction: e.needsAction };
    if (typeof e.title === "string" && e.title.trim()) v.title = e.title.trim().slice(0, 140);
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.due || "")) v.due = e.due;
    const h = Number(e.hours);
    if (Number.isFinite(h) && h >= 0.25 && h <= 8) v.hours = h;
    if (typeof e.why === "string" && e.why.trim()) v.why = e.why.trim().slice(0, 160);
    out.push(v);
  }
  return out;
}

function emailsMessage(b) {
  const list = (Array.isArray(b.emails) ? b.emails : []).slice(0, 20).map((e) => ({
    id: clip(e && e.id, 300), from: clip(e && e.from, 120), client: clip(e && e.client, 120), subject: clip(e && e.subject, 200),
    preview: clip(e && e.preview, 240), received: clip(e && e.received, 10),
  })).filter((e) => e.id);
  return { list, text: `Today is ${clip(b.today, 10)}.\nEmails:\n${JSON.stringify(list, null, 1)}` };
}


// Reading a past Self Assessment return: the PDFs' text in, the return's figures out. The figures must be printed in the text
// (the planner checks that), and the document's own income tax total is returned so the planner can check its calculation.
const TAX_READ_LIMIT = 150000;
const TAX_READ_SYSTEM = [
  "You read the text of a UK Self Assessment return printed by IRIS Elements (the tax calculation, the detailed summaries, the capital gains computation and the return pages) and fill in the figures for an accountant's planner.",
  "Use only figures printed in the text. Never calculate, estimate or invent a figure: if a figure isn't printed, leave it out. Give amounts as plain numbers (pounds and pence, no £ or commas). Give an amount in brackets as a positive number, unless the field below says it can be negative.",
  "Dates are YYYY-MM-DD. Names, UTRs and PAYE references are text, copied exactly.",
  "Reply with a JSON object only: {\"return\": {...}, \"totals\": {...}}. Every field is optional; leave out what the text doesn't give.",
  "return fields:",
  "front: {region: \"england\"|\"scotland\"|\"wales\", utr, nino, dob}",
  "employments: [{name, paye, pay, tax, tips, director, closeCompany, studentLoanDeducted, postgradDeducted, benefits: {car, fuel, van, vanFuel, medical, loans, accommodation, mileage, other}, expenses: {travel, fixed, professional, other}}]",
  "selfEmployments: [{name, description, start, end, turnover, otherIncome, expenses, disallowable, capitalAllowances, balancingCharges, tradingAllowance (true or false), transitionProfit, lossesBf, lossSideways, cis, taxDeducted, expenseItems: [{label, amount, box: \"11\"..\"19\"}]}]. Box 11 cost of goods, 12 motor and travel, 13 wages, 14 rent, rates, power and insurance, 15 repairs, 16 accountancy, legal and professional, 17 interest and financial charges, 18 telephone, stationery and office, 19 other.",
  "partnerships: [{name, utr, profit, lossesBf, transitionProfit, savings, dividends, taxDeducted, cis}]",
  "nic: {exempt, voluntaryClass2, class1Earnings}",
  "interest: [{payer, accountNumber, untaxed (gross), net, taxTaken, foreign (true or false), foreignTax}] - one entry per account, not a total",
  "dividends: [{company, amount, foreign, foreignTax}]; otherDividends: {stock, bonus, loansWrittenOff}",
  "property: {income, otherIncome, premiums, rates, repairs, finance, legal, services, travel, other, replacingItems, capitalAllowances, privateUse, balancingCharges, propertyAllowance (true or false), rentARoom, lossesBf, financeBf, taxTaken}",
  "pensions: {state, stateLumpSum, stateLumpSumTax, others: [{payer, amount (gross), tax (taken off), net}]}",
  "benefits: {jsa, esa, incapacity, incapacityTax, carers, bereavement, other}; otherIncome: {amount, taxTaken, description}; foreign: {property, pensions, other, foreignTax}",
  "gains: [{description, kind: \"residential\"|\"shares\"|\"other\"|\"crypto\", date, proceeds, cost (allowable costs, after any relief), badr (true or false), ir (true or false)}]; gainsLossesBf",
  "reliefs: {pensionRas (relief at source paid in), pensionGross, giftAid, giftAidCarriedBack, eis, seis, vct, loanInterest, maintenance}; charityGifts",
  "allowances: {marriage: \"none\"|\"transfer\"|\"receive\", blind (true or false)}; studentLoan: {plans: [\"plan1\"|\"plan2\"|\"plan4\"|\"plan5\"], postgrad (true or false)}",
  "childBenefit: {amount, children, weeks}; winterFuel: {amount}",
  "payments: {poa1 (first payment on account made), poa2 (second made), priorLiability, earlierYearInCode, propertyReturnTax, credits: [{date, description, amount}]}",
  "totals: the figures the document itself gives for the tax, to check the planner's calculation: {incomeTaxDue (\"Income Tax due after allowances and reliefs\"), balancing (\"Balancing payment due\", positive when to pay), poaNext1 and poaNext2 (the payments on account due next year)}. Only figures printed in the text.",
].join("\n");

const TAX_READ_STRINGS = new Set(["utr", "nino", "paye", "accountNumber", "name", "payer", "company", "description", "label", "dob", "start", "end", "date", "region", "marriage", "kind", "box", "plans", "from", "key"]);

/** The return and totals the AI gave, kept to plain values: only the numbers, texts and lists the planner's fields hold. */
function parseTaxRead(text) {
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = typeof text === "string" && text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        obj = null;
      }
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const clean = (v, key, depth) => {
    if (depth > 6 || v === null || v === undefined) return undefined;
    if (typeof v === "string") {
      const t = v.trim().slice(0, 300);
      if (!t) return undefined;
      // amounts are sizes: brackets and minus signs are how the document shows tax taken off, not a negative figure
      if (!TAX_READ_STRINGS.has(key) && /^\(?-?£?\s?[\d,]+(\.\d+)?\)?$/.test(t)) return Math.abs(Number(t.replace(/[(),£\s-]/g, "")));
      return t;
    }
    if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
    if (typeof v === "boolean") return v;
    if (Array.isArray(v)) return v.slice(0, 200).map((x) => clean(x, key, depth + 1)).filter((x) => x !== undefined);
    if (typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v).slice(0, 80)) {
        const c = clean(x, k, depth + 1);
        if (c !== undefined) out[k] = c;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return undefined;
  };
  const ret = clean(obj.return || {}, "", 0) || {};
  const totals = {};
  for (const [k, v] of Object.entries(clean(obj.totals || {}, "", 0) || {})) if (typeof v === "number") totals[k] = v;
  return { ret, totals };
}

const SYSTEM_BANK = [
  "You sort the transactions on a UK limited company's bank statement into accounting categories, for an accountant preparing working papers from manual records.",
  "You are given the categories (key, name, what it means) and a list of transactions: an id, the description, the bank's own type and category label, and the amount (positive is money in, negative is money out).",
  "Choose exactly one category key for each transaction, using only the keys given. If you can't tell what it is, use \"suspense\" rather than guessing, and say why.",
  "Think as a UK accountant: payments to a director with salary in the description are directors' remuneration; payments to HMRC need the reference to tell PAYE, VAT or corporation tax apart (use \"suspense\" if it isn't clear); money in from customers is sales; transfers between the company's own accounts are \"transfer\".",
  "Reply with a JSON object only: {\"items\": [{\"id\": \"...\", \"cat\": \"key\", \"why\": \"a few words\"}]} with one entry per transaction.",
].join("\n");

/** The AI's categories for a batch of transactions, checked: only ids asked about and category keys given. */
function parseBank(text, ids, keys) {
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = typeof text === "string" && text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        obj = null;
      }
    }
  }
  if (!obj || !Array.isArray(obj.items)) return null;
  const out = [];
  for (const e of obj.items) {
    if (!e || typeof e.id !== "string" || !ids.includes(e.id) || typeof e.cat !== "string" || !keys.includes(e.cat)) continue;
    const v = { id: e.id, cat: e.cat };
    if (typeof e.why === "string" && e.why.trim()) v.why = e.why.trim().slice(0, 120);
    out.push(v);
  }
  return out;
}

function bankMessage(b) {
  const cats = (Array.isArray(b.categories) ? b.categories : []).slice(0, 60).map((c) => ({ key: clip(c && c.key, 30), name: clip(c && c.name, 60), hint: clip(c && c.hint, 140) })).filter((c) => c.key);
  const list = (Array.isArray(b.items) ? b.items : []).slice(0, 80).map((t) => ({
    id: clip(t && t.id, 60), description: clip(t && t.detail, 140), type: clip(t && t.type, 40), bankLabel: clip(t && t.bankCategory, 40), amount: Number(t && t.amount) || 0,
  })).filter((t) => t.id);
  return { cats, list, text: `Company: ${clip(b.company, 120)}${b.business ? ` (${clip(b.business, 120)})` : ""}\nCategories:\n${JSON.stringify(cats)}\nTransactions:\n${JSON.stringify(list, null, 1)}` };
}

const SYSTEM_MEETING = [
  "You tidy up an accountant's rough notes from a meeting or call with a client of a small UK accountancy and advisory practice.",
  "Use British English. Use only what the notes say: never invent figures, dates, decisions or actions. Keep names, amounts and dates exactly as written.",
  "Write a short summary in plain sentences (a few short paragraphs at most), addressed to nobody in particular, that the accountant could send to the client.",
  "List the decisions made, each as one short sentence.",
  "List the actions, each with who does it (\"me\" for the accountant, \"client\" for the client, or a name if the notes say someone else) and a due date as YYYY-MM-DD only if the notes give one or make it clear (otherwise leave it out).",
  "Reply with a JSON object only: {\"summary\": \"...\", \"decisions\": [\"...\"], \"actions\": [{\"text\": \"...\", \"who\": \"me\", \"due\": \"YYYY-MM-DD\"}]}.",
].join("\n");

function meetingMessage(b) {
  const parts = [];
  if (b.style) parts.push(`The practice's house style and details:\n${clip(b.style, LIMITS.style)}`);
  if (b.context && typeof b.context === "object") parts.push(`Client details:\n${JSON.stringify(b.context, null, 1).slice(0, LIMITS.context)}`);
  const m = b.meeting || {};
  parts.push(`Meeting: ${clip(m.title, 200)} on ${clip(m.when, 40)} (${clip(m.kind, 20)}). Present: ${clip(m.attendees, 300)}`);
  const agenda = Array.isArray(m.agenda) ? m.agenda.slice(0, 30) : [];
  if (agenda.length) parts.push("Notes under each agenda item:\n" + agenda.map((a) => `## ${clip(a && a.item, 200)}\n${clip(a && a.notes, 4000)}`).join("\n\n"));
  if (m.notes) parts.push(`Other notes:\n${clip(m.notes, LIMITS.body)}`);
  return parts.join("\n\n");
}

/** Pull {summary, decisions, actions} out of the model's answer. */
function parseMeeting(text) {
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = typeof text === "string" && text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        obj = null;
      }
    }
  }
  if (!obj || typeof obj.summary !== "string") return null;
  const decisions = Array.isArray(obj.decisions) ? obj.decisions.filter((d) => typeof d === "string" && d.trim()).map((d) => d.trim()) : [];
  const actions = Array.isArray(obj.actions)
    ? obj.actions
        .filter((a) => a && typeof a.text === "string" && a.text.trim())
        .map((a) => ({ text: a.text.trim(), who: typeof a.who === "string" && a.who.trim() ? a.who.trim() : "me", due: typeof a.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : "" }))
    : [];
  return { summary: obj.summary.trim(), decisions, actions };
}

function clip(v, n) {
  return typeof v === "string" ? v.slice(0, n) : "";
}

/** The prompt for one request, as the user message. */
function userMessage(b) {
  const parts = [`Type: ${b.kind === "email" ? "email" : "letter"}`];
  if (b.style) parts.push(`The practice's house style and details:\n${clip(b.style, LIMITS.style)}`);
  if (b.context && typeof b.context === "object") {
    const ctx = JSON.stringify(b.context, null, 1);
    parts.push(`Client details:\n${ctx.slice(0, LIMITS.context)}`);
  }
  if (b.mode === "amend") {
    parts.push(`Current subject: ${clip(b.current && b.current.subject, LIMITS.subject)}`);
    parts.push(`Current text:\n${clip(b.current && b.current.body, LIMITS.body)}`);
    parts.push(`Change to make: ${clip(b.instruction, LIMITS.instruction)}`);
  } else {
    parts.push(`What it's about: ${clip(b.brief, LIMITS.brief)}`);
  }
  return parts.join("\n\n");
}

/** Pull {subject, body} out of the model's answer, even if it wrapped the JSON in other text. */
function parseAnswer(text) {
  if (typeof text !== "string") return null;
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        obj = null;
      }
    }
  }
  if (!obj || typeof obj.body !== "string") return null;
  return { subject: typeof obj.subject === "string" ? obj.subject.trim() : "", body: obj.body.replace(/\r\n/g, "\n").trim() };
}

function pickModel(models, asked, env) {
  const usable = (m) => !models || models.includes(m);
  if (asked && usable(asked)) return asked;
  const set = (env.OPENAI_MODEL || "").trim();
  if (set && usable(set)) return set;
  if (models) {
    const pref = PREFERRED.find((m) => models.includes(m));
    if (pref) return pref;
    if (models.length) return models[0];
  }
  return set || PREFERRED[0];
}

function createHandler({ fetch = globalThis.fetch, env = process.env, now = () => Date.now() } = {}) {
  const signedIn = createSignIn({ fetch, now });
  let modelCache = null; // { at, list }

  async function listModels(key) {
    if (modelCache && now() - modelCache.at < MODELS_FOR_MS) return modelCache.list;
    try {
      const res = await fetch(`${OPENAI}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const json = await res.json();
      const list = (json.data || [])
        .map((m) => String(m.id))
        .filter((id) => /^(gpt-|o\d)/.test(id) && !NOT_TEXT.test(id))
        .sort();
      modelCache = { at: now(), list };
      return list;
    } catch {
      return null;
    }
  }

  async function complete(key, model, message, system = SYSTEM, messages, effort = "low") {
    const base = {
      model,
      messages: messages || [{ role: "system", content: system }, { role: "user", content: message }],
      response_format: { type: "json_object" },
    };
    // reasoning models answer faster with low effort; others don't take the option
    const attempts = [{ ...base, reasoning_effort: effort }, base, { model, messages: base.messages }];
    let last;
    for (const body of attempts) {
      last = await fetch(`${OPENAI}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(effort === "high" || effort === "medium" ? 120000 : 40000),
      });
      if (last.status !== 400) return last;
      const err = await last.clone().json().catch(() => ({}));
      const msg = String((err.error && (err.error.param || err.error.message)) || "");
      if (!/reasoning|response_format|json/i.test(msg)) return last;
    }
    return last;
  }

  return async function handler(context, req) {
    const action = String((context.bindingData && context.bindingData.action) || (req.params && req.params.action) || "").toLowerCase();
    const key = (env.OPENAI_API_KEY || "").trim();

    let ok = false;
    try {
      ok = await signedIn(req);
    } catch {
      ok = false;
    }
    if (!ok) {
      context.res = reply(401, { error: "unauthorised", message: "Sign in to Practice Planner again." });
      return;
    }

    if (action === "status" && (req.method || "GET").toUpperCase() === "GET") {
      const taxRead = env.TAX_AI_IMPORT === "on";
      if (!key) {
        context.res = reply(200, { configured: false, taxRead });
        return;
      }
      const models = await listModels(key);
      const asked = req.query && typeof req.query.model === "string" ? req.query.model : "";
      context.res = reply(200, { configured: true, taxRead, keyAccepted: models !== null, model: pickModel(models, asked, env), models: models || [] });
      return;
    }

    if (action !== "write" && action !== "assist" && action !== "emails" && action !== "bank" && action !== "taxread") {
      context.res = reply(400, { error: "bad-request", message: "That isn't something this app asks for." });
      return;
    }
    if ((req.method || "").toUpperCase() !== "POST") {
      context.res = reply(400, { error: "bad-request", message: "That isn't something this app asks for." });
      return;
    }
    if (action === "taxread" && env.TAX_AI_IMPORT !== "on") {
      context.res = reply(503, { error: "disabled", message: "The AI reading of past returns isn't switched on (setting TAX_AI_IMPORT)." });
      return;
    }
    if (!key) {
      context.res = reply(503, { error: "not-configured", message: "The OpenAI key hasn't been added to Azure yet (setting OPENAI_API_KEY)." });
      return;
    }

    const b = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
    if (action === "taxread") {
      const files = Array.isArray(b && b.files) ? b.files.slice(0, 12) : [];
      let text = "";
      for (const f of files) {
        if (!f || typeof f.name !== "string" || !Array.isArray(f.pages)) continue;
        text += `\n=== FILE ${clip(f.name, 200)}\n`;
        f.pages.forEach((page, i) => {
          if (!Array.isArray(page) || !page.length) return;
          text += `--- page ${i + 1}\n${page.map((l) => clip(l, 400)).join("\n")}\n`;
        });
      }
      if (!text.trim()) {
        context.res = reply(400, { error: "bad-request", message: "No return text to read." });
        return;
      }
      if (text.length > TAX_READ_LIMIT) {
        context.res = reply(413, { error: "too-long", message: "The return is too long to read in one go. Bring in the calculation and summaries separately." });
        return;
      }
      const model = pickModel(await listModels(key), typeof b.model === "string" && /^[a-z0-9.\-:_]{1,64}$/i.test(b.model) ? b.model : "", env);
      let r;
      try {
        // minimal effort keeps the answer inside the 45-second limit Azure puts on the API (the model is cut off at 40 seconds first)
        r = await complete(key, model, text, TAX_READ_SYSTEM, undefined, "minimal");
      } catch (e) {
        const timeout = e && (e.name === "TimeoutError" || e.name === "AbortError");
        context.res = reply(timeout ? 504 : 502, { error: timeout ? "timeout" : "unreachable", message: timeout ? "The AI took too long to read the return. Try again." : "The AI didn't answer. Try again shortly." });
        return;
      }
      if (!r.ok) {
        context.res = reply(502, { error: "upstream", status: r.status, message: `The AI returned an error (${r.status}).` });
        return;
      }
      const j = await r.json();
      const read = parseTaxRead(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
      if (!read) {
        context.res = reply(502, { error: "bad-answer", message: "The AI's answer couldn't be read. Try again." });
        return;
      }
      context.res = reply(200, { ...read, model, chars: text.length });
      return;
    }
    const effort = b && EFFORTS.includes(b.effort) ? b.effort : "low";
    const assist = action === "assist";
    if (action === "bank") {
      const pack = bankMessage(b || {});
      if (!pack.list.length || !pack.cats.length) {
        context.res = reply(400, { error: "bad-request", message: "No transactions to sort." });
        return;
      }
      const model = pickModel(await listModels(key), typeof b.model === "string" && /^[a-z0-9.\-:_]{1,64}$/i.test(b.model) ? b.model : "", env);
      let r;
      try {
        r = await complete(key, model, pack.text, SYSTEM_BANK, undefined, effort);
      } catch (e) {
        const timeout = e && (e.name === "TimeoutError" || e.name === "AbortError");
        context.res = reply(timeout ? 504 : 502, { error: timeout ? "timeout" : "unreachable", message: timeout ? "OpenAI took too long to answer. Try again." : "OpenAI didn't answer. Try again shortly." });
        return;
      }
      if (!r.ok) {
        context.res = reply(502, { error: "upstream", status: r.status, message: `OpenAI returned an error (${r.status}).` });
        return;
      }
      const j = await r.json();
      const items = parseBank(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content, pack.list.map((t) => t.id), pack.cats.map((c) => c.key));
      if (!items) {
        context.res = reply(502, { error: "bad-answer", message: "OpenAI's answer couldn't be read. Try again." });
        return;
      }
      context.res = reply(200, { items, model });
      return;
    }
    if (action === "emails") {
      const pack = emailsMessage(b || {});
      if (!pack.list.length) {
        context.res = reply(400, { error: "bad-request", message: "No emails to look at." });
        return;
      }
      const model = pickModel(await listModels(key), typeof b.model === "string" && /^[a-z0-9.\-:_]{1,64}$/i.test(b.model) ? b.model : "", env);
      let r;
      try {
        r = await complete(key, model, pack.text, SYSTEM_EMAILS, undefined, effort);
      } catch (e) {
        const timeout = e && (e.name === "TimeoutError" || e.name === "AbortError");
        context.res = reply(timeout ? 504 : 502, { error: timeout ? "timeout" : "unreachable", message: timeout ? "OpenAI took too long to answer. Try again." : "OpenAI didn't answer. Try again shortly." });
        return;
      }
      if (!r.ok) {
        context.res = reply(502, { error: "upstream", status: r.status, message: `OpenAI returned an error (${r.status}).` });
        return;
      }
      const j = await r.json();
      const verdicts = parseEmails(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content, pack.list.map((e) => e.id));
      if (!verdicts) {
        context.res = reply(502, { error: "bad-answer", message: "OpenAI's answer couldn't be read. Try again." });
        return;
      }
      context.res = reply(200, { emails: verdicts, model });
      return;
    }
    if (assist && !clip(b && b.message, 2000).trim()) {
      context.res = reply(400, { error: "bad-request", message: "Type what you want to ask or change." });
      return;
    }
    const meeting = !assist && !!b && b.kind === "meeting" && b.mode === "tidy";
    if (meeting) {
      const m = b.meeting || {};
      const hasNotes = (typeof m.notes === "string" && m.notes.trim()) || (Array.isArray(m.agenda) && m.agenda.some((a) => a && typeof a.notes === "string" && a.notes.trim()));
      if (!hasNotes) {
        context.res = reply(400, { error: "bad-request", message: "Add some notes first." });
        return;
      }
    } else if (assist) {
      /* checked above */
    } else if (!b || !["letter", "email"].includes(b.kind) || !["draft", "amend"].includes(b.mode)) {
      context.res = reply(400, { error: "bad-request", message: "Say whether it's a letter or an email, and a draft or a change." });
      return;
    }
    if (b.mode === "draft" && !clip(b.brief, LIMITS.brief).trim()) {
      context.res = reply(400, { error: "bad-request", message: "Say what the letter or email is about." });
      return;
    }
    if (b.mode === "amend" && (!clip(b.instruction, LIMITS.instruction).trim() || !clip(b.current && b.current.body, LIMITS.body).trim())) {
      context.res = reply(400, { error: "bad-request", message: "Say what to change, with the text to change." });
      return;
    }
    const asked = typeof b.model === "string" && /^[a-z0-9.\-:_]{1,64}$/i.test(b.model) ? b.model : "";
    const model = pickModel(await listModels(key), asked, env);

    let res;
    try {
      res = assist
        ? await complete(key, model, "", SYSTEM_ASSIST, assistMessages(b), effort)
        : meeting ? await complete(key, model, meetingMessage(b), SYSTEM_MEETING, undefined, effort) : await complete(key, model, userMessage(b), SYSTEM, undefined, effort);
    } catch (e) {
      const timeout = e && (e.name === "TimeoutError" || e.name === "AbortError");
      context.res = reply(timeout ? 504 : 502, {
        error: timeout ? "timeout" : "unreachable",
        message: timeout ? "OpenAI took too long to answer. Try again, or choose a faster model in Settings." : "OpenAI didn't answer. Try again shortly.",
      });
      return;
    }

    if (res.ok) {
      const json = await res.json();
      const text = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
      const answer = assist ? parseAssist(text) : meeting ? parseMeeting(text) : parseAnswer(text);
      if (!answer) {
        context.res = reply(502, { error: "bad-answer", message: "OpenAI's answer couldn't be read. Try again." });
        return;
      }
      context.res = reply(200, { ...answer, model });
      return;
    }
    const err = await res.json().catch(() => ({}));
    const code = (err.error && err.error.code) || "";
    if (res.status === 401) {
      context.res = reply(502, { error: "key-rejected", message: "OpenAI didn't accept the API key in Azure." });
    } else if (res.status === 429 && code === "insufficient_quota") {
      context.res = reply(402, { error: "no-credit", message: "The OpenAI account has run out of credit. Add credit at platform.openai.com › Billing." });
    } else if (res.status === 429) {
      context.res = reply(429, { error: "rate-limited", message: "OpenAI is busy. Try again in a minute." });
    } else if (res.status === 404 || code === "model_not_found") {
      context.res = reply(502, { error: "model", message: `OpenAI doesn't offer the model "${model}" to this account. Choose another in Settings › Letters and email.` });
    } else {
      const detail = String((err.error && err.error.message) || "").slice(0, 200);
      context.res = reply(502, { error: "upstream", status: res.status, message: `OpenAI returned an error (${res.status})${detail ? `: ${detail}` : "."}` });
    }
  };
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.parseAnswer = parseAnswer;
module.exports.userMessage = userMessage;
module.exports.pickModel = pickModel;
module.exports.parseMeeting = parseMeeting;
module.exports.parseAssist = parseAssist;
module.exports.parseEmails = parseEmails;
module.exports.parseBank = parseBank;
module.exports.parseTaxRead = parseTaxRead;
module.exports.assistMessages = assistMessages;
