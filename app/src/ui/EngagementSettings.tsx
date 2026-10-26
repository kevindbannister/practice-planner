// Settings › Engagement letters: the practice's own wording (reviewed before use), per client type, and review intervals.
import { useEffect, useState } from "react";
import { CLIENT_TYPES, ClientType, typeLabel } from "../lib/proposals";
import { BLANK_SECTIONS, EngagementSettings, SECTIONS, SectionKey, Sections, reviewStatus, reviewTemplate, templateFor } from "../lib/engagements";
import { useData } from "./data";
import { useSales } from "./salesKit";

export function EngagementLetterSettings() {
  const s = useSales();
  const { data, saveSetting } = useData();
  const allowed = s.pcan("configure");
  const [scope, setScope] = useState<"base" | ClientType>("base");
  const [draft, setDraft] = useState<EngagementSettings>(s.eng);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(s.eng); }, [data.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = (k: SectionKey) => (scope === "base" ? draft.base[k] : draft.byType[scope]?.[k] ?? "");
  const setText = (k: SectionKey, v: string) => setDraft(scope === "base" ? { ...draft, base: { ...draft.base, [k]: v } } : { ...draft, byType: { ...draft.byType, [scope]: { ...draft.byType[scope], [k]: v } } });
  const eff: Sections = scope === "base" ? draft.base : templateFor(draft, scope);
  const status = scope === "base" ? (draft.reviewed.base ? { ok: true, reason: "" } : { ok: false, reason: "Not reviewed yet." }) : reviewStatus(draft, scope);
  const persist = async (next: EngagementSettings) => saveSetting("engagement.settings", next);
  const save = async () => {
    setBusy(true); setMsg(undefined);
    try { await persist(draft); setMsg({ ok: true, text: "Saved. Changed wording has to be reviewed again before letters can use it." }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't save." }); } finally { setBusy(false); }
  };
  const review = async () => {
    const r = reviewTemplate(draft, scope, s.pcan, s.me, new Date().toISOString());
    if ("error" in r) return setMsg({ ok: false, text: r.error });
    setBusy(true);
    try { await persist(r.settings); setDraft(r.settings); setMsg({ ok: true, text: "Marked as reviewed. Letters can now be made from this wording." }); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't save." }); } finally { setBusy(false); }
  };
  const years = (v: string) => (v === "" ? undefined : Math.max(1, Math.min(10, Math.floor(Number(v)) || 3)));
  const stamp = draft.reviewed[scope];
  const dirty = JSON.stringify(draft) !== JSON.stringify(s.eng);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad stack" aria-label="Engagement wording">
        <h2 style={{ margin: 0 }}>Engagement letter wording</h2>
        <p className="muted" style={{ margin: 0 }}>Write your own reviewed wording here. The planner never makes up legal or professional terms: letters are built only from what you save and review below, plus the services, fees and clauses from the accepted proposal. Use {"{{client}}"}, {"{{practice}}"}, {"{{date}}"}, {"{{effectiveDate}}"}, {"{{reviewDate}}"} and {"{{years}}"} where you want them filled in.</p>
        <div className="row-wrap" role="tablist" aria-label="Wording for">
          <button type="button" role="tab" aria-selected={scope === "base"} className={"btn small" + (scope === "base" ? " primary" : "")} onClick={() => setScope("base")}>All clients</button>
          {CLIENT_TYPES.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={scope === k} className={"btn small" + (scope === k ? " primary" : "")} onClick={() => setScope(k)}>{l}</button>)}
        </div>
        {scope !== "base" && <p className="muted" style={{ margin: 0 }}>Anything left blank here uses the "All clients" wording. Wording written here replaces it for {typeLabel(scope).toLowerCase()} clients.</p>}
        {SECTIONS.map(([k, label]) => (
          <label key={k} className="doc-field"><span>{label}</span>
            <textarea className="input" rows={k === "wording" || k === "terms" ? 5 : 3} disabled={!allowed} value={text(k)} placeholder={scope === "base" ? BLANK_SECTIONS[k] : eff[k]} onChange={(e) => setText(k, e.target.value)} />
          </label>
        ))}
        <p role="status" style={{ margin: 0, color: status.ok ? "var(--green)" : "var(--amber-ink)" }}>
          {status.ok ? `Reviewed${stamp ? ` by ${stamp.by}` : ""}.` : status.reason}
        </p>
        {msg && <p role={msg.ok ? "status" : "alert"} style={{ margin: 0, color: msg.ok ? "var(--green)" : "var(--red-ink)" }}>{msg.text}</p>}
        <div className="row-wrap">
          <button type="button" className="btn primary" disabled={!allowed || busy || !dirty} onClick={save}>Save wording</button>
          <button type="button" className="btn" disabled={!allowed || busy || dirty || status.ok} onClick={review} title={dirty ? "Save first" : ""}>I have reviewed this wording</button>
        </div>
        {!allowed && <p className="muted" style={{ margin: 0 }}>Only a manager or partner can change the wording.</p>}
      </section>

      <section className="card pad stack" aria-label="Review intervals">
        <h2 style={{ margin: 0 }}>Renewal and review</h2>
        <p className="muted" style={{ margin: 0 }}>Engagements are reviewed three years after they take effect unless set otherwise. The most specific setting wins: the engagement itself, then the client, then the client type, then the practice.</p>
        <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          <label className="doc-field"><span>Practice default (years)</span><input className="input" type="number" min={1} max={10} disabled={!allowed} value={draft.years} onChange={(e) => setDraft({ ...draft, years: years(e.target.value) || 3 })} /></label>
          {CLIENT_TYPES.map(([k, l]) => (
            <label key={k} className="doc-field"><span>{l} (years)</span><input className="input" type="number" min={1} max={10} placeholder="Practice default" disabled={!allowed} value={draft.typeYears[k] ?? ""} onChange={(e) => { const y = years(e.target.value); const t = { ...draft.typeYears }; if (y) t[k] = y; else delete t[k]; setDraft({ ...draft, typeYears: t }); }} /></label>
          ))}
          <label className="doc-field"><span>Remind me this many days before (comma separated)</span><input className="input" disabled={!allowed} value={draft.remindDays.join(", ")} onChange={(e) => { const d: number[] = e.target.value.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n >= 1 && n <= 365); setDraft({ ...draft, remindDays: d.length ? ([...new Set<number>(d)] as number[]).sort((a: number, b: number) => b - a) : draft.remindDays }); }} /></label>
        </div>
        {Object.keys(draft.clientYears).length > 0 && (
          <div><strong>Clients with their own interval</strong>
            <ul className="plain">{Object.entries(draft.clientYears).map(([ck, y]) => (
              <li key={ck}>{data.clients.find((c) => c.Key === ck)?.Title || ck}: {y} years {allowed && <button type="button" className="linkbtn" onClick={() => { const c = { ...draft.clientYears }; delete c[ck]; setDraft({ ...draft, clientYears: c }); }}>Remove</button>}</li>
            ))}</ul>
          </div>
        )}
        <ClientInterval disabled={!allowed} onAdd={(ck, y) => setDraft({ ...draft, clientYears: { ...draft.clientYears, [ck]: y } })} />
        <div><button type="button" className="btn primary" disabled={!allowed || busy || !dirty} onClick={save}>Save intervals</button></div>
      </section>
    </div>
  );
}

function ClientInterval({ onAdd, disabled }: { onAdd: (clientKey: string, years: number) => void; disabled: boolean }) {
  const { data } = useData();
  const [ck, setCk] = useState("");
  const [y, setY] = useState(3);
  return (
    <div className="row-wrap" style={{ alignItems: "end" }}>
      <label className="doc-field"><span>Set a client's own interval</span>
        <select className="input" disabled={disabled} value={ck} onChange={(e) => setCk(e.target.value)} aria-label="Client"><option value="">Choose a client…</option>{[...data.clients].sort((a, b) => a.Title.localeCompare(b.Title)).map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}</select>
      </label>
      <label className="doc-field"><span>Years</span><input className="input" type="number" min={1} max={10} style={{ width: 80 }} disabled={disabled} value={y} onChange={(e) => setY(Math.max(1, Math.min(10, Number(e.target.value) || 3)))} /></label>
      <button type="button" className="btn" disabled={disabled || !ck} onClick={() => { onAdd(ck, y); setCk(""); }}>Add</button>
    </div>
  );
}
