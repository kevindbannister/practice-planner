// Xero bridge for Practice Planner.
//
// Xero doesn't allow web pages to call its API or to sign in without a server ("single page apps
// are not supported"), so the app goes through here. The Xero app's client ID and secret live in
// the Azure settings XERO_CLIENT_ID and XERO_CLIENT_SECRET and never reach the browser.
//
// The Xero sign-in (access and refresh tokens) is sealed with AES-256-GCM using a key only this
// server holds (XERO_TOKEN_KEY, or one made from the client secret). The browser keeps the sealed
// copy in the app's SharePoint settings and sends it back with each call; nobody can read or use
// it without this server, and every call also needs Kevin's Microsoft sign-in for this app.
//
//   GET  /api/xero/status       -> { configured, redirectUri }
//   POST /api/xero/start        { scopes: [...] } -> { url }   (the Xero sign-in page)
//   GET  /api/xero/callback     Xero sends the browser back here; redirects to the app
//   POST /api/xero/connections  { sealed } -> { tenants, sealed? }
//   POST /api/xero/call         { sealed, tenantId, api, path, query } -> { data, sealed? }
//   POST /api/xero/disconnect   { sealed, connectionId? } -> { ok }   (no connectionId: revoke all)
//
// Only reading is allowed: every API call is a GET to a path on the list below.

const crypto = require("node:crypto");
const { createSignIn, reply } = require("../shared/signin.js");

const AUTHORIZE = "https://login.xero.com/identity/connect/authorize";
const TOKEN = "https://identity.xero.com/connect/token";
const REVOKE = "https://identity.xero.com/connect/revocation";
const CONNECTIONS = "https://api.xero.com/connections";

const APIS = {
  accounting: {
    base: "https://api.xero.com/api.xro/2.0",
    paths: /^(Organisation|Accounts|TaxRates|TrackingCategories|Contacts|Invoices|CreditNotes|Payments|BankTransactions|BankTransfers|ManualJournals|Journals|Overpayments|Prepayments|Reports\/(TrialBalance|BalanceSheet|ProfitAndLoss|BankSummary|AgedReceivablesByContact|AgedPayablesByContact|ExecutiveSummary))$/,
  },
  accountdata: { base: "https://api.xero.com/accountdata.xro/1.0", paths: /^(account-balances|account-movements|account-transactions)$/ },
  payroll: { base: "https://api.xero.com/payroll.xro/2.0", paths: /^(PayRuns|PayRuns\/[0-9a-f-]{36}|Payslips|Payslips\/[0-9a-f-]{36}|Employees|Settings|PayRunCalendars)$/i },
  assets: { base: "https://api.xero.com/assets.xro/1.1", paths: /^(Assets|AssetTypes|Settings)$/ },
};

const ALWAYS = ["offline_access", "openid", "profile", "email"];
const SCOPE = /^[a-z_]+(\.[a-z0-9_]+)*$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE_FOR_MS = 15 * 60 * 1000;
const REFRESH_EARLY_MS = 2 * 60 * 1000;
const WAIT_UP_TO_S = 15; // a 429 asking us to wait longer than this goes back to the browser

// ------------------------------------------------------------------ sealing

function keyFrom(env) {
  const secret = (env.XERO_TOKEN_KEY || env.XERO_CLIENT_SECRET || "").trim();
  if (!secret) return null;
  return crypto.createHash("sha256").update(`practice-planner/xero/v1:${secret}`).digest();
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

// ------------------------------------------------------------------ helpers

function header(req, name) {
  const h = req.headers || {};
  return h[name] || h[name.toLowerCase()] || "";
}

/** The address Xero sends the browser back to. Must match the app's Redirect URI exactly. */
function redirectUri(req, env) {
  if (env.XERO_REDIRECT_URI) return env.XERO_REDIRECT_URI.trim();
  const host = String(header(req, "x-forwarded-host") || header(req, "host") || "").split(",")[0].trim();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}/api/xero/callback`;
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

function queryString(q) {
  const out = new URLSearchParams();
  if (!q || typeof q !== "object") return "";
  for (const [k, v] of Object.entries(q)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,40}$/.test(k)) continue;
    for (const one of Array.isArray(v) ? v.slice(0, 50) : [v]) {
      if (one === undefined || one === null || one === "") continue;
      const s = String(one);
      if (s.length > 2000) continue;
      out.append(k, s);
    }
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ------------------------------------------------------------------ the handler

function createHandler({ fetch = globalThis.fetch, env = process.env, now = () => Date.now(), wait = sleep } = {}) {
  const signedIn = createSignIn({ fetch, now });

  const basic = () => "Basic " + Buffer.from(`${env.XERO_CLIENT_ID.trim()}:${env.XERO_CLIENT_SECRET.trim()}`).toString("base64");

  async function tokenCall(params) {
    const res = await fetch(TOKEN, {
      method: "POST",
      headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  }

  /** The token set, refreshed if it's about to run out. Returns { tok, changed } or { error }. */
  async function fresh(key, sealed) {
    const tok = unseal(key, sealed);
    if (!tok || !tok.at || !tok.rt) return { error: reply(401, { error: "reconnect", message: "Connect to Xero again (Settings › Xero)." }) };
    if (tok.exp - REFRESH_EARLY_MS > now()) return { tok, changed: false };
    const r = await tokenCall({ grant_type: "refresh_token", refresh_token: tok.rt });
    if (!r.ok || !r.json.access_token) {
      const gone = r.json && r.json.error === "invalid_grant";
      return {
        error: reply(gone ? 401 : 502, gone
          ? { error: "reconnect", message: "Xero has ended this connection (it lapses after 60 days without use). Connect to Xero again in Settings › Xero." }
          : { error: "upstream", message: "Xero didn't renew the connection. Try again shortly." }),
      };
    }
    const next = { ...tok, at: r.json.access_token, rt: r.json.refresh_token || tok.rt, exp: now() + Number(r.json.expires_in || 1800) * 1000, sc: r.json.scope || tok.sc };
    return { tok: next, changed: true };
  }

  return async function handler(context, req) {
    const action = String((context.bindingData && context.bindingData.action) || (req.params && req.params.action) || "").toLowerCase();
    const method = String(req.method || "GET").toUpperCase();
    const configured = !!((env.XERO_CLIENT_ID || "").trim() && (env.XERO_CLIENT_SECRET || "").trim());
    const key = keyFrom(env);

    // Xero sends the browser here after sign-in. No Microsoft token on a redirect, so the sealed
    // state (made by /start for a signed-in user, 15 minutes to live) is what proves it's ours.
    if (action === "callback") {
      const q = req.query || {};
      if (!configured || !key) return void (context.res = redirect("/#/settings/xero/failed/not-configured"));
      if (q.error) return void (context.res = redirect(`/#/settings/xero/failed/${encodeURIComponent(String(q.error).slice(0, 60))}`));
      const st = unseal(key, q.state);
      if (!st || st.k !== "state" || !(st.exp > now())) return void (context.res = redirect("/#/settings/xero/failed/expired"));
      if (!q.code) return void (context.res = redirect("/#/settings/xero/failed/no-code"));
      let r;
      try {
        r = await tokenCall({ grant_type: "authorization_code", code: String(q.code), redirect_uri: redirectUri(req, env) });
      } catch {
        return void (context.res = redirect("/#/settings/xero/failed/unreachable"));
      }
      if (!r.ok || !r.json.access_token) return void (context.res = redirect(`/#/settings/xero/failed/${encodeURIComponent(String((r.json && r.json.error) || "token").slice(0, 60))}`));
      const sealed = seal(key, { k: "tok", at: r.json.access_token, rt: r.json.refresh_token, exp: now() + Number(r.json.expires_in || 1800) * 1000, sc: r.json.scope || "", since: new Date(now()).toISOString() });
      context.res = redirect(`/#/settings/xero/connected/${sealed}`);
      return;
    }

    if (action === "status" && method === "GET") {
      context.res = reply(200, { configured, redirectUri: redirectUri(req, env) });
      return;
    }

    if (!["start", "connections", "call", "disconnect"].includes(action) || method !== "POST") {
      context.res = reply(400, { error: "bad-request", message: "That isn't something this app asks for." });
      return;
    }
    if (!configured || !key) {
      context.res = reply(503, { error: "not-configured", message: "The Xero app's client ID and secret haven't been added to Azure yet (XERO_CLIENT_ID and XERO_CLIENT_SECRET)." });
      return;
    }
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
    const b = body(req);

    if (action === "start") {
      const asked = Array.isArray(b.scopes) ? b.scopes.filter((s) => typeof s === "string" && SCOPE.test(s) && s.length < 80) : [];
      const scopes = [...new Set([...ALWAYS, ...asked])].slice(0, 40);
      const state = seal(key, { k: "state", exp: now() + STATE_FOR_MS, n: crypto.randomBytes(8).toString("hex") });
      const url = `${AUTHORIZE}?${new URLSearchParams({
        response_type: "code",
        client_id: env.XERO_CLIENT_ID.trim(),
        redirect_uri: redirectUri(req, env),
        scope: scopes.join(" "),
        state,
      }).toString()}`;
      context.res = reply(200, { url, scopes });
      return;
    }

    let f;
    try {
      f = await fresh(key, b.sealed);
    } catch {
      context.res = reply(502, { error: "unreachable", message: "Couldn't reach Xero. Try again shortly." });
      return;
    }
    if (f.error) {
      context.res = f.error;
      return;
    }
    const tok = f.tok;
    const out = (status, data) => ({ ...reply(status, { ...data, ...(f.changed ? { sealed: seal(key, tok) } : {}) }) });
    const scopes = String(tok.sc || "").split(/\s+/).filter(Boolean);

    if (action === "connections") {
      try {
        const res = await fetch(CONNECTIONS, { headers: { Authorization: `Bearer ${tok.at}`, Accept: "application/json" } });
        const list = await res.json().catch(() => []);
        if (!res.ok) {
          context.res = out(502, { error: "upstream", message: `Xero didn't list the organisations (${res.status}).` });
          return;
        }
        const tenants = (Array.isArray(list) ? list : []).map((c) => ({ id: c.id, tenantId: c.tenantId, tenantName: c.tenantName, tenantType: c.tenantType, createdDateUtc: c.createdDateUtc }));
        context.res = out(200, { tenants, scopes, since: tok.since });
      } catch {
        context.res = out(502, { error: "unreachable", message: "Couldn't reach Xero. Try again shortly." });
      }
      return;
    }

    if (action === "disconnect") {
      try {
        if (b.connectionId) {
          if (!GUID.test(String(b.connectionId))) {
            context.res = out(400, { error: "bad-request", message: "That isn't a Xero connection." });
            return;
          }
          await fetch(`${CONNECTIONS}/${b.connectionId}`, { method: "DELETE", headers: { Authorization: `Bearer ${tok.at}` } });
          context.res = out(200, { ok: true });
        } else {
          await fetch(REVOKE, {
            method: "POST",
            headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: tok.rt }).toString(),
          });
          context.res = reply(200, { ok: true });
        }
      } catch {
        context.res = out(502, { error: "unreachable", message: "Couldn't reach Xero. Try again shortly." });
      }
      return;
    }

    // action === "call": one read-only request
    const api = APIS[b.api];
    const path = String(b.path || "").replace(/^\/+/, "");
    if (!api || !api.paths.test(path)) {
      context.res = out(400, { error: "bad-request", message: "The app can only read from Xero." });
      return;
    }
    if (!GUID.test(String(b.tenantId || ""))) {
      context.res = out(400, { error: "bad-request", message: "Choose which Xero organisation to read." });
      return;
    }
    const url = `${api.base}/${path}${queryString(b.query)}`;
    const headers = { Authorization: `Bearer ${tok.at}`, "Xero-Tenant-Id": b.tenantId, Accept: "application/json" };
    try {
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, { headers });
        if (res.status === 429) {
          const after = Number((res.headers && res.headers.get && res.headers.get("Retry-After")) || 5);
          if (attempt < 2 && after <= WAIT_UP_TO_S) {
            await wait(after * 1000);
            continue;
          }
          context.res = out(429, { error: "rate-limited", retryAfter: after, message: "Xero asked us to slow down. Carrying on shortly." });
          return;
        }
        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = null;
        }
        if (res.ok) {
          context.res = out(200, { data });
          return;
        }
        const www = String((res.headers && res.headers.get && res.headers.get("WWW-Authenticate")) || "");
        if (res.status === 401 || res.status === 403) {
          const missing = /insufficient_scope/i.test(www) || (data && /AuthorizationUnsuccessful/i.test(String(data.Detail || data.detail || "")));
          context.res = out(res.status === 401 && !missing ? 401 : 403, missing
            ? { error: "scope", message: "This Xero connection wasn't given access to that information. Tick it in Settings › Xero and connect again.", api: b.api, path, scopes }
            : { error: "forbidden", message: "Xero refused (your user may not have access to this organisation, or to its bank accounts or payroll).", api: b.api, path });
          return;
        }
        const detail = data && (data.Detail || data.detail || data.Message || data.message || (data.Elements && data.Elements[0] && data.Elements[0].ValidationErrors && data.Elements[0].ValidationErrors[0] && data.Elements[0].ValidationErrors[0].Message));
        context.res = out(res.status === 404 ? 404 : 502, { error: res.status === 404 ? "not-found" : "upstream", status: res.status, message: `Xero returned an error (${res.status})${detail ? `: ${String(detail).slice(0, 200)}` : "."}`, api: b.api, path });
        return;
      }
    } catch {
      context.res = out(502, { error: "unreachable", message: "Couldn't reach Xero. Try again shortly." });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.seal = seal;
module.exports.unseal = unseal;
module.exports.keyFrom = keyFrom;
module.exports.queryString = queryString;
module.exports.APIS = APIS;
