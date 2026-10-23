// Time actually spent: the one-tap picker, the row used to log or add time, and the "time to
// log" card on Home for work that was finished with no time recorded.
import { useState } from "react";
import { fmtDate, todayIso } from "../lib/domain";
import { Finished, CATCH_UP_DAYS, finishedWithoutTime, parseDuration, timeGapText, timePatch, timeSkipPatch } from "../lib/timeSpent";
import { TimePicker } from "./TimePicker";
import { addDays } from "../lib/planning";
import { Row } from "../lib/schema";
import { useData, useIndex } from "./data";
import { Icon } from "./bits";
import { useEditor } from "./Editors";

/** Log (or add) the time for something finished: pick it, save it, or say you don't know. */
export function TimeEntry({ finished, onSaved, onCancel, compact }: { finished: Finished; onSaved?: () => void; onCancel?: () => void; compact?: boolean }) {
  const { update } = useData();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const list = finished.kind === "job" ? "Jobs" : "Tasks";
  const run = async (patch: Row) => {
    setBusy(true);
    setError(undefined);
    try {
      await update(list, finished.row, patch);
      onSaved?.();
    } catch {
      setError("Couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const hours = parseDuration(text);
  return (
    <div className={`time-entry${compact ? " compact" : ""}`}>
      <TimePicker value={text} onChange={setText} estimate={finished.estimate} label={compact ? "How long?" : "How long did it take?"} />
      {error && <span className="error-text" role="alert">{error}</span>}
      <div className="row-wrap">
        <button type="button" className="btn small primary" disabled={busy || hours === undefined} onClick={() => hours !== undefined && void run(timePatch(hours))}>
          {busy ? "Saving…" : "Save time"}
        </button>
        <button type="button" className="btn small" disabled={busy} onClick={() => void run(timeSkipPatch())} title="Stops asking about this one">Don't know</button>
        {onCancel && <button type="button" className="btn small" disabled={busy} onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

const LIST_LIMIT = 4;

/** On Home: finished work from the last couple of weeks with no time logged, to catch up on. */
export function TimeToLog() {
  const { data } = useData();
  const idx = useIndex();
  const { open } = useEditor();
  const today = todayIso();
  const [all, setAll] = useState(false);
  const [openKey, setOpenKey] = useState<string>();
  const list = finishedWithoutTime(data.jobs as never, data.tasks as never, data.services, { since: addDays(today, -CATCH_UP_DAYS) });
  if (!list.length) return null;
  const shown = all ? list : list.slice(0, LIST_LIMIT);
  const name = (f: Finished) => (f.clientKey && idx.clientByKey.get(f.clientKey)?.Title) || String((f.row as { ClientName?: string }).ClientName || "");
  return (
    <section className="card timelog" aria-labelledby="timelog-h">
      <div className="card-head">
        <h2 className="with-icon" id="timelog-h"><span className="h-icon hue-amber" aria-hidden="true"><Icon name="clock" size={15} /></span>Time to log</h2>
        <a href="#/plan/done" style={{ fontSize: 13 }}>All completed work</a>
      </div>
      <p className="muted" style={{ margin: "0 0 8px", fontSize: 13, padding: "0 16px" }}>
        {timeGapText(list, today)} Tell me how long each took so the planner gets better at estimating. A rough time is fine.
      </p>
      <ul className="home-list">
        {shown.map((f) => (
          <li key={f.key} className="timelog-row">
            <div className="timelog-line">
              <button type="button" className="linklike" onClick={() => open(f.kind === "job" ? { kind: "job", key: f.key } : { kind: "task", key: f.key })}>
                <strong>{name(f) || "No client"}</strong> · {f.title}
              </button>
              <span className="muted" style={{ fontSize: 12 }}>finished {fmtDate(f.done, { weekday: true, year: false })}</span>
              {openKey !== f.key && <button type="button" className="btn small" onClick={() => setOpenKey(f.key)}>Add time</button>}
            </div>
            {openKey === f.key && <TimeEntry finished={f} compact onSaved={() => setOpenKey(undefined)} onCancel={() => setOpenKey(undefined)} />}
          </li>
        ))}
      </ul>
      {list.length > LIST_LIMIT && (
        <div style={{ padding: "0 16px 12px" }}>
          <button type="button" className="btn small" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${list.length}`}</button>
        </div>
      )}
    </section>
  );
}
