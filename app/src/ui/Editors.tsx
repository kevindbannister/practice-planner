// Side panels for editing a job (dates, stage, completion) and adding or editing tasks
// and jobs. Open them from anywhere with useEditor().open(...). Every field saves as
// soon as it's changed.
import { createContext, ReactNode, useContext, useEffect, useId, useRef, useState } from "react";
import {
  HOLD_WARN_DAYS, Job, Task, fmtDate, fmtHours, holdAlert, holdPatch, isOnHold, isOpen, jobState, resumePatch, todayIso,
} from "../lib/domain";
import { deadlineFor, describeRule, jobHours, newKey, nextPeriod, rollForward, ruleFor } from "../lib/planning";
import { ListKey, Row } from "../lib/schema";
import { chaseSummary } from "../lib/chase";
import { svcClass } from "../lib/serviceColour";
import { DeadlineChip, Icon, href } from "./bits";
import { useData, useIndex } from "./data";

type Open =
  | { kind: "job"; key: string }
  | { kind: "task"; key?: string; clientKey?: string; plannedDate?: string }
  | { kind: "newJob"; clientKey: string };

const EditorContext = createContext<{ open: (o: Open) => void; close: () => void } | null>(null);

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor must be inside EditorProvider");
  return ctx;
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Open | null>(null);
  const close = () => setCurrent(null);
  return (
    <EditorContext.Provider value={{ open: setCurrent, close }}>
      {children}
      {current?.kind === "job" && <JobPanel jobKey={current.key} onClose={close} />}
      {current?.kind === "task" && (
        <TaskPanel taskKey={current.key} clientKey={current.clientKey} plannedDate={current.plannedDate} onClose={close} />
      )}
      {current?.kind === "newJob" && <NewJobPanel clientKey={current.clientKey} onClose={close} />}
    </EditorContext.Provider>
  );
}

function Drawer({ title, eyebrow, onClose, children, accent }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode; accent?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("h2")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="drawer-wrap">
      <button type="button" className="drawer-scrim" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div className={`drawer${accent ? ` accent ${accent}` : ""}`} role="dialog" aria-modal="true" aria-labelledby="drawer-title" ref={ref}>
        <div className="drawer-head">
          <div className="stack" style={{ gap: 4 }}>
            <span className="eyebrow">{accent && <span className="svc-dot" aria-hidden="true" style={{ marginRight: 6, verticalAlign: "-1px" }} />}{eyebrow}</span>
            <h2 id="drawer-title" tabIndex={-1}>{title}</h2>
          </div>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}

/** A labelled drop-down (a label wrapping a select would read its options aloud as the name). */
export function SelectField({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </div>
  );
}

/** An input that saves when you leave it (or press Enter), if the value changed. */
function Field({
  label, value, type = "text", onSave, step, placeholder, multiline,
}: {
  label: string; value?: string | number; type?: string; onSave: (v: string) => Promise<void> | void;
  step?: string; placeholder?: string; multiline?: boolean;
}) {
  const [v, setV] = useState(value === undefined || value === null ? "" : String(value));
  const [err, setErr] = useState<string>();
  useEffect(() => setV(value === undefined || value === null ? "" : String(value)), [value]);
  const commit = async (next = v) => {
    if (next === (value === undefined || value === null ? "" : String(value))) return;
    try {
      setErr(undefined);
      await onSave(next.trim());
    } catch {
      setErr("Couldn't save. Try again.");
    }
  };
  const common = {
    className: "input",
    value: v,
    placeholder,
    onChange: (e: any) => {
      setV(e.target.value);
      if (type === "date") commit(e.target.value); // date pickers save straight away
    },
    onBlur: () => type !== "date" && commit(),
  };
  return (
    <label>
      {label}
      {multiline ? (
        <textarea {...common} rows={3} />
      ) : (
        <input
          {...common}
          type={type}
          step={step}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      )}
      {err && <span className="error-text">{err}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- jobs

function JobPanel({ jobKey, onClose }: { jobKey: string; onClose: () => void }) {
  const { data, update, create } = useData();
  const idx = useIndex();
  const job = data.jobs.find((j) => j.Key === jobKey);
  const [completing, setCompleting] = useState(false);
  const [actual, setActual] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<Row | null | undefined>(undefined);
  if (!job) return null;

  const client = idx.clientByKey.get(job.ClientKey);
  const stages = idx.stagesByService.get(job.ServiceKey || "") || [];
  const current = Math.min(job.StageNo || 1, Math.max(stages.length, 1));
  const today = todayIso();
  const save = (patch: Row) => update("Jobs", job, patch);
  const num = (v: string) => (v === "" ? "" : Number(v));
  const setStage = (n: number) => {
    const name = (stages[n - 1]?.Title as string) || "";
    // reaching a "records received" stage means the records are in
    const records = /received/i.test(name) && !job.RecordsReceived ? { RecordsReceived: today } : {};
    return save({ StageNo: n, StageName: name, ...records });
  };
  const rule = ruleFor(job.ServiceKey, data.services);
  const preview = nextPeriod(rule, job.PeriodEnd, job.Deadline);

  const complete = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const hours = actual ? Number(actual) : undefined;
      const finished = { ...job, ActualHours: hours ?? job.ActualHours } as Job;
      const nextRow = rollForward(finished, rule, today, newKey("J"));
      // create the next job first, so nothing is lost if the second step fails
      if (nextRow) {
        nextRow.StageName = (stages[0]?.Title as string) || "";
        await create("Jobs", nextRow);
      }
      await save({ Status: "Complete", CompletedDate: today, ...(hours !== undefined ? { ActualHours: hours } : {}) });
      setDone(nextRow);
    } catch {
      setError("Couldn't complete the job. Nothing has been lost; try again.");
    } finally {
      setBusy(false);
    }
  };

  if (done !== undefined) {
    return (
      <Drawer title={job.Title} eyebrow="Completed" onClose={onClose}>
        <div className="alert" style={{ borderColor: "var(--green)", background: "var(--green-soft)", color: "var(--green)" }}>
          <strong>Marked complete</strong>
          <span>{client?.Title} · period to {fmtDate(job.PeriodEnd)}</span>
        </div>
        {done ? (
          <p style={{ margin: 0 }}>
            Next one created: period to <strong>{fmtDate(done.PeriodEnd as string)}</strong>, due{" "}
            <strong>{fmtDate(done.Deadline as string)}</strong>
            {done.SuggestedSlot ? <>, suggested slot {fmtDate(done.SuggestedSlot as string, { weekday: true })}</> : null}.
          </p>
        ) : (
          <p style={{ margin: 0 }} className="muted">This is one-off work, so there's no next job.</p>
        )}
        <div className="form-actions"><button type="button" className="btn primary" onClick={onClose}>Done</button></div>
      </Drawer>
    );
  }

  return (
    <Drawer title={job.Title} eyebrow={idx.serviceName.get(job.ServiceKey || "") && idx.serviceName.get(job.ServiceKey || "") !== job.Title ? `Job · ${idx.serviceName.get(job.ServiceKey || "")}` : "Job"} onClose={onClose} accent={svcClass(job.ServiceKey)}>
      <div className="row-wrap" style={{ gap: 6 }}>
        {client && <a href={href("clients", client.Key, "work")} onClick={onClose} style={{ fontWeight: 600 }}>{client.Title}</a>}
        {job.PeriodEnd && <span className="muted">· period to {fmtDate(job.PeriodEnd)}</span>}
      </div>
      <div className="row-wrap" style={{ gap: 6 }}>
        {job.Priority === "urgent" && <span className="chip red">Urgent</span>}
        {isOnHold(job) && <span className="chip hold">On hold</span>}
        <DeadlineChip job={job} today={today} />
        {!isOpen(job) && <span className="chip green">Complete</span>}
      </div>
      {isOpen(job) && <HoldSection item={job} deadline={job.Deadline} save={save} what="job" />}

      <div className="form" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <Field label="Planned for" type="date" value={job.PlannedDate} onSave={(v) => save({ PlannedDate: v })} />
        <Field label="Deadline" type="date" value={job.Deadline} onSave={(v) => save({ Deadline: v, DeadlineSource: "Manual" })} />
        <Field label="Records expected" type="date" value={job.RecordsExpected as string} onSave={(v) => save({ RecordsExpected: v })} />
        <Field label="Records received" type="date" value={job.RecordsReceived} onSave={(v) => save({ RecordsReceived: v })} />
        <Field
          label={`Your hours (default ${fmtHours(jobHours({ ServiceKey: job.ServiceKey }, data.services))})`}
          type="number" step="0.25" value={job.EstimateHours}
          onSave={(v) => save({ EstimateHours: num(v) as any })}
        />
      </div>
      {job.SuggestedSlot && !job.PlannedDate && (
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <span className="muted" style={{ fontSize: 13 }}>Suggested from last time: {fmtDate(job.SuggestedSlot, { weekday: true })}</span>
          <button type="button" className="btn small" onClick={() => save({ PlannedDate: job.SuggestedSlot })}>Plan for then</button>
        </div>
      )}
      <label className="row-wrap" style={{ gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={job.Priority === "urgent"} onChange={(e) => save({ Priority: e.target.checked ? "urgent" : "" })} style={{ width: 18, height: 18 }} />
        Urgent
      </label>

      {stages.length > 0 && (
        <section className="stack" aria-labelledby="stages-h" style={{ gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 id="stages-h" style={{ margin: 0, fontSize: 15 }}>Stage {current} of {stages.length}</h3>
            <div className="row-wrap" style={{ gap: 6 }}>
              <button type="button" className="btn small" disabled={current <= 1} onClick={() => setStage(current - 1)}>Back</button>
              <button type="button" className="btn small primary" disabled={current >= stages.length} onClick={() => setStage(current + 1)}>Next stage</button>
            </div>
          </div>
          <ol className="stage-list">
            {stages.map((s) => {
              const n = s.StageNo as number;
              const state = n < current ? "done" : n === current ? "now" : "todo";
              return (
                <li key={s.Key as string}>
                  <button type="button" className={`stage ${state}`} aria-current={state === "now" ? "step" : undefined} onClick={() => setStage(n)}>
                    <span className="stage-dot" aria-hidden="true">{state === "done" ? <Icon name="check" size={12} /> : n}</span>
                    <span>{s.Title as string}</span>
                    {state === "done" && <span className="sr-only">(done)</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Click a stage to move the job to it.</p>
        </section>
      )}

      <Field label="Notes" multiline value={job.Notes} onSave={(v) => save({ Notes: v })} />
      {job.ChaseLog ? (
        <details>
          <summary>Chasing: {chaseSummary(job)}</summary>
          <pre className="chase-log">{job.ChaseLog as string}</pre>
        </details>
      ) : null}

      {isOpen(job) && (
        <section className="stack complete-box" aria-labelledby="complete-h">
          <h3 id="complete-h" style={{ margin: 0, fontSize: 15 }}>Finish this job</h3>
          {!completing ? (
            <>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                {preview
                  ? `Completing it creates the next one: period to ${fmtDate(preview.PeriodEnd)}, due ${fmtDate(preview.Deadline)} (${describeRule(rule).toLowerCase()}).`
                  : "One-off work: nothing is created after it. You can change this in Settings › Types of work."}
              </p>
              <div><button type="button" className="btn" onClick={() => setCompleting(true)}>Mark complete…</button></div>
            </>
          ) : (
            <>
              <div className="form" style={{ gridTemplateColumns: "1fr" }}>
                <label>
                  Hours it actually took (optional, sets next year's estimate)
                  <input className="input" type="number" step="0.25" value={actual} onChange={(e) => setActual(e.target.value)} />
                </label>
              </div>
              {error && <p className="error-text" role="alert">{error}</p>}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setCompleting(false)} disabled={busy}>Cancel</button>
                <button type="button" className="btn primary" onClick={complete} disabled={busy}>{busy ? "Saving…" : "Complete"}</button>
              </div>
            </>
          )}
        </section>
      )}
    </Drawer>
  );
}

function NewJobPanel({ clientKey, onClose }: { clientKey: string; onClose: () => void }) {
  const { data, create } = useData();
  const idx = useIndex();
  const client = idx.clientByKey.get(clientKey);
  const services = data.services.filter((s) => s.Key !== "TASK").sort((a, b) => String(a.Title).localeCompare(String(b.Title)));
  const [service, setService] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [deadline, setDeadline] = useState("");
  const [deadlineTouched, setDeadlineTouched] = useState(false);
  const [planned, setPlanned] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!deadlineTouched && service && periodEnd) setDeadline(deadlineFor(ruleFor(service, data.services), periodEnd));
  }, [service, periodEnd]);

  const submit = async () => {
    if (!service || !periodEnd || !deadline) return setError("Choose the type of work, period end and deadline.");
    setBusy(true);
    try {
      const stages = idx.stagesByService.get(service) || [];
      await create("Jobs", {
        Key: newKey("J"),
        Title: (data.services.find((s) => s.Key === service)?.Title as string) || service,
        ClientKey: clientKey,
        ClientName: client?.Title,
        ServiceKey: service,
        PeriodEnd: periodEnd,
        Deadline: deadline,
        DeadlineSource: deadlineTouched ? "Manual" : "Calculated",
        PlannedDate: planned || undefined,
        StageNo: 1,
        StageName: (stages[0]?.Title as string) || "",
        Status: "Open",
        Source: "Added",
      });
      onClose();
    } catch {
      setError("Couldn't add the job. Try again.");
      setBusy(false);
    }
  };

  return (
    <Drawer title="Add a job" eyebrow={client?.Title || "Job"} onClose={onClose}>
      <div className="form" style={{ gridTemplateColumns: "1fr" }}>
        <SelectField label="Type of work" value={service} onChange={setService}>
          <option value="">Choose…</option>
          {services.map((s) => <option key={s.Key as string} value={s.Key as string}>{s.Title as string}</option>)}
        </SelectField>
        <label>
          Period end
          <input className="input" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </label>
        <label>
          Deadline {service && periodEnd && !deadlineTouched ? "(worked out for you; change if needed)" : ""}
          <input className="input" type="date" value={deadline} onChange={(e) => { setDeadline(e.target.value); setDeadlineTouched(true); }} />
        </label>
        <label>
          Planned for (optional)
          <input className="input" type="date" value={planned} onChange={(e) => setPlanned(e.target.value)} />
        </label>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" onClick={submit} disabled={busy}>{busy ? "Adding…" : "Add job"}</button>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------- on hold

/** Put a job or task on hold (with a reason and a date to look again), or take it off hold. */
function HoldSection({ item, deadline, save, what }: { item: Job | Task; deadline?: string; save: (p: Row) => Promise<void>; what: "job" | "task" }) {
  const today = todayIso();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (patch: Row) => {
    setBusy(true);
    setError(undefined);
    try {
      await save(patch);
      setAsking(false);
      setReason("");
      setUntil("");
    } catch {
      setError("Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (isOnHold(item)) {
    const alert = holdAlert(item, deadline, today);
    return (
      <section className={`hold-box${alert ? ` ${alert.level}` : ""}`} aria-label="On hold">
        <div className="stack" style={{ gap: 2 }}>
          <strong>On hold{item.HeldOn ? ` since ${fmtDate(item.HeldOn as string)}` : ""}</strong>
          {item.HoldReason ? <span>{item.HoldReason as string}</span> : <span className="muted">No reason given</span>}
          <span className="muted" style={{ fontSize: 12 }}>
            {item.HoldUntil ? `Look again on ${fmtDate(item.HoldUntil as string, { weekday: true })}` : "No date to look again"}
            {alert ? ` · ${alert.text}` : ""}
          </span>
        </div>
        {error && <span className="error-text" role="alert">{error}</span>}
        <div className="row-wrap">
          <button type="button" className="btn small primary" disabled={busy} onClick={() => run(resumePatch(item, today))}>Take off hold</button>
          <button type="button" className="btn small" disabled={busy} onClick={() => { setReason(String(item.HoldReason || "")); setUntil(String(item.HoldUntil || "")); setAsking(true); }}>Change</button>
        </div>
        {asking && (
          <HoldForm reason={reason} until={until} setReason={setReason} setUntil={setUntil} busy={busy}
            onCancel={() => setAsking(false)} onSave={() => run({ HoldReason: reason.trim(), HoldUntil: until })} label="Save" />
        )}
      </section>
    );
  }

  if (!asking) {
    return (
      <div>
        <button type="button" className="btn small" onClick={() => setAsking(true)}>Put on hold…</button>
      </div>
    );
  }
  return (
    <section className="hold-box" aria-label="Put on hold">
      <strong>Put this {what} on hold</strong>
      <span className="muted" style={{ fontSize: 13 }}>
        It stays on the client's record but comes off the plan and out of the alerts. You'll be reminded on the date you pick,
        or if the deadline gets within {HOLD_WARN_DAYS} days.
      </span>
      <HoldForm reason={reason} until={until} setReason={setReason} setUntil={setUntil} busy={busy}
        onCancel={() => setAsking(false)} onSave={() => run(holdPatch(reason, until, today))} label="Put on hold" />
      {error && <span className="error-text" role="alert">{error}</span>}
    </section>
  );
}

function HoldForm(p: {
  reason: string; until: string; setReason: (v: string) => void; setUntil: (v: string) => void;
  busy: boolean; onCancel: () => void; onSave: () => void; label: string;
}) {
  return (
    <>
      <div className="form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label>
          Why (optional)
          <input className="input" value={p.reason} placeholder="e.g. waiting for the client's bank statements" onChange={(e) => p.setReason(e.target.value)} />
        </label>
        <label>
          Look again on (optional)
          <input className="input" type="date" value={p.until} onChange={(e) => p.setUntil(e.target.value)} />
        </label>
      </div>
      <div className="form-actions">
        <button type="button" className="btn small" onClick={p.onCancel} disabled={p.busy}>Cancel</button>
        <button type="button" className="btn small primary" onClick={p.onSave} disabled={p.busy}>{p.busy ? "Saving…" : p.label}</button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- tasks

export const TASK_TYPES = ["Advisory", "Client work", "Practice", "Admin", "Other"];

function TaskPanel({ taskKey, clientKey, plannedDate, onClose }: { taskKey?: string; clientKey?: string; plannedDate?: string; onClose: () => void }) {
  const { data, update, create } = useData();
  const existing = taskKey ? data.tasks.find((t) => t.Key === taskKey) : undefined;
  const [draft, setDraft] = useState<Row>({ Type: clientKey ? "Client work" : "Practice", ClientKey: clientKey, PlannedDate: plannedDate });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const clients = data.clients;

  if (existing) {
    const save = (patch: Row) => update("Tasks", existing, patch);
    return (
      <Drawer title={existing.Title} eyebrow={existing.Type || "Task"} onClose={onClose}>
        {isOpen(existing) && <HoldSection item={existing} deadline={existing.DueDate} save={save} what="task" />}
        <TaskFields value={existing} clients={clients} onChange={(patch) => save(patch)} live />
        {isOpen(existing) ? (
          <div className="form-actions" style={{ justifyContent: "space-between" }}>
            <button type="button" className="btn" onClick={() => save({ Status: "Cancelled" }).then(onClose)}>Cancel task</button>
            <button type="button" className="btn primary" onClick={() => save({ Status: "Done", CompletedDate: todayIso() }).then(onClose)}>Mark done</button>
          </div>
        ) : (
          <div className="form-actions">
            <span className="chip green">{existing.Status}</span>
            <button type="button" className="btn" onClick={() => save({ Status: "Open", CompletedDate: "" })}>Reopen</button>
          </div>
        )}
      </Drawer>
    );
  }

  const submit = async () => {
    if (!String(draft.Title || "").trim()) return setError("Give the task a name.");
    setBusy(true);
    try {
      await create("Tasks", { ...draft, Title: String(draft.Title).trim(), Key: newKey("T"), Status: "Open" });
      onClose();
    } catch {
      setError("Couldn't add the task. Try again.");
      setBusy(false);
    }
  };
  return (
    <Drawer title="New task" eyebrow="Task" onClose={onClose}>
      <TaskFields value={draft} clients={clients} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" onClick={submit} disabled={busy}>{busy ? "Adding…" : "Add task"}</button>
      </div>
    </Drawer>
  );
}

function TaskFields({ value, clients, onChange, live }: { value: Row; clients: Row[]; onChange: (p: Row) => void; live?: boolean }) {
  const num = (v: string) => (v === "" ? "" : Number(v)) as any;
  if (live) {
    return (
      <div className="form" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
        <div style={{ gridColumn: "1 / -1" }}><Field label="Task" value={value.Title as string} onSave={(v) => v && onChange({ Title: v })} /></div>
        <SelectField label="Type" value={(value.Type as string) || ""} onChange={(v) => onChange({ Type: v })}>
          {TASK_TYPES.map((t) => <option key={t}>{t}</option>)}
        </SelectField>
        <SelectField label="Client" value={(value.ClientKey as string) || ""} onChange={(v) => onChange({ ClientKey: v })}>
          <option value="">None</option>
          {clients.map((c) => <option key={c.Key as string} value={c.Key as string}>{c.Title as string}</option>)}
        </SelectField>
        <Field label="Planned for" type="date" value={value.PlannedDate as string} onSave={(v) => onChange({ PlannedDate: v })} />
        <Field label="Due" type="date" value={value.DueDate as string} onSave={(v) => onChange({ DueDate: v })} />
        <Field label="Hours" type="number" step="0.25" value={value.EstimateHours as number} onSave={(v) => onChange({ EstimateHours: num(v) })} />
        <div style={{ gridColumn: "1 / -1" }}><Field label="Notes" multiline value={value.Notes as string} onSave={(v) => onChange({ Notes: v })} /></div>
      </div>
    );
  }
  const set = (k: string) => (e: any) => onChange({ [k]: e.target.value });
  return (
    <div className="form" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
      <label style={{ gridColumn: "1 / -1" }}>Task<input className="input" value={(value.Title as string) || ""} onChange={set("Title")} autoFocus /></label>
      <SelectField label="Type" value={(value.Type as string) || ""} onChange={(v) => onChange({ Type: v })}>
        {TASK_TYPES.map((t) => <option key={t}>{t}</option>)}
      </SelectField>
      <SelectField label="Client" value={(value.ClientKey as string) || ""} onChange={(v) => onChange({ ClientKey: v })}>
        <option value="">None</option>
        {clients.map((c) => <option key={c.Key as string} value={c.Key as string}>{c.Title as string}</option>)}
      </SelectField>
      <label>Planned for<input className="input" type="date" value={(value.PlannedDate as string) || ""} onChange={set("PlannedDate")} /></label>
      <label>Due<input className="input" type="date" value={(value.DueDate as string) || ""} onChange={set("DueDate")} /></label>
      <label>Hours<input className="input" type="number" step="0.25" value={(value.EstimateHours as any) ?? ""} onChange={(e) => onChange({ EstimateHours: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
      <label style={{ gridColumn: "1 / -1" }}>Notes<textarea className="input" rows={3} value={(value.Notes as string) || ""} onChange={set("Notes")} /></label>
    </div>
  );
}

export function taskAsJob(t: Task): Job {
  return { ...t, ClientKey: t.ClientKey || "", Deadline: t.DueDate, ServiceKey: "TASK" } as Job;
}

export const listFor = (kind: "job" | "task"): ListKey => (kind === "job" ? "Jobs" : "Tasks");
export { jobState };
