// Tests for the MCP server, with the planner's SharePoint lists faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler } = require("../mcp/index.js");
const { createPlanner } = require("../mcp/lib/planner.js");
const { hash, readKeys, botFor } = require("../mcp/lib/keys.js");
const schema = require("../mcp/lib/schema.json");
const policy = require("../mcp/lib/policy.js");

const NOW = Date.UTC(2026, 10, 2, 12, 0, 0);
const READ = "ppmcp_reader-key", WRITE = "ppmcp_writer-key";
const KEYS = JSON.stringify({ reader: { sha256: hash(READ) }, writer: { sha256: hash(WRITE), write: true } });

function fakePlanner(seed = {}) {
  const data = { Clients: [{ _id: "1", Key: "C1", Title: "Acme Ltd", Kind: "Ltd", CHAuthCode: "SECRET", Modified: "t1" }, { _id: "2", Key: "C2", Title: "Bob Smith", Kind: "Individual", Modified: "t1" }], Jobs: [{ _id: "3", Key: "J1", Title: "Accounts", ClientKey: "C1", Status: "Open" }], Activities: [], Settings: [{ _id: "9", Key: "xero.connection", Value: "sealed-blob" }, { _id: "10", Key: "tightDays", Value: "21" }], ...seed };
  let n = 100;
  const calls = [];
  const real = createPlanner({ tenantId: "t", clientId: "c", clientSecret: "s", fetch: async () => { throw new Error("no network"); } });
  return {
    calls,
    async rows(k) { if (!data[k]) data[k] = []; return data[k].map((r) => ({ ...r })); },
    async create(k, v) { calls.push(["create", k, v]); data[k] = data[k] || []; const id = String(++n); data[k].push({ _id: id, ...v, Modified: "t2" }); return id; },
    async patch(k, id, v) { calls.push(["patch", k, id, v]); Object.assign(data[k].find((r) => r._id === id), v, { Modified: "t3" }); },
    toFields: real.toFields, data,
  };
}
function setup(planner = fakePlanner()) {
  const handler = createHandler({ env: { MCP_KEYS: KEYS }, planner, now: () => NOW });
  const rpc = async (key, body, extra = {}) => { const ctx = {}; await handler(ctx, { method: "POST", headers: key ? { authorization: `Bearer ${key}` } : {}, body, ...extra }); return ctx.res; };
  const tool = async (key, name, args) => { const r = await rpc(key, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }); const b = JSON.parse(r.body); return { isError: b.result.isError, data: b.result.isError ? b.result.content[0].text : JSON.parse(b.result.content[0].text) }; };
  return { planner, rpc, tool, handler };
}

test("a request without a known key is refused, and an unconfigured server says so", async () => {
  const { rpc } = setup();
  assert.equal((await rpc(null, { jsonrpc: "2.0", id: 1, method: "ping" })).status, 401);
  assert.equal((await rpc("wrong", { jsonrpc: "2.0", id: 1, method: "ping" })).status, 401);
  assert.equal((await rpc(READ, { jsonrpc: "2.0", id: 1, method: "ping" })).status, 200);
  const ctx = {}; await createHandler({ env: {} })(ctx, { method: "POST", headers: {}, body: {} });
  assert.equal(ctx.res.status, 503);
});
test("keys are stored hashed and bad entries are ignored", () => {
  assert.equal(readKeys(KEYS).length, 2);
  assert.deepEqual(readKeys("junk"), []);
  assert.equal(readKeys(JSON.stringify({ "bad name!": { sha256: hash("x") }, ok: { sha256: "short" } })).length, 0);
  assert.equal(botFor(readKeys(KEYS), WRITE).write, true);
  assert.equal(botFor(readKeys(KEYS), "nope"), null);
});
test("the protocol: initialize, notifications, tools list differs for a reader", async () => {
  const { rpc } = setup();
  const init = JSON.parse((await rpc(READ, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })).body);
  assert.equal(init.result.protocolVersion, "2025-03-26"); assert.ok(init.result.capabilities.tools);
  assert.equal((await rpc(READ, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const names = async (k) => JSON.parse((await rpc(k, { jsonrpc: "2.0", id: 2, method: "tools/list" })).body).result.tools.map((t) => t.name);
  assert.ok(!(await names(READ)).includes("update_row")); assert.ok((await names(WRITE)).includes("update_row"));
  assert.equal(JSON.parse((await rpc(READ, { jsonrpc: "2.0", id: 3, method: "nope" })).body).error.code, -32601);
  assert.equal((await rpc(READ, "{bad json")).status, 400);
  const ctx = {}; await createHandler({ env: { MCP_KEYS: KEYS }, planner: fakePlanner() })(ctx, { method: "GET", headers: { authorization: `Bearer ${READ}` } });
  assert.equal(ctx.res.status, 405);
});
test("reading hides secrets and portal lists", async () => {
  const { tool } = setup();
  const lists = (await tool(READ, "list_lists", {})).data.map((l) => l.list);
  assert.ok(lists.includes("Clients")); assert.ok(!lists.some((l) => /^Portal/.test(l)));
  const c = (await tool(READ, "get_row", { list: "Clients", key: "C1" })).data;
  assert.equal(c.Title, "Acme Ltd"); assert.equal(c.CHAuthCode, undefined);
  assert.match((await tool(READ, "query_rows", { list: "PortalUsers" })).data, /no list called/);
  const s = (await tool(READ, "query_rows", { list: "Settings" })).data.rows;
  assert.equal(s.find((r) => r.Key === "xero.connection").Value, "(hidden)"); assert.equal(s.find((r) => r.Key === "tightDays").Value, "21");
  assert.ok(!(await tool(READ, "describe_list", { list: "Clients" })).data.columns.some((c) => c.name === "CHAuthCode"));
});
test("queries filter, search, sort and page", async () => {
  const { tool } = setup();
  assert.equal((await tool(READ, "query_rows", { list: "Clients", where: { Kind: "ltd" } })).data.rows[0].Key, "C1");
  assert.equal((await tool(READ, "query_rows", { list: "Clients", contains: { Title: "smith" } })).data.total, 1);
  assert.equal((await tool(READ, "query_rows", { list: "Clients", text: "acme", columns: ["Kind"] })).data.rows[0].Kind, "Ltd");
  assert.equal((await tool(READ, "query_rows", { list: "Clients", sort: "-Title", limit: 1 })).data.rows[0].Key, "C2");
  assert.match((await tool(READ, "query_rows", { list: "Clients", where: { Nope: 1 } })).data, /no column/);
});
test("client overview finds one client and refuses an unclear name", async () => {
  const { tool } = setup();
  const o = (await tool(READ, "client_overview", { client: "acme" })).data;
  assert.equal(o.client.Key, "C1"); assert.equal(o.jobs.length, 1); assert.equal(o.client.CHAuthCode, undefined);
  assert.match((await tool(READ, "client_overview", { client: "zzz" })).data, /No client/);
});
test("a read-only key cannot change anything", async () => {
  const { tool, planner } = setup();
  assert.match((await tool(READ, "update_row", { list: "Clients", key: "C1", fields: { Status: "x" } })).data, /read but not change/);
  assert.equal(planner.calls.length, 0);
});
test("writing: creates and updates are checked, and recorded on the timeline", async () => {
  const { tool, planner } = setup();
  const made = (await tool(WRITE, "create_row", { list: "Jobs", fields: { Title: "VAT return", ClientKey: "C1" } })).data;
  assert.equal(made.created, true);
  const create = planner.calls.find((c) => c[0] === "create" && c[1] === "Jobs");
  assert.equal(create[2].Title, "VAT return"); assert.match(create[2].Key, /^MCP/);
  const upd = (await tool(WRITE, "update_row", { list: "Clients", key: "C1", fields: { Status: "Active" } })).data;
  assert.deepEqual(upd.changed, ["Status"]);
  const audits = planner.calls.filter((c) => c[1] === "Activities").map((c) => c[2]);
  assert.equal(audits.length, 2); assert.equal(audits[1].Actor, "mcp:writer"); assert.equal(audits[1].ClientKey, "C1"); assert.equal(audits[1].Type, "mcp-change");
  assert.equal((await tool(WRITE, "update_row", { list: "Clients", key: "C1", fields: { Status: "Active" } })).data.updated, false);
});
test("writes to protected things are refused", async () => {
  const { tool, planner } = setup();
  for (const [list, fields, re] of [["Settings", { Value: "x" }, /can't be changed/], ["PortalUsers", { Title: "x" }, /no list/], ["FeeHistory", { Action: "x" }, /can't be changed/], ["Clients", { CHAuthCode: "x" }, /no writable column/], ["Clients", { Key: "Z" }, /set by the system/], ["Clients", { Nope: "x" }, /no writable column/], ["Clients", { AnnualFees: { a: 1 } }, /must be text/]]) {
    const r = await tool(WRITE, "update_row", { list, key: "C1", fields });
    assert.equal(r.isError, true, list); assert.match(r.data, re, list);
  }
  assert.equal(planner.calls.length, 0);
});
test("an edit made by someone else since the bot read the row is refused", async () => {
  const { tool, planner } = setup();
  assert.match((await tool(WRITE, "update_row", { list: "Clients", key: "C1", fields: { Status: "x" }, expectedModified: "old" })).data, /changed by someone else/);
  assert.equal(planner.calls.length, 0);
  assert.equal((await tool(WRITE, "update_row", { list: "Clients", key: "C1", fields: { Status: "x" }, expectedModified: "t1" })).data.updated, true);
});
test("values are coerced to the column type", () => {
  const p = createPlanner({ tenantId: "t", clientId: "c", clientSecret: "s" });
  const jobs = schema.lists.find((l) => l.key === "Clients");
  assert.deepEqual(p.toFields(jobs, { AnnualFees: "1200.5", CHChecked: "true", Status: "" }), { AnnualFees: 1200.5, CHChecked: true, Status: "" });
  assert.throws(() => p.toFields(jobs, { AnnualFees: "lots" }), /number/);
  assert.throws(() => p.toFields(jobs, { CHChecked: "maybe" }), /true or false/);
});
test("a bot that asks too often is slowed", async () => {
  const { rpc } = setup();
  let last;
  for (let i = 0; i < 125; i++) last = await rpc(READ, { jsonrpc: "2.0", id: i, method: "ping" });
  assert.equal(last.status, 429);
});
test("no secret column or portal list is ever visible", () => {
  for (const l of policy.visibleLists()) for (const c of policy.visibleColumns(l)) assert.ok(!policy.HIDDEN_COLUMN.test(c.name), `${l.key}.${c.name}`);
  assert.ok(policy.visibleLists().every((l) => !/^Portal/.test(l.key)));
});

test("a key in x-api-key works even when Authorization carries an unrelated token (Static Web Apps replaces it)", async () => {
  const { rpc } = setup();
  const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
  assert.equal((await rpc("unrelated-swa-token", ping, { headers: { authorization: "Bearer unrelated-swa-token", "x-api-key": READ } })).status, 200);
  assert.equal((await rpc("unrelated-swa-token", ping, { headers: { authorization: "Bearer unrelated-swa-token", "x-mcp-key": WRITE } })).status, 200);
  assert.equal((await rpc("unrelated-swa-token", ping, { headers: { authorization: "Bearer unrelated-swa-token" } })).status, 401);
});

test("bots can read but never write HMRC filing records, approvals or their history", () => {
  const policy = require("../mcp/lib/policy.js");
  for (const k of ["HmrcFilings", "HmrcFilingLog"]) { assert.ok(policy.list(k), `${k} is a list`); assert.equal(policy.canWrite(k), false, `${k} can't be written`); }
});
