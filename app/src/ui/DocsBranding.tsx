// Documents › Branding: the practice's name, logo, colours, font, addresses, contact details,
// registration, header, footer, signatory and custom merge fields. More than one profile can be kept
// (a second brand or trading name); one is the default, and a template can name another.
import { useEffect, useRef, useState } from "react";
import { Branding, BrandingSet, DEFAULT_BRANDING, FONT_NAMES, cleanBranding, displayName } from "../lib/docBranding";
import { newKey } from "../lib/planning";
import { shrinkImage } from "./DocEditor";
import { useDocs } from "./docsKit";

const HEX = /^#[0-9a-f]{6}$/i;

export function BrandingScreen() {
  const docs = useDocs();
  const [set, setSet] = useState<BrandingSet>(docs.set);
  const [id, setId] = useState(docs.set.defaultId);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(set) !== JSON.stringify(docs.set);
  useEffect(() => { if (!dirty) setSet(docs.set); }, [docs.set]); // eslint-disable-line react-hooks/exhaustive-deps

  const b = set.profiles.find((p) => p.id === id) || set.profiles[0];
  const patch = (p: Partial<Branding>) => { setState("idle"); setSet({ ...set, profiles: set.profiles.map((x) => (x.id === b.id ? { ...x, ...p } : x)) }); };
  const addProfile = (copy: boolean) => {
    const n: Branding = { ...(copy ? b : DEFAULT_BRANDING), id: newKey("p").toLowerCase(), profileName: copy ? `${b.profileName} (copy)` : "New profile", customFields: copy ? b.customFields.map((c) => ({ ...c })) : [] };
    setSet({ ...set, profiles: [...set.profiles, n] });
    setId(n.id);
  };
  const removeProfile = () => {
    if (set.profiles.length < 2) return;
    const rest = set.profiles.filter((p) => p.id !== b.id);
    setSet({ ...set, profiles: rest, defaultId: set.defaultId === b.id ? rest[0].id : set.defaultId });
    setId(rest[0].id);
  };
  const logo = async (f?: File) => {
    if (!f) return;
    setError("");
    try {
      const { src } = await shrinkImage(f, 420);
      patch({ logo: src });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That picture couldn't be used.");
    }
  };
  const save = async () => {
    setState("saving");
    setError("");
    try {
      await docs.saveBranding({ ...set, profiles: set.profiles.map((p) => cleanBranding(p)) });
      setState("saved");
    } catch {
      setState("error");
      setError("Couldn't save. Check your connection and try again.");
    }
  };
  const text = (label: string, k: keyof Branding, o: { rows?: number; hint?: string; type?: string } = {}) => (
    <label className="doc-field">
      <span>{label}</span>
      {o.rows ? (
        <textarea className="input" rows={o.rows} value={String(b[k] ?? "")} onChange={(e) => patch({ [k]: e.target.value } as Partial<Branding>)} />
      ) : (
        <input className="input" type={o.type || "text"} value={String(b[k] ?? "")} onChange={(e) => patch({ [k]: e.target.value } as Partial<Branding>)} />
      )}
      {o.hint && <small className="muted">{o.hint}</small>}
    </label>
  );
  const colour = (label: string, k: "primary" | "secondary") => (
    <label className="doc-field">
      <span>{label}</span>
      <span className="row-wrap">
        <input type="color" aria-label={`${label} picker`} value={HEX.test(b[k]) ? b[k] : "#000000"} onChange={(e) => patch({ [k]: e.target.value })} />
        <input className="input mono" style={{ maxWidth: 120 }} aria-label={`${label} hex code`} value={b[k]} onChange={(e) => patch({ [k]: e.target.value })} />
        {!HEX.test(b[k]) && <small className="error-text">Use a code like #1f4e79</small>}
      </span>
    </label>
  );

  return (
    <div className="stack">
      <div className="row-wrap">
        <label className="doc-field" style={{ minWidth: 220 }}>
          <span>Branding profile</span>
          <select className="input" value={b.id} onChange={(e) => setId(e.target.value)}>
            {set.profiles.map((p) => <option key={p.id} value={p.id}>{p.profileName}{p.id === set.defaultId ? " (default)" : ""}</option>)}
          </select>
        </label>
        <button type="button" className="btn small" onClick={() => addProfile(false)}>Add profile</button>
        <button type="button" className="btn small" onClick={() => addProfile(true)}>Duplicate</button>
        <button type="button" className="btn small" disabled={b.id === set.defaultId} onClick={() => setSet({ ...set, defaultId: b.id })}>Make default</button>
        <button type="button" className="btn small" disabled={set.profiles.length < 2} onClick={removeProfile}>Delete profile</button>
      </div>

      <div className="brand-grid">
        <div className="card pad stack">
          <h3>Practice</h3>
          {text("Profile name", "profileName", { hint: "Only used to tell profiles apart." })}
          {text("Practice name", "practiceName")}
          {text("Trading name (if different)", "tradingName", { hint: "Shown on documents instead of the practice name when set." })}
          {text("Registered address", "registeredAddress", { rows: 3 })}
          {text("Correspondence address", "correspondenceAddress", { rows: 3 })}
          {text("Registration details", "registration", { hint: "For example: Registered in England and Wales No. 01234567" })}
        </div>
        <div className="card pad stack">
          <h3>Contact and signatory</h3>
          {text("Telephone", "phone")}
          {text("Email", "email", { type: "email" })}
          {text("Website", "website")}
          {text("Signatory name", "signatoryName", { hint: "Who letters are signed by (the field {{practice.signatory_name}})." })}
          {text("Signatory job title", "signatoryTitle")}
        </div>
        <div className="card pad stack">
          <h3>Look</h3>
          <div className="doc-field">
            <span>Logo</span>
            <span className="row-wrap">
              {b.logo ? <img src={b.logo} alt="Current logo" className="doc-brand-logo" /> : <span className="muted">No logo yet.</span>}
              <button type="button" className="btn small" onClick={() => file.current?.click()}>{b.logo ? "Change logo" : "Upload logo"}</button>
              {b.logo && <button type="button" className="btn small" onClick={() => patch({ logo: "" })}>Remove</button>}
              <input ref={file} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; logo(f); }} />
            </span>
            <small className="muted">PNG or JPEG. It is reduced in size and kept with your settings.</small>
          </div>
          {colour("Main colour (headings, header)", "primary")}
          {colour("Second colour (lines)", "secondary")}
          <label className="doc-field">
            <span>Font</span>
            <select className="input" value={b.font} onChange={(e) => patch({ font: e.target.value as Branding["font"] })}>
              {Object.entries(FONT_NAMES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </label>
          {text("Default header text", "header", { rows: 2, hint: "Up to three lines at the top of every page, beside the logo." })}
          {text("Default footer text", "footer", { rows: 2, hint: "Up to three lines at the foot of every page." })}
        </div>
        <div className="card pad stack">
          <h3>Custom merge fields</h3>
          <p className="muted" style={{ margin: 0 }}>Your own fields for text you reuse, such as an FCA number or bank details. Use them in templates as <code>{"{{custom.key}}"}</code>.</p>
          {b.customFields.map((c, i) => (
            <div className="row-wrap" key={i}>
              <input className="input" style={{ maxWidth: 130 }} aria-label="Field key" placeholder="key" value={c.key} onChange={(e) => patch({ customFields: b.customFields.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)) })} />
              <input className="input" style={{ maxWidth: 160 }} aria-label="Field label" placeholder="Label" value={c.label} onChange={(e) => patch({ customFields: b.customFields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <input className="input" aria-label="Field value" placeholder="Value" value={c.value} onChange={(e) => patch({ customFields: b.customFields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <button type="button" className="iconbtn small" aria-label="Remove field" onClick={() => patch({ customFields: b.customFields.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div><button type="button" className="btn small" onClick={() => patch({ customFields: [...b.customFields, { key: "", label: "", value: "" }] })}>Add a field</button></div>
        </div>
      </div>

      <div className="card pad">
        <h3>How a letter will look</h3>
        <div className="brand-sample" style={{ ["--doc-primary" as string]: b.primary, ["--doc-secondary" as string]: b.secondary, fontFamily: b.font === "serif" ? "Times New Roman, serif" : b.font === "mono" ? "Courier New, monospace" : "Helvetica, Arial, sans-serif" }}>
          <div className="brand-sample-head">
            <div><strong>{displayName(b) || "Your practice name"}</strong><div>{b.header}</div></div>
            {b.logo && <img src={b.logo} alt="" />}
          </div>
          <h4>Engagement letter</h4>
          <p>Dear Client, thank you for your instructions…</p>
          <div className="brand-sample-foot"><span>{b.footer || b.registration}</span><span>Page 1 of 1</span></div>
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn primary" disabled={!dirty || state === "saving" || set.profiles.some((p) => !HEX.test(p.primary) || !HEX.test(p.secondary))} onClick={save}>{state === "saving" ? "Saving…" : "Save branding"}</button>
        {state === "saved" && !dirty && <span className="muted" role="status">Saved.</span>}
        {error && <span className="error-text" role="alert">{error}</span>}
      </div>
    </div>
  );
}
