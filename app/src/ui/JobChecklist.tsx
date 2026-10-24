// A job's checklist: progress, sections and items, review notes and sign-off, information needed from the client,
// updating to a newer template, and the audit trail. All saving goes through useChecklists (rules, who may do what,
// and a check that nobody else changed the same thing first).
import { useEffect, useMemo, useRef, useState } from "react";
import * as C from "../lib/checklist";
import { Item, ReviewNote, Template } from "../lib/checklist";
import { Checklist, factsOfChecklist, starterTemplate } from "../lib/checklistRows";
import { starterFor } from "../lib/checklistStarters";
import { fmtDate } from "../lib/domain";
import { SECTIONS } from "../lib/papers";
import { addScope } from "../lib/auth";
import { Icon, href } from "./bits";
import { MAIL_SCOPE, Conflict, Refused, mailAllowed, useChecklists } from "./checklistKit";
import { useData, useIndex } from "./data";

const day = (iso?: string) => (iso ? fmtDate(iso.slice(0, 10)) : "");
const say = (e: unknown, fallback: string) => (e instanceof Refused || e instanceof Conflict ? e.message : fallback);
const STATUS_CLASS: Record<C.Status, string> = { todo: "", doing: "blue", blocked: "red", done: "green", na: "", confirm: "amber" };

export function ProgressBar({ pct, label }: { pct: number; label?: string }) {
  return <span className="cl-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label || "Progress"}><span style={{ width: `${pct}%` }} /></span>;
}

/** The whole checklist screen for one job. */
export function JobChecklistPage({ jobKey }: { jobKey: string }) {
  const cl = useChecklists();
  const { data, reload } = useData();
  const idx = useIndex();
  const job = data.jobs.find((j) => j.Key === jobKey) || data.history.find((j) => j.Key === jobKey);
  const checklist = cl.byJob.get(jobKey);
  const client = job ? data.clients.find((c) => c.Key === job.ClientKey) : undefined;
  const svc = job ? String(idx.serviceName.get(String(job.ServiceKey || "")) || "") : "";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [conflict, setConflict] = useState(false);

  const run = async (id: string, work: () => Promise<unknown>, fail = "That didn't save. Try again.") => {
    setBusy(id); setError(""); setConflict(false);
    try { await work(); } catch (e) { setError(say(e, fail)); if (e instanceof Conflict) setConflict(true); } finally { setBusy(""); }
  };

  if (!job) return <div className="page"><p className="muted">That job isn't here. <a href={href("checklists")}>Back to checklists</a></p></div>;
  return (
    <div className="page job-checklist">
      <div className="row-wrap">
        <a className="linkbtn" href={href("checklists")}>← Checklists</a>
        <span style={{ flex: 1 }} />
        {client && <a className="linkbtn" href={href("clients", client.Key, "work")}>{client.Title}</a>}
      </div>
      <div className="page-head"><div>
        <h1>{svc || String(job.Title || "Job")}{job.PeriodEnd ? `, ${fmtDate(String(job.PeriodEnd))}` : ""}</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>{client?.Title}{job.Deadline ? ` · due ${fmtDate(String(job.Deadline))}` : ""}</p>
      </div></div>
      {error && <div className="import-list warn" role="alert">{error} {conflict && <button type="button" className="btn small" onClick={() => { setConflict(false); setError(""); reload(); }}>Reload</button>}</div>}
      {!cl.ready && <p className="import-list warn" role="alert">The checklist lists aren't set up yet. They are added automatically when the planner starts.</p>}
      {checklist ? <Body cl={cl} checklist={checklist} job={job} run={run} busy={busy} /> : <Attach cl={cl} job={job} svc={svc} client={client} run={run} busy={busy} />}
    </div>
  );
}

/* ---------------------------------------------------------------- no checklist yet */

function Attach({ cl, job, svc, client, run, busy }: { cl: ReturnType<typeof useChecklists>; job: Record<string, unknown>; svc: string; client?: Record<string, unknown>; run: (id: string, w: () => Promise<unknown>, f?: string) => void; busy: string }) {
  const facts = C.factsFor(client as never);
  const options = cl.templates.filter((t) => t.active && t.jobType === job.ServiceKey && (!t.clientKinds.length || t.clientKinds.includes(facts.kind)));
  const starter = starterFor(svc, facts.kind, facts.dormant === "yes");
  const [pick, setPick] = useState("");
  const chosen = options.find((t) => t.id === pick) || (pick === "starter" && starter ? starterTemplate(starter.starter!, String(job.ServiceKey || "")) : undefined) || C.pickTemplate(options, String(job.ServiceKey || ""), facts) || (starter ? starterTemplate(starter.starter!, String(job.ServiceKey || "")) : undefined);
  return (
    <section className="card pad stack" aria-label="Add a checklist">
      <h3 style={{ margin: 0 }}>This job has no checklist</h3>
      <p className="muted" style={{ margin: 0 }}>Choose a template. Only the steps that apply to this client are included, and you'll be asked about anything that isn't known.</p>
      {chosen ? (
        <div className="row-wrap">
          <select className="input" aria-label="Template" value={pick || (chosen.id.startsWith("starter:") ? "starter" : chosen.id)} onChange={(e) => setPick(e.target.value)}>
            {options.map((t) => <option key={t.id} value={t.id}>{t.name} (v{t.version}){t.isDefault ? " · default" : ""}</option>)}
            {starter && <option value="starter">{starter.name} (starter)</option>}
          </select>
          <button type="button" className="btn primary" disabled={busy === "attach"} onClick={() => run("attach", async () => { const r = await cl.attach(job as never, chosen); if (!r) throw new Refused("A checklist already exists for this job. Reload."); }, "Couldn't add the checklist.")}>{busy === "attach" ? "Adding…" : "Add the checklist"}</button>
        </div>
      ) : <p className="muted">There's no template for “{svc || "this job type"}” yet. <a href={href("checklists", "templates")}>Make one in Templates</a>.</p>}
    </section>
  );
}

/* ---------------------------------------------------------------- the checklist */

type Run = (id: string, work: () => Promise<unknown>, fail?: string) => void;

function Body({ cl, checklist, job, run, busy }: { cl: ReturnType<typeof useChecklists>; checklist: Checklist; job: Record<string, unknown>; run: Run; busy: string }) {
  const { data } = useData();
  const client = data.clients.find((c) => c.Key === checklist.clientKey);
  const all = cl.itemsOf(checklist.key).sort((a, b) => a.seq - b.seq);
  const items = all.filter((i) => !i.gone);
  const notes = cl.notesOf(checklist.key);
  const p = C.progress(items, cl.today, C.openNoteCount(notes));
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string>("");
  const [showNa, setShowNa] = useState(false);
  const [diff, setDiff] = useState(false);
  const [asking, setAsking] = useState(false);
  const [log, setLog] = useState(false);
  const staff = cl.config.staff;
  const synced = useRef("");

  // working papers already marked Done complete the linked steps (opening a paper never does)
  const paperSig = useMemo(() => JSON.stringify(data.papers.filter((r) => r.ClientKey === checklist.clientKey && r.PeriodEnd === checklist.period).map((r) => [r.ItemKey, r.Status, r.ReviewedBy])), [data.papers, checklist.clientKey, checklist.period]);
  useEffect(() => {
    const sig = `${checklist.key}|${paperSig}|${items.length}`;
    if (synced.current === sig) return;
    synced.current = sig;
    cl.syncPapers(checklist).catch(() => undefined);
  }, [paperSig, checklist.key, items.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const newer = cl.templates.find((t) => t.id === checklist.templateKey && t.active && t.version > checklist.templateVersion);
  const questions = C.openQuestions(items.filter((i) => i.status === "confirm").map((i) => i.when || []), factsOfChecklist(client, checklist.answers, 0));
  const sections = [...new Set(items.map((i) => i.section))];
  const waiting = items.filter((i) => i.needsClient && i.status !== "done" && i.status !== "na" && i.status !== "confirm" && !C.infoReceived(i));
  const canApprove = C.can(cl.config, cl.me, "approve");
  const status = checklist.status;

  return (
    <>
      <section className="card pad stack cl-head" aria-label="Progress">
        <div className="row-wrap">
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="cl-pct"><strong>{p.pct}%</strong> <span className="muted">{p.done} of {p.total} complete</span> {status === "review" && <span className="chip blue">With the reviewer</span>} {status === "approved" && <span className="chip green">Approved</span>}</div>
            <ProgressBar pct={p.pct} label="Checklist progress" />
          </div>
          <div className="cl-facts">
            <span><strong>{p.mandatoryOpen.length}</strong> mandatory open</span>
            <span><strong>{p.hoursLeft}h</strong> left</span>
            {p.blocked.length > 0 && <span className="warn"><strong>{p.blocked.length}</strong> blocked</span>}
            {p.overdue.length > 0 && <span className="warn"><strong>{p.overdue.length}</strong> overdue</span>}
            {p.confirm > 0 && <span className="warn"><strong>{p.confirm}</strong> to confirm</span>}
          </div>
        </div>
        <div className="muted cl-from">From {checklist.templateName}, version {checklist.templateVersion}{newer ? ` · version ${newer.version} is available` : ""}</div>
        <div className="row-wrap">
          {status === "active" && <button type="button" className="btn primary" disabled={busy === "submit"} onClick={() => run("submit", () => cl.submit(checklist))} title="Hand the work to the reviewer">Submit for review</button>}
          {status === "review" && <button type="button" className="btn primary" disabled={busy === "approve" || !canApprove} onClick={() => run("approve", () => cl.approve(checklist))} title={canApprove ? "" : "Only a reviewer, manager or partner can approve"}>Approve</button>}
          {status !== "active" && <button type="button" className="btn" disabled={busy === "reopen"} onClick={() => { const why = window.prompt(status === "approved" ? "Why is this being reopened?" : "Why is it going back to the preparer?"); if (why !== null) run("reopen", () => cl.reopenChecklist(checklist, why)); }}>{status === "approved" ? "Reopen" : "Send back"}</button>}
          {newer && <button type="button" className="btn" onClick={() => setDiff((v) => !v)}>{diff ? "Hide" : "Review"} template update</button>}
          <label className="check" style={{ marginLeft: "auto" }}><input type="checkbox" checked={showNa} onChange={(e) => setShowNa(e.target.checked)} /> Show not applicable</label>
        </div>
        {(checklist.sign.preparedBy || checklist.sign.approvedBy) && (
          <div className="cl-sign muted">
            {checklist.sign.preparedBy && <span>Prepared by <strong>{checklist.sign.preparedBy}</strong> {day(checklist.sign.preparedOn)}</span>}
            {checklist.sign.reviewedBy && <span>Reviewed by <strong>{checklist.sign.reviewedBy}</strong> {day(checklist.sign.reviewedOn)}</span>}
            {checklist.sign.approvedBy && <span>Approved by <strong>{checklist.sign.approvedBy}</strong> {day(checklist.sign.approvedOn)}</span>}
          </div>
        )}
        {cl.config.independentReview && <p className="muted" style={{ margin: 0 }}>Independent review is on: the person who prepared the work can't approve it.</p>}
      </section>

      {diff && newer && <UpdatePanel cl={cl} checklist={checklist} template={newer} run={run} busy={busy} onDone={() => setDiff(false)} />}

      {questions.length > 0 && (
        <section className="card pad stack" aria-label="Questions">
          <h3 style={{ margin: 0 }}>Please confirm</h3>
          <p className="muted" style={{ margin: 0 }}>These aren't recorded for this client, so some steps are waiting rather than assumed unnecessary.</p>
          {questions.map((q) => (
            <div key={q} className="row-wrap"><span style={{ minWidth: 280 }}>{C.ATTRS.find((a) => a.key === q)?.question}</span>
              <button type="button" className="btn small" disabled={busy === q} onClick={() => run(q, () => cl.answer(checklist, q, "yes"))}>Yes</button>
              <button type="button" className="btn small" disabled={busy === q} onClick={() => run(q, () => cl.answer(checklist, q, "no"))}>No</button>
            </div>
          ))}
        </section>
      )}

      {waiting.length > 0 && (
        <section className="card pad stack" aria-label="Information needed">
          <div className="row-wrap"><h3 style={{ margin: 0 }}>Waiting for the client ({waiting.length})</h3><span style={{ flex: 1 }} />
            <button type="button" className="btn small" onClick={() => setAsking((v) => !v)}>{asking ? "Close" : "Request from client"}</button></div>
          <ul className="cl-waiting">{waiting.map((i) => (
            <li key={i.key}><span><strong>{i.needsClient}</strong> <span className="muted">for “{i.title}”{i.history.some((h) => h.action === "Information requested") ? " · requested" : ""}</span></span>
              <button type="button" className="btn small" disabled={busy === i.key} onClick={() => run(i.key, () => cl.infoReceived(i))}>Mark received</button></li>
          ))}</ul>
          {asking && <RequestForm cl={cl} checklist={checklist} job={job} client={client} items={waiting} run={run} busy={busy} onDone={() => setAsking(false)} />}
        </section>
      )}

      {sections.map((s) => {
        const mine = items.filter((i) => i.section === s);
        const shown = mine.filter((i) => showNa || i.status !== "na");
        const sp = C.progress(mine, cl.today);
        const closed = shut.has(s);
        return (
          <section key={s} className="card cl-sec" aria-label={s}>
            <button type="button" className="cl-sec-head" aria-expanded={!closed} onClick={() => setShut((x) => { const n = new Set(x); if (n.has(s)) n.delete(s); else n.add(s); return n; })}>
              <Icon name={closed ? "right" : "down"} size={14} />
              <strong>{s}</strong>
              <span className="muted">{sp.done}/{sp.total}</span>
              <ProgressBar pct={sp.pct} label={`${s} progress`} />
              {sp.mandatoryOpen.length > 0 && <span className="chip amber">{sp.mandatoryOpen.length} mandatory open</span>}
            </button>
            {!closed && <ul className="cl-items">{shown.map((i) => (
              <ItemRow key={i.key} item={i} items={items} cl={cl} checklist={checklist} notes={notes.filter((n) => n.itemKey === i.key)} staff={staff} open={open === i.key} onToggle={() => setOpen(open === i.key ? "" : i.key)} run={run} busy={busy} />
            ))}{!shown.length && <li className="muted cl-empty">Nothing to show here.</li>}</ul>}
          </section>
        );
      })}

      <ReviewPanel cl={cl} checklist={checklist} items={items} notes={notes} run={run} busy={busy} />

      <section className="card pad stack" aria-label="Audit trail">
        <div className="row-wrap"><h3 style={{ margin: 0 }}>Audit trail</h3><button type="button" className="linkbtn" onClick={() => setLog((v) => !v)}>{log ? "Hide" : "Show"}</button></div>
        {log && <ul className="cl-log">{cl.log(checklist.key).slice(0, 200).map((l) => <li key={String(l.Key)}><span className="muted">{day(String(l.At))} {String(l.At).slice(11, 16)}</span> <strong>{String(l.Actor) || "System"}</strong> {String(l.Action)}{l.Detail ? <span className="muted"> · {String(l.Detail)}</span> : null}</li>)}</ul>}
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- one item */

function ItemRow({ item: i, items, cl, checklist, notes, staff, open, onToggle, run, busy }: {
  item: Item; items: Item[]; cl: ReturnType<typeof useChecklists>; checklist: Checklist; notes: ReviewNote[]; staff: C.Staff[]; open: boolean; onToggle: () => void; run: Run; busy: string;
}) {
  const wait = C.waitingFor(i, items);
  const can = C.canComplete(i, items, cl.config, cl.me, { preparedBy: checklist.sign.preparedBy, status: checklist.status });
  const finished = i.status === "done" || i.status === "na";
  const [text, setText] = useState(i.notes);
  const [dueDate, setDueDate] = useState(i.due);
  useEffect(() => { setText(i.notes); setDueDate(i.due); }, [i.notes, i.due, i.rev]);
  const paper = i.paper ? SECTIONS.find((s) => s.key === i.paper!.section) : undefined;
  const overdue = !finished && i.due && i.due < cl.today && i.status !== "confirm";
  const openNotes = notes.filter((n) => n.status !== "resolved").length;

  return (
    <li className={`cl-row st-${i.status}${i.mandatory ? " must" : ""}`}>
      <div className="cl-line">
        {i.status === "confirm" ? <span className="cl-check pending" title="Confirm if this applies"><Icon name="alert" size={14} /></span> : (
          <button type="button" className={`cl-check${i.status === "done" ? " on" : ""}`} aria-label={i.status === "done" ? `${i.title}: completed. Reopen` : `Complete ${i.title}`} aria-pressed={i.status === "done"}
            disabled={busy === i.key || i.status === "na" || (i.status !== "done" && !can.ok)}
            title={i.status === "done" ? `Completed by ${i.completedBy} ${day(i.completedOn)}. Click to reopen.` : can.ok ? "Mark complete" : can.reason}
            onClick={() => (i.status === "done" ? (() => { const why = window.prompt("Why is this being reopened?"); if (why !== null) run(i.key, () => cl.act.reopen(i, why)); })() : run(i.key, () => cl.act.complete(i)))}>
            {i.status === "done" && <Icon name="check" size={14} />}
          </button>
        )}
        <button type="button" className="cl-title-btn" aria-expanded={open} onClick={onToggle}>
          <span className={i.status === "done" || i.status === "na" ? "cl-done" : ""}>{i.title}</span>
          {!i.mandatory && <span className="chip">Optional</span>}
          <span className={`chip ${STATUS_CLASS[i.status]}`}>{C.STATUS_LABEL[i.status]}</span>
          {wait.length > 0 && !finished && <span className="chip" title={`Waiting for: ${wait.map((w) => w.title).join("; ")}`}>Waiting on {wait.length}</span>}
          {i.review && <span className="chip blue">{i.review === "approve" ? "Final approval" : "Review"}</span>}
          {i.needsClient && !finished && !C.infoReceived(i) && <span className="chip amber">Client info</span>}
          {i.override && <span className="chip red" title={i.override}>Override</span>}
          {openNotes > 0 && <span className="chip red">{openNotes} review point{openNotes === 1 ? "" : "s"}</span>}
        </button>
        <span className="cl-meta">
          {i.assignee && <span title="Assigned to">{i.assignee}</span>}
          {i.due && <span className={overdue ? "warn" : ""}>{overdue ? "Overdue " : ""}{day(i.due)}</span>}
          {i.hours > 0 && <span>{i.hours}h</span>}
          {paper && <a href={`${href("papers", checklist.clientKey, checklist.period)}?section=${encodeURIComponent(paper.key)}`} title={`Open the ${paper.title} working paper`}>Paper</a>}
        </span>
      </div>
      {open && (
        <div className="cl-detail stack">
          {i.description && <p style={{ margin: 0 }}>{i.description}</p>}
          {i.guidance && <p className="muted" style={{ margin: 0 }}>Guidance: {i.guidance}</p>}
          {i.link && /^https?:\/\//i.test(i.link) && <p style={{ margin: 0 }}><a href={i.link} target="_blank" rel="noopener noreferrer">Guidance link</a></p>}
          {i.status === "confirm" && <div className="row-wrap"><span>Does this apply? <span className="muted">({i.rule})</span></span>
            <button type="button" className="btn small" onClick={() => run(i.key, () => cl.act.confirm(i, true))}>Yes, it applies</button>
            <button type="button" className="btn small" onClick={() => run(i.key, () => cl.act.confirm(i, false))}>No, not applicable</button></div>}
          {i.status === "na" && i.naReason && <p className="muted" style={{ margin: 0 }}>Not applicable: {i.naReason}</p>}
          {!can.ok && !finished && i.status !== "confirm" && <p className="warn" style={{ margin: 0 }}>{can.reason}</p>}
          <div className="cl-grid">
            <label className="doc-field"><span>Assigned to</span>
              <select className="input" value={i.assignee} onChange={(e) => run(i.key, () => cl.act.assign(i, e.target.value))} disabled={finished}>
                <option value="">Nobody</option>
                {i.assignee && !staff.some((s) => s.name === i.assignee) && <option value={i.assignee}>{i.assignee}</option>}
                {staff.map((s) => <option key={s.name} value={s.name}>{s.name} ({C.roleLabel(s.role)})</option>)}
              </select>
            </label>
            <label className="doc-field"><span>Due</span><input className="input" type="date" value={dueDate} disabled={finished} onChange={(e) => setDueDate(e.target.value)} onBlur={() => dueDate !== i.due && run(i.key, () => cl.act.edit(i, { due: dueDate }))} /></label>
          </div>
          <label className="doc-field"><span>Notes</span><textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== i.notes && run(i.key, () => cl.act.edit(i, { notes: text }))} /></label>
          <div className="row-wrap">
            {!finished && i.status !== "confirm" && i.status !== "doing" && <button type="button" className="btn small" onClick={() => run(i.key, () => cl.act.start(i))}>Start</button>}
            {!finished && i.status !== "confirm" && i.status !== "blocked" && <button type="button" className="btn small" onClick={() => { const why = window.prompt("What is it blocked on?"); if (why !== null) run(i.key, () => cl.act.block(i, why)); }}>Blocked</button>}
            {i.status === "blocked" && <button type="button" className="btn small" onClick={() => run(i.key, () => cl.act.unblock(i))}>Unblock</button>}
            {!finished && i.status !== "confirm" && <button type="button" className="btn small" onClick={() => { const why = window.prompt(i.mandatory ? "This item is mandatory. Why is it not applicable? (an authorised person must do this)" : "Why is it not applicable? (optional)"); if (why !== null) run(i.key, () => cl.act.notApplicable(i, why)); }}>Not applicable</button>}
            {finished && <button type="button" className="btn small" onClick={() => { const why = window.prompt("Why is this being reopened?"); if (why !== null) run(i.key, () => cl.act.reopen(i, why)); }}>Reopen</button>}
            {!finished && !i.history.some((h) => h.action === "Task created") && <button type="button" className="btn small" onClick={() => run(i.key, () => cl.makeTask(i))} title="Make a task for this step in the planner">Make a task</button>}
            {i.needsClient && !C.infoReceived(i) && !finished && <button type="button" className="btn small" onClick={() => run(i.key, () => cl.infoReceived(i))}>Information received</button>}
          </div>
          <NotesList cl={cl} checklist={checklist} item={i} notes={notes} run={run} busy={busy} />
          {i.history.length > 0 && <details><summary className="muted">History ({i.history.length})</summary><ul className="cl-log">{[...i.history].reverse().map((h, n) => <li key={n}><span className="muted">{day(h.at)} {h.at.slice(11, 16)}</span> <strong>{h.by}</strong> {h.action}{h.detail ? <span className="muted"> · {h.detail}</span> : null}</li>)}</ul></details>}
        </div>
      )}
    </li>
  );
}

/* ---------------------------------------------------------------- review notes */

function NotesList({ cl, checklist, item, notes, run, busy }: { cl: ReturnType<typeof useChecklists>; checklist: Checklist; item?: Item; notes: ReviewNote[]; run: Run; busy: string }) {
  const [text, setText] = useState("");
  const canRaise = C.can(cl.config, cl.me, "review");
  return (
    <div className="stack cl-notes" style={{ gap: 6 }}>
      {notes.map((n) => <NoteRow key={n.key} n={n} cl={cl} run={run} busy={busy} />)}
      {canRaise && (
        <div className="row-wrap">
          <input className="input" style={{ flex: 1, minWidth: 220 }} aria-label={item ? `Review point on ${item.title}` : "Review point"} placeholder={item ? "Raise a review point on this item" : "Raise a review point on the whole checklist"} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" className="btn small" disabled={!text.trim() || busy === `note:${item?.key || ""}`} onClick={() => run(`note:${item?.key || ""}`, async () => { await cl.noteAct.raise(checklist, item, text); setText(""); })}>Raise</button>
        </div>
      )}
    </div>
  );
}

function NoteRow({ n, cl, run, busy }: { n: ReviewNote; cl: ReturnType<typeof useChecklists>; run: Run; busy: string }) {
  const [reply, setReply] = useState("");
  const reviewer = C.can(cl.config, cl.me, "review");
  return (
    <div className={`cl-note ${n.status}`}>
      <div><span className={`chip ${n.status === "resolved" ? "green" : n.status === "ready" ? "blue" : "red"}`}>{n.status === "open" ? "Open" : n.status === "ready" ? "Ready for re-review" : "Resolved"}</span> <strong>{n.raisedBy}</strong> <span className="muted">{day(n.raisedOn)}</span></div>
      <div>{n.text}</div>
      {n.response && <div className="muted">Response from {n.respondedBy}: {n.response}</div>}
      {n.status === "open" && (
        <div className="row-wrap"><input className="input" style={{ flex: 1, minWidth: 200 }} aria-label="Your response" placeholder="Your response" value={reply} onChange={(e) => setReply(e.target.value)} />
          <button type="button" className="btn small" disabled={!reply.trim() || busy === n.key} onClick={() => run(n.key, async () => { await cl.noteAct.respond(n, reply); setReply(""); })}>Ready for re-review</button></div>
      )}
      {n.status !== "resolved" && reviewer && <button type="button" className="btn small" disabled={busy === n.key} onClick={() => run(n.key, () => cl.noteAct.resolve(n))}>Resolve</button>}
      {n.status === "resolved" && reviewer && <button type="button" className="linkbtn" onClick={() => { const why = window.prompt("Why is it being reopened?"); if (why !== null) run(n.key, () => cl.noteAct.reopen(n, why)); }}>Reopen</button>}
    </div>
  );
}

function ReviewPanel({ cl, checklist, items, notes, run, busy }: { cl: ReturnType<typeof useChecklists>; checklist: Checklist; items: Item[]; notes: ReviewNote[]; run: Run; busy: string }) {
  const general = notes.filter((n) => !n.itemKey);
  const onItems = notes.filter((n) => n.itemKey);
  const open = C.openNoteCount(notes);
  return (
    <section className="card pad stack" aria-label="Review">
      <h3 style={{ margin: 0 }}>Review points {open > 0 && <span className="chip red">{open} open</span>}</h3>
      {onItems.length > 0 && <ul className="cl-waiting">{onItems.map((n) => { const it = items.find((x) => x.key === n.itemKey); return <li key={n.key}><span><span className={`chip ${n.status === "resolved" ? "green" : n.status === "ready" ? "blue" : "red"}`}>{n.status === "resolved" ? "Resolved" : n.status === "ready" ? "Ready" : "Open"}</span> <strong>{it?.title || "Item"}</strong>: {n.text}</span></li>; })}</ul>}
      <NotesList cl={cl} checklist={checklist} notes={general} run={run} busy={busy} />
      {!notes.length && <p className="muted" style={{ margin: 0 }}>No review points yet. Reviewers can raise one on any item, or here for the whole checklist.</p>}
    </section>
  );
}

/* ---------------------------------------------------------------- information request */

function RequestForm({ cl, checklist, job, client, items, run, busy, onDone }: { cl: ReturnType<typeof useChecklists>; checklist: Checklist; job: Record<string, unknown>; client?: Record<string, unknown>; items: Item[]; run: Run; busy: string; onDone: () => void }) {
  const idx = useIndex();
  const svc = String(idx.serviceName.get(String(job.ServiceKey || "")) || "your records");
  const [pick, setPick] = useState(() => new Set(items.map((i) => i.key)));
  const [to, setTo] = useState(String(client?.Email || ""));
  const [subject, setSubject] = useState(`Information needed: ${svc}${job.PeriodEnd ? `, year ended ${fmtDate(String(job.PeriodEnd))}` : ""}`);
  const chosen = items.filter((i) => pick.has(i.key));
  const [body, setBody] = useState("");
  const [edited, setEdited] = useState(false);
  const auto = `Hello,\n\nTo move forward with ${svc}${job.PeriodEnd ? ` for the period ended ${fmtDate(String(job.PeriodEnd))}` : ""} we still need:\n\n${chosen.map((i) => `- ${i.needsClient}`).join("\n")}\n\nCould you send these over as soon as you can? Please let us know if anything isn't available.\n\nThank you`;
  const text = edited ? body : auto;
  const mail = mailAllowed();
  return (
    <div className="stack cl-request">
      <div className="row-wrap">{items.map((i) => <label key={i.key} className="check"><input type="checkbox" checked={pick.has(i.key)} onChange={(e) => setPick((s) => { const n = new Set(s); if (e.target.checked) n.add(i.key); else n.delete(i.key); return n; })} /> {i.needsClient}</label>)}</div>
      <label className="doc-field"><span>To</span><input className="input" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      <label className="doc-field"><span>Subject</span><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label className="doc-field"><span>Message</span><textarea className="input" rows={8} value={text} onChange={(e) => { setBody(e.target.value); setEdited(true); }} /></label>
      <div className="form-actions">
        <button type="button" className="btn primary" disabled={!mail || !chosen.length || busy === "request"} onClick={() => run("request", async () => { await cl.requestInfo(checklist, chosen, { to, subject, body: text, draft: true }); onDone(); })}>Create Outlook draft</button>
        <button type="button" className="btn" disabled={!chosen.length || busy === "request"} onClick={() => run("request", async () => { try { await navigator.clipboard.writeText(text); } catch { /* the text is on screen to copy */ } await cl.requestInfo(checklist, chosen, { to, subject, body: text, draft: false }); onDone(); })}>Copy and record the request</button>
        {!mail && <button type="button" className="btn small" onClick={() => addScope(MAIL_SCOPE, true)}>Allow Outlook</button>}
      </div>
      <p className="muted" style={{ margin: 0 }}>The draft is only saved in Outlook; nothing is sent from here. The request is noted on each item and on the client's timeline.</p>
    </div>
  );
}

/* ---------------------------------------------------------------- update to a newer template */

function UpdatePanel({ cl, checklist, template, run, busy, onDone }: { cl: ReturnType<typeof useChecklists>; checklist: Checklist; template: Template; run: Run; busy: string; onDone: () => void }) {
  const d = cl.preview(checklist, template);
  const nothing = !d.added.length && !d.removed.length && !d.changed.length;
  const canApply = C.can(cl.config, cl.me, "template");
  return (
    <section className="card pad stack" aria-label="Template update">
      <h3 style={{ margin: 0 }}>Update to version {template.version}?</h3>
      <p className="muted" style={{ margin: 0 }}>Nothing changes until you apply it. Finished work is never altered, and steps already started are kept.</p>
      {nothing && <p style={{ margin: 0 }}>No differences for this job. Applying just records the new version.</p>}
      {d.added.length > 0 && <div><strong>Added</strong><ul>{d.added.map((i) => <li key={i.id}>{i.title} <span className="muted">· {i.section}</span></li>)}</ul></div>}
      {d.removed.length > 0 && <div><strong>No longer in the template</strong><ul>{d.removed.map((i) => <li key={i.key}>{i.title} <span className="muted">· {i.status === "todo" && !i.notes ? "will be removed" : "kept, work has started"}</span></li>)}</ul></div>}
      {d.changed.length > 0 && <div><strong>Changed</strong><ul>{d.changed.map((c) => <li key={c.item.key}>{c.item.title} <span className="muted">· {c.was.join(", ")}{c.item.status === "done" ? " (completed, not changed)" : ""}</span></li>)}</ul></div>}
      <div className="form-actions">
        <button type="button" className="btn primary" disabled={!canApply || busy === "update"} onClick={() => run("update", async () => { await cl.applyUpdate(checklist, template); onDone(); })}>Apply the update</button>
        <button type="button" className="btn" onClick={onDone}>Not now</button>
        {!canApply && <span className="muted">Only a manager or partner can apply updates.</span>}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- inside the job panel */

/** One line for the job panel: progress, and a way in (or a way to add a checklist). */
export function JobChecklistLine({ jobKey, onNavigate }: { jobKey: string; onNavigate?: () => void }) {
  const cl = useChecklists();
  const c = cl.byJob.get(jobKey);
  if (!cl.ready) return null;
  if (!c) return <div className="cl-line-card"><span className="muted">No checklist on this job.</span> <a href={href("checklists", "job", jobKey)} onClick={onNavigate}>Add one</a></div>;
  const items = cl.itemsOf(c.key);
  const p = C.progress(items, cl.today, C.openNoteCount(cl.notesOf(c.key)));
  return (
    <div className="cl-line-card">
      <a href={href("checklists", "job", jobKey)} onClick={onNavigate}><strong>Checklist {p.pct}%</strong></a>
      <ProgressBar pct={p.pct} label="Checklist progress" />
      <span className="muted">{p.mandatoryOpen.length} mandatory open{c.status === "review" ? " · with reviewer" : c.status === "approved" ? " · approved" : ""}</span>
    </div>
  );
}

/** A small progress chip for a job's header on the client page. */
export function JobChecklistChip({ jobKey }: { jobKey: string }) {
  const cl = useChecklists();
  const c = cl.byJob.get(jobKey);
  if (!c) return null;
  const p = C.progress(cl.itemsOf(c.key), cl.today, C.openNoteCount(cl.notesOf(c.key)));
  return <a className={`chip ${c.status === "approved" ? "green" : p.overdue.length || p.blocked.length ? "amber" : "blue"}`} href={href("checklists", "job", jobKey)} title={`${p.done} of ${p.total} checklist items done, ${p.mandatoryOpen.length} mandatory open`}>Checklist {p.pct}%</a>;
}

/** What stops this job being completed, for the "Mark complete" step. */
export function useJobBlockers(jobKey: string): { blockers: string[]; checklistKey?: string } {
  const cl = useChecklists();
  const c = cl.byJob.get(jobKey);
  if (!c) return { blockers: [] };
  return { blockers: C.jobBlockers(cl.itemsOf(c.key).filter((i) => !i.gone), C.openNoteCount(cl.notesOf(c.key))), checklistKey: c.key };
}
