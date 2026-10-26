// On a client's page, under References: CIS (Construction Industry Scheme) as a contractor.
// Shows the registration if there is one; if not, a "Register for CIS" guide with everything HMRC
// will ask for, taken from the client's record and the firm's own details.
import { useState } from "react";
import { Client, fmtDate, todayIso } from "../lib/domain";
import { CIS_HELPLINE, EMPLOYER_HELPLINE, Need, agentNeeds, cisStatus, isIsoDate, needs, summary } from "../lib/cis";
import { CopyButton, href } from "./bits";
import { useData } from "./data";
import { useFirm } from "./FirmSettings";

function Row({ n }: { n: Need }) {
  return (
    <div className="kv" style={{ alignItems: "start" }}>
      <span>{n.label}</span>
      <span style={{ textAlign: "right" }}>
        {n.value ? (
          <span className="copy-val"><span className="mono" style={{ textAlign: "right" }}>{n.value}</span><CopyButton value={n.value} label={n.label.toLowerCase()} /></span>
        ) : (
          <span style={{ color: "var(--amber-ink)", fontWeight: 600 }}>Missing{n.fix ? <span className="muted" style={{ fontWeight: 400 }}> · {n.fix}</span> : null}</span>
        )}
        {n.note && <div className="muted" style={{ fontSize: 13 }}>{n.note}</div>}
      </span>
    </div>
  );
}

function Phone({ label, number }: { label: string; number: string }) {
  return (
    <div className="kv"><span>{label}</span><span className="copy-val"><a className="mono" href={`tel:${number.replace(/\s/g, "")}`}>{number}</a><CopyButton value={number} label={label.toLowerCase()} /></span></div>
  );
}

export function CisCard({ client: c, hasCisWork }: { client: Client; hasCisWork: boolean }) {
  const { update } = useData();
  const firm = useFirm();
  const status = cisStatus(c);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [first, setFirst] = useState(String(c.CISFirstPayment || ""));
  const [regDate, setRegDate] = useState(String(c.CISRegistered || "") || todayIso());
  const [asking, setAsking] = useState(false);

  const save = async (patch: Record<string, string>) => {
    setBusy(true); setErr("");
    try { await update("Clients", c, patch); } catch { setErr("Couldn't save. Try again."); } finally { setBusy(false); }
  };

  if (status === "registered") {
    return (
      <section className="card pad stack" aria-labelledby="cis-h">
        <h2 id="cis-h">CIS contractor</h2>
        <div className="kv"><span>Status</span><span>Registered{c.CISRegistered ? ` on ${fmtDate(String(c.CISRegistered))}` : ""}</span></div>
        <div className="kv"><span>PAYE reference</span><span className="mono">{String(c.PAYERef || "—")}</span></div>
        <div className="kv"><span>Accounts Office ref</span><span className="mono">{String(c.AccountsOfficeRef || "—")}</span></div>
        <p className="muted" style={{ margin: 0 }}>A CIS contractor uses their employer PAYE reference and Accounts Office reference for CIS returns.</p>
        <button type="button" className="btn small" style={{ alignSelf: "start" }} disabled={busy} onClick={() => void save({ CISStatus: "", CISRegistered: "" })}>Not registered after all</button>
        {err && <p className="error-text" role="alert" style={{ margin: 0 }}>{err}</p>}
      </section>
    );
  }
  if (status === "not-contractor") {
    return (
      <section className="card pad stack" aria-labelledby="cis-h">
        <h2 id="cis-h">CIS contractor</h2>
        <p className="muted" style={{ margin: 0 }}>Marked as not a CIS contractor.</p>
        <button type="button" className="btn small" style={{ alignSelf: "start" }} disabled={busy} onClick={() => void save({ CISStatus: "" })}>Undo</button>
        {err && <p className="error-text" role="alert" style={{ margin: 0 }}>{err}</p>}
      </section>
    );
  }

  const list = needs(c);
  const agent = agentNeeds(firm);
  const missing = list.filter((n) => !n.value && n.label !== "Employer PAYE reference" && n.label !== "Accounts Office reference").length;
  const dateOk = !first || isIsoDate(first);

  return (
    <section className="card pad stack" aria-labelledby="cis-h">
      <h2 id="cis-h">CIS contractor</h2>
      <p style={{ margin: 0, ...(hasCisWork ? { color: "var(--amber-ink)", fontWeight: 600 } : {}) }}>
        {hasCisWork ? "This client has CIS work but isn't marked as registered as a contractor." : "Not registered for CIS."}
      </p>
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Register for CIS</summary>
        <div className="stack" style={{ gap: 14, marginTop: 12 }}>
          <div>
            <h3 style={{ margin: "0 0 6px" }}>When and how</h3>
            <p style={{ margin: 0 }}>A contractor must be registered with HMRC <b>before</b> paying their first subcontractor. HMRC's route is the new-employer registration (even with no employees), which gives the PAYE and Accounts Office references; an existing employer adds the Contractor scheme.</p>
            <div style={{ marginTop: 8 }}>
              <Phone label="Employer helpline" number={EMPLOYER_HELPLINE} />
              <Phone label="CIS helpline" number={CIS_HELPLINE} />
            </div>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>Opening hours and the online route are on gov.uk (search "register as a CIS contractor"). Check the numbers there before relying on them.</p>
          </div>

          <div>
            <h3 style={{ margin: "0 0 6px" }}>What HMRC will ask for</h3>
            {list.map((n) => <Row key={n.label} n={n} />)}
            {missing > 0 && <p className="muted" style={{ margin: "6px 0 0" }}>{missing} thing{missing === 1 ? "" : "s"} to find before you ring.</p>}
          </div>

          <div>
            <h3 style={{ margin: "0 0 6px" }}>First payment to a subcontractor</h3>
            <p style={{ margin: "0 0 8px" }}>You'll need to say when the first subcontractor payment is expected, so ask the client for it.</p>
            <div className="row-wrap" style={{ gap: 8, alignItems: "end" }}>
              <label className="field" style={{ display: "grid", gap: 4 }}>
                <span>Expected date</span>
                <input className="input" type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
              </label>
              <button type="button" className="btn small" disabled={busy || !dateOk || first === String(c.CISFirstPayment || "")} onClick={() => void save({ CISFirstPayment: first })}>Save date</button>
            </div>
            {!first && <p style={{ margin: "6px 0 0", color: "var(--amber-ink)", fontWeight: 600 }}>Not set yet.</p>}
          </div>

          <div>
            <h3 style={{ margin: "0 0 6px" }}>Agent details and authorisation</h3>
            {agent.some((n) => n.value) ? agent.filter((n) => n.value || n.fix).map((n) => <Row key={n.label} n={n} />) : <p className="muted" style={{ margin: 0 }}>Nothing added yet. <a href={href("settings", "firm")}>Add your firm's details in Settings › Your firm</a> and they'll show here.</p>}
            {agent.some((n) => n.value) && agent.some((n) => !n.value && n.fix) && <p className="muted" style={{ margin: "6px 0 0" }}><a href={href("settings", "firm")}>Complete them in Settings › Your firm</a></p>}
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>If you're ringing as the client's agent, HMRC will want to know you're authorised to act for them.</p>
          </div>

          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn small" onClick={() => void navigator.clipboard?.writeText(summary(c, firm, first, (d) => fmtDate(d)))}>Copy all of this</button>
            {!asking ? <button type="button" className="btn small" onClick={() => setAsking(true)}>They're registered now…</button> : null}
            <button type="button" className="btn small" disabled={busy} onClick={() => void save({ CISStatus: "not-contractor" })}>Not a CIS contractor</button>
          </div>
          {asking && (
            <div className="row-wrap" style={{ gap: 8, alignItems: "end" }}>
              <label className="field" style={{ display: "grid", gap: 4 }}>
                <span>Registered on</span>
                <input className="input" type="date" value={regDate} onChange={(e) => setRegDate(e.target.value)} />
              </label>
              <button type="button" className="btn primary" disabled={busy || !isIsoDate(regDate)} onClick={() => void save({ CISStatus: "registered", CISRegistered: regDate })}>Mark as registered</button>
              <button type="button" className="btn" onClick={() => setAsking(false)}>Cancel</button>
            </div>
          )}
          {err && <p className="error-text" role="alert" style={{ margin: 0 }}>{err}</p>}
        </div>
      </details>
    </section>
  );
}
