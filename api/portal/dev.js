// Local test server: serves the built app (app/dist) AND the real portal handler, with a memory store,
// a stand-in identity provider and a recording mailer. For trying the portal in a browser without
// Azure, Entra or SharePoint. Never deployed: Azure only runs the functions listed by function.json.
//
//   node api/portal/dev.js [port] [distDir]
//
//   /api/portal/*        the real handler (staff are anyone; clients sign in with the stand-in IdP)
//   /dev/idp/token       POST { email, name, mfa } -> an ID token the handler accepts
//   /dev/clients         PUT the client rows the "planner" has (the demo app does this itself)
//   /dev/mail            GET the emails the portal "sent"
//   /dev/now             POST { ms } moves the clock (and { reset: true } puts it back)

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createHandler } = require("./index.js");
const { createMemoryStore } = require("./lib/store.js");
const { createRecordingMailer } = require("./lib/mailer.js");

const port = Number(process.argv[2] || 5174);
const dist = path.resolve(process.argv[3] || path.join(__dirname, "../../app/dist"));
const config = JSON.parse(fs.readFileSync(path.join(dist, "staticwebapp.config.json"), "utf8"));
const origin = `http://127.0.0.1:${port}`;

const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "dev", use: "sig", alg: "RS256" };
const ISSUER = `${origin}/dev/idp`;
const AUDIENCE = "dev-portal";
const store = createMemoryStore();
const mailer = createRecordingMailer();
let clients = [];
let clock = 0;
const now = () => Date.now() + clock;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function idToken({ email, name, mfa }) {
  const head = b64({ alg: "RS256", kid: "dev", typ: "JWT" });
  const t = Math.floor(now() / 1000);
  const sub = "dev-" + crypto.createHash("sha256").update(String(email).toLowerCase()).digest("hex").slice(0, 16);
  const payload = b64({ iss: ISSUER, aud: AUDIENCE, sub, email, name, iat: t, exp: t + 3600, amr: mfa ? ["pwd", "mfa"] : ["pwd"] });
  return `${head}.${payload}.${crypto.sign("RSA-SHA256", Buffer.from(`${head}.${payload}`), pair.privateKey).toString("base64url")}`;
}

const handler = createHandler({
  env: { PORTAL_IDP_ISSUER: ISSUER, PORTAL_IDP_CLIENT_ID: AUDIENCE, PORTAL_IDP_JWKS_URL: `${origin}/dev/idp/keys`, PORTAL_AUDIT_KEY: "dev-audit-key", PORTAL_URL: `${origin}/portal`, PORTAL_PRACTICE_NAME: "Demo Accountants", PORTAL_MAIL_FROM: "portal@demo.test" },
  store, mailer, now, publicConfig: { dev: true },
  reader: { clients: async () => clients },
  staffAuth: async () => ({ name: "Demo user" }),
  fetch: async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwk] }) }),
});

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml", ".pdf": "application/pdf" };
const read = (req) => new Promise((resolve) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => resolve(Buffer.concat(c).toString("utf8"))); });
const send = (res, status, body, type = "application/json") => { res.writeHead(status, { "Content-Type": type, ...config.globalHeaders }); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  try {
    if (url.pathname.startsWith("/api/portal/")) {
      const text = await read(req);
      let body = text; try { body = text ? JSON.parse(text) : undefined; } catch { /* leave as text */ }
      const out = await handler({ bindingData: { path: url.pathname.slice("/api/portal/".length) } }, { method: req.method, headers: req.headers, body, query: Object.fromEntries(url.searchParams) });
      res.writeHead(out.status, { ...out.headers, ...config.globalHeaders });
      return res.end(out.body);
    }
    if (url.pathname === "/dev/idp/keys") return send(res, 200, { keys: [jwk] });
    if (url.pathname === "/dev/idp/token" && req.method === "POST") return send(res, 200, { token: idToken(JSON.parse(await read(req))) });
    if (url.pathname === "/dev/clients" && req.method === "PUT") { clients = JSON.parse(await read(req)); return send(res, 200, { ok: true, count: clients.length }); }
    if (url.pathname === "/dev/mail") return send(res, 200, mailer.sent);
    if (url.pathname === "/dev/now" && req.method === "POST") { const b = JSON.parse(await read(req)); clock = b.reset ? 0 : clock + Number(b.ms || 0); return send(res, 200, { clock }); }
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (!file.startsWith(dist)) return send(res, 403, "no", "text/plain");
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, url.pathname.startsWith("/portal") ? "portal.html" : "index.html");
    if (!fs.existsSync(file)) return send(res, 404, "not found", "text/plain");
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || "application/octet-stream");
  } catch (e) {
    send(res, 500, { error: String(e && e.message) });
  }
}).listen(port, "127.0.0.1", () => console.log(`dev server on ${origin}`));
