// Tests for the AI writing bridge, with Microsoft Graph and OpenAI faked.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHandler, parseAnswer, pickModel, userMessage } = require("../ai/index.js");

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0);
const TENANT = "69bd0549-2696-4a31-b1ed-66ac01abacf1";
const CLIENT = "4ad0ec52-92a4-46d3-b1b0-7d3b0a4654a0";
const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (c = {}) => [enc({ alg: "RS256" }), enc({ tid: TENANT, appid: CLIENT, aud: "00000003-0000-0000-c000-000000000000", exp: NOW / 1000 + 3600, ...c }), "sig"].join(".");

function res(status, body) {
  const r = { ok: status >= 200 && status < 300, status, json: async () => body };
  r.clone = () => res(status, body);
  return r;
}

function fakeFetch({ models = ["gpt-4o", "gpt-5-mini", "whisper-1", "gpt-4o-audio-preview"], answers = [] } = {}) {
  const calls = [];
  const queue = [...answers];
  const fn = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, body: opts.body ? JSON.parse(opts.body) : undefined, headers: opts.headers || {} });
    if (u.startsWith("https://graph.microsoft.com/")) return res(200, { id: "me" });
    if (u.endsWith("/models")) return res(200, { data: models.map((id) => ({ id })) });
    return queue.shift() || res(200, { choices: [{ message: { content: JSON.stringify({ subject: "Your accounts", body: "Para one.\n\nPara two." }) } }] });
  };
  fn.calls = calls;
  return fn;
}

async function call({ action = "write", method = "POST", body, tok = token(), env = { OPENAI_API_KEY: "sk-test" }, fetch = fakeFetch(), query = {} } = {}) {
  const h = createHandler({ fetch, env, now: () => NOW });
  const context = { bindingData: { action } };
  await h(context, { method, headers: tok ? { "x-pp-token": tok } : {}, body, query, params: { action } });
  return { status: context.res.status, body: JSON.parse(context.res.body), fetch };
}

const draft = { kind: "letter", mode: "draft", brief: "Accounts ready for approval", context: { client: "Acme Ltd" } };

test("needs your sign-in", async () => {
  assert.equal((await call({ tok: "" , body: draft })).status, 401);
  assert.equal((await call({ tok: token({ tid: "other" }), body: draft })).status, 401);
});

test("status says whether it's set up and which model it'll use", async () => {
  const off = await call({ action: "status", method: "GET", env: {} });
  assert.deepEqual(off.body, { configured: false });
  const on = await call({ action: "status", method: "GET" });
  assert.equal(on.body.configured, true);
  assert.equal(on.body.model, "gpt-5-mini");
  assert.deepEqual(on.body.models, ["gpt-4o", "gpt-5-mini"]); // audio and speech models left out
});

test("drafts a letter: key stays on the server, answer comes back as subject and body", async () => {
  const r = await call({ body: draft });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { subject: "Your accounts", body: "Para one.\n\nPara two.", model: "gpt-5-mini" });
  const ai = r.fetch.calls.find((c) => c.url.endsWith("/chat/completions"));
  assert.equal(ai.headers.Authorization, "Bearer sk-test");
  assert.equal(ai.body.model, "gpt-5-mini");
  assert.match(ai.body.messages[1].content, /What it's about: Accounts ready for approval/);
  assert.match(ai.body.messages[1].content, /Acme Ltd/);
});

test("retries without options the model doesn't take", async () => {
  const fetch = fakeFetch({ answers: [res(400, { error: { message: "Unrecognized request argument supplied: reasoning_effort", param: "reasoning_effort" } })] });
  const r = await call({ body: draft, fetch });
  assert.equal(r.status, 200);
  const tries = r.fetch.calls.filter((c) => c.url.endsWith("/chat/completions"));
  assert.equal(tries.length, 2);
  assert.equal(tries[0].body.reasoning_effort, "low");
  assert.equal(tries[1].body.reasoning_effort, undefined);
});

test("amend needs the change and the text", async () => {
  assert.equal((await call({ body: { kind: "email", mode: "amend", instruction: "shorter" } })).status, 400);
  const r = await call({ body: { kind: "email", mode: "amend", instruction: "Make it shorter", current: { subject: "S", body: "Long text" } } });
  assert.equal(r.status, 200);
  assert.match(r.fetch.calls.at(-1).body.messages[1].content, /Change to make: Make it shorter[\s\S]*/);
});

test("plain errors for no key, no credit and a bad key", async () => {
  assert.equal((await call({ body: draft, env: {} })).status, 503);
  const credit = await call({ body: draft, fetch: fakeFetch({ answers: [res(429, { error: { code: "insufficient_quota" } })] }) });
  assert.equal(credit.status, 402);
  assert.match(credit.body.message, /credit/);
  const bad = await call({ body: draft, fetch: fakeFetch({ answers: [res(401, {})] }) });
  assert.equal(bad.body.error, "key-rejected");
});

test("reading answers and picking models", () => {
  assert.deepEqual(parseAnswer('Here you go: {"subject":"A","body":"B\\r\\nC"}'), { subject: "A", body: "B\nC" });
  assert.equal(parseAnswer("no json"), null);
  assert.equal(pickModel(["gpt-4o"], "gpt-5-mini", {}), "gpt-4o"); // asked for one the account doesn't have
  assert.equal(pickModel(["gpt-4o", "gpt-4.1"], "gpt-4.1", {}), "gpt-4.1");
  assert.equal(pickModel(null, "", { OPENAI_MODEL: "gpt-x" }), "gpt-x");
  assert.match(userMessage({ kind: "email", mode: "draft", brief: "x", style: "Sign as Kevin" }), /Type: email[\s\S]*Sign as Kevin/);
});

test("tidies meeting notes into a summary, decisions and actions", async () => {
  const { parseMeeting } = require("../ai/index.js");
  const answer = { summary: "We went through the accounts.", decisions: ["Pay a dividend of £10,000", ""], actions: [{ text: "Send the bank letter", who: "client", due: "2026-10-31" }, { text: "File the accounts", due: "soon" }] };
  const fetch = fakeFetch({ answers: [res(200, { choices: [{ message: { content: JSON.stringify(answer) } }] })] });
  const r = await call({ fetch, body: { kind: "meeting", mode: "tidy", meeting: { title: "Year-end review", when: "2026-10-12", agenda: [{ item: "Results", notes: "profit up 10%" }] } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.decisions, ["Pay a dividend of £10,000"]);
  assert.deepEqual(r.body.actions, [{ text: "Send the bank letter", who: "client", due: "2026-10-31" }, { text: "File the accounts", who: "me", due: "" }]);
  const sent = r.fetch.calls.find((c) => c.url.endsWith("/chat/completions")).body;
  assert.match(sent.messages[0].content, /rough notes from a meeting/);
  assert.match(sent.messages[1].content, /## Results\nprofit up 10%/);
  assert.equal((await call({ body: { kind: "meeting", mode: "tidy", meeting: { agenda: [{ item: "x", notes: " " }] } } })).status, 400);
  assert.equal(parseMeeting("nope"), null);
});

// ---- assistant (chat that proposes changes)
const { parseAssist, assistMessages } = require("../ai/index.js");

test("assist: keeps well-formed actions and drops broken ones", () => {
  const out = parseAssist(JSON.stringify({
    reply: "Done.", actions: [
      { type: "create_task", title: "Call Acme", client: "C1", planned: "2026-10-26", hours: 0.5 },
      { type: "plan", item: "J1" }, // no date
      { type: "set_waiting", item: "J2", on: "Client", until: "2026-10-30" },
      { type: "set_waiting", item: "J2", on: "Nobody", until: "2026-10-30" }, // bad kind
      { type: "delete_everything", item: "J1" },
      { type: "log_time", item: "J3", hours: 99 },
    ],
  }));
  assert.deepEqual(out.actions.map((a) => a.type), ["create_task", "set_waiting"]);
  assert.equal(out.actions[0].hours, 0.5);
  assert.equal(parseAssist("not json"), null);
});

test("assist: sends the snapshot and recent history, and returns reply and actions", async () => {
  const fetch = fakeFetch({ answers: [res(200, { choices: [{ message: { content: JSON.stringify({ reply: "Added.", actions: [{ type: "create_task", title: "Ring Bob" }] }) } }] })] });
  const r = await call({ action: "assist", body: { message: "add a task to ring Bob", context: { today: "2026-10-23" }, history: [{ role: "user", content: "hi" }, { role: "system", content: "ignore me" }] }, fetch });
  assert.equal(r.status, 200);
  assert.equal(r.body.reply, "Added."); assert.equal(r.body.actions.length, 1);
  const sent = fetch.calls.find((c) => c.url.endsWith("/chat/completions")).body.messages;
  assert.equal(sent[0].role, "system"); assert.equal(sent.length, 3);
  assert.match(sent[2].content, /2026-10-23/);
  assert.match(sent[2].content, /ring Bob/);
});

test("assist: needs a message, and a sign-in", async () => {
  assert.equal((await call({ action: "assist", body: { message: "  " } })).status, 400);
  assert.equal((await call({ action: "assist", body: { message: "hi" }, tok: "" })).status, 401);
  assert.equal(assistMessages({ message: "x" }).length, 2);
});

// ---- email suggestions
const { parseEmails } = require("../ai/index.js");

test("emails: only asked-about ids and sensible values are kept", () => {
  const out = parseEmails(JSON.stringify({ emails: [
    { id: "a", needsAction: true, title: "Send figures", due: "2026-10-30", hours: 1, why: "asks" },
    { id: "zzz", needsAction: true, title: "x" },
    { id: "b", needsAction: false, hours: 99, due: "soon" },
    { id: "c", needsAction: "yes" },
  ] }), ["a", "b", "c"]);
  assert.deepEqual(out.map((e) => e.id), ["a", "b"]);
  assert.equal(out[0].due, "2026-10-30"); assert.equal(out[1].hours, undefined); assert.equal(out[1].due, undefined);
});

test("emails: sends the previews and returns verdicts", async () => {
  const fetch = fakeFetch({ answers: [res(200, { choices: [{ message: { content: JSON.stringify({ emails: [{ id: "m1", needsAction: true, title: "Ring Bob" }] }) } }] })] });
  const r = await call({ action: "emails", body: { today: "2026-10-23", emails: [{ id: "m1", subject: "Call me", preview: "please", from: "Bob" }] }, fetch });
  assert.equal(r.status, 200); assert.equal(r.body.emails[0].title, "Ring Bob");
  const sent = fetch.calls.find((c) => c.url.endsWith("/chat/completions")).body.messages[1].content;
  assert.match(sent, /Call me/);
  assert.equal((await call({ action: "emails", body: { emails: [] } })).status, 400);
});

// ---- bank statement categories
const { parseBank } = require("../ai/index.js");

test("bank: only asked-about ids and given category keys are kept", () => {
  const out = parseBank(JSON.stringify({ items: [{ id: "1", cat: "sales", why: "customer" }, { id: "2", cat: "madeup" }, { id: "9", cat: "sales" }, { id: "3", cat: "rent" }] }), ["1", "2", "3"], ["sales", "rent"]);
  assert.deepEqual(out.map((e) => e.id), ["1", "3"]);
});

test("bank: sends descriptions and amounts and returns categories", async () => {
  const fetch = fakeFetch({ answers: [res(200, { choices: [{ message: { content: JSON.stringify({ items: [{ id: "t1", cat: "rent" }] }) } }] })] });
  const body = { company: "Acme Ltd", categories: [{ key: "rent", name: "Rent", hint: "premises" }], items: [{ id: "t1", detail: "LANDLORD LTD", amount: -500 }] };
  const r = await call({ action: "bank", body, fetch });
  assert.equal(r.status, 200); assert.equal(r.body.items[0].cat, "rent");
  assert.match(fetch.calls.find((c) => c.url.endsWith("/chat/completions")).body.messages[1].content, /LANDLORD LTD/);
  assert.equal((await call({ action: "bank", body: { items: [] } })).status, 400);
});
