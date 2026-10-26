// The audit trail. Events are only ever added. Each carries a signature made with a key only the
// server holds, so an event edited or forged in the list afterwards no longer verifies.
// (Deleting an event is not detectable from the events themselves; SharePoint's version history
// and recycle bin are the second line there.)

const crypto = require("node:crypto");
const { newId } = require("./store.js");

const SECRET_KEY = /token|secret|password|passcode|code|authorization|cookie|key$/i;

/** Metadata with anything that looks like a credential removed, strings trimmed. */
function clean(meta) {
  if (!meta || typeof meta !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRET_KEY.test(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === "string") out[k] = v.slice(0, 500);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 50).map((x) => (typeof x === "string" ? x.slice(0, 200) : x));
    else if (typeof v === "object") out[k] = clean(v);
  }
  return out;
}

const canonical = (e) => JSON.stringify([e.id, e.practiceId, e.at, e.type, e.source, e.userId || "", e.actor || "", e.clientKey || "", e.recordId || "", e.meta]);
const sign = (key, e) => crypto.createHmac("sha256", key).update(canonical(e)).digest("hex");

function createAudit({ key, now = () => Date.now() }) {
  if (!key) throw new Error("An audit key is needed");
  return {
    /** type: what happened; source: "portal" | "staff" | "system". */
    async record(store, { type, source, userId, actor, clientKey, recordId, meta }) {
      const e = {
        id: newId("ev-"), practiceId: store.practiceId, at: new Date(now()).toISOString(), type, source: source || "system",
        userId: userId || "", actor: actor || "", clientKey: clientKey || "", recordId: recordId || "", meta: clean(meta),
      };
      e.mac = sign(key, e);
      await store.append(e);
      return e;
    },
    /** The events whose signature no longer matches what is stored. */
    async tampered(store) {
      return (await store.audit()).filter((e) => e.mac !== sign(key, e));
    },
    verify: (e) => e.mac === sign(key, e),
  };
}

module.exports = { createAudit, clean };
