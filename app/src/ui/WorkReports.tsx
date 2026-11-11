// Reports on tasks, client actions, dependencies, planning reliability and workload. Each figure says whether it is a fact, an estimate or a projection.
import { useMemo, useState } from "react";
import { Row } from "../lib/schema";
import { dayHours } from "../lib/dayTypes";
import { BASIS_NOTE, Group, Metric, Period, clientActions, dependencies, planningReliability, taskCompletion, taskCompletionByArea, workload } from "../lib/work/reports";
import { PlanTabs } from "./bits";
import { useData } from "./data";
import { useWorkItems } from "./overviewKit";
import { useRisk } from "./riskKit";
import { usePlanning } from "./usePlanning";
import { useWorkSignals } from "./workKit";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addD = (x: string, n: number) => iso(new Date(new Date(`${x}T00:00:00Z`).getTime() + n * 86400000));
const fmt = (m: Metric) => (m.unit === "percent" ? `${m.value}%` : m.unit === "hours" ? `${m.value}h` : m.unit === "days" ? (m.value ? `${m.value} days` : "–") : String(m.value));
const BADGE: Record<string, string> = { fact: "Fact", estimate: "Estimate", projection: "Projection" };

export function WorkReports() {
  const { data, settings } = useData(); const w = useWorkItems(); const risk = useRisk(); const sig = useWorkSignals(); const planning = usePlanning();
  const today = w.today;
  const [preset, setPreset] = useState<"30" | "month" | "last">("30");
  const period: Period = useMemo(() => {
    if (preset === "30") return { from: addD(today, -29), to: today };
    const first = `${today.slice(0, 7)}-01`;
    if (preset === "month") return { from: first, to: today };
    const lastEnd = addD(first, -1); return { from: `${lastEnd.slice(0, 7)}-01`, to: lastEnd };
  }, [preset, today]);
  const userName = (k: string) => k || "Unassigned";
  const groups: Group[] = useMemo(() => {
    const days = Array.from({ length: 28 }, (_, i) => addD(today, i));
    return [
      taskCompletion(sig.tasks, period, today, userName), clientActions(sig.tasks, sig.events, period, today),
      dependencies({ deps: sig.deps, depEvents: sig.depEvents, items: w.items, titleOf: (kind, key) => (kind === "task" ? risk.world.tasks.get(key)?.title : risk.world.jobs.get(key)?.title) || "Something removed" }, period),
      planningReliability(planning.sessions, period, today),
      workload({ items: w.items, sessions: planning.sessions, capacityPerDay: (d) => dayHours(d, settings).total, days, today, clientName: w.clientName, userName, service: (i) => (i.kind === "job" ? String((data.services as Row[]).find((s) => s.Key === i.serviceKey)?.Title || "") : "") }),
    ];
  }, [sig, w, planning.sessions, period, today, risk.world, settings, data.services]); // eslint-disable-line react-hooks/exhaustive-deps
  const byArea = useMemo(() => taskCompletionByArea(sig.tasks, period), [sig.tasks, period]);
  return (
    <div className="page">
      <PlanTabs current="reports" />
      <div className="page-head"><div><h1>Work reports</h1><p className="muted" style={{ margin: "4px 0 0" }}>Tasks, client actions, dependencies, planning and workload. Personal tasks are never included. Every figure is marked as a fact (counted from records), an estimate (from estimated hours) or a projection (what the current dates imply).</p></div></div>
      <div className="card pad row-wrap" style={{ gap: 6 }} role="group" aria-label="Period">
        {([["30", "Last 30 days"], ["month", "This month"], ["last", "Last month"]] as const).map(([k, l]) => <button key={k} type="button" className={`btn small${preset === k ? " primary" : ""}`} aria-pressed={preset === k} onClick={() => setPreset(k)}>{l}</button>)}
        <span className="muted">{period.from} to {period.to}. Workload looks four weeks ahead.</span>
      </div>
      {groups.map((g) => (
        <section key={g.key} className="card pad stack" aria-labelledby={`wr-${g.key}`}>
          <h2 id={`wr-${g.key}`} style={{ margin: 0, fontSize: 16 }}>{g.title}</h2>
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12, margin: 0 }}>
            {g.metrics.map((m) => (
              <div key={m.key}>
                <dt className="muted" style={{ fontSize: 12 }}>{m.label}</dt>
                <dd style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{fmt(m)} <span className="chip" title={BASIS_NOTE[m.basis]} style={{ fontSize: 11, fontWeight: 400 }}>{BADGE[m.basis]}</span></dd>
                {(m.note || m.unknown) ? <dd className="muted" style={{ margin: 0, fontSize: 12 }}>{m.note}{m.unknown ? `${m.note ? ". " : ""}${m.unknown} left out (can't be worked out).` : ""}</dd> : null}
              </div>
            ))}
          </dl>
          {g.rows && g.rows.length > 0 && (
            <table className="table" style={{ width: "100%" }}><caption className="sr-only">{g.title} breakdown</caption>
              <thead><tr><th scope="col">{g.key === "tasks" ? "Person" : "Item"}</th>{Object.keys(g.rows[0].values).map((c) => <th key={c} scope="col" style={{ textAlign: "right" }}>{c.replace(/_/g, " ")}</th>)}</tr></thead>
              <tbody>{g.rows.map((r) => <tr key={r.label}><th scope="row" style={{ fontWeight: 400, textAlign: "left" }}>{r.label}</th>{Object.keys(g.rows![0].values).map((c) => <td key={c} style={{ textAlign: "right" }}>{r.values[c] ?? ""}</td>)}</tr>)}</tbody></table>
          )}
          {g.key === "tasks" && byArea.length > 0 && <p className="muted" style={{ margin: 0 }}>By area: {byArea.map((a) => `${a.label} ${a.completed} done of ${a.created} created`).join(" · ")}.</p>}
        </section>
      ))}
    </div>
  );
}
