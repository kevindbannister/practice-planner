// Development Hub bridge for Practice Planner: reads and manages the project's GitHub issues, pull requests and commits.
//
// The GitHub token lives in the Azure setting GITHUB_TOKEN (a fine-grained token limited to this one repository, with
// Issues read/write, Pull requests read and Contents read) and never reaches the browser. The repository is fixed by
// GITHUB_REPO (default kevindbannister/practice-planner); the browser cannot choose another.
//
// Every call needs Kevin's Microsoft sign-in for this app. If DEVHUB_ADMINS is set (comma-separated sign-in names),
// only those people may use it.
//
//   GET   /api/devhub/status              -> { configured, repo, admins }
//   GET   /api/devhub/issues?state=       -> { issues: [...] }       (pull requests are not issues here)
//   POST  /api/devhub/issues              { title, body?, labels? } -> { issue }
//   GET   /api/devhub/issues/{n}          -> { issue }
//   PATCH /api/devhub/issues/{n}          { title?, body?, state?, labels?, assignees? } -> { issue }
//   POST  /api/devhub/issues/{n}/comments { body } -> { ok }
//   GET   /api/devhub/pulls               -> { pulls: [...] }
//   GET   /api/devhub/commits             -> { commits: [...] }
//   GET   /api/devhub/activity            -> { items: [...] }  (commits, pull requests and issues together, newest first)

const { createSignIn, reply } = require("../shared/signin.js");

const API = "https://api.github.com";
const REPO_OK = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const LABEL = /^[\w :./+-]{1,50}$/;
const STATES = new Set(["open", "closed", "all"]);
const MAX_TITLE = 256;
const MAX_BODY = 60000;

function createHandler({ fetch = globalThis.fetch, env = process.env, now = () => Date.now() } = {}) {
  const signedIn = createSignIn({ fetch, now });
  const repo = (env.GITHUB_REPO || "kevindbannister/practice-planner").trim();

  async function isAdmin(req) {
    const list = (env.DEVHUB_ADMINS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!list.length) return true;
    const token = (req.headers && (req.headers["x-pp-token"] || req.headers["X-PP-Token"])) || "";
    const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return false;
    const me = await res.json();
    return [me.userPrincipalName, me.mail].filter(Boolean).some((x) => list.includes(String(x).toLowerCase()));
  }

  async function gh(method, path, body) {
    const res = await fetch(`${API}/repos/${repo}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN.trim()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "practice-planner-devhub", ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res;
  }

  const issueOut = (i) => ({
    number: i.number, title: i.title, state: i.state, labels: (i.labels || []).map((l) => (typeof l === "string" ? l : l.name)),
    assignee: i.assignee ? i.assignee.login : undefined, url: i.html_url, body: i.body || "", updated: i.updated_at,
    milestone: i.milestone ? i.milestone.title : undefined,
  });

  /** Turns a GitHub failure into a plain message the screen can show. Never silent. */
  async function fail(res) {
    let detail = "";
    try { detail = (await res.json()).message || ""; } catch { /* no body */ }
    if (res.status === 401) return reply(502, { error: "token-rejected", message: "GitHub didn't accept the token. Replace GITHUB_TOKEN in Azure." });
    if (res.status === 403 || res.status === 429) {
      const limited = res.headers && res.headers.get && (res.headers.get("x-ratelimit-remaining") === "0" || res.status === 429);
      if (limited) return reply(429, { error: "rate-limited", message: "GitHub asked us to slow down. Try again shortly." });
      return reply(403, { error: "forbidden", message: `The GitHub token isn't allowed to do that${detail ? ` (${detail})` : ""}. Check its permissions: Issues read/write, Pull requests read, Contents read.` });
    }
    if (res.status === 404) return reply(404, { error: "not-found", message: "GitHub has no such item, or the token can't see this repository." });
    if (res.status === 422) return reply(422, { error: "invalid", message: `GitHub refused the change${detail ? `: ${detail}` : ""}.` });
    return reply(502, { error: "upstream", status: res.status, message: `GitHub returned an error (${res.status}).` });
  }

  function cleanLabels(labels) {
    if (!Array.isArray(labels)) return null;
    const out = [];
    for (const l of labels) {
      if (typeof l !== "string" || !LABEL.test(l)) return null;
      out.push(l);
    }
    return out.slice(0, 20);
  }

  return async function handler(context, req) {
    const path = String((context.bindingData && context.bindingData.path) || (req.params && req.params.path) || "").replace(/^\/+|\/+$/g, "");
    const method = String(req.method || "GET").toUpperCase();
    const q = req.query || {};

    let ok = false;
    try { ok = await signedIn(req); } catch { ok = false; }
    if (!ok) { context.res = reply(401, { error: "unauthorised", message: "Sign in to Practice Planner again." }); return; }
    let admin = false;
    try { admin = await isAdmin(req); } catch { admin = false; }
    if (!admin) { context.res = reply(403, { error: "not-admin", message: "The Development Hub is only open to development administrators." }); return; }

    if (!REPO_OK.test(repo)) { context.res = reply(503, { error: "not-configured", message: "GITHUB_REPO isn't a valid owner/name." }); return; }
    if (path === "status" && method === "GET") {
      context.res = reply(200, { configured: !!(env.GITHUB_TOKEN || "").trim(), repo, admins: !!(env.DEVHUB_ADMINS || "").trim() });
      return;
    }
    if (!(env.GITHUB_TOKEN || "").trim()) {
      context.res = reply(503, { error: "not-configured", message: "The GitHub token hasn't been added to Azure yet (setting GITHUB_TOKEN)." });
      return;
    }

    try {
      let m;
      if (path === "issues" && method === "GET") {
        const state = STATES.has(String(q.state)) ? String(q.state) : "all";
        const res = await gh("GET", `issues?state=${state}&per_page=100&sort=created&direction=asc`);
        if (!res.ok) { context.res = await fail(res); return; }
        const list = (await res.json()).filter((i) => !i.pull_request).map(issueOut);
        context.res = reply(200, { issues: list });
        return;
      }
      if (path === "issues" && method === "POST") {
        const b = req.body || {};
        const title = typeof b.title === "string" ? b.title.trim() : "";
        if (!title || title.length > MAX_TITLE) { context.res = reply(400, { error: "bad-request", message: "An issue needs a title of up to 256 characters." }); return; }
        if (b.body !== undefined && (typeof b.body !== "string" || b.body.length > MAX_BODY)) { context.res = reply(400, { error: "bad-request", message: "The description is too long." }); return; }
        const labels = b.labels === undefined ? [] : cleanLabels(b.labels);
        if (!labels) { context.res = reply(400, { error: "bad-request", message: "Those labels aren't allowed." }); return; }
        // Never create a duplicate: look for an open or closed issue with the same title first.
        const found = await gh("GET", "issues?state=all&per_page=100");
        if (!found.ok) { context.res = await fail(found); return; }
        const norm = (s) => s.replace(/^\s*\[[^\]]*\]\s*/, "").toLowerCase().replace(/\s+/g, " ").trim();
        const dup = (await found.json()).find((i) => !i.pull_request && norm(i.title) === norm(title));
        if (dup) { context.res = reply(409, { error: "duplicate", message: `Issue #${dup.number} already has this title.`, issue: issueOut(dup) }); return; }
        const res = await gh("POST", "issues", { title, body: b.body || "", labels });
        if (!res.ok) { context.res = await fail(res); return; }
        context.res = reply(201, { issue: issueOut(await res.json()) });
        return;
      }
      if ((m = /^issues\/(\d{1,6})$/.exec(path))) {
        if (method === "GET") {
          const res = await gh("GET", `issues/${m[1]}`);
          if (!res.ok) { context.res = await fail(res); return; }
          context.res = reply(200, { issue: issueOut(await res.json()) });
          return;
        }
        if (method === "PATCH") {
          const b = req.body || {};
          const patch = {};
          if (b.title !== undefined) { if (typeof b.title !== "string" || !b.title.trim() || b.title.length > MAX_TITLE) { context.res = reply(400, { error: "bad-request", message: "That title isn't allowed." }); return; } patch.title = b.title.trim(); }
          if (b.body !== undefined) { if (typeof b.body !== "string" || b.body.length > MAX_BODY) { context.res = reply(400, { error: "bad-request", message: "The description is too long." }); return; } patch.body = b.body; }
          if (b.state !== undefined) { if (b.state !== "open" && b.state !== "closed") { context.res = reply(400, { error: "bad-request", message: "State must be open or closed." }); return; } patch.state = b.state; }
          if (b.labels !== undefined) { const l = cleanLabels(b.labels); if (!l) { context.res = reply(400, { error: "bad-request", message: "Those labels aren't allowed." }); return; } patch.labels = l; }
          if (b.assignees !== undefined) { if (!Array.isArray(b.assignees) || !b.assignees.every((a) => typeof a === "string" && /^[A-Za-z0-9-]{1,39}$/.test(a))) { context.res = reply(400, { error: "bad-request", message: "Those assignees aren't allowed." }); return; } patch.assignees = b.assignees; }
          if (!Object.keys(patch).length) { context.res = reply(400, { error: "bad-request", message: "Nothing to change." }); return; }
          const res = await gh("PATCH", `issues/${m[1]}`, patch);
          if (!res.ok) { context.res = await fail(res); return; }
          context.res = reply(200, { issue: issueOut(await res.json()) });
          return;
        }
      }
      if ((m = /^issues\/(\d{1,6})\/comments$/.exec(path)) && method === "POST") {
        const b = req.body || {};
        if (typeof b.body !== "string" || !b.body.trim() || b.body.length > MAX_BODY) { context.res = reply(400, { error: "bad-request", message: "A comment needs some text." }); return; }
        const res = await gh("POST", `issues/${m[1]}/comments`, { body: b.body });
        if (!res.ok) { context.res = await fail(res); return; }
        context.res = reply(201, { ok: true });
        return;
      }
      if (path === "pulls" && method === "GET") {
        const res = await gh("GET", "pulls?state=all&per_page=30&sort=updated&direction=desc");
        if (!res.ok) { context.res = await fail(res); return; }
        context.res = reply(200, { pulls: (await res.json()).map(pullOut) });
        return;
      }
      if (path === "commits" && method === "GET") {
        const res = await gh("GET", "commits?per_page=30");
        if (!res.ok) { context.res = await fail(res); return; }
        context.res = reply(200, { commits: (await res.json()).map(commitOut) });
        return;
      }
      if (path === "activity" && method === "GET") {
        const [c, p, i] = await Promise.all([gh("GET", "commits?per_page=20"), gh("GET", "pulls?state=all&per_page=15&sort=updated&direction=desc"), gh("GET", "issues?state=all&per_page=15&sort=updated&direction=desc")]);
        for (const r of [c, p, i]) if (!r.ok) { context.res = await fail(r); return; }
        const items = [
          ...(await c.json()).map((x) => ({ kind: "commit", ...commitOut(x) })),
          ...(await p.json()).map((x) => ({ kind: "pull", ...pullOut(x) })),
          ...(await i.json()).filter((x) => !x.pull_request).map((x) => ({ kind: "issue", id: `#${x.number}`, title: x.title, url: x.html_url, at: x.updated_at, by: x.user ? x.user.login : "", state: x.state })),
        ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);
        context.res = reply(200, { items });
        return;
      }
      context.res = reply(400, { error: "bad-request", message: "That isn't something the Development Hub does." });
    } catch {
      context.res = reply(502, { error: "unreachable", message: "GitHub didn't answer. Try again shortly." });
    }
  };
}

function pullOut(p) {
  return { id: `#${p.number}`, title: p.title, url: p.html_url, at: p.updated_at, by: p.user ? p.user.login : "", state: p.merged_at ? "merged" : p.state };
}
function commitOut(c) {
  const msg = (c.commit && c.commit.message) || "";
  return { id: String(c.sha || "").slice(0, 7), title: msg.split("\n")[0], url: c.html_url, at: c.commit && c.commit.author ? c.commit.author.date : "", by: c.author ? c.author.login : (c.commit && c.commit.author ? c.commit.author.name : "") };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
