// Settings › Your firm: the practice's own details as an agent: used when registering clients
// with HMRC (for example for CIS) and anywhere else the firm has to identify itself.
import { useEffect, useState } from "react";
import { EMPTY_FIRM, Firm } from "../lib/cis";
import { readSetting, useData } from "./data";

export function useFirm(): Firm {
  const { data } = useData();
  return { ...EMPTY_FIRM, ...(readSetting<Partial<Firm>>(data.settings, "firm.details") || {}) };
}

export function FirmSettings() {
  const { saveSetting } = useData();
  const saved = useFirm();
  const [f, setF] = useState<Firm>(saved);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<"" | "saving" | "saved" | "failed">("");
  useEffect(() => { if (!dirty) setF(saved); }, [JSON.stringify(saved)]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof Firm, v: string) => { setF({ ...f, [k]: v }); setDirty(true); setState(""); };
  const save = async () => {
    setState("saving");
    try { await saveSetting("firm.details", f); setDirty(false); setState("saved"); } catch { setState("failed"); }
  };
  const input = (k: keyof Firm, label: string, hint?: string) => (
    <label className="field" style={{ display: "grid", gap: 4 }}>
      <span>{label}{hint ? <span className="muted"> {hint}</span> : null}</span>
      <input className="input" value={f[k]} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  return (
    <section className="card" aria-labelledby="firm-h" style={{ marginTop: 16, padding: 22 }}>
      <h2 id="firm-h">Your firm</h2>
      <p className="muted">Your practice's details as an agent. They appear alongside a client's details when you register them with HMRC, for example for CIS. Leave out anything you don't have yet.</p>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", marginTop: 12 }}>
        {input("firmName", "Firm name")}
        {input("contactName", "Contact at the firm")}
        {input("phone", "Telephone")}
        {input("email", "Email")}
        {input("agentRef", "HMRC agent reference", "(the agent reference number from your HMRC agent services account)")}
      </div>
      <label className="field" style={{ display: "grid", gap: 4, marginTop: 12 }}>
        <span>Firm address <span className="muted">(one line per line of the address)</span></span>
        <textarea className="input" rows={3} value={f.address} onChange={(e) => set("address", e.target.value)} />
      </label>
      <label className="field" style={{ display: "grid", gap: 4, marginTop: 12 }}>
        <span>Authorisation to act for clients <span className="muted">(for example: "64-8 signed by the client and on file", or "authorised through agent services")</span></span>
        <textarea className="input" rows={3} value={f.authorisation} onChange={(e) => set("authorisation", e.target.value)} />
      </label>
      <label className="field" style={{ display: "grid", gap: 4, marginTop: 12 }}>
        <span>Notes for your team</span>
        <textarea className="input" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>
      <p className="muted" style={{ marginTop: 10 }}>Don't put passwords or Government Gateway sign-ins here.</p>
      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
        <button type="button" className="btn primary" disabled={!dirty || state === "saving"} onClick={() => void save()}>{state === "saving" ? "Saving…" : "Save"}</button>
        {state === "saved" && <span className="muted" role="status">Saved</span>}
        {state === "failed" && <span className="error-text" role="alert">Couldn't save. Try again.</span>}
      </div>
    </section>
  );
}
