// Checklists › Templates: the library (the practice's templates and the starters), the builder (sections, items,
// dependencies, conditions, drag and drop, preview) and Team and rules (who is who, independent review, overrides).
import { useEffect, useMemo, useRef, useState } from "react";
import * as C from "../lib/checklist";
import { Rule, TItem, TSection, Template } from "../lib/checklist";
import { starterTemplate } from "../lib/checklistRows";
import { STARTERS, suits } from "../lib/checklistStarters";
import { SECTIONS } from "../lib/papers";
import { downloadFile } from "./commsKit";
import { fmtDate } from "../lib/domain";
import { Icon, go, href } from "./bits";
import { Conflict, Refused, useChecklists } from "./checklistKit";
import { useLeaveGuard } from "./docsKit";
import { useData } from "./data";

const when = (iso?: string) => (iso ? fmtDate(iso.slice(0, 10)) : "");
const say = (e: unknown, fallback: string) => (e instanceof Refused || e instanceof Conflict ? e.message : fallback);

/* ------------------------------------------------------------------ library */

export function ChecklistLibrary() {
  const cl = useChecklists();
  const { data } = useData();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState("");
  const services = data.services;
  const svcName = (k: string) => String(services.find((s) => s.Key === k)?.Title || "(job type removed)");
  const match = (t: Template) => (!type || t.jobType === type) && (!q.trim() || `${t.name} ${t.description} ${svcName(t.jobType)}`.toLowerCase().includes(q.trim().toLowerCase()));
  const mine = cl.templates.filter((t) => (archived || t.active) && match(t));
  const unused = STARTERS.filter((s) => !cl.templates.some((t) => t.starter === s.starter) && (!q.trim() || `${s.name} ${s.description}`.toLowerCase().includes(q.trim().toLowerCase())));
  const canEdit = C.can(cl.config, cl.me, "template");

  const act = async (id: string, work: () => Promise<unknown>, fail: string) => {
    setBusy(id); setError(""); setInfo("");
    try { await work(); } catch (e) { setError(say(e, fail)); } finally { setBusy(""); }
  };
  const read = (f: File | undefined) => {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => act("import", async () => { const n = await cl.importText(String(r.result || ""), importType || String(services[0]?.Key || "")); setInfo(`Imported ${n} template${n === 1 ? "" : "s"}.`); }, "Couldn't import that file.");
    r.readAsText(f);
    if (file.current) file.current.value = "";
  };

  return (
    <div className="stack">
      {!cl.ready && <p className="import-list warn" role="alert">The checklist lists aren't set up yet. They are added automatically when the planner starts; if this stays, open Setup and choose “Create the lists”.</p>}
      {!canEdit && <p className="muted" style={{ margin: 0 }}>You can look at templates, but only a manager or partner can change them.</p>}
      <div className="row-wrap">
        <input className="input search" type="search" placeholder="Search templates" aria-label="Search templates" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" aria-label="Job type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All job types</option>
          {services.map((s) => <option key={s.Key as string} value={s.Key as string}>{s.Title as string}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived</label>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={() => downloadFile(new TextEncoder().encode(C.exportTemplates(cl.templates.filter((t) => t.active))), "checklist-templates.json", "application/json")} disabled={!cl.templates.length}>Export all</button>
        <select className="input" aria-label="Job type for imported templates" value={importType} onChange={(e) => setImportType(e.target.value)} title="Job type used when the file doesn't name one this practice has">
          <option value="">Import into…</option>
          {services.map((s) => <option key={s.Key as string} value={s.Key as string}>{s.Title as string}</option>)}
        </select>
        <button type="button" className="btn" disabled={!canEdit || busy === "import"} onClick={() => file.current?.click()}>Import</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => read(e.target.files?.[0])} />
        <a className="btn primary" href={href("checklists", "template", "new")} aria-disabled={!canEdit}>New template</a>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {info && <p className="muted" role="status">{info}</p>}

      <h3>Your templates</h3>
      {mine.length ? (
        <div className="table-wrap"><table className="bank-table"><thead><tr><th>Template</th><th>Job type</th><th>For</th><th>Version</th><th>Time</th><th>Updated</th><th /></tr></thead><tbody>
          {mine.map((t) => (
            <tr key={t.id} className={t.active ? "" : "archived"}>
              <td>
                <strong>{t.name}</strong> {t.isDefault && <span className="chip blue">Default</span>} {!t.active && <span className="chip">Archived</span>} {t.when?.length ? <span className="chip dashed">{C.describeRules(t.when)}</span> : null}
                <div className="muted">{t.description}</div>
              </td>
              <td>{svcName(t.jobType)}</td>
              <td>{t.clientKinds.length ? t.clientKinds.map((k) => C.KIND_LABEL[k] || k).join(", ") : "Any client"}</td>
              <td className="num">v{t.version}</td>
              <td className="num">{t.hours ? `${t.hours}h` : ""}</td>
              <td>{when(t.updated)}</td>
              <td><span className="row-wrap">
                <a className="btn small" href={href("checklists", "template", t.id)}>{canEdit ? "Edit" : "View"}</a>
                <a className="btn small" href={href("checklists", "template", t.id) + "?preview=1"}>Preview</a>
                <button type="button" className="btn small" disabled={!canEdit || busy === t.id} onClick={() => act(t.id, async () => { const c = await cl.duplicate(t); go(`/checklists/template/${c.id}`); }, "Couldn't copy the template.")}>Duplicate</button>
                {t.active && !t.isDefault && <button type="button" className="btn small" disabled={!canEdit || busy === t.id} onClick={() => act(t.id, () => cl.makeDefault(t), "Couldn't set the default.")}>Make default</button>}
                <button type="button" className="btn small" disabled={!canEdit || busy === t.id} onClick={() => act(t.id, () => cl.patchTemplate(t.id, { Active: !t.active, IsDefault: false }), "Couldn't change the template.")}>{t.active ? "Archive" : "Restore"}</button>
                <button type="button" className="btn small" onClick={() => downloadFile(new TextEncoder().encode(C.exportTemplates([t])), `${t.name.replace(/[^\w -]+/g, "")}.json`, "application/json")}>Export</button>
              </span></td>
            </tr>
          ))}
        </tbody></table></div>
      ) : <p className="muted">{cl.templates.length ? "No templates match." : "You haven't saved any templates yet. Until you do, new jobs use the matching starter below automatically. Save the starters to make them yours to edit."}</p>}

      <div className="row-wrap">
        <h3 style={{ margin: 0 }}>Starter templates</h3>
        <button type="button" className="btn small" disabled={!canEdit || busy === "starters" || !unused.length} onClick={() => act("starters", async () => { const r = await cl.installStarters(); setInfo(`${r.made.length ? `Saved ${r.made.length} starter${r.made.length === 1 ? "" : "s"} as your own templates.` : "Nothing new to save."}${r.skipped.length ? ` No matching job type for: ${r.skipped.join(", ")}.` : ""}`); }, "Couldn't save the starters.")}>Save all starters as my templates</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>Example workflows, not a complete compliance checklist. Edit them or replace them with your own.</p>
      {unused.length ? (
        <div className="table-wrap"><table className="bank-table"><thead><tr><th>Starter</th><th>Items</th><th /></tr></thead><tbody>
          {unused.map((s) => {
            const svc = services.find((x) => suits(s, String(x.Title || "")));
            return (
              <tr key={s.starter}>
                <td><strong>{s.name}</strong> <span className="chip dashed">Starter</span><div className="muted">{s.description}</div></td>
                <td className="num">{C.allItems(s).length}</td>
                <td><span className="row-wrap">
                  <a className="btn small" href={href("checklists", "template", `starter:${s.starter}`) + "?preview=1"}>Preview</a>
                  <button type="button" className="btn small primary" disabled={!canEdit || !services.length || busy === s.starter} onClick={() => act(s.starter, async () => {
                    const t = await cl.saveTemplate({ ...(starterTemplate(s.starter, String(svc?.Key || services[0]?.Key || ""))!), id: `CT-${s.starter}-${Date.now().toString(36)}`, isDefault: !cl.templates.some((x) => x.jobType === String(svc?.Key) && x.isDefault && !!x.when?.length === !!s.when?.length) });
                    go(`/checklists/template/${t.id}`);
                  }, "Couldn't save the starter.")}>Customise</button>
                </span></td>
              </tr>
            );
          })}
        </tbody></table></div>
      ) : <p className="muted">All the starters are already saved, or none match your search.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ rule editor */

function RuleEditor({ rules, onChange, label }: { rules: Rule[] | undefined; onChange: (r: Rule[] | undefined) => void; label: string }) {
  const list = rules || [];
  const set = (n: number, r: Rule) => onChange(list.map((x, i) => (i === n ? r : x)));
  const remove = (n: number) => { const next = list.filter((_, i) => i !== n); onChange(next.length ? next : undefined); };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="cl-label">{label}</span>
      {list.map((r, n) => (
        <div key={n} className="row-wrap">
          <select className="input" aria-label="Test" value={r.attr} onChange={(e) => set(n, e.target.value === "kind" ? { attr: "kind", in: ["Ltd"] } : { attr: e.target.value, is: true })}>
            {C.ATTRS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          {r.attr === "kind" ? (
            <span className="row-wrap">{C.KINDS.map((k) => (
              <label key={k} className="check"><input type="checkbox" checked={!!r.in?.includes(k)} onChange={(e) => set(n, { attr: "kind", in: e.target.checked ? [...(r.in || []), k] : (r.in || []).filter((x) => x !== k) })} /> {C.KIND_LABEL[k]}</label>
            ))}</span>
          ) : (
            <select className="input" aria-label="Must be" value={r.is === false ? "no" : "yes"} onChange={(e) => set(n, { attr: r.attr, is: e.target.value === "yes" })}>
              <option value="yes">is yes</option><option value="no">is no</option>
            </select>
          )}
          <button type="button" className="linkbtn danger-link" onClick={() => remove(n)}>Remove</button>
        </div>
      ))}
      <div><button type="button" className="btn small" onClick={() => onChange([...list, { attr: "vat", is: true }])}><Icon name="plus" size={14} />Add a condition</button></div>
    </div>
  );
}

/* ------------------------------------------------------------------ builder */

const blank = (jobType: string): Template => ({
  id: `CT-new-${Date.now().toString(36)}`, name: "", description: "", jobType, clientKinds: [], version: 1, active: true, isDefault: false, hours: 0,
  sections: [{ id: C.newId("s"), title: "Preparation", items: [] }],
});
const blankItem = (): TItem => ({ id: C.newId("i"), title: "", mandatory: true, hours: 0.25, after: [], role: "preparer" });

export function ChecklistBuilder({ id }: { id: string }) {
  const cl = useChecklists();
  const { data } = useData();
  const original = useMemo<Template | undefined>(() => {
    if (id === "new") return undefined;
    if (id.startsWith("starter:")) { const s = STARTERS.find((x) => `starter:${x.starter}` === id); return s ? starterTemplate(s.starter, String(data.services[0]?.Key || "")) : undefined; }
    return cl.templates.find((t) => t.id === id);
  }, [id, cl.templates, data.services]);
  const [t, setT] = useState<Template>(() => original || blank(String(data.services[0]?.Key || "")));
  const [loaded, setLoaded] = useState(original?.id || "");
  const [saved, setSaved] = useState(!!original && !id.startsWith("starter:"));
  const [dirty, setDirty] = useState(id === "new" || id.startsWith("starter:"));
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState(() => new URLSearchParams(window.location.hash.split("?")[1] || "").get("preview") === "1");
  const dragRef = useRef<{ s: number; i: number } | null>(null);
  const setDrag = (v: { s: number; i: number } | null) => { dragRef.current = v; };
  const [showVersions, setShowVersions] = useState(false);
  const canEdit = C.can(cl.config, cl.me, "template");
  useLeaveGuard(dirty && canEdit, "You have unsaved changes to this template. Leave without saving?");
  useEffect(() => {
    if (original && !dirty && original.id !== loaded) { setT(original); setLoaded(original.id); setSaved(true); }
  }, [original, dirty, loaded]);

  const edit = (p: Partial<Template>) => { setT((x) => ({ ...x, ...p })); setDirty(true); setState("idle"); };
  const setSections = (f: (s: TSection[]) => TSection[]) => edit({ sections: f(t.sections) });
  const setItem = (s: number, i: number, p: Partial<TItem>) => setSections((all) => all.map((sec, a) => (a === s ? { ...sec, items: sec.items.map((it, b) => (b === i ? { ...it, ...p } : it)) } : sec)));
  const all = C.allItems(t);
  const move = (from: { s: number; i: number }, to: { s: number; i: number }) => setSections((secs) => {
    const next = secs.map((s) => ({ ...s, items: [...s.items] }));
    const [it] = next[from.s].items.splice(from.i, 1);
    const idx = from.s === to.s && from.i < to.i ? to.i - 1 : to.i;
    next[to.s].items.splice(Math.max(0, idx), 0, it);
    return next;
  });
  const swapSection = (a: number, b: number) => setSections((secs) => { if (b < 0 || b >= secs.length) return secs; const n = [...secs]; [n[a], n[b]] = [n[b], n[a]]; return n; });
  const removeItem = (s: number, i: number) => {
    const gone = t.sections[s].items[i];
    setSections((secs) => secs.map((sec, a) => ({ ...sec, items: sec.items.filter((_, b) => !(a === s && b === i)).map((x) => ({ ...x, after: x.after.filter((d) => d !== gone.id) })) })));
  };

  const problems = C.validateTemplate(t);
  const save = async () => {
    setError("");
    setState("saving");
    try {
      const clean = { ...t, sections: t.sections.map((s) => ({ ...s, items: s.items.map(C.cleanItem) })) };
      const next = await cl.saveTemplate(saved ? clean : { ...clean, id: t.id.startsWith("CT-new") ? `CT-${Date.now().toString(36)}` : t.id });
      setT(next); setLoaded(next.id); setSaved(true); setDirty(false); setState("saved");
      if (id !== next.id) window.history.replaceState(null, "", href("checklists", "template", next.id));
    } catch (e) { setError(say(e, "Couldn't save the template. Try again.")); setState("idle"); }
  };

  const versions = saved ? cl.versions(t.id) : [];
  const willBump = saved && original && JSON.stringify([original.sections, original.when, original.clientKinds, original.jobType]) !== JSON.stringify([t.sections, t.when, t.clientKinds, t.jobType]);

  return (
    <div className="stack cl-builder">
      <div className="row-wrap">
        <a className="linkbtn" href={href("checklists", "templates")}>← Templates</a>
        <span style={{ flex: 1 }} />
        <span className="muted">{saved ? `Version ${t.version}` : "Not saved yet"}{state === "saved" ? " · Saved" : dirty ? " · Unsaved changes" : ""}</span>
        <button type="button" className={`btn${preview ? " primary" : ""}`} onClick={() => setPreview((v) => !v)}>{preview ? "Hide preview" : "Preview"}</button>
        <button type="button" className="btn primary" onClick={save} disabled={!canEdit || state === "saving" || !dirty}>{state === "saving" ? "Saving…" : "Save template"}</button>
      </div>
      {!canEdit && <p className="muted" style={{ margin: 0 }}>Only a manager or partner can change templates. You can look and preview.</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {dirty && problems.length > 0 && <ul className="import-list warn" aria-label="To fix before saving">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {willBump && <p className="muted" style={{ margin: 0 }}>Changing the steps or rules saves this as version {t.version + 1}. Checklists already on jobs keep the version they were made from; you can offer them the update from the job.</p>}

      <section className="card pad stack" aria-label="Template details">
        <div className="cl-grid">
          <label className="doc-field"><span>Template name</span><input className="input" value={t.name} disabled={!canEdit} onChange={(e) => edit({ name: e.target.value })} /></label>
          <label className="doc-field"><span>Job type</span>
            <select className="input" value={t.jobType} disabled={!canEdit} onChange={(e) => edit({ jobType: e.target.value })}>
              <option value="">Choose…</option>
              {data.services.map((s) => <option key={s.Key as string} value={s.Key as string}>{s.Title as string}</option>)}
            </select>
          </label>
          <label className="doc-field"><span>Estimated time</span><input className="input" value={`${C.templateHours(t)} hours (from the items)`} disabled /></label>
        </div>
        <label className="doc-field"><span>Description</span><textarea className="input" rows={2} value={t.description} disabled={!canEdit} onChange={(e) => edit({ description: e.target.value })} /></label>
        <div className="stack" style={{ gap: 6 }}>
          <span className="cl-label">Applies to these client types (none ticked means any)</span>
          <span className="row-wrap">{C.KINDS.map((k) => (
            <label key={k} className="check"><input type="checkbox" disabled={!canEdit} checked={t.clientKinds.includes(k)} onChange={(e) => edit({ clientKinds: e.target.checked ? [...t.clientKinds, k] : t.clientKinds.filter((x) => x !== k) })} /> {C.KIND_LABEL[k]}</label>
          ))}</span>
        </div>
        <RuleEditor label="Use this template only when… (for example a dormant company workflow)" rules={t.when} onChange={(r) => edit({ when: r })} />
        <label className="check"><input type="checkbox" checked={t.active} disabled={!canEdit} onChange={(e) => edit({ active: e.target.checked })} /> Active (archived templates aren't offered to new jobs)</label>
        {saved && <div><button type="button" className="linkbtn" onClick={() => setShowVersions((v) => !v)}>{showVersions ? "Hide" : "Show"} earlier versions ({versions.length})</button>
          {showVersions && <ul className="cl-versions">{versions.length ? versions.map((v) => <li key={String(v.Key)}>Version {String(v.Version)}, saved {when(String(v.Saved))}</li>) : <li className="muted">None yet. A version is kept whenever the steps or rules change.</li>}</ul>}</div>}
      </section>

      {preview && <Preview t={t} />}

      {t.sections.map((sec, s) => (
        <section key={sec.id} className="card pad stack cl-section" aria-label={`Section ${sec.title || s + 1}`}
          onDragOver={(e) => { if (dragRef.current) e.preventDefault(); }} onDrop={(e) => { const d = dragRef.current; if (d && !(e.target as HTMLElement).closest(".cl-item")) { e.preventDefault(); move(d, { s, i: sec.items.length }); setDrag(null); } }}>
          <div className="row-wrap">
            <input className="input cl-section-title" aria-label="Section title" placeholder="Section title" value={sec.title} disabled={!canEdit} onChange={(e) => setSections((a) => a.map((x, i) => (i === s ? { ...x, title: e.target.value } : x)))} />
            <span style={{ flex: 1 }} />
            <button type="button" className="btn small" disabled={!canEdit || s === 0} onClick={() => swapSection(s, s - 1)} aria-label="Move section up"><Icon name="up" size={14} /></button>
            <button type="button" className="btn small" disabled={!canEdit || s === t.sections.length - 1} onClick={() => swapSection(s, s + 1)} aria-label="Move section down"><Icon name="down" size={14} /></button>
            <button type="button" className="btn small" disabled={!canEdit} onClick={() => { if (!sec.items.length || window.confirm(`Delete the section "${sec.title}" and its ${sec.items.length} items?`)) setSections((a) => a.filter((_, i) => i !== s).map((x) => ({ ...x, items: x.items.map((it) => ({ ...it, after: it.after.filter((d) => !sec.items.some((g) => g.id === d)) })) }))); }}>Delete section</button>
          </div>
          {sec.items.map((it, i) => {
            const isOpen = open.has(it.id);
            const others = all.filter((o) => o.id !== it.id);
            return (
              <div key={it.id} className={`cl-item${isOpen ? " open" : ""}`} draggable={canEdit} onDragStart={() => setDrag({ s, i })} onDragEnd={() => setDrag(null)}
                onDragOver={(e) => { if (dragRef.current) e.preventDefault(); }} onDrop={(e) => { const d = dragRef.current; if (d) { e.preventDefault(); e.stopPropagation(); move(d, { s, i }); setDrag(null); } }}>
                <div className="cl-item-row">
                  <span className="cl-grip" aria-hidden="true"><Icon name="grip" size={16} /></span>
                  <input className="input cl-title" aria-label="Item title" placeholder="What needs doing" value={it.title} disabled={!canEdit} onChange={(e) => setItem(s, i, { title: e.target.value })} />
                  <label className="check" title="A mandatory item can't be skipped without an authorised override"><input type="checkbox" checked={it.mandatory} disabled={!canEdit} onChange={(e) => setItem(s, i, { mandatory: e.target.checked })} /> Mandatory</label>
                  <input className="input cl-hours" type="number" min="0" step="0.25" aria-label="Estimated hours" value={it.hours} disabled={!canEdit} onChange={(e) => setItem(s, i, { hours: Number(e.target.value) })} title="Estimated hours" />
                  <select className="input cl-role" aria-label="Default role" value={it.role || ""} disabled={!canEdit} onChange={(e) => setItem(s, i, { role: e.target.value as TItem["role"] })}>
                    <option value="">No default role</option>{C.ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                  <button type="button" className="btn small" aria-label="Move item up" disabled={!canEdit || (s === 0 && i === 0)} onClick={() => move({ s, i }, i > 0 ? { s, i: i - 1 } : { s: s - 1, i: t.sections[s - 1].items.length })}><Icon name="up" size={14} /></button>
                  <button type="button" className="btn small" aria-label="Move item down" disabled={!canEdit || (s === t.sections.length - 1 && i === sec.items.length - 1)} onClick={() => move({ s, i }, i < sec.items.length - 1 ? { s, i: i + 2 } : { s: s + 1, i: 0 })}><Icon name="down" size={14} /></button>
                  <button type="button" className="btn small" aria-expanded={isOpen} onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; })}>{isOpen ? "Less" : "More"}</button>
                  <button type="button" className="btn small" aria-label="Delete item" disabled={!canEdit} onClick={() => removeItem(s, i)}><Icon name="close" size={14} /></button>
                </div>
                <div className="cl-badges">
                  {it.after.length > 0 && <span className="chip">after {it.after.length}</span>}
                  {it.when?.length ? <span className="chip dashed">{C.describeRules(it.when)}</span> : null}
                  {it.review && <span className="chip blue">{it.review === "approve" ? "Final approval" : "Review step"}</span>}
                  {it.paper && <span className="chip">Paper: {SECTIONS.find((x) => x.key === it.paper!.section)?.title || it.paper.section}</span>}
                  {it.needsClient && <span className="chip amber">Needs client info</span>}
                </div>
                {isOpen && (
                  <div className="cl-more stack">
                    <label className="doc-field"><span>Description or instructions</span><textarea className="input" rows={2} value={it.description || ""} disabled={!canEdit} onChange={(e) => setItem(s, i, { description: e.target.value })} /></label>
                    <div className="cl-grid">
                      <label className="doc-field"><span>Guidance note</span><textarea className="input" rows={2} value={it.guidance || ""} disabled={!canEdit} onChange={(e) => setItem(s, i, { guidance: e.target.value })} /></label>
                      <label className="doc-field"><span>Link to guidance (web address)</span><input className="input" value={it.link || ""} placeholder="https://…" disabled={!canEdit} onChange={(e) => setItem(s, i, { link: e.target.value })} /></label>
                      <label className="doc-field"><span>Information needed from the client</span><input className="input" value={it.needsClient || ""} placeholder="e.g. Bank statements" disabled={!canEdit} onChange={(e) => setItem(s, i, { needsClient: e.target.value })} /></label>
                      <label className="doc-field"><span>Expected by job stage</span><input className="input" value={it.stage || ""} placeholder="e.g. Draft accounts" disabled={!canEdit} onChange={(e) => setItem(s, i, { stage: e.target.value })} /></label>
                      <label className="doc-field"><span>Linked working paper</span>
                        <select className="input" value={it.paper?.section || ""} disabled={!canEdit} onChange={(e) => setItem(s, i, { paper: e.target.value ? { section: e.target.value } : undefined })}>
                          <option value="">None</option>{SECTIONS.map((x) => <option key={x.key} value={x.key}>{x.group}: {x.title}</option>)}
                        </select>
                      </label>
                      <label className="doc-field"><span>Review step</span>
                        <select className="input" value={it.review || ""} disabled={!canEdit} onChange={(e) => setItem(s, i, { review: e.target.value as TItem["review"] })}>
                          <option value="">Not a review step</option><option value="review">Review (a reviewer completes it)</option><option value="approve">Final approval</option>
                        </select>
                      </label>
                    </div>
                    <fieldset className="cl-deps"><legend>Can't be completed until these are finished</legend>
                      {others.length ? <div className="cl-dep-list">{others.map((o) => (
                        <label key={o.id} className="check"><input type="checkbox" disabled={!canEdit} checked={it.after.includes(o.id)} onChange={(e) => setItem(s, i, { after: e.target.checked ? [...it.after, o.id] : it.after.filter((d) => d !== o.id) })} /> {o.title || "(untitled)"}</label>
                      ))}</div> : <span className="muted">Add other items first.</span>}
                    </fieldset>
                    <RuleEditor label="Include this item only when…" rules={it.when} onChange={(r) => setItem(s, i, { when: r })} />
                  </div>
                )}
              </div>
            );
          })}
          <div><button type="button" className="btn small" disabled={!canEdit} onClick={() => { const n = blankItem(); setSections((a) => a.map((x, k) => (k === s ? { ...x, items: [...x.items, n] } : x))); setOpen((o) => new Set(o).add(n.id)); }}><Icon name="plus" size={14} />Add item</button></div>
        </section>
      ))}
      <div><button type="button" className="btn" disabled={!canEdit} onClick={() => setSections((a) => [...a, { id: C.newId("s"), title: "", items: [] }])}><Icon name="plus" size={14} />Add section</button></div>
    </div>
  );
}

/** What a job would get from this template, for a client with the answers chosen here. */
function Preview({ t }: { t: Template }) {
  const [facts, setFacts] = useState<C.Facts>({ kind: t.clientKinds[0] || "Ltd", vat: "yes", payroll: "no", fixedAssets: "yes", dormant: "no", outsourced: "no" });
  const built = useMemo(() => C.generate(t, facts, { now: new Date().toISOString(), by: "Preview" }), [t, facts]);
  const secs = [...new Set(built.items.map((i) => i.section))];
  return (
    <section className="card pad stack" aria-label="Preview">
      <h3 style={{ margin: 0 }}>Preview</h3>
      <p className="muted" style={{ margin: 0 }}>How the checklist would look for a client like this. Set an answer to “not known” to see the questions a user would be asked.</p>
      <div className="row-wrap">
        <label className="doc-field"><span>Client type</span><select className="input" value={facts.kind} onChange={(e) => setFacts({ ...facts, kind: e.target.value })}>{C.KINDS.map((k) => <option key={k} value={k}>{C.KIND_LABEL[k]}</option>)}</select></label>
        {C.ATTRS.filter((a) => a.kind !== "choice").map((a) => (
          <label key={a.key} className="doc-field"><span>{a.label}</span>
            <select className="input" value={(facts as unknown as Record<string, string>)[a.key]} onChange={(e) => setFacts({ ...facts, [a.key]: e.target.value } as C.Facts)}><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Not known</option></select>
          </label>
        ))}
      </div>
      {secs.map((s) => (
        <div key={s}><strong>{s}</strong>
          <ul className="cl-preview">{built.items.filter((i) => i.section === s).map((i) => (
            <li key={i.itemId} className={i.status === "na" ? "na" : ""}>
              {i.title} {!i.mandatory && <span className="chip">Optional</span>} {i.status === "na" && <span className="chip">Not applicable</span>} {i.status === "confirm" && <span className="chip amber">To confirm</span>} {i.review && <span className="chip blue">Review</span>}
              {i.hours ? <span className="muted"> · {i.hours}h</span> : null}
            </li>
          ))}</ul>
        </div>
      ))}
    </section>
  );
}

/* ------------------------------------------------------------------ team and rules */

export function TeamSettings() {
  const cl = useChecklists();
  const [cfg, setCfg] = useState<C.Config>(cl.config);
  const [name, setName] = useState("");
  const [role, setRole] = useState<C.Role>("preparer");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setCfg(cl.config); }, [cl.config, dirty]);
  useLeaveGuard(dirty, "You have unsaved changes to the team settings. Leave without saving?");
  const set = (p: Partial<C.Config>) => { setCfg((c) => ({ ...c, ...p })); setDirty(true); setState("idle"); };
  const add = () => {
    const n = name.trim();
    if (!n) return;
    if (cfg.staff.some((s) => s.name.toLowerCase() === n.toLowerCase())) { setError("That person is already on the list."); return; }
    setError(""); set({ staff: [...cfg.staff, { name: n, role }] }); setName("");
  };
  const save = async () => {
    setState("saving"); setError("");
    try {
      if (cfg.staff.length && !cfg.staff.some((s) => s.role === "partner" || s.role === "manager")) throw new Refused("Add at least one manager or partner, or no one will be able to change templates or approve work.");
      if (cfg.staff.length && cl.me && !cfg.staff.some((s) => s.name.toLowerCase() === cl.me.toLowerCase() && (s.role === "partner" || s.role === "manager")) && !C.hasStaff(cl.config)) throw new Refused(`You're signed in as ${cl.me}. Add yourself as a manager or partner, or you'll lock yourself out of these settings.`);
      await cl.saveConfig({ ...cfg, overriders: cfg.overriders.filter((o) => cfg.staff.some((s) => s.name === o)) });
      setDirty(false); setState("saved");
    } catch (e) { setError(say(e, "Couldn't save.")); setState("idle"); }
  };
  const allowed = !C.hasStaff(cl.config) || C.can(cl.config, cl.me, "template");
  return (
    <div className="stack">
      <section className="card pad stack">
        <h3 style={{ margin: 0 }}>People and roles</h3>
        <p className="muted" style={{ margin: 0 }}>Roles decide who can review, approve, reopen finished work, skip a mandatory item and change templates. Anyone can complete their own items. Until someone is added, everyone can do everything, which suits a one-person practice. You are signed in as <strong>{cl.me || "an unknown user"}</strong>; names are matched to the sign-in name.</p>
        {cfg.staff.length > 0 && <table className="bank-table"><thead><tr><th>Name</th><th>Role</th><th>May override a mandatory item</th><th /></tr></thead><tbody>
          {cfg.staff.map((s) => (
            <tr key={s.name}>
              <td>{s.name}</td>
              <td><select className="input" aria-label={`Role for ${s.name}`} value={s.role} disabled={!allowed} onChange={(e) => set({ staff: cfg.staff.map((x) => (x.name === s.name ? { ...x, role: e.target.value as C.Role } : x)) })}>{C.ROLES.filter((r) => r.key !== "owner").map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></td>
              <td><input type="checkbox" aria-label={`${s.name} may override`} disabled={!allowed} checked={cfg.overriders.includes(s.name)} onChange={(e) => set({ overriders: e.target.checked ? [...cfg.overriders, s.name] : cfg.overriders.filter((o) => o !== s.name) })} /></td>
              <td><button type="button" className="linkbtn danger-link" disabled={!allowed} onClick={() => set({ staff: cfg.staff.filter((x) => x.name !== s.name), overriders: cfg.overriders.filter((o) => o !== s.name) })}>Remove</button></td>
            </tr>
          ))}
        </tbody></table>}
        <div className="row-wrap">
          <input className="input" aria-label="Name" placeholder="Name, as they sign in" value={name} disabled={!allowed} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <select className="input" aria-label="Role" value={role} disabled={!allowed} onChange={(e) => setRole(e.target.value as C.Role)}>{C.ROLES.filter((r) => r.key !== "owner").map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select>
          <button type="button" className="btn" disabled={!allowed} onClick={add}>Add person</button>
          {cl.me && !cfg.staff.some((s) => s.name.toLowerCase() === cl.me.toLowerCase()) && <button type="button" className="btn small" disabled={!allowed} onClick={() => set({ staff: [...cfg.staff, { name: cl.me, role: "partner" }] })}>Add me as a partner</button>}
        </div>
        {cfg.staff.length > 0 && <p className="muted" style={{ margin: 0 }}>With no one ticked as able to override, managers and partners can.</p>}
      </section>
      <section className="card pad stack">
        <h3 style={{ margin: 0 }}>Rules</h3>
        <label className="check"><input type="checkbox" disabled={!allowed} checked={cfg.independentReview} onChange={(e) => set({ independentReview: e.target.checked })} /> Independent review is mandatory: the person who prepared the work can't review or approve it</label>
        <label className="check"><input type="checkbox" disabled={!allowed} checked={cfg.auto} onChange={(e) => set({ auto: e.target.checked })} /> Make a checklist automatically when a job is created</label>
      </section>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="form-actions"><button type="button" className="btn primary" disabled={!allowed || !dirty || state === "saving"} onClick={save}>{state === "saving" ? "Saving…" : "Save"}</button>{state === "saved" && <span className="muted">Saved.</span>}{!allowed && <span className="muted">Only a manager or partner can change these.</span>}</div>
    </div>
  );
}
