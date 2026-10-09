// Chase: clients whose records you need soon (or are late), one card per client so one
// email covers everything. Email opens your mail app with the wording filled in and logs
// the chase; Log a call does the same without the email; Records in ticks a job off.
import { useMemo, useRef, useState } from "react";
import {
  ChaseGroup, ChaseTemplate, DEFAULT_TEMPLATE, PLACEHOLDERS, RECENT_DAYS, chaseItems, chasePatch, chaseSummary, chaseUndo,
  fillTemplate, groupByClient, mailtoLink, receivedStage,
} from "../lib/chase";
import { Client, Job, contactName, fmtDate, todayIso } from "../lib/domain";
import { ClientBadge, href } from "./bits";
import { readSetting, useData, useIndex } from "./data";
import { useEditor } from "./Editors";
import { svcClass } from "../lib/serviceColour";

type Toast = { text: string; undo?: () => Promise<void> };

export function ChasePage() {
  const { data, user, update, saveSetting } = useData();
  const idx = useIndex();
  const today = todayIso();
  const [show, setShow] = useState<"all" | "late">("all");
  const [toast, setToast] = useState<Toast>();
  const timer = useRef(0);
  const template = readSetting<ChaseTemplate>(data.settings, "chase.template") || DEFAULT_TEMPLATE;

  const groups = useMemo(() => groupByClient(chaseItems(idx.openJobs, data.services, today, data.stageTemplates)), [idx.openJobs, data.services, today, data.stageTemplates]);
  const toChase = groups.filter((g) => g.status !== "chased" && (show === "all" || g.status === "late"));
  const recent = groups.filter((g) => g.status === "chased");
  const lateCount = groups.filter((g) => g.status === "late").length;

  const say = (t: Toast) => {
    window.clearTimeout(timer.current);
    setToast(t);
    timer.current = window.setTimeout(() => setToast(undefined), 6000);
  };

  const logChase = async (g: ChaseGroup, how: string) => {
    const jobs = g.items.map((i) => i.job);
    const before = jobs.map((j) => ({ job: j, undo: chaseUndo(j) }));
    for (const j of jobs) await update("Jobs", j, chasePatch(j, how, today));
    const name = idx.clientByKey.get(g.clientKey)?.Title || "Client";
    say({
      text: `${name}: logged as chased by ${how} today`,
      undo: async () => {
        for (const b of before) {
          const current = data.jobs.find((j) => j.Key === b.job.Key) || b.job;
          await update("Jobs", current, b.undo);
        }
        setToast(undefined);
      },
    });
  };

  const recordsIn = async (j: Job) => {
    // and on to the "records received" stage, where the job's stages have one
    const next = receivedStage(j, data.stageTemplates);
    const patch = next ? { RecordsReceived: today, StageNo: 2, StageName: next.Title as string } : { RecordsReceived: today };
    const undo = next ? { RecordsReceived: "", StageNo: j.StageNo || 1, StageName: (j.StageName as string) || "" } : { RecordsReceived: "" };
    await update("Jobs", j, patch);
    say({
      text: `${j.Title}: records in today${next ? `, moved to "${next.Title}"` : ""}`,
      undo: async () => { await update("Jobs", j, undo); setToast(undefined); },
    });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Chase records</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {groups.length ? `${groups.length - recent.length} client${groups.length - recent.length === 1 ? "" : "s"} to chase · ${lateCount} late` : "Nobody to chase"}
            {recent.length ? ` · ${recent.length} chased in the last ${RECENT_DAYS} days` : ""}
          </p>
        </div>
        <div className="seg" role="group" aria-label="Show">
          <button type="button" aria-pressed={show === "all"} onClick={() => setShow("all")}>Late and due soon</button>
          <button type="button" aria-pressed={show === "late"} onClick={() => setShow("late")}>Late only</button>
        </div>
      </div>

      <p className="muted" style={{ margin: 0, fontSize: 13, maxWidth: 820 }}>
        Work waiting on records the client hasn't sent, needed in the next two weeks or already late. When they're needed comes from
        the job's "records expected" date, or else from the type of work (for example, accounts 90 days before the deadline; change
        this in Settings › Types of work).
      </p>

      <div className="stack" style={{ gap: 12 }}>
        {toChase.map((g) => (
          <ChaseCard key={g.clientKey} group={g} template={template} me={user || ""} today={today} onLog={logChase} onRecordsIn={recordsIn} />
        ))}
        {!toChase.length && (
          <div className="card empty">
            {show === "late" && groups.some((g) => g.status === "soon") ? "Nothing late." : "Nothing to chase right now."}
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <details className="card" open={!toChase.length}>
          <summary className="card-head" style={{ cursor: "pointer" }}><h2 style={{ display: "inline" }}>Chased in the last {RECENT_DAYS} days ({recent.length})</h2></summary>
          <div className="stack" style={{ gap: 12, padding: 12 }}>
            {recent.map((g) => (
              <ChaseCard key={g.clientKey} group={g} template={template} me={user || ""} today={today} onLog={logChase} onRecordsIn={recordsIn} />
            ))}
          </div>
        </details>
      )}

      <TemplateEditor template={template} onSave={(t) => saveSetting("chase.template", t)} />

      <div aria-live="polite" className="sr-only">{toast?.text}</div>
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" onClick={() => toast.undo!()}>Undo</button>}
        </div>
      )}
    </div>
  );
}

function ChaseCard({ group: g, template, me, today, onLog, onRecordsIn }: {
  group: ChaseGroup; template: ChaseTemplate; me: string; today: string;
  onLog: (g: ChaseGroup, how: string) => Promise<void>; onRecordsIn: (j: Job) => Promise<void>;
}) {
  const idx = useIndex();
  const { open } = useEditor();
  const [busy, setBusy] = useState(false);
  const client = idx.clientByKey.get(g.clientKey) as Client | undefined;
  const email = client?.Email as string | undefined;
  const phone = (client?.Mobile || client?.Phone) as string | undefined;
  const mail = fillTemplate(template, client, g.items, me, today);
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`card chase-card ${g.status}`} aria-label={client?.Title || g.clientKey}>
      <div className="chase-head">
        <div className="ident" style={{ minWidth: 0 }}>
          {client && <ClientBadge client={client} />}
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <div className="row-wrap" style={{ gap: 8 }}>
              {client ? <a className="cell-title" href={href("clients", client.Key, "work")}>{client.Title}</a> : <span>{g.clientKey}</span>}
              {g.status === "late" && <span className="chip red">Late</span>}
              {g.status === "soon" && <span className="chip amber">Due soon</span>}
              {g.status === "chased" && <span className="chip">Chased recently</span>}
            </div>
            <span className="muted" style={{ fontSize: 13 }}>
              {client ? contactName(client) || "No contact name" : ""}
              {email ? ` · ${email}` : " · no email on file"}
              {phone ? ` · ${phone}` : ""}
            </span>
          </div>
        </div>
        <div className="row-wrap chase-actions">
          {phone && <a className="btn small hide-desktop" href={`tel:${phone.replace(/\s+/g, "")}`}>Call</a>}
          <button type="button" className="btn small" disabled={busy} onClick={() => act(() => onLog(g, "phone"))}>Log a call</button>
          {email ? (
            <a
              className="btn small primary"
              href={mailtoLink(email, mail.subject, mail.body)}
              onClick={() => { void act(() => onLog(g, "email")); }}
            >
              Email
            </a>
          ) : (
            <button type="button" className="btn small primary" disabled title="Add an email address to the client's record">Email</button>
          )}
        </div>
      </div>
      <ul className="chase-jobs">
        {g.items.map((i) => (
          <li key={i.job.Key}>
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <button type="button" className="linkbtn" style={{ padding: 0, minHeight: 0, textAlign: "left", color: "var(--ink)" }}
                onClick={() => open({ kind: "job", key: i.job.Key })}>
                <span className={`svc-dot ${svcClass(i.job.ServiceKey)}`} aria-hidden="true" style={{ marginRight: 7, verticalAlign: "-1px" }} />{i.job.Title}{i.job.PeriodEnd ? <span className="muted" style={{ fontWeight: 400 }}> · period to {fmtDate(i.job.PeriodEnd)}</span> : null}
              </button>
              <span style={{ fontSize: 13 }}>
                <span style={{ color: i.neededBy < today ? "var(--red-ink)" : "var(--amber-ink)", fontWeight: 600 }}>
                  Records needed {i.neededBy < today ? "since" : "by"} {fmtDate(i.neededBy, { year: false })}
                </span>
                <span className="muted">{i.worked ? " (worked out)" : " (set on the job)"} · deadline {fmtDate(i.job.Deadline)}</span>
              </span>
              <span className="muted" style={{ fontSize: 12 }}>{chaseSummary(i.job)}</span>
            </div>
            <button type="button" className="btn small" disabled={busy} onClick={() => act(() => onRecordsIn(i.job))}>Records in</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TemplateEditor({ template, onSave }: { template: ChaseTemplate; onSave: (t: ChaseTemplate) => Promise<void> }) {
  const [draft, setDraft] = useState(template);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const changed = draft.subject !== template.subject || draft.body !== template.body;
  const save = async () => {
    setState("saving");
    try {
      await onSave(draft);
      setState("saved");
    } catch {
      setState("error");
    }
  };
  return (
    <details className="card">
      <summary className="card-head" style={{ cursor: "pointer" }}><h2 style={{ display: "inline" }}>Email wording</h2></summary>
      <div className="stack" style={{ padding: 16 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Used for every chase email. These fill themselves in: {PLACEHOLDERS.map(([k, v], i) => (
            <span key={k}>{i ? ", " : ""}<span className="mono">{k}</span> {v}</span>
          ))}.
        </p>
        <div className="form" style={{ gridTemplateColumns: "1fr" }}>
          <label>
            Subject
            <input className="input" value={draft.subject} onChange={(e) => { setDraft({ ...draft, subject: e.target.value }); setState("idle"); }} />
          </label>
          <label>
            Message
            <textarea className="input" rows={11} value={draft.body} onChange={(e) => { setDraft({ ...draft, body: e.target.value }); setState("idle"); }} />
          </label>
        </div>
        <div className="form-actions" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <button type="button" className="linkbtn" onClick={() => { setDraft(DEFAULT_TEMPLATE); setState("idle"); }}>Use the standard wording</button>
          <div className="row-wrap">
            {state === "saved" && !changed && <span className="muted" style={{ fontSize: 13 }}>Saved</span>}
            {state === "error" && <span className="error-text">Couldn't save</span>}
            <button type="button" className="btn primary" onClick={save} disabled={!changed || state === "saving"}>
              {state === "saving" ? "Saving…" : "Save wording"}
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}

/** How many clients need chasing (late or due soon), for the menu. */
export function useChaseCount(): number {
  const { data } = useData();
  const idx = useIndex();
  const today = todayIso();
  return useMemo(
    () => groupByClient(chaseItems(idx.openJobs, data.services, today, data.stageTemplates)).filter((g) => g.status !== "chased").length,
    [idx.openJobs, data.services, today, data.stageTemplates],
  );
}
