// Settings › Sales: the pipeline stages, where leads come from, and why work is lost.
import { useState } from "react";
import { DEFAULT_LOST_REASONS, DEFAULT_SOURCES, DEFAULT_STAGES, Stage, stageKeyFor } from "../lib/sales";
import { useData } from "./data";
import { useSales } from "./salesKit";

export function SalesSettings() {
  const s = useSales();
  const { saveSetting } = useData();
  const allowed = s.can("configure");
  const [stages, setStages] = useState<Stage[]>(s.stages);
  const [sources, setSources] = useState(s.sources.join("\n"));
  const [reasons, setReasons] = useState(s.lostReasons.join("\n"));
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const lines = (t: string) => [...new Set(t.split("\n").map((x) => x.trim()).filter(Boolean))];
  const inUse = (key: string) => s.opps.filter((o) => o.Stage === key).length;
  const last = stages.length - 1;

  const rename = (i: number, label: string) => setStages(stages.map((x, n) => (n === i ? { ...x, label } : x)));
  const swap = (i: number, j: number) => { if (j < 0 || j >= last || i >= last) return; const c = [...stages]; [c[i], c[j]] = [c[j], c[i]]; setStages(c); };
  const add = () => {
    const label = `New stage ${stages.length}`;
    const c = [...stages]; c.splice(last, 0, { key: stageKeyFor(label, stages.map((x) => x.key)), label });
    setStages(c);
  };
  const remove = (i: number) => {
    const n = inUse(stages[i].key);
    if (n) { setMsg({ ok: false, text: `${stages[i].label} still has ${n} opportunit${n === 1 ? "y" : "ies"}. Move them first.` }); return; }
    setStages(stages.filter((_, k) => k !== i));
  };
  const save = async () => {
    setMsg(undefined);
    if (stages.some((x) => !x.label.trim())) { setMsg({ ok: false, text: "Every stage needs a name." }); return; }
    if (stages.length < 2) { setMsg({ ok: false, text: "Keep at least two stages." }); return; }
    try {
      await saveSetting("sales.pipeline", stages.map((x, i) => ({ key: x.key, label: x.label.trim(), ...(i === stages.length - 1 ? { won: true } : {}) })));
      await saveSetting("sales.sources", lines(sources));
      await saveSetting("sales.lostReasons", lines(reasons));
      setMsg({ ok: true, text: "Saved." });
    } catch { setMsg({ ok: false, text: "That didn't save. Try again." }); }
  };
  const reset = () => { setStages(DEFAULT_STAGES); setSources(DEFAULT_SOURCES.join("\n")); setReasons(DEFAULT_LOST_REASONS.join("\n")); };

  if (!allowed) return <div className="card" style={{ padding: 16 }}><p style={{ margin: 0 }}>Only managers, partners and owners can change the sales settings.</p></div>;
  return (
    <>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Pipeline stages</h2>
        <p className="muted">Rename, reorder, add or remove stages. The last stage is where won work ends up, and always stays last.</p>
        <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {stages.map((st, i) => (
            <li key={st.key} className="row-wrap" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
              <input className="input" style={{ maxWidth: 320 }} aria-label={`Stage ${i + 1} name`} value={st.label} onChange={(e) => rename(i, e.target.value)} />
              {i === last ? <span className="chip green">Won stage</span> : (
                <>
                  <button type="button" className="btn small" aria-label={`Move ${st.label} up`} disabled={i === 0} onClick={() => swap(i, i - 1)}>↑</button>
                  <button type="button" className="btn small" aria-label={`Move ${st.label} down`} disabled={i >= last - 1} onClick={() => swap(i, i + 1)}>↓</button>
                  <button type="button" className="btn small" aria-label={`Remove ${st.label}`} onClick={() => remove(i)}>Remove</button>
                </>
              )}
              {inUse(st.key) > 0 && <span className="muted" style={{ fontSize: 12 }}>{inUse(st.key)} in this stage</span>}
            </li>
          ))}
        </ol>
        <button type="button" className="btn" onClick={add}>+ Add stage</button>
      </div>
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <label className="doc-field"><span>Where leads come from (one per line)</span><textarea className="input" rows={6} value={sources} onChange={(e) => setSources(e.target.value)} /></label>
        <label className="doc-field" style={{ marginTop: 12 }}><span>Reasons work is lost (one per line)</span><textarea className="input" rows={6} value={reasons} onChange={(e) => setReasons(e.target.value)} /></label>
      </div>
      <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
        <button type="button" className="btn primary" onClick={save}>Save</button>
        <button type="button" className="btn" onClick={reset}>Put back the standard set</button>
        {msg && <span role={msg.ok ? "status" : "alert"} style={{ color: msg.ok ? "var(--green)" : "var(--red-ink)" }}>{msg.text}</span>}
      </div>
    </>
  );
}
