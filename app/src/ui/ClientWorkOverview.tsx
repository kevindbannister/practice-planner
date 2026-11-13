// At the top of a client: what needs doing, what is being worked on, what the client has to do, what is waiting, blocked, overdue and ready. Jobs and tasks are counted apart.
import { useMemo, useState } from "react";
import { Counts, Item, counts } from "../lib/work/overview";
import { useWorkItems } from "./overviewKit";
import { WorkList } from "./WorkList";

type K = keyof Counts;
const INDICATORS: { key: K; label: string; test: (i: Item) => boolean }[] = [
  { key: "todo", label: "To do", test: (i) => i.state !== "done" && i.state !== "in_progress" },
  { key: "inProgress", label: "In progress", test: (i) => i.state === "in_progress" },
  { key: "waitingClient", label: "Waiting on client", test: (i) => i.waitingClient },
  { key: "blocked", label: "Blocked", test: (i) => i.state === "blocked" },
  { key: "overdue", label: "Overdue", test: (i) => i.overdue },
  { key: "ready", label: "Ready to work", test: (i) => i.state === "ready" || i.state === "in_progress" },
  { key: "completed", label: "Completed (30 days)", test: (i) => i.state === "done" },
];
const daysAgo = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

export function ClientWorkOverview({ clientKey }: { clientKey: string }) {
  const w = useWorkItems(); const [pick, setPick] = useState<K | "">(""); const [kind, setKind] = useState<"" | "job" | "task">("");
  const mine = useMemo(() => w.items.filter((i) => i.clientKey === clientKey), [w.items, clientKey]);
  const period = { from: daysAgo(w.today, 30), to: w.today };
  const c = useMemo(() => counts(mine, period), [mine, w.today]);
  if (!mine.length) return null;
  const ind = INDICATORS.find((x) => x.key === pick);
  const recent = (i: Item) => i.completedOn >= period.from && i.completedOn <= period.to;
  const list = mine.filter((i) => (!kind || i.kind === kind) && (ind ? ind.test(i) && (pick !== "completed" || recent(i)) : i.state !== "done")).sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
  return (
    <section className="card pad stack" aria-label="Work overview" style={{ gap: 8 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0, fontSize: 17 }}>Work overview</h2><span className="muted" style={{ fontSize: 13 }}>Jobs and tasks are counted separately.</span></div>
      <div style={{ overflowX: "auto" }}><table className="table" style={{ minWidth: 520 }}>
        <thead><tr><th scope="col" style={{ textAlign: "left" }}> </th>{INDICATORS.map((x) => <th key={x.key} scope="col" style={{ textAlign: "right" }}>{x.label}</th>)}</tr></thead>
        <tbody>{(["job", "task"] as const).map((k) => <tr key={k}><th scope="row" style={{ textAlign: "left" }}>{k === "job" ? "Jobs" : "Tasks"}</th>{INDICATORS.map((x) => { const n = (k === "job" ? c.jobs : c.tasks)[x.key]; const on = pick === x.key && kind === k; return <td key={x.key} style={{ textAlign: "right" }}><button type="button" className="linkbtn" aria-pressed={on} disabled={!n} style={{ fontWeight: on ? 700 : 400 }} onClick={() => { setPick(on ? "" : x.key); setKind(on ? "" : k); }}>{n}</button></td>; })}</tr>)}</tbody>
      </table></div>
      <div className="row-wrap" style={{ gap: 6 }}><strong style={{ fontSize: 15 }}>{ind ? `${ind.label}${kind ? ` (${kind}s)` : ""}` : "All open work"}</strong>{pick && <button type="button" className="linkbtn" onClick={() => { setPick(""); setKind(""); }}>Show all open</button>}</div>
      <WorkList items={list} />
    </section>
  );
}
