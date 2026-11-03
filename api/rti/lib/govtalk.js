// HMRC's Transaction Engine for PAYE Real Time Information: wrapping an FPS or EPS (built by the planner) in the GovTalk envelope with
// the agent's Government Gateway sign-in, working out the IRmark, sending it, polling for HMRC's answer and tidying up afterwards.
//
// The IRmark is a SHA-1 hash, in base64, of the GovTalk Body in canonical XML with the IRmark element left out. The planner writes the
// body already in canonical form (no whitespace between elements, sorted attributes, no empty-element shorthand), so the canonical
// Body is the text itself inside <Body xmlns="http://www.govtalk.gov.uk/CM/envelope">.
//
// Test mode (the default) sends to HMRC's External Test Service with GatewayTest set. Nothing goes to the live service unless
// RTI_LIVE is 1. Settings: RTI_SENDER_ID and RTI_PASSWORD (the agent's Government Gateway user ID and password, or the test
// credentials HMRC's Software Developer Support Team gives for the test service), RTI_VENDOR_ID (from HMRC SDST), RTI_LIVE.
const crypto = require("node:crypto");

const ENV_NS = "http://www.govtalk.gov.uk/CM/envelope";
const ENDPOINTS = {
  test: { submit: "https://test-transaction-engine.tax.service.gov.uk/submission", poll: "https://test-transaction-engine.tax.service.gov.uk/poll" },
  live: { submit: "https://transaction-engine.tax.service.gov.uk/submission", poll: "https://transaction-engine.tax.service.gov.uk/poll" },
};
const CLASSES = { FPS: "HMRC-PAYE-RTI-FPS", EPS: "HMRC-PAYE-RTI-EPS" };
const PLACEHOLDER = '<IRmark Type="generic">IRMARK</IRmark>';

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function settings(env) {
  const senderId = String(env.RTI_SENDER_ID || "").trim(), password = String(env.RTI_PASSWORD || ""), vendorId = String(env.RTI_VENDOR_ID || "").trim();
  const missing = [];
  if (!senderId) missing.push("RTI_SENDER_ID");
  if (!password) missing.push("RTI_PASSWORD");
  if (!vendorId) missing.push("RTI_VENDOR_ID");
  const live = String(env.RTI_LIVE || "").trim() === "1";
  return { senderId, password, vendorId, live, missing, endpoints: live ? ENDPOINTS.live : ENDPOINTS.test, product: "xproflow", version: "1.0" };
}

/** The IRmark for an IRenvelope written in canonical form with the IRMARK placeholder (or any IRmark) in its header. */
function irmark(irEnvelope) {
  const body = `<Body xmlns="${ENV_NS}">${String(irEnvelope).replace(/<IRmark Type="generic">[^<]*<\/IRmark>/, "")}</Body>`;
  return crypto.createHash("sha1").update(body, "utf8").digest("base64");
}

/** Checks on what the planner sent before anything goes to HMRC. */
function checkBody(kind, irEnvelope) {
  const s = String(irEnvelope || "");
  if (!CLASSES[kind]) return "Only an FPS or EPS can be sent.";
  if (s.length < 100 || s.length > 2_000_000) return "That submission is empty or too large.";
  if (!s.startsWith("<IRenvelope xmlns=\"http://www.govtalk.gov.uk/taxation/PAYE/RTI/")) return "That isn't an RTI submission.";
  if (kind === "FPS" && !s.includes("/FullPaymentSubmission/")) return "That isn't an FPS.";
  if (kind === "EPS" && !s.includes("/EmployerPaymentSummary/")) return "That isn't an EPS.";
  if (!s.includes(PLACEHOLDER) && !/<IRmark Type="generic">[^<]*<\/IRmark>/.test(s)) return "The submission has no IRmark.";
  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(s)) return "That submission contains things HMRC won't accept.";
  return "";
}

function envelope({ cls, qualifier, fn, correlationId = "", s, keys, body = "", withSender }) {
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<GovTalkMessage xmlns="${ENV_NS}"><EnvelopeVersion>2.0</EnvelopeVersion>`
    + `<Header><MessageDetails><Class>${esc(cls)}</Class><Qualifier>${qualifier}</Qualifier><Function>${fn}</Function><CorrelationID>${esc(correlationId)}</CorrelationID><Transformation>XML</Transformation>${s.live ? "" : "<GatewayTest>1</GatewayTest>"}</MessageDetails>`
    + (withSender ? `<SenderDetails><IDAuthentication><SenderID>${esc(s.senderId)}</SenderID><Authentication><Method>clear</Method><Role>principal</Role><Value>${esc(s.password)}</Value></Authentication></IDAuthentication></SenderDetails>` : "<SenderDetails></SenderDetails>")
    + `</Header><GovTalkDetails><Keys>${keys ? `<Key Type="TaxOfficeNumber">${esc(keys.officeNo)}</Key><Key Type="TaxOfficeReference">${esc(keys.payeRef)}</Key>` : ""}</Keys>`
    + (withSender ? `<TargetDetails><Organisation>HMRC</Organisation></TargetDetails><ChannelRouting><Channel><URI>${esc(s.vendorId)}</URI><Product>${s.product}</Product><Version>${s.version}</Version></Channel></ChannelRouting>` : "")
    + `</GovTalkDetails><Body>${body}</Body></GovTalkMessage>`;
}

const pick = (xml, name) => { const m = new RegExp(`<(?:[A-Za-z0-9]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${name}>`, "i").exec(xml); return m ? m[1] : ""; };
const text = (s) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();

/** What HMRC said: acknowledgement (poll later), response (accepted), or error, with any error numbers and texts. */
function parse(xml) {
  const s = String(xml || "");
  const qualifier = text(pick(s, "Qualifier")).toLowerCase();
  const endpoint = /<ResponseEndPoint[^>]*PollInterval="(\d+)"[^>]*>([^<]*)<\/ResponseEndPoint>/.exec(s);
  const errors = [...s.matchAll(/<(?:[A-Za-z0-9]+:)?Error>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?Error>/g)].map((m) => ({ number: text(pick(m[1], "Number")), text: text(pick(m[1], "Text")), location: text(pick(m[1], "Location")), raisedBy: text(pick(m[1], "RaisedBy")) })).filter((e) => e.number || e.text);
  return {
    qualifier, correlationId: text(pick(s, "CorrelationID")), pollUrl: endpoint ? text(endpoint[2]) : "", interval: endpoint ? Number(endpoint[1]) : 0,
    errors, body: pick(s, "Body").slice(0, 20000), receipt: text(pick(s, "Message")).slice(0, 2000), timestamp: text(pick(s, "GatewayTimestamp")),
  };
}

async function post(fetch, url, xml) {
  let res;
  try { res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8" }, body: xml, signal: AbortSignal.timeout(30000) }); }
  catch { const e = new Error("HMRC didn't answer. It will be tried again."); e.code = "unreachable"; throw e; }
  const t = await res.text();
  if (!res.ok && !t.includes("GovTalkMessage")) { const e = new Error(`HMRC answered ${res.status}.`); e.code = "http"; throw e; }
  return parse(t);
}

const allowedPoll = (s, url) => { try { const u = new URL(url); return u.protocol === "https:" && (u.hostname === new URL(s.endpoints.poll).hostname); } catch { return false; } };

/** Send one FPS or EPS. Returns the state: accepted, rejected or pending (with where and when to poll). */
async function submit({ fetch, env, kind, officeNo, payeRef, irEnvelope }) {
  const s = settings(env);
  if (s.missing.length) { const e = new Error(`Filing to HMRC isn't set up: ${s.missing.join(", ")}.`); e.code = "not-configured"; throw e; }
  const bad = checkBody(kind, irEnvelope);
  if (bad) { const e = new Error(bad); e.code = "bad-request"; throw e; }
  if (!/^\d{3}$/.test(String(officeNo)) || !/^[A-Za-z0-9]{1,10}$/.test(String(payeRef))) { const e = new Error("The PAYE reference isn't right."); e.code = "bad-request"; throw e; }
  const mark = irmark(irEnvelope);
  const body = String(irEnvelope).replace(/<IRmark Type="generic">[^<]*<\/IRmark>/, `<IRmark Type="generic">${mark}</IRmark>`);
  const xml = envelope({ cls: CLASSES[kind], qualifier: "request", fn: "submit", s, keys: { officeNo, payeRef: String(payeRef).toUpperCase() }, body, withSender: true });
  const r = await post(fetch, s.endpoints.submit, xml);
  return outcome(r, s, mark);
}
function outcome(r, s, mark) {
  if (r.qualifier === "error") return { state: "rejected", errors: r.errors, correlationId: r.correlationId, irmark: mark, live: s.live, response: r.body };
  if (r.qualifier === "response") return { state: "accepted", correlationId: r.correlationId, irmark: mark, receipt: r.receipt, live: s.live, response: r.body, timestamp: r.timestamp };
  return { state: "pending", correlationId: r.correlationId, pollUrl: r.pollUrl || s.endpoints.poll, interval: r.interval || 10, irmark: mark, live: s.live };
}
async function poll({ fetch, env, kind, correlationId, pollUrl }) {
  const s = settings(env);
  if (!CLASSES[kind] || !/^[0-9A-F]{1,32}$/i.test(String(correlationId))) { const e = new Error("That isn't a submission HMRC knows about."); e.code = "bad-request"; throw e; }
  const url = pollUrl && allowedPoll(s, pollUrl) ? pollUrl : s.endpoints.poll;
  const r = await post(fetch, url, envelope({ cls: CLASSES[kind], qualifier: "poll", fn: "submit", correlationId, s, withSender: false }));
  const out = outcome(r, s, "");
  if (out.state !== "pending") await post(fetch, s.endpoints.submit, envelope({ cls: CLASSES[kind], qualifier: "request", fn: "delete", correlationId, s, withSender: false })).catch(() => null);
  return out;
}
/** Send and keep polling for up to `waitMs`: most RTI answers come back within a minute. */
async function sendAndWait({ fetch, env, kind, officeNo, payeRef, irEnvelope, waitMs = 45000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() }) {
  const start = now();
  let r = await submit({ fetch, env, kind, officeNo, payeRef, irEnvelope });
  while (r.state === "pending" && now() - start < waitMs) {
    await sleep(Math.min(Math.max(1, r.interval || 10), 30) * 1000);
    const p = await poll({ fetch, env, kind, correlationId: r.correlationId, pollUrl: r.pollUrl });
    r = { ...p, irmark: r.irmark, pollUrl: p.pollUrl || r.pollUrl };
  }
  return r;
}

module.exports = { settings, irmark, checkBody, envelope, parse, submit, poll, sendAndWait, ENDPOINTS, CLASSES, PLACEHOLDER };
