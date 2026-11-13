// Change a company's accounting reference date (AA01, or LL AA01 for an LLP). A person starts this when a client wants a different year
// end; Co Sec never assumes a company needs it. It prepares the filing for review and checks the extension and shortening rules. It does not
// prepare accounts (that is Working Papers and Accounts Production) and it sends nothing to Companies House. The rules are in lib/cosecArd.
import { useMemo, useState } from "react";
import { fmtDate, todayIso } from "../lib/domain";
import { companyKind, isOpenTx, prepareArdChange, verifiedOf } from "../lib/cosec";
import { ArdInput, ArdWhich, EXTENSION_REASONS, WHICH_LABEL, ardAdvice, ardForm, ardIssues, ardPrefill, isArdForm, isoOk, latestExtension } from "../lib/cosecArd";
import { formTitle } from "../lib/cosecForms";
import { Row } from "../lib/schema";
import { href } from "./bits";
import { useCoSec } from "./cosecKit";

const s = (v: unknown) => (v == null ? "" : String(v));
type Msg = { ok: boolean; text: string } | undefined;

export function ArdTab({ client }: { client: Row }) {
  const k = useCoSec(); const ck = s(client.Key);
  const form = ardForm(companyKind(client) === "llp" ? "llp" : "limited");
  const ver = verifiedOf(client); const today = todayIso();
  const pre = useMemo(() => ardPrefill(ver.accTo, s(client.Incorporated)), [ver.accTo, client.Incorporated]);
  const [which, setWhich] = useState<ArdWhich>("current");
  const [start, setStart] = useState(pre.periodStart); const [end, setEnd] = useState(pre.periodEnd);
  const [newEnd, setNewEnd] = useState("");
  const [five, setFive] = useState<"" | "yes" | "no">(""); const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<Msg>(); const [busy, setBusy] = useState(false);
  const input: ArdInput = { which, periodStart: start, periodEnd: end, newEnd, extendedWithinFiveYears: five === "" ? null : five === "yes", extensionReason: reason };
  const extending = isoOk(end) && isoOk(newEnd) && newEnd > end;
  const issues = isoOk(newEnd) ? ardIssues(input) : [];
  const advice = isoOk(newEnd) ? ardAdvice(input, today) : [];
  const open = k.data.cosecTx.filter((t) => s(t.ClientKey) === ck && isArdForm(s(t.Form)) && isOpenTx(t));
  const edit = k.can("edit");
  const pick = (w: ArdWhich) => { setWhich(w); if (w === "current") { setStart(pre.periodStart); setEnd(pre.periodEnd); } else { setStart(""); setEnd(""); } setNewEnd(""); setFive(""); setReason(""); };
  const prepare = async () => {
    setBusy(true); setMsg(undefined);
    try {
      const r = prepareArdChange(client, input, k.snap(), edit, k.ctx());
      if ("error" in r) return setMsg({ ok: false, text: r.error });
      await k.apply(r);
      const tx = r.tx || (r.creates || []).find((c) => c.list === "CoSecTransactions")?.row;
      setMsg({ ok: true, text: "Prepared for review. It has not been sent to Companies House." });
      if (tx) window.location.hash = href("cosec", "filing", s(tx.Key));
    } catch (e) { setMsg({ ok: false, text: e instanceof Error && e.message ? e.message : "That didn't save. Try again." }); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad stack" aria-label="Change accounting reference date">
        <h3 style={{ margin: 0 }}>{form === "LLAA01" ? "LL AA01" : "AA01"}: {formTitle(form)}</h3>
        <p className="muted" style={{ margin: 0 }}>Use this when the client wants a different year end. It prepares the form for review and checks the extension and shortening rules. It doesn't prepare accounts, which are done in Working Papers and Accounts Production, and it doesn't send anything to Companies House.</p>
        <p style={{ margin: 0 }}>Companies House shows the accounting reference date as <strong>{ver.ard || "not checked yet"}</strong>{ver.accTo ? <>, with the next accounts for the period ending <strong>{fmtDate(ver.accTo)}</strong>{ver.accDue ? <> and due by <strong>{fmtDate(ver.accDue)}</strong></> : null}</> : null}.{!ver.accTo && " Check Companies House on the Details tab to fill in the period dates."}</p>
        {open.length > 0 && <p className="chip amber" style={{ alignSelf: "flex-start" }}>A change is already waiting: <a href={href("cosec", "filing", s(open[0].Key))}>{s(open[0].Ref)}</a>. Preparing again updates that draft.</p>}
        {edit ? (
          <div className="stack" style={{ gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
              <label className="doc-field"><span>Period being changed</span><select className="input" value={which} onChange={(e) => pick(e.target.value as ArdWhich)}>{(Object.keys(WHICH_LABEL) as ArdWhich[]).map((w) => <option key={w} value={w}>{WHICH_LABEL[w]}</option>)}</select></label>
              <label className="doc-field"><span>Period started</span><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label className="doc-field"><span>Period currently ends</span><input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
              <label className="doc-field"><span>Period will now end</span><input className="input" type="date" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} /></label>
            </div>
            {which === "previous" && <p className="muted" style={{ margin: 0 }}>Companies House's record only shows the current period, so give the previous period's dates yourself.</p>}
            {isoOk(start) && <p className="muted" style={{ margin: 0 }}>Latest this period can be extended to: {fmtDate(latestExtension(start))} (18 months from its start, unless the company is in administration).</p>}
            {extending && (
              <div className="card pad stack" role="group" aria-label="Extending">
                <strong>This extends the period</strong>
                <label className="doc-field"><span>Has the company already extended an accounting period in the last five years?</span>
                  <select className="input" value={five} onChange={(e) => setFive(e.target.value as "" | "yes" | "no")}><option value="">Choose…</option><option value="no">No</option><option value="yes">Yes</option></select></label>
                <label className="doc-field"><span>Exception that applies{five === "yes" ? " (needed for a second extension)" : ", if any"}</span>
                  <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">None</option>{EXTENSION_REASONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <p className="muted" style={{ margin: 0 }}>The form's own guidance has the exact conditions for each exception. Administration is also the only case where a period can go past 18 months.</p>
              </div>)}
            {issues.length > 0 && <div role="alert" style={{ color: "var(--amber-ink)" }}><strong>Still needed before it can be approved:</strong><ul className="plain" style={{ margin: 0 }}>{issues.map((x) => <li key={x}>{x}</li>)}</ul></div>}
            {advice.length > 0 && <ul className="plain muted" aria-label="Before you file" style={{ margin: 0 }}>{advice.map((x) => <li key={x}>{x}</li>)}</ul>}
            <div><button type="button" className="btn primary" disabled={busy || !isoOk(newEnd)} onClick={() => void prepare()}>Prepare the {form === "LLAA01" ? "LL AA01" : "AA01"}</button></div>
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>You don't have permission to prepare filings.</p>}
        {msg && <p role={msg.ok ? "status" : "alert"} style={{ margin: 0, color: msg.ok ? "var(--green)" : "var(--red-ink)" }}>{msg.text}</p>}
      </section>
    </div>
  );
}
