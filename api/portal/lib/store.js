// Where portal records are kept, behind one small interface so the place can change.
//
// Today they live in SharePoint lists (graphStore.js); later they can move to a database by
// writing another store with the same methods. Nothing else in the portal knows where data is.
//
// Every record belongs to one practice. A store is always *bound* to a practice before the
// portal code sees it, and a bound store cannot read, change or delete another practice's
// records: practice isolation is enforced here, at the data layer, not left to each caller.
//
// A raw store has these methods, each taking the practice id first:
//   list(pid, coll) -> docs          get(pid, coll, id) -> doc | null
//   insert(pid, coll, doc) -> doc    (fails if the id exists)
//   update(pid, coll, id, patch, expectedRev?) -> doc   (fails with "conflict" if rev moved)
//   remove(pid, coll, id)
// Audit events use `append` only: there is no update or delete for them.

const crypto = require("node:crypto");

class StoreError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const newId = (prefix = "") => `${prefix}${crypto.randomUUID()}`;

const { createMemoryFiles } = require("./fileStore.js");

function createMemoryStore() {
  const data = new Map(); // `${pid}|${coll}` -> Map(id -> doc)
  const table = (pid, coll) => {
    const k = `${pid}|${coll}`;
    if (!data.has(k)) data.set(k, new Map());
    return data.get(k);
  };
  const copy = (d) => (d ? JSON.parse(JSON.stringify(d)) : null);
  return {
    files: createMemoryFiles(),
    kind: "memory",
    async list(pid, coll) {
      return [...table(pid, coll).values()].map(copy);
    },
    async get(pid, coll, id) {
      return copy(table(pid, coll).get(id));
    },
    async insert(pid, coll, doc) {
      const t = table(pid, coll);
      if (!doc.id) throw new StoreError("invalid", "A record needs an id");
      if (t.has(doc.id)) throw new StoreError("exists", "Already exists");
      const full = { ...copy(doc), practiceId: pid, rev: 1 };
      t.set(doc.id, full);
      return copy(full);
    },
    async update(pid, coll, id, patch, expectedRev) {
      const t = table(pid, coll);
      const cur = t.get(id);
      if (!cur) throw new StoreError("missing", "Not found");
      if (expectedRev !== undefined && cur.rev !== expectedRev) throw new StoreError("conflict", "Changed by someone else");
      const next = { ...cur, ...copy(patch), id, practiceId: pid, rev: cur.rev + 1 };
      t.set(id, next);
      return copy(next);
    },
    async remove(pid, coll, id) {
      table(pid, coll).delete(id);
    },
    async append(pid, coll, doc) {
      return this.insert(pid, coll, doc);
    },
  };
}

const AUDIT = "audit";

/** A store for one practice. The portal code only ever gets one of these. */
function bind(raw, pid) {
  if (!pid || typeof pid !== "string") throw new StoreError("invalid", "A practice is needed");
  const mine = (d) => d && d.practiceId === pid;
  return {
    practiceId: pid,
    async list(coll) {
      return (await raw.list(pid, coll)).filter(mine);
    },
    async get(coll, id) {
      const d = await raw.get(pid, coll, id);
      return mine(d) ? d : null;
    },
    async find(coll, fn) {
      return (await this.list(coll)).filter(fn);
    },
    async insert(coll, doc) {
      if (coll === AUDIT) throw new StoreError("audit", "Audit events are only appended");
      return raw.insert(pid, coll, { ...doc, practiceId: pid });
    },
    async update(coll, id, patch, expectedRev) {
      if (coll === AUDIT) throw new StoreError("audit", "Audit events can't be changed");
      const cur = await raw.get(pid, coll, id);
      if (!mine(cur)) throw new StoreError("missing", "Not found");
      return raw.update(pid, coll, id, patch, expectedRev);
    },
    async remove(coll, id) {
      if (coll === AUDIT) throw new StoreError("audit", "Audit events can't be deleted");
      const cur = await raw.get(pid, coll, id);
      if (!mine(cur)) return;
      await raw.remove(pid, coll, id);
    },
    async append(doc) {
      return raw.append(pid, AUDIT, { ...doc, practiceId: pid });
    },
    async audit() {
      return (await raw.list(pid, AUDIT)).filter(mine);
    },
  };
}

module.exports = { StoreError, newId, createMemoryStore, bind, AUDIT };
