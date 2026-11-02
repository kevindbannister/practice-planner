// The tools the bots can call. Reading is open to every bot; creating and updating only to bots whose key allows writing.
// Every change is also written to the client timeline (the Activities list) with the bot's name, so it can be seen and traced.
const policy = require("./policy.js");

const MAX_ROWS = 200;
const MAX_VALUE = 20000;
const str = (v) => (v === undefined || v === null ? "" : String(v));
const newKey = () => "MCP" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
class ToolError extends Error {}

const SCHEMA = (props, required = []) => ({ type: "object", properties: props, required, additionalProperties: false });
const LIST_PROP = { type: "string", description: "The list name from list_lists, e.g. Clients, Jobs, Actions" };

const TOOLS = [
  { name: "list_lists", description: "Lists every list of records in the practice planner (clients, jobs, services, fees, leads and so on) with what each holds and whether you may change it.", inputSchema: SCHEMA({}) },
  { name: "describe_list", description: "Shows a list's columns and their types, and which ones you may write.", inputSchema: SCHEMA({ list: LIST_PROP }, ["list"]) },
  {
    name: "query_rows",
    description: "Finds rows in a list. 'where' matches a column exactly (text ignores case), 'contains' matches part of a text column, and 'text' searches every text column. Dates are text like 2026-10-31. Returns at most 200 rows; use offset to page.",
    inputSchema: SCHEMA({
      list: LIST_PROP, where: { type: "object", description: "Column to exact value, e.g. {\"ClientKey\":\"C123\"}" }, contains: { type: "object", description: "Column to a piece of text" }, text: { type: "string", description: "Search all text columns" },
      columns: { type: "array", items: { type: "string" }, description: "Only return these columns (Key is always returned)" }, limit: { type: "integer", minimum: 1, maximum: MAX_ROWS }, offset: { type: "integer", minimum: 0 },
      sort: { type: "string", description: "Column to sort by; prefix with - for descending" },
    }, ["list"]),
  },
  { name: "get_row", description: "Gets one row by its Key.", inputSchema: SCHEMA({ list: LIST_PROP, key: { type: "string" } }, ["list", "key"]) },
  { name: "client_overview", description: "Everything about one client in one call: the client's record, services and fees, jobs, open actions and the latest timeline entries. Give the client's Key or part of the name.", inputSchema: SCHEMA({ client: { type: "string", description: "Client Key, or a name (must match one client)" } }, ["client"]) },
  {
    name: "create_row",
    description: "Adds a row to a list. 'fields' are column names and values (see describe_list). A Key is made for you. Only for lists you may write; the change is recorded on the timeline under your name.",
    inputSchema: SCHEMA({ list: LIST_PROP, fields: { type: "object", description: "Column values; empty string leaves a column blank" } }, ["list", "fields"]),
  },
  {
    name: "update_row",
    description: "Changes columns on an existing row, found by Key. Only the columns you send change; send an empty string to clear one. Pass expectedModified (the row's Modified from get_row) to refuse the change if someone else has edited it since. Recorded on the timeline under your name.",
    inputSchema: SCHEMA({ list: LIST_PROP, key: { type: "string" }, fields: { type: "object" }, expectedModified: { type: "string" } }, ["list", "key", "fields"]),
  },
];

function listOf(name) {
  const l = policy.list(str(name));
  if (!l) throw new ToolError(`There is no list called "${str(name)}". Use list_lists to see the names.`);
  return l;
}
const plainObject = (v, what) => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new ToolError(`${what} must be an object.`); return v; };
const cmp = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : str(a).localeCompare(str(b)));

function createTools({ planner, practiceId = "default", now = () => new Date().toISOString() }) {
  const visibleCols = (l) => policy.visibleColumns(l);
  const hasCol = (l, c) => c === "Title" || visibleCols(l).some((x) => x.name === c);

  async function find(l, key) {
    const k = str(key).trim();
    if (!k) throw new ToolError("Give the row's Key.");
    const row = (await planner.rows(l.key, true)).find((r) => r.Key === k);
    if (!row) throw new ToolError(`No row with Key ${k} in ${l.key}.`);
    return row;
  }
  async function audit(bot, action, l, row, changes) {
    const detail = Object.entries(changes).map(([k, v]) => `${k}: ${str(v).slice(0, 120)}`).join("; ").slice(0, 900);
    const clientKey = l.key === "Clients" ? str(row.Key) : str(row.ClientKey);
    try {
      await planner.create("Activities", {
        Key: "A" + newKey(), ClientKey: clientKey, Type: "mcp-change", Title: `${bot} ${action} ${l.key} ${str(row.Key)}`, Summary: detail, At: now(), Actor: `mcp:${bot}`, Source: "mcp", SourceKey: str(row.Key),
        EventKey: `mcp:${l.key}:${str(row.Key)}:${now()}`, Visibility: "normal", PracticeId: practiceId,
      });
      return "";
    } catch { return " The change was made but could not be written to the timeline."; }
  }
  /** Checks a set of values against what may be written to this list and returns them cleaned. */
  function checked(l, fields) {
    const f = plainObject(fields, "fields");
    const writable = new Set(policy.writableColumns(l).map((c) => c.name));
    writable.add("Title");
    const out = {};
    for (const [k, v] of Object.entries(f)) {
      if (!writable.has(k)) throw new ToolError(policy.SYSTEM_COLUMNS.has(k) ? `${k} is set by the system and can't be changed.` : `${l.key} has no writable column ${k}. Use describe_list.`);
      if (v !== null && typeof v === "object") throw new ToolError(`${k} must be text, a number or true/false.`);
      if (str(v).length > MAX_VALUE) throw new ToolError(`${k} is too long.`);
      out[k] = v;
    }
    if (!Object.keys(out).length) throw new ToolError("No fields to write.");
    return out;
  }
  const needWrite = (bot, l) => {
    if (!bot.write) throw new ToolError("This key can read but not change data.");
    if (!policy.canWrite(l.key)) throw new ToolError(`${l.key} can't be changed through this connection.`);
  };

  const handlers = {
    async list_lists() {
      return policy.visibleLists().map((l) => ({ list: l.key, holds: l.description, columns: visibleCols(l).length, canWrite: policy.canWrite(l.key) }));
    },
    async describe_list({ list }) {
      const l = listOf(list);
      const w = new Set(policy.writableColumns(l).map((c) => c.name));
      return { list: l.key, holds: l.description, canWrite: policy.canWrite(l.key), columns: [{ name: "Title", type: "text", writable: policy.canWrite(l.key) }, ...visibleCols(l).map((c) => ({ name: c.name, type: c.type, writable: policy.canWrite(l.key) && w.has(c.name) }))], notes: "Dates are text in the form 2026-10-31. Rows are linked by Key (for example a job's ClientKey is a client's Key)." };
    },
    async query_rows({ list, where, contains, text, columns, limit, offset, sort }) {
      const l = listOf(list);
      let rows = await planner.rows(l.key);
      for (const [k, v] of Object.entries(where ? plainObject(where, "where") : {})) {
        if (!hasCol(l, k)) throw new ToolError(`${l.key} has no column ${k}.`);
        rows = rows.filter((r) => (typeof r[k] === "string" ? r[k].toLowerCase() === str(v).toLowerCase() : str(r[k]) === str(v)));
      }
      for (const [k, v] of Object.entries(contains ? plainObject(contains, "contains") : {})) {
        if (!hasCol(l, k)) throw new ToolError(`${l.key} has no column ${k}.`);
        rows = rows.filter((r) => str(r[k]).toLowerCase().includes(str(v).toLowerCase()));
      }
      if (str(text).trim()) {
        const q = str(text).trim().toLowerCase();
        const cols = ["Title", ...visibleCols(l).filter((c) => c.type !== "number" && c.type !== "bool").map((c) => c.name)];
        rows = rows.filter((r) => cols.some((c) => str(r[c]).toLowerCase().includes(q)));
      }
      if (sort) { const desc = str(sort).startsWith("-"), col = str(sort).replace(/^-/, ""); if (!hasCol(l, col) && col !== "Modified") throw new ToolError(`${l.key} has no column ${col}.`); rows = [...rows].sort((a, b) => (desc ? -1 : 1) * cmp(a[col], b[col])); }
      const total = rows.length, from = Math.max(0, Number(offset) || 0), n = Math.min(MAX_ROWS, Math.max(1, Number(limit) || 50));
      const keep = Array.isArray(columns) && columns.length ? new Set(["Key", "Title", ...columns.map(String)]) : null;
      const page = rows.slice(from, from + n).map((r) => policy.redact(l, r)).map((r) => (keep ? Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))) : r));
      return { list: l.key, total, returned: page.length, offset: from, rows: page };
    },
    async get_row({ list, key }) {
      const l = listOf(list);
      return policy.redact(l, await find(l, key));
    },
    async client_overview({ client }) {
      const q = str(client).trim();
      if (!q) throw new ToolError("Give a client Key or name.");
      const clients = await planner.rows("Clients");
      let hits = clients.filter((c) => c.Key === q);
      if (!hits.length) hits = clients.filter((c) => str(c.Title).toLowerCase() === q.toLowerCase());
      if (!hits.length) hits = clients.filter((c) => str(c.Title).toLowerCase().includes(q.toLowerCase()));
      if (!hits.length) throw new ToolError(`No client matches "${q}".`);
      if (hits.length > 1) throw new ToolError(`More than one client matches "${q}": ${hits.slice(0, 10).map((c) => `${c.Title} (${c.Key})`).join(", ")}. Use the Key.`);
      const c = hits[0], k = c.Key;
      const mine = async (name, extra = (r) => true) => { const l = policy.list(name); return (await planner.rows(name)).filter((r) => r.ClientKey === k && extra(r)).map((r) => policy.redact(l, r)); };
      const acts = (await mine("Activities")).sort((a, b) => str(b.At).localeCompare(str(a.At))).slice(0, 10);
      return { client: policy.redact(policy.list("Clients"), c), services: await mine("ClientServices"), jobs: await mine("Jobs"), openActions: await mine("Actions", (r) => !/^(done|closed|complete)/i.test(str(r.Status))), latestTimeline: acts };
    },
    async create_row({ list, fields }, bot) {
      const l = listOf(list);
      needWrite(bot, l);
      const values = checked(l, fields);
      const key = newKey();
      const row = { Key: key, ...values, ...(l.columns.some((c) => c.name === "PracticeId") && values.PracticeId === undefined ? { PracticeId: practiceId } : {}) };
      await planner.create(l.key, row);
      const warn = await audit(bot.name, "created", l, { ...row, ClientKey: row.ClientKey }, values);
      return { created: true, list: l.key, key, note: `Added.${warn}` };
    },
    async update_row({ list, key, fields, expectedModified }, bot) {
      const l = listOf(list);
      needWrite(bot, l);
      const values = checked(l, fields);
      const row = await find(l, key);
      if (expectedModified && str(row.Modified) !== str(expectedModified)) throw new ToolError(`${l.key} ${key} was changed by someone else at ${row.Modified}. Get the row again before changing it.`);
      const changed = {};
      for (const [k, v] of Object.entries(values)) if (str(row[k]) !== str(v)) changed[k] = `${str(row[k]).slice(0, 60)} -> ${str(v)}`;
      if (!Object.keys(changed).length) return { updated: false, list: l.key, key: row.Key, note: "Nothing to change: the row already has those values." };
      await planner.patch(l.key, row._id, values);
      const warn = await audit(bot.name, "updated", l, row, changed);
      return { updated: true, list: l.key, key: row.Key, changed: Object.keys(changed), note: `Changed.${warn}` };
    },
  };
  return { TOOLS, handlers, ToolError };
}

module.exports = { createTools, TOOLS, ToolError };
