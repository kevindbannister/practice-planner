// The GovTalk layer shared by the Self Assessment (SA100, SA800) and Corporation Tax (CT600) filings. It does the parts every HMRC XML
// service has in common: the envelope, the sender's sign-in, the IRmark, sending, polling and reading the answer.
//
// What it does NOT do is know any service's XML. Each service plugs in an adapter that supplies its message class, its GovTalk keys
// and its own checks on the body, taken from HMRC's published technical pack. No adapter is registered here, because the official
// schemas and message classes haven't been verified: until one is, send() refuses with the reason rather than guessing.
//
// The IRmark is a SHA-1 hash, in base64, of the GovTalk Body in canonical XML with the IRmark element left out. The body must already be
// in canonical form (checked by canonicalProblems); this does not canonicalise arbitrary XML. Check it against HMRC's published
// IRmark test examples before relying on it for a new service.
const crypto = require("node:crypto");

const ENV_NS = "http://www.govtalk.gov.uk/CM/envelope";
const ENDPOINTS = {
  ets: { submit: "https://test-transaction-engine.tax.service.gov.uk/submission", poll: "https://test-transaction-engine.tax.service.gov.uk/poll" },
  live: { submit: "https://transaction-engine.tax.service.gov.uk/submission", poll: "https://transaction-engine.tax.service.gov.uk/poll" },
};
const MARK = /<IRmark Type="generic">[^<]*<\/IRmark>/;
const PLACEHOLDER = '<IRmark Type="generic">IRMARK</IRmark>';
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The adapters that have been registered, by service. Each: { service, messageClass, keys(ctx) -> [{ type, value }], check(body) -> "" or a reason }. */
const adapters = new Map();
function registerAdapter(a) {
  if (!a || !a.service || !a.messageClass || typeof a.keys !== "function" || typeof a.check !== "function") throw new Error("An adapter needs a service, a messageClass, keys() and check().");
  adapters.set(a.service, a);
}
const BLOCKERS = {
  SA100: "The SA100 adapter isn't registered: the XML builder covers only part of a return, and HMRC's GovTalk message class for SA100 isn't in the RIM pack (it has to come from HMRC's technical documentation or the SDST).",
  SA800: "The SA800 adapter isn't registered: the XML builder covers only the short trading route, and HMRC's GovTalk message class for SA800 isn't in the RIM pack (it has to come from HMRC's technical documentation or the SDST).",
  CT600: "The CT600 adapter isn't registered: the XML builder covers only simple companies, the iXBRL accounts and computation have to be supplied (the planner doesn't make them), and HMRC's GovTalk message class for CT600 isn't in the RIM pack.",
};
function adapterFor(service) {
  const a = adapters.get(service);
  if (a) return { adapter: a, blocked: "" };
  return { adapter: null, blocked: BLOCKERS[service] || `${service} isn't a filing service.` };
}

/** Why a body can't be hashed as it stands: the IRmark is only right for a body in canonical form. */
function canonicalProblems(body) {
  const s = String(body || "");
  const out = [];
  if (/<\?xml/i.test(s)) out.push("It has an XML declaration.");
  if (/<!DOCTYPE|<!ENTITY|<!--|<\?xml-stylesheet/i.test(s)) out.push("It has a DOCTYPE, entity, comment or stylesheet, which HMRC won't accept.");
  if (/>\s+</.test(s) || /^\s/.test(s) || /\s$/.test(s)) out.push("It has whitespace between elements, or before or after the body.");
  if (/<[A-Za-z][^<>]*\/>/.test(s)) out.push("It has an empty element written as <x/>.");
  return out;
}

function irmark(body) {
  const b = `<Body xmlns="${ENV_NS}">${String(body).replace(MARK, "")}</Body>`;
  return crypto.createHash("sha1").update(b, "utf8").digest("base64");
}

function envelope({ cls, qualifier, fn, correlationId = "", gatewayTest, sender, keys = [], vendorId, product, version, body = "" }) {
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<GovTalkMessage xmlns="${ENV_NS}"><EnvelopeVersion>2.0</EnvelopeVersion>`
    + `<Header><MessageDetails><Class>${esc(cls)}</Class><Qualifier>${qualifier}</Qualifier><Function>${fn}</Function><CorrelationID>${esc(correlationId)}</CorrelationID><Transformation>XML</Transformation>${gatewayTest ? "<GatewayTest>1</GatewayTest>" : ""}</MessageDetails>`
    + (sender ? `<SenderDetails><IDAuthentication><SenderID>${esc(sender.id)}</SenderID><Authentication><Method>clear</Method><Role>principal</Role><Value>${esc(sender.password)}</Value></Authentication></IDAuthentication></SenderDetails>` : "<SenderDetails></SenderDetails>")
    + `</Header><GovTalkDetails><Keys>${keys.map((k) => `<Key Type="${esc(k.type)}">${esc(k.value)}</Key>`).join("")}</Keys>`
    + (sender ? `<TargetDetails><Organisation>HMRC</Organisation></TargetDetails><ChannelRouting><Channel><URI>${esc(vendorId)}</URI><Product>${esc(product)}</Product><Version>${esc(version)}</Version></Channel></ChannelRouting>` : "")
    + `</GovTalkDetails><Body>${body}</Body></GovTalkMessage>`;
}

const pick = (xml, name) => { const m = new RegExp(`<(?:[A-Za-z0-9]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9]+:)?${name}>`, "i").exec(xml); return m ? m[1] : ""; };
const text = (s) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
/** What HMRC said: an acknowledgement (poll later), a response (the answer), or errors. */
function parse(xml) {
  const s = String(xml || "");
  const endpoint = /<ResponseEndPoint[^>]*PollInterval="(\d+)"[^>]*>([^<]*)<\/ResponseEndPoint>/.exec(s);
  const errors = [...s.matchAll(/<(?:[A-Za-z0-9]+:)?Error>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?Error>/g)].map((m) => ({ number: text(pick(m[1], "Number")), text: text(pick(m[1], "Text")), location: text(pick(m[1], "Location")) })).filter((e) => e.number || e.text);
  return { qualifier: text(pick(s, "Qualifier")).toLowerCase(), correlationId: text(pick(s, "CorrelationID")), pollUrl: endpoint ? text(endpoint[2]) : "", interval: endpoint ? Number(endpoint[1]) : 0, errors, body: pick(s, "Body").slice(0, 60000), receipt: text(pick(s, "Message")).slice(0, 2000), timestamp: text(pick(s, "GatewayTimestamp")) };
}

async function post(fetch, url, xml) {
  let res;
  try { res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8" }, body: xml, signal: AbortSignal.timeout(30000) }); }
  catch { const e = new Error("HMRC didn't answer."); e.code = "unreachable"; throw e; }
  const t = await res.text();
  if (!res.ok && !t.includes("GovTalkMessage")) { const e = new Error(`HMRC answered ${res.status}.`); e.code = "http"; throw e; }
  return parse(t);
}
const outcome = (r, mode, mark) => r.qualifier === "error"
  ? { state: "rejected", outcome: "hmrc", errors: r.errors, correlationId: r.correlationId, irmark: mark, env: mode, response: r.body }
  : r.qualifier === "response"
    ? { state: "accepted", outcome: "hmrc", correlationId: r.correlationId, irmark: mark, receipt: r.receipt, env: mode, response: r.body, timestamp: r.timestamp }
    : { state: "pending", outcome: "hmrc", correlationId: r.correlationId, pollUrl: r.pollUrl, interval: r.interval || 10, irmark: mark, env: mode };

/**
 * Send one return through the service's adapter to HMRC's External Test Service (mode "ets") or live service (mode "live").
 * The sender's sign-in and the vendor ID come from the secret store and are not part of the result.
 */
async function send({ fetch, secrets, service, mode, body, keysFor = {}, product = "xproflow", version = "1.0" }) {
  const { adapter, blocked } = adapterFor(service);
  if (!adapter) { const e = new Error(blocked); e.code = "blocked"; throw e; }
  if (mode !== "ets" && mode !== "live") { const e = new Error("That isn't a filing environment."); e.code = "bad-request"; throw e; }
  const vendorId = (await secrets.get("FILING_VENDOR_ID")).trim(), senderId = (await secrets.get("FILING_SENDER_ID")).trim(), password = await secrets.get("FILING_PASSWORD");
  const missing = [!vendorId && "the vendor ID", !senderId && "the sender ID", !password && "the password"].filter(Boolean);
  if (missing.length) { const e = new Error(`Filing to HMRC isn't set up: ${missing.join(", ")} missing.`); e.code = "not-configured"; throw e; }
  const s = String(body || "");
  if (s.length < 50 || s.length > 5_000_000) { const e = new Error("That submission is empty or too large."); e.code = "bad-request"; throw e; }
  const why = [...canonicalProblems(s), ...(adapter.check(s) ? [adapter.check(s)] : [])];
  if (why.length) { const e = new Error(why[0]); e.code = "bad-request"; throw e; }
  if (!MARK.test(s)) { const e = new Error("The submission has no IRmark."); e.code = "bad-request"; throw e; }
  const mark = irmark(s);
  const stamped = s.replace(MARK, `<IRmark Type="generic">${mark}</IRmark>`);
  const xml = envelope({ cls: adapter.messageClass, qualifier: "request", fn: "submit", gatewayTest: mode === "ets", sender: { id: senderId, password }, keys: adapter.keys(keysFor), vendorId, product, version, body: stamped });
  const r = await post(fetch, ENDPOINTS[mode].submit, xml);
  return outcome(r, mode, mark);
}

async function poll({ fetch, secrets, service, mode, correlationId, pollUrl }) {
  const { adapter, blocked } = adapterFor(service);
  if (!adapter) { const e = new Error(blocked); e.code = "blocked"; throw e; }
  if (!/^[0-9A-F]{1,32}$/i.test(String(correlationId))) { const e = new Error("That isn't a submission HMRC knows about."); e.code = "bad-request"; throw e; }
  const ep = ENDPOINTS[mode]; if (!ep) { const e = new Error("That isn't a filing environment."); e.code = "bad-request"; throw e; }
  let url = ep.poll;
  try { const u = new URL(pollUrl); if (u.protocol === "https:" && u.hostname === new URL(ep.poll).hostname) url = pollUrl; } catch { /* the standard address */ }
  const r = await post(fetch, url, envelope({ cls: adapter.messageClass, qualifier: "poll", fn: "submit", correlationId, gatewayTest: mode === "ets" }));
  const out = outcome(r, mode, "");
  if (out.state !== "pending") await post(fetch, ep.submit, envelope({ cls: adapter.messageClass, qualifier: "request", fn: "delete", correlationId, gatewayTest: mode === "ets" })).catch(() => null);
  return out;
}

/**
 * A mock run for development: the same checks as a real send but nothing leaves the server, and the result says so. Put MOCK_REJECT
 * anywhere in the body to see a rejection. A mock result is never HMRC's word and the planner never shows it as filed.
 */
function mockSend({ service, body }) {
  const { adapter, blocked } = adapterFor(service);
  if (!adapter) { const e = new Error(blocked); e.code = "blocked"; throw e; }
  const s = String(body || "");
  if (s.length < 50) { const e = new Error("That submission is empty."); e.code = "bad-request"; throw e; }
  const why = [...canonicalProblems(s), ...(adapter.check(s) ? [adapter.check(s)] : [])];
  if (why.length) { const e = new Error(why[0]); e.code = "bad-request"; throw e; }
  const mark = MARK.test(s) ? irmark(s) : "";
  const id = crypto.createHash("sha256").update(s).digest("hex").slice(0, 16).toUpperCase();
  if (s.includes("MOCK_REJECT")) return { state: "rejected", outcome: "mock", env: "mock", correlationId: `MOCK${id}`, irmark: mark, errors: [{ number: "0000", text: "Mock rejection requested.", location: "" }] };
  return { state: "accepted", outcome: "mock", env: "mock", correlationId: `MOCK${id}`, irmark: mark, receipt: "MOCK: nothing was sent to HMRC." };
}

module.exports = { registerAdapter, adapterFor, canonicalProblems, irmark, envelope, parse, send, poll, mockSend, ENDPOINTS, BLOCKERS, PLACEHOLDER, ENV_NS, _adapters: adapters };
