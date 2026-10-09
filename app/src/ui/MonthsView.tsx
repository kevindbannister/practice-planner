// Months ahead: hours of work due each month against the hours you have, so busy spells
// (like January's Self Assessment) show early enough to move work earlier.
import { useMemo, useState } from "react";
import { fmtDate, fmtHours, todayIso } from "../lib/domain";
import { ForecastItem, Month, forecast } from "../lib/forecast";
import { PlanTabs } from "./bits";
import { useData, useIndex } from "./data";
import { useEditor } from "./Editors";

const monthName = (key: string, long = false) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: long ? "long" : "short", year: "numeric", timeZone: "UTC" });

export function MonthsView() {
  const { data, settings } = useData();
  const idx = useIndex();
  const today = todayIso();
  const [count, setCount] = useState(12);
  const [openKey, setOpenKey] = useState<string>();
  const f = useMemo(() => forecast(data.jobs, data.tasks, data.services, settings.hours, today, count), [data.jobs, data.tasks, data.services, settings.hours, today, count]);

  const scale = Math.max(1, ...f.months.map((m) => Math.max(m.capacity, m.due)));
  const over = f.months.filter((m) => m.due > m.capacity);
  const busiest = [...f.months].sort((a, b) => b.due / Math.max(1, b.capacity) - a.due / Math.max(1, a.capacity))[0];
  const next3 = f.months.slice(0, 3);
  const next3Due = next3.reduce((t, m) => t + m.due, 0) + f.lateHours;
  const next3Cap = next3.reduce((t, m) => t + m.capacity, 0);
  // the first month where everything due so far can't fit in the time available so far
  const behind = f.months.find((m) => m.cumulativeDue > m.cumulativeCapacity);

  return (
    <div className="page">
      <PlanTabs current="months" />
      <div className="tiles" style={{ maxWidth: 900 }}>
        <div className={`tile${next3Due > next3Cap ? " red" : ""}`}>
          <div className="label">Next 3 months: due / available</div>
          <div className="value">{fmtHours(next3Due) || "0h"} <span className="muted" style={{ fontSize: 13 }}>/ {fmtHours(next3Cap)}</span></div>
        </div>
        <div className={`tile${over.length ? " amber" : ""}`}>
          <div className="label">Months over capacity</div>
          <div className="value">{over.length ? over.map((m) => monthName(m.key).split(" ")[0]).join(", ") : "None"}</div>
        </div>
        {busiest && (
          <div className="tile">
            <div className="label">Busiest month</div>
            <div className="value">{monthName(busiest.key)} <span className="muted" style={{ fontSize: 13 }}>{Math.round((busiest.due / Math.max(1, busiest.capacity)) * 100)}%</span></div>
          </div>
        )}
        <div className={`tile${f.lateHours ? " red" : ""}`}>
          <div className="label">Already late</div>
          <div className="value">{fmtHours(f.lateHours) || "0h"} <span className="muted" style={{ fontSize: 13 }}>{f.late.filter((i) => !i.held).length} items</span></div>
        </div>
      </div>

      {behind && (
        <div className="alert amber" role="note">
          <strong>Work is stacking up by {monthName(behind.key, true)}</strong>
          <span>
            {fmtHours(behind.cumulativeDue)} is due by the end of {monthName(behind.key, true)}, and you have {fmtHours(behind.cumulativeCapacity)} between
            now and then. Planning some of it earlier, while there's room, keeps you ahead.
          </span>
        </div>
      )}

      <section className="card" aria-labelledby="months-h">
        <div className="card-head">
          <h2 id="months-h">Hours due each month</h2>
          <div className="row-wrap" style={{ gap: 12 }}>
            <span className="legend-key"><i className="k-planned" />Planned</span>
            <span className="legend-key"><i className="k-due" />Not planned yet</span>
            <span className="legend-key"><i className="k-expected" />Next periods (not created yet)</span>
            <span className="legend-key"><i className="k-cap" />Your hours</span>
            <label>
              <span className="sr-only">How far ahead</span>
              <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ minHeight: 36, padding: "4px 8px", width: "auto", fontSize: 13 }}>
                <option value={6}>6 months</option>
                <option value={12}>12 months</option>
                <option value={18}>18 months</option>
              </select>
            </label>
          </div>
        </div>
        <ul className="months">
          {f.late.length > 0 && (
            <MonthRow
              label="Already late" sub={`before ${fmtDate(today, { year: false })}`} month={null} items={f.late} due={f.lateHours} planned={f.late.filter((i) => i.planned && !i.held).reduce((t, i) => t + i.hours, 0)}
              expected={0} capacity={0} scale={scale} open={openKey === "late"} onToggle={() => setOpenKey(openKey === "late" ? undefined : "late")} clientName={(k) => idx.clientByKey.get(k || "")?.Title || ""}
            />
          )}
          {f.months.map((m) => (
            <MonthRow
              key={m.key} label={monthName(m.key)} sub={m.start !== `${m.key}-01` ? `from ${fmtDate(m.start, { year: false })}` : ""} month={m} items={m.items}
              due={m.due} planned={m.planned} expected={m.expected} capacity={m.capacity} scale={scale}
              open={openKey === m.key} onToggle={() => setOpenKey(openKey === m.key ? undefined : m.key)} clientName={(k) => idx.clientByKey.get(k || "")?.Title || ""}
            />
          ))}
        </ul>
      </section>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Work counts in the month it's due, using your hours for each job. Next periods come from each type of work's repeat rule. On-hold
        work is listed but not counted. Your hours come from Settings › Your week (bank holidays aren't taken off).
      </p>
    </div>
  );
}

function MonthRow(p: {
  label: string; sub: string; month: Month | null; items: ForecastItem[]; due: number; planned: number; expected: number;
  capacity: number; scale: number; open: boolean; onToggle: () => void; clientName: (k?: string) => string;
}) {
  const { open } = useEditor();
  const over = p.month ? p.due > p.capacity : p.due > 0;
  const pct = (h: number) => `${(h / p.scale) * 100}%`;
  const notPlanned = Math.max(0, p.due - p.planned - p.expected);
  const id = `m-${p.month?.key || "late"}`;
  return (
    <li className={`month${over ? " over" : ""}`}>
      <button type="button" className="month-row" aria-expanded={p.open} aria-controls={id} onClick={p.onToggle}>
        <span className="month-label">
          <strong>{p.label}</strong>
          {p.sub && <span className="muted" style={{ fontSize: 12 }}>{p.sub}</span>}
        </span>
        <span className="month-bar" aria-hidden="true">
          <span className="seg-planned" style={{ width: pct(p.planned) }} />
          <span className="seg-due" style={{ width: pct(notPlanned) }} />
          <span className="seg-expected" style={{ width: pct(p.expected) }} />
          {p.month && <span className="cap-mark" style={{ left: pct(p.capacity) }} />}
        </span>
        <span className="month-nums">
          <span className="mono">{fmtHours(p.due) || "0h"}{p.month ? ` / ${fmtHours(p.capacity)}` : ""}</span>
          {p.month ? (
            over ? <span className="chip red">{fmtHours(p.due - p.capacity)} over</span> : <span className="muted" style={{ fontSize: 12 }}>{fmtHours(p.capacity - p.due)} spare</span>
          ) : <span className="chip red">late</span>}
        </span>
      </button>
      {p.open && (
        <div id={id} className="month-items">
          {p.items.length ? (
            <table className="grid">
              <thead><tr><th scope="col">Due</th><th scope="col">Client</th><th scope="col">Work</th><th scope="col">Hours</th><th scope="col">Planned</th></tr></thead>
              <tbody>
                {p.items.map((i) => (
                  <tr key={i.key} className={i.kind === "expected" ? "expected" : "clickable"}
                    onClick={i.kind === "expected" ? undefined : () => open(i.kind === "job" ? { kind: "job", key: i.key } : { kind: "task", key: i.key })}>
                    <td className="mono">{fmtDate(i.deadline, { year: false })}</td>
                    <td>{p.clientName(i.clientKey) || "—"}</td>
                    <td>
                      {i.kind === "expected" ? <span className="muted">Next: </span> : null}
                      {i.title}{i.periodEnd ? <span className="muted"> · to {fmtDate(i.periodEnd, { year: false })}</span> : null}
                      {i.held && <span className="chip hold" style={{ marginLeft: 6 }}>On hold</span>}
                    </td>
                    <td className="mono">{fmtHours(i.hours)}</td>
                    <td>{i.kind === "expected" ? <span className="muted">not created yet</span> : i.planned ? fmtDate(i.planned, { weekday: true, year: false }) : <span style={{ color: "var(--amber-ink)" }}>Not planned</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted" style={{ margin: 0, padding: 12 }}>Nothing due.</p>}
        </div>
      )}
    </li>
  );
}
