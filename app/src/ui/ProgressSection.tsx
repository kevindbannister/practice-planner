// A job's or task's progress, apart from its time: what is left (your own figure), how much of it can be done now, what has been planned, and
// what is waiting. Time recorded comes from the time entries; it is never taken as how finished the work is. (lib/jobProgress.ts)
import { useState } from "react";
import { fmtHours } from "../lib/domain";
import { READINESS_LABEL, progress, progressPatch } from "../lib/jobProgress";
import { plannedAhead } from "../lib/planSessions";
import { actualHours, readEntry } from "../lib/timesheet";
import { Row } from "../lib/schema";
import { todayIso } from "../lib/domain";
import { useData } from "./data";
import { usePlanning } from "./usePlanning";

const h = (v: number) => fmtHours(v) || "0h";
const field = (v: unknown) => (v === "" || v == null ? "" : String(v));

export function ProgressSection({ item, kind, estimate, save }: { item: Row; kind: "job" | "task"; estimate: number; save: (p: Row) => Promise<void> }) {
  const { data } = useData();
  const pl = usePlanning();
  const entries = data.jobTime.map(readEntry);
  const actual = actualHours(entries, kind, String(item.Key));
  const p = progress(item, { estimate, actual, plannedAhead: plannedAhead(pl.sessions, String(item.Key), todayIso()) / 60 });
  const [open, setOpen] = useState(false);
  const [rem, setRem] = useState(field(item.RemainingHours));
  const [rdy, setRdy] = useState(field(item.ReadyHours));
  const [note, setNote] = useState(field(item.ReadyNote));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (p.readiness === "complete" && !actual) return null;
  const go = async () => {
    const r = progressPatch({ remaining: rem, ready: rdy, note });
    if (r.error) return setErr(r.error);
    setErr(""); setBusy(true);
    try { await save(r.patch!); setOpen(false); } catch { setErr("That didn't save. Try again."); } finally { setBusy(false); }
  };
  return (
    <section className="stack" style={{ gap: 6 }} aria-label="Progress">
      <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <strong>Progress <span className="chip" style={{ marginLeft: 6 }}>{READINESS_LABEL[p.readiness]}</span></strong>
        {p.readiness !== "complete" && <button type="button" className="btn small" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Say what's left"}</button>}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Estimate {h(p.estimate)} · recorded {h(p.actual)} · left {h(p.remaining)}{p.remainingIsOwn ? " (your figure)" : " (estimate less recorded)"}
        {p.remainingIsOwn && p.revisedTotal !== p.estimate ? ` · now looks like ${h(p.revisedTotal)} in all` : ""}
        {" · "}planned ahead {h(p.plannedAhead)}{p.unscheduled > 0 ? ` · ${h(p.unscheduled)} not yet planned` : ""}
        {p.blocked > 0 ? ` · ${h(p.blocked)} can't be done yet${item.ReadyNote ? ` (${String(item.ReadyNote)})` : ""}` : ""}
      </p>
      {p.needsRemaining && <div className="alert" role="status">The time recorded has reached the estimate. That doesn't mean it is finished: say how much is left.</div>}
      {p.overBudget && !p.needsRemaining && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Over its estimate by {h(p.actual - p.estimate)}.</p>}
      {open && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row-wrap" style={{ gap: 8, alignItems: "end" }}>
            <label className="field">Work left (hours)<input value={rem} onChange={(e) => setRem(e.target.value)} placeholder={`blank: ${h(Math.max(0, p.estimate - p.actual))}`} inputMode="decimal" style={{ width: 150 }} /></label>
            <label className="field">Can be done now (hours)<input value={rdy} onChange={(e) => setRdy(e.target.value)} placeholder="blank: all of it" inputMode="decimal" style={{ width: 170 }} /></label>
            <label className="field" style={{ flex: 1, minWidth: 180 }}>The rest waits for<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="the bank statements, HMRC reply…" /></label>
            <button type="button" className="btn" disabled={busy} onClick={() => void go()}>Save</button>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>Your figure for what is left replaces the estimate less time recorded. Only the part that can be done now takes planning time. To park the whole job or wait on someone, use the hold below.</p>
          {err && <div className="alert red" role="alert"><strong>{err}</strong></div>}
        </div>
      )}
    </section>
  );
}
