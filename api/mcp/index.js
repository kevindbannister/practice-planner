// An MCP server (Model Context Protocol, streamable HTTP, no sessions) that lets your bots read and change the
// planner's data. Each bot presents its own key as "Authorization: Bearer <key>". Settings (Azure):
//   MCP_KEYS                 JSON of bot names to {sha256, write}; make entries with `node api/mcp/make-key.js <name> [write]`
//   MCP_GRAPH_TENANT_ID, MCP_GRAPH_CLIENT_ID, MCP_GRAPH_CLIENT_SECRET   the MCP's own app registration (application permission
//                            limited to the planner's site, e.g. Sites.Selected with write on that site only)
//   MCP_PRACTICE_ID          optional, defaults to "default"
const { createPlanner } = require("./lib/planner.js");
const { createTools, ToolError } = require("./lib/tools.js");
const { readKeys, botFor } = require("./lib/keys.js");
const { PlannerError } = require("./lib/planner.js");

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = "This is the practice planner for an accounting practice: clients, the work (jobs) done for them, fees, leads and proposals, and tasks. Start with list_lists, then describe_list. Rows link by Key (a job's ClientKey is a client's Key). Use client_overview for a quick picture of one client. Changes are recorded on the timeline under your name; there is no delete. Dates are text like 2026-10-31.";
const LIMIT_PER_MINUTE = 120;
const MAX_BODY = 200000;

const out = (status, body, headers = {}) => ({ status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id === undefined ? null : id, error: { code, message } });
const header = (req, name) => { const h = req.headers || {}; return String(h[name] || h[name.toLowerCase()] || ""); };

function createHandler(deps = {}) {
  const env = deps.env || process.env;
  const now = deps.now || (() => Date.now());
  const keys = readKeys(env.MCP_KEYS);
  const needed = ["MCP_GRAPH_TENANT_ID", "MCP_GRAPH_CLIENT_ID", "MCP_GRAPH_CLIENT_SECRET"];
  const configured = keys.length > 0 && (deps.planner || needed.every((k) => String(env[k] || "").trim()));
  const windows = new Map(); // bot -> { start, n }
  let tools = null;
  const build = () => (tools ||= createTools({
    planner: deps.planner || createPlanner({ tenantId: env.MCP_GRAPH_TENANT_ID, clientId: env.MCP_GRAPH_CLIENT_ID, clientSecret: env.MCP_GRAPH_CLIENT_SECRET, fetch: deps.fetch, now }),
    practiceId: String(env.MCP_PRACTICE_ID || "default").trim(), now: () => new Date(now()).toISOString(),
  }));

  function limited(bot) {
    const w = windows.get(bot.name);
    if (!w || now() - w.start > 60000) { windows.set(bot.name, { start: now(), n: 1 }); return false; }
    return ++w.n > LIMIT_PER_MINUTE;
  }

  async function call(msg, bot) {
    const id = msg.id;
    const params = msg.params && typeof msg.params === "object" ? msg.params : {};
    switch (msg.method) {
      case "initialize": {
        const v = VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0];
        return { jsonrpc: "2.0", id, result: { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "practice-planner", version: "1.0.0" }, instructions: INSTRUCTIONS } };
      }
      case "ping": return { jsonrpc: "2.0", id, result: {} };
      case "tools/list": return { jsonrpc: "2.0", id, result: { tools: build().TOOLS.filter((t) => bot.write || !/^(create_row|update_row)$/.test(t.name)) } };
      case "tools/call": {
        const t = build();
        const fn = t.handlers[String(params.name)];
        if (!fn) return rpcError(id, -32602, `Unknown tool ${String(params.name)}`);
        try {
          const result = await fn(params.arguments && typeof params.arguments === "object" ? params.arguments : {}, bot);
          return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }], isError: false } };
        } catch (e) {
          const message = e instanceof ToolError || e instanceof PlannerError ? e.message : "That didn't work. Try again shortly.";
          return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: message }], isError: true } };
        }
      }
      default: return rpcError(id, -32601, `Method not found: ${msg.method}`);
    }
  }

  return async function handler(context, req) {
    const method = String(req.method || "").toUpperCase();
    if (!configured) { context.res = out(503, { error: "not-configured", message: "The MCP server isn't set up yet." }); return; }
    const token = header(req, "authorization").replace(/^Bearer\s+/i, "") || header(req, "x-api-key");
    const bot = botFor(keys, token.trim());
    if (!bot) { context.res = out(401, { error: "unauthorised" }, { "WWW-Authenticate": "Bearer" }); return; }
    if (method !== "POST") { context.res = out(405, { error: "method-not-allowed" }, { Allow: "POST" }); return; }
    if (limited(bot)) { context.res = out(429, { error: "rate-limited" }, { "Retry-After": "30" }); return; }
    const body = req.body;
    if (typeof body === "string" ? body.length > MAX_BODY : JSON.stringify(body || "").length > MAX_BODY) { context.res = out(413, rpcError(null, -32600, "Request too large")); return; }
    let data = body;
    if (typeof data === "string") { try { data = JSON.parse(data); } catch { context.res = out(400, rpcError(null, -32700, "Parse error")); return; } }
    const batch = Array.isArray(data);
    const msgs = batch ? data : [data];
    if (!msgs.length || msgs.length > 20 || msgs.some((m) => !m || typeof m !== "object" || m.jsonrpc !== "2.0" || typeof m.method !== "string")) { context.res = out(400, rpcError(null, -32600, "Invalid request")); return; }
    const replies = [];
    for (const m of msgs) {
      if (m.id === undefined || m.id === null) continue; // a notification: nothing to answer
      replies.push(await call(m, { name: bot.name, write: bot.write }));
    }
    if (!replies.length) { context.res = { status: 202, headers: { "Cache-Control": "no-store" } }; return; }
    context.res = out(200, batch ? replies : replies[0]);
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
