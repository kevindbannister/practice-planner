// Feature modules register their routes here. Each gets the same bound store and the same permission
// checks as the core: a module never decides who someone is or what they may see on its own.
const { createChanges, ChangeError } = require("./changes.js");
const { createCompanies } = require("./companies.js");
const { createDocuments, DocError } = require("./documents.js");
const { ServiceError } = require("./service.js");

const asServiceError = (e) => ((e instanceof ChangeError || e instanceof DocError) ? new ServiceError(e.status, e.code, e.message) : e);
const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { throw asServiceError(e); } };

function modules(parts, ctx) {
  const { service } = parts;
  const common = { audit: parts.audit, mailer: parts.mailer, now: ctx.now, practiceName: ctx.env.PORTAL_PRACTICE_NAME || "Your accountant" };
  const changes = createChanges({ ...common, notifyEmail: ctx.env.PORTAL_NOTIFY_EMAIL || "" });
  const companies = parts.companies || createCompanies({ key: String(ctx.env.CH_API_KEY || "").trim(), fetch: ctx.fetch, now: ctx.now });

  const docs = createDocuments({ ...common, files: parts.files, scanner: ctx.scanner || null, practiceId: parts.store.practiceId, notifyEmail: ctx.env.PORTAL_NOTIFY_EMAIL || "", maxBytes: Number(ctx.env.PORTAL_MAX_UPLOAD_MB) ? Number(ctx.env.PORTAL_MAX_UPLOAD_MB) * 1048576 : undefined });
  const portalUrl = ctx.env.PORTAL_URL || "";
  const attention = [changes.attention, docs.attention];

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
      // GET documents/<business>?q=&category=&status=           what they may see
      // POST documents/<business>                               upload { title, category, fileName, content (base64), message, replaces }
      // POST documents/<business>/<id>/download                 { version } -> { fileName, mime, content (base64) }
      // POST documents/<business>/<id>/approve                  { decision: approved | declined, note }
      documents: wrap(async ({ store, user, path, method, body, query }) => {
        const view = await service.require(store, user, path[0], "documents.view");
        if (method === "GET" && !path[1]) return { documents: await docs.listForClient(store, view, user, query), categories: docs.CATEGORIES, canUpload: service.permissionsFor(view)["documents.upload"], canApprove: service.permissionsFor(view)["documents.approve"] };
        if (method === "POST" && !path[1]) return { document: await docs.upload(store, await service.require(store, user, path[0], "documents.upload"), user, body) };
        if (method === "POST" && path[1] && path[2] === "download") return docs.download(store, view, user, path[1], body.version);
        if (method === "POST" && path[1] && path[2] === "approve") return { document: await docs.approve(store, await service.require(store, user, path[0], "documents.approve"), user, path[1], body) };
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
      documents: wrap(async (store, reader, staff, q) => ({ documents: await docs.staffList(store, String(q.clientKey || "")), categories: docs.CATEGORIES })),
    },
    adminPost: {
      "changes-ask": wrap(async (store, reader, staff, b) => changes.ask(store, staff, b.id, b.text)),
      "documents-add": wrap(async (store, reader, staff, b) => ({ document: await docs.staffAdd(store, { name: staff }, b, portalUrl) })),
      "documents-publish": wrap(async (store, reader, staff, b) => ({ document: await docs.staffPublish(store, { name: staff }, b.id, b, portalUrl) })),
      "documents-unpublish": wrap(async (store, reader, staff, b) => ({ document: await docs.staffUnpublish(store, { name: staff }, b.id) })),
      "documents-archive": wrap(async (store, reader, staff, b) => ({ document: await docs.staffArchive(store, { name: staff }, b.id) })),
      "documents-version": wrap(async (store, reader, staff, b) => ({ document: await docs.staffNewVersion(store, { name: staff }, b.id, b, portalUrl) })),
      "documents-edit": wrap(async (store, reader, staff, b) => ({ document: await docs.staffEdit(store, { name: staff }, b.id, b) })),
      "documents-seen": wrap(async (store, reader, staff, b) => ({ document: await docs.markSeen(store, { name: staff }, b.id) })),
      "documents-download": wrap(async (store, reader, staff, b) => docs.staffDownload(store, { name: staff }, b.id, b.version)),
      "changes-decide": wrap(async (store, reader, staff, b) => changes.decide(store, reader, staff, b.id, b.decisions)),
    },
    /** Things that need staff to do something, for the Portal overview. */
    attention: async (store, reader) => (await Promise.all(attention.map((f) => f(store, reader)))).flat().sort((a, b) => (a.at < b.at ? 1 : -1)),
  };
}
module.exports = { modules };
