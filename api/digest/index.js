// The morning digest email. A scheduled GitHub Action (.github/workflows/digest.yml) calls /run each morning with a shared key; the
// server reads the planner's lists itself (the portal's Graph app registration), builds each person's digest with the planner's own
// rules (api/shared/plannerlib.js), and sends it from the practice mailbox. Who gets it, and whether it is on, is set in the planner
// (Settings > Your firm > Morning email); each person's address is in the staff roles list.
//
//   POST /api/digest/run       header x-digest-key   -> { sent, skipped, errors }
//   POST /api/digest/preview   (signed in)           -> { digests: [{ to, name, subject, count, sections }] }  nothing is sent
//   POST /api/digest/test      (signed in)           -> sends your own digest to you now
//
// Settings: DIGEST_KEY, PORTAL_MAIL_FROM, PORTAL_GRAPH_TENANT_ID, PORTAL_GRAPH_CLIENT_ID, PORTAL_GRAPH_CLIENT_SECRET, and PLANNER_URL
// (the planner's address for the link; defaults to the portal's address without /portal).

const crypto = require("node:crypto");
const { createSignIn, reply, header, claims } = require("../shared/signin.js");
const { createPlanner } = require("../mcp/lib/planner.js");
const { createGraphMailer } = require("../portal/lib/mailer.js");

const NEEDED = ["PORTAL_MAIL_FROM", "PORTAL_GRAPH_TENANT_ID", "PORTAL_GRAPH_CLIENT_ID", "PORTAL_GRAPH_CLIENT_SECRET"];
const SETTINGS_KEY = "digest.settings", LAST_KEY = "digest.lastRun", STAFF_KEY = "checklist-config";
const london = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const read = (rows, key) => { const r = rows.find((x) => x.Key === key); try { return r && r.Value ? JSON.parse(String(r.Value)) : undefined; } catch { return undefined; } };
const sameKey = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Who gets a digest: staff with an email address; with no staff list, the fallback address gets the whole practice. */
function recipients(settings) {
  const cfg = read(settings, STAFF_KEY) || {};
  const ds = read(settings, SETTINGS_KEY) || {};
  const staff = Array.isArray(cfg.staff) ? cfg.staff.filter((s) => s && EMAIL.test(String(s.email || "").trim())).map((s) => ({ name: String(s.name), role: String(s.role || ""), email: String(s.email).trim() })) : [];
  if (staff.length) return staff;
  return EMAIL.test(String(ds.fallbackTo || "").trim()) ? [{ name: "", role: "partner", email: String(ds.fallbackTo).trim(), everything: true }] : [];
}

function createHandler({ fetch = globalThis.fetch, env = process.env, now = () => Date.now(), planner, mailer, lib } = {}) {
  const signedIn = createSignIn({ fetch, now });
  const rules = () => lib || require("../shared/plannerlib.js");
  let p = planner;
  const store = () => (p = p || createPlanner({ tenantId: env.PORTAL_GRAPH_TENANT_ID, clientId: env.PORTAL_GRAPH_CLIENT_ID, clientSecret: env.PORTAL_GRAPH_CLIENT_SECRET, fetch, now }));
  const mail = () => mailer || createGraphMailer({ from: env.PORTAL_MAIL_FROM, getToken: () => store().token(), fetch });
  const missing = () => NEEDED.filter((k) => !String(env[k] || "").trim());
  const link = () => String(env.PLANNER_URL || String(env.PORTAL_URL || "").replace(/\/portal\/?$/, "") || "").trim() || "the planner";
  const who = (req) => { const t = header(req, "x-pp-token") || header(req, "authorization").replace(/^Bearer\s+/i, ""); const c = t ? claims(t) : null; return String(c?.name || "").trim(); };

  async function data() {
    const s = store();
    const [clients, jobs, assessments, onboardings, settings, records] = await Promise.all(["Clients", "Jobs", "AmlAssessments", "Onboardings", "Settings", "AmlRecords"].map((k) => s.rows(k, true).catch(() => [])));
    return { clients, jobs, assessments, onboardings, settings, records };
  }
  async function saveLast(settings, value) {
    const s = store(), row = settings.find((x) => x.Key === LAST_KEY), v = JSON.stringify(value);
    if (row) await s.patch("Settings", row._id, { Value: v }); else await s.create("Settings", { Key: LAST_KEY, Title: LAST_KEY, Value: v });
  }

  async function respond(context, req) {
    const action = String((req.params && req.params.action) || (context.bindingData && context.bindingData.action) || "").toLowerCase();
    if (String(req.method || "").toUpperCase() !== "POST" || !["run", "preview", "test"].includes(action)) return reply(404, { error: "not-found" });
    if (action === "run") {
      if (!String(env.DIGEST_KEY || "") || !sameKey(header(req, "x-digest-key"), env.DIGEST_KEY)) return reply(401, { error: "key" });
    } else if (!(await signedIn(req))) return reply(401, { error: "signin", message: "Sign in to Practice Planner again." });
    if (missing().length) return reply(503, { error: "not-configured", message: `The morning email isn't set up in Azure yet: ${missing().join(", ")}.` });
    const L = rules(), d = await data(), today = london(now());
    const ds = read(d.settings, SETTINGS_KEY) || {};
    const people = recipients(d.settings);

    if (action === "preview") return reply(200, { digests: people.map((x) => L.digestFor(x, d, today)) });
    if (action === "test") {
      const me = who(req);
      const mine = people.find((x) => x.name && x.name.toLowerCase() === me.toLowerCase()) || (people.length === 1 ? people[0] : null);
      if (!mine) return reply(409, { error: "no-address", message: "Add your email address to the staff roles list first (Settings > Checks)." });
      const g = L.digestFor(mine, d, today), body = L.digestText(g, link());
      await mail().send({ to: g.to, subject: `${g.subject} (test)`, text: body.text, html: body.html });
      return reply(200, { ok: true, to: g.to, count: g.count });
    }

    // run: once a day, on the days chosen, only when switched on
    const last = read(d.settings, LAST_KEY) || {};
    if (!ds.enabled) return reply(200, { skipped: "off" });
    if (ds.days !== "daily" && [0, 6].includes(weekday(today))) return reply(200, { skipped: "weekend" });
    if (last.date === today) return reply(200, { skipped: "already-sent", at: last.at });
    const out = { date: today, at: new Date(now()).toISOString(), sent: 0, empty: 0, errors: [] };
    for (const x of people) {
      const g = L.digestFor(x, d, today);
      if (!g.count && !ds.sendEmpty) { out.empty++; continue; }
      try { const b = L.digestText(g, link()); await mail().send({ to: g.to, subject: g.subject, text: b.text, html: b.html }); out.sent++; }
      catch (e) { out.errors.push(`${x.email}: ${e && e.message ? e.message : "not sent"}`); }
    }
    await saveLast(d.settings, out).catch(() => undefined);
    return reply(200, out);
  }

  return async function (context, req) {
    try { context.res = await respond(context, req); }
    catch (e) { context.log && context.log.error && context.log.error(e); context.res = reply(502, { error: "failed", message: e && e.message ? String(e.message) : "Something went wrong on the server." }); }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.recipients = recipients;
