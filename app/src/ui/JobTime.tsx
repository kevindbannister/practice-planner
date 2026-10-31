// Time on a job, by stage: a start/stop timer, hours typed in, and each stage's budget against what has been worked.
// Also a small floating timer so a running clock is never out of sight.
import { useEffect, useMemo, useState } from "react";
import { Row } from "../lib/schema";
import { newKey } from "../lib/planning";
import { parseDuration } from "../lib/timeSpent";
import { clock, elapsedHours, lengthText, manualRow, readTime, runningTimer, startRow, stopPatch, summarise, trackedHours } from "../lib/jobTime";
import { href } from "./bits";
import { useData } from "./data";

const nowDate = () => new Date();
const CHIP = { none: "", ok: "green", near: "amber", over: "red" } as const;
const WORDS = { none: "No budget", ok: "Within budget", near: "Nearly at budget", over: "Over budget" } as const;

/** Re-renders every second while something is running. */
function useTick(active: boolean): Date {
  const [now, setNow] = useState(nowDate);
  useEffect(() => {
    if (!active) return;
    setNow(nowDate());
    const id = window.setInterval(() => setNow(nowDate()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return active ? now : nowDate();
}

export function JobTime({ job, stages, current, open }: { job: Row; stages: Row[]; current: number; open: boolean }) {
  const { data, user, create, update, store } = useData();
  const entries = useMemo(() => data.jobTime.map(readTime), [data.jobTime]);
  const run = runningTimer(entries);
  const mine = run?.jobKey === job.Key;
  const now = useTick(!!run);
  const clientStages = useMemo(() => data.clientStages.filter((c) => c.ClientKey === job.ClientKey && c.ServiceKey === job.ServiceKey), [data.clientStages, job.ClientKey, job.ServiceKey]);
  const sm = summarise(stages, clientStages, entries, String(job.Key), now);
  const [hours, setHours] = useState("");
  const [stageNo, setStageNo] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [all, setAll] = useState(false);
  const ready = store.hasList("JobTime");
  const stageName = (no: number) => String(stages.find((s) => Number(s.StageNo) === no)?.Title || "");
  const pick = stageNo || current;

  const go = async (work: () => Promise<void>) => { setBusy(true); setErr(""); try { await work(); } catch { setErr("That didn't save. Try again."); } finally { setBusy(false); } };
  const stopRow = async (e: ReturnType<typeof readTime>) => { const row = data.jobTime.find((r) => r.Key === e.key); if (row) await update("JobTime", row, stopPatch(e, nowDate())); };
  const start = () => go(async () => {
    if (run) await stopRow(run); // starting here stops the one running elsewhere
    await create("JobTime", startRow(job, current, stageName(current), user || "", nowDate(), newKey));
  });
  const stop = () => go(async () => { if (run) await stopRow(run); });
  const add = () => go(async () => {
    const h = parseDuration(hours);
    if (h === undefined) { setErr("I couldn't read that time. Try 1.5, 1h30 or 90m."); return; }
    await create("JobTime", manualRow(job, pick, stageName(pick), h, note, user || "", nowDate(), newKey));
    setHours(""); setNote("");
  });

  if (!ready || !stages.length) return null;
  // a long workflow shows only the stages that matter (a budget, time worked, or the current one) until you ask for all of them
  const relevant = sm.stages.filter((x) => x.budget > 0 || x.actual > 0 || x.stageNo === current);
  const trimmed = sm.stages.length > 6 && relevant.length < sm.stages.length && !all;
  const shownStages = trimmed ? relevant : sm.stages;
  return (
    <section className="stack" aria-labelledby="jt-h" style={{ gap: 8 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 id="jt-h" style={{ margin: 0, fontSize: 15 }}>Time{sm.budget > 0 || sm.actual > 0 ? <span className="muted" style={{ fontWeight: 400 }}> · {lengthText(sm.actual)}{sm.budget > 0 ? ` of ${lengthText(sm.budget)} budget` : ""}</span> : null}</h3>
        {open && (mine
          ? <button type="button" className="btn small primary" disabled={busy} onClick={() => void stop()}>Stop · {clock(elapsedHours(run!, now))}</button>
          : <button type="button" className="btn small" disabled={busy} onClick={() => void start()} title={run ? "Stops the timer running on another job and starts one here" : undefined}>Start timer on stage {current}</button>)}
      </div>
      {run && !mine && <p className="muted" style={{ margin: 0, fontSize: 13 }}>A timer is running on <a href={href("clients", run.clientKey)}>another job</a>. Starting one here stops it.</p>}
      <div className="table-wrap">
        <table className="grid" style={{ minWidth: 380 }}>
          <thead><tr><th scope="col">Stage</th><th scope="col" className="num">Budget</th><th scope="col" className="num">Worked</th><th scope="col"><span className="sr-only">Status</span></th></tr></thead>
          <tbody>
            {shownStages.map((x) => (
              <tr key={x.stageNo} aria-current={x.stageNo === current ? "step" : undefined}>
                <td>{x.stageNo}. {x.name}</td>
                <td className="num mono">{x.budget > 0 ? lengthText(x.budget) : "–"}</td>
                <td className="num mono">{x.actual > 0 ? lengthText(x.actual) : "–"}</td>
                <td>{x.status !== "none" && x.actual > 0 && <span className={`chip ${CHIP[x.status]}`}>{WORDS[x.status]}</span>}</td>
              </tr>
            ))}
            {sm.other > 0 && <tr><td>Earlier stages no longer on the job</td><td className="num mono">–</td><td className="num mono">{lengthText(sm.other)}</td><td /></tr>}
          </tbody>
        </table>
      </div>
      {sm.stages.length > 6 && relevant.length < sm.stages.length && <button type="button" className="linkbtn" style={{ alignSelf: "flex-start" }} onClick={() => setAll(!all)}>{all ? "Show fewer stages" : `Show all ${sm.stages.length} stages`}</button>}
      {open && (
        <div className="inline-form" aria-label="Add time">
          <input className="input" style={{ width: 100 }} aria-label="Time worked" placeholder="e.g. 1h30" value={hours} onChange={(e) => setHours(e.target.value)} />
          <select className="input" style={{ width: "auto" }} aria-label="Stage" value={pick} onChange={(e) => setStageNo(Number(e.target.value))}>{stages.map((s) => <option key={String(s.Key)} value={Number(s.StageNo)}>{Number(s.StageNo)}. {String(s.Title)}</option>)}</select>
          <input className="input" style={{ flex: 1, minWidth: 140 }} aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="btn small" disabled={busy || !hours.trim()} onClick={() => void add()}>Add time</button>
        </div>
      )}
      {err && <p className="error-text" role="alert" style={{ margin: 0 }}>{err}</p>}
    </section>
  );
}

/** "Use the 2h 15m you tracked" when finishing a job. */
export function TrackedHint({ jobKey, onUse }: { jobKey: string; onUse: (hours: number) => void }) {
  const { data } = useData();
  const h = trackedHours(data.jobTime.map(readTime), jobKey);
  if (!(h > 0)) return null;
  return <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>You tracked {lengthText(h)} on this job. <button type="button" className="linkbtn" onClick={() => onUse(h)}>Use that</button></p>;
}

/** A small running clock, bottom right, on every page while a timer is going. */
export function TimerChip() {
  const { data, update } = useData();
  const entries = useMemo(() => data.jobTime.map(readTime), [data.jobTime]);
  const run = runningTimer(entries);
  const now = useTick(!!run);
  const [busy, setBusy] = useState(false);
  if (!run) return null;
  const job = data.jobs.find((j) => j.Key === run.jobKey);
  const stop = async () => {
    const row = data.jobTime.find((r) => r.Key === run.key);
    if (!row) return;
    setBusy(true);
    try { await update("JobTime", row, stopPatch(run, nowDate())); } finally { setBusy(false); }
  };
  return (
    <div className="jt-chip" role="status" aria-label="Timer running">
      <span className="jt-dot" aria-hidden="true" />
      <a href={href("clients", run.clientKey, "work")} title="Open the client's work">{String(job?.Title || "Job")} · {run.stageName || `Stage ${run.stageNo}`}</a>
      <strong className="mono">{clock(elapsedHours(run, now))}</strong>
      <button type="button" className="btn small" disabled={busy} onClick={() => void stop()}>Stop</button>
    </div>
  );
}
