// The Companies House XML Gateway: building the message envelope, sending it, and reading what comes back.
//
// A message is a GovTalk envelope with the presenter's ID and a hash of their authentication code (never the code itself), a unique
// submission number, and the form in the body. The gateway acknowledges it at once; Companies House then reviews it and the answer
// is asked for separately with the same submission number.
const crypto = require("node:crypto");
const { FORMS, esc } = require("./forms.js");

const TEST_URL = "https://xmlgw.companieshouse.gov.uk/v1-0/xmlgw/Gateway";
const ENVELOPE_NS = "http://www.govtalk.gov.uk/CM/envelope";

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

function settings(env) {
  const id = String(env.CH_PRESENTER_ID || "").trim();
  const auth = String(env.CH_PRESENTER_AUTH || "").trim();
  const missing = [];
  if (!id) missing.push("CH_PRESENTER_ID");
  if (!auth) missing.push("CH_PRESENTER_AUTH");
  return {
    id, auth, missing, email: String(env.CH_PRESENTER_EMAIL || "").trim(),
    url: String(env.CH_GATEWAY_URL || TEST_URL).trim(),
    // Test mode is the default. Nothing is filed for real until CH_GATEWAY_LIVE is 1 AND the form is listed in CH_LIVE_FORMS.
    live: String(env.CH_GATEWAY_LIVE || "").trim() === "1",
    liveForms: String(env.CH_LIVE_FORMS || "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean),
  };
}

/** A unique submission number: the gateway wants a different one every time. */
function submissionNumber(now = Date.now()) {
  return String(Math.floor(now / 1000) % 1000000000) + String(Math.floor(Math.random() * 10));
}

function envelope({ cls, number, presenter, test, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<GovTalkMessage xmlns="${ENVELOPE_NS}">`
    + `<EnvelopeVersion>1.0</EnvelopeVersion>`
    + `<Header><MessageDetails><Class>${esc(cls)}</Class><Qualifier>request</Qualifier><TransactionID>${esc(number)}</TransactionID></MessageDetails>`
    + `<SenderDetails><IDAuthentication><SenderID>${esc(presenter.id)}</SenderID><Authentication><Method>CHMD5</Method><Value>${md5(presenter.auth)}</Value></Authentication></IDAuthentication>${presenter.email ? `<EmailAddress>${esc(presenter.email)}</EmailAddress>` : ""}</SenderDetails></Header>`
    + `<GovTalkDetails><Keys/><TargetDetails><Organisation>Companies House</Organisation></TargetDetails><ChannelRouting><Channel><URI>${esc(presenter.id)}</URI><Product>xproflow</Product><Version>1</Version></Channel>${test ? "<Test>1</Test>" : ""}</ChannelRouting></GovTalkDetails>`
    + `<Body>${body}</Body></GovTalkMessage>`;
}

const pick = (xml, name) => { const m = new RegExp(`<(?:[A-Za-z0-9]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${name}>`, "i").exec(xml); return m ? m[1].replace(/<[^>]+>/g, "").trim() : ""; };

/** What the gateway said: an error, an acknowledgement, or (for a status request) the state of the submission. */
function parseReply(xml) {
  const qualifier = pick(xml, "Qualifier").toLowerCase();
  const errors = [...String(xml).matchAll(/<(?:[A-Za-z0-9]+:)?Error[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?Error>/gi)].map((m) => pick(m[0], "Text") || pick(m[0], "RaisedBy") || m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);
  const status = pick(xml, "StatusCode");
  return { qualifier, errors, status, reject: pick(xml, "Reject") || pick(xml, "RejectReference") || pick(xml, "Description"), reference: pick(xml, "IncorporationNumber") || pick(xml, "Reference") || pick(xml, "SubmissionReference") };
}

async function post(fetch, url, xml) {
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8" }, body: xml, signal: AbortSignal.timeout(20000) });
  } catch {
    const e = new Error("Companies House didn't answer. Try again shortly."); e.code = "unreachable"; throw e;
  }
  const text = await res.text();
  if (!res.ok) { const e = new Error(`The Companies House gateway returned an error (${res.status}).`); e.code = "upstream"; throw e; }
  return text;
}

/** Send one form. Resolves with the submission number (the planner's gateway reference). */
async function submitForm({ fetch, env, form, payload, company, now = Date.now() }) {
  const s = settings(env);
  if (s.missing.length) { const e = new Error(`Filing isn't set up yet: ${s.missing.join(" and ")} ${s.missing.length === 1 ? "is" : "are"} missing from Azure.`); e.code = "not-configured"; throw e; }
  const def = FORMS[form];
  if (!def) { const e = new Error(`${form} can't be sent from the planner yet.`); e.code = "unsupported"; throw e; }
  const test = !(s.live && s.liveForms.includes(form));
  if (s.live && !s.liveForms.includes(form)) { const e = new Error(`${form} hasn't been cleared for live filing. List it in CH_LIVE_FORMS once Companies House has accepted it in testing.`); e.code = "not-cleared"; throw e; }
  const problem = def.check(payload || {});
  if (problem) { const e = new Error(problem); e.code = "incomplete"; throw e; }
  if (!company || !String(company.number || "").trim() || !String(company.authCode || "").trim()) { const e = new Error("The company's number and Companies House authentication code are needed."); e.code = "incomplete"; throw e; }
  const number = submissionNumber(now);
  const xml = envelope({ cls: def.class, number, presenter: s, test, body: def.body(payload || {}, company) });
  const reply = parseReply(await post(fetch, s.url, xml));
  if (reply.errors.length || reply.qualifier === "error") { const e = new Error(`Companies House refused the submission: ${reply.errors.join("; ") || "no reason given"}.`); e.code = "refused"; throw e; }
  return { gatewayRef: number, test };
}

/** Ask for the answer to an earlier submission. */
async function submissionStatus({ fetch, env, gatewayRef, test, now = Date.now() }) {
  const s = settings(env);
  if (s.missing.length) { const e = new Error("Filing isn't set up yet."); e.code = "not-configured"; throw e; }
  if (typeof test !== "boolean" || (!test && !s.live)) { const e = new Error("The original filing environment is not available."); e.code = "bad-request"; throw e; }
  const number = submissionNumber(now);
  const xml = envelope({ cls: "GetSubmissionStatus", number, presenter: s, test, body: `<GetSubmissionStatus xmlns="http://xmlgw.companieshouse.gov.uk"><SubmissionNumber>${esc(gatewayRef)}</SubmissionNumber></GetSubmissionStatus>` });
  const r = parseReply(await post(fetch, s.url, xml));
  if (r.errors.length) { const e = new Error(`Companies House couldn't give the status: ${r.errors.join("; ")}.`); e.code = "refused"; throw e; }
  const code = String(r.status).toUpperCase();
  if (code === "ACCEPTED" || code === "ACCEPT") return { status: "accepted", chRef: r.reference };
  if (code === "REJECTED" || code === "REJECT") return { status: "rejected", reason: r.reject || "Rejected, no reason given." };
  return { status: "pending" };
}

module.exports = { settings, envelope, parseReply, submitForm, submissionStatus, md5, submissionNumber, TEST_URL };
