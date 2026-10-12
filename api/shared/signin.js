// Checks that a request carries Kevin's Microsoft sign-in for this app (the same token the app
// uses for SharePoint): for this app, from his Microsoft 365 tenant, unexpired, and accepted by
// Microsoft Graph. Graph's answer is remembered for 10 minutes per token.

const crypto = require("node:crypto");

const GRAPH_ME = "https://graph.microsoft.com/v1.0/me?$select=id";
const TENANT_ID = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
const CLIENT_ID = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";
const GRAPH_AUDIENCES = ["00000003-0000-0000-c000-000000000000", "https://graph.microsoft.com", "https://graph.microsoft.com/"];
const CHECK_FOR_MS = 10 * 60 * 1000;

function header(req, name) {
  const h = req.headers || {};
  return h[name] || h[name.toLowerCase()] || "";
}

/** The claims inside a sign-in token, or null if it isn't one. Signature is checked by Graph. */
function claims(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function createSignIn({ fetch = globalThis.fetch, now = () => Date.now() } = {}) {
  const confirmed = new Map(); // sha256(token) -> confirmed until (ms)
  return async function signedIn(req) {
    // Azure can replace the Authorization header on its way in, so the app sends its own.
    let token = header(req, "x-pp-token");
    if (!token) token = header(req, "authorization").replace(/^Bearer\s+/i, "");
    if (!token) return false;
    const c = claims(token);
    if (!c) return false;
    if (c.tid !== TENANT_ID) return false;
    if ((c.appid || c.azp) !== CLIENT_ID) return false;
    if (!GRAPH_AUDIENCES.includes(c.aud)) return false;
    const expires = Number(c.exp) * 1000;
    if (!expires || expires <= now()) return false;

    const id = crypto.createHash("sha256").update(token).digest("hex");
    const until = confirmed.get(id);
    if (until && until > now()) return true;
    const res = await fetch(GRAPH_ME, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return false;
    if (confirmed.size > 200) confirmed.clear();
    confirmed.set(id, Math.min(now() + CHECK_FOR_MS, expires));
    return true;
  };
}

function reply(status, body, headers = {}) {
  return {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
    body: JSON.stringify(body),
  };
}

module.exports = { createSignIn, reply, header, claims };
