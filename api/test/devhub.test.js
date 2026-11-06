// Tests for the Development Hub GitHub bridge, with Microsoft Graph and GitHub faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler } = require("../devhub/index.js");

const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
const TENANT = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
const CLIENT = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";
function token() {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return [enc({ alg: "RS256" }), enc({ tid: TENANT, appid: CLIENT, aud: "00000003-0000-0000-c000-000000000000", exp: NOW / 1000 + 3600 }), "sig"].join(".");
}
const ISSUES = [
  { number: 4, title: "[P1] Validate M365", state: "open", labels: [{ name: "status:ready" }], html_url: "u4", body: "b", updated_at: "2026-11-06T10:00:00Z" },
  { number: 3, title: "A pull request", state: "closed", labels: [], html_url: "u3", pull_request: {}, updated_at: "2026-11-05T10:00:00Z" },
];

function fakeFetch({ graphOk = true, mail = "kevin@example.com", gh = {} } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (u.startsWith("https://graph.microsoft.com/")) return { ok: graphOk, status: graphOk ? 200 : 401, json: async () => ({ id: "me", userPrincipalName: mail }), headers: { get: () => null } };
    const path = u.replace("https://api.github.com/repos/kevindbannister/practice-planner/", "");
    const key = `${opts.method || "GET"} ${path}`;
    const hit = Object.entries(gh).find(([k]) => key.startsWith(k));
    const r = hit ? hit[1] : { status: 200, body: [] };
    return { ok: r.status < 300, status: r.status, json: async () => r.body, headers: { get: (k) => (r.headers || {})[k] || null } };
  };
  fn.calls = calls;
  return fn;
}

async function call({ path, method = "GET", body, query = {}, fetch = fakeFetch(), env = { GITHUB_TOKEN: "ghp_secret" }, tok = token() }) {
  const h = createHandler({ fetch, env, now: () => NOW });
  const context = { bindingData: { path } };
  await h(context, { method, headers: tok ? { "x-pp-token": tok } : {}, query, body, params: { path } });
  return { status: context.res.status, body: JSON.parse(context.res.body), fetch };
}

test("needs the app's Microsoft sign-in", async () => {
  assert.equal((await call({ path: "issues", tok: "" })).status, 401);
  assert.equal((await call({ path: "issues", fetch: fakeFetch({ graphOk: false }) })).status, 401);
});

test("status says whether the token is set, without revealing it", async () => {
  const on = await call({ path: "status" });
  assert.deepEqual(on.body, { configured: true, repo: "kevindbannister/practice-planner", admins: false });
  assert.ok(!JSON.stringify(on.body).includes("ghp_"));
  assert.equal((await call({ path: "status", env: {} })).body.configured, false);
  assert.equal((await call({ path: "issues", env: {} })).status, 503);
});

test("only listed administrators when DEVHUB_ADMINS is set", async () => {
  const env = { GITHUB_TOKEN: "t", DEVHUB_ADMINS: "kevin@example.com" };
  assert.equal((await call({ path: "status", env })).status, 200);
  assert.equal((await call({ path: "status", env, fetch: fakeFetch({ mail: "other@example.com" }) })).status, 403);
});

test("lists issues, leaving out pull requests, and uses the token only on the way to GitHub", async () => {
  const f = fakeFetch({ gh: { "GET issues": { status: 200, body: ISSUES } } });
  const r = await call({ path: "issues", fetch: f });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.issues.map((i) => i.number), [4]);
  assert.deepEqual(r.body.issues[0].labels, ["status:ready"]);
  const g = f.calls.find((c) => c.url.includes("api.github.com"));
  assert.equal(g.headers.Authorization, "Bearer ghp_secret");
  assert.ok(!JSON.stringify(r.body).includes("ghp_secret"));
});

test("creating an issue refuses a duplicate title and bad input", async () => {
  const gh = { "GET issues": { status: 200, body: ISSUES }, "POST issues": { status: 201, body: { number: 12, title: "New", state: "open", labels: [], html_url: "u", updated_at: "x" } } };
  const dup = await call({ path: "issues", method: "POST", body: { title: "validate m365" }, fetch: fakeFetch({ gh }) });
  assert.equal(dup.status, 409); assert.equal(dup.body.issue.number, 4);
  const f = fakeFetch({ gh });
  const made = await call({ path: "issues", method: "POST", body: { title: "Something new", labels: ["status:ready"] }, fetch: f });
  assert.equal(made.status, 201); assert.equal(made.body.issue.number, 12);
  assert.equal(f.calls.filter((c) => c.method === "POST" && c.url.includes("api.github.com")).length, 1);
  assert.equal((await call({ path: "issues", method: "POST", body: { title: "" } })).status, 400);
  assert.equal((await call({ path: "issues", method: "POST", body: { title: "x", labels: ["bad<script>"] } })).status, 400);
});

test("updating an issue passes only what was asked, and closing works", async () => {
  const f = fakeFetch({ gh: { "PATCH issues/4": { status: 200, body: { ...ISSUES[0], state: "closed" } } } });
  const r = await call({ path: "issues/4", method: "PATCH", body: { state: "closed", labels: ["P1"], evil: 1 }, fetch: f });
  assert.equal(r.status, 200); assert.equal(r.body.issue.state, "closed");
  assert.deepEqual(f.calls.find((c) => c.method === "PATCH").body, { state: "closed", labels: ["P1"] });
  assert.equal((await call({ path: "issues/4", method: "PATCH", body: { state: "deleted" } })).status, 400);
  assert.equal((await call({ path: "issues/4", method: "PATCH", body: {} })).status, 400);
  assert.equal((await call({ path: "issues/abc", method: "PATCH", body: { state: "open" } })).status, 400);
});

test("failures from GitHub are reported, not swallowed", async () => {
  const cases = [[401, 502, "token-rejected"], [404, 404, "not-found"], [422, 422, "invalid"], [500, 502, "upstream"]];
  for (const [gs, status, error] of cases) {
    const r = await call({ path: "issues/4", fetch: fakeFetch({ gh: { "GET issues/4": { status: gs, body: { message: "m" } } } }) });
    assert.equal(r.status, status); assert.equal(r.body.error, error);
  }
  const forbidden = await call({ path: "issues/4", method: "PATCH", body: { state: "open" }, fetch: fakeFetch({ gh: { "PATCH": { status: 403, body: { message: "Resource not accessible" } } } }) });
  assert.equal(forbidden.status, 403); assert.equal(forbidden.body.error, "forbidden");
  const limited = await call({ path: "issues", fetch: fakeFetch({ gh: { "GET issues": { status: 403, body: {}, headers: { "x-ratelimit-remaining": "0" } } } }) });
  assert.equal(limited.status, 429);
  const down = await call({ path: "issues", fetch: async (u) => { if (String(u).includes("graph")) return { ok: true, status: 200, json: async () => ({}) }; throw new Error("net"); } });
  assert.equal(down.status, 502); assert.equal(down.body.error, "unreachable");
});

test("pull requests, commits and a combined activity feed", async () => {
  const gh = {
    "GET pulls": { status: 200, body: [{ number: 3, title: "Fix", html_url: "p", updated_at: "2026-11-05T10:00:00Z", user: { login: "k" }, state: "closed", merged_at: "x" }] },
    "GET commits": { status: 200, body: [{ sha: "abcdef123456", html_url: "c", commit: { message: "Do thing (#4)\n\nlong", author: { date: "2026-11-06T11:00:00Z", name: "K" } }, author: { login: "k" } }] },
    "GET issues": { status: 200, body: ISSUES },
  };
  const a = await call({ path: "activity", fetch: fakeFetch({ gh }) });
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.items.map((i) => i.kind), ["commit", "issue", "pull"]);
  assert.equal(a.body.items[0].title, "Do thing (#4)");
  assert.equal(a.body.items[2].state, "merged");
});

test("comments need text, and anything unknown is refused", async () => {
  assert.equal((await call({ path: "issues/4/comments", method: "POST", body: { body: "" } })).status, 400);
  assert.equal((await call({ path: "issues/4/comments", method: "POST", body: { body: "hi" }, fetch: fakeFetch({ gh: { "POST issues/4/comments": { status: 201, body: {} } } }) })).status, 201);
  assert.equal((await call({ path: "repos/other/thing" })).status, 400);
  assert.equal((await call({ path: "issues", method: "DELETE" })).status, 400);
});
