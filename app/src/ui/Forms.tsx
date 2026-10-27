// Forms and information requests, staff side: a library of reusable forms (Settings › Forms) and, on
// each client, requests made from them with the answers. See lib/forms.ts and the scope document.
import { useMemo, useState } from "react";
import { Client, fmtDate, todayIso } from "../lib/domain";
import { Answers, FIELD_TYPES, Field, FieldType, PREFILLS, STARTERS, STATUS_CHIP, STATUS_LABEL, Template, answerProblems, cleanField, isWritable, missing, prefilled, readRequest, readTemplate, templateProblems, writeBack } from "../lib/forms";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { useData } from "./data";
import { href } from "./bits";

const nowIso = () => new Date().toISOString();
const activity = (clientKey: string, type: string, title: string, key: string, user: string, summary = ""): Row => ({ Key: newKey("A"), ClientKey: clientKey, Type: type, Title: title, Summary: summary, At: nowIso(), Actor: user, Source: "forms", SourceKey: key, EventKey: `form:${key}:${type}`, Visibility: "normal", Created: nowIso() });

// ------------------------------------------------------------------ the client's forms

export function ClientForms({ client }: { client: Client }) {
  const { data, user, create, store } = useData();
  const reqs = useMemo(() => data.formRequests.filter((r) => r.ClientKey === client.Key).sort((a, b) => String(b.Created).localeCompare(String(a.Created))), [data.formRequests, client.Key]);
  const templates = useMemo(() => data.formTemplates.map(readTemplate).filter((t) => !t.archived).sort((a, b) => a.name.localeCompare(b.name)), [data.formTemplates]);
  const [adding, setAdding] = useState(false);
  const [tpl, setTpl] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState("");
  const ready = store.hasList("FormRequests");

  const make = async () => {
    const t = templates.find((x) => x.key === tpl);
    if (!t) return setErr("Choose a form.");
    setBusy(true); setErr("");
    try {
      const key = newKey("FR");
      const clean = t.fields.map(cleanField);
      await create("FormRequests", { Key: key, PracticeId: "", ClientKey: client.Key, TemplateKey: t.key, TemplateVersion: t.version, Title: title.trim() || t.name, Status: "open", DueDate: due, Fields: JSON.stringify(clean), Answers: JSON.stringify(prefilled(clean, client as unknown as Row)), Created: nowIso(), CreatedBy: user || "", Updated: nowIso() });
      await create("Activities", activity(client.Key, "form-sent", `Form requested: ${title.trim() || t.name}`, key, user || ""));
      setAdding(false); setTpl(""); setTitle(""); setDue(""); setOpen(key);
    } catch { setErr("Couldn't make that request. Try again."); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Forms and questionnaires for {client.Title}. Enter the answers from a call or a paper form; the client's details are filled in where the form asks for them.</p>
        <span className="row-wrap"><a className="linkbtn" href={href("settings", "forms")}>Manage forms</a><button type="button" className="btn primary" disabled={!ready} onClick={() => setAdding(!adding)}>{adding ? "Close" : "New request"}</button></span>
      </div>
      {!ready && <p className="import-list warn" role="alert">The forms lists aren't set up yet. They are added automatically when the planner starts.</p>}
      {adding && (
        <section className="card pad stack" aria-label="New form request">
          {!templates.length ? <p style={{ margin: 0 }}>There are no forms yet. <a href={href("settings", "forms")}>Add the starter forms or build your own in Settings › Forms.</a></p> : (
            <div className="tl-form">
              <label className="doc-field"><span>Form</span><select className="input" value={tpl} onChange={(e) => { setTpl(e.target.value); const t = templates.find((x) => x.key === e.target.value); if (t && !title) setTitle(""); }}><option value="">Choose a form…</option>{templates.map((t) => <option key={t.key} value={t.key}>{t.name} ({t.fields.length} questions)</option>)}</select></label>
              <label className="doc-field"><span>Title (optional)</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Information for 2026 accounts" /></label>
              <label className="doc-field"><span>Due (optional)</span><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
            </div>
          )}
          {err && <p className="error-text" role="alert">{err}</p>}
          {templates.length > 0 && <div><button type="button" className="btn primary" disabled={busy || !tpl} onClick={() => void make()}>Create the request</button></div>}
        </section>
      )}
      {!reqs.length && !adding && <div className="card empty">No forms for {client.Title} yet.</div>}
      {reqs.map((r) => <RequestCard key={String(r.Key)} row={r} client={client} open={open === String(r.Key)} onToggle={() => setOpen(open === String(r.Key) ? "" : String(r.Key))} />)}
    </div>
  );
}

function RequestCard({ row, client, open, onToggle }: { row: Row; client: Client; open: boolean; onToggle: () => void }) {
  const { data, user, update, remove, create } = useData();
  const req = readRequest(row);
  const [answers, setAnswers] = useState<Answers>(req.answers);
  const [apply, setApply] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const editable = req.status === "open";
  const today = todayIso();
  const dirty = JSON.stringify(answers) !== JSON.stringify(req.answers);
  const miss = missing(req.fields, answers);
  const changes = writeBack(req.fields, answers, client as unknown as Row);
  const done = req.fields.filter((f) => !!(answers[f.id] || "").trim()).length;
  const set = (id: string, v: string) => setAnswers({ ...answers, [id]: v });

  const run = async (work: () => Promise<string>) => { setBusy(true); setMsg(null); try { setMsg({ ok: true, text: await work() }); } catch (e) { setMsg({ ok: false, text: e instanceof Error && e.message ? e.message : "That didn't work. Try again." }); } finally { setBusy(false); } };
  const save = () => run(async () => { await update("FormRequests", row, { Answers: JSON.stringify(answers), Updated: nowIso() }); return "Answers saved."; });
  const complete = () => run(async () => {
    if (miss.length) throw new Error(`Still to answer: ${miss.map((f) => f.label).join("; ")}.`);
    const bad = answerProblems(req.fields, answers);
    if (bad.length) throw new Error(bad[0]);
    const chosen = changes.filter((c) => apply[c.client] !== false);
    if (chosen.length) {
      const live = data.clients.find((c) => c.Key === client.Key);
      if (live) await update("Clients", live, Object.fromEntries(chosen.map((c) => [c.client, c.to])));
    }
    await update("FormRequests", row, { Answers: JSON.stringify(answers), Status: "complete", CompletedOn: nowIso(), CompletedBy: user || "", Written: JSON.stringify(chosen.map((c) => c.field.label)), Updated: nowIso() });
    await create("Activities", activity(client.Key, "form-complete", `Form completed: ${req.title}`, String(row.Key), user || "", chosen.length ? `Client record updated: ${chosen.map((c) => c.field.label).join(", ")}` : ""));
    return chosen.length ? `Completed. The client record was updated (${chosen.length}).` : "Completed.";
  });
  const status = (to: "open" | "cancelled", text: string) => run(async () => { await update("FormRequests", row, { Status: to, ...(to === "open" ? { CompletedOn: "", CompletedBy: "" } : {}), Updated: nowIso() }); return text; });
  const del = () => { if (window.confirm("Delete this request and its answers?")) void run(async () => { await remove("FormRequests", row); return ""; }); };

  return (
    <section className="card pad stack" aria-label={req.title}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <button type="button" className="linkbtn" style={{ fontWeight: 600, fontSize: 15 }} aria-expanded={open} onClick={onToggle}>{open ? "▾" : "▸"} {req.title}</button>
        <span className={`chip ${STATUS_CHIP[req.status]}`}>{STATUS_LABEL[req.status]}</span>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>{done} of {req.fields.length} answered · made {fmtDate(req.createdAt.slice(0, 10))}{req.createdBy ? ` by ${req.createdBy}` : ""}{req.due ? ` · due ${fmtDate(req.due)}${req.status === "open" && req.due < today ? " (overdue)" : ""}` : ""}{req.completedOn ? ` · completed ${fmtDate(req.completedOn.slice(0, 10))}${req.completedBy ? ` by ${req.completedBy}` : ""}` : ""}</div>
      {open && (
        <>
          <fieldset disabled={!editable || busy} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
            {req.fields.map((f) => <Question key={f.id} f={f} value={answers[f.id] || ""} onChange={(v) => set(f.id, v)} />)}
          </fieldset>
          {editable && changes.length > 0 && (
            <div className="import-list" aria-label="Changes to the client record">
              <strong>On completing, update the client record:</strong>
              <ul className="plain">{changes.map((c) => <li key={c.client}><label className="row-wrap"><input type="checkbox" checked={apply[c.client] !== false} onChange={(e) => setApply({ ...apply, [c.client]: e.target.checked })} /> {c.field.label}: {c.from ? <><s>{c.from}</s> → </> : null}<strong>{c.to}</strong></label></li>)}</ul>
            </div>
          )}
          {req.status === "complete" && req.written.length > 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Written to the client record: {req.written.join(", ")}.</p>}
          {msg?.text && <p className={msg.ok ? undefined : "error-text"} role={msg.ok ? "status" : "alert"} style={{ margin: 0 }}>{msg.text}</p>}
          <div className="row-wrap">
            {editable && <button type="button" className="btn" disabled={busy || !dirty} onClick={() => void save()}>Save answers</button>}
            {editable && <button type="button" className="btn primary" disabled={busy} onClick={() => void complete()}>Mark as completed</button>}
            {editable && <button type="button" className="btn" disabled={busy} onClick={() => void status("cancelled", "Cancelled.")}>Cancel request</button>}
            {!editable && <button type="button" className="btn" disabled={busy} onClick={() => void status("open", "Reopened.")}>Reopen</button>}
            <button type="button" className="linkbtn danger-link" disabled={busy} onClick={del}>Delete</button>
          </div>
        </>
      )}
    </section>
  );
}

function Question({ f, value, onChange }: { f: Field; value: string; onChange: (v: string) => void }) {
  const label = <span>{f.label}{f.required ? <span aria-hidden="true" style={{ color: "var(--red-ink, #b42318)" }}> *</span> : null}</span>;
  const help = f.help ? <span className="muted" style={{ fontSize: 12 }}>{f.help}</span> : null;
  if (f.type === "tick") return <label className="row-wrap"><input type="checkbox" checked={value === "yes"} onChange={(e) => onChange(e.target.checked ? "yes" : "")} /> {label}</label>;
  if (f.type === "yesno") return <div className="doc-field">{label}<span className="row-wrap">{["yes", "no"].map((v) => <label key={v} className="row-wrap"><input type="radio" name={f.id} checked={value === v} onChange={() => onChange(v)} /> {v === "yes" ? "Yes" : "No"}</label>)}</span>{help}</div>;
  return (
    <label className="doc-field">{label}
      {f.type === "longtext" ? <textarea className="input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
        : f.type === "choice" ? <select className="input" value={value} onChange={(e) => onChange(e.target.value)}><option value="">Choose…</option>{(f.options || []).map((o) => <option key={o}>{o}</option>)}</select>
        : <input className="input" type={f.type === "date" ? "date" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} value={value} onChange={(e) => onChange(e.target.value)} />}
      {help}
    </label>
  );
}

// ------------------------------------------------------------------ the library (Settings › Forms)

export function FormSettings() {
  const { data, user, create, update, store } = useData();
  const templates = useMemo(() => data.formTemplates.map(readTemplate).sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name)), [data.formTemplates]);
  const [editing, setEditing] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ready = store.hasList("FormTemplates");
  const have = new Set(templates.map((t) => t.name));
  const row = (k: string) => data.formTemplates.find((r) => r.Key === k);

  const addStarters = async () => {
    setBusy(true); setErr("");
    try { for (const s of STARTERS.filter((x) => !have.has(x.name))) await create("FormTemplates", { Key: newKey("FT"), PracticeId: "", Title: s.name, Category: s.category, Description: s.description, Version: 1, Archived: false, Fields: JSON.stringify(s.fields), Created: nowIso(), CreatedBy: user || "", Updated: nowIso() }); }
    catch { setErr("Couldn't add them. Try again."); } finally { setBusy(false); }
  };
  const blank = async () => {
    setBusy(true); setErr("");
    try { const key = newKey("FT"); await create("FormTemplates", { Key: key, PracticeId: "", Title: "New form", Category: "General", Description: "", Version: 1, Archived: false, Fields: "[]", Created: nowIso(), CreatedBy: user || "", Updated: nowIso() }); setEditing(key); }
    catch { setErr("Couldn't start that. Try again."); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <section className="card pad stack" aria-labelledby="forms-h">
        <div className="card-title-row"><h2 id="forms-h" style={{ margin: 0 }}>Forms</h2><span className="row-wrap">{STARTERS.some((s) => !have.has(s.name)) && <button type="button" className="btn" disabled={busy || !ready} onClick={() => void addStarters()}>Add the starter forms</button>}<button type="button" className="btn primary" disabled={busy || !ready} onClick={() => void blank()}>New form</button></span></div>
        <p className="muted" style={{ margin: 0 }}>Reusable questionnaires and information requests. Put one to a client from their Documents › Forms tab. Changing a form never changes requests already made from it.</p>
        {!ready && <p className="import-list warn" role="alert">The forms list isn't set up yet. It is added automatically when the planner starts.</p>}
        {err && <p className="error-text" role="alert">{err}</p>}
        {!templates.length && ready && <p className="muted" style={{ margin: 0 }}>No forms yet. Add the starter forms to begin, or build your own.</p>}
        {templates.map((t) => (
          <div key={t.key} className="stack" style={{ gap: 6, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <div className="row-wrap" style={{ justifyContent: "space-between" }}>
              <span><strong>{t.name}</strong> <span className="muted">· {t.category} · {t.fields.length} questions · version {t.version}{t.archived ? " · archived" : ""}</span></span>
              <span className="row-wrap">
                <button type="button" className="linkbtn" onClick={() => setEditing(editing === t.key ? "" : t.key)}>{editing === t.key ? "Close" : "Edit"}</button>
                <button type="button" className="linkbtn" onClick={() => { const r = row(t.key); if (r) void update("FormTemplates", r, { Archived: !t.archived, Updated: nowIso() }); }}>{t.archived ? "Restore" : "Archive"}</button>
              </span>
            </div>
            {t.description && <span className="muted" style={{ fontSize: 13 }}>{t.description}</span>}
            {editing === t.key && <Builder tpl={t} row={row(t.key)!} onDone={() => setEditing("")} />}
          </div>
        ))}
      </section>
    </div>
  );
}

function Builder({ tpl, row, onDone }: { tpl: Template; row: Row; onDone: () => void }) {
  const { update } = useData();
  const [name, setName] = useState(tpl.name);
  const [category, setCategory] = useState(tpl.category);
  const [desc, setDesc] = useState(tpl.description);
  const [fields, setFields] = useState<Field[]>(tpl.fields);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string[]>([]);
  const patch = (i: number, p: Partial<Field>) => setFields(fields.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const move = (i: number, d: number) => { const n = [...fields]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; setFields(n); };
  const save = async () => {
    const clean = fields.map(cleanField);
    const p = templateProblems(name, clean);
    if (p.length) return setErr(p);
    setBusy(true); setErr([]);
    try { await update("FormTemplates", row, { Title: name.trim(), Category: category.trim() || "General", Description: desc.trim(), Version: tpl.version + 1, Fields: JSON.stringify(clean), Updated: nowIso() }); onDone(); }
    catch { setErr(["Couldn't save. Your changes are still here; try again."]); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="tl-form">
        <label className="doc-field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="doc-field"><span>Category</span><input className="input" value={category} onChange={(e) => setCategory(e.target.value)} /></label>
        <label className="doc-field" style={{ gridColumn: "1 / -1" }}><span>What it's for</span><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
      </div>
      {fields.map((f, i) => (
        <div key={f.id} className="card pad stack" style={{ gap: 6 }}>
          <div className="inline-form">
            <input className="input" style={{ flex: 1, minWidth: 220 }} aria-label={`Question ${i + 1}`} placeholder="Question" value={f.label} onChange={(e) => patch(i, { label: e.target.value })} />
            <select className="input" style={{ width: "auto" }} aria-label="Answer type" value={f.type} onChange={(e) => patch(i, { type: e.target.value as FieldType })}>{FIELD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
            <label className="row-wrap"><input type="checkbox" checked={f.required} onChange={(e) => patch(i, { required: e.target.checked })} /> Required</label>
            <button type="button" className="linkbtn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button type="button" className="linkbtn" aria-label="Move down" disabled={i === fields.length - 1} onClick={() => move(i, 1)}>↓</button>
            <button type="button" className="linkbtn danger-link" onClick={() => setFields(fields.filter((_, j) => j !== i))}>Remove</button>
          </div>
          {f.type === "choice" && <input className="input" aria-label="Choices" placeholder="Choices, separated by commas" value={(f.options || []).join(", ")} onChange={(e) => patch(i, { options: e.target.value.split(",").map((x) => x.trimStart()) })} />}
          <div className="inline-form">
            <label className="row-wrap muted" style={{ fontSize: 13 }}>Starts from <select className="input" style={{ width: "auto" }} aria-label="Starts from client field" value={f.prefill || ""} onChange={(e) => patch(i, { prefill: e.target.value || undefined, writeBack: isWritable(e.target.value) ? f.writeBack : false })}><option value="">Nothing (blank)</option>{PREFILLS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
            {isWritable(f.prefill) && <label className="row-wrap muted" style={{ fontSize: 13 }}><input type="checkbox" checked={!!f.writeBack} onChange={(e) => patch(i, { writeBack: e.target.checked })} /> Offer to update the client record</label>}
            <input className="input" style={{ flex: 1, minWidth: 180 }} aria-label="Help text" placeholder="Help text (optional)" value={f.help || ""} onChange={(e) => patch(i, { help: e.target.value })} />
          </div>
        </div>
      ))}
      <div><button type="button" className="btn small" onClick={() => setFields([...fields, { id: `f${Date.now().toString(36)}${fields.length}`, label: "", type: "text", required: false }])}>Add a question</button></div>
      {err.length > 0 && <ul className="plain error-text" role="alert">{err.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="form-actions"><button type="button" className="btn" onClick={onDone} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save form"}</button></div>
    </div>
  );
}
