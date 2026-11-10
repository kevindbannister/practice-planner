// AML: the practice's own anti-money-laundering pack. The firm-wide risk assessment, the policies and procedures, ongoing client reviews,
// screening records, training, the actions register, the MLRO's annual report and the independent review, each a form with tick boxes
// that saves as you type and exports to Word or PDF. The suspicious activity forms are only printed blank, never stored. See lib/amlPack.ts.
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import * as bld from "../lib/amlBuilder";
import { lastApprovedAt, readReviewPolicy, seenTriggers, triggerOf } from "../lib/amlReview";
import { position } from "../lib/amlAssessment";
import { readAml, readOnboardingSettings } from "../lib/onboarding";
import * as p from "../lib/amlPack";
import { returnLive, Live } from "../lib/amlReturn";
import { DOCX_TYPE } from "../lib/docx";
import { fmtDate, todayIso } from "../lib/domain";
import { Row } from "../lib/schema";
import { href, useRoute } from "./bits";
import { Entry, REC_TYPES, RecType, Tone, timeline } from "../lib/amlTimelineView";
import { amlStampRead } from "../lib/xamaActions";
import { screening as screeningOf } from "../lib/amlScreening";
import { screeningPolicy } from "../lib/amlPolicy";
import { readSetting, useData } from "./data";
import { practiceId } from "../lib/checklistRows";
import { AmlClients } from "./AmlClients";
import { readiness, Facts, Standing as RStanding } from "../lib/amlReadiness";
import { Cfg, FWRA_CFG, PolicyBuilder, POLICY_CFG } from "./AmlBuilder";
import { useFirm } from "./FirmSettings";

const TABS: [string, string][] = [
  ["overview", "Overview"], ["checklist", "ACCA checklist"], ["clients", "Client tracker"], ["fwra", "Risk assessment"], ["policies", "Policies"], ["annualreturn", "ACCA return"], ["records", "Records"], ["forms", "SAR and blank forms"],
];
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const fmt = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

function useAml() {
  const { data, saveSetting, create, update, remove, user, store } = useData();
  const firm = useFirm();
  const clients = useMemo(() => [...(data.clients as Row[])].sort((a, b) => s(a.Title).localeCompare(s(b.Title))), [data.clients]);
  const clientName = (k: string) => (k ? s(clients.find((c) => c.Key === k)?.Title || k) : "");
  const hasList = store.hasList("AmlRecords");
  const storeOf = (id: string) => (hasList ? p.storeFrom(data.amlRecords, data.settings, id) : p.readStore(readSetting<p.Store>(data.settings, p.settingKey(id))));
  // Rows created during this screen's life, so back-to-back saves don't create the same record twice before the list refreshes.
  const made = useRef(new Map<string, Row>());
  const rowsRef = useRef(data.amlRecords); rowsRef.current = data.amlRecords;
  const settingsRef = useRef(data.settings); settingsRef.current = data.settings;
  const saveStore = async (id: string, next: p.Store) => {
    if (!hasList) return saveSetting(p.settingKey(id), next);
    const rows = [...rowsRef.current.filter((r) => !made.current.has(String(r.Key))), ...made.current.values()];
    const w = p.storeWrites(rows, settingsRef.current, id, next, { now: new Date().toISOString(), actor: user || "", pid: practiceId(settingsRef.current) });
    for (const row of w.creates) made.current.set(String(row.Key), await create("AmlRecords", row as Row));
    for (const u of w.updates) { await update("AmlRecords", u.row as Row, u.patch as Row); const k = String(u.row.Key); if (made.current.has(k)) made.current.set(k, { ...made.current.get(k)!, ...u.patch } as Row); }
    for (const r of w.removes) { await remove("AmlRecords", r as Row); made.current.delete(String(r.Key)); }
    if (w.clearLegacy) await saveSetting(p.settingKey(id), { records: [], movedTo: "AmlRecords" });
  };
  return { data, saveSetting, saveStore, firm: s(firm.firmName).trim() || "The practice", clients, clientName, storeOf };
}

function download(name: string, bytes: Uint8Array | Blob, type: string) {
  const url = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes as unknown as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function ExportButtons({ def, rec, blank, firm, clientName }: { def: p.FormDef; rec?: p.Rec; blank?: boolean; firm: string; clientName: (k: string) => string }) {
  const [err, setErr] = useState("");
  const today = todayIso();
  const longD = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const meta = (): p.Meta => ({ firm, title: rec && !blank ? `${def.title}, ${longD(rec.created)}` : def.title, status: rec?.status || "", date: rec?.created || today, restricted: def.restricted, blank, today });
  const list = () => p.docBlocks(def, rec, meta(), clientName);
  const word = async () => {
    setErr("");
    try { download(p.fileName(def.title, rec?.created || today, "docx"), await p.toDocx(list(), meta()), DOCX_TYPE); } catch { setErr("Couldn't make the Word file."); }
  };
  const pdf = () => {
    setErr("");
    const url = URL.createObjectURL(new Blob([p.toHtml(list(), meta())], { type: "text/html" }));
    const w = window.open(url, "_blank");
    if (!w) setErr("The print page was blocked. Allow pop-ups for this site and try again.");
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  return (
    <span className="row-wrap" style={{ gap: 6 }}>
      <button type="button" className="btn small" onClick={word}>{blank ? "Blank Word" : "Word"}</button>
      <button type="button" className="btn small" onClick={pdf}>{blank ? "Blank PDF" : "PDF"}</button>
      {err && <span role="alert" className="warn">{err}</span>}
    </span>
  );
}

// ------------------------------------------------------------------ fields

type Ctx = { clients: Row[]; get: (k: string) => unknown; set: (k: string, v: unknown) => void };
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

function Ticks({ options, chosen, multi, onChange, label, nowrap }: { options: string[]; chosen: string[]; multi?: boolean; onChange: (v: string[]) => void; label: string; nowrap?: boolean }) {
  return (
    <div className="row-wrap" role="group" aria-label={label} style={{ gap: 12, flexWrap: nowrap ? "nowrap" : "wrap" }}>
      {options.map((o) => (
        <label key={o} style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={chosen.includes(o)} onChange={(e) => onChange(multi ? (e.target.checked ? [...chosen, o] : chosen.filter((x) => x !== o)) : e.target.checked ? [o] : [])} />
          {o}
        </label>
      ))}
    </div>
  );
}

function Cell({ col, value, clients, onChange }: { col: p.Col; value: string; clients: Row[]; onChange: (v: string) => void }) {
  if (col.type === "date") return <input className="input" type="date" aria-label={col.label} value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 150 }} />;
  if (col.type === "one") return <select className="input" aria-label={col.label} value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 120 }}><option value="">Choose</option>{(col.options || []).map((o) => <option key={o}>{o}</option>)}</select>;
  if (col.type === "client") return <select className="input" aria-label={col.label} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Choose</option>{clients.map((c) => <option key={s(c.Key)} value={s(c.Key)}>{s(c.Title)}</option>)}</select>;
  return <textarea spellCheck lang="en-GB" className="input" aria-label={col.label} rows={Math.min(12, Math.max(3, Math.ceil(value.length / 30)))} value={value} onChange={(e) => onChange(e.target.value)} style={{ minWidth: 200, resize: "vertical" }} />;
}

function FieldView({ f, c }: { f: p.Field; c: Ctx }) {
  const v = c.get(f.k);
  if (f.type === "info") return <p className="muted" style={{ margin: 0 }}>{f.label}</p>;
  if (f.type === "text") return <label className="field"><span>{f.label}</span><input spellCheck lang="en-GB" className="input" value={s(v)} placeholder={f.hint} onChange={(e) => c.set(f.k, e.target.value)} /></label>;
  if (f.type === "date") return <label className="field"><span>{f.label}</span><input className="input" type="date" value={s(v)} onChange={(e) => c.set(f.k, e.target.value)} /></label>;
  if (f.type === "client") return <label className="field"><span>{f.label}</span><select className="input" value={s(v)} onChange={(e) => c.set(f.k, e.target.value)}><option value="">Choose a client</option>{c.clients.map((x) => <option key={s(x.Key)} value={s(x.Key)}>{s(x.Title)}</option>)}</select></label>;
  if (f.type === "long") return <label className="field"><span>{f.flow ? "" : f.label}</span><textarea spellCheck lang="en-GB" className="input" rows={f.flow ? 9 : 4} value={s(v)} placeholder={f.hint} aria-label={f.label} onChange={(e) => c.set(f.k, e.target.value)} /></label>;
  if (f.type === "one" || f.type === "many") return <div className="field"><span>{f.label}</span><Ticks label={f.label} options={f.options} multi={f.type === "many"} chosen={list(v)} onChange={(x) => c.set(f.k, x)} /></div>;
  if (f.type === "grid") {
    const g = (v || {}) as Record<string, { c?: string[]; n?: string }>;
    const put = (i: number, patch: { c?: string[]; n?: string }) => c.set(f.k, { ...g, [i]: { ...g[i], ...patch } });
    return (
      <div style={{ overflowX: "auto" }}>
        <table className="grid" style={{ minWidth: 560 }}>
          <thead><tr><th scope="col">{f.label}</th><th scope="col">Status</th><th scope="col">{f.noteLabel}</th></tr></thead>
          <tbody>
            {f.items.map((it, i) => (
              <tr key={it}>
                <td style={{ fontWeight: 600, width: "34%", minWidth: 200 }}>{it}</td>
                <td style={{ whiteSpace: "nowrap" }}><Ticks nowrap label={it} options={f.options} multi={f.multi} chosen={list(g[i]?.c)} onChange={(x) => put(i, { c: x })} /></td>
                <td><textarea spellCheck lang="en-GB" className="input" rows={2} aria-label={`${it}: ${f.noteLabel}`} value={s(g[i]?.n)} onChange={(e) => put(i, { n: e.target.value })} style={{ minWidth: 220, resize: "vertical" }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const t = f as Extract<p.Field, { type: "table" }>;
  const rows = (Array.isArray(v) ? v : []) as Record<string, string>[];
  const setRow = (i: number, k: string, x: string) => c.set(f.k, rows.map((r, j) => (j === i ? { ...r, [k]: x } : r)));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div style={{ overflowX: "auto" }}>
        <table className="grid" style={{ minWidth: 720 }}>
          <thead><tr>{t.cols.map((k) => <th key={k.k} scope="col">{k.label}</th>)}<th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {t.cols.map((k) => <td key={k.k}><Cell col={k} value={s(r[k.k])} clients={c.clients} onChange={(x) => setRow(i, k.k, x)} /></td>)}
                <td><button type="button" className="btn small" aria-label={`Remove row ${i + 1}`} onClick={() => c.set(f.k, rows.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={t.cols.length + 1} className="muted">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div><button type="button" className="btn small" onClick={() => c.set(f.k, [...rows, {}])}>Add a row</button></div>
    </div>
  );
}

function liveFor(a: ReturnType<typeof useAml>): Live {
  const { data } = a;
  const pol = bld.readState(readSetting<unknown>(data.settings, "aml.builder")).answers;
  const vs = (id: string) => { const v = readSetting<unknown[]>(data.settings, `aml.${id}.versions`); return Array.isArray(v) ? v.length : 0; };
  const tr = a.storeOf("training").records[0];
  return returnLive({ clients: data.clients as Row[], clientServices: data.clientServices as Row[], services: data.services as Row[], amlAssessments: data.amlAssessments, onboardings: data.onboardings, today: todayIso(), policy: pol, policyVersions: vs("builder"), fwraVersions: vs("fwra2"), trainingTwoYears: s(tr?.values.twoYears) });
}

// ------------------------------------------------------------------ one form

function FormScreen({ def, sel: first = "", add = false }: { def: p.FormDef; sel?: string; add?: boolean }) {
  const a = useAml();
  const today = todayIso();
  const stored = a.storeOf(def.id);
  const [local, setLocal] = useState<p.Store | null>(null);
  const [state, setState] = useState<"" | "saving" | "saved" | "failed">("");
  const [sel, setSel] = useState(first);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<p.Store | null>(null);
  const counter = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const saveRef = useRef(a.saveStore); saveRef.current = a.saveStore;
  const [why, setWhy] = useState("");
  const cur = local ?? stored;

  const persist = (next: p.Store, n: number) => {
    chain.current = chain.current.then(async () => {
      try { await saveRef.current(def.id, next); if (counter.current === n) { setLocal(null); latest.current = null; setState("saved"); setWhy(""); } } catch (e) { setState("failed"); setWhy(e instanceof Error ? e.message : ""); }
    });
  };
  const edit = (next: p.Store, now = false) => {
    setLocal(next); latest.current = next; setState("saving");
    const n = ++counter.current;
    window.clearTimeout(timer.current);
    if (now) persist(next, n);
    else timer.current = window.setTimeout(() => persist(next, n), 700);
  };
  // Leaving the tab straight after typing must not lose the last edit.
  useEffect(() => () => { if (latest.current) { window.clearTimeout(timer.current); persist(latest.current, counter.current); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = [...cur.records].sort((x, y) => y.created.localeCompare(x.created) || y.id.localeCompare(x.id));
  const rec = cur.records.find((r) => r.id === sel) || sorted[0];
  const hasClient = def.sections.some((sec) => sec.fields.some((f) => f.type === "client"));
  const clientKey = def.sections.flatMap((sec) => sec.fields).find((f) => f.type === "client")?.k;
  const label = (r: p.Rec) => `${hasClient && clientKey && r.values[clientKey] ? `${a.clientName(s(r.values[clientKey]))}, ` : ""}${fmt(r.created)}, ${r.status === "Approved" ? "approved" : "draft"}`;

  const patchRec = (id: string, fn: (r: p.Rec) => p.Rec, now = false) => edit({ records: cur.records.map((r) => (r.id === id ? fn(r) : r)) }, now);
  const start = (copy?: p.Rec) => { const r = p.newRec(def, today, copy); edit({ records: [...cur.records, r] }, true); setSel(r.id); };
  const status = p.standing(def, cur, today);
  // Opened from the timeline's Add button: start a new record, or add a blank row to the register, once.
  const added = useRef(false);
  useEffect(() => {
    if (!add || added.current) return;
    added.current = true;
    if (def.single) {
      const table = def.sections.flatMap((x) => x.fields).find((f) => f.type === "table");
      const base = stored.records[0] ?? p.newRec(def, today);
      const rows = table && Array.isArray(base.values[table.k]) ? (base.values[table.k] as unknown[]) : [];
      const next = table ? { ...base, values: { ...base.values, [table.k]: [...rows, {}] } } : base;
      edit({ records: stored.records[0] ? stored.records.map((r) => (r.id === base.id ? next : r)) : [next] }, true);
      setSel(next.id);
    } else start();
    window.history.replaceState(null, "", `${window.location.pathname}#/aml/records/${def.id}`);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <div className="page-head">
      <div><h1>{def.title}</h1><p className="muted" style={{ margin: "4px 0 0", maxWidth: 760 }}>{def.blurb}</p></div>
    </div>
  );

  if (!rec) {
    return (
      <>
        {header}
        <section className="card pad stack">
          <p style={{ margin: 0 }}>{def.single ? "This register hasn't been started yet." : `No ${def.noun} has been started yet.`} It starts with the firm's own draft wording where there is some, ready to check and complete.</p>
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn primary" onClick={() => start()}>{def.single ? "Start the register" : `Start a ${def.noun}`}</button>
            <ExportButtons def={def} blank firm={a.firm} clientName={a.clientName} />
          </div>
        </section>
      </>
    );
  }

  const live: Live = def.id === "annualreturn" ? liveFor(a) : {};
  const ctx: p.Values = rec.values;
  const c: Ctx = { clients: a.clients, get: (k) => ctx[k], set: (k, v) => patchRec(rec.id, (r) => ({ ...r, values: { ...r.values, [k]: v } })) };

  return (
    <>
      {header}
      <section className="card pad stack" aria-label="This record">
        <div className="row-wrap" style={{ gap: 10, alignItems: "end" }}>
          {!def.single && (
            <label className="field" style={{ minWidth: 260 }}><span>{def.noun[0].toUpperCase() + def.noun.slice(1)}</span>
              <select className="input" value={rec.id} onChange={(e) => setSel(e.target.value)}>{sorted.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}</select>
            </label>
          )}
          <label className="field"><span>Date of this {def.noun}</span><input className="input" type="date" value={rec.created} onChange={(e) => e.target.value && patchRec(rec.id, (r) => ({ ...r, created: e.target.value }))} /></label>
          {!def.single && <label className="field"><span>Status</span>
            <select className="input" value={rec.status} onChange={(e) => patchRec(rec.id, (r) => ({ ...r, status: e.target.value === "Approved" ? "Approved" : "Draft" }), true)}><option>Draft</option><option>Approved</option></select>
          </label>}
          {!def.single && <button type="button" className="btn small" onClick={() => start()}>New {def.noun}</button>}
          {!def.single && <button type="button" className="btn small" onClick={() => start(rec)}>New from this one</button>}
          {!def.single && rec.status === "Draft" && <button type="button" className="btn small" onClick={() => { if (window.confirm("Delete this draft? This can't be undone.")) { edit({ records: cur.records.filter((r) => r.id !== rec.id) }, true); setSel(""); } }}>Delete draft</button>}
          <ExportButtons def={def} rec={rec} firm={a.firm} clientName={a.clientName} />
        </div>
        <div className="row-wrap" style={{ gap: 8 }}>
          {!def.single && <span className={`chip ${status.state === "overdue" ? "red" : status.state === "soon" || status.state === "draft" ? "amber" : status.state === "ok" ? "green" : ""}`}>{status.text}</span>}
          <span className="muted" role="status" aria-live="polite">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "failed" ? `Couldn't save. ${why ? `${why} ` : ""}Your changes are still on screen: try again.` : "Saves as you type."}</span>
        </div>
      </section>
      {def.sections.map((sec) => (
        <section key={sec.title} className="card pad stack" aria-label={sec.title}>
          <h2 className="sec-h">{sec.title}</h2>
          {sec.intro && <p className="muted" style={{ margin: 0 }}>{sec.intro}</p>}
          {sec.fields.map((f) => {
            const l = live[f.k];
            const shown = l ? (Array.isArray(l.value) ? l.value.join(", ") : l.value) : "";
            const same = l && JSON.stringify(c.get(f.k) ?? "") === JSON.stringify(l.value);
            return (
              <div key={f.k} className="stack" style={{ gap: 4 }}>
                <FieldView f={f} c={c} />
                {l && !same && <div className="muted" style={{ fontSize: 13 }}>The planner shows <strong>{shown}</strong> ({l.from}). <button type="button" className="btn small" onClick={() => c.set(f.k, l.value)}>Use this</button></div>}
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ the overview

function Overview() {
  const a = useAml();
  const today = todayIso();
  const stored = p.FORMS.filter((f) => f.stored).map((f) => ({ def: f, st: p.standing(f, a.storeOf(f.id), today) }));
  const actions = a.storeOf("actions").records[0];
  const rows = (Array.isArray(actions?.values.actions) ? actions!.values.actions : []) as Record<string, string>[];
  const open = rows.filter((r) => r.status !== "Done");
  const late = open.filter((r) => r.due && r.due < today);
  const training = a.storeOf("training").records[0];
  const refresh = ((Array.isArray(training?.values.people) ? training!.values.people : []) as Record<string, string>[]).map((r) => r.next).filter(Boolean).sort()[0];
  const builderRow = (cfg: Cfg) => {
    const ans = bld.readState(readSetting<unknown>(a.data.settings, `aml.${cfg.id}`));
    const built = bld.build(ans, cfg.steps);
    const vs = readSetting<bld.Version[]>(a.data.settings, `aml.${cfg.id}.versions`);
    return { confirmed: built.filter((x) => x.confirmed).length, total: built.length, version: Array.isArray(vs) && vs.length ? vs[vs.length - 1].v : "" };
  };
  const rows2: [string, string, ReturnType<typeof builderRow>][] = [["fwra", "Firm-wide risk assessment", builderRow(FWRA_CFG)], ["policies", "Policies and procedures", builderRow(POLICY_CFG)]];
  const regRows = ((a.storeOf("registrations").records[0]?.values.items || []) as Record<string, string>[]).filter((r) => r.item);
  const regOpen = regRows.filter((r) => r.status !== "Done" && r.status !== "Not needed");
  const regLate = regRows.filter((r) => r.next && r.next < today);
  const rpolicy = readReviewPolicy(a.data.settings, readOnboardingSettings(a.data.settings).amlMonths);
  const needed: { key: string; name: string; why: string; chip: string }[] = [];
  for (const cl of (a.data.clients as Row[]).filter((c) => !c.CeasedOn)) {
    const pos = position(cl, a.data.amlAssessments, a.data.onboardings, today);
    const trig = triggerOf(pos.row);
    const seen = trig ? [] : seenTriggers(cl, a.data as never, rpolicy, lastApprovedAt(cl, a.data.amlAssessments, a.data.onboardings, readAml));
    const name = String(cl.Title || cl.Key);
    if (trig) needed.push({ key: `t${cl.Key}`, name, why: `Triggered: ${trig.label}${trig.due ? `, due ${fmt(trig.due)}` : ""}${trig.due && trig.due < today ? " (overdue)" : ""}`, chip: trig.due && trig.due < today ? "red" : "amber" });
    else if (seen.length) needed.push({ key: `s${cl.Key}`, name, why: `${seen[0].label} on ${fmt(seen[0].at)}. A review has not been opened`, chip: "amber" });
    if (pos.state === "overdue") needed.push({ key: `o${cl.Key}`, name, why: `Scheduled review overdue since ${fmt(pos.reviewDate)}`, chip: "red" });
    else if (pos.state === "soon") needed.push({ key: `d${cl.Key}`, name, why: `Scheduled review due ${fmt(pos.reviewDate)}`, chip: "amber" });
    else if (pos.state === "none") needed.push({ key: `n${cl.Key}`, name, why: "No AML assessment yet", chip: "red" });
    else if (pos.state === "stopped") needed.push({ key: `s${cl.Key}`, name, why: "Due diligence could not be completed: no work for this client", chip: "red" });
  }
  needed.sort((x, y) => (x.chip === y.chip ? x.name.localeCompare(y.name) : x.chip === "red" ? -1 : 1));
  const tone = (st: p.Standing) => (st === "overdue" ? "red" : st === "soon" || st === "draft" ? "amber" : st === "ok" ? "green" : "");
  return (
    <>
      <div className="page-head"><div><h1>AML</h1><p className="muted" style={{ margin: "4px 0 0", maxWidth: 760 }}>The practice's own anti-money-laundering records, in one place. Everything is based on your own draft documents: check it, complete it and approve it before relying on it as evidence. Nothing here is sent anywhere.</p></div></div>
      <section className="card pad stack" aria-label="Client reviews needed">
        <div className="card-title-row"><h2 className="sec-h">Client reviews needed</h2><span className={`chip ${needed.length ? (needed.some((x) => x.chip === "red") ? "red" : "amber") : "green"}`}>{needed.length ? `${needed.length} to do` : "None"}</span></div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Clients with a scheduled review due or overdue, a review opened by a trigger, a change your policy says should prompt one, or no assessment yet. Review periods and triggers come from your policy's monitoring step.</p>
        {needed.length === 0 ? <p style={{ margin: 0 }}>Every client's review is up to date.</p> : (
          <div role="list" className="stack" style={{ gap: 6 }}>
            {needed.slice(0, 40).map((x) => <div role="listitem" key={x.key} className="row-wrap" style={{ justifyContent: "space-between", gap: 10 }}><span><a href={href("clients", x.key.slice(1), "aml")}>{x.name}</a>. {x.why}</span><span className={`chip ${x.chip}`}>{x.chip === "red" ? "Act" : "Soon"}</span></div>)}
            {needed.length > 40 && <span className="muted">And {needed.length - 40} more.</span>}
          </div>
        )}
      </section>
      <section className="card pad stack" aria-label="Where things stand">
        <h2 className="sec-h">Where things stand</h2>
        <div role="list" className="stack" style={{ gap: 8 }}>
          {rows2.map(([id, title, st]) => (
            <div role="listitem" key={id} className="row-wrap" style={{ gap: 10, justifyContent: "space-between", alignItems: "center" }}>
              <a href={href("aml", id)}><strong>{title}</strong></a>
              <span className={`chip ${st.confirmed === st.total && st.version ? "green" : "amber"}`}>{st.confirmed === 0 && !st.version ? "Not started" : `${st.confirmed} of ${st.total} areas confirmed${st.version ? `, version ${st.version} saved` : ""}`}</span>
            </div>
          ))}
          {stored.map(({ def, st }) => (
            <div role="listitem" key={def.id} className="row-wrap" style={{ gap: 10, justifyContent: "space-between", alignItems: "center" }}>
              <a href={href("aml", def.id)}><strong>{def.title}</strong></a>
              <span className={`chip ${def.id === "registrations" && regRows.length ? (regLate.length ? "red" : regOpen.length ? "amber" : "green") : tone(st.state)}`}>{def.id === "actions" ? (rows.length ? `${open.length} open${late.length ? `, ${late.length} late` : ""}` : st.text) : def.id === "training" && refresh ? `Next refresher ${fmt(refresh)}` : def.id === "registrations" && regRows.length ? (regOpen.length || regLate.length ? `${regOpen.length} to do${regLate.length ? `, ${regLate.length} overdue` : ""}` : "All done") : st.text}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="card pad stack" aria-label="Kept out of the planner">
        <h2 className="sec-h">Kept out of the planner on purpose</h2>
        <p style={{ margin: 0 }}>Your policy says suspicious activity reports, the MLRO's decisions and the SAR register are restricted and must not sit in general files. So the planner only prints those forms blank. <a href={href("aml", "forms")}>Blank SAR forms</a></p>
      </section>
    </>
  );
}


// ------------------------------------------------------------------ the checklist: what is expected, and what still needs work

function Checklist() {
  const a = useAml();
  const today = todayIso();
  const builderFacts = (cfg: Cfg) => {
    const st = bld.readState(readSetting<unknown>(a.data.settings, `aml.${cfg.id}`));
    const built = bld.build(st, cfg.steps);
    const vs = readSetting<bld.Version[]>(a.data.settings, `aml.${cfg.id}.versions`);
    const last = Array.isArray(vs) && vs.length ? vs[vs.length - 1] : undefined;
    return { confirmed: built.filter((x) => x.confirmed).length, total: built.length, version: last?.v || "", approved: !!last?.approved, date: last?.date || "", steps: Object.fromEntries(built.map((x) => [x.id, x.confirmed])) };
  };
  const stand = (id: string) => { const d = p.formById(id)!; const r = p.standing(d, a.storeOf(id), today); return { state: r.state as RStanding, text: r.text }; };
  const rowsOf = (id: string, key: string) => ((a.storeOf(id).records[0]?.values[key] || []) as Record<string, string>[]);
  const actions = rowsOf("actions", "actions"), regs = rowsOf("registrations", "items").filter((r) => r.item);
  const pol = bld.readState(readSetting<unknown>(a.data.settings, "aml.builder")).answers;
  const clients = { total: 0, none: 0, overdue: 0, soon: 0, triggered: 0 };
  const rp = readReviewPolicy(a.data.settings, readOnboardingSettings(a.data.settings).amlMonths);
  const scrPol = screeningPolicy(a.data.settings, rp);
  const scrReg = a.storeOf("screening").records;
  const scrCount = { overdue: 0, never: 0 };
  for (const cl of (a.data.clients as Row[]).filter((c) => !c.CeasedOn)) {
    const pos = position(cl, a.data.amlAssessments, a.data.onboardings, today);
    clients.total++;
    if (pos.state === "none" || pos.state === "declined" || pos.state === "stopped") clients.none++; else if (pos.state === "overdue") clients.overdue++; else if (pos.state === "soon") clients.soon++;
    if (pos.current) { const sc = screeningOf(cl, pos.risk, scrPol, a.data.amlAssessments, scrReg, today); if (sc.days === null) scrCount.never++; else if (sc.days < 0) scrCount.overdue++; }
    if (triggerOf(pos.row) || seenTriggers(cl, a.data as never, rp, lastApprovedAt(cl, a.data.amlAssessments, a.data.onboardings, readAml)).length) clients.triggered++;
  }
  const training = rowsOf("training", "people").map((r) => r.next).filter(Boolean).sort()[0] || "";
  const screening = [...[...a.storeOf("screening").records].map((r) => String((r.values as Record<string, unknown>).on || "").slice(0, 10) || String(r.created).slice(0, 10)), ...(a.data.clients as Row[]).filter((c) => !c.CeasedOn).map((c) => amlStampRead(c.XamaAmlCheck)).filter((x) => x.state === "done" || x.state === "check").map((x) => x.on)].filter(Boolean).sort().pop() || "";
  const facts: Facts = {
    today, policy: builderFacts(POLICY_CFG), fwra: builderFacts(FWRA_CFG), mlro: String(pol.mlro || "").trim(), deputy: String(pol.deputyName || "").trim(),
    standing: { mlro: stand("mlro"), training: stand("training"), independent: stand("independent"), annualreturn: stand("annualreturn"), reviews: stand("reviews") },
    trainingNext: training, screeningLast: screening, screening: scrCount, clients,
    regs: { count: regs.length, late: regs.filter((r) => r.next && r.next < today).length, open: regs.filter((r) => r.status !== "Done" && r.status !== "Not needed").length },
    actions: { open: actions.filter((r) => r.status !== "Done").length, late: actions.filter((r) => r.status !== "Done" && r.due && r.due < today).length },
  };
  const items = readiness(facts);
  const done = items.filter((i) => i.state === "done").length;
  const groups = [...new Set(items.map((i) => i.group))];
  const chip = (s: string) => (s === "done" ? "green" : s === "work" ? "amber" : "red");
  const word = (s: string) => (s === "done" ? "Done" : s === "work" ? "Needs work" : "Not started");
  return (
    <>
      <div className="page-head"><div><h1>ACCA checklist</h1><p className="muted" style={{ margin: "4px 0 0", maxWidth: 780 }}>What an ACCA-supervised firm is expected to have in place for AML, checked against what is recorded in the planner. Start with the red and amber items.</p></div></div>
      <section className="card pad stack" aria-label="Summary">
        <span><strong>{done} of {items.length}</strong> in place. {items.filter((i) => i.state === "start").length} not started, {items.filter((i) => i.state === "work").length} need work.</span>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>"Done" means the planner holds evidence. It can't judge whether an answer is good enough, and some duties, such as screening staff, can only be checked by whether the policy covers them. Regulation numbers are from the Money Laundering Regulations 2017: check them against ACCA's current guidance.</p>
      </section>
      {groups.map((g) => (
        <section key={g} className="card pad stack" aria-label={g}>
          <h2 className="sec-h">{g}</h2>
          <div role="list" className="stack" style={{ gap: 10 }}>
            {items.filter((i) => i.group === g).map((i) => (
              <div role="listitem" key={i.id} className="row-wrap" style={{ gap: 10, justifyContent: "space-between", alignItems: "start" }}>
                <span style={{ flex: 1, minWidth: 260 }}><a href={href("aml", i.to)}><strong>{i.title}</strong></a>{i.reg && <span className="muted"> ({i.reg})</span>}<div className="muted" style={{ fontSize: 13 }}>{i.detail}</div></span>
                <span className={`chip ${chip(i.state)}`}>{word(i.state)}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function BlankForms() {
  const a = useAml();
  return (
    <>
      <div className="page-head"><div><h1>SAR and blank forms</h1><p className="muted" style={{ margin: "4px 0 0", maxWidth: 760 }}>These are printed blank and filled in by hand or in Word, and the completed copies are kept in a restricted place. Nothing you type about a suspicion is stored in the planner.</p></div></div>
      {p.FORMS.filter((f) => !f.stored).map((f) => (
        <section key={f.id} className="card pad stack" aria-label={f.title}>
          <div className="card-title-row"><h2 className="sec-h">{f.title}{f.restricted && <span className="chip red" style={{ marginLeft: 8 }}>Restricted</span>}</h2><ExportButtons def={f} blank firm={a.firm} clientName={a.clientName} /></div>
          <p className="muted" style={{ margin: 0 }}>{f.blurb}</p>
        </section>
      ))}
    </>
  );
}

/** The screening register as Xama holds it: each client's AML check (identity, PEP and sanctions) with the date it was done. */
function XamaScreening() {
  const a = useAml();
  const rows = (a.data.clients as Row[]).filter((c) => !c.CeasedOn).map((c) => ({ c, x: amlStampRead(c.XamaAmlCheck) })).filter((r) => r.x.state).sort((p, q) => q.x.on.localeCompare(p.x.on));
  return (
    <section className="card pad stack" aria-label="Screening from Xama">
      <h2 className="sec-h">From Xama</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Each client's Xama AML check (identity and address, PEP and sanctions), dated from Xama's own report. It fills in when you refresh a client's Xama result. Record checks done anywhere else in the form below.</p>
      {rows.length === 0 ? <p className="muted" style={{ margin: 0 }}>No Xama AML check has been picked up yet. Open a client's AML tab and press Refresh result after running one.</p> : (
        <table className="table"><thead><tr><th>Client</th><th>Checked</th><th>Result</th></tr></thead>
          <tbody>{rows.map(({ c, x }) => <tr key={String(c.Key)}><td><a href={href("clients", String(c.Key), "aml")}>{String(c.Title)}</a></td><td>{x.on ? fmtDate(x.on) : "—"}</td>
            <td>{x.state === "waiting" ? "Running" : x.state === "done" ? "No PEP or sanctions matches" : `Possible matches: ${x.pep} PEP, ${x.sanctions} sanctions. Review in Xama`}</td></tr>)}</tbody></table>
      )}
    </section>
  );
}

const TONE_INK: Record<Tone, string> = { green: "green", amber: "amber", red: "red", "": "" };

/** Every AML record on one timeline: filter by type, search, and add a new one. An entry opens in the form it is kept in. */
function Records() {
  const a = useAml();
  const today = todayIso();
  const [types, setTypes] = useState<RecType[]>([]);
  const [view, setView] = useState<"all" | "upcoming" | "attention">("all");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const stores = Object.fromEntries(REC_TYPES.map((t) => [t.form, a.storeOf(t.form)]));
  const all = useMemo(() => timeline(stores, { name: a.clientName, today }), [a.data, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = (e: Entry) => `${e.title} ${e.detail} ${e.chip} ${REC_TYPES.find((t) => t.type === e.type)?.label}`.toLowerCase();
  const pass = (e: Entry, skipType = false) => (skipType || !types.length || types.includes(e.type))
    && (view === "all" || (view === "upcoming" ? e.upcoming : e.tone === "red" || e.tone === "amber")) && (!q.trim() || text(e).includes(q.trim().toLowerCase()));
  const shown = all.filter((e) => pass(e));
  const month = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "No date");
  let last = "";
  return (
    <>
      <div className="page-head"><div><h1>AML records</h1><p className="muted" style={{ margin: "4px 0 0", maxWidth: 780 }}>Client reviews, screening checks, training, actions, registrations, the MLRO report and the independent review on one timeline, newest first, with what is coming up next. Choose a type to filter, or add a new record: it opens in the same form as before.</p></div></div>
      <section className="card pad stack" aria-label="Filters">
        <div className="row-wrap" style={{ gap: 8, alignItems: "center", justifyContent: "space-between" }}>
          <div className="row-wrap" role="group" aria-label="Type" style={{ gap: 8 }}>
            <button type="button" className={`btn small${!types.length ? " primary" : ""}`} aria-pressed={!types.length} onClick={() => setTypes([])}>All ({all.filter((e) => pass(e, true)).length})</button>
            {REC_TYPES.map((t) => <button key={t.type} type="button" className={`btn small${types.includes(t.type) ? " primary" : ""}`} aria-pressed={types.includes(t.type)} onClick={() => setTypes(types.includes(t.type) ? types.filter((x) => x !== t.type) : [...types, t.type])}>{t.label} ({all.filter((e) => e.type === t.type && pass(e, true)).length})</button>)}
          </div>
          <div style={{ position: "relative" }}>
            <button type="button" className="btn primary" aria-expanded={adding} onClick={() => setAdding(!adding)}>+ Add</button>
            {adding && (
              <div role="menu" aria-label="Add a record" className="card pad stack" style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 5, minWidth: 240, gap: 4, boxShadow: "0 8px 24px rgba(0,0,0,.18)" }}>
                {REC_TYPES.map((t) => <a key={t.type} role="menuitem" className="btn small" style={{ textAlign: "left" }} href={`#/aml/records/${t.form}?add=1`}>{t.add}</a>)}
              </div>
            )}
          </div>
        </div>
        <div className="row-wrap" style={{ gap: 10, alignItems: "end" }}>
          <div className="row-wrap" role="group" aria-label="Show" style={{ gap: 8 }}>
            {([["all", "Everything"], ["upcoming", "Coming up"], ["attention", "Needs attention"]] as const).map(([k, l]) => <button key={k} type="button" className={`btn small${view === k ? " primary" : ""}`} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
          </div>
          <label className="field"><span>Search</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
      </section>
      <section className="card pad" aria-label="Timeline">
        {shown.length === 0 ? <p style={{ margin: 0 }}>{all.length ? "Nothing matches." : "Nothing recorded yet. Use Add to start."}</p> : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {shown.map((e) => {
              const m = month(e.date), head = m !== last; last = m;
              const t = REC_TYPES.find((x) => x.type === e.type)!;
              const to = `#/aml/records/${e.form}${e.rec ? `?rec=${encodeURIComponent(e.rec)}` : ""}`;
              return (
                <li key={e.key}>
                  {head && <h3 className="sec-h" style={{ margin: "14px 0 6px", fontSize: 14 }}>{m}</h3>}
                  <div className="row-wrap" style={{ gap: 12, alignItems: "center", padding: "8px 0", borderTop: "1px solid var(--line, #e6e8ee)" }}>
                    <span style={{ width: 92, flex: "none", fontVariantNumeric: "tabular-nums" }} className={e.upcoming ? "" : "muted"}>{e.date ? fmt(e.date) : "—"}</span>
                    <span className="chip" style={{ flex: "none" }}>{t.label}</span>
                    <span style={{ flex: "1 1 260px", minWidth: 0 }}><a href={to}><strong>{e.title}</strong></a>{e.detail && <div className="muted" style={{ fontSize: 12 }}>{e.detail}</div>}</span>
                    <span className={`chip ${TONE_INK[e.tone]}`} style={{ flex: "none" }}>{e.chip}</span>
                    <a className="btn small" href={to}>Open</a>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </>
  );
}

export function AmlPage() {
  const { parts, query } = useRoute();
  // the old tabs (training, actions and so on) now live under Records; their links still work
  const valid = (f?: string) => (REC_TYPES.some((t) => t.form === f) ? (f as string) : "");
  const form = parts[1] === "records" ? valid(parts[2]) : valid(parts[1]);
  const tab = form || parts[1] === "records" ? "records" : TABS.find(([k]) => k === parts[1])?.[0] || "overview";
  const def = form ? p.formById(form) : p.formById(tab);
  let body: ReactNode;
  if (tab === "overview") body = <Overview />;
  else if (tab === "policies") body = <PolicyBuilder key="policies" cfg={POLICY_CFG} />;
  else if (tab === "fwra") body = <PolicyBuilder key="fwra" cfg={FWRA_CFG} />;
  else if (tab === "clients") body = <AmlClients />;
  else if (tab === "checklist") body = <Checklist />;
  else if (tab === "forms") body = <BlankForms />;
  else if (tab === "records" && !form) body = <Records />;
  else if (tab === "records" && def) {
    const back = <a className="no-print" href="#/aml/records">‹ Back to the timeline</a>;
    body = <>{back}{def.id === "screening" && <XamaScreening />}<FormScreen key={`${def.id}${query.get("rec") || ""}`} def={def} sel={query.get("rec") || ""} add={query.get("add") === "1"} /></>;
  } else body = def ? <FormScreen key={def.id} def={def} /> : null;
  return (
    <div className="page">
      <div className="row-wrap no-print" role="tablist" aria-label="AML" style={{ gap: 8 }}>
        {TABS.map(([k, l]) => <a key={k} role="tab" aria-selected={tab === k} className={`btn small${tab === k ? " primary" : ""}`} href={href("aml", k)}>{l}</a>)}
      </div>
      {body}
    </div>
  );
}
