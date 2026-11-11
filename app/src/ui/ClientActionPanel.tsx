// The client-action part of a task: share it with the client, see what they sent, check it, chase it, and the history.
// Nothing reaches the client until the person presses the confirm button. Nothing the client does can finish the task: only "Accept" here can.
import { useEffect, useState } from "react";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { PortalReq, ChaseKind, EVENT_LABEL, TaskEvent, VerifyAction, afterShare, chaseHistory, chasePlan, historyOf, portalSync, shareDraft, taskEventRow, verifyPlan } from "../lib/work/clientActions";
import { readTask } from "../lib/work/model";
import { useData } from "./data";
import { say, usePortal } from "./portalKit";

type Plan = { kind: "share" | "verify" | "chase"; text: string; run: () => Promise<void> };

export function ClientActionPanel({ task }: { task: Row }) {
  const { data, update, create, user } = useData();
  const portal = usePortal();
  const t = readTask(task);
  const [req, setReq] = useState<PortalReq | null>(null);
  const [plan, setPlan] = useState<Plan>();
  const [note, setNote] = useState(""); const [follow, setFollow] = useState("");
  const [error, setError] = useState<string>(); const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const events = data.taskEvents as Row[];
  const history = historyOf(events, t.key);
  const linked = String(task.PortalRequestId || "");
  const ctx = () => ({ user: user || "", now: new Date().toISOString(), key: () => newKey("E") });
  const configured = !portal.status || portal.status.configured;
  const load = () => { if (!linked || !t.clientKey) return; portal.run((a) => a.requests(t.clientKey)).then((l) => setReq((l as unknown as PortalReq[]).find((r) => r.id === linked) || null)).catch(() => undefined); };
  useEffect(load, [linked, t.clientKey]);
  // The one thing applied by itself: the client has submitted something, so the status says so.
  useEffect(() => {
    if (!req) return;
    const s = portalSync([task], [req], ctx()); const p = s.patches[0]; if (!p) return;
    void update("Tasks", task, p.patch).then(() => create("TaskEvents", taskEventRow(p.event))).catch(() => undefined);
  }, [req?.status, req?.thread.length]);
  if (t.ownerType === "user") return null;
  const sync = portalSync([task], req ? [req] : [], ctx()).notes[0]?.message;
  const people = portal.forClient(t.clientKey).filter((r) => r.person.status === "active");

  const record = async (patch: Row | undefined, event: TaskEvent) => { if (patch) await update("Tasks", task, patch); await create("TaskEvents", taskEventRow(event)); };
  const go = async (fn: () => Promise<void>) => { setBusy(true); setError(undefined); try { await fn(); setPlan(undefined); setNote(""); setFollow(""); load(); } catch (e) { setError(say(e)); } finally { setBusy(false); } };

  const share = () => {
    const d = shareDraft(t, picked); if ("error" in d) return setError(d.error);
    setError(undefined);
    setPlan({ kind: "share", text: `This will put "${d.title}" in the client's portal${d.dueDate ? `, needed by ${d.dueDate}` : ""}, and email ${picked.length ? "the people you ticked" : "everyone with access for this business"}.`, run: () => go(async () => {
      const r = await portal.run((a) => a.createRequest({ clientKey: d.clientKey, title: d.title, details: d.details, dueDate: d.dueDate, assignedTo: d.assignedTo, notify: true }));
      const a = afterShare(task, r.request.id, ctx()); await record(a.patch, a.event);
    }) });
  };
  const verify = (action: VerifyAction) => {
    const p = verifyPlan(task, action, ctx(), note); if ("error" in p) return setError(p.error);
    setError(undefined);
    const run = () => go(async () => {
      await record(p.patch, p.event);
      if (p.portal.op === "complete" && linked) await portal.run((a) => a.completeRequest(linked)).catch(() => undefined);
      if (p.portal.op === "reply-reopen" && linked) await portal.run((a) => a.replyRequest(linked, p.portal.text || "", true));
    });
    if (action === "review") return void run();
    setPlan({ kind: "verify", text: action === "accept" ? "You are saying you have checked what the client sent and it is what you needed. This marks the action Done." : action === "corrections" ? `The client will be told, in the portal: "${p.portal.text}"` : "This reopens the action.", run });
  };
  const chase = (kind: ChaseKind) => {
    const p = chasePlan(task, kind, ctx(), { note, followUp: follow || undefined, events: history }); if ("error" in p) return setError(p.error);
    setError(undefined);
    const run = () => go(async () => { await record(p.patch, p.event); if (p.portal.op === "reply" && linked) await portal.run((a) => a.replyRequest(linked, p.portal.text || "", true)); });
    if (kind === "portal") setPlan({ kind: "chase", text: `This sends the client a reminder in the portal: "${p.portal.text}"`, run }); else void run();
  };
  const last = req?.thread.filter((x) => x.from === "client").at(-1);
  const chased = chaseHistory(history, t.key);
  return (
    <section className="stack" aria-label="Client action" style={{ gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 15 }}>Client action</h3>
      {!linked && configured && <div className="stack" style={{ gap: 6 }}>
        <span className="muted">Not shared with the client yet. They can't see it.</span>
        {t.clientKey && people.length > 0 && <fieldset className="stack" style={{ gap: 2, border: "1px solid var(--line)", borderRadius: 8, padding: "6px 10px" }}><legend>Who should answer</legend>{people.map((p) => <label key={p.person.id} className="row-wrap"><input type="checkbox" checked={picked.includes(p.person.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.person.id] : picked.filter((x) => x !== p.person.id))} /> {p.person.name || p.person.email}</label>)}</fieldset>}
        <div><button type="button" className="btn small" onClick={share}>Share with the client…</button></div>
      </div>}
      {linked && <p style={{ margin: 0 }}>Shared in the portal{req ? `: ${req.status === "responded" ? "the client has answered" : req.status === "open" ? "waiting for the client" : req.status}` : ""}.{last && <> They wrote: <q>{last.text.slice(0, 200)}</q>{last.docs?.length ? ` (${last.docs.length} file${last.docs.length === 1 ? "" : "s"})` : ""}</>}</p>}
      {sync && <p className="import-list warn" role="status">{sync}</p>}
      {(t.status === "Submitted" || t.status === "Under review") && <div className="stack" style={{ gap: 6 }}>
        <p className="muted" style={{ margin: 0 }}>The client says this is done. It only counts once you have checked it.</p>
        <input className="input" aria-label="Note for the check" placeholder="Note (needed to send corrections)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="row-wrap" style={{ gap: 6 }}>
          {t.status === "Submitted" && <button type="button" className="btn small" onClick={() => verify("review")}>Start checking</button>}
          <button type="button" className="btn small primary" onClick={() => verify("accept")}>Accept: it's right</button>
          <button type="button" className="btn small" onClick={() => verify("corrections")}>Ask for corrections</button>
        </div>
      </div>}
      {(t.status === "Done" || t.status === "Cancelled") && <div className="row-wrap" style={{ gap: 6 }}><input className="input" aria-label="Why reopen" placeholder="Why reopen?" value={note} onChange={(e) => setNote(e.target.value)} /><button type="button" className="btn small" onClick={() => verify("reopen")}>Reopen</button></div>}
      {!["Done", "Cancelled"].includes(t.status) && t.status !== "Submitted" && t.status !== "Under review" && <div className="stack" style={{ gap: 6 }}>
        <div className="row-wrap" style={{ gap: 6 }}>
          <input className="input" aria-label="Chase note" placeholder="Note (what was said)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <input className="input" aria-label="Follow up on" type="date" value={follow} onChange={(e) => setFollow(e.target.value)} />
        </div>
        <div className="row-wrap" style={{ gap: 6 }}>
          <button type="button" className="btn small" onClick={() => chase("call")}>Log a call</button>
          <button type="button" className="btn small" onClick={() => chase("email")}>Log an email</button>
          <button type="button" className="btn small" onClick={() => chase("note")}>Add a note</button>
          {linked && <button type="button" className="btn small" onClick={() => chase("portal")}>Send portal reminder…</button>}
          <button type="button" className="btn small" onClick={() => chase("escalate")}>Escalate</button>
        </div>
        {chased.length > 0 && <span className="muted" style={{ fontSize: 13 }}>Chased {chased.length} time{chased.length === 1 ? "" : "s"}; last {chased[0].at.slice(0, 10)}.</span>}
      </div>}
      {plan && <div role="alertdialog" aria-label="Confirm" className="card pad stack" style={{ gap: 6 }}><span>{plan.text}</span><div className="row-wrap" style={{ gap: 6 }}><button type="button" className="btn small primary" disabled={busy} onClick={() => void plan.run()}>Confirm</button><button type="button" className="btn small" onClick={() => setPlan(undefined)}>Cancel</button></div></div>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {history.length > 0 && <details><summary>History ({history.length})</summary><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{history.slice(0, 20).map((e) => <li key={e.key}>{e.at.slice(0, 10)} · {EVENT_LABEL[e.type] || e.type}{e.after ? `: ${e.before ? `${e.before} → ` : ""}${e.after}` : ""}{e.reason ? ` (${e.reason})` : ""} <span className="muted">{e.by}</span></li>)}</ul></details>}
    </section>
  );
}
