// Documents › Templates: the library (starter templates and the practice's own, by category, with
// default, duplicate and archive) and the template editor (name, category, branding profile, the
// editor itself, earlier versions to look at or restore, and a preview as a PDF).
import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES, Category, DocTemplate, TemplateVersion, blankTemplate, copyTemplate, restoreVersion, STARTERS } from "../lib/docTemplates";
import { DocContent, DocLayout, plainText } from "../lib/docModel";
import { fieldsFor, fillContent, resolveValues } from "../lib/docFields";
import { fmtDate } from "../lib/domain";
import { go, href } from "./bits";
import { DocEditor } from "./DocEditor";
import { PdfPreview } from "./DocsPreview";
import { TooBig, makePdf, useDocs, useFieldCtx, useLeaveGuard } from "./docsKit";
import { useData } from "./data";

const when = (iso?: string) => (iso ? fmtDate(iso.slice(0, 10)) : "");

export function TemplateLibrary() {
  const docs = useDocs();
  const [cat, setCat] = useState<Category | "">("");
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const own = useMemo(() => docs.templates.filter((t) => (archived || !t.archived)), [docs.templates, archived]);
  const match = (t: DocTemplate) => (!cat || t.category === cat) && (!q.trim() || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q.trim().toLowerCase()));
  const mine = own.filter(match);
  const starters = STARTERS.filter(match);

  const act = async (id: string, work: () => Promise<unknown>, fail: string) => {
    setBusy(id);
    setError("");
    try { await work(); } catch (e) { setError(e instanceof TooBig ? e.message : fail); } finally { setBusy(""); }
  };
  const duplicate = (t: DocTemplate) => act(t.id, async () => { const c = await docs.saveTemplate(copyTemplate(t)); go(`/comms/documents/template/${c.id}`); }, "Couldn't copy the template.");

  const Row = ({ t }: { t: DocTemplate }) => (
    <tr className={t.archived ? "archived" : ""}>
      <td>
        <strong>{t.name}</strong> {t.isDefault && <span className="chip blue">Default</span>} {t.archived && <span className="chip">Archived</span>} {t.starter && <span className="chip dashed">Starter</span>}
        <div className="muted">{t.description}</div>
      </td>
      <td>{t.category}</td>
      <td className="num">{t.starter ? "" : `v${t.version}`}</td>
      <td>{t.starter ? "" : when(t.updated)}</td>
      <td>
        <span className="row-wrap">
          {!t.archived && <a className="btn small primary" href={href("comms", "documents", "new") + `?template=${encodeURIComponent(t.id)}`}>Use</a>}
          <a className="btn small" href={href("comms", "documents", "template", t.id)}>{t.starter ? "Customise" : "Edit"}</a>
          {!t.starter && <button type="button" className="btn small" disabled={busy === t.id} onClick={() => duplicate(t)}>Duplicate</button>}
          {!t.starter && !t.archived && !t.isDefault && <button type="button" className="btn small" disabled={busy === t.id} onClick={() => act(t.id, () => docs.makeDefault(t), "Couldn't set the default.")}>Make default</button>}
          {!t.starter && <button type="button" className="btn small" disabled={busy === t.id} onClick={() => act(t.id, () => docs.patchTemplate(t.id, { Archived: !t.archived, IsDefault: false }), "Couldn't change the template.")}>{t.archived ? "Restore" : "Archive"}</button>}
        </span>
      </td>
    </tr>
  );

  return (
    <div className="stack">
      <div className="row-wrap">
        <input className="input search" type="search" placeholder="Search templates" aria-label="Search templates" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value as Category | "")}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived</label>
        <span style={{ flex: 1 }} />
        <a className="btn primary" href={href("comms", "documents", "template", "new")}>New template</a>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <h3>Your templates</h3>
      {mine.length ? (
        <div className="table-wrap"><table className="bank-table"><thead><tr><th>Template</th><th>Category</th><th>Version</th><th>Updated</th><th /></tr></thead><tbody>{mine.map((t) => <Row key={t.id} t={t} />)}</tbody></table></div>
      ) : (
        <p className="muted">{docs.templates.length ? "No templates match." : "You haven't made any templates yet. Customise a starter below, or start a new one."}</p>
      )}
      <h3>Starter templates</h3>
      {starters.length ? (
        <div className="table-wrap"><table className="bank-table"><thead><tr><th>Template</th><th>Category</th><th /><th /><th /></tr></thead><tbody>{starters.map((t) => <Row key={t.id} t={t} />)}</tbody></table></div>
      ) : <p className="muted">No starter templates match.</p>}
    </div>
  );
}

/** Edits one template. `id` is a saved template, a starter (edited as a copy) or "new". */
export function TemplateEditor({ id }: { id: string }) {
  const docs = useDocs();
  const { data } = useData();
  const ctxFor = useFieldCtx();
  const original = useMemo<DocTemplate | undefined>(() => {
    if (id === "new") return undefined;
    return docs.templates.find((t) => t.id === id) || STARTERS.find((t) => t.id === id);
  }, [id, docs.templates]);
  const [t, setT] = useState<DocTemplate>(() => original?.starter ? copyTemplate(original) : original || blankTemplate());
  const [created, setCreated] = useState(!!original && !original.starter);
  const [loadedId, setLoadedId] = useState(t.id);
  const [resetKey, setResetKey] = useState("0");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<Uint8Array | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [sampleClient, setSampleClient] = useState("");
  const [showVersions, setShowVersions] = useState(false);
  const content = useRef<DocContent>(t.content);

  // a template opened after the lists finish loading
  useEffect(() => {
    if (original && !original.starter && !dirty && original.id !== loadedId) { setT(original); content.current = original.content; setLoadedId(original.id); setCreated(true); setResetKey(original.id); }
  }, [original, dirty, loadedId]);
  useLeaveGuard(dirty);

  const branding = docs.brand(t.brandingId);
  const fields = useMemo(() => fieldsFor(branding), [branding]);
  const versions = docs.versions.filter((v) => v.templateId === t.id).sort((a, b) => b.version - a.version);
  const edit = (p: Partial<DocTemplate>) => { setT((x) => ({ ...x, ...p })); setDirty(true); setState("idle"); };

  const save = async () => {
    setState("saving");
    setError("");
    try {
      const body = { ...t, content: content.current };
      if (!body.name.trim()) throw new Error("Give the template a name first.");
      const saved = created ? await docs.saveTemplate(body, { name: body.name.trim(), category: body.category, description: body.description, content: body.content, layout: body.layout, brandingId: body.brandingId }) : await docs.saveTemplate(body);
      setT(saved);
      setLoadedId(saved.id);
      setCreated(true);
      setDirty(false);
      setState("saved");
      if (id !== saved.id) window.history.replaceState(null, "", href("comms", "documents", "template", saved.id));
    } catch (e) {
      setState("idle");
      setError(e instanceof TooBig || (e instanceof Error && /name/.test(e.message)) ? (e as Error).message : "Couldn't save the template. Try again.");
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    setError("");
    try {
      const ctx = ctxFor(sampleClient, "", branding, "SAMPLE");
      const values = resolveValues(ctx);
      const filled = sampleClient ? fillContent(content.current, values) : content.current;
      const out = await makePdf({ content: filled, layout: t.layout, branding, title: t.name, reference: "SAMPLE" });
      setPreview(out.bytes);
    } catch {
      setError("The preview couldn't be made.");
    } finally {
      setPreviewing(false);
    }
  };
  const restore = async (v: TemplateVersion) => {
    if (dirty && !window.confirm("You have unsaved changes. Restoring will replace them. Continue?")) return;
    try {
      const { next } = restoreVersion(t, v);
      const saved = await docs.saveTemplate(t, { name: next.name, content: next.content, layout: next.layout });
      setT(saved);
      content.current = saved.content;
      setResetKey(`${saved.id}-${saved.version}`);
      setDirty(false);
    } catch {
      setError("Couldn't restore that version.");
    }
  };

  return (
    <div className="stack">
      <div className="card pad doc-meta">
        <label className="doc-field"><span>Template name</span><input className="input" value={t.name} onChange={(e) => edit({ name: e.target.value })} /></label>
        <label className="doc-field"><span>Category</span>
          <select className="input" value={t.category} onChange={(e) => edit({ category: e.target.value as Category })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label className="doc-field"><span>Branding</span>
          <select className="input" value={t.brandingId || ""} onChange={(e) => edit({ brandingId: e.target.value || undefined })}>
            <option value="">Practice default</option>
            {docs.set.profiles.map((p) => <option key={p.id} value={p.id}>{p.profileName}</option>)}
          </select>
        </label>
        <label className="doc-field wide"><span>Description</span><input className="input" value={t.description} onChange={(e) => edit({ description: e.target.value })} placeholder="When to use this template" /></label>
      </div>

      <DocEditor
        value={t.content}
        resetKey={resetKey}
        onChange={(c) => { content.current = c; setDirty(true); setState("idle"); }}
        layout={t.layout}
        onLayout={(l: DocLayout) => edit({ layout: l })}
        fields={fields}
        branding={branding}
      />

      <div className="form-actions">
        <button type="button" className="btn primary" onClick={save} disabled={state === "saving"}>{state === "saving" ? "Saving…" : created ? "Save template" : "Save to my templates"}</button>
        <a className="btn" href={href("comms", "documents", "templates")}>Back to templates</a>
        {created && <a className="btn" href={href("comms", "documents", "new") + `?template=${encodeURIComponent(t.id)}`}>Use this template</a>}
        {state === "saved" && !dirty && <span className="muted" role="status">Saved{created ? ` as version ${t.version}` : ""}.</span>}
        {dirty && <span className="muted">Unsaved changes</span>}
        {error && <span className="error-text" role="alert">{error}</span>}
      </div>

      <div className="card pad stack">
        <div className="row-wrap">
          <h3 style={{ margin: 0 }}>Preview as a PDF</h3>
          <select className="input" aria-label="Fill the merge fields from" value={sampleClient} onChange={(e) => setSampleClient(e.target.value)}>
            <option value="">Show merge fields as they are</option>
            {data.clients.map((c) => <option key={c.Key} value={c.Key}>Fill in for {c.Title}</option>)}
          </select>
          <button type="button" className="btn small" disabled={previewing} onClick={runPreview}>{previewing ? "Making preview…" : "Preview"}</button>
        </div>
        {preview && <PdfPreview bytes={preview} />}
      </div>

      {created && (
        <div className="card pad stack">
          <div className="row-wrap">
            <h3 style={{ margin: 0 }}>Versions</h3>
            <span className="muted">Current version {t.version}. A new version is kept each time the text or layout changes.</span>
            <button type="button" className="btn small" onClick={() => setShowVersions(!showVersions)}>{showVersions ? "Hide" : `Show earlier versions (${versions.length})`}</button>
          </div>
          {showVersions && (versions.length ? (
            <table className="bank-table"><thead><tr><th>Version</th><th>Saved</th><th>Starts with</th><th /></tr></thead><tbody>
              {versions.map((v) => (
                <tr key={v.version}><td className="num">v{v.version}</td><td>{when(v.saved)}</td><td className="muted">{plainText(v.content).slice(0, 90)}</td>
                  <td><button type="button" className="btn small" onClick={() => restore(v)}>Restore as new version</button></td></tr>
              ))}
            </tbody></table>
          ) : <p className="muted">There are no earlier versions yet.</p>)}
        </div>
      )}
    </div>
  );
}
