// Shared helpers for the portal tests: a fake identity provider (real RSA signatures), a memory
// store, a recording mailer and a small client list with plenty of internal fields in it.
const crypto = require("node:crypto");
const { createHandler } = require("../portal/index.js");
const { createMemoryStore } = require("../portal/lib/store.js");
const { createRecordingMailer } = require("../portal/lib/mailer.js");

const NOW = Date.UTC(2026, 9, 26, 10, 0, 0);
const ISSUER = "https://idp.example/tenant/v2.0";
const AUDIENCE = "portal-client-id";
const JWKS = "https://idp.example/keys";

const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = (k, kid) => ({ ...k.publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(claims = {}, { key = pair.privateKey, kid = "k1", alg = "RS256" } = {}) {
  const head = b64({ alg, kid, typ: "JWT" });
  const payload = b64({ iss: ISSUER, aud: AUDIENCE, sub: "sub-1", email: "ann@example.com", name: "Ann Example", iat: NOW / 1000 - 60, exp: NOW / 1000 + 3600, ...claims });
  const sig = alg === "RS256" ? crypto.sign("RSA-SHA256", Buffer.from(`${head}.${payload}`), key).toString("base64url") : "x";
  return `${head}.${payload}.${sig}`;
}

const CLIENTS = [
  { Key: "c-acme", Title: "Acme Widgets Ltd", Kind: "Company", CompanyNumber: "01234567", Incorporated: "2015-03-02", YearEnd: "31 March", RegisteredOffice: "1 High St", Email: "office@acme.test", Phone: "0100", VATNumber: "GB123", PAYERef: "123/AB1",
    // internal: none of this may ever reach a portal user
    UTR: "1234567890", CTUTR: "0987654321", NINumber: "QQ123456C", CHAuthCode: "AUTH99", Notes: "Slow payer, chase hard", AnnualFees: 4800, Partner: "Kevin", Manager: "Sam", XamaStatus: "Red", AMLReview: "2025-01-01", HomeAddress: "9 Secret Lane", DateOfBirth: "1970-01-01", Importance: "key" },
  { Key: "c-bolt", Title: "Bolt Services Ltd", Kind: "Company", CompanyNumber: "07654321", Email: "hello@bolt.test", UTR: "5555555555", Notes: "internal bolt note" },
  { Key: "c-cove", Title: "Cove Consulting Ltd", Kind: "Company", CompanyNumber: "09999999" },
];

/** A tiny Companies House: public profile, officers and PSCs, with the personal data the real one also returns. */
function ch(u) {
  const res = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  if (/company\/01234567\/officers/.test(u)) return res({ items: [{ name: "EXAMPLE, Ann", officer_role: "director", appointed_on: "2015-03-02", date_of_birth: { month: 4, year: 1970 }, address: { address_line_1: "9 Secret Lane" }, nationality: "British", occupation: "Baker" }, { name: "GONE, Bob", officer_role: "director", appointed_on: "2015-03-02", resigned_on: "2020-01-01" }] });
  if (/company\/01234567\/persons/.test(u)) return res({ items: [{ name: "Ann Example", kind: "individual-person-with-significant-control", natures_of_control: ["ownership-of-shares-75-to-100-percent"], notified_on: "2016-04-06", address: { address_line_1: "9 Secret Lane" }, date_of_birth: { month: 4, year: 1970 } }] });
  if (/company\/01234567$/.test(u)) return res({ company_name: "ACME WIDGETS LIMITED", company_status: "active", type: "ltd", date_of_creation: "2015-03-02", sic_codes: ["62020"], registered_office_address: { address_line_1: "1 High St", locality: "London", postal_code: "N1 1AA" }, accounts: { next_due: "2026-12-31", accounting_reference_date: { day: "31", month: "03" } }, confirmation_statement: { next_due: "2027-03-16" } });
  return res({}, 404);
}

function setup({ practices = ["default"], env = {}, verify = true } = {}) {
  const rows = JSON.parse(JSON.stringify(CLIENTS));
  const raw = createMemoryStore();
  const mailer = createRecordingMailer();
  const state = { now: NOW };
  const handlers = {};
  for (const pid of practices) {
    handlers[pid] = createHandler({
      env: { PORTAL_IDP_ISSUER: ISSUER, PORTAL_IDP_CLIENT_ID: AUDIENCE, PORTAL_IDP_JWKS_URL: JWKS, PORTAL_PRACTICE_ID: pid, PORTAL_AUDIT_KEY: "audit-secret", PORTAL_URL: "https://pp.example/portal", PORTAL_PRACTICE_NAME: "Bannister & Co", CH_API_KEY: "ch-key", PORTAL_NOTIFY_EMAIL: "practice@bannister.test", ...env },
      store: raw,
      mailer,
      now: () => state.now,
      reader: { clients: async () => rows, updateClient: async (key, patch) => { Object.assign(rows.find((r) => r.Key === key), patch); } },
      staffAuth: async (req) => (req.headers && req.headers["x-staff"] ? { name: String(req.headers["x-staff"]) } : null),
      fetch: async (url) => {
        const u = String(url);
        if (u.includes("company-information")) return ch(u);
        return { ok: true, status: 200, json: async () => ({ keys: [jwk(pair, "k1")] }) };
      },
    });
  }
  async function call(pid, method, path, { body, headers = {}, query = {} } = {}) {
    const res = await handlers[pid]({ bindingData: { path } }, { method, headers: { "x-forwarded-for": "9.9.9.9", ...headers }, body, query });
    return { status: res.status, body: res.body ? JSON.parse(res.body) : null };
  }
  const pid0 = practices[0];
  const staff = (method, path, body, pid = pid0) => call(pid, method, `admin/${path}`, { body, headers: { "x-staff": "Kevin" } });
  const asUser = (claims, path = "me", pid = pid0, o = {}) => call(pid, o.method || "GET", path, { headers: { "x-portal-token": token(claims) }, body: o.body });
  return { raw, mailer, state, call, staff, asUser, token, rows };
}

module.exports = { setup, token, pair, other, jwk, NOW, ISSUER, AUDIENCE, JWKS, CLIENTS };
