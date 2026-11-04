// HMRC filing bridge for Practice Planner: the shared part for Self Assessment (SA100, SA800) and Corporation Tax (CT600) XML filing.
// The browser never sees HMRC credentials or talks to HMRC; it asks this, and this decides whether the request may go anywhere.
//
//   GET  /api/filing/info                                   -> { store, environments, services }   (what is set up and what is blocked, and why)
//   POST /api/filing/send  { service, env, body, confirm }  -> { state, outcome, correlationId, irmark, receipt?, errors?, env }
//   POST /api/filing/poll  { service, env, correlationId, pollUrl } -> same
//
// env is "mock" (nothing leaves the server; the result is labelled mock), "ets" (HMRC's External Test Service) or "live". A request is
// refused unless it names the service, is explicitly confirmed, the environment is available, and the service's adapter exists.
// No adapter is registered yet (see lib/govtalk.js), so ets and live refuse and say why. Settings: FILING_VENDOR_ID, FILING_SENDER_ID,
// FILING_PASSWORD (settings or Key Vault, see lib/secrets.js), FILING_LIVE_ENABLED, FILING_LIVE_APPROVED_BY.
const { createSignIn, reply } = require("../shared/signin.js");
const gt = require("./lib/govtalk.js");
const { createSecrets } = require("./lib/secrets.js");
const { settingsFrom, envGate } = require("./lib/gate.js");

const SERVICES = ["SA100", "SA800", "CT600"];
const MODES = ["mock", "ets", "live"];

function createHandler({ fetch = globalThis.fetch, env = process.env, now = () => Date.now(), secrets } = {}) {
  const store = secrets || createSecrets({ env, fetch, now });
  const signedIn = createSignIn({ fetch, now });
  const body = (req) => { const b = req.body; if (b && typeof b === "object") return b; try { return JSON.parse(String(b || "{}")); } catch { return {}; } };
  const fail = (e) => reply(e.code === "bad-request" ? 400 : e.code === "blocked" ? 409 : e.code === "not-configured" ? 503 : 502, { error: e.code || "failed", message: e.message });

  return async function handler(context, req) {
    const path = String((context.bindingData && context.bindingData.path) || (req.params && req.params.path) || "").replace(/^\/+|\/+$/g, "");
    let ok = false;
    try { ok = await signedIn(req); } catch { ok = false; }
    if (!ok) { context.res = reply(401, { error: "unauthorised", message: "Sign in to Practice Planner again." }); return; }
    let st;
    try { st = await settingsFrom(env, store); } catch (e) { context.res = reply(502, { error: "failed", message: e.message }); return; }
    if (path === "info" && req.method === "GET") {
      const environments = Object.fromEntries(MODES.map((m) => [m, envGate(m, st)]));
      const services = Object.fromEntries(SERVICES.map((s) => { const a = gt.adapterFor(s); return [s, { adapter: !!a.adapter, reason: a.blocked }]; }));
      context.res = reply(200, { store: st.store, environments, services, liveEnabled: st.liveEnabled, liveApprovedBy: st.liveApprovedBy, vendorIdSet: st.vendorIdSet, testCredentialsSet: st.testCredentialsSet });
      return;
    }
    if (req.method !== "POST") { context.res = reply(405, { error: "bad-request" }); return; }
    const b = body(req);
    const service = String(b.service || ""), mode = String(b.env || "");
    try {
      if (!SERVICES.includes(service)) { const e = new Error("That isn't a filing service."); e.code = "bad-request"; throw e; }
      if (!MODES.includes(mode)) { const e = new Error("That isn't a filing environment."); e.code = "bad-request"; throw e; }
      const g = envGate(mode, st);
      if (!g.ok) { const e = new Error(g.reason); e.code = "blocked"; throw e; }
      if (path === "send") {
        if (b.confirm !== true) { const e = new Error("Filing has to be confirmed."); e.code = "bad-request"; throw e; }
        context.res = reply(200, mode === "mock" ? gt.mockSend({ service, body: String(b.body || "") }) : await gt.send({ fetch, secrets: store, service, mode, body: String(b.body || ""), keysFor: b.keys && typeof b.keys === "object" ? b.keys : {} }));
      } else if (path === "poll") {
        if (mode === "mock") { const e = new Error("A mock run is answered at once; there is nothing to poll."); e.code = "bad-request"; throw e; }
        context.res = reply(200, await gt.poll({ fetch, secrets: store, service, mode, correlationId: String(b.correlationId || ""), pollUrl: String(b.pollUrl || "") }));
      } else context.res = reply(404, { error: "bad-request", message: "That isn't something filing does." });
    } catch (e) { context.res = fail(e); }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
