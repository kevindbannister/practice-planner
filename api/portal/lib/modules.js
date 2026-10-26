// Feature modules register their routes here. Each gets the same bound store and the same permission
// checks as the core: a module never decides who someone is or what they may see on its own.
const { createChanges, ChangeError } = require("./changes.js");
const { createCompanies } = require("./companies.js");
const { ServiceError } = require("./service.js");

const asServiceError = (e) => (e instanceof ChangeError ? new ServiceError(e.status, e.code, e.message) : e);
const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { throw asServiceError(e); } };

function modules(parts, ctx) {
  const { service } = parts;
  const common = { audit: parts.audit, mailer: parts.mailer, now: ctx.now, practiceName: ctx.env.PORTAL_PRACTICE_NAME || "Your accountant" };
  const changes = createChanges({ ...common, notifyEmail: ctx.env.PORTAL_NOTIFY_EMAIL || "" });
  const companies = parts.companies || createCompanies({ key: String(ctx.env.CH_API_KEY || "").trim(), fetch: ctx.fetch, now: ctx.now });

  const attention = [changes.attention];

  return {
    portal: {
      // GET changes/<business>            this business's requests, and what can be changed
      // POST changes/<business>           propose changes   { items: [{ key, value }], note }
      // POST changes/<business>/<id>/reply | cancel
      changes: wrap(async ({ store, reader, user, path, method, body }) => {
        const access = await service.require(store, user, path[0], "business.requestChange");
        if (method === "GET") return { requests: await changes.listForClient(store, access.clientKey), editable: changes.meta() };
        if (method === "POST" && !path[1]) return { request: await changes.create(store, reader, user, access, body) };
        if (method === "POST" && path[1] && path[2] === "reply") return { request: await changes.reply(store, user, access.clientKey, path[1], body.text) };
        if (method === "POST" && path[1] && path[2] === "cancel") return { request: await changes.cancel(store, user, access.clientKey, path[1]) };
        throw new ServiceError(404, "not-found", "Not found");
      }),
      // GET official/<business>: what Companies House publishes, kept apart from what the practice holds
      official: wrap(async ({ store, reader, user, path }) => {
        const access = await service.require(store, user, path[0], "business.details");
        const row = (await reader.clients()).find((c) => c.Key === access.clientKey);
        if (!row || !row.CompanyNumber) return { official: null, configured: companies.configured };
        try {
          return { official: await companies.official(row.CompanyNumber), configured: companies.configured };
        } catch {
          return { official: null, configured: companies.configured, unavailable: true };
        }
      }),
    },
    adminGet: {
      changes: wrap(async (store, reader, staff, q) => ({ requests: await changes.staffList(store, reader, { status: q.status }) })),
    },
    adminPost: {
      "changes-ask": wrap(async (store, reader, staff, b) => changes.ask(store, staff, b.id, b.text)),
      "changes-decide": wrap(async (store, reader, staff, b) => changes.decide(store, reader, staff, b.id, b.decisions)),
    },
    /** Things that need staff to do something, for the Portal overview. */
    attention: async (store, reader) => (await Promise.all(attention.map((f) => f(store, reader)))).flat().sort((a, b) => (a.at < b.at ? 1 : -1)),
  };
}
module.exports = { modules };
