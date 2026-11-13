// The AML client tracker: every active client in one table, with their risk rating, when AML was last done, when the next review is due,
// and whether a review has been triggered. Review periods and triggers come from the AML policy (see lib/amlReview.ts).
import { useMemo, useState } from "react";
import { POSITION_LABEL, position, readAssessment, startAssessment } from "../lib/amlAssessment";
import { lastApprovedAt, raiseReview, readReviewPolicy, seenTriggers, triggerOf } from "../lib/amlReview";
import { idStampRead } from "../lib/xamaActions";
import { Screened, screening, screeningStatus } from "../lib/amlScreening";
import { idRecheckDue, idRefreshPolicy, screeningPolicy } from "../lib/amlPolicy";
import { storeFrom } from "../lib/amlPack";
import { useSeals } from "./sealKit";
import { reviewDateSuspect } from "../lib/amlReviewDate";
import { idCheckedOn } from "../lib/amlTimeline";
import { amlLabel, fmtDate, todayIso } from "../lib/domain";
import { readAml, readOnboardingSettings } from "../lib/onboarding";
import { Row } from "../lib/schema";
import { useData } from "./data";
import { href } from "./bits";
import { useSales } from "./salesKit";

type Item = {
  key: string; name: string; risk: string; doneOn: string; next: string; days: number | null; state: string; label: string; chip: string; suspect: boolean; row: Row;
  idOn: string; xid: { state: string; on: string }; xama: string; xamaWarn: boolean; trigger: string; due: string; late: boolean; seen: string; seenKind: string; period: string; needs: boolean; sort: string; scr: Screened; pep: boolean; hasCurrent: boolean; changed: boolean; idDue: string;
};
const RISK: Record<string, string> = { low: "Low", medium: "Medium", high: "High", "": "Not assessed" };
const FILTERS: [string, string][] = [["all", "All"], ["action", "Needs action"], ["triggered", "Triggered"], ["overdue", "Overdue"], ["soon", "Due soon"], ["screen", "Screening due"], ["none", "No assessment"], ["progress", "In progress"], ["current", "Up to date"]];

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function AmlClients() {
  const { data } = useData();
  const s = useSales();
  const today = todayIso();
  const policy = useMemo(() => readReviewPolicy(data.settings, readOnboardingSettings(data.settings).amlMonths), [data.settings]);
  const sp = useMemo(() => screeningPolicy(data.settings, policy), [data.settings, policy]);
  const seals = useSeals();
  const idp = useMemo(() => idRefreshPolicy(data.settings), [data.settings]);
  const register = useMemo(() => storeFrom(data.amlRecords, data.settings, "screening").records, [data.amlRecords, data.settings]);
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
      const scr = screening(cl, pos.risk, sp, data.amlAssessments, register, today);

      const state = trig ? "triggered" : pos.state;
      const idDue = (() => { const x = idStampRead(cl.XamaIdCheck); const on = [idCheckedOn(String(cl.Key), data.amlAssessments, data.onboardings), x.state === "done" ? x.on : ""].filter(Boolean).sort().pop() || ""; return idRecheckDue(on, pos.risk, idp); })();
      const needs = (!!idDue && idDue < today) || (!!pos.current && seals[String(pos.current.Key)] === "changed") || !!trig || seen.length > 0 || ["overdue", "soon", "none", "declined", "stopped"].includes(pos.state) || (pos.state !== "none" && (scr.days === null || scr.days < 0 || scr.match));
      const months = pos.risk ? policy[pos.risk as "low"] : 0;
      out.push({
        key: String(cl.Key), name: String(cl.Title || cl.Key), risk: pos.risk, doneOn: pos.doneOn, next: pos.reviewDate, days: pos.daysToReview, state, suspect: reviewDateSuspect(cl, pos.source), row: cl,
        label: trig ? "Review triggered" : POSITION_LABEL[pos.state], chip: late || pos.state === "overdue" || pos.state === "none" || pos.state === "declined" || pos.state === "stopped" ? "red" : trig || pos.state === "soon" || pos.state === "inprogress" || seen.length ? "amber" : "green",
        xama: amlLabel(String(cl.XamaStatus || "")).text, xamaWarn: amlLabel(String(cl.XamaStatus || "")).warn, idOn: idCheckedOn(String(cl.Key), data.amlAssessments, data.onboardings), xid: idStampRead(cl.XamaIdCheck), trigger: trig ? trig.label : "", due: trig?.due || "", late, seen: seen[0] ? `${seen[0].label} on ${fmtDate(seen[0].at)}` : "", seenKind: seen[0]?.kind || "", period: months ? `${months} months` : "",
        scr, idDue, hasCurrent: !!pos.current, changed: !!pos.current && seals[String(pos.current.Key)] === "changed", pep: [pos.current, pos.row].some((r) => r && readAssessment(r).pep.status === "yes"), needs, sort: `${late || pos.state === "overdue" ? "0" : pos.state === "none" || pos.state === "declined" ? "1" : trig || seen.length ? "2" : pos.state === "soon" ? "3" : pos.state === "inprogress" ? "4" : "5"}${pos.reviewDate || "9999"}${String(cl.Title)}`,
      });
    }
    return out.sort((a, b) => a.sort.localeCompare(b.sort));
  }, [data, policy, sp, register, today, seals, idp]);

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
    const head = ["Client", "Risk", "Status", "Last done", "ID last checked", "Xama", "Last screened", "Screening due", "Next review", "Review period", "Trigger", "Trigger due", "Change seen, no review opened"];
    const rows = shown.map((i) => [i.name, RISK[i.risk], i.label, i.doneOn, i.idOn || (i.xid.state === "done" ? i.xid.on : ""), i.xama, i.scr.on, i.scr.due, i.next, i.period, i.trigger, i.due, i.seen]);
    const text = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `AML-client-tracker-${today}.csv`; document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  return (
    <>
      <div className="page-head"><div><h1>Client AML tracker</h1><p className="muted tip" style={{ margin: "4px 0 0", maxWidth: 780 }}>Every active client's AML position in one place: risk rating, when it was last done, when the next review is due and whether a review has been triggered. Sanctions and PEP shows green when the client's screening is within your policy period, amber in the last 30 days before the re-screen is due, and red when it is overdue, has never been done or found a possible match. Review periods and triggers come from your policy's monitoring step.</p></div></div>
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
          {`Sanctions and PEP re-screening: high every ${sp.high} months, medium every ${sp.medium}, low every ${sp.low}${sp.fromPolicy ? " (from your policy)" : " (your review periods, until the policy's sanctions step sets them)"}${sp.monitor.length ? `, with ongoing monitoring for ${sp.monitor.join(" and ")}-risk clients` : ""}. `}{policy.fromPolicy ? `Policy: high every ${policy.high} months, medium every ${policy.medium}${policy.low ? `, low every ${policy.low}` : ""}. A triggered review is due within ${policy.triggerDays} days.` : "Your policy hasn't set review periods yet, so the Settings values are shown. Set them in the policy's monitoring step."}
        </p>
        {err && <div role="alert" className="warn">{err}</div>}
      </section>
      <section className="card pad" aria-label="Clients" style={{ overflowX: "auto" }}>
        {shown.length === 0 ? <p style={{ margin: 0 }}>No clients match.</p> : (
          <table className="table">
            <thead><tr><th scope="col">Client</th><th scope="col">Risk</th><th scope="col">Status</th><th scope="col">Last done</th><th scope="col">ID checked</th><th scope="col">Xama</th><th scope="col">Sanctions and PEP</th><th scope="col">Next review</th><th scope="col">Trigger</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.key}>
                  <th scope="row" style={{ fontWeight: 600 }}><a href={href("clients", i.key, "aml")}>{i.name}</a></th>
                  <td>{RISK[i.risk]}{i.pep && <span className="chip red" style={{ marginLeft: 6 }} title="Politically exposed person">PEP</span>}{i.changed && <span className="chip red" style={{ marginLeft: 6 }} title="The approved record was changed after approval (outside the planner). Check it and approve again.">Changed after approval</span>}{i.period && <div className="muted" style={{ fontSize: 12 }}>every {i.period}</div>}</td>
                  <td><span className={`chip ${i.chip}`}>{i.label}</span></td>
                  <td>{i.doneOn ? fmtDate(i.doneOn) : "—"}</td>
                  <td>{i.idDue && <div style={{ fontSize: 12, ...(i.idDue < today ? { color: "var(--red-ink, #b42318)", fontWeight: 600 } : { color: "var(--muted)" }) }}>{i.idDue < today ? `ID re-check overdue (${fmtDate(i.idDue)})` : `Re-check by ${fmtDate(i.idDue)}`}</div>}{i.idOn ? fmtDate(i.idOn) : i.xid.state === "done" && i.xid.on ? <>{fmtDate(i.xid.on)}<div className="muted" style={{ fontSize: 12 }}>via Xama</div></> : i.xid.state === "waiting" ? <span style={{ color: "var(--amber-ink)" }}>Asked in Xama, waiting</span> : i.xid.state === "check" ? <span style={{ color: "var(--amber-ink)" }}>Xama: check the result</span> : "—"}</td>
                  <td style={i.xamaWarn ? { color: "var(--amber-ink)" } : undefined}>{i.xama}</td>
                  <td>{(() => { const st = screeningStatus(i.scr, fmtDate); return <><span className={`chip ${st.tone}`}>{st.label}</span>{i.scr.on && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Screened {fmtDate(i.scr.on)} via {i.scr.via}</div>}{i.scr.due && <div style={{ fontSize: 12, color: st.tone === "red" ? "var(--red-ink, #b42318)" : st.tone === "amber" ? "var(--amber-ink)" : "var(--green)", fontWeight: 600 }}>{i.scr.days !== null && i.scr.days < 0 ? "Was due" : "Next due"} {fmtDate(i.scr.due)}</div>}</>; })()}
                  </td>
                  <td style={i.state === "overdue" ? { color: "var(--red-ink, #b42318)", fontWeight: 600 } : i.state === "current" && i.next ? { color: "var(--green)", fontWeight: 600 } : undefined}>{i.next ? fmtDate(i.next) : "—"}{i.days !== null && i.days < 0 ? <div style={{ fontSize: 12 }}>{-i.days} days overdue</div> : i.days !== null && i.days <= 60 ? <div className="muted" style={{ fontSize: 12 }}>in {i.days} days</div> : null}{i.suspect && <FixDate client={i.row} />}</td>
                  <td>{i.trigger ? <><strong>{i.trigger}</strong><div className={i.late ? "" : "muted"} style={{ fontSize: 12, ...(i.late ? { color: "var(--red-ink, #b42318)", fontWeight: 600 } : {}) }}>due {i.due ? fmtDate(i.due) : "—"}{i.late ? ", overdue" : ""}</div></> : i.seen ? <span style={{ color: "var(--amber-ink)" }}>{i.seen}. No review opened</span> : "—"}</td>
                  <td>{s.pcan("edit") && !i.trigger && i.hasCurrent && (i.seen || i.state === "overdue" || i.state === "soon") && <a className="btn small" href={`#/clients/${encodeURIComponent(i.key)}/aml?short=1`} style={{ marginRight: 6 }}>Short review</a>}{s.pcan("edit") && !i.trigger && (i.seen || i.state === "overdue" || i.state === "soon") && <button type="button" className="btn small" disabled={busy === i.key} onClick={() => void open(i)}>Full review</button>}</td>
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
    case "screen": return i.scr.match || i.scr.days === null || i.scr.days <= 30;
    case "none": return i.state === "none" || i.state === "declined" || i.state === "stopped";
    case "progress": return i.state === "inprogress";
    case "current": return i.state === "current";
    default: return true;
  }
}

/** A review date that matches Xama's own assessment date was probably overwritten by a Xama refresh before V20.1: put the right one back. */
function FixDate({ client }: { client: Row }) {
  const { update } = useData();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState("");
  const [err, setErr] = useState("");
  return (
    <div style={{ fontSize: 12, color: "var(--amber-ink)", fontWeight: 400 }}>
      This is Xama's assessment date, so it may have been overwritten. {!open ? <button type="button" className="linkbtn" onClick={() => setOpen(true)}>Correct it</button> : (
        <span className="row-wrap" style={{ gap: 4, marginTop: 4 }}>
          <input type="date" className="input" aria-label="Correct next review date" value={d} onChange={(e) => setD(e.target.value)} />
          <button type="button" className="btn small primary" disabled={!d} onClick={() => void update("Clients", client, { AMLReview: d }).then(() => setOpen(false)).catch(() => setErr("Couldn't save."))}>Save</button>
          <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Cancel</button>{err && <span role="alert">{err}</span>}
        </span>
      )}
    </div>
  );
}
