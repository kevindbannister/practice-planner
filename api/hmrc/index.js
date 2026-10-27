// HMRC agent authorisation bridge for Practice Planner (VAT / Making Tax Digital, first).
//
// Uses HMRC's Agent Authorisation REST API (docs: github.com/hmrc/agent-authorisation-api). The
// HMRC application's client ID and secret live in Azure settings (HMRC_CLIENT_ID, HMRC_CLIENT_SECRET)
// and the agent's OAuth tokens are kept ONLY on the server, in a token store (see below). Nothing
// secret reaches the browser, SharePoint or a URL. HMRC_ENV is "sandbox" (default) or "production";
// the two never share tokens.
//
// Token store: tokens are never returned to the browser. A store is injected (get/put/del by
// environment). Until one is configured the bridge says so and refuses to connect: there is no
// fallback that writes tokens somewhere less safe.
//
//   GET  /api/hmrc/status                    -> { configured, env, storeConfigured, connected, arn, since }
//   POST /api/hmrc/start   { origin }        -> { url }       (HMRC sign-in for the agent)
//   GET  /api/hmrc/callback                  HMRC sends the browser back here
//   POST /api/hmrc/arn     { arn }           -> { ok }
//   POST /api/hmrc/invitation          { body }          -> { id, status, expiresOn, clientActionUrl }
//   POST /api/hmrc/invitation/status   { id }            -> same
//   POST /api/hmrc/invitation/cancel   { id }            -> { ok }
//   POST /api/hmrc/relationship        { body }          -> { active }
//   POST /api/hmrc/sandbox/accept      { id }            -> { ok }   (sandbox only)
//   POST /api/hmrc/disconnect                            -> { ok }

const crypto = require("node:crypto");
const { createSignIn, reply } = require("../shared/signin.js");

const BASES = { sandbox: "https://test-api.service.hmrc.gov.uk", production: "https://api.service.hmrc.gov.uk" };
// The scopes HMRC's published API definition names: send (write:sent-invitations), read back (read:sent-invitations), cancel (write:cancel-invitations), check a relationship (read:check-relationship).
const SCOPE = "read:sent-invitations write:sent-invitations write:cancel-invitations read:check-relationship";
const ARN = /^[A-Z]ARN\d{7}$/;
const INVITATION_ID = /^[A-Za-z0-9]{8,40}$/;
const REFRESH_EARLY_MS = 2 * 60 * 1000;
const STATE_FOR_MS = 15 * 60 * 1000;
const RECENT_MS = 60 * 1000;
const ACCEPT = "application/vnd.hmrc.2.0+json";

function keyFrom(env) {
  const secret = (env.HMRC_STATE_KEY || env.HMRC_CLIENT_SECRET || "").trim();
  if (!secret) return null;
  return crypto.createHash("sha256").update(`practice-planner/hmrc/v1:${secret}`).digest();
}
function seal(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}
function unseal(key, text) {
  if (typeof text !== "string" || text.length < 40 || text.length > 4000) return null;
  try {
    const raw = Buffer.from(text, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

function header(req, name) {
  const h = req.headers || {};
  return h[name] || h[name.toLowerCase()] || "";
}
function originFrom(value) {
  const s = String(value || "").trim().replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(s) ? s : "";
}
function redirectUri(req, env, origin) {
  if (env.HMRC_REDIRECT_URI) return env.HMRC_REDIRECT_URI.trim();
  if (originFrom(origin)) return `${originFrom(origin)}/api/hmrc/callback`;
  const host = String(header(req, "x-forwarded-host") || header(req, "host") || "").split(",")[0].trim();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}/api/hmrc/callback`;
}
function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}
function redirect(location) {
  return { status: 302, headers: { Location: location, "Cache-Control": "no-store" }, body: "" };
}

/** The invitation body, checked and cut down to the fields HMRC takes. Returns { body } or { error }. */
function cleanInvitation(b) {
  if (!b || typeof b !== "object") return { error: "No invitation details." };
  if (b.service !== "MTD-VAT") return { error: "Only VAT (MTD-VAT) invitations are supported here." };
  if (!["business", "personal"].includes(b.clientType)) return { error: "The client type must be business or personal." };
  if (b.clientIdType !== "vrn" || !/^\d{9}$/.test(String(b.clientId || ""))) return { error: "The VAT number must be 9 digits." };
  const d = String(b.knownFact || "");
  const real = /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  if (!real) return { error: "The VAT registration date must be a real date (YYYY-MM-DD)." };
  return { body: { service: [b.service], clientType: b.clientType, clientIdType: b.clientIdType, clientId: String(b.clientId), knownFact: d } };
}

/** What we pass back about an invitation: only what the app needs. */
function shape(inv) {
  return { id: String(inv.invitationId || inv.id || ""), status: String(inv.status || ""), expiresOn: String(inv.expiresOn || ""), created: String(inv.created || ""), updated: String(inv.updated || ""), clientActionUrl: String(inv.clientActionUrl || (inv._links && inv._links.clientActionUrl) || "") };
}

const FRIENDLY = {
  DUPLICATE_AUTHORISATION_REQUEST: "There is already a pending request for this client and service. Check its status instead of sending another.",
  ALREADY_AUTHORISED: "This client has already authorised the practice for this service.",
  CLIENT_REGISTRATION_NOT_FOUND: "HMRC can't find a VAT registration for that number and date. Check both with the client.",
  VAT_REG_DATE_DOES_NOT_MATCH: "The VAT registration date doesn't match HMRC's record. Check it with the client.",
  VAT_CLIENT_INSOLVENT: "HMRC shows this VAT registration as insolvent, so it can't be authorised this way.",
  NOT_AN_AGENT: "The HMRC sign-in used isn't an agent's Government Gateway account.",
  AGENT_NOT_SUBSCRIBED: "That agent doesn't have an agent services account.",
  NO_PERMISSION_ON_AGENCY: "The HMRC sign-in used doesn't belong to the practice's agent services account (check the ARN).",
  SERVICE_NOT_SUPPORTED: "HMRC doesn't support that service through this interface.",
  INVALID_INVITATION_STATUS: "That request can no longer be cancelled: the client has responded or it has expired.",
  INVITATION_NOT_FOUND: "HMRC can't find that request.",
  ALREADY_BEING_PROCESSED: "HMRC is still processing a request for this client. Wait a moment and check again.",
};

/** A store over one sealed copy sent by the browser: the sign-in is sealed with a key only this server holds, and any change goes back as a new sealed copy. Used only when HMRC_TOKEN_STORE=sealed (testing on the practice's own data). */
function sealedStore(key, text, mode) {
  let rec = text ? unseal(key, text) : null;
  if (rec && (rec.k !== "hmrc" || rec.m !== mode)) rec = null;
  const s = { changed: false, get: async () => (rec ? rec.d : null), put: async (_m, v) => { rec = { k: "hmrc", m: mode, d: v }; s.changed = true; }, del: async () => { rec = null; s.changed = true; }, seal: () => (rec ? seal(key, rec) : "") };
  return s;
}

function createHandler({ fetch = globalThis.fetch, env = process.env, now = () => Date.now(), store: fixedStore = null } = {}) {
  const signedIn = createSignIn({ fetch, now });
  const mode = String(env.HMRC_ENV || "sandbox").trim().toLowerCase() === "production" ? "production" : "sandbox";
  const base = BASES[mode];
  const recent = new Map(); // idempotency: same invitation sent twice within a minute
  const refreshing = new Map();

  async function tokenCall(params) {
    const res = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ ...params, client_id: env.HMRC_CLIENT_ID.trim(), client_secret: env.HMRC_CLIENT_SECRET.trim() }).toString(),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }

  /** The agent's access token, renewed if it's about to run out. One renewal at a time (refresh tokens rotate). */
  async function accessToken(store) {
    const rec = await store.get(mode);
    if (!rec || !rec.rt) return { error: reply(401, { error: "reconnect", message: "Connect to HMRC again (Settings › HMRC)." }) };
    if (rec.at && rec.exp - REFRESH_EARLY_MS > now()) return { rec };
    const rk = `${mode}:${rec.rt}`; // concurrent calls on the same sign-in share one renewal (refresh tokens rotate)
    if (!refreshing.has(rk)) {
      refreshing.set(rk, (async () => {
        const r = await tokenCall({ grant_type: "refresh_token", refresh_token: rec.rt });
        if (!r.ok || !r.json.access_token) {
          const gone = r.json && r.json.error === "invalid_grant";
          if (gone) await store.put(mode, { ...rec, at: "", rt: "", exp: 0 });
          return { error: reply(gone ? 401 : 502, gone ? { error: "reconnect", message: "HMRC has ended this connection. Connect to HMRC again in Settings › HMRC." } : { error: "upstream", message: "HMRC didn't renew the connection. Try again shortly." }) };
        }
        const next = { ...rec, at: r.json.access_token, rt: r.json.refresh_token || rec.rt, exp: now() + Number(r.json.expires_in || 14400) * 1000 };
        await store.put(mode, next);
        return { rec: next };
      })().finally(() => refreshing.delete(rk)));
    }
    return refreshing.get(rk);
  }

  /** Calls HMRC for the connected agent. Never retries a write: a repeat could send a second invitation. */
  async function hmrc(store, method, path, payload) {
    const t = await accessToken(store);
    if (t.error) return t;
    if (!ARN.test(t.rec.arn || "")) return { error: reply(409, { error: "no-arn", message: "Add the practice's Agent Reference Number in Settings › HMRC first." }) };
    const url = `${base}${path.replace("{arn}", t.rec.arn)}`;
    let res;
    try {
      res = await fetch(url, { method, headers: { Authorization: `Bearer ${t.rec.at}`, Accept: ACCEPT, ...(payload || method === "DELETE" ? { "Content-Type": "application/json" } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    } catch {
      return { error: reply(504, { error: "unreachable", message: "Couldn't reach HMRC. Nothing was changed that we know of: check the status before trying again." }) };
    }
    if (res.status === 429) return { error: reply(429, { error: "rate-limited", message: "HMRC asked us to slow down. Wait a minute and try again.", retryAfter: Number(res.headers && res.headers.get && res.headers.get("retry-after")) || 60 }) };
    if (res.status === 401 || res.status === 403) {
      const j = await res.json().catch(() => ({}));
      const code = String(j.code || "");
      return { error: reply(res.status, { error: code || "unauthorised", message: FRIENDLY[code] || "HMRC didn't accept the connection. Connect to HMRC again in Settings › HMRC." }) };
    }
    if (res.status >= 500) return { error: reply(502, { error: "upstream", message: "HMRC had a problem. Check the status before trying again: the request may or may not have gone through." }) };
    return { res, rec: t.rec };
  }

  function failure(res, j) {
    const code = String((j && j.code) || "");
    return reply(res.status === 404 ? 404 : 422, { error: code || "rejected", message: FRIENDLY[code] || (j && j.message) || "HMRC didn't accept that." });
  }

  async function invitation(store, path) {
    const r = await hmrc(store, "GET", path);
    if (r.error) return r;
    const j = await r.res.json().catch(() => ({}));
    if (!r.res.ok) return { error: failure(r.res, j) };
    return { data: shape(j) };
  }

  return async function handler(context, req) {
    const parts = String((context.bindingData && context.bindingData.action) || (req.params && req.params.action) || "").toLowerCase().split("/").filter(Boolean);
    const action = parts.join("/");
    const method = String(req.method || "GET").toUpperCase();
    const configured = !!((env.HMRC_CLIENT_ID || "").trim() && (env.HMRC_CLIENT_SECRET || "").trim());
    const key = keyFrom(env);
    const sealedOn = String(env.HMRC_TOKEN_STORE || "").trim().toLowerCase() === "sealed";
    const b0 = body(req);
    const store = fixedStore || (sealedOn && key ? sealedStore(key, b0.sealed, mode) : null);
    const storeOk = !!store;
    const done = () => { // a changed sign-in goes back sealed (sealed mode only)
      if (store && store.seal && store.changed && context.res && context.res.body) {
        try { const j = JSON.parse(context.res.body); j.sealed = store.seal(); context.res.body = JSON.stringify(j); } catch { /* not JSON */ }
      }
    };
    try {

    if (action === "callback") {
      const q = req.query || {};
      const fail = (why) => void (context.res = redirect(`/#/settings/hmrc/failed/${encodeURIComponent(String(why).slice(0, 60))}`));
      if (!configured || !key || !storeOk) return fail("not-configured");
      if (q.error) return fail(q.error);
      const st = unseal(key, q.state);
      if (!st || st.k !== "state" || !(st.exp > now()) || st.m !== mode) return fail("expired");
      if (!q.code) return fail("no-code");
      let r;
      try {
        r = await tokenCall({ grant_type: "authorization_code", code: String(q.code), redirect_uri: st.r });
      } catch {
        return fail("unreachable");
      }
      if (!r.ok || !r.json.access_token) return fail((r.json && r.json.error) || "token");
      const before = (await store.get(mode)) || {};
      await store.put(mode, { arn: before.arn || st.a || "", at: r.json.access_token, rt: r.json.refresh_token || "", exp: now() + Number(r.json.expires_in || 14400) * 1000, since: new Date(now()).toISOString() });
      context.res = redirect(store.seal ? `/#/settings/hmrc/connected/${store.seal()}` : "/#/settings/hmrc/connected");
      return;
    }

    if (!(await signedIn(req))) {
      context.res = reply(401, { error: "sign-in", message: "Sign in to Practice Planner again." });
      return;
    }

    if (action === "status" && (method === "GET" || method === "POST")) {
      const rec = storeOk ? await store.get(mode) : null;
      context.res = reply(200, { configured, env: mode, storeConfigured: storeOk, sealedStore: sealedOn, connected: !!(rec && rec.rt), arn: (rec && rec.arn) || "", since: (rec && rec.since) || "", redirectUri: redirectUri(req, env, (req.query || {}).origin) });
      return;
    }

    if (method !== "POST") {
      context.res = reply(400, { error: "bad-request", message: "That isn't something this app asks for." });
      return;
    }
    if (!configured || !key) {
      context.res = reply(503, { error: "not-configured", message: "The HMRC application's client ID and secret haven't been added to Azure yet (HMRC_CLIENT_ID and HMRC_CLIENT_SECRET)." });
      return;
    }
    if (!storeOk) {
      context.res = reply(503, { error: "no-store", message: "There is nowhere safe to keep the HMRC sign-in yet. This needs approval and set-up before HMRC can be connected." });
      return;
    }
    const b = body(req);

    if (action === "start") {
      const uri = redirectUri(req, env, b.origin);
      const state = seal(key, { k: "state", exp: now() + STATE_FOR_MS, r: uri, m: mode, a: ((await store.get(mode)) || {}).arn || "" });
      const url = `${base}/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: env.HMRC_CLIENT_ID.trim(), scope: SCOPE, redirect_uri: uri, state }).toString()}`;
      context.res = reply(200, { url });
      return;
    }
    if (action === "arn") {
      const arn = String(b.arn || "").trim().toUpperCase();
      if (!ARN.test(arn)) return void (context.res = reply(400, { error: "bad-arn", message: "An Agent Reference Number looks like TARN0000001 (letter, ARN, seven digits)." }));
      const rec = (await store.get(mode)) || {};
      await store.put(mode, { ...rec, arn });
      context.res = reply(200, { ok: true });
      return;
    }
    if (action === "disconnect") {
      const rec = await store.get(mode);
      await store.del(mode);
      context.res = reply(200, { ok: true, hadConnection: !!rec });
      return;
    }

    if (action === "invitation") {
      const c = cleanInvitation(b.body);
      if (c.error) return void (context.res = reply(400, { error: "invalid", message: c.error }));
      const sig = `${c.body.service}:${c.body.clientId}`;
      if ((recent.get(sig) || 0) > now() - RECENT_MS) return void (context.res = reply(409, { error: "already-sent", message: "That invitation was just sent. Check its status rather than sending it again." }));
      recent.set(sig, now());
      const r = await hmrc(store, "POST", "/agents/{arn}/invitations", c.body);
      if (r.error) { recent.delete(sig); return void (context.res = r.error); }
      if (r.res.status !== 204 && r.res.status !== 201) {
        recent.delete(sig);
        const j = await r.res.json().catch(() => ({}));
        return void (context.res = failure(r.res, j));
      }
      const loc = String((r.res.headers && r.res.headers.get && r.res.headers.get("location")) || "");
      const id = loc.split("/").filter(Boolean).pop() || "";
      if (!INVITATION_ID.test(id)) return void (context.res = reply(502, { error: "no-id", message: "HMRC accepted the request but didn't say which one it was. Check HMRC before sending another." }));
      const got = await invitation(store, `/agents/{arn}/invitations/${id}`);
      context.res = got.error ? reply(200, { id, status: "", expiresOn: "", clientActionUrl: "", note: "Sent. The link couldn't be fetched yet: check the status." }) : reply(200, got.data);
      return;
    }
    if (action === "invitation/status") {
      if (!INVITATION_ID.test(String(b.id || ""))) return void (context.res = reply(400, { error: "invalid", message: "That isn't an HMRC request number." }));
      const got = await invitation(store, `/agents/{arn}/invitations/${b.id}`);
      context.res = got.error || reply(200, got.data);
      return;
    }
    if (action === "invitation/cancel") {
      if (!INVITATION_ID.test(String(b.id || ""))) return void (context.res = reply(400, { error: "invalid", message: "That isn't an HMRC request number." }));
      const r = await hmrc(store, "DELETE", `/agents/{arn}/invitations/${b.id}`);
      if (r.error) return void (context.res = r.error);
      if (r.res.status === 204 || r.res.status === 200) return void (context.res = reply(200, { ok: true }));
      context.res = failure(r.res, await r.res.json().catch(() => ({})));
      return;
    }
    if (action === "relationship") {
      const c = cleanInvitation(b.body);
      if (c.error) return void (context.res = reply(400, { error: "invalid", message: c.error }));
      const { clientType: _ct, ...rel } = c.body; // the relationship check takes no clientType
      const r = await hmrc(store, "POST", "/agents/{arn}/relationships", rel);
      if (r.error) return void (context.res = r.error);
      if (r.res.status === 204) return void (context.res = reply(200, { active: true }));
      const j = await r.res.json().catch(() => ({}));
      if (r.res.status === 404 && (j.code === "RELATIONSHIP_NOT_FOUND" || !j.code)) return void (context.res = reply(200, { active: false }));
      context.res = failure(r.res, j);
      return;
    }
    if (action === "sandbox/accept") {
      if (mode !== "sandbox") return void (context.res = reply(403, { error: "sandbox-only", message: "Test acceptance only exists in HMRC's sandbox." }));
      if (!INVITATION_ID.test(String(b.id || ""))) return void (context.res = reply(400, { error: "invalid", message: "That isn't an HMRC request number." }));
      const r = await hmrc(store, "PUT", `/agent-authorisation-test-support/invitations/${b.id}`);
      if (r.error) return void (context.res = r.error);
      context.res = r.res.ok ? reply(200, { ok: true }) : failure(r.res, await r.res.json().catch(() => ({})));
      return;
    }

    context.res = reply(400, { error: "bad-request", message: "That isn't something this app asks for." });
    } finally {
      done();
    }
  };
}

/** Where tokens live. Not provided yet on purpose: see the feasibility report for the options. */
const handler = createHandler({ store: null });
module.exports = handler;
module.exports.createHandler = createHandler;
module.exports.cleanInvitation = cleanInvitation;
module.exports.seal = seal;
module.exports.unseal = unseal;
module.exports.keyFrom = keyFrom;
