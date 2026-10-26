// In-portal notifications. One short line per thing a person should know about, for one business (or
// for the person themselves when it isn't about a business, like an identity request). They are
// shown only to that person. They say what happened, never carry contents, and are never emailed from
// here (the modules send their own emails).

const { newId } = require("./store.js");

function createNotices({ now = () => Date.now() }) {
  return {
    /** Never throws: a failed notification must not undo the thing it was about. */
    async create(store, { userId, clientKey = "", text, link = "" }) {
      try {
        if (!userId || !text) return null;
        return await store.insert("notices", { id: newId("nt-"), userId, clientKey, text: String(text).slice(0, 200), link, at: new Date(now()).toISOString(), readAt: "" });
      } catch { return null; }
    },
    /** What this person sees for a business: that business's notices and their personal ones. */
    async list(store, userId, clientKey, limit = 30) {
      const all = (await store.find("notices", (n) => n.userId === userId && (n.clientKey === clientKey || n.clientKey === ""))).sort((a, b) => (a.at < b.at ? 1 : -1));
      return { notices: all.slice(0, limit).map((n) => ({ id: n.id, text: n.text, link: n.link, at: n.at, read: Boolean(n.readAt) })), unread: all.filter((n) => !n.readAt).length };
    },
    async markRead(store, userId, clientKey, ids) {
      const want = Array.isArray(ids) ? new Set(ids.map(String)) : null;
      for (const n of await store.find("notices", (x) => x.userId === userId && (x.clientKey === clientKey || x.clientKey === "") && !x.readAt && (!want || want.has(x.id)))) {
        await store.update("notices", n.id, { readAt: new Date(now()).toISOString() });
      }
    },
  };
}

module.exports = { createNotices };
