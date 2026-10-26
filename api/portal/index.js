// The client portal's server. Everything a portal user does goes through here: their browser
// never reaches SharePoint or Microsoft Graph, and every request is checked against what that
// person may see for that business before anything is read.
//
// Two kinds of caller, each with their own sign-in:
//   clients  sign in with the external identity provider (Microsoft Entra External ID);
//            token in the x-portal-token header          -> /api/portal/me, /business/..., /sessions/end
//   staff    sign in with the practice's Microsoft 365   -> /api/portal/admin/...
//
// Settings (Azure application settings) are listed in docs/client-portal.md. Until they're set,
// /api/portal/admin/status says which are missing and the rest answers "not set up".

const { createSignIn, reply, header, claims } = require("../shared/signin.js");
const { createVerifier, identityOf } = require("./lib/jwt.js");
const { bind, StoreError } = require("./lib/store.js");
const { createGraphStore } = require("./lib/graphStore.js");
const { createGraphMailer } = require("./lib/mailer.js");
const { createAudit } = require("./lib/audit.js");
const { createService, ServiceError } = require("./lib/service.js");
const { createLimiter } = require("./lib/limiter.js");
const { modules } = require("./lib/modules.js");

const REQUIRED = ["PORTAL_IDP_ISSUER", "PORTAL_IDP_JWKS_URL", "PORTAL_IDP_CLIENT_ID", "PORTAL_GRAPH_TENANT_ID", "PORTAL_GRAPH_CLIENT_ID", "PORTAL_GRAPH_CLIENT_SECRET", "PORTAL_AUDIT_KEY"];
const OPTIONAL = ["PORTAL_MAIL_FROM", "PORTAL_URL", "PORTAL_PRACTICE_ID", "PORTAL_PRACTICE_NAME", "PORTAL_ADMINS_MANAGE_ACCESS"];
const SITE_HOST = "insightinformation.sharepoint.com";
const SITE_PATH = "/sites/PracticePlanner";
const CLIENTS_LIST = "PP Clients";
const CLIENTS_FOR_MS = 30 * 1000;

function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body || "{}");
  } catch {
    return {};
  }
}

function ipOf(req) {
  return String(header(req, "x-forwarded-for") || header(req, "x-azure-clientip") || "unknown").split(",")[0].trim().replace(/:\d+$/, "") || "unknown";
}

/** Staff sign-in: the same Microsoft check the other bridges use, plus the person's name for the audit trail. */
function defaultStaffAuth(signedIn) {
  return async (req) => {
    if (!(await signedIn(req))) return null;
    const token = header(req, "x-pp-token") || header(req, "authorization").replace(/^Bearer\s+/i, "");
    const c = claims(token) || {};
    return { name: String(c.name || c.upn || c.unique_name || c.preferred_username || "Staff").slice(0, 100) };
  };
}

function createHandler(deps = {}) {
  const env = deps.env || process.env;
  const fetch = deps.fetch || globalThis.fetch;
  const now = deps.now || (() => Date.now());
  // Settings only count as missing when nothing stands in for them (tests and the dev server inject their own).
  const needs = (k) => !(deps.store && /^PORTAL_GRAPH_/.test(k)) && !(deps.verifier && /^PORTAL_IDP_/.test(k));
  const missing = REQUIRED.filter((k) => needs(k) && !String(env[k] || "").trim());
  const configured = missing.length === 0;

  const practiceId = String(env.PORTAL_PRACTICE_ID || "default").trim();
  const policy = { adminsManageAccess: /^(1|true|yes)$/i.test(String(env.PORTAL_ADMINS_MANAGE_ACCESS || "")) };
  const limiter = deps.limiter || createLimiter({ now });
  const staffAuth = deps.staffAuth || defaultStaffAuth(createSignIn({ fetch, now }));

  let parts = deps.parts || null; // built on first use so a missing setting only shows up when asked for
  function build() {
    if (parts) return parts;
    const raw = deps.store || createGraphStore({ tenantId: env.PORTAL_GRAPH_TENANT_ID, clientId: env.PORTAL_GRAPH_CLIENT_ID, clientSecret: env.PORTAL_GRAPH_CLIENT_SECRET, siteHost: SITE_HOST, sitePath: SITE_PATH, fetch, now });
    const verifier = deps.verifier || createVerifier({ issuer: env.PORTAL_IDP_ISSUER, audience: env.PORTAL_IDP_CLIENT_ID, jwksUrl: env.PORTAL_IDP_JWKS_URL, fetch, now });
    const mailer = deps.mailer || createGraphMailer({ from: env.PORTAL_MAIL_FROM, getToken: () => raw.token(), fetch });
    const audit = createAudit({ key: env.PORTAL_AUDIT_KEY || "test-key", now });
    let cached = { at: 0, rows: [] };
    const reader = deps.reader || {
      async clients() {
        if (now() - cached.at > CLIENTS_FOR_MS) cached = { at: now(), rows: await raw.readPlanner(CLIENTS_LIST) };
        return cached.rows;
      },
    };
    const service = createService({ audit, mailer, now, portalUrl: env.PORTAL_URL || "", practiceName: env.PORTAL_PRACTICE_NAME || "Your accountant", policy });
    parts = { raw, verifier, mailer, audit, reader, service, store: bind(raw, practiceId) };
    parts.mods = modules(parts, { now, env, policy });
    return parts;
  }

  async function portalUser(req, p) {
    const token = header(req, "x-portal-token") || header(req, "authorization").replace(/^Bearer\s+/i, "");
    if (!token) throw new ServiceError(401, "sign-in", "Please sign in");
    const v = await p.verifier.verify(token);
    if (!v.ok) {
      limiter.fail(ipOf(req));
      throw new ServiceError(401, "sign-in", "Please sign in again");
    }
    const { user } = await p.service.signIn(p.store, identityOf(v.claims));
    return user;
  }

  async function route(req, path, method) {
    const first = path[0];
    // ------------------------------------------------------------ staff
    if (first === "admin") {
      const staff = await staffAuth(req);
      if (!staff) {
        limiter.fail(ipOf(req));
        return reply(401, { error: "Please sign in with your Microsoft account." });
      }
      if (path[1] === "status") return reply(200, { configured, missing, optional: OPTIONAL.filter((k) => !String(env[k] || "").trim()), practiceId, policy });
      if (!configured) return reply(503, { error: "The client portal isn't set up yet.", missing });
      const p = build();
      const b = body(req);
      const S = p.service;
      const act = path[1];
      if (method === "GET") {
        if (act === "overview") return reply(200, await S.overview(p.store, p.reader));
        if (act === "events") return reply(200, { events: await S.events(p.store, { clientKey: req.query?.clientKey, userId: req.query?.userId, limit: req.query?.limit }) });
        const m = p.mods.adminGet?.[act];
        if (m) return reply(200, await m(p.store, p.reader, staff.name, req.query || {}));
        return reply(404, { error: "Not found" });
      }
      const ops = {
        invite: () => S.invite(p.store, p.reader, staff.name, b),
        resend: () => S.resend(p.store, staff.name, b.userId),
        access: () => S.setAccess(p.store, p.reader, staff.name, b.userId, b.clientKey, b.level),
        "remove-access": () => S.removeAccess(p.store, staff.name, b.userId, b.clientKey),
        link: () => S.linkPerson(p.store, staff.name, b.userId, b.personKey, b.personKind),
        suspend: () => S.suspend(p.store, staff.name, b.userId, b.reason),
        reinstate: () => S.reinstate(p.store, staff.name, b.userId),
        revoke: () => S.revoke(p.store, staff.name, b.userId),
        "change-email": () => S.changeEmail(p.store, staff.name, b.userId, b.email),
        "end-sessions": async () => {
          const u = await S.userById(p.store, b.userId);
          if (!u) throw new ServiceError(404, "not-found", "Not found");
          await S.endSessions(p.store, u, staff.name);
          return { ok: true };
        },
        ...(p.mods.adminPost || {}),
      };
      if (!ops[act]) return reply(404, { error: "Not found" });
      const out = await (p.mods.adminPost?.[act] ? p.mods.adminPost[act](p.store, p.reader, staff.name, b) : ops[act]());
      return reply(200, out ?? { ok: true });
    }

    // ------------------------------------------------------------ clients
    if (!configured) return reply(503, { error: "The client portal isn't set up yet.", code: "not-configured" });
    const p = build();
    const user = await portalUser(req, p);
    if (first === "me" && method === "GET") return reply(200, await p.service.me(p.store, p.reader, user));
    if (first === "business" && path[1] && method === "GET") return reply(200, await p.service.business(p.store, p.reader, user, path[1]));
    if (first === "sessions" && path[1] === "end" && method === "POST") {
      await p.service.endSessions(p.store, user);
      return reply(200, { ok: true });
    }
    const m = p.mods.portal?.[first];
    if (m) return reply(200, await m({ store: p.store, reader: p.reader, user, path: path.slice(1), method, body: body(req), query: req.query || {} }));
    return reply(404, { error: "Not found" });
  }

  return async function handler(context, req) {
    const method = String(req.method || "GET").toUpperCase();
    const raw = String((context.bindingData && context.bindingData.path) || (req.params && req.params.path) || "");
    const path = raw.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
    try {
      const ip = ipOf(req);
      if (!limiter.allow(ip, path[0] === "admin" ? "admin" : "portal")) return reply(429, { error: "Too many requests. Please wait a moment and try again." }, { "Retry-After": "30" });
      const res = await route(req, path, method);
      return res;
    } catch (e) {
      if (e instanceof ServiceError) return reply(e.status, { error: e.message, code: e.code });
      if (e instanceof StoreError) {
        if (e.code === "conflict") return reply(409, { error: "That changed while you were working. Please try again.", code: "conflict" });
        if (e.code === "unavailable") return reply(503, { error: "The portal is having trouble reaching its data. Please try again shortly.", code: "unavailable" });
      }
      if (context.log && context.log.error) context.log.error("portal", e && e.message);
      return reply(500, { error: "Something went wrong. Please try again." });
    }
  };
}

const handler = createHandler();
module.exports = async function (context, req) {
  context.res = await handler(context, req);
};
module.exports.createHandler = createHandler;
