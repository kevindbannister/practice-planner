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

const { createSignIn, reply } = require("../shared/signin.js");

const CH_BASE = "https://api.company-information.service.gov.uk";

// company numbers are 8 characters: digits, or a 2-letter prefix (SC, NI, OC, ...) and 6 digits
const PATHS = /^company\/([a-z0-9]{8})(\/(?:officers|persons-with-significant-control|filing-history))?$/i;
const PAGING = ["items_per_page", "start_index"];

function createHandler({ fetch = globalThis.fetch, env = process.env, now = () => Date.now() } = {}) {
  const signedIn = createSignIn({ fetch, now });

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
