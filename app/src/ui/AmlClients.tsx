// The AML client tracker: every active client in one table, with their risk rating, when AML was last done, when the next review is due,
// and whether a review has been triggered. Review periods and triggers come from the AML policy (see lib/amlReview.ts).
import { useMemo, useState } from "react";
import { POSITION_LABEL, position, startAssessment } from "../lib/amlAssessment";
import { lastApprovedAt, raiseReview, readReviewPolicy, seenTriggers, triggerOf } from "../lib/amlReview";
import { idCheckedOn } from "../lib/amlTimeline";
import { amlLabel, fmtDate, todayIso } from "../lib/domain";
import { readAml, readOnboardingSettings } from "../lib/onboarding";
import { Row } from "../lib/schema";
import { useData } from "./data";
import { href } from "./bits";
import { useSales } from "./salesKit";

type Item = {
  key: string; name: string; risk: string; doneOn: string; next: string; days: number | null; state: string; label: string; chip: string;
  idOn: string; xama: string; xamaWarn: boolean; trigger: string; due: string; late: boolean; seen: string; seenKind: string; period: string; needs: boolean; sort: string;
};
const RISK: Record<string, string> = { low: "Low", medium: "Medium", high: "High", "": "Not assessed" };
const FILTERS: [string, string][] = [["all", "All"], ["action", "Needs action"], ["triggered", "Triggered"], ["overdue", "Overdue"], ["soon", "Due soon"], ["none", "No assessment"], ["progress", "In progress"], ["current", "Up to date"]];

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function AmlClients() {
  const { data } = useData();
  const s = useSales();
  const today = todayIso();
  const policy = useMemo(() => readReviewPolicy(data.settings, readOnboardingSettings(data.settings).amlMonths), [data.settings]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("action");
  const [risk, setRisk] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    for (const cl of (data.clients as Row[]).filter((c) => !c.CeasedOn)) {
      const pos = position(cl, data.amlAssessments, data.onboardings, today);
      const trig = triggerOf(pos.row);
      const seen = trig ? [] : seenTriggers(cl, data as never, policy, lastApprovedAt(cl, data.amlAssessments, data.onboardings, readAml));
      const late = !!(trig && trig.due && trig.due < today);
      const state = trig ? "triggered" : pos.state;
      const needs = !!trig || seen.length > 0 || ["overdue", "soon", "none", "declined"].includes(pos.state);
      const months = pos.risk ? policy[pos.risk as "low"] : 0;
      out.push({
        key: String(cl.Key), name: String(cl.Title || cl.Key), risk: pos.risk, doneOn: pos.doneOn, next: pos.reviewDate, days: pos.daysToReview, state,
        label: trig ? "Review triggered" : POSITION_LABEL[pos.state], chip: late || pos.state === "overdue" || pos.state === "none" || pos.state === "declined" ? "red" : trig || pos.state === "soon" || pos.state === "inprogress" || seen.length ? "amber" : "green",
        xama: amlLabel(String(cl.XamaStatus || "")).text, xamaWarn: amlLabel(String(cl.XamaStatus || "")).warn, idOn: idCheckedOn(String(cl.Key), data.amlAssessments, data.onboardings), trigger: trig ? trig.label : "", due: trig?.due || "", late, seen: seen[0] ? `${seen[0].label} on ${fmtDate(seen[0].at)}` : "", seenKind: seen[0]?.kind || "", period: months ? `${months} months` : "",
        needs, sort: `${late || pos.state === "overdue" ? "0" : pos.state === "none" || pos.state === "declined" ? "1" : trig || seen.length ? "2" : pos.state === "soon" ? "3" : pos.state === "inprogress" ? "4" : "5"}${pos.reviewDate || "9999"}${String(cl.Title)}`,
      });
    }
    return out.sort((a, b) => a.sort.localeCompare(b.sort));
  }, [data, policy, today]);

  const count = (f: string) => items.filter((i) => match(i, f)).length;
  const shown = items.filter((i) => match(i, filter) && (!risk || i.risk === risk) && (!q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase())));

  const clientRow = (k: string) => data.clients.find((c) => c.Key === k) as unknown as Row;
  const run = async (key: string, w: ReturnType<typeof startAssessment>) => {
    setErr("");
    if ("error" in w) return setErr(w.error);
    setBusy(key);
    try { await s.apply(w); } catch { setErr("Couldn't save that. Try again."); } finally { setBusy(""); }
  };
  const open = (i: Item) => (i.seenKind ? run(i.key, raiseReview(clientRow(i.key), data.amlAssessments, i.seenKind, i.seen, policy.triggerDays, today, s.pcan as never, s.ctx())) : run(i.key, startAssessment(clientRow(i.key), data.amlAssessments, s.ctx())));

  const csv = () => {
    const head = ["Client", "Risk", "Status", "Last done", "ID last checked", "Xama", "Next review", "Review period", "Trigger", "Trigger due", "Change seen, no review opened"];
    const rows = shown.map((i) => [i.name, RISK[i.risk], i.label, i.doneOn, i.idOn, i.xama, i.next, i.period, i.trigger, i.due, i.seen]);
    const text = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `AML-client-tracker-${today}.csv`; document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  return (
    <>
      <div className="page-head"><div><h1>Client AML tracker</h1><p className="muted" style={{ margin: "4px 0 0", maxWidth: 780 }}>Every active client's AML position in one place: risk rating, when it was last done, when the next review is due and whether a review has been triggered. Review periods and triggers come from your policy's monitoring step.</p></div></div>
      <section className="card pad stack" aria-label="Filters">
        <div className="row-wrap no-print" role="group" aria-label="Show" style={{ gap: 8 }}>
          {FILTERS.map(([k, l]) => <button key={k} type="button" className={`btn small${filter === k ? " primary" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l} ({count(k)})</button>)}
        </div>
        <div className="row-wrap" style={{ gap: 10, alignItems: "end" }}>
          <label className="field"><span>Search clients</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <label className="field"><span>Risk</span><select className="input" value={risk} onChange={(e) => setRisk(e.target.value)}><option value="">All</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="none">Not assessed</option></select></label>
          <button type="button" className="btn small" onClick={csv}>Download as CSV</button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {policy.fromPolicy ? `Policy: high every ${policy.high} months, medium every ${policy.medium}${policy.low ? `, low every ${policy.low}` : ""}. A triggered review is due within ${policy.triggerDays} days.` : "Your policy hasn't set review periods yet, so the Settings values are shown. Set them in the policy's monitoring step."}
        </p>
        {err && <div role="alert" className="warn">{err}</div>}
      </section>
      <section className="card pad" aria-label="Clients" style={{ overflowX: "auto" }}>
        {shown.length === 0 ? <p style={{ margin: 0 }}>No clients match.</p> : (
          <table className="table">
            <thead><tr><th scope="col">Client</th><th scope="col">Risk</th><th scope="col">Status</th><th scope="col">Last done</th><th scope="col">ID checked</th><th scope="col">Xama</th><th scope="col">Next review</th><th scope="col">Trigger</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.key}>
                  <th scope="row" style={{ fontWeight: 600 }}><a href={href("clients", i.key, "aml")}>{i.name}</a></th>
                  <td>{RISK[i.risk]}{i.period && <div className="muted" style={{ fontSize: 12 }}>every {i.period}</div>}</td>
                  <td><span className={`chip ${i.chip}`}>{i.label}</span></td>
                  <td>{i.doneOn ? fmtDate(i.doneOn) : "—"}</td>
                  <td>{i.idOn ? fmtDate(i.idOn) : "—"}</td>
                  <td style={i.xamaWarn ? { color: "var(--amber-ink)" } : undefined}>{i.xama}</td>
                  <td style={i.state === "overdue" ? { color: "var(--red-ink, #b42318)", fontWeight: 600 } : undefined}>{i.next ? fmtDate(i.next) : "—"}{i.days !== null && i.days < 0 ? <div style={{ fontSize: 12 }}>{-i.days} days overdue</div> : i.days !== null && i.days <= 60 ? <div className="muted" style={{ fontSize: 12 }}>in {i.days} days</div> : null}</td>
                  <td>{i.trigger ? <><strong>{i.trigger}</strong><div className={i.late ? "" : "muted"} style={{ fontSize: 12, ...(i.late ? { color: "var(--red-ink, #b42318)", fontWeight: 600 } : {}) }}>due {i.due ? fmtDate(i.due) : "—"}{i.late ? ", overdue" : ""}</div></> : i.seen ? <span style={{ color: "var(--amber-ink)" }}>{i.seen}. No review opened</span> : "—"}</td>
                  <td>{s.pcan("edit") && !i.trigger && (i.seen || i.state === "overdue" || i.state === "soon") && <button type="button" className="btn small" disabled={busy === i.key} onClick={() => void open(i)}>Open a review</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function match(i: Item, f: string): boolean {
  switch (f) {
    case "all": return true;
    case "action": return i.needs;
    case "triggered": return i.state === "triggered" || !!i.seen;
    case "overdue": return i.state === "overdue" || i.late;
    case "soon": return i.state === "soon";
    case "none": return i.state === "none" || i.state === "declined";
    case "progress": return i.state === "inprogress";
    case "current": return i.state === "current";
    default: return true;
  }
}
