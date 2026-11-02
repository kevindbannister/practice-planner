// What the bots may see and change. The rules are deliberately in one small file.
//   - Portal lists (client identities, signing, messages) are never exposed.
//   - Settings can be read (with connection secrets blanked) but never changed: it holds the sealed Xero and Adfin sign-ins.
//   - History and log lists are written by the app itself; bots can read them but not change them.
//   - Columns that hold secrets (Companies House authentication codes, anything named secret, token, sealed, password) are never returned or written.
//   - There is no delete.
const schema = require("./schema.json");

const LISTS = new Map(schema.lists.map((l) => [l.key, l]));
const HIDDEN_LISTS = new Set(schema.lists.filter((l) => /^Portal/.test(l.key)).map((l) => l.key));
const READ_ONLY_LISTS = new Set(["Settings", "FeeHistory", "JobHistory", "SalesLog", "Activities", "HmrcAuthEvents", "ChecklistLog", "CoSecLedger", "CoSecEvents", "CHFlags"]);
const HIDDEN_COLUMN = /secret|token|sealed|password|authcode|^LogoData$/i;
const SECRET_SETTING = /connection|secret|token|sealed|auth|credential/i;
const SYSTEM_COLUMNS = new Set(["Key", "PracticeId", "Created", "Modified"]);

const list = (key) => (HIDDEN_LISTS.has(key) ? undefined : LISTS.get(key));
const visibleLists = () => schema.lists.filter((l) => !HIDDEN_LISTS.has(l.key));
const visibleColumns = (l) => l.columns.filter((c) => !HIDDEN_COLUMN.test(c.name));
const canWrite = (key) => !!list(key) && !READ_ONLY_LISTS.has(key);
const writableColumns = (l) => visibleColumns(l).filter((c) => !SYSTEM_COLUMNS.has(c.name));

/** A row with secret columns removed, and for Settings the value of any connection setting blanked. */
function redact(l, row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) if (k === "_id" || k === "Title" || k === "Modified" || (l.columns.some((c) => c.name === k) && !HIDDEN_COLUMN.test(k))) out[k] = v;
  if (l.key === "Settings" && SECRET_SETTING.test(String(row.Key || ""))) out.Value = "(hidden)";
  return out;
}

module.exports = { list, visibleLists, visibleColumns, writableColumns, canWrite, redact, HIDDEN_COLUMN, READ_ONLY_LISTS, HIDDEN_LISTS, SYSTEM_COLUMNS };
