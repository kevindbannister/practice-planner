// Billing recorded time: what is unbilled, what is on an invoice being made, what has been billed or given up. Time on a job with a fixed fee is not
// here (the fee covers it). Everything is logged in the time log with who, when and why; nothing is deleted, and time can't be billed twice.
import { useMemo, useState } from "react";
import { fmtDate, fmtHours, todayIso } from "../lib/domain";
import { penceToPounds } from "../lib/rates";
import { BILL_LABEL, BillState, Rec, billingReview, billingTotals, chargeValue, markBilled, markPending, release, writeDown, writeOff } from "../lib/timeBilling";
import { entryMinutes } from "../lib/timesheet";
import { downloadFile } from "./commsKit";
import { pounds, toCsv, hoursText } from "../lib/timeReports";
import { TimeFinance as Model, useApply } from "./useTimeFinance";

export function TimeBilling({ m }: { m: Model }) {
  const { run, busy, note } = useApply();
  const today = todayIso();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(today);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState("");
  const [reason, setReason] = useState("");
  const [ref, setRef] = useState("");
  const [down, setDown] = useState({ key: "", amount: "", why: "" });
  const lines = useMemo(() => billingReview(m.recs, m.ctx, from, to), [m.recs, m.ctx, from, to]);
  const totals = useMemo(() => billingTotals(m.recs, m.ctx), [m.recs, m.ctx]);
  const pending = useMemo(() => m.recs.filter((e) => e.bill === "pending"), [m.recs]);
  const chosen = lines.flatMap((l) => l.entries).filter((e) => pick.has(e.key));
  const toggle = (keys: string[], on: boolean) => setPick((p) => { const n = new Set(p); keys.forEach((k) => (on ? n.add(k) : n.delete(k))); return n; });
  const missing = lines.reduce((t, l) => t + l.missingRate, 0);
  const sum = (es: Rec[]) => es.reduce((t, e) => t + chargeValue(e, m.ctx).pence, 0);
  const exportCsv = () => downloadFile(new TextEncoder().encode("﻿" + toCsv([["Client", "Job", "Day", "Person", "Time (hours)", "Value (£)", "Status"], ...lines.flatMap((l) => l.entries.map((e) => [m.client(e.clientKey), m.jobTitle(e.jobKey), e.workDate, m.who(e.by), Number(hoursText(entryMinutes(e, m.ctx.now))), Number(pounds(chargeValue(e, m.ctx).pence)), BILL_LABEL[e.bill]]))])), `Unbilled time to ${to}.csv`, "text/csv;charset=utf-8");
  return (
    <>
      <section className="card pad stack" aria-labelledby="bt-h">
        <h2 id="bt-h">Where time stands</h2>
        <div className="row-wrap" style={{ gap: 16 }}>
          {(["unbilled", "pending", "billed", "written_down", "written_off"] as BillState[]).map((s) => (
            <div key={s}><div className="muted" style={{ fontSize: 12 }}>{BILL_LABEL[s]}</div><strong>{penceToPounds(totals[s].pence)}</strong> <span className="muted" style={{ fontSize: 12 }}>{fmtHours(totals[s].minutes / 60) || "0h"}</span></div>
          ))}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Net of VAT, at the charge-out rates. Written off shows what was given up. Only time on jobs without a fixed fee, and marked billable, is billed by the hour.</p>
      </section>

      {note && <div className={`alert${note.bad ? " red" : ""}`} role="status"><strong>{note.text}</strong></div>}

      <section className="card pad stack" aria-labelledby="ur-h">
        <div className="card-title-row"><h2 id="ur-h">Unbilled time</h2><button type="button" className="btn small" disabled={!lines.length} onClick={exportCsv}>Download CSV</button></div>
        <div className="row-wrap">
          <label className="field"><span>From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field"><span>To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {missing > 0 && <div className="alert" role="status">{missing} entries have no charge-out rate, so they show as £0.00. Add a rate under Rates.</div>}
        {lines.length === 0 ? <p className="muted" style={{ margin: 0 }}>No unbilled time for these dates.</p> : (
          <div className="stack" style={{ gap: 8 }}>
            {lines.map((l) => {
              const keys = l.entries.map((e) => e.key), all = keys.every((k) => pick.has(k)), id = `${l.clientKey}|${l.jobKey}`;
              return (
                <div key={id} className="card pad stack" style={{ gap: 6 }}>
                  <div className="row-wrap" style={{ justifyContent: "space-between" }}>
                    <label className="row-wrap"><input type="checkbox" checked={all} onChange={(e) => toggle(keys, e.target.checked)} /> <strong>{m.client(l.clientKey)}</strong> · {m.jobTitle(l.jobKey)}</label>
                    <span>{fmtHours(l.minutes / 60)} · <strong>{penceToPounds(l.pence)}</strong>{l.gross !== l.pence && <span className="muted"> (was {penceToPounds(l.gross)})</span>} <button type="button" className="btn small" aria-expanded={open === id} onClick={() => setOpen(open === id ? "" : id)}>{open === id ? "Hide" : "Entries"}</button></span>
                  </div>
                  {open === id && l.entries.map((e) => (
                    <div key={e.key} className="row-wrap" style={{ justifyContent: "space-between", fontSize: 13 }}>
                      <label className="row-wrap"><input type="checkbox" checked={pick.has(e.key)} onChange={(ev) => toggle([e.key], ev.target.checked)} /> {fmtDate(e.workDate, { year: false })} · {m.who(e.by)} · {fmtHours(entryMinutes(e, m.ctx.now) / 60)}</label>
                      <span>{penceToPounds(chargeValue(e, m.ctx).pence)} {down.key === e.key ? (
                        <span className="row-wrap">
                          <input aria-label="Amount to write down in pounds" inputMode="decimal" placeholder="£" style={{ width: 70 }} value={down.amount} onChange={(ev) => setDown({ ...down, amount: ev.target.value })} />
                          <input aria-label="Why" placeholder="Why" value={down.why} onChange={(ev) => setDown({ ...down, why: ev.target.value })} />
                          <button type="button" className="btn small" disabled={busy} onClick={() => void run((k) => writeDown(e, Math.round(Number(down.amount) * 100), down.why, m.ctx, k), "Written down.").then(() => setDown({ key: "", amount: "", why: "" }))}>Write down</button>
                        </span>
                      ) : <button type="button" className="btn small" onClick={() => setDown({ key: e.key, amount: "", why: "" })}>Write down…</button>}</span>
                    </div>
                  ))}
                </div>
              );
            })}
            <div className="row-wrap" style={{ justifyContent: "space-between" }}>
              <span>{chosen.length} selected · {penceToPounds(sum(chosen))}</span>
              <span className="row-wrap">
                <button type="button" className="btn small primary" disabled={busy || !chosen.length} onClick={() => void run((k) => markPending(chosen, m.ctx, k), "Marked as on an invoice being made.").then(() => setPick(new Set()))}>Put on an invoice</button>
                <input aria-label="Reason for writing off" placeholder="Reason for write-off" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button type="button" className="btn small" disabled={busy || !chosen.length} onClick={() => { if (window.confirm(`Write off ${penceToPounds(sum(chosen))} of time? It stays on record but won't be billed.`)) void run((k) => writeOff(chosen, reason, k), "Written off.").then(() => { setPick(new Set()); setReason(""); }); }}>Write off</button>
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="card pad stack" aria-labelledby="pd-h">
        <h2 id="pd-h">On an invoice being made</h2>
        {pending.length === 0 ? <p className="muted" style={{ margin: 0 }}>None. Put time on an invoice above, make the invoice, then record its number here.</p> : (
          <>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{pending.length} entries worth {penceToPounds(sum(pending))}. They can't be put on another invoice while they wait here.</p>
            <div className="row-wrap">
              <input aria-label="Invoice number" placeholder="Invoice number" value={ref} onChange={(e) => setRef(e.target.value)} />
              <button type="button" className="btn small primary" disabled={busy} onClick={() => void run((k) => markBilled(pending, ref, k), "Marked as billed.").then(() => setRef(""))}>Mark all as billed</button>
              <button type="button" className="btn small" disabled={busy} onClick={() => void run((k) => release(pending, k, "Invoice not made"), "Taken off.")}>Take them all off</button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
