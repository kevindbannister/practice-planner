// The side panel: a thin icon rail on the left (Jobs, Timer, Notes) and the content beside it.
import * as auth from "./lib/auth.js";
import { Store, FIELDS } from "./lib/store.js";
import { findClient, searchClients, xeroShortCode, titleNames } from "./lib/match.js";
import { pageInfo } from "./lib/detect.js";
import * as J from "./lib/jobs.js";

const $app = document.getElementById("app");
const store = new Store(auth.getToken);
const S = {
  signedIn: false, loading: false, error: "", flash: "", tab: "jobs", user: "",
  data: { clients: [], jobs: [], services: [], time: [], stages: [] },
  client: null, how: "", searching: false, query: "", page: null, shortCode: "",
  edit: null, // the job being edited, and its form
  forms: {}, // which job's hold form is open
  busy: false,
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICONS = {
  jobs: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  notes: '<path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
};
const icon = (n) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

const now = () => new Date();
const clientByKey = (k) => S.data.clients.find((c) => c.Key === k);
const clientName = (c) => c?.TradingName || c?.Title || c?.Key || "";
const serviceName = (k) => { const s = S.data.services.find((x) => x.Key === k); return s?.Title || k || "Job"; };
const entries = () => S.data.time.map(J.readTime);
const running = () => J.runningTimer(entries());
const jobByKey = (k) => S.data.jobs.find((j) => j.Key === k);
const jobTitle = (j) => `${j.Title || serviceName(j.ServiceKey)}${j.PeriodEnd ? ` · ${J.fmtDate(j.PeriodEnd)}` : ""}`;

// ---------- data ----------
async function load() {
  const { cache } = await chrome.storage.local.get("cache");
  if (cache?.data) { S.data = { stages: [], ...cache.data }; render(); }
  S.loading = true; render();
  try {
    await store.connect();
    const [clients, jobs, services, time, stages] = await Promise.all([
      store.readAll("clients", FIELDS.clients), store.readAll("jobs", FIELDS.jobs),
      store.has("services") ? store.readAll("services", FIELDS.services) : [], store.has("time") ? store.readAll("time", FIELDS.time) : [],
      store.has("stages") ? store.readAll("stages", FIELDS.stages) : [],
    ]);
    S.data = { clients, jobs, services, time, stages };
    S.error = "";
    await chrome.storage.local.set({ cache: { at: Date.now(), data: S.data } });
    if (!S.user) { try { S.user = (await store.request("GET", "/me?$select=displayName")).displayName || ""; } catch { /* the name is only for notes */ } }
    syncRunning();
  } catch (e) {
    S.error = e instanceof auth.AuthError ? e.message : (e?.message || "Couldn't reach Microsoft 365.");
    if (e instanceof auth.AuthError) S.signedIn = false;
  }
  S.loading = false;
  await detect();
}
function syncRunning() {
  const r = running();
  const j = r && jobByKey(r.jobKey);
  chrome.storage.local.set({ running: r ? { started: r.started, label: j ? `${clientName(clientByKey(j.ClientKey))} · ${serviceName(j.ServiceKey)}` : "a job" } : null });
}

// ---------- which client is this page about? ----------
async function detect() {
  const { xeroMap = {} } = await chrome.storage.local.get("xeroMap");
  let tab;
  try { [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); } catch { /* no tab to look at */ }
  S.page = null; S.shortCode = "";
  if (tab?.url && /^https:\/\/([^/]+\.)?xero\.com\//.test(tab.url)) {
    S.shortCode = xeroShortCode(tab.url) || "";
    let info = { url: tab.url, title: tab.title || "", texts: [] };
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageInfo });
      if (res?.result) info = res.result;
    } catch { /* the page may not allow it; the title still helps */ }
    S.page = info;
    const remembered = S.shortCode && xeroMap[S.shortCode] && clientByKey(xeroMap[S.shortCode]);
    if (remembered) { S.client = remembered; S.how = "Remembered for this Xero organisation"; }
    else if (!S.client || S.how.startsWith("Matched")) {
      const found = findClient(S.data.clients, [...info.texts, ...titleNames(info.title || "")]);
      if (found.best) { S.client = found.best.client; S.how = "Matched from the Xero page"; }
      else if (!S.how.startsWith("Chosen")) { S.client = null; S.how = ""; }
    }
  }
  render();
}
async function choose(key) {
  S.client = clientByKey(key); S.how = "Chosen by you"; S.searching = false; S.query = "";
  if (S.shortCode && S.client) {
    const { xeroMap = {} } = await chrome.storage.local.get("xeroMap");
    xeroMap[S.shortCode] = key;
    await chrome.storage.local.set({ xeroMap });
    S.how = "Chosen by you, and remembered for this Xero organisation";
  }
  render();
}

// ---------- actions ----------
const flash = (m, err) => { S.flash = m; S.error = err ? m : ""; if (err) S.flash = ""; render(); if (!err) setTimeout(() => { if (S.flash === m) { S.flash = ""; render(); } }, 3500); };
async function act(fn, ok) {
  if (S.busy) return;
  S.busy = true; render();
  try { await fn(); if (ok) flash(ok); } catch (e) { flash(e?.message || "That didn't save.", true); }
  S.busy = false; syncRunning(); await chrome.storage.local.set({ cache: { at: Date.now(), data: S.data } }); render();
}
async function refreshJob(j) {
  const fresh = await store.readItem("jobs", j._id, FIELDS.jobs);
  Object.assign(j, fresh);
  return j;
}
async function startTimer(job) {
  await act(async () => {
    const cur = running();
    if (cur) {
      await store.update("time", cur.id, J.stopPatch(cur, now()));
      const row = S.data.time.find((r) => r._id === cur.id); if (row) Object.assign(row, J.stopPatch(cur, now()));
    }
    const row = J.startRow(job, S.user, now());
    const made = await store.create("time", row);
    S.data.time.push({ ...row, _id: made._id });
  }, "Timer started.");
}
async function stopTimer() {
  const cur = running(); if (!cur) return;
  await act(async () => {
    const p = J.stopPatch(cur, now());
    await store.update("time", cur.id, p);
    Object.assign(S.data.time.find((r) => r._id === cur.id), p);
  }, "Timer stopped and saved.");
}
async function hold(job, f) {
  if (!f.reason.trim()) return flash("Say why it is on hold.", true);
  await act(async () => {
    const p = J.holdPatch(f.reason, f.until, J.todayIso(), f.kind);
    await store.update("jobs", job._id, p); Object.assign(job, p);
    S.forms = {};
  }, "Job put on hold.");
}
async function resume(job) {
  await act(async () => {
    await refreshJob(job);
    const p = J.resumePatch(job, J.todayIso());
    await store.update("jobs", job._id, p); Object.assign(job, p);
  }, "Job resumed.");
}
async function recordsIn(job) {
  await act(async () => {
    const p = { RecordsReceived: J.todayIso() };
    await store.update("jobs", job._id, p); Object.assign(job, p);
  }, "Records marked as received today.");
}
async function saveEdit(job, form) {
  await act(async () => {
    await refreshJob(job); // compare with what is saved now, not what was on screen
    const p = { ...J.editPatch(job, form) };
    const to = Number(form.stage);
    if (to && to !== (Number(job.StageNo) || 1)) {
      const sp = J.stagePatch(job, J.stagesFor(S.data.stages, job.ServiceKey), to, J.todayIso());
      if (!sp) throw new Error("That stage needs the planner (it involves the client). Change it there.");
      Object.assign(p, sp);
    }
    if (!Object.keys(p).length) { S.edit = null; return; }
    await store.update("jobs", job._id, p); Object.assign(job, p);
    S.edit = null;
  }, "Job updated.");
}
async function addNote(target, text) {
  if (!text.trim()) return flash("Write a note first.", true);
  await act(async () => {
    const kind = target.type === "client" ? "clients" : "jobs";
    const item = target.type === "client" ? target.ref : target.ref;
    const fresh = await store.readItem(kind, item._id, FIELDS[kind]); // read it again so nobody's newer note is lost
    const notes = J.noteAppend(fresh.Notes, text, S.user);
    await store.update(kind, item._id, { Notes: notes });
    item.Notes = notes;
  }, "Note added.");
}
async function addManual(jobKey, text, note) {
  const job = jobByKey(jobKey), hrs = J.parseDuration(text);
  if (!job) return flash("Pick a job.", true);
  if (!hrs) return flash("Time should look like 1.5, 1h30, 1:30 or 90m.", true);
  await act(async () => {
    const row = J.manualRow(job, hrs, note, S.user, now());
    const made = await store.create("time", row);
    S.data.time.push({ ...row, _id: made._id });
  }, `Added ${J.lengthText(hrs)}.`);
}

// ---------- views ----------
function runningBar() {
  const r = running(); if (!r) return "";
  const j = jobByKey(r.jobKey);
  return `<div class="running"><span>●</span><span class="grow">${esc(j ? `${clientName(clientByKey(j.ClientKey))} · ${serviceName(j.ServiceKey)}` : "A job")}</span><b data-clock="${esc(r.started)}">${J.clock(J.elapsedHours(r, now()))}</b><button class="btn stop" data-do="stop">Stop</button></div>`;
}
function header() {
  const c = S.client;
  if (S.searching) {
    const res = S.query ? searchClients(S.data.clients, S.query) : [];
    return `<div class="head"><h1>Find a client</h1><input id="q" placeholder="Start typing a client name" value="${esc(S.query)}" autocomplete="off">
      <div class="results">${res.map((x) => `<button data-do="pick" data-k="${esc(x.Key)}">${esc(clientName(x))}</button>`).join("") || (S.query ? '<div class="muted">No client matches that.</div>' : "")}</div>
      <div class="sub"><button class="link" data-do="cancelsearch">Cancel</button></div></div>`;
  }
  if (!c) return `<div class="head"><h1>No client yet</h1><div class="sub">${S.page ? "I couldn't tell who this Xero page is for." : "Open a client in Xero and I'll pick them up."} <button class="link" data-do="search">Choose a client</button></div></div>`;
  return `<div class="head"><h1>${esc(clientName(c))}</h1><div class="sub"><span>${esc(S.how)}</span><button class="link" data-do="search">Change</button></div></div>`;
}
function jobCard(j) {
  const today = J.todayIso(), st = J.deadlineState(j, today), hrs = J.hoursByJob(entries(), now()).get(j.Key) || 0;
  const r = running(), mine = r && r.jobKey === j.Key, held = J.isOnHold(j);
  const dl = j.Deadline || j.InternalDeadline;
  const chips = [
    dl ? `<span class="chip ${st}">${st === "late" ? "Late · " : "Due "}${esc(J.fmtDate(dl))}</span>` : "",
    j.StageName ? `<span class="chip">${esc(j.StageName)}</span>` : "",
    held ? `<span class="chip hold">${j.HoldKind ? `Waiting on ${esc(j.HoldKind)}` : "On hold"}${j.HoldUntil ? ` until ${esc(J.fmtDate(j.HoldUntil))}` : ""}</span>` : "",
    hrs ? `<span class="chip">${esc(J.lengthText(hrs))} logged</span>` : "",
    mine ? '<span class="chip run">Timer running</span>' : "",
  ].join("");
  const f = S.forms[j.Key], ed = S.edit?.key === j.Key ? S.edit : null;
  const stages = J.stagesFor(S.data.stages, j.ServiceKey), cur = Number(j.StageNo) || 1;
  const locked = !!j.WaitingSince || J.isWaitStage(stages.find((x) => Number(x.StageNo) === cur));
  const editForm = ed ? `<div style="margin-top:8px">
    <label>Stage</label><select data-e="stage" ${locked || !stages.length ? "disabled" : ""}>${stages.map((x) => `<option value="${esc(x.StageNo)}" ${Number(ed.stage) === Number(x.StageNo) ? "selected" : ""} ${J.isWaitStage(x) && Number(x.StageNo) !== cur ? "disabled" : ""}>${esc(`${x.StageNo}. ${x.Title || ""}${J.isWaitStage(x) ? " (with the client: use the planner)" : ""}`)}</option>`).join("") || `<option>${esc(j.StageName || "No stages found")}</option>`}</select>
    ${locked ? '<div class="muted">This job is with the client or waiting to be finalised, so its stage is changed in the planner.</div>' : ""}
    <label>Deadline</label><input type="date" data-e="deadline" value="${esc(ed.deadline)}">
    <label>Planned for</label><input type="date" data-e="planned" value="${esc(ed.planned)}">
    <label><input type="checkbox" data-e="urgent" style="width:auto" ${ed.urgent ? "checked" : ""}> Urgent</label>
    <label>Note on card</label><input data-e="card" value="${esc(ed.card)}">
    <div class="row"><button class="btn pri" data-do="editsave" data-k="${esc(j.Key)}">Save changes</button><button class="btn" data-do="editcancel">Cancel</button></div></div>` : "";
  const form = f ? `<div style="margin-top:8px"><label>Why is it on hold?</label><input data-f="reason" value="${esc(f.reason)}">
    <label>Waiting on</label><select data-f="kind"><option value="">Nobody in particular</option>${J.WAIT_KINDS.map((k) => `<option ${f.kind === k ? "selected" : ""}>${esc(k)}</option>`).join("")}</select>
    <label>Until (optional)</label><input type="date" data-f="until" value="${esc(f.until)}">
    <div class="row"><button class="btn pri" data-do="holdsave" data-k="${esc(j.Key)}">Put on hold</button><button class="btn" data-do="holdcancel">Cancel</button></div></div>` : "";
  return `<div class="card"><h2>${esc(jobTitle(j))}</h2><div class="muted">${esc(j.Status || "")}${j.Priority ? ` · ${esc(j.Priority)}` : ""}</div><div class="chips">${chips}</div>
    ${j.HoldReason && held ? `<div class="muted">${esc(j.HoldReason)}</div>` : ""}
    <div class="row">
      ${mine ? '<button class="btn stop" data-do="stop">Stop timer</button>' : `<button class="btn pri" data-do="start" data-k="${esc(j.Key)}">Start timer</button>`}
      ${held ? `<button class="btn" data-do="resume" data-k="${esc(j.Key)}">Resume</button>` : `<button class="btn" data-do="holdopen" data-k="${esc(j.Key)}">Hold</button>`}
      ${j.RecordsExpected && !j.RecordsReceived ? `<button class="btn" data-do="records" data-k="${esc(j.Key)}">Records received</button>` : ""}
      <button class="btn" data-do="editopen" data-k="${esc(j.Key)}">Edit</button>
    </div>${j.CardNote ? `<div class="muted" style="margin-top:6px">${esc(j.CardNote)}</div>` : ""}${form}${editForm}</div>`;
}
function jobsView() {
  if (!S.client) return `<div class="empty">Choose a client to see their jobs.</div>`;
  const list = J.jobsFor(S.data.jobs, S.client.Key);
  return list.length ? list.map(jobCard).join("") : `<div class="empty">${S.loading ? "Loading…" : "No open jobs for this client."}</div>`;
}
function timerView() {
  const r = running(), all = entries().filter((e) => e.ended || e.kind === "manual").sort((a, b) => (b.ended || "").localeCompare(a.ended || ""));
  const mine = S.client ? all.filter((e) => e.clientKey === S.client.Key).slice(0, 8) : all.slice(0, 8);
  const jobs = S.client ? J.jobsFor(S.data.jobs, S.client.Key) : [];
  const j = r && jobByKey(r.jobKey);
  return `<div class="card"><div class="muted">${r ? esc(j ? `${clientName(clientByKey(j.ClientKey))} · ${jobTitle(j)}` : "Running") : "No timer running"}</div>
      <div class="big" data-clock="${esc(r?.started || "")}">${r ? J.clock(J.elapsedHours(r, now())) : "0:00:00"}</div>
      ${r ? '<button class="btn stop" data-do="stop">Stop and save</button>' : '<div class="muted">Start one from a job on the Jobs tab.</div>'}</div>
    <div class="card"><h2>Add time you've already spent</h2>
      <label>Job</label><select id="mjob">${jobs.map((x) => `<option value="${esc(x.Key)}">${esc(jobTitle(x))}</option>`).join("") || '<option value="">Choose a client first</option>'}</select>
      <label>How long</label><input id="mlen" placeholder="1.5, 1h30, 1:30 or 90m"><label>Note (optional)</label><input id="mnote">
      <div class="row"><button class="btn pri" data-do="manual">Add time</button></div></div>
    <div class="card"><h2>Recent${S.client ? ` for ${esc(clientName(S.client))}` : ""}</h2>${mine.map((e) => { const jb = jobByKey(e.jobKey); return `<div class="entry"><span>${esc(jb ? serviceName(jb.ServiceKey) : "Job")}${e.note ? ` · ${esc(e.note)}` : ""}</span><b>${esc(J.lengthText(e.hours))}</b></div>`; }).join("") || '<div class="muted">Nothing logged yet.</div>'}</div>`;
}
function notesView() {
  if (!S.client) return `<div class="empty">Choose a client to see and add notes.</div>`;
  const jobs = J.jobsFor(S.data.jobs, S.client.Key);
  return `<div class="card"><h2>Add a note</h2><label>Add it to</label><select id="ntarget"><option value="client">${esc(clientName(S.client))} (client)</option>${jobs.map((x) => `<option value="${esc(x.Key)}">${esc(jobTitle(x))}</option>`).join("")}</select>
      <label>Note</label><textarea id="ntext"></textarea><div class="row"><button class="btn pri" data-do="note">Add note</button></div></div>
    <div class="card"><h2>Client notes</h2><pre class="notes">${esc(S.client.Notes || "No notes yet.")}</pre></div>
    ${jobs.filter((x) => x.Notes).map((x) => `<div class="card"><h2>${esc(jobTitle(x))}</h2><pre class="notes">${esc(x.Notes)}</pre></div>`).join("")}`;
}
function settingsView() {
  return `<div class="card"><h2>Account</h2><div class="muted">${esc(S.user || "Signed in")}</div><div class="row"><button class="btn" data-do="refresh">Refresh data</button><button class="btn" data-do="signout">Sign out</button></div></div>
    <div class="card"><h2>What I can see on this page</h2><div class="muted">${S.page ? `Title: ${esc(S.page.title)}<br>Xero code: ${esc(S.shortCode || "none")}<br>Text found: ${esc((S.page.texts || []).join(" | ") || "none")}` : "The current tab isn't a Xero page."}</div></div>
    <div class="card"><h2>Remembered Xero organisations</h2><div class="muted">When you choose a client on a Xero page, I remember it for that organisation. <button class="link" data-do="forget">Forget them all</button></div></div>
    <div class="card"><h2>Redirect address</h2><div class="muted">If sign-in fails, this must be added in Entra under “Single-page application”:</div><div class="code">${esc(auth.redirectUri())}</div></div>`;
}
function signInView() {
  return `<div class="app"><main><div class="head"><h1>XProFlow jobs</h1><div class="sub">Sign in with your Microsoft 365 account to see client jobs and run the timer.</div></div>
    <div class="view">${S.error ? `<div class="msg">${esc(S.error)}</div>` : ""}<button class="btn pri" data-do="signin" ${S.busy ? "disabled" : ""}>Sign in with Microsoft</button>
    <div class="card"><div class="muted">Redirect address to register once in Entra (Single-page application):</div><div class="code">${esc(auth.redirectUri())}</div></div></div></main></div>`;
}
function render() {
  const keep = { q: document.activeElement?.id === "q" ? document.activeElement.selectionStart : null };
  if (!S.signedIn) { $app.innerHTML = signInView(); return; }
  const r = running();
  const body = { jobs: jobsView, timer: timerView, notes: notesView, gear: settingsView }[S.tab]();
  const rail = ["jobs", "timer", "notes"].map((t) => `<button class="ibtn" aria-pressed="${S.tab === t}" title="${t[0].toUpperCase() + t.slice(1)}" data-tab="${t}">${icon(t)}${t === "timer" && r ? '<span class="dot"></span>' : ""}</button>`).join("");
  $app.innerHTML = `<div class="app"><nav class="rail">${rail}<span class="sp"></span><button class="ibtn" aria-pressed="${S.tab === "gear"}" title="Account" data-tab="gear">${icon("gear")}</button></nav>
    <main>${runningBar()}${header()}<div class="view">${S.error ? `<div class="msg">${esc(S.error)}</div>` : ""}${S.flash ? `<div class="msg ok">${esc(S.flash)}</div>` : ""}${S.loading && !S.data.jobs.length ? '<div class="empty">Loading…</div>' : body}</div></main></div>`;
  const q = document.getElementById("q");
  if (q && keep.q !== null) { q.focus(); q.setSelectionRange(keep.q, keep.q); }
  else if (q && S.searching) q.focus();
}

// ---------- events ----------
document.addEventListener("click", async (ev) => {
  const t = ev.target.closest("[data-tab],[data-do]"); if (!t) return;
  if (t.dataset.tab) { S.tab = t.dataset.tab; return render(); }
  const k = t.dataset.k, job = k && jobByKey(k);
  switch (t.dataset.do) {
    case "signin": S.busy = true; S.error = ""; render(); try { await auth.signIn(); S.signedIn = true; S.busy = false; load(); } catch (e) { S.busy = false; S.error = e.message; render(); } break;
    case "signout": await auth.signOut(); await chrome.storage.local.remove(["cache", "running"]); S.signedIn = false; S.data = { clients: [], jobs: [], services: [], time: [], stages: [] }; S.client = null; render(); break;
    case "refresh": load(); break;
    case "forget": await chrome.storage.local.remove("xeroMap"); flash("Forgotten."); break;
    case "search": S.searching = true; S.query = ""; render(); break;
    case "cancelsearch": S.searching = false; render(); break;
    case "pick": choose(k); break;
    case "start": job && startTimer(job); break;
    case "stop": stopTimer(); break;
    case "holdopen": S.forms = { [k]: { reason: "", kind: "", until: "" } }; render(); break;
    case "holdcancel": S.forms = {}; render(); break;
    case "holdsave": job && hold(job, S.forms[k]); break;
    case "editopen": if (job) { S.edit = { key: k, stage: Number(job.StageNo) || 1, deadline: job.Deadline || "", planned: job.PlannedDate || "", urgent: job.Priority === "urgent", card: job.CardNote || "" }; render(); } break;
    case "editcancel": S.edit = null; render(); break;
    case "editsave": job && S.edit && saveEdit(job, S.edit); break;
    case "resume": job && resume(job); break;
    case "records": job && recordsIn(job); break;
    case "manual": addManual(document.getElementById("mjob")?.value, document.getElementById("mlen")?.value || "", document.getElementById("mnote")?.value || ""); break;
    case "note": {
      const sel = document.getElementById("ntarget")?.value, text = document.getElementById("ntext")?.value || "";
      addNote(sel === "client" ? { type: "client", ref: S.client } : { type: "job", ref: jobByKey(sel) }, text); break;
    }
  }
});
document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.id === "q") { S.query = t.value; render(); }
  if (t.dataset.e && S.edit) S.edit[t.dataset.e] = t.type === "checkbox" ? t.checked : t.value;
  if (t.dataset.f) { const form = Object.values(S.forms)[0]; if (form) form[t.dataset.f] = t.value; } // no re-render: keeps the cursor where it is
});
document.addEventListener("change", (ev) => { const t = ev.target; if (t.dataset.e && S.edit) S.edit[t.dataset.e] = t.type === "checkbox" ? t.checked : t.value; if (t.dataset.f) { const form = Object.values(S.forms)[0]; if (form) form[t.dataset.f] = t.value; } });

// The clock ticks without redrawing the page.
setInterval(() => {
  document.querySelectorAll("[data-clock]").forEach((el) => { const s = el.dataset.clock; if (s) el.textContent = J.clock(J.elapsedHours({ started: s }, now())); });
}, 1000);
// Follow the browser: a different tab or a page that has finished loading may be a different client.
const redetect = () => { if (S.signedIn && !S.searching) detect(); };
chrome.tabs.onActivated.addListener(redetect);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.status === "complete") redetect(); });
chrome.windows.onFocusChanged.addListener(redetect);

(async () => {
  S.signedIn = await auth.signedIn();
  render();
  if (S.signedIn) load();
})();
