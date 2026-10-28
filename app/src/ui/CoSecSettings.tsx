// Settings › Co Sec: the fee schedule the practice can edit, and an honest list of what this system does and doesn't do with Companies House.
import { useState } from "react";
import { DEFAULT_FEES, readFees } from "../lib/cosecFees";
import { readSetting, useData } from "./data";

const say = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't save. Try again.");

export function CoSecSettings() {
  const { data, saveSetting } = useData();
  const fees = readFees(readSetting(data.settings, "cosec.fees"));
  const cs = fees.CS01;
  const [amount, setAmount] = useState(String(cs?.amount ?? ""));
  const [effective, setEffective] = useState(cs?.effective ?? "");
  const [source, setSource] = useState(cs?.source ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const save = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0 || amount.trim() === "") return setMsg({ ok: false, text: "Enter the fee in pounds, for example 50." });
    try { await saveSetting("cosec.fees", { CS01: { amount: n, effective, source: source.trim() || "Entered by the practice" } }); setMsg({ ok: true, text: "Saved." }); } catch (e) { setMsg({ ok: false, text: say(e) }); }
  };
  const reset = async () => { try { await saveSetting("cosec.fees", {}); setAmount(String(DEFAULT_FEES.CS01.amount)); setEffective(DEFAULT_FEES.CS01.effective); setSource(DEFAULT_FEES.CS01.source); setMsg({ ok: true, text: "Back to the built-in starting figure." }); } catch (e) { setMsg({ ok: false, text: say(e) }); } };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad stack" aria-label="Companies House fees">
        <h3 style={{ margin: 0 }}>Companies House fees</h3>
        <p className="muted" style={{ margin: 0 }}>Shown on confirmation statements. The built-in figure came from a third-party article, not GOV.UK, so check it before relying on it and note where you checked.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          <label className="doc-field"><span>Confirmation statement fee (£, online)</span><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="doc-field"><span>Effective from</span><input className="input" type="date" value={effective} onChange={(e) => setEffective(e.target.value)} /></label>
          <label className="doc-field" style={{ gridColumn: "1 / -1" }}><span>Where this figure comes from</span><input className="input" value={source} onChange={(e) => setSource(e.target.value)} /></label>
        </div>
        <div className="row-wrap"><button type="button" className="btn primary" onClick={() => void save()}>Save</button><button type="button" className="btn" onClick={() => void reset()}>Use the built-in figure</button></div>
        {msg && <p role={msg.ok ? "status" : "alert"} style={{ margin: 0, color: msg.ok ? "var(--green)" : "var(--red-ink)" }}>{msg.text}</p>}
      </section>
      <section className="card pad stack" aria-label="What Co Sec does and doesn't do">
        <h3 style={{ margin: 0 }}>What is and isn't automated</h3>
        <ul className="plain" style={{ margin: 0 }}>
          <li><strong>Reading from Companies House:</strong> officers, PSCs, filing dates and company status are read and compared with the planner's records.</li>
          <li><strong>Filing with Companies House:</strong> nothing is submitted live. Filings are prepared, checked and approved here, then filed at Companies House by a person. Live submission stays switched off until it has been tested against Companies House's test service and approved.</li>
          <li><strong>Confirmation statements:</strong> prepared and checked, not submitted. Directors' identity verification is tracked by status only; no personal or authentication codes are stored.</li>
          <li><strong>Dormant accounts:</strong> for companies that have never traded. Prepared for a director to sign and tracked until Companies House accepts them. Accounts for trading companies, and iXBRL accounts software, are not covered.</li>
          <li><strong>Client approval:</strong> asked for through the client portal, or recorded from a signed copy. The portal route hasn't been exercised against a live portal yet.</li>
          <li><strong>Importing history:</strong> PDF registers are read as text and matched by rules, not by AI; every item is reviewed by a person before it is saved.</li>
          <li><strong>Dividends and tax:</strong> amounts come from the share ledger; whether profits are distributable is confirmed by a person, and tax isn't calculated.</li>
        </ul>
      </section>
    </div>
  );
}
