// PAYE Real Time Information filing bridge for Practice Planner. The planner builds each FPS and EPS; this adds the GovTalk envelope
// and the agent's Government Gateway sign-in (kept only in Azure settings), works out the IRmark, sends it to HMRC and reads the answer.
//
//   GET  /api/rti/info                                   -> { configured, live, missing }
//   POST /api/rti/send  { kind, officeNo, payeRef, body } -> { state: accepted | rejected | pending, correlationId, pollUrl, irmark, errors? }
//   POST /api/rti/poll  { kind, correlationId, pollUrl }  -> same
//   POST /api/rti/system/due   (header x-sweep-key)       -> sends queued submissions whose day has come and checks pending ones
//
// Every call except system/due needs the signed-in person's Microsoft sign-in. system/due is called by a scheduled GitHub Action with
// a shared key (RTI_SWEEP_KEY) and works on the "PP RTI Submissions" list with the portal's Graph app registration.
// Settings: RTI_SENDER_ID, RTI_PASSWORD, RTI_VENDOR_ID, RTI_LIVE (1 = live; anything else = HMRC's test service), RTI_SWEEP_KEY,
// PORTAL_GRAPH_TENANT_ID, PORTAL_GRAPH_CLIENT_ID, PORTAL_GRAPH_CLIENT_SECRET.

const crypto = require("node:crypto");
const { createSignIn, reply } = require("../shared/signin.js");
const gt = require("./lib/govtalk.js");
const { createList } = require("./lib/list.js");

const SITE_HOST = "insightinformation.sharepoint.com";
const SITE_PATH = "/sites/PracticePlanner";
const MAX_ATTEMPTS = 5;

const londonToday = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
const header = (req, name) => { const h = req.headers || {}; return h[name] || h[name.toLowerCase()] || ""; };

function createHandler({ fetch = globalThis.fetch, env = process.env, now = () => Date.now(), list, sleep } = {}) {
  const signedIn = createSignIn({ fetch, now });
  const body = (req) => { const b = req.body; if (b && typeof b === "object") return b; try { return JSON.parse(String(b || "{}")); } catch { return {}; } };
  const fail = (e) => reply(e.code === "bad-request" ? 400 : e.code === "not-configured" ? 503 : 502, { error: e.code || "failed", message: e.message });

  async function due() {
    const store = list || createList({ tenantId: env.PORTAL_GRAPH_TENANT_ID, clientId: env.PORTAL_GRAPH_CLIENT_ID, clientSecret: env.PORTAL_GRAPH_CLIENT_SECRET, siteHost: SITE_HOST, sitePath: SITE_PATH, fetch, now });
    const today = londonToday(now());
    const items = await store.due(today);
    const started = now();
    const done = [];
    for (const { id, f } of items) {
      if (now() - started > 30000) break; // stay well inside the function's time limit; the next run carries on
      const kind = String(f.Kind || "");
      try {
        let r;
        if (f.Status === "pending") r = await gt.poll({ fetch, env, kind, correlationId: f.CorrelationID, pollUrl: f.PollUrl });
        else {
          await store.patch(id, { Status: "sending", Attempts: Number(f.Attempts || 0) + 1 });
          r = await gt.submit({ fetch, env, kind, officeNo: f.OfficeNo, payeRef: f.PayeRef, irEnvelope: f.Body });
        }
        await store.patch(id, {
          Status: r.state, CorrelationID: r.correlationId || f.CorrelationID || "", PollUrl: r.pollUrl || f.PollUrl || "", IRmark: r.irmark || f.IRmark || "",
          Response: String(r.receipt || r.response || "").slice(0, 60000), Errors: r.errors?.length ? JSON.stringify(r.errors).slice(0, 60000) : "",
          SubmittedAt: f.SubmittedAt || new Date(now()).toISOString(), ...(r.state === "pending" ? {} : { AnsweredAt: new Date(now()).toISOString() }), Live: r.live ? "yes" : "no",
        });
        done.push({ id, state: r.state });
      } catch (e) {
        const attempts = Number(f.Attempts || 0) + (f.Status === "pending" ? 0 : 1);
        const state = e.code === "bad-request" || attempts >= MAX_ATTEMPTS ? "failed" : f.Status === "pending" ? "pending" : "queued";
        await store.patch(id, { Status: state, Errors: JSON.stringify([{ number: e.code || "", text: e.message }]) }).catch(() => null);
        done.push({ id, state, error: e.message });
      }
    }
    return { today, checked: items.length, done };
  }

  return async function handler(context, req) {
    const path = String((context.bindingData && context.bindingData.path) || (req.params && req.params.path) || "").replace(/^\/+|\/+$/g, "");
    if (path === "system/due" && req.method === "POST") {
      const want = String(env.RTI_SWEEP_KEY || ""), got = String(header(req, "x-sweep-key") || "");
      if (!want) { context.res = reply(503, { error: "not-configured", message: "The scheduled filing isn't set up (RTI_SWEEP_KEY)." }); return; }
      const a = crypto.createHash("sha256").update(got).digest(), b = crypto.createHash("sha256").update(want).digest();
      if (!crypto.timingSafeEqual(a, b)) { context.res = reply(401, { error: "unauthorised" }); return; }
      try { context.res = reply(200, { ok: true, ...(await due()) }); } catch (e) { context.res = reply(502, { error: "failed", message: e.message }); }
      return;
    }
    let ok = false;
    try { ok = await signedIn(req); } catch { ok = false; }
    if (!ok) { context.res = reply(401, { error: "unauthorised", message: "Sign in to Practice Planner again." }); return; }
    const s = gt.settings(env);
    if (path === "info" && req.method === "GET") { context.res = reply(200, { configured: !s.missing.length, live: s.live, missing: s.missing }); return; }
    if (req.method !== "POST") { context.res = reply(405, { error: "bad-request" }); return; }
    const b = body(req);
    try {
      if (path === "send") context.res = reply(200, await gt.sendAndWait({ fetch, env, kind: String(b.kind || ""), officeNo: String(b.officeNo || ""), payeRef: String(b.payeRef || ""), irEnvelope: String(b.body || ""), waitMs: 20000, sleep, now }));
      else if (path === "poll") context.res = reply(200, await gt.poll({ fetch, env, kind: String(b.kind || ""), correlationId: String(b.correlationId || ""), pollUrl: String(b.pollUrl || "") }));
      else context.res = reply(404, { error: "bad-request", message: "That isn't something filing does." });
    } catch (e) { context.res = fail(e); }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
