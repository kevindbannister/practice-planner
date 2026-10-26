// Settings › Onboarding: which stages the practice uses, which are required, and how long AML approval lasts by risk.
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_STAGES, FIXED_MANDATORY, OnboardingSettings, onboardingCan, readOnboardingSettings } from "../lib/onboarding";
import { useData } from "./data";
import { useSales } from "./salesKit";

export function OnboardingSettingsPage() {
  const s = useSales();
  const { data, saveSetting } = useData();
  const current = useMemo(() => readOnboardingSettings(data.settings), [data.settings]);
  const [draft, setDraft] = useState<OnboardingSettings>(current);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(current); }, [current]);
  const allowed = onboardingCan(s.cfg, s.me, "configure");
  const set = (key: string, patch: { enabled?: boolean; mandatory?: boolean }) => setDraft({ ...draft, stages: draft.stages.map((d) => (d.key === key ? { ...d, ...patch } : d)) });
  const months = (k: "low" | "medium" | "high", v: string) => setDraft({ ...draft, amlMonths: { ...draft.amlMonths, [k]: Math.max(1, Math.min(120, Math.floor(Number(v)) || 1)) } });
  const save = async () => {
    setBusy(true); setMsg(undefined);
    try {
      await saveSetting("onboarding.settings", { stages: draft.stages.map((d) => ({ key: d.key, enabled: d.enabled, mandatory: d.mandatory })), amlMonths: draft.amlMonths });
      setMsg({ ok: true, text: "Saved. It applies to every onboarding, including ones already open." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't save." }); } finally { setBusy(false); }
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(current);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad stack" aria-label="Onboarding stages">
        <h2 style={{ margin: 0 }}>Onboarding stages</h2>
        <p className="muted" style={{ margin: 0 }}>A client can only be approved and activated when every required stage that applies to them is done. Proposal accepted, internal approval and activation are always required. Switching off "Agent authorisations" means services that need one are no longer held back at activation.</p>
        <table className="tbl">
          <thead><tr><th>Stage</th><th>Used</th><th>Required</th><th>Applies to</th></tr></thead>
          <tbody>{draft.stages.map((d) => {
            const fixed = FIXED_MANDATORY.includes(d.key);
            const base = DEFAULT_STAGES.find((x) => x.key === d.key)!;
            return (
              <tr key={d.key}>
                <td><strong>{d.label}</strong><div className="muted">{d.help}</div></td>
                <td><input type="checkbox" aria-label={`Use ${d.label}`} disabled={!allowed || fixed} checked={d.enabled} onChange={(e) => set(d.key, { enabled: e.target.checked })} /></td>
                <td><input type="checkbox" aria-label={`${d.label} is required`} disabled={!allowed || fixed || !d.enabled} checked={d.mandatory} onChange={(e) => set(d.key, { mandatory: e.target.checked })} /></td>
                <td className="muted">{base.takeoverOnly ? "Takeovers only" : "All clients"}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>
      <section className="card pad stack" aria-label="AML re-verification">
        <h2 style={{ margin: 0 }}>AML re-verification</h2>
        <p className="muted" style={{ margin: 0 }}>When AML is approved, the client's AML review date is set this many months ahead, by risk rating. Set these to match your own AML policy.</p>
        <div className="row-wrap">
          {(["low", "medium", "high"] as const).map((k) => <label key={k} className="doc-field"><span>{k[0].toUpperCase() + k.slice(1)} risk (months)</span><input className="input" type="number" min={1} max={120} disabled={!allowed} value={draft.amlMonths[k]} onChange={(e) => months(k, e.target.value)} /></label>)}
        </div>
      </section>
      {allowed ? <div className="row-wrap"><button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save"}</button>{msg && <span role={msg.ok ? "status" : "alert"} style={{ color: msg.ok ? undefined : "var(--red-ink)" }}>{msg.text}</span>}</div> : <p className="muted">Only a manager or partner can change these.</p>}
    </div>
  );
}
