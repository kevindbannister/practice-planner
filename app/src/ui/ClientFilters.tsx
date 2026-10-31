// The extra filters on the Clients list, saved views, and the actions you can take on the clients shown or ticked.
import { useEffect, useMemo, useRef, useState } from "react";
import { IMPORTANCE } from "../lib/domain";
import { Criteria, ExportRow, NO_FILTERS, TaskDraft, VIEWS_KEY, View, exportTable, mailList, membersToAdd, readViews, tasksToCreate, toCsv, withView, withoutView } from "../lib/clientFilter";
import { newKey } from "../lib/planning";
import { downloadFile } from "./commsKit";
import { readSetting, useData } from "./data";
import { TASK_TYPES } from "./Editors";
import { todayIso } from "../lib/domain";
import { BulkEmail, BulkForm } from "./ClientBulk";

type Option = [string, string];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function Pick({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Option[] }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  );
}

const money = (s: string): number | null => {
  const n = Number(s.replace(/[£,\s]/g, ""));
  return s.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : null;
};

/** A pounds box that keeps what you type; it only follows the filter when the filter is changed from elsewhere (a saved view, Clear). */
function Fee({ value, onChange, label, placeholder, disabled }: { value: number | null; onChange: (n: number | null) => void; label: string; placeholder: string; disabled: boolean }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => setText((t) => (money(t) === value ? t : value === null ? "" : String(value))), [value]);
  return <input className="input" inputMode="numeric" placeholder={placeholder} aria-label={label} disabled={disabled} value={text} onChange={(e) => { setText(e.target.value); onChange(money(e.target.value)); }} style={{ width: 96 }} />;
}

/** The services drop-down: closes when you click elsewhere or press Escape. */
function ServicePicker({ chosen, services, set }: { chosen: string[]; services: { key: string; title: string }[]; set: (keys: string[]) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => { if (ref.current?.open && !(e.target instanceof Node && ref.current.contains(e.target))) ref.current.open = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && ref.current?.open) ref.current.open = false; };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, []);
  return (
    <details className="cf-multi" ref={ref}>
      <summary className="input">{chosen.length ? `${chosen.length} chosen` : "Choose services"}</summary>
      <div className="cf-multi-list" role="group" aria-label="Services">
        {services.map((s) => (
          <label key={s.key}>
            <input type="checkbox" checked={chosen.includes(s.key)} onChange={(e) => set(e.target.checked ? [...chosen, s.key] : chosen.filter((k) => k !== s.key))} /> {s.title}
          </label>
        ))}
        {chosen.length > 0 && <button type="button" className="linkbtn" onClick={() => set([])}>Clear</button>}
      </div>
    </details>
  );
}

export function FilterPanel({ f, set, groups, services }: { f: Criteria; set: (p: Partial<Criteria>) => void; groups: { key: string; title: string }[]; services: { key: string; title: string }[] }) {
  return (
    <section className="card pad cf-panel" aria-label="More filters">
      <div className="cf-grid">
        <div className="field">
          <span>Services</span>
          <div className="row-wrap" style={{ gap: 8, flexWrap: "nowrap" }}>
            <select className="input" aria-label="Services rule" value={f.serviceMode} onChange={(e) => set({ serviceMode: e.target.value as Criteria["serviceMode"] })} style={{ width: "auto" }}>
              <option value="any">Has any of</option><option value="all">Has all of</option><option value="none">Has none of</option>
            </select>
            <ServicePicker chosen={f.services} services={services} set={(keys) => set({ services: keys })} />
          </div>
        </div>
        <Pick label="Group" value={f.group} onChange={(v) => set({ group: v })} options={[["", "Any group"], ...groups.map((g): Option => [g.key, g.title])]} />
        <div className="field">
          <span>Annual fees</span>
          <div className="row-wrap" style={{ gap: 6, flexWrap: "nowrap" }}>
            <Fee label="Annual fees from" placeholder="From £" disabled={f.feeNone} value={f.feeMin} onChange={(n) => set({ feeMin: n })} />
            <Fee label="Annual fees to" placeholder="To £" disabled={f.feeNone} value={f.feeMax} onChange={(n) => set({ feeMax: n })} />
          </div>
          <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={f.feeNone} onChange={(e) => set({ feeNone: e.target.checked, feeMin: null, feeMax: null })} /> No fee recorded</label>
        </div>
        <Pick label="Importance" value={f.importance} onChange={(v) => set({ importance: v as Criteria["importance"] })} options={[["", "Any"], ...IMPORTANCE.map(([k, l]): Option => [k, l])]} />
        <Pick label="VAT" value={f.vat} onChange={(v) => set({ vat: v as Criteria["vat"] })} options={[["", "Any"], ["yes", "VAT registered"], ["no", "Not VAT registered"]]} />
        <Pick label="Year end" value={f.yearEnd} onChange={(v) => set({ yearEnd: v })} options={[["", "Any month"], ...MONTH_NAMES.map((m, i): Option => [String(i + 1).padStart(2, "0"), m])]} />
        <Pick label="AML" value={f.aml} onChange={(v) => set({ aml: v as Criteria["aml"] })} options={[["", "Any"], ["attention", "Needs attention"], ["ok", "In order"]]} />
        <Pick label="Engagement letter" value={f.loe} onChange={(v) => set({ loe: v as Criteria["loe"] })} options={[["", "Any"], ["signed", "Signed"], ["missing", "Not signed or none"]]} />
        <Pick label="Open work" value={f.work} onChange={(v) => set({ work: v as Criteria["work"] })} options={[["", "Any"], ["overdue", "Has overdue work"], ["open", "Has open work"], ["none", "No open work"]]} />
      </div>
    </section>
  );
}

/** Saved filter combinations ("VAT clients", "Key clients without a signed letter"), kept in Settings. */
export function ViewsBar({ f, apply }: { f: Criteria; apply: (c: Criteria) => void }) {
  const { data, saveSetting } = useData();
  const views: View[] = useMemo(() => readViews(readSetting<unknown>(data.settings, VIEWS_KEY)), [data.settings]);
  const [current, setCurrent] = useState("");
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const store = async (next: View[], after?: () => void) => {
    setError("");
    try {
      await saveSetting(VIEWS_KEY, next);
      after?.();
    } catch {
      setError("Couldn't save that. Try again.");
    }
  };
  return (
    <div className="row-wrap" style={{ gap: 8 }}>
      {views.length > 0 && (
        <select className="input" aria-label="Saved views" value={current} style={{ width: "auto" }}
          onChange={(e) => { const v = views.find((x) => x.name === e.target.value); setCurrent(e.target.value); if (v) apply(v.criteria); }}>
          <option value="">Saved views</option>
          {views.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
        </select>
      )}
      {current && <button type="button" className="linkbtn" onClick={() => void store(withoutView(views, current), () => setCurrent(""))}>Delete “{current}”</button>}
      {naming ? (
        <form className="row-wrap" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; void store(withView(views, name, f), () => { setCurrent(name.trim()); setNaming(false); setName(""); }); }}>
          <input className="input" autoFocus placeholder="Name this view" aria-label="View name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} />
          <button type="submit" className="btn small primary" disabled={!name.trim()}>Save</button>
          <button type="button" className="btn small" onClick={() => { setNaming(false); setName(""); }}>Cancel</button>
        </form>
      ) : (
        <button type="button" className="btn small" onClick={() => setNaming(true)}>Save this view</button>
      )}
      {error && <span className="chip red" role="alert">{error}</span>}
    </div>
  );
}

type Mode = "" | "group" | "importance" | "task" | "email" | "form";

/**
 * What to do with the clients shown (or the ticked ones). Export and the email list change nothing; adding to a group,
 * setting importance and creating tasks write to the clients, so they say how many clients first and ask to confirm.
 */
export function ActionBar({ targets, label, ticked }: { targets: ExportRow[]; label: string; ticked: boolean }) {
  const { data, createMany, updateMany } = useData();
  const [mode, setMode] = useState<Mode>("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [group, setGroup] = useState("");
  const [importance, setImportance] = useState<"key" | "normal" | "low">("key");
  const [task, setTask] = useState<TaskDraft>({ title: "", type: "Client work", dueDate: "", hours: null });
  const n = targets.length;
  const clients = targets.map((t) => t.client);
  const words = `${n} client${n === 1 ? "" : "s"}`;

  const open = (m: Mode) => { setMode(m === mode ? "" : m); setNote(""); setError(""); };
  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setError("");
    try {
      setNote(await work());
      setMode("");
    } catch {
      setError("That didn't save. Nothing was changed, or only some of it was. Check and try again.");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    downloadFile(new TextEncoder().encode("﻿" + toCsv(exportTable(targets))), `Clients ${todayIso()}.csv`, "text/csv");
    setNote(`Downloaded ${words}.`);
  };
  const copyEmails = async () => {
    const m = mailList(targets);
    if (!m.emails.length) return setNote("None of these clients has an email address.");
    try {
      await navigator.clipboard.writeText(m.emails.join("; "));
      setNote(`Copied ${m.emails.length} address${m.emails.length === 1 ? "" : "es"}${m.missing ? `. ${m.missing} client${m.missing === 1 ? " has" : "s have"} no email address` : ""}.`);
    } catch {
      setNote("Couldn't copy to the clipboard. Your browser may have blocked it.");
    }
  };

  const groupRows = group ? membersToAdd(clients, group, data.members, newKey) : { rows: [], already: 0 };
  const taskPlan = mode === "task" ? tasksToCreate(clients, task, data.tasks, newKey) : { rows: [], skipped: 0, problem: undefined };

  return (
    <section className="card pad cf-actions" aria-label="Actions on these clients">
      <div className="row-wrap" style={{ gap: 8, justifyContent: "space-between" }}>
        <strong>{label}</strong>
        <div className="row-wrap" style={{ gap: 8 }}>
          <button type="button" className="btn small" disabled={!n} onClick={exportCsv}>Export CSV</button>
          <button type="button" className="btn small" disabled={!n} onClick={() => void copyEmails()}>Copy email addresses</button>
          <button type="button" className="btn small" disabled={!n} aria-expanded={mode === "email"} onClick={() => open("email")}>Email each…</button>
          <button type="button" className="btn small" disabled={!n} aria-expanded={mode === "form"} onClick={() => open("form")}>Send a form to each…</button>
          <button type="button" className="btn small" disabled={!n} aria-expanded={mode === "group"} onClick={() => open("group")}>Add to group…</button>
          <button type="button" className="btn small" disabled={!n} aria-expanded={mode === "importance"} onClick={() => open("importance")}>Set importance…</button>
          <button type="button" className="btn small" disabled={!n} aria-expanded={mode === "task"} onClick={() => open("task")}>Create a task for each…</button>
        </div>
      </div>
      {note && <p role="status" className="muted" style={{ margin: "8px 0 0" }}>{note}</p>}

      {mode !== "" && (
        <div className="cf-confirm stack" style={{ gap: 10 }}>
          {mode === "email" && (
            <>
              <p className="muted" style={{ margin: 0 }}>Email {words}: {ticked ? "the ones you ticked" : "everyone currently shown"}. Each gets their own copy.</p>
              <BulkEmail clients={clients} done={(m) => { setNote(m); setMode(""); }} />
            </>
          )}
          {mode === "form" && (
            <>
              <p className="muted" style={{ margin: 0 }}>Send a form to {words}: {ticked ? "the ones you ticked" : "everyone currently shown"}.</p>
              <BulkForm clients={clients} done={(m) => { setNote(m); setMode(""); }} />
            </>
          )}
          {mode === "group" && (
            <>
              <Pick label="Add to group" value={group} onChange={setGroup} options={[["", "Choose a group…"], ...data.groups.map((g): Option => [String(g.Key), String(g.Title)])]} />
              {group && <p className="muted" style={{ margin: 0 }}>{groupRows.rows.length} will be added{groupRows.already ? `; ${groupRows.already} already in this group` : ""}.</p>}
              <div><button type="button" className="btn primary" disabled={busy || !groupRows.rows.length} onClick={() => void run(async () => { await createMany("GroupMembers", groupRows.rows); return `Added ${groupRows.rows.length} to the group${groupRows.already ? ` (${groupRows.already} already in it)` : ""}.`; })}>{busy ? "Adding…" : `Add ${groupRows.rows.length} to the group`}</button></div>
            </>
          )}
          {mode === "importance" && (
            <>
              <Pick label="Importance" value={importance} onChange={(v) => setImportance(v as typeof importance)} options={IMPORTANCE.map(([k, l]): Option => [k, l])} />
              <p className="muted" style={{ margin: 0 }}>This changes {words}: {ticked ? "the ones you ticked" : "everyone currently shown"}.</p>
              <div><button type="button" className="btn primary" disabled={busy} onClick={() => void run(async () => { await updateMany("Clients", clients.map((row) => ({ row, patch: { Importance: importance === "normal" ? "" : importance } }))); return `Set ${words} to ${IMPORTANCE.find(([k]) => k === importance)![1].toLowerCase()}.`; })}>{busy ? "Saving…" : `Set ${words}`}</button></div>
            </>
          )}
          {mode === "task" && (
            <>
              <div className="cf-grid">
                <label className="field"><span>Task name</span><input className="input" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} placeholder="e.g. Ask for year end records" /></label>
                <Pick label="Type" value={task.type} onChange={(v) => setTask({ ...task, type: v })} options={TASK_TYPES.map((t): Option => [t, t])} />
                <label className="field"><span>Due (optional)</span><input className="input" type="date" value={task.dueDate} onChange={(e) => setTask({ ...task, dueDate: e.target.value })} /></label>
                <label className="field"><span>Hours each (optional)</span><input className="input" inputMode="decimal" value={task.hours ?? ""} onChange={(e) => { const v = Number(e.target.value); setTask({ ...task, hours: e.target.value.trim() !== "" && Number.isFinite(v) && v > 0 ? v : null }); }} style={{ width: 110 }} /></label>
              </div>
              {task.title.trim() && <p className="muted" style={{ margin: 0 }}>{taskPlan.rows.length} task{taskPlan.rows.length === 1 ? "" : "s"} will be created{taskPlan.skipped ? `; ${taskPlan.skipped} client${taskPlan.skipped === 1 ? " already has" : "s already have"} an open task with this name` : ""}.</p>}
              <div><button type="button" className="btn primary" disabled={busy || !taskPlan.rows.length} onClick={() => void run(async () => { await createMany("Tasks", taskPlan.rows); return `Created ${taskPlan.rows.length} task${taskPlan.rows.length === 1 ? "" : "s"}${taskPlan.skipped ? ` (${taskPlan.skipped} skipped: already open)` : ""}.`; })}>{busy ? "Creating…" : `Create ${taskPlan.rows.length} task${taskPlan.rows.length === 1 ? "" : "s"}`}</button></div>
            </>
          )}
          {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
        </div>
      )}
    </section>
  );
}

export { NO_FILTERS };
