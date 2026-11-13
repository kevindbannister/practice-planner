// Custom fields: where they are defined (Settings), and where their values are entered (a client's Details card and the job panel).
import { useMemo, useState } from "react";
import { AppliesTo, CUSTOM_FIELDS_KEY, CustomDef, FIELD_TYPE_LABEL, FieldType, addDef, readDefs, removeDef, saveValues, valuesOf } from "../lib/customFields";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { readSetting, useData } from "./data";

export const useCustomDefs = (): CustomDef[] => {
  const { data } = useData();
  return useMemo(() => readDefs(readSetting<unknown>(data.settings, CUSTOM_FIELDS_KEY)), [data.settings]);
};

// ------------------------------------------------------------------ Settings

export function CustomFieldSettings() {
  const { saveSetting, store } = useData();
  const defs = useCustomDefs();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("number");
  const [applies, setApplies] = useState<AppliesTo>("client");
  const [options, setOptions] = useState("");
  const [help, setHelp] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ready = store.hasList("CustomValues");
  const save = async (next: CustomDef[]) => { setBusy(true); setErr(""); try { await saveSetting(CUSTOM_FIELDS_KEY, next); return true; } catch { setErr("That didn't save. Try again."); return false; } finally { setBusy(false); } };
  const add = async () => {
    const r = addDef(defs, { label, type, appliesTo: applies, options: options.split(/[,\n]/), help });
    if (r.problem) return setErr(r.problem);
    if (await save(r.defs)) { setLabel(""); setOptions(""); setHelp(""); }
  };
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <section className="card pad stack" aria-labelledby="cf-h">
        <h2 id="cf-h" style={{ margin: 0 }}>Your own fields</h2>
        <p className="muted" style={{ margin: 0 }}>Record what matters to your pricing and planning that the planner doesn't ask for, such as monthly bank transactions, employees or bookkeeping standard. Fill them in on each client's overview (or on a job), then filter the Clients list by them, export them, and use them in emails as merge fields like <code>{"{{client.custom.transactions}}"}</code>.</p>
        {!ready && <p className="import-list warn" role="alert">The custom values list isn't set up yet. It is added automatically when the planner starts.</p>}
        {defs.length === 0 ? <p className="muted" style={{ margin: 0 }}>No fields yet.</p> : (
          <div className="table-wrap"><table className="grid" style={{ minWidth: 520 }}>
            <thead><tr><th scope="col">Name</th><th scope="col">On</th><th scope="col">Type</th><th scope="col">Merge field</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>{defs.map((d) => (
              <tr key={`${d.appliesTo}.${d.key}`}>
                <td><strong>{d.label}</strong>{d.type === "choice" && <span className="muted" style={{ display: "block", fontSize: 13 }}>{d.options.join(" · ")}</span>}</td>
                <td>{d.appliesTo === "client" ? "Clients" : "Jobs"}</td><td>{FIELD_TYPE_LABEL[d.type]}</td>
                <td className="mono" style={{ fontSize: 13 }}>{`{{${d.appliesTo}.custom.${d.key}}}`}</td>
                <td><button type="button" className="linkbtn danger-link" disabled={busy} onClick={() => { if (window.confirm(`Remove "${d.label}"? What was entered is kept, and comes back if you add a field with the same name.`)) void save(removeDef(defs, d.appliesTo, d.key)); }}>Remove</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <div className="cf-grid" aria-label="Add a field">
          <label className="field"><span>Name</span><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Monthly transactions" /></label>
          <label className="field"><span>Type</span><select className="input" value={type} onChange={(e) => setType(e.target.value as FieldType)}>{(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}</select></label>
          <label className="field"><span>On</span><select className="input" value={applies} onChange={(e) => setApplies(e.target.value as AppliesTo)}><option value="client">Clients</option><option value="job">Jobs</option></select></label>
          {type === "choice" && <label className="field"><span>Choices, separated by commas</span><input className="input" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Good, Patchy, Poor" /></label>}
          <label className="field"><span>Hint (optional)</span><input className="input" value={help} onChange={(e) => setHelp(e.target.value)} /></label>
        </div>
        {err && <p className="error-text" role="alert" style={{ margin: 0 }}>{err}</p>}
        <div><button type="button" className="btn primary" disabled={busy || !ready || !label.trim()} onClick={() => void add()}>Add the field</button></div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ entering values

/** Inputs for the custom fields on one client or job, saved when you leave each box. */
export function CustomValuesEditor({ kind, entityKey, clientKey }: { kind: AppliesTo; entityKey: string; clientKey: string }) {
  const { data, create, update, store } = useData();
  const all = useCustomDefs();
  const defs = all.filter((d) => d.appliesTo === kind);
  const stored = useMemo(() => valuesOf(data.customValues, kind, entityKey), [data.customValues, kind, entityKey]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");
  if (!defs.length || !store.hasList("CustomValues")) return null;
  const shown = (k: string) => (k in draft ? draft[k] : stored[k] ?? "");
  const commit = async (key: string, value: string) => {
    if ((stored[key] ?? "") === value.trim() && !(key in draft)) return;
    const live = data.customValues.find((r) => r.Kind === kind && r.EntityKey === entityKey) as Row | undefined;
    const r = saveValues(all, kind, entityKey, clientKey, valuesOf(data.customValues, kind, entityKey), { [key]: value }, live, newKey, new Date().toISOString());
    if (r.problem) { setErr(r.problem); return; }
    setErr("");
    try {
      if (r.isNew) await create("CustomValues", r.row); else await update("CustomValues", live!, r.row);
      setDraft((d) => { const { [key]: _drop, ...rest } = d; return rest; });
      setSaved(key);
    } catch { setErr("That didn't save. Try again."); }
  };
  return (
    <div className="stack" style={{ gap: 8 }} aria-label="Your own fields">
      {defs.map((d) => (
        <label key={d.key} className="field">
          <span>{d.label}{saved === d.key && !(d.key in draft) ? <span className="muted" style={{ fontWeight: 400 }}> · saved</span> : null}</span>
          {d.type === "yesno" || d.type === "choice" ? (
            <select className="input" value={shown(d.key)} onChange={(e) => void commit(d.key, e.target.value)}>
              <option value="">Not set</option>
              {d.type === "yesno" ? <><option value="yes">Yes</option><option value="no">No</option></> : d.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input className="input" type={d.type === "date" ? "date" : "text"} inputMode={d.type === "number" ? "decimal" : undefined} value={shown(d.key)} onChange={(e) => setDraft({ ...draft, [d.key]: e.target.value })} onBlur={(e) => void commit(d.key, e.target.value)} />
          )}
          {d.help && <span className="muted" style={{ fontSize: 13 }}>{d.help}</span>}
        </label>
      ))}
      {err && <p className="error-text" role="alert" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}

/** The client overview card. */
export function CustomDetailsCard({ clientKey }: { clientKey: string }) {
  const defs = useCustomDefs().filter((d) => d.appliesTo === "client");
  if (!defs.length) return <div className="stack" style={{ gap: 6 }}><p className="muted" style={{ margin: 0, fontSize: 13 }}>Your own fields for clients (such as transactions or employees) go here. <a href="#/settings/fields">Add some in Settings</a>.</p></div>;
  return <CustomValuesEditor kind="client" entityKey={clientKey} clientKey={clientKey} />;
}
