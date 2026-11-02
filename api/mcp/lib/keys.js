// Bot keys. Each bot has its own key; only the SHA-256 of a key is kept (in the MCP_KEYS setting), so a leaked
// setting does not reveal the keys. MCP_KEYS is JSON: {"grok-ops":{"sha256":"<hex>","write":true},"grok-reader":{"sha256":"<hex>"}}
const crypto = require("node:crypto");

const hash = (key) => crypto.createHash("sha256").update(key).digest("hex");
const newKey = () => "ppmcp_" + crypto.randomBytes(32).toString("base64url");

function readKeys(raw) {
  let o;
  try { o = JSON.parse(String(raw || "{}")); } catch { return []; }
  if (!o || typeof o !== "object") return [];
  return Object.entries(o).filter(([n, v]) => /^[a-z0-9][a-z0-9_-]{0,39}$/i.test(n) && v && /^[0-9a-f]{64}$/i.test(String(v.sha256 || ""))).map(([name, v]) => ({ name, sha256: String(v.sha256).toLowerCase(), write: v.write === true }));
}
/** The bot a presented key belongs to, or null. Every stored hash is compared so timing doesn't reveal which exists. */
function botFor(keys, presented) {
  if (!presented) return null;
  const h = Buffer.from(hash(presented), "hex");
  let found = null;
  for (const k of keys) if (crypto.timingSafeEqual(h, Buffer.from(k.sha256, "hex"))) found = k;
  return found;
}
module.exports = { hash, newKey, readKeys, botFor };
