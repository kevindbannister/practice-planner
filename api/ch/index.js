// Companies House bridge for Practice Planner.
//
// The browser can't call Companies House directly: the API key would be visible to anyone,
// and Companies House doesn't allow calls from web pages. So the app calls
// /api/ch/<path> here, and this function adds the key (kept in the Azure setting CH_API_KEY)
// and passes the answer back.
//
// Only you can use it: each call must carry your Microsoft sign-in (the same token the app
// uses for SharePoint). It must be for this app, from your Microsoft 365 tenant, unexpired,
// and Microsoft Graph must accept it. Only read-only company lookups are allowed.

const crypto = require("node:crypto");

const CH_BASE = "https://api.company-information.service.gov.uk";
const GRAPH_ME = "https://graph.microsoft.com/v1.0/me?$select=id";
const TENANT_ID = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
const CLIENT_ID = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";
const GRAPH_AUDIENCES = ["00000003-0000-0000-c000-000000000000", "https://graph.microsoft.com", "https://graph.microsoft.com/"];
const CHECK_FOR_MS = 10 * 60 * 1000; // re-confirm a sign-in with Microsoft every 10 minutes

// company numbers are 8 characters: digits, or a 2-letter prefix (SC, NI, OC, ...) and 6 digits
const PATHS = /^company\/([a-z0-9]{8})(\/(?:officers|persons-with-significant-control|filing-history))?$/i;
const PAGING = ["items_per_page", "start_index"];

function reply(status, body, headers = {}) {
  return {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
    body: JSON.stringify(body),
  };
}

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

function createHandler({ fetch = globalThis.fetch, env = process.env, now = () => Date.now() } = {}) {
  const confirmed = new Map(); // sha256(token) -> confirmed until (ms)

  async function signedIn(req) {
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
  }

  return async function handler(context, req) {
    const asked = String((context.bindingData && context.bindingData.path) || (req.params && req.params.path) || "")
      .replace(/^\/+|\/+$/g, "");

    const key = (env.CH_API_KEY || "").trim();
    if (!key) {
      context.res = reply(503, { error: "not-configured", message: "The Companies House key hasn't been added to Azure yet." });
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

    const m = PATHS.exec(asked);
    if (!m) {
      context.res = reply(400, { error: "bad-request", message: "That isn't a company lookup this app makes." });
      return;
    }
    const path = `company/${m[1].toUpperCase()}${(m[2] || "").toLowerCase()}`;

    const url = new URL(`${CH_BASE}/${path}`);
    for (const p of PAGING) {
      const v = req.query && req.query[p];
      if (v !== undefined && /^\d{1,4}$/.test(String(v))) url.searchParams.set(p, String(v));
    }

    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: "Basic " + Buffer.from(key + ":").toString("base64"), Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      context.res = reply(502, { error: "unreachable", message: "Companies House didn't answer. Try again shortly." });
      return;
    }

    if (res.status === 200) {
      context.res = reply(200, await res.json());
    } else if (res.status === 404) {
      context.res = reply(404, { error: "not-found", message: "Companies House has no record of this." });
    } else if (res.status === 429) {
      const wait = res.headers.get("retry-after") || "60";
      context.res = reply(429, { error: "rate-limited", message: "Companies House asked us to slow down." }, { "Retry-After": wait });
    } else if (res.status === 401 || res.status === 403) {
      context.res = reply(502, { error: "key-rejected", message: "Companies House didn't accept the API key." });
    } else {
      context.res = reply(502, { error: "upstream", status: res.status, message: `Companies House returned an error (${res.status}).` });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
