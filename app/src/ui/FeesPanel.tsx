// Fees (Phase 5): the fee schedule on a client's page, their direct costs and estimated contribution, and the practice's
// revenue overview. All figures are CONTRACTED fees (agreed), net of VAT: not invoiced and not cash received.
import { useMemo, useState } from "react";
import { fmtDate, todayIso } from "../lib/domain";
import { readAgreed } from "../lib/engagements";
import {
  COST_KINDS, CostKind, FEE_STATUS_LABEL, FeeLine, PERIOD_OPTIONS, VAT_OPTIONS, addCharge, addCost, adjustFee, applyProposal, cancelCharge, contribution, costKindLabel, discountText, endFee, feeCan, periodLabel,
  readCharge, readCost, readFeeLine, readFeeSettings, restartFee, revenue, reviewFee, stopCost, unappliedProposals, vatLabel,
} from "../lib/fees";
import { Row } from "../lib/schema";
import { href } from "./bits";
import { useData } from "./data";
import { useSales } from "./salesKit";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const msgOf = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't work. Try again.");
/** Whole pounds without pence, otherwise always two decimals (so £17,401.80, never £17,401.8). */
const gbp = (n: number) => { const a = Math.abs(n), whole = Math.abs(a - Math.round(a)) < 0.005; return (n < 0 ? "-" : "") + "£" + a.toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }); };
const CAVEAT = "Contracted fees: what the client has agreed to pay, before VAT. They are not invoices issued and not cash received. Invoices and payments are in Xero.";

function useFees() {
  const s = useSales();
  const { data } = useData();
  const settings = useMemo(() => readFeeSettings(data.settings), [data.settings]);
  const can = feeCan(s.cfg, s.me, "adjust");
  const svcName = (k: string) => str(data.services.find((x) => x.Key === k)?.Title) || k || "(no service)";
  return { s, data, settings, can, svcName };
}

// ------------------------------------------------------------------ on the client page

export function ClientFees({ client }: { client: Row }) {
  const f = useFees();
  const { s, data } = f;
  const today = todayIso();
  const [editing, setEditing] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [note, setNote] = useState<string>();
  const ck = str(client.Key);
  const rows = data.clientServices.filter((x) => str(x.ClientKey) === ck);
  const lines = rows.map((r) => ({ row: r, line: readFeeLine(r) })).sort((a, b) => (a.line.status === "ended" ? 1 : 0) - (b.line.status === "ended" ? 1 : 0) || f.svcName(a.line.serviceKey).localeCompare(f.svcName(b.line.serviceKey)));
  const charges = data.feeCharges.filter((x) => str(x.ClientKey) === ck).map((r) => ({ row: r, c: readCharge(r) }));
  const costs = data.clientCosts.filter((x) => str(x.ClientKey) === ck).map((r) => ({ row: r, c: readCost(r) }));
  const history = data.feeHistory.filter((x) => str(x.ClientKey) === ck).sort((a, b) => str(b.At).localeCompare(str(a.At))).slice(0, 25);
  const unapplied = useMemo(() => unappliedProposals(ck, data.proposals, data.proposalVersions, rows, (v) => readAgreed(v)?.lines), [ck, data.proposals, data.proposalVersions, data.clientServices]); // eslint-disable-line react-hooks/exhaustive-deps
  const contrib = contribution(lines.map((x) => x.line), costs.map((x) => x.c));
  const recurring = lines.filter((x) => x.line.status === "active" && !x.line.oneOff);
  const heldAnnual = lines.filter((x) => x.line.status === "held" && !x.line.oneOff).reduce((a, x) => a + x.line.annual, 0);
  const oneOffTotal = lines.filter((x) => x.line.status === "active" && x.line.oneOff && x.line.fee > 0).reduce((a, x) => a + x.line.fee, 0) + charges.filter((x) => x.c.status === "agreed").reduce((a, x) => a + x.c.amount, 0);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setErr(undefined); setNote(undefined);
    try { const r = await fn(); if (r && typeof r === "object" && "error" in r) setErr(String((r as { error: string }).error)); else { if (ok) setNote(ok); setEditing(""); } } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };
  const doW = (w: { error: string } | Parameters<typeof s.apply>[0], ok?: string) => run(async () => ("error" in w ? w : s.apply(w)), ok);
  if (!s.can("view") && !rows.length) return null;
  return (
    <section className="card pad stack" aria-label="Fee schedule" style={{ gap: 10 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Fee schedule</h2>
        <span className="muted">{recurring.length ? `${gbp(contrib.revenue)} a year recurring` : "No fees agreed yet"}{oneOffTotal ? ` · ${gbp(oneOffTotal)} one-off` : ""}{heldAnnual ? ` · ${gbp(heldAnnual)} agreed but held` : ""}</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>{CAVEAT}</p>
      {err && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{err}</p>}
      {note && <p role="status" style={{ margin: 0 }}>{note}</p>}

      {unapplied.map((u) => (
        <div key={u.proposalKey} className="import-list warn" role="group" aria-label={`Agreed fees in ${u.ref}`}>
          <strong>Proposal {u.ref} has agreed fees that aren't in the schedule:</strong> {u.lines.map((l) => `${l.name} ${gbp(l.price)}`).join(", ")}.
          {f.can && <div style={{ marginTop: 6 }}><button type="button" className="btn primary" disabled={busy} onClick={() => doW(applyProposal({ client, proposalKey: u.proposalKey, proposalRef: u.ref, lines: u.lines, schedule: rows, charges: data.feeCharges, services: data.services, effectiveFrom: today, reviewMonths: f.settings.reviewMonths, can: s.pcan }, s.ctx()), "Agreed fees added to the schedule.")}>Add them to the schedule</button></div>}
        </div>
      ))}

      {!lines.length ? <p className="muted" style={{ margin: 0 }}>No services or fees on this client yet.</p> : (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Service</th><th>Agreed fee</th><th>Frequency</th><th>Effective</th><th>Next review</th><th>Status</th><th>Discount</th><th>VAT</th><th /></tr></thead>
            <tbody>{lines.map(({ row, line }) => (
              <tr key={line.key}>
                <td>{f.svcName(line.serviceKey)}</td>
                <td>{line.status === "included" ? <span className="muted">Included</span> : gbp(line.fee)}{line.discount && line.listFee !== line.fee ? <div className="muted">was {gbp(line.listFee)}</div> : null}</td>
                <td>{line.oneOff ? "One-off" : periodLabel(line.period)}</td>
                <td>{line.effectiveFrom ? fmtDate(line.effectiveFrom) : <span className="muted">not recorded</span>}</td>
                <td>{line.nextReview ? <span className={line.nextReview < today ? "chip red" : ""}>{fmtDate(line.nextReview)}</span> : "—"}</td>
                <td><span className={`chip ${line.status === "active" ? "green" : line.status === "held" ? "amber" : ""}`}>{FEE_STATUS_LABEL[line.status]}</span></td>
                <td>{discountText(line.discount) || "—"}</td>
                <td>{line.vat ? vatLabel(line.vat) : <span className="muted">not recorded</span>}</td>
                <td>{f.can && <button type="button" className="linkbtn" aria-expanded={editing === line.key} onClick={() => setEditing(editing === line.key ? "" : line.key)}>Adjust</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {lines.filter((x) => x.line.key === editing).map(({ row, line }) => <AdjustForm key={line.key} row={row} line={line} client={client} busy={busy} doW={doW} fees={f} />)}

      <div className="stack" style={{ gap: 6 }}>
        <strong>One-off charges</strong>
        {charges.length ? <table className="tbl"><tbody>{charges.map(({ row, c }) => (
          <tr key={c.key}><td>{c.label}</td><td>{gbp(c.amount)}</td><td>{c.agreedOn ? fmtDate(c.agreedOn) : ""}</td><td>{c.vat ? vatLabel(c.vat) : ""}</td><td><span className={`chip ${c.status === "agreed" ? "green" : ""}`}>{c.status === "agreed" ? "Agreed" : "Cancelled"}</span></td>
            <td>{f.can && c.status === "agreed" && <CancelCharge disabled={busy} onCancel={(why) => doW(cancelCharge(row, client, why, s.pcan, s.ctx()))} />}</td></tr>
        ))}</tbody></table> : <span className="muted">None.</span>}
        {f.can && <AddCharge disabled={busy} onAdd={(c) => doW(addCharge(client, c, s.pcan, s.ctx()), "Charge added.")} />}
      </div>

      <div className="stack" style={{ gap: 6 }} role="group" aria-label="Direct costs and contribution">
        <strong>Direct costs and estimated contribution</strong>
        {costs.length ? <table className="tbl"><tbody>{costs.map(({ row, c }) => (
          <tr key={c.key} style={c.active ? undefined : { opacity: 0.55 }}><td>{c.label}<div className="muted">{costKindLabel(c.kind)}{c.estimate ? " · estimate" : ""}{c.notes ? ` · ${c.notes}` : ""}</div></td><td>{gbp(c.amount)} {c.oneOff ? "one-off" : periodLabel(c.period).toLowerCase()}</td><td>{c.active ? (f.can && <button type="button" className="linkbtn" disabled={busy} onClick={() => doW(stopCost(row, s.pcan, s.ctx()))}>Stop counting</button>) : <span className="muted">Stopped</span>}</td></tr>
        ))}</tbody></table> : <span className="muted">No costs entered.</span>}
        {f.can && <AddCost disabled={busy} onAdd={(c) => doW(addCost(client, c, s.pcan, s.ctx()), "Cost added.")} />}
        <div className="card" style={{ padding: 10 }}>
          <div className="row-wrap" style={{ gap: 18 }}>
            <span>Recurring fees <strong>{gbp(contrib.revenue)}</strong></span>
            <span>Direct costs <strong>{gbp(contrib.costs)}</strong></span>
            {contrib.hasInternal && <span>Estimated internal cost <strong>{gbp(contrib.internal)}</strong></span>}
            <span>Estimated contribution <strong>{gbp(contrib.contribution)}</strong></span>
          </div>
          <p className="muted" style={{ margin: "6px 0 0" }}><span className={`chip ${contrib.complete === "none" ? "amber" : ""}`}>{contrib.complete === "none" ? "No costs entered" : "Incomplete cost information"}</span> {contrib.label}</p>
        </div>
      </div>

      <details>
        <summary>Fee history ({history.length})</summary>
        {!history.length ? <p className="muted">No changes recorded yet.</p> : (
          <table className="tbl"><tbody>{history.map((h) => {
            const o = (() => { try { return JSON.parse(str(h.Old) || "null"); } catch { return null; } })(); const n = (() => { try { return JSON.parse(str(h.New) || "null"); } catch { return null; } })();
            const what = o?.fee !== undefined || n?.fee !== undefined ? `${o?.fee !== undefined ? gbp(o.fee) : "—"} to ${n?.fee !== undefined ? gbp(n.fee) : "—"}` : n?.label ? `${n.label}: ${gbp(n.amount)}` : o?.label ? `${o.label}: ${gbp(o.amount)}` : "";
            return <tr key={str(h.Key)}><td>{str(h.At).slice(0, 10)}</td><td>{str(h.Actor)}</td><td>{f.svcName(str(h.ServiceKey))}</td><td>{str(h.Action)}</td><td>{what}</td><td className="muted">{str(h.Reason)}</td></tr>;
          })}</tbody></table>
        )}
      </details>
      {!f.can && <p className="muted" style={{ margin: 0 }}>Only a manager or partner can change fees and costs.</p>}
    </section>
  );
}

function AdjustForm({ row, line, client, busy, doW, fees }: { row: Row; line: FeeLine; client: Row; busy: boolean; doW: (w: any, ok?: string) => void; fees: ReturnType<typeof useFees> }) {
  const { s } = fees;
  const today = todayIso();
  const [fee, setFee] = useState(String(line.fee));
  const [period, setPeriod] = useState(line.period || (line.oneOff ? "" : "annually"));
  const [vat, setVat] = useState(line.vat || "standard");
  const [from, setFrom] = useState(today);
  const [review, setReview] = useState(line.nextReview);
  const [dKind, setDKind] = useState<"" | "pct" | "amount">(line.discount?.kind || "");
  const [dVal, setDVal] = useState(line.discount ? String(line.discount.value) : "");
  const [dWhy, setDWhy] = useState(line.discount?.reason || "");
  const [why, setWhy] = useState("");
  const [endOn, setEndOn] = useState(today);
  const ended = !!line.ended;
  return (
    <div className="card" style={{ padding: 12 }} role="group" aria-label={`Adjust ${fees.svcName(line.serviceKey)}`}>
      {ended ? (
        <div className="row-wrap">
          <span>Ended {fmtDate(line.ended)}.</span>
          <input className="input" type="date" aria-label="Restart on" value={endOn} onChange={(e) => setEndOn(e.target.value)} />
          <input className="input" aria-label="Reason" placeholder="Why" value={why} onChange={(e) => setWhy(e.target.value)} />
          <button type="button" className="btn" disabled={busy} onClick={() => doW(restartFee(row, client, endOn, why, s.pcan, s.ctx(), fees.data.clientServices), "Restarted.")}>Restart this fee</button>
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <div className="inline-form">
            <label className="doc-field"><span>Fee (before VAT)</span><input className="input" type="number" min={0} step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
            <label className="doc-field"><span>Charged</span><select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIOD_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="doc-field"><span>VAT</span><select className="input" value={vat} onChange={(e) => setVat(e.target.value)}>{VAT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="doc-field"><span>Starts</span><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="doc-field"><span>Next review</span><input className="input" type="date" value={review} onChange={(e) => setReview(e.target.value)} /></label>
          </div>
          <div className="inline-form">
            <label className="doc-field"><span>Discount</span><select className="input" value={dKind} onChange={(e) => setDKind(e.target.value as "" | "pct" | "amount")}><option value="">None</option><option value="pct">Percent</option><option value="amount">Amount</option></select></label>
            {dKind && <><input className="input" type="number" min={0} aria-label="Discount value" value={dVal} onChange={(e) => setDVal(e.target.value)} /><input className="input" aria-label="Discount reason" placeholder="Reason for the discount" value={dWhy} onChange={(e) => setDWhy(e.target.value)} /></>}
          </div>
          <input className="input" aria-label="Why the fee is changing" placeholder="Why is the fee changing? (required)" value={why} onChange={(e) => setWhy(e.target.value)} />
          <div className="row-wrap">
            <button type="button" className="btn primary" disabled={busy} onClick={() => doW(adjustFee(row, client, { fee: Number(fee), period, vat, effectiveFrom: from, nextReview: review, discount: dKind ? { kind: dKind, value: Number(dVal), reason: dWhy } : null, reason: why }, s.pcan, s.ctx(), fees.data.clientServices), "Fee changed. The old fee is kept in the history.")}>Save the new fee</button>
            <button type="button" className="btn" disabled={busy} onClick={() => doW(reviewFee(row, client, review || todayIso(), why, s.pcan, s.ctx()), "Review recorded.")}>Reviewed: no change</button>
            <span className="muted">or stop charging from</span>
            <input className="input" type="date" aria-label="Ends on" value={endOn} onChange={(e) => setEndOn(e.target.value)} />
            <button type="button" className="btn" disabled={busy} onClick={() => doW(endFee(row, client, endOn, why, s.pcan, s.ctx(), fees.data.clientServices), "Fee ended.")}>End this fee</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CancelCharge({ onCancel, disabled }: { onCancel: (why: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false); const [why, setWhy] = useState("");
  return open ? <span className="row-wrap"><input className="input" aria-label="Why cancel" placeholder="Why" value={why} onChange={(e) => setWhy(e.target.value)} /><button type="button" className="btn small" disabled={disabled} onClick={() => onCancel(why)}>Cancel charge</button></span> : <button type="button" className="linkbtn danger-link" onClick={() => setOpen(true)}>Cancel…</button>;
}

function AddCharge({ onAdd, disabled }: { onAdd: (c: { label: string; amount: number; vat: string; agreedOn: string }) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(""); const [amount, setAmount] = useState(""); const [vat, setVat] = useState("standard"); const [on, setOn] = useState(todayIso());
  if (!open) return <div><button type="button" className="btn small" onClick={() => setOpen(true)}>Add a one-off charge</button></div>;
  return (
    <div className="inline-form" role="group" aria-label="Add a one-off charge">
      <input className="input" aria-label="Charge for" placeholder="What is it for?" value={label} onChange={(e) => setLabel(e.target.value)} />
      <input className="input" style={{ width: 110 }} type="number" min={0} step="0.01" aria-label="Charge amount" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <select className="input" aria-label="Charge VAT" value={vat} onChange={(e) => setVat(e.target.value)}>{VAT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <input className="input" type="date" aria-label="Agreed on" value={on} onChange={(e) => setOn(e.target.value)} />
      <button type="button" className="btn small primary" disabled={disabled} onClick={() => onAdd({ label, amount: Number(amount), vat, agreedOn: on })}>Add charge</button>
      <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Close</button>
    </div>
  );
}

function AddCost({ onAdd, disabled }: { onAdd: (c: { kind: CostKind; label: string; amount: number; period: string; notes: string }) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CostKind>("outsourcing"); const [label, setLabel] = useState(""); const [amount, setAmount] = useState(""); const [period, setPeriod] = useState("monthly"); const [notes, setNotes] = useState("");
  if (!open) return <div><button type="button" className="btn small" onClick={() => setOpen(true)}>Add a cost</button></div>;
  return (
    <div className="inline-form" role="group" aria-label="Add a cost">
      <select className="input" aria-label="Kind of cost" value={kind} onChange={(e) => setKind(e.target.value as CostKind)}>{COST_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <input className="input" aria-label="Cost description" placeholder="What is it?" value={label} onChange={(e) => setLabel(e.target.value)} />
      <input className="input" style={{ width: 110 }} type="number" min={0} step="0.01" aria-label="Cost amount" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <select className="input" aria-label="Cost period" value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIOD_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <input className="input" aria-label="Cost note" placeholder="Note (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <button type="button" className="btn small primary" disabled={disabled} onClick={() => onAdd({ kind, label, amount: Number(amount), period, notes })}>Add cost</button>
      <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Close</button>
    </div>
  );
}

// ------------------------------------------------------------------ the practice's revenue overview

export function RevenuePage() {
  const f = useFees();
  const { data } = f;
  const [view, setView] = useState<"service" | "client">("service");
  const r = useMemo(() => revenue(data.clientServices, data.feeCharges, data.clientCosts), [data.clientServices, data.feeCharges, data.clientCosts]);
  const clientName = (k: string) => str(data.clients.find((c) => c.Key === k)?.Title) || k;
  const noHistory = data.clientServices.filter((x) => !str(x.EffectiveFrom)).length;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="import-list" role="note"><strong>Contracted, not collected.</strong> {CAVEAT} Held services are shown apart, and ended services are left out.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
        {([["Monthly recurring (MRR)", r.mrr], ["Annualised recurring (ARR)", r.arr], ["One-off agreed fees", r.oneOff], ["Total agreed fees", r.total]] as [string, number][]).map(([k, v]) => (
          <div className="card" key={k} style={{ padding: 14 }}><div className="muted" style={{ fontSize: 12 }}>{k}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{gbp(v)}</div></div>
        ))}
      </div>
      <p className="muted" style={{ margin: 0 }}>Total agreed fees = annualised recurring fees + one-off agreed fees. Invoiced and cash received: not tracked in the planner.{r.heldArr ? ` ${gbp(r.heldArr)} a year more is agreed but held (work not started).` : ""}{r.includedCount ? ` ${r.includedCount} service${r.includedCount === 1 ? " is" : "s are"} included in a package at no separate fee.` : ""}{noHistory ? ` ${noHistory} fee line${noHistory === 1 ? " has" : "s have"} no start date because ${noHistory === 1 ? "it was" : "they were"} imported before fee schedules.` : ""}</p>
      <div className="row-wrap">
        <button type="button" className="btn" aria-pressed={view === "service"} onClick={() => setView("service")}>By service</button>
        <button type="button" className="btn" aria-pressed={view === "client"} onClick={() => setView("client")}>By client</button>
      </div>
      {view === "service" ? (
        <div className="card" style={{ overflowX: "auto" }}><table className="tbl">
          <thead><tr><th>Service</th><th>Clients</th><th>Annual recurring</th><th>One-off</th></tr></thead>
          <tbody>{r.byService.map((x) => <tr key={x.serviceKey}><td>{f.svcName(x.serviceKey)}</td><td>{x.clients}</td><td>{gbp(x.arr)}</td><td>{x.oneOff ? gbp(x.oneOff) : "—"}</td></tr>)}</tbody>
        </table></div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}><table className="tbl">
          <thead><tr><th>Client</th><th>Annual recurring</th><th>One-off</th><th>Estimated contribution</th></tr></thead>
          <tbody>{r.byClient.map((x) => (
            <tr key={x.clientKey}><td><a href={href("clients", x.clientKey)}>{clientName(x.clientKey)}</a></td><td>{gbp(x.arr)}</td><td>{x.oneOff ? gbp(x.oneOff) : "—"}</td>
              <td>{x.contribution ? <>{gbp(x.contribution.contribution)} <span className="chip amber" title={x.contribution.label}>incomplete costs</span></> : <span className="muted">no costs entered</span>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="muted" style={{ margin: 0 }}>Estimated contribution counts only the direct costs entered on each client. Time isn't recorded, so it is not client profitability.</p>
    </div>
  );
}
