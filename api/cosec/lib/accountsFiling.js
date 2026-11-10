// Server side of filing accounts with Companies House. This module holds the rules that must not live in the browser:
//   * what is allowed to be sent, and to which environment (test unless live is explicitly and fully authorised);
//   * the approved accounts, loaded from a trusted store and checked against their hash, then turned into iXBRL HERE, never accepted from a client;
//   * duplicate prevention: a record of the attempt is written BEFORE anything is sent, a timeout leaves it "unknown" and never triggers a resend;
//   * reading the gateway's replies safely, and never treating an acknowledgement as acceptance;
//   * redaction of secrets from anything stored or logged.
//
// WHAT IS DELIBERATELY NOT HERE: the accounts message itself (its class, body and how the iXBRL document is attached). That comes from the Companies House
// accounts TIS, which has not been obtained, so `ACCOUNTS_SPEC.verified` is false and `submitAccounts` refuses with "spec-not-verified". Nothing below
// invents it. When the TIS is read, fill ACCOUNTS_SPEC, add a test against the official examples, and the rest of this module is already in place.
const crypto = require("node:crypto");
const lib = require("../../shared/plannerlib.js");

const TEST_URL = "https://xmlgw.companieshouse.gov.uk/v1-0/xmlgw/Gateway";
const ENVELOPE_NS = "http://www.govtalk.gov.uk/CM/envelope";
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const err = (code, message) => { const e = new Error(message); e.code = code; return e; };

/** The accounts message definition. Unverified: every field is null until it is read from the TIS. */
const ACCOUNTS_SPEC = { verified: false, messageClass: null, buildBody: null, source: "Companies House TIS for accounts (October 2026): not yet obtained" };

// ------------------------------------------------------------------ secrets

/** Removes every secret (and its MD5 form) from text, plus the value inside any authentication element. */
function redact(text, secrets = []) {
  let out = String(text ?? "");
  for (const s of secrets.map((x) => String(x || "")).filter((x) => x.length >= 3)) {
    for (const v of [s, md5(s)]) out = out.split(v).join("[redacted]");
  }
  return out.replace(/(<(?:[A-Za-z0-9]+:)?Authentication>[\s\S]*?<(?:[A-Za-z0-9]+:)?Value>)[^<]*/gi, "$1[redacted]");
}

// ------------------------------------------------------------------ environment

/**
 * Where a filing may go. TEST unless live is explicitly authorised by ALL of: CH_GATEWAY_LIVE=1, the accounts type listed in CH_LIVE_ACCOUNTS, and
 * CH_ACCOUNTS_TEST_EVIDENCE naming the record of Companies House's test sign-off. A test URL change alone can never reach live, and a good test
 * result never switches anything on by itself.
 */
function route(env, accountsType) {
  const missing = [];
  if (!String(env.CH_PRESENTER_ID || "").trim()) missing.push("CH_PRESENTER_ID");
  if (!String(env.CH_PRESENTER_AUTH || "").trim()) missing.push("CH_PRESENTER_AUTH");
  const live = String(env.CH_GATEWAY_LIVE || "").trim() === "1";
  const types = String(env.CH_LIVE_ACCOUNTS || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const evidence = String(env.CH_ACCOUNTS_TEST_EVIDENCE || "").trim();
  const url = String(env.CH_GATEWAY_URL || TEST_URL).trim();
  if (!live) {
    if (url !== TEST_URL) return { ok: false, test: true, missing, reason: "CH_GATEWAY_URL is not the test gateway, and live filing is not enabled." };
    return { ok: !missing.length, test: true, url: TEST_URL, missing, reason: missing.length ? `Missing: ${missing.join(", ")}.` : "" };
  }
  const why = [];
  if (!types.includes(String(accountsType).toLowerCase())) why.push(`${accountsType} accounts are not listed in CH_LIVE_ACCOUNTS`);
  if (!evidence) why.push("CH_ACCOUNTS_TEST_EVIDENCE (the record of Companies House's test sign-off) is not set");
  if (why.length || missing.length) return { ok: false, test: false, url, missing, reason: `Live filing isn't authorised: ${[...why, ...missing.map((m) => `${m} is missing`)].join("; ")}.` };
  return { ok: true, test: false, url, missing, reason: "" };
}

// ------------------------------------------------------------------ reading replies

/** Reads a gateway reply with the strict parser (no DOCTYPE or entities). Returns what it says; never throws on unexpected content. */
function parseReply(xml) {
  let root;
  try { root = lib.parseXml(String(xml)); } catch (e) { return { readable: false, problem: String(e.message || e) }; }
  const find = (n, local, out = []) => { for (const c of n.children) if (typeof c !== "string") { if (c.local === local) out.push(c); find(c, local, out); } return out; };
  const text = (n) => n.children.map((c) => (typeof c === "string" ? c : text(c))).join("").trim();
  const one = (name) => { const n = find(root, name)[0]; return n ? text(n) : ""; };
  return {
    readable: true, qualifier: one("Qualifier").toLowerCase(), transactionId: one("TransactionID"), test: one("GatewayTest"),
    errors: find(root, "Error").map((e) => (find(e, "Text")[0] ? text(find(e, "Text")[0]) : text(e))).filter(Boolean),
    statusCode: one("StatusCode"), reject: one("Reject") || one("RejectReference") || one("Description"), reference: one("Reference") || one("IncorporationNumber"),
  };
}
/**
 * The application's own status from a status reply. An acknowledgement, an HTTP 200 or an unrecognised word is NEVER "accepted". Only the codes below
 * are recognised: PENDING is confirmed by Companies House's own forum; ACCEPT / ACCEPTED / REJECT / REJECTED follow the existing gateway code and the
 * gateway's behaviour in testing and must be confirmed against the TIS (until then, an unrecognised code stays "unknown" and a person investigates).
 */
function normaliseStatus(r) {
  if (!r.readable) return { status: "unknown", detail: "The reply couldn't be read." };
  if (r.errors.length) return { status: "failed", detail: r.errors.join("; ") };
  const c = String(r.statusCode || "").toUpperCase();
  if (c === "PENDING") return { status: "pending" };
  if (c === "ACCEPT" || c === "ACCEPTED") return { status: "accepted", reference: r.reference };
  if (c === "REJECT" || c === "REJECTED") return { status: "rejected", detail: r.reject || "Rejected, no reason given." };
  return { status: "unknown", detail: c ? `Unrecognised status "${c}".` : "The reply has no status." };
}

// ------------------------------------------------------------------ the store (trusted, server-owned; see docs: Azure Table/Blob)

/** In-memory store with the same contract the Azure one must meet: createIfAbsent is atomic and fails if the key exists. */
function memoryStore() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async createIfAbsent(k, v) { if (m.has(k)) return false; m.set(k, JSON.stringify(v)); return true; },
    async put(k, v) { m.set(k, JSON.stringify(v)); },
    async list(prefix) { return [...m].filter(([k]) => k.startsWith(prefix)).map(([, v]) => JSON.parse(v)); },
  };
}

/** Records a director-approved accounts snapshot. The server re-validates it and fixes its hash; the browser's word is not taken for any of it. */
async function recordApproval({ store, filingKey, snapshot, approvedBy, approvedOn, user, now }) {
  if (!store) throw err("storage-not-configured", "Server-side storage for approved accounts isn't set up.");
  const issues = lib.errorsOf(lib.validateModel(snapshot)).filter((x) => !["director", "statements"].includes(x.id) || snapshot.statements);
  if (issues.length) throw err("invalid-accounts", `The accounts don't pass validation: ${issues[0].message}`);
  if (!String(approvedBy || "").trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(approvedOn || ""))) throw err("not-approved", "Director approval (who and when) is needed.");
  const hash = sha256(lib.canonical(lib.approvableCopy(snapshot)));
  const rec = { filingKey, hash, snapshot, approvedBy, approvedOn, recordedBy: user, recordedAt: new Date(now).toISOString() };
  await store.put(`approval#${filingKey}`, rec);
  return { hash };
}

// ------------------------------------------------------------------ submitting

const IN_FLIGHT = new Set(["submitting", "acknowledged", "pending", "unknown", "accepted"]);
const nextNumber = (now) => String(Math.floor(now / 1000) % 1000000000) + String(crypto.randomInt(0, 10));

/**
 * Submits approved accounts. Order matters and is the duplicate protection:
 *   1. load the approved snapshot and verify its hash; re-validate; make the iXBRL here;
 *   2. refuse if any earlier attempt may have reached Companies House;
 *   3. write the attempt (with its envelope number) atomically BEFORE sending, so a double click or a refresh can't send twice;
 *   4. send once. A network failure or timeout leaves the attempt "unknown": a status enquiry on that number is the only way forward, never a resend.
 */
async function submitAccounts({ store, fetch, env, filingKey, mapping, user, now = Date.now(), accountsType = "dormant", sender, spec = ACCOUNTS_SPEC }) {
  if (!store) throw err("storage-not-configured", "Server-side storage for approved accounts and filing attempts isn't set up, so nothing can be sent.");
  const rt = route(env, accountsType);
  if (!rt.ok) throw err("not-configured", rt.reason);
  const approval = await store.get(`approval#${filingKey}`);
  if (!approval) throw err("not-approved", "There is no recorded director approval for these accounts.");
  if (sha256(lib.canonical(lib.approvableCopy(approval.snapshot))) !== approval.hash) throw err("tampered", "The approved accounts don't match their recorded hash. Nothing was sent.");
  const issues = lib.errorsOf(lib.validateModel(approval.snapshot));
  if (issues.length) throw err("invalid-accounts", `The accounts don't pass validation: ${issues[0].message}`);
  const gen = lib.generate(approval.snapshot, mapping || lib.DORMANT_2025, issues);
  if (!gen.ok) throw err("ixbrl-unavailable", `The iXBRL accounts can't be made yet: ${gen.problems[0]}`);
  const found = [...lib.checkDocument(gen.html, mapping || lib.DORMANT_2025), ...lib.reconcile(gen.html, approval.snapshot, mapping || lib.DORMANT_2025)];
  if (found.length) throw err("ixbrl-invalid", `The iXBRL document failed its own checks: ${found[0].message}`);
  if (!spec.verified || !spec.messageClass || !spec.buildBody) throw err("spec-not-verified", `The accounts message format hasn't been taken from the Companies House TIS (${spec.source}), so nothing can be sent.`);

  const prior = await store.list(`attempt#${filingKey}#`);
  const live = prior.find((a) => IN_FLIGHT.has(a.status));
  if (live) throw err("already-submitted", `An attempt (${live.number}) is already ${live.status}. Check its status instead of submitting again.`);
  const n = prior.length + 1, number = nextNumber(now);
  const attempt = { key: `attempt#${filingKey}#${String(n).padStart(3, "0")}`, filingKey, attempt: n, number, status: "submitting", test: rt.test, hash: approval.hash, by: user, at: new Date(now).toISOString(), history: [{ at: new Date(now).toISOString(), status: "submitting" }] };
  if (!(await store.createIfAbsent(attempt.key, attempt))) throw err("already-submitted", "Another submission for these accounts is being made right now.");

  const secrets = [env.CH_PRESENTER_AUTH];
  const set = async (status, extra = {}) => { attempt.status = status; Object.assign(attempt, extra); attempt.history.push({ at: new Date().toISOString(), status, ...(extra.detail ? { detail: redact(extra.detail, secrets) } : {}) }); await store.put(attempt.key, attempt); };
  try {
    const xml = spec.buildBody({ number, test: rt.test, presenter: { id: env.CH_PRESENTER_ID, auth: env.CH_PRESENTER_AUTH }, ixbrl: gen.html, snapshot: approval.snapshot });
    const res = await (sender || defaultSender)(fetch, rt.url, xml);
    const r = parseReply(res.text);
    if (!res.ok) { await set("unknown", { detail: `The gateway returned HTTP ${res.status}. It may or may not have received the submission.` }); throw err("outcome-unknown", "The gateway answered with an error. Companies House may have received the accounts: check the status before doing anything else."); }
    if (r.errors.length || r.qualifier === "error") { await set("failed", { detail: r.errors.join("; ") || "The gateway refused the submission." }); throw err("refused", `Companies House refused the submission: ${redact(r.errors.join("; ") || "no reason given", secrets)}.`); }
    await set("acknowledged", { detail: "Received by the gateway. Not yet accepted." });
    return { attempt: attempt.attempt, number, status: "acknowledged", test: rt.test };
  } catch (e) {
    if (e.code === "outcome-unknown" || e.code === "refused") throw e;
    await set("unknown", { detail: `The request failed (${redact(e.message || e, secrets)}). It may have been received.` });
    throw err("outcome-unknown", "No answer was received. The accounts may or may not have reached Companies House: check the status of this attempt before doing anything else. It will not be sent again automatically.");
  }
}
async function defaultSender(fetch, url, xml) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8" }, body: xml, signal: AbortSignal.timeout(30000) });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

/** Moves an attempt on from what Companies House says. Only a recognised accepted code marks it accepted; the stored history is appended to, never replaced. */
async function applyStatus({ store, attemptKey, reply, now = Date.now(), secrets = [] }) {
  const a = await store.get(attemptKey);
  if (!a) throw err("not-found", "No such submission attempt.");
  const s = normaliseStatus(parseReply(reply));
  if (s.status === "unknown") { a.history.push({ at: new Date(now).toISOString(), status: a.status, detail: redact(s.detail || "", secrets) }); await store.put(attemptKey, a); return { status: a.status, changed: false, detail: s.detail }; }
  if (a.status === "accepted" && s.status !== "accepted") throw err("conflict", "These accounts are recorded as accepted; a later reply that says otherwise needs investigating, not applying.");
  a.status = s.status === "failed" ? "failed" : s.status; if (s.reference) a.reference = s.reference; if (s.detail) a.detail = redact(s.detail, secrets);
  a.history.push({ at: new Date(now).toISOString(), status: a.status, ...(s.detail ? { detail: redact(s.detail, secrets) } : {}) });
  await store.put(attemptKey, a);
  return { status: a.status, changed: true, reference: a.reference };
}

module.exports = { ACCOUNTS_SPEC, TEST_URL, ENVELOPE_NS, redact, route, parseReply, normaliseStatus, memoryStore, recordApproval, submitAccounts, applyStatus, sha256, md5 };
