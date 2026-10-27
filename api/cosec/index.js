// Company secretarial filing bridge for Practice Planner.
//
// The browser never talks to Companies House and never holds the presenter details. The practice's Companies House presenter ID
// and authentication code live in Azure settings. Every call needs the signed-in person's Microsoft sign-in for this app.
//
//   GET  /api/cosec/info     -> { configured, test, missing, forms }   whether filing is set up, and whether it is in test mode
//   POST /api/cosec/submit   { txKey, form, payload, company: { number, name, authCode } } -> { gatewayRef, test }
//   POST /api/cosec/status   { gatewayRef } -> { status: pending | accepted | rejected, chRef?, reason? }
//
// Azure settings: CH_PRESENTER_ID, CH_PRESENTER_AUTH (required), CH_PRESENTER_EMAIL, CH_GATEWAY_URL (defaults to the Companies House
// TEST gateway), CH_GATEWAY_LIVE (1 to go live), CH_LIVE_FORMS (forms cleared for live use). See docs/co-sec-filing.md.

const { createSignIn, reply } = require("../shared/signin.js");
const { FORMS } = require("./lib/forms.js");
const { settings, submitForm, submissionStatus } = require("./lib/gateway.js");

function createHandler({ fetch = globalThis.fetch, env = process.env, now = () => Date.now() } = {}) {
  const signedIn = createSignIn({ fetch, now });
  const body = (req) => { const b = req.body; if (b && typeof b === "object") return b; try { return JSON.parse(String(b || "{}")); } catch { return {}; } };

  return async function handler(context, req) {
    const action = String((context.bindingData && context.bindingData.action) || (req.params && req.params.action) || "").replace(/\//g, "");
    let ok = false;
    try { ok = await signedIn(req); } catch { ok = false; }
    if (!ok) { context.res = reply(401, { error: "unauthorised", message: "Sign in to Practice Planner again." }); return; }

    const s = settings(env);
    if (action === "info" && req.method === "GET") {
      context.res = reply(200, { configured: !s.missing.length, test: !(s.live), missing: s.missing, forms: Object.keys(FORMS), live: s.liveForms });
      return;
    }
    if (req.method !== "POST" || (action !== "submit" && action !== "status")) { context.res = reply(400, { error: "bad-request", message: "That isn't something filing does." }); return; }
    const b = body(req);
    try {
      if (action === "submit") {
        const out = await submitForm({ fetch, env, form: String(b.form || "").toUpperCase(), payload: b.payload, company: b.company, now: now() });
        context.res = reply(200, out);
      } else {
        if (typeof b.test !== "boolean") { context.res = reply(400, { error: "bad-request", message: "Specify the original test or live gateway environment." }); return; }
        if (!/^\d{1,12}$/.test(String(b.gatewayRef || ""))) { context.res = reply(400, { error: "bad-request", message: "That isn't a submission reference." }); return; }
        context.res = reply(200, await submissionStatus({ fetch, env, gatewayRef: String(b.gatewayRef), test: b.test, now: now() }));
      }
    } catch (e) {
      const code = e && e.code ? e.code : "upstream";
      const status = code === "unreachable" || code === "upstream" ? 502 : code === "not-configured" ? 503 : 400;
      context.res = reply(status, { error: code, message: e && e.message ? e.message : "Companies House filing failed." });
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
