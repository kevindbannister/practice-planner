// Approvals checked and sealed on the server. The planner's screens can be bypassed by someone editing SharePoint directly, so an AML
// approval goes through here: the server reads the records itself (the portal's Graph app registration), runs exactly the same rules as
// the screen (api/shared/plannerlib.js, built from the app), takes the approver's name from their Microsoft sign-in, writes the
// approval, and seals it with a key only the server holds. /verify recomputes the seals so the planner can show any approved
// assessment that was changed afterwards.
//
//   GET  /api/approve/status          -> { configured, missing }
//   POST /api/approve/aml   { key }   -> { ok } or { error, message }
//   POST /api/approve/verify          -> { results: { [key]: "sealed" | "changed" | "unsealed" } }
//
// Settings: APPROVAL_SEAL_KEY (a long random string), PORTAL_GRAPH_TENANT_ID, PORTAL_GRAPH_CLIENT_ID, PORTAL_GRAPH_CLIENT_SECRET.

const crypto = require("node:crypto");
const { createSignIn, reply, header, claims } = require("../shared/signin.js");
const { createPlanner } = require("../mcp/lib/planner.js");

const NEEDED = ["APPROVAL_SEAL_KEY", "PORTAL_GRAPH_TENANT_ID", "PORTAL_GRAPH_CLIENT_ID", "PORTAL_GRAPH_CLIENT_SECRET"];
const londonToday = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const sealOf = (key, payload) => crypto.createHmac("sha256", key).update(payload).digest("base64url");
const sameSeal = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function createHandler({ fetch = globalThis.fetch, env = process.env, now = () => Date.now(), planner, lib } = {}) {
  const signedIn = createSignIn({ fetch, now });
  const rules = () => lib || require("../shared/plannerlib.js");
  const store = () => planner || createPlanner({ tenantId: env.PORTAL_GRAPH_TENANT_ID, clientId: env.PORTAL_GRAPH_CLIENT_ID, clientSecret: env.PORTAL_GRAPH_CLIENT_SECRET, fetch, now });
  const missing = () => NEEDED.filter((k) => !String(env[k] || "").trim());
  const body = (req) => { const b = req.body; if (b && typeof b === "object") return b; try { return JSON.parse(String(b || "{}")); } catch { return {}; } };
  const who = (req) => { let t = header(req, "x-pp-token") || header(req, "authorization").replace(/^Bearer\s+/i, ""); const c = t ? claims(t) : null; return String(c?.name || c?.unique_name || c?.upn || "").trim(); };

  async function respond(context, req) {
    const action = String((req.params && req.params.action) || (context.bindingData && context.bindingData.action) || "").toLowerCase();
    const method = String(req.method || "GET").toUpperCase();
    if (method === "GET" && action === "status") return reply(200, { configured: !missing().length, missing: missing() });
    if (method !== "POST" || !["aml", "verify"].includes(action)) return reply(404, { error: "not-found" });
    if (!(await signedIn(req))) return reply(401, { error: "signin", message: "Sign in to Practice Planner again." });
    if (missing().length) return reply(503, { error: "not-configured", message: `Server approvals aren't set up in Azure yet: ${missing().join(", ")}.` });
    const p = store(), L = rules(), key = env.APPROVAL_SEAL_KEY;

    if (action === "verify") {
      const rows = await p.rows("AmlAssessments", true);
      const results = {};
      for (const r of rows) {
        if (L.asStatus(r.Status) !== "approved") continue;
        results[r.Key] = !r.Seal ? "unsealed" : sameSeal(r.Seal, sealOf(key, L.sealPayload(r))) ? "sealed" : "changed";
      }
      return reply(200, { results });
    }

    const user = who(req);
    if (!user) return reply(400, { error: "who", message: "Your sign-in doesn't say who you are." });
    const b = body(req);
    if (typeof b.key !== "string" || !b.key) return reply(400, { error: "bad-request", message: "Which assessment?" });
    const [assessments, clients, settings, records] = await Promise.all([p.rows("AmlAssessments", true), p.rows("Clients", true), p.rows("Settings", true), p.rows("AmlRecords", true).catch(() => [])]);
    const iso = new Date(now()).toISOString();
    const w = L.approveAml({ key: b.key, user, assessments, clients, settings, records, today: londonToday(now()), now: iso });
    if (w.error) return reply(409, { error: "refused", message: w.error });
    // write: creates, then patches (sealing the approved row), then the audit line and timeline entries
    for (const c of w.creates || []) await p.create(c.list, strip(c.row));
    for (const x of w.patches) {
      const patch = { ...x.patch };
      if (x.list === "AmlAssessments" && x.row.Key === b.key) { const after = { ...x.row, ...patch }; patch.Seal = sealOf(key, L.sealPayload(after)); }
      await p.patch(x.list, x.row._id, strip(patch));
    }
    for (const l of w.log) await p.create("SalesLog", strip(l)).catch(() => undefined);
    for (const a of w.activities) await p.create("Activities", strip(a)).catch(() => undefined);
    return reply(200, { ok: true, by: user });
  }

  return async function (context, req) {
    try { context.res = await respond(context, req); }
    catch (e) { context.log && context.log.error && context.log.error(e); context.res = reply(502, { error: "failed", message: e && e.message ? String(e.message) : "Something went wrong on the server." }); }
  };
}

/** Rows as the planner writes them, without its own bookkeeping fields. */
function strip(row) { const o = {}; for (const [k, v] of Object.entries(row || {})) if (k !== "_id" && k !== "Modified" && v !== undefined) o[k] = v; return o; }

module.exports = createHandler();
module.exports.createHandler = createHandler;
