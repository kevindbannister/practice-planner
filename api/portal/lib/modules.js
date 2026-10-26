// Feature modules register their routes here. Each gets the same bound store and the same permission
// checks as the core: a module never decides who someone is or what they may see on its own.
const { createChanges, ChangeError } = require("./changes.js");
const { createCompanies } = require("./companies.js");
const { createDocuments, DocError } = require("./documents.js");
const { createSigning, SignError } = require("./signing.js");
const { ServiceError } = require("./service.js");

const asServiceError = (e) => ((e instanceof ChangeError || e instanceof DocError || e instanceof SignError) ? new ServiceError(e.status, e.code, e.message) : e);
const wrap = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { throw asServiceError(e); } };

function modules(parts, ctx) {
  const { service } = parts;
  const common = { audit: parts.audit, mailer: parts.mailer, now: ctx.now, practiceName: ctx.env.PORTAL_PRACTICE_NAME || "Your accountant" };
  const changes = createChanges({ ...common, notifyEmail: ctx.env.PORTAL_NOTIFY_EMAIL || "" });
  const companies = parts.companies || createCompanies({ key: String(ctx.env.CH_API_KEY || "").trim(), fetch: ctx.fetch, now: ctx.now });

  const docs = createDocuments({ ...common, files: parts.files, scanner: ctx.scanner || null, practiceId: parts.store.practiceId, notifyEmail: ctx.env.PORTAL_NOTIFY_EMAIL || "", maxBytes: Number(ctx.env.PORTAL_MAX_UPLOAD_MB) ? Number(ctx.env.PORTAL_MAX_UPLOAD_MB) * 1048576 : undefined });
  const portalUrl = ctx.env.PORTAL_URL || "";
  const signing = createSigning({ ...common, files: parts.files, docs, auditKey: ctx.env.PORTAL_AUDIT_KEY || "test-key", practiceId: parts.store.practiceId, notifyEmail: ctx.env.PORTAL_NOTIFY_EMAIL || "", portalUrl });
  const attention = [changes.attention, docs.attention, signing.attention];

  parts.signing = signing;
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
      // GET signing/<business>                                   requests that name this person
      // POST signing/<business>/<id>/document                    the PDF to read (named signatories only)
      // POST signing/<business>/<id>/sign   { mode: typed | drawn, typedName, image, consent: true }
      // POST signing/<business>/<id>/decline { reason }
      // Being an administrator gives no right to sign: the request has to name the person.
      signing: wrap(async ({ store, user, path, method, body, ip, ua }) => {
        const access = await service.require(store, user, path[0], "signing.sign");
        if (method === "GET" && !path[1]) return { requests: await signing.listForSigner(store, access, user) };
        if (method === "POST" && path[1] && path[2] === "document") return signing.openDocument(store, access, user, path[1]);
        if (method === "POST" && path[1] && path[2] === "sign") return { request: await signing.sign(store, access, user, path[1], body, { ip, ua }) };
        if (method === "POST" && path[1] && path[2] === "decline") return { request: await signing.decline(store, access, user, path[1], body) };
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
      signing: wrap(async (store, reader, staff, q) => ({ requests: await signing.staffList(store, String(q.clientKey || "")) })),
      documents: wrap(async (store, reader, staff, q) => ({ documents: await docs.staffList(store, String(q.clientKey || "")), categories: docs.CATEGORIES })),
    },
    adminPost: {
      "changes-ask": wrap(async (store, reader, staff, b) => changes.ask(store, staff, b.id, b.text)),
      "signing-create": wrap(async (store, reader, staff, b) => ({ request: await signing.create(store, { name: staff }, b) })),
      "signing-cancel": wrap(async (store, reader, staff, b) => ({ request: await signing.cancel(store, { name: staff }, b.id) })),
      "signing-remind": wrap(async (store, reader, staff, b) => ({ request: await signing.remind(store, { name: staff }, b.id) })),
      "signing-verify": wrap(async (store, reader, staff, b) => signing.verify(store, b.id)),
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
