// Adfin bridge for Xproflow: recurring invoices, customers and direct debit mandates.
//
// Adfin's client ID and secret live in the Azure settings ADFIN_CLIENT_ID and ADFIN_CLIENT_SECRET and never
// reach the browser. ADFIN_ENV is "staging" (the default) or "production": nothing reaches the live Adfin until
// it is set to production on purpose.
//
// The Adfin sign-in (access and refresh tokens) is sealed with AES-256-GCM using a key only this server holds
// (ADFIN_TOKEN_KEY, or one made from the client secret), the same way the Xero bridge does it. The app keeps the
// sealed copy in its SharePoint settings and sends it back with each call; nobody can read or use it without this
// server, and every call also needs Kevin's Microsoft sign-in for this app.
//
// Adfin rotates refresh tokens: every refresh returns a new one and the old one must never be used again (reusing
// it can end the whole connection). So whenever a call refreshes, the reply carries a new `sealed` and the app MUST
// save it before making another call. `n` counts the refreshes so the app can tell which copy is newest.
//
//   GET  /api/adfin/status       -> { configured, environment, redirectUri }
//   POST /api/adfin/start        { origin } -> { url }          (the Adfin sign-in page)
//   GET  /api/adfin/callback     Adfin sends the browser back here; redirects to the app
//   POST /api/adfin/call         { sealed, method, path, query, body } -> { data, sealed? }
//   POST /api/adfin/refresh      { sealed } -> { sealed, expiresIn }   (keeps the connection alive; the refresh token lapses after 5 days unused)
//   POST /api/adfin/disconnect   { sealed } -> { ok }
//
// What the app may do is a short list (below). It cannot delete anything, void or mark an invoice paid, or touch a
// mandate other than asking for one.

const crypto = require("node:crypto");
const { createSignIn, reply } = require("../shared/signin.js");

const ENVIRONMENTS = {
  staging: { login: "https://staging.adfin.com/auth/login", api: "https://api.staging.adfin.com/api" },
  production: { login: "https://console.adfin.com/auth/login", api: "https://api.adfin.com/api" },
};
const SCOPE = "invoices customers";
const G = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ALLOWED = [
  ["GET", new RegExp(`^(biller|customers|customers/${G}|customers/directdebitmandates|customers/directdebitmandates/${G}|schedules/invoices|schedules/invoices/${G}|invoices|invoices/${G}|payment_requests/${G}|catalogs/tax_rates|catalogs/items|activities)$`, "i")],
  ["POST", /^(customers|schedules\/invoices|payment_requests)$/],
  ["PUT", new RegExp(`^(customers/${G}|customers/${G}/directdebitmandates|schedules/invoices/${G}|schedules/invoices/${G}:(activate|cancel))$`, "i")],
];
const STATE_FOR_MS = 15 * 60 * 1000;
const REFRESH_EARLY_MS = 5 * 60 * 1000;

function keyFrom(env) {
  const secret = (env.ADFIN_TOKEN_KEY || env.ADFIN_CLIENT_SECRET || "").trim();
  if (!secret) return null;
  return crypto.createHash("sha256").update(`practice-planner/adfin/v1:${secret}`).digest();
}
function seal(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}
function unseal(key, text) {
  if (typeof text !== "string" || text.length < 40 || text.length > 20000) return null;
  try {
    const raw = Buffer.from(text, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

const header = (req, name) => { const h = req.headers || {}; return h[name] || h[name.toLowerCase()] || ""; };
function originFrom(value) {
  const s = String(value || "").trim().replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(s) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(s) ? s : "";
}
function redirectUri(req, env, origin) {
  if (env.ADFIN_REDIRECT_URI) return env.ADFIN_REDIRECT_URI.trim();
  if (originFrom(origin)) return `${originFrom(origin)}/api/adfin/callback`;
  const host = String(header(req, "x-forwarded-host") || header(req, "host") || "").split(",")[0].trim();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}/api/adfin/callback`;
}
function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}
const redirect = (location) => ({ status: 302, headers: { Location: location, "Cache-Control": "no-store" }, body: "" });
function queryString(q) {
  const out = new URLSearchParams();
  if (!q || typeof q !== "object") return "";
  for (const [k, v] of Object.entries(q)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)) continue;
    for (const one of Array.isArray(v) ? v.slice(0, 50) : [v]) {
      if (one === undefined || one === null || one === "") continue;
      const s = String(one);
      if (s.length <= 2000) out.append(k, s);
    }
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}
const allowed = (method, path) => ALLOWED.some(([m, re]) => m === method && re.test(path));

function createHandler({ fetch = globalThis.fetch, env = process.env, now = () => Date.now() } = {}) {
  const signedIn = createSignIn({ fetch, now });
  const envName = String(env.ADFIN_ENV || "staging").toLowerCase() === "production" ? "production" : "staging";
  const E = ENVIRONMENTS[envName];

  async function tokenCall(params) {
    const res = await fetch(`${E.api}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: env.ADFIN_CLIENT_ID.trim(), client_secret: env.ADFIN_CLIENT_SECRET.trim(), ...params }).toString(),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }

  async function fresh(key, sealed) {
    const tok = unseal(key, sealed);
    if (!tok || !tok.at || !tok.rt || tok.env !== envName) return { error: reply(401, { error: "reconnect", message: `Connect to Adfin again (Settings › Adfin). The saved connection is for ${tok && tok.env && tok.env !== envName ? tok.env : "another setup"}.` }) };
    if (tok.exp - REFRESH_EARLY_MS > now()) return { tok, changed: false };
    const r = await tokenCall({ grant_type: "refresh_token", refresh_token: tok.rt });
    if (!r.ok || !r.json.access_token || !r.json.refresh_token) {
      const gone = r.status === 400 || r.status === 401;
      return {
        error: reply(gone ? 401 : 502, gone
          ? { error: "reconnect", message: "Adfin has ended this connection (it lapses after 5 days unused, or if an old copy was used twice). Connect to Adfin again in Settings › Adfin." }
          : { error: "upstream", message: "Adfin didn't renew the connection. Try again shortly." }),
      };
    }
    return { tok: { ...tok, at: r.json.access_token, rt: r.json.refresh_token, exp: now() + Number(r.json.expires_in || 3600) * 1000, n: (tok.n || 0) + 1 }, changed: true };
  }

  return async function handler(context, req) {
    const action = String((context.bindingData && context.bindingData.action) || (req.params && req.params.action) || "").toLowerCase();
    const method = String(req.method || "GET").toUpperCase();
    const configured = !!((env.ADFIN_CLIENT_ID || "").trim() && (env.ADFIN_CLIENT_SECRET || "").trim());
    const key = keyFrom(env);

    if (action === "callback") {
      const q = req.query || {};
      if (!configured || !key) return void (context.res = redirect("/#/settings/adfin/failed/not-configured"));
      if (q.error) return void (context.res = redirect(`/#/settings/adfin/failed/${encodeURIComponent(String(q.error).slice(0, 60))}`));
      const st = unseal(key, q.state);
      if (!st || st.k !== "state" || !(st.exp > now())) return void (context.res = redirect("/#/settings/adfin/failed/expired"));
      if (!q.code) return void (context.res = redirect("/#/settings/adfin/failed/no-code"));
      let r;
      try {
        r = await tokenCall({ grant_type: "authorization_code", code: String(q.code), redirect_uri: st.r || redirectUri(req, env) });
      } catch {
        return void (context.res = redirect("/#/settings/adfin/failed/unreachable"));
      }
      if (!r.ok || !r.json.access_token || !r.json.refresh_token) return void (context.res = redirect(`/#/settings/adfin/failed/${encodeURIComponent(String((r.json && r.json.error) || "token").slice(0, 60))}`));
      const sealed = seal(key, { k: "tok", env: envName, at: r.json.access_token, rt: r.json.refresh_token, exp: now() + Number(r.json.expires_in || 3600) * 1000, n: 0, since: new Date(now()).toISOString() });
      context.res = redirect(`/#/settings/adfin/connected/${sealed}`);
      return;
    }

    if (action === "status" && method === "GET") {
      context.res = reply(200, { configured, environment: envName, redirectUri: redirectUri(req, env, (req.query || {}).origin), fixed: !!env.ADFIN_REDIRECT_URI });
      return;
    }

    if (!["start", "call", "refresh", "disconnect"].includes(action) || method !== "POST") {
      context.res = reply(400, { error: "bad-request", message: "That isn't something this app asks for." });
      return;
    }
    if (!configured || !key) {
      context.res = reply(503, { error: "not-configured", message: "Adfin's client ID and secret haven't been added to Azure yet (ADFIN_CLIENT_ID and ADFIN_CLIENT_SECRET). Ask Adfin for API credentials first." });
      return;
    }
    let ok = false;
    try { ok = await signedIn(req); } catch { ok = false; }
    if (!ok) {
      context.res = reply(401, { error: "unauthorised", message: "Sign in to Xproflow again." });
      return;
    }
    const b = body(req);

    if (action === "start") {
      const uri = redirectUri(req, env, b.origin);
      const state = seal(key, { k: "state", exp: now() + STATE_FOR_MS, n: crypto.randomBytes(8).toString("hex"), r: uri });
      const url = `${E.login}?${new URLSearchParams({ client_id: env.ADFIN_CLIENT_ID.trim(), redirect_uri: uri, scope: SCOPE, state }).toString()}`;
      context.res = reply(200, { url, redirectUri: uri, environment: envName });
      return;
    }

    let f;
    try { f = await fresh(key, b.sealed); } catch {
      context.res = reply(502, { error: "unreachable", message: "Couldn't reach Adfin. Try again shortly." });
      return;
    }
    if (f.error) { context.res = f.error; return; }
    const tok = f.tok;
    const out = (status, data) => reply(status, { ...data, ...(f.changed ? { sealed: seal(key, tok) } : {}), environment: envName });

    if (action === "refresh") {
      // the refresh above only happens when the access token is near its end; this one forces it, to keep the connection from lapsing
      if (!f.changed) {
        const r = await fresh(key, seal(key, { ...tok, exp: 0 }));
        if (r.error) { context.res = r.error; return; }
        context.res = reply(200, { sealed: seal(key, r.tok), expiresIn: Math.round((r.tok.exp - now()) / 1000), environment: envName });
        return;
      }
      context.res = out(200, { expiresIn: Math.round((tok.exp - now()) / 1000) });
      return;
    }

    if (action === "disconnect") {
      // Adfin documents a revoke endpoint; forget the sealed copy either way
      try { await fetch(`${E.api}/oauth2/revoke`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.ADFIN_CLIENT_ID.trim(), client_secret: env.ADFIN_CLIENT_SECRET.trim(), token: tok.rt }).toString() }); } catch { /* the app forgets its copy regardless */ }
      context.res = reply(200, { ok: true });
      return;
    }

    // action === "call": one request from the short list
    const m = String(b.method || "GET").toUpperCase();
    const path = String(b.path || "").replace(/^\/+/, "");
    if (!allowed(m, path)) {
      context.res = out(400, { error: "bad-request", message: "The app isn't allowed to ask Adfin for that." });
      return;
    }
    const opts = { method: m, headers: { Authorization: `Bearer ${tok.at}`, Accept: "application/json" } };
    if (m !== "GET") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(b.body && typeof b.body === "object" ? b.body : {});
      if (opts.body.length > 100000) { context.res = out(400, { error: "bad-request", message: "That request is too large." }); return; }
    }
    try {
      const res = await fetch(`${E.api}/${path}${m === "GET" ? queryString(b.query) : ""}`, opts);
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (res.ok) { context.res = out(200, { data }); return; }
      const detail = data && (data.message || data.error || data.detail || (Array.isArray(data.errors) && data.errors[0] && (data.errors[0].message || data.errors[0])));
      const msg = detail ? `: ${String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300)}` : ".";
      if (res.status === 401) context.res = out(401, { error: "reconnect", message: "Adfin refused the connection. Connect to Adfin again in Settings › Adfin." });
      else if (res.status === 403) context.res = out(403, { error: "forbidden", message: `Adfin says this connection isn't allowed to do that${msg}`, status: 403 });
      else if (res.status === 404) context.res = out(404, { error: "not-found", message: "Adfin has no record of that.", status: 404 });
      else if (res.status === 400 || res.status === 422) context.res = out(422, { error: "invalid", message: `Adfin didn't accept that${msg}`, status: res.status, details: data });
      else if (res.status === 429) context.res = out(429, { error: "rate-limited", message: "Adfin asked us to slow down. Try again shortly." });
      else context.res = out(502, { error: "upstream", message: `Adfin returned an error (${res.status})${msg}`, status: res.status });
    } catch {
      context.res = out(502, { error: "unreachable", message: "Couldn't reach Adfin. Try again shortly." });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.seal = seal;
module.exports.unseal = unseal;
module.exports.keyFrom = keyFrom;
module.exports.allowed = allowed;
module.exports.ENVIRONMENTS = ENVIRONMENTS;
