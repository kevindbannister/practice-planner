// Xama bridge for Practice Planner (AML checks).
//
// Xama has no public API documentation, so nothing about its addresses is assumed here: the
// OAuth2 client ID and secret, the token address and the API address all live in the Azure
// settings below and never reach the browser. Because the addresses are fixed on the server,
// the secret can only ever be sent to the place the administrator set up.
//
//   XAMA_CLIENT_ID      the OAuth2 client ID
//   XAMA_CLIENT_SECRET  the OAuth2 client secret
//   XAMA_TOKEN_URL      where to ask for an access token (https)
//   XAMA_API_BASE       the start of every API address (https)
//   XAMA_SCOPE          optional, sent as "scope"
//   XAMA_AUTH_STYLE     optional: "basic" (default, credentials in the Authorization header) or "body"
//
//   GET  /api/xama/status  -> { configured, missing, clientIdEnding, tokenHost, apiBase, authStyle }
//   POST /api/xama/test    { path? } -> { steps: [...] }  asks for a token, then (optionally) one GET
//   POST /api/xama/call    { path, query? } -> { data }   one GET, for the app to read AML information
//
// Only reading is allowed, and every call also needs Kevin's Microsoft sign-in for this app.

const { createSignIn, reply } = require("../shared/signin.js");

const PATH = /^\/?[A-Za-z0-9_\-.~%]+(\/[A-Za-z0-9_\-.~%]+)*\/?$/;
const SAMPLE_CHARS = 6000;
const REFRESH_EARLY_MS = 60 * 1000;

function body(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === "string") {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return typeof b === "object" ? b : {};
}

function cleanPath(p) {
  const path = String(p == null ? "" : p).trim();
  if (!path || path.length > 300 || path.includes("..") || !PATH.test(path)) return null;
  return path.replace(/^\/+/, "");
}

function queryString(q) {
  const out = [];
  for (const [k, v] of Object.entries(q && typeof q === "object" ? q : {})) {
    if (!/^[A-Za-z0-9_.\-\[\]]{1,60}$/.test(k)) continue;
    if (v === undefined || v === null || typeof v === "object") continue;
    out.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v)).slice(0, 300)}`);
  }
  return out.join("&");
}

function httpsUrl(v) {
  try {
    const u = new URL(String(v || "").trim());
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function settings(env) {
  const id = (env.XAMA_CLIENT_ID || "").trim();
  const secret = (env.XAMA_CLIENT_SECRET || "").trim();
  const token = httpsUrl(env.XAMA_TOKEN_URL);
  const base = httpsUrl(env.XAMA_API_BASE);
  const missing = [];
  if (!id) missing.push("XAMA_CLIENT_ID");
  if (!secret) missing.push("XAMA_CLIENT_SECRET");
  if (!token) missing.push("XAMA_TOKEN_URL");
  if (!base) missing.push("XAMA_API_BASE");
  const style = (env.XAMA_AUTH_STYLE || "basic").trim().toLowerCase() === "body" ? "body" : "basic";
  return { id, secret, token, base, scope: (env.XAMA_SCOPE || "").trim(), style, missing };
}

/** A short, safe excerpt of what Xama said, with anything that looks like a secret removed. */
function excerpt(text) {
  let t = String(text || "");
  t = t.replace(/("(?:access_token|refresh_token|client_secret|id_token)"\s*:\s*")[^"]+/gi, "$1…");
  return t.length > SAMPLE_CHARS ? t.slice(0, SAMPLE_CHARS) + "\n… (cut short)" : t;
}

function createHandler({ fetch = globalThis.fetch, env = process.env, now = () => Date.now() } = {}) {
  const signedIn = createSignIn({ fetch, now });
  let cached = null; // { value, until }

  async function getToken(s, force) {
    if (!force && cached && cached.until > now()) return { token: cached.value, fresh: false };
    const form = new URLSearchParams({ grant_type: "client_credentials" });
    if (s.scope) form.set("scope", s.scope);
    const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
    if (s.style === "basic") headers.Authorization = "Basic " + Buffer.from(`${encodeURIComponent(s.id)}:${encodeURIComponent(s.secret)}`).toString("base64");
    else { form.set("client_id", s.id); form.set("client_secret", s.secret); }
    let res;
    try {
      res = await fetch(s.token.href, { method: "POST", headers, body: form.toString() });
    } catch {
      return { error: "unreachable", message: "The app's server couldn't reach Xama's sign-in address. Check XAMA_TOKEN_URL." };
    }
    const text = await res.text().catch(() => "");
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok || !json || typeof json.access_token !== "string") {
      const why = json && (json.error_description || json.error);
      const hint =
        res.status === 401 || (json && json.error === "invalid_client")
          ? " Xama didn't accept the client ID and secret. If the secret is right, try XAMA_AUTH_STYLE=body."
          : res.status === 404 ? " The token address wasn't found: check XAMA_TOKEN_URL." : "";
      return { error: "token", status: res.status, message: `Xama refused to give an access token (HTTP ${res.status}${why ? `: ${why}` : ""}).${hint}`, excerpt: excerpt(text) };
    }
    const secs = Number(json.expires_in) > 0 ? Number(json.expires_in) : 300;
    cached = { value: json.access_token, until: now() + secs * 1000 - REFRESH_EARLY_MS };
    return { token: json.access_token, fresh: true, expiresIn: secs, scope: typeof json.scope === "string" ? json.scope : undefined, tokenType: json.token_type };
  }

  async function get(s, path, query, retry = true) {
    const t = await getToken(s, false);
    if (t.error) return t;
    const qs = queryString(query);
    const url = new URL(path, s.base.href.replace(/\/?$/, "/")).href + (qs ? "?" + qs : "");
    // Never leave the API address the administrator set.
    if (new URL(url).origin !== s.base.origin) return { error: "bad-path", message: "That path points outside the Xama address." };
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${t.token}`, Accept: "application/json" } });
    } catch {
      return { error: "unreachable", message: "The app's server couldn't reach Xama's API. Check XAMA_API_BASE." };
    }
    if (res.status === 401 && retry) { cached = null; return get(s, path, query, false); }
    const text = await res.text().catch(() => "");
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = undefined; }
    return { status: res.status, ok: res.ok, data, text, url };
  }

  async function respond(context, req) {
    const action = (context.bindingData && context.bindingData.action) || "";
    const method = String(req.method || "GET").toUpperCase();

    if (action === "status" && method === "GET") {
      const s = settings(env);
      return reply(200, {
        configured: s.missing.length === 0,
        missing: s.missing,
        clientIdEnding: s.id ? s.id.slice(-4) : "",
        tokenHost: s.token ? s.token.host : "",
        apiBase: s.base ? s.base.href : "",
        authStyle: s.style,
        scope: s.scope,
      });
    }

    if (method !== "POST" || !["test", "call"].includes(action)) return reply(404, { error: "not-found" });
    if (!(await signedIn(req))) return reply(401, { error: "signin", message: "Sign in to Practice Planner again." });
    const s = settings(env);
    if (s.missing.length) return reply(200, { error: "not-configured", message: `Not set up in Azure yet: ${s.missing.join(", ")}.`, missing: s.missing });
    const b = body(req);

    if (action === "test") {
      const steps = [];
      const t = await getToken(s, true);
      if (t.error) {
        steps.push({ name: "Sign in to Xama", ok: false, message: t.message, sample: t.excerpt });
        return reply(200, { ok: false, steps });
      }
      steps.push({ name: "Sign in to Xama", ok: true, message: `Xama accepted the client ID and secret. The access token lasts ${Math.round(t.expiresIn / 60)} minutes.${t.scope ? ` Scopes: ${t.scope}.` : ""}` });
      if (b.path !== undefined && String(b.path).trim() !== "") {
        const path = cleanPath(b.path);
        if (!path) {
          steps.push({ name: "Read from Xama", ok: false, message: "That path isn't valid. Use something like clients or v1/clients." });
          return reply(200, { ok: false, steps });
        }
        const r = await get(s, path, b.query);
        if (r.error) steps.push({ name: `Read ${path}`, ok: false, message: r.message });
        else steps.push({
          name: `Read ${path}`, ok: r.ok, status: r.status,
          message: r.ok ? `Xama answered (HTTP ${r.status}).` : r.status === 401 || r.status === 403 ? `Xama signed us in but refused this (HTTP ${r.status}). The account may not have API access to this, or a scope is missing.` : r.status === 404 ? "Xama doesn't have that path (HTTP 404). Check the API documentation for the exact address." : `Xama answered HTTP ${r.status}.`,
          sample: excerpt(r.text),
        });
      }
      return reply(200, { ok: steps.every((x) => x.ok), steps });
    }

    // call
    const path = cleanPath(b.path);
    if (!path) return reply(400, { error: "bad-path", message: "That path isn't valid." });
    const r = await get(s, path, b.query);
    if (r.error) return reply(200, { error: r.error, message: r.message });
    if (!r.ok) return reply(200, { error: "xama", status: r.status, message: `Xama answered HTTP ${r.status}.`, sample: excerpt(r.text) });
    return reply(200, { data: r.data === undefined ? r.text : r.data });
  }

  return async function handler(context, req) {
    context.res = await respond(context, req);
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.cleanPath = cleanPath;
