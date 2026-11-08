// The AML policy builder screen. The firm answers questions one area at a time and the policy is written from the answers. Each area has
// to be confirmed by the person, gaps show in the text, and versions are kept. See lib/amlBuilder.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { position } from "../lib/amlAssessment";
import * as b from "../lib/amlBuilder";
import { FWRA_STEPS } from "../lib/amlFwra";
import * as p from "../lib/amlPack";
import { DOCX_TYPE } from "../lib/docx";
import { todayIso } from "../lib/domain";
import { Row } from "../lib/schema";
import { readSetting, useData } from "./data";
import { useFirm } from "./FirmSettings";
import { href } from "./bits";

export type Cfg = {
  id: string; title: string; docTitle: string; intro: string; steps: b.Step[]; prefillFirm?: boolean;
  /** Answers and facts from elsewhere that the questions can use (never stored here). */
  extra?: (data: ReturnType<typeof useData>["data"]) => b.Answers;
};
const stateKey = (c: Cfg) => `aml.${c.id}`;
const versionsKey = (c: Cfg) => `aml.${c.id}.versions`;
const snapKey = (c: Cfg, v: string) => `aml.${c.id}.v${v}`;
type Snap = { head: { version: string; updated: string; approvedBy: string }; built: { title: string; text: string }[] };

function download(name: string, bytes: Uint8Array | Blob, type: string) {
  const url = URL.createObjectURL(bytes instanceof Blob ? bytes : new Blob([bytes as unknown as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** The text of a step with gaps picked out so they can't be missed. */
function Text({ text }: { text: string }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {text.split("\n").map((line, i) => {
        const h = /^##\s+(.*)$/.exec(line);
        if (!line.trim()) return null;
        const body = line.replace(/^##\s+/, "").replace(/^[-•]\s+/, "");
        const bits = body.split(/(\[\[Answer needed: [^\]]+\]\])/g).map((t, j) => (/^\[\[Answer needed: /.test(t) ? <mark key={j} style={{ background: "#fde68a", padding: "0 4px", borderRadius: 3 }}>{t.replace(/^\[\[|\]\]$/g, "")}</mark> : <span key={j}>{t}</span>));
        if (h) return <h3 key={i} style={{ margin: "8px 0 0" }}>{bits}</h3>;
        if (/^[-•]\s/.test(line)) return <div key={i} style={{ paddingLeft: 16, textIndent: -12 }}>• {bits}</div>;
        return <p key={i} style={{ margin: 0 }}>{bits}</p>;
      })}
    </div>
  );
}

function QuestionView({ q, a, set }: { q: b.Q; a: b.Answers; set: (k: string, v: string | string[]) => void }) {
  const v = a[q.k];
  const sv = Array.isArray(v) ? v.join(", ") : v || "";
  const labelEl = <span>{q.label}{q.need && <span aria-hidden="true" className="muted"> *</span>}</span>;
  let input;
  if (q.type === "one" || q.type === "many") {
    const chosen = Array.isArray(v) ? v : v ? [v] : [];
    input = (
      <div role="group" aria-label={q.label} className="stack" style={{ gap: 6 }}>
        {q.options!.map((opt) => (
          <label key={opt.v} style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
            <input type={q.type === "one" ? "radio" : "checkbox"} name={q.k} checked={chosen.includes(opt.v)}
              onChange={() => set(q.k, q.type === "one" ? opt.v : chosen.includes(opt.v) ? chosen.filter((x) => x !== opt.v) : [...chosen, opt.v])} style={{ marginTop: 3 }} />
            <span>{opt.label}{opt.url && <> (<a href={opt.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>open the source<span className="sr-only"> for {opt.label}, opens in a new tab</span></a>)</>}</span>
          </label>
        ))}
      </div>
    );
  } else if (q.type === "long") input = <textarea className="input" rows={3} value={sv} placeholder={q.placeholder} onChange={(e) => set(q.k, e.target.value)} />;
  else input = <input className="input" type={q.type === "date" ? "date" : q.type === "number" ? "number" : "text"} value={sv} placeholder={q.placeholder} onChange={(e) => set(q.k, e.target.value)} />;
  return (
    <div className="field" style={{ maxWidth: 760 }}>
      {q.type === "one" || q.type === "many" ? <div style={{ fontWeight: 600, marginBottom: 4 }}>{labelEl}</div> : <label><div style={{ fontWeight: 600, marginBottom: 4 }}>{labelEl}</div>{input}</label>}
      {(q.type === "one" || q.type === "many") && input}
      {q.links && q.links.length > 0 && <div style={{ fontSize: 13 }}>{q.links.map((l, i) => <span key={l.url}>{i ? " · " : ""}<a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}<span className="sr-only"> (opens in a new tab)</span></a></span>)}</div>}
      {q.help && <div className="muted" style={{ fontSize: 13 }}>{q.help}</div>}
      {q.source && <details style={{ fontSize: 13 }}><summary className="muted" style={{ cursor: "pointer" }}>Why we ask</summary><div className="muted">{q.source}</div></details>}
    </div>
  );
}

export const POLICY_CFG: Cfg = {
  id: "builder", title: "Policies and procedures", docTitle: "Anti-money laundering policy and procedures", steps: b.STEPS, prefillFirm: true,
  intro: "Answer the questions area by area and the policy is written from your answers, following ACCA's AML policy and procedures factsheet. Your own words are used wherever you give them. Anything missing shows as a gap, and each area must be confirmed by you before the policy is complete.",
};
export const FWRA_CFG: Cfg = {
  id: "fwra2", title: "Firm-wide risk assessment", docTitle: "Firm-wide risk assessment", steps: FWRA_STEPS,
  intro: "Answer the questions for each of ACCA's six risk areas and the assessment is written from your answers. Facts you gave in the policy builder are reused, and the client percentages come from the risk ratings in the planner. The ratings are your own judgement: nothing here rates a risk for you.",
  extra: (data) => {
    const pol = b.readState(readSetting<unknown>(data.settings, stateKey(POLICY_CFG))).answers;
    const today = todayIso();
    const cl = (data.clients as Row[]).filter((c) => !c.CeasedOn);
    let high = 0, med = 0, lowN = 0;
    for (const c of cl) { const r = position(c, data.amlAssessments, data.onboardings, today).risk; if (r === "high") high++; else if (r === "medium") med++; else if (r === "low") lowN++; }
    return { ...pol, _n: String(cl.length), _high: String(high), _med: String(med), _low: String(lowN), _unrated: String(cl.length - high - med - lowN) };
  },
};

export function PolicyBuilder({ cfg = POLICY_CFG }: { cfg?: Cfg }) {
  const { data, saveSetting } = useData();
  const firm = useFirm();
  const firmName = String(firm.firmName || "").trim() || "The practice";
  const stored = useMemo(() => b.readState(readSetting<unknown>(data.settings, stateKey(cfg))), [data.settings, cfg]);
  const extra = useMemo(() => (cfg.extra ? cfg.extra(data) : {}), [data, cfg]);
  const versions = useMemo(() => {
    const v = readSetting<b.Version[]>(data.settings, versionsKey(cfg));
    return Array.isArray(v) ? v : [];
  }, [data.settings, cfg]);
  const [local, setLocal] = useState<b.State | null>(null);
  const [status, setStatus] = useState<"" | "saving" | "saved" | "failed">("");
  const [stepId, setStepId] = useState<string>(cfg.steps[0].id);
  const [view, setView] = useState<"steps" | "policy" | "versions">("steps");
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [approved, setApproved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<b.State | null>(null);
  const counter = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const saveRef = useRef(saveSetting); saveRef.current = saveSetting;

  const cur = local ?? stored;
  // Start the firm name from the firm's own settings the first time only.
  const own = cfg.prefillFirm && cur.answers.firmName === undefined && firmName !== "The practice" ? { ...cur.answers, firmName } : cur.answers;
  const state: b.State = { ...cur, answers: own };
  const docDate = cur.date || todayIso();
  const merged: b.State = { ...cur, answers: { ...extra, ...own, _date: cur.date || "" } };

  const persist = (next: b.State, n: number) => {
    chain.current = chain.current.then(async () => {
      try { await saveRef.current(stateKey(cfg), next); if (counter.current === n) { setLocal(null); latest.current = null; setStatus("saved"); } } catch { setStatus("failed"); }
    });
  };
  const edit = (next: b.State, now = false) => {
    setLocal(next); latest.current = next; setStatus("saving");
    const n = ++counter.current;
    window.clearTimeout(timer.current);
    if (now) persist(next, n); else timer.current = window.setTimeout(() => persist(next, n), 700);
  };
  useEffect(() => () => { if (latest.current) { window.clearTimeout(timer.current); persist(latest.current, counter.current); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const built = useMemo(() => b.build(merged, cfg.steps), [merged.answers, state.edits, state.confirmed, cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  const out = b.outstanding(built);
  const step = cfg.steps.find((x) => x.id === stepId)!;
  const bs = built.find((x) => x.id === stepId)!;
  const idx = cfg.steps.findIndex((x) => x.id === stepId);
  const qs = b.shown(step, merged.answers);
  const setAnswer = (k: string, v: string | string[]) => edit({ ...state, answers: { ...state.answers, [k]: v }, confirmed: { ...state.confirmed, [stepId]: false } });
  const gapsOf = (x: (typeof built)[number]) => x.gaps.length + x.unanswered.length;
  const stepState = (x: (typeof built)[number]) => (x.confirmed ? { t: "Confirmed", c: "green" } : gapsOf(x) ? { t: `${gapsOf(x)} to answer`, c: "amber" } : { t: "To confirm", c: "blue" });
  const latestV = versions.length ? versions[versions.length - 1] : undefined;

  const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const meta = (title: string, date: string): p.Meta => ({ firm: firmName, title: `${title}, ${longDate(date)}`, status: "", date, today: todayIso() });
  const blocksFor = (src: { title: string; text: string }[], head: { version: string; updated: string; approvedBy: string }) =>
    b.policyBlocks(src, { firm: firmName, ...head }, versions);
  const head = { version: latestV?.v || "", updated: docDate, approvedBy: latestV?.approved ? latestV.by : "" };
  const word = async () => {
    setMsg("");
    try { download(p.fileName(cfg.docTitle, docDate, "docx"), await p.toDocx(blocksFor(built, head), meta(cfg.docTitle, docDate)), DOCX_TYPE); } catch { setMsg("Couldn't make the Word file."); }
  };
  const pdf = () => {
    setMsg("");
    const url = URL.createObjectURL(new Blob([p.toHtml(blocksFor(built, head), meta(cfg.docTitle, docDate))], { type: "text/html" }));
    if (!window.open(url, "_blank")) setMsg("The print page was blocked. Allow pop-ups for this site and try again.");
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const saveVersion = async () => {
    setMsg("");
    if (out.unconfirmed.length || out.gaps) { if (!window.confirm(`The policy still has ${out.gaps} gap${out.gaps === 1 ? "" : "s"} and ${out.unconfirmed.length} unconfirmed section${out.unconfirmed.length === 1 ? "" : "s"}. Save it as a draft version anyway?`)) return; }
    const v = b.nextVersion(versions);
    const entry: b.Version = { v, date: docDate, note: note.trim() || (versions.length ? "Updated" : "First version"), by: by.trim(), approved };
    const snap: Snap = { head: { version: v, updated: entry.date, approvedBy: approved ? entry.by : "" }, built: built.map((x) => ({ title: x.title, text: x.text })) };
    try {
      await saveSetting(snapKey(cfg, v), snap);
      await saveSetting(versionsKey(cfg), [...versions, entry]);
      setNote(""); setApproved(false); setMsg(`Saved as version ${v}.`);
    } catch { setMsg("Couldn't save the version. Try again."); }
  };
  const exportVersion = async (v: b.Version, kind: "word" | "pdf") => {
    const snap = readSetting<Snap>(data.settings, snapKey(cfg, v.v));
    if (!snap || !Array.isArray(snap.built)) { setMsg("That version's text wasn't found."); return; }
    const list = b.policyBlocks(snap.built, { firm: firmName, ...snap.head }, versions.filter((x) => Number(x.v) <= Number(v.v)));
    const m = meta(`${cfg.docTitle}, version ${v.v}`, v.date);
    if (kind === "word") download(p.fileName(`${cfg.docTitle} v${v.v}`, v.date, "docx"), await p.toDocx(list, m), DOCX_TYPE);
    else { const url = URL.createObjectURL(new Blob([p.toHtml(list, m)], { type: "text/html" })); window.open(url, "_blank"); window.setTimeout(() => URL.revokeObjectURL(url), 60000); }
  };

  const facts = useMemo(() => {
    const cl = (data.clients as Row[]).filter((c) => !c.CeasedOn);
    return { clients: cl.length };
  }, [data.clients]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{cfg.title}</h1>
          <p className="muted" style={{ margin: "4px 0 0", maxWidth: 780 }}>{cfg.intro}</p>
        </div>
      </div>
      <section className="card pad stack" aria-label="Progress">
        <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
          <div className="row-wrap" style={{ gap: 8 }}>
            <span className={`chip ${out.gaps ? "amber" : "green"}`}>{out.gaps ? `${out.gaps} gap${out.gaps === 1 ? "" : "s"} to fill` : "No gaps"}</span>
            <span className={`chip ${out.unconfirmed.length ? "amber" : "green"}`}>{cfg.steps.length - out.unconfirmed.length} of {cfg.steps.length} areas confirmed</span>
            <span className="chip">{latestV ? `Saved version ${latestV.v}${latestV.approved ? ", approved" : ", draft"}` : "No version saved yet"}</span>
            <span className="muted" role="status" aria-live="polite">{status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "failed" ? "Couldn't save. Your changes are still on screen: try again." : "Saves as you type."}</span>
          </div>
          <div className="row-wrap" style={{ gap: 6, alignItems: "end" }}>
            <label className="field" style={{ margin: 0 }}><span>Date of this document</span><input className="input" type="date" value={docDate} onChange={(e) => e.target.value && edit({ ...state, date: e.target.value })} /></label>
            <button type="button" className="btn small" onClick={word}>Word</button>
            <button type="button" className="btn small" onClick={pdf}>PDF</button>
          </div>
        </div>
        {msg && <div role="alert" className="warn">{msg}</div>}
        <div className="row-wrap no-print" role="tablist" style={{ gap: 8 }}>
          {([["steps", "Questions"], ["policy", "The whole document"], ["versions", "Save and versions"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={`btn small${view === k ? " primary" : ""}`} onClick={() => setView(k)}>{l}</button>)}
        </div>
      </section>

      {view === "steps" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 16, alignItems: "start" }}>
          <div className="stack aml-side" style={{ gap: 16 }}>
          <nav className="card pad stack" aria-label="Areas" style={{ gap: 4 }}>
            {cfg.steps.map((s, i) => {
              const x = built.find((y) => y.id === s.id)!;
              const st = stepState(x);
              return (
                <button key={s.id} type="button" className={`btn small${s.id === stepId ? " primary" : ""}`} aria-current={s.id === stepId ? "step" : undefined} onClick={() => setStepId(s.id)} style={{ justifyContent: "space-between", textAlign: "left", gap: 8 }}>
                  <span>{i + 1}. {s.title}</span>
                  <span className={`chip ${st.c}`} style={{ flexShrink: 0 }}>{st.t}</span>
                </button>
              );
            })}
          </nav>
          <section className="card pad stack" aria-label="What this area says">
            <div className="card-title-row"><h2 className="sec-h">What it says</h2>
              {bs.edited ? <button type="button" className="btn small" onClick={() => { const e = { ...state.edits }; delete e[stepId]; edit({ ...state, edits: e, confirmed: { ...state.confirmed, [stepId]: false } }, true); }}>Go back to the written text</button>
                : <button type="button" className="btn small" onClick={() => edit({ ...state, edits: { ...state.edits, [stepId]: bs.text }, confirmed: { ...state.confirmed, [stepId]: false } }, true)}>Edit the wording by hand</button>}
            </div>
            {bs.edited ? (
              <>
                <div className="muted" style={{ fontSize: 13 }}>You are editing this area's text directly. Later changes to the answers above won't change it. Start a line with "## " for a heading and "- " for a bullet.</div>
                <textarea className="input" rows={14} value={state.edits[stepId]} onChange={(e) => edit({ ...state, edits: { ...state.edits, [stepId]: e.target.value }, confirmed: { ...state.confirmed, [stepId]: false } })} />
              </>
            ) : <Text text={bs.text} />}
            {gapsOf(bs) > 0 && <div className="warn" role="status">{gapsOf(bs)} thing{gapsOf(bs) === 1 ? "" : "s"} still to answer in this area{bs.unanswered.length ? `: ${bs.unanswered.join("; ")}` : ""}.</div>}
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={bs.confirmed} onChange={(e) => edit({ ...state, confirmed: { ...state.confirmed, [stepId]: e.target.checked } }, true)} />
              <span>I have read this and it describes what the firm really does</span>
            </label>
            <div className="row-wrap" style={{ gap: 8 }}>
              {idx > 0 && <button type="button" className="btn small" onClick={() => setStepId(cfg.steps[idx - 1].id)}>Back</button>}
              {idx < cfg.steps.length - 1 && <button type="button" className="btn small primary" onClick={() => setStepId(cfg.steps[idx + 1].id)}>Next area</button>}
              {idx === cfg.steps.length - 1 && <button type="button" className="btn small primary" onClick={() => setView("versions")}>Go to save and versions</button>}
            </div>
          </section>
          </div>
          <div className="stack" style={{ gap: 16 }}>
            <section className="card pad stack" aria-label={step.title}>
              <h2 className="sec-h">{idx + 1}. {step.title}</h2>
              <p className="muted" style={{ margin: 0 }}>{step.intro}</p>
              <div className="muted" style={{ fontSize: 13 }}>Covers: {step.covers}</div>
              {cfg.id === "builder" && step.id === "fwra" && <div><a className="btn small primary" href={href("aml", "fwra")}>Open the risk assessment questions</a><span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>The risk assessment itself is written on the Risk assessment tab. This area only describes how it is kept up to date.</span></div>}
              {step.id === "firm" && <div className="muted" style={{ fontSize: 13 }}>The planner currently holds {facts.clients} active client{facts.clients === 1 ? "" : "s"}.</div>}
              {qs.map((q) => <QuestionView key={q.k} q={q} a={merged.answers} set={setAnswer} />)}
              {qs.some((q) => q.suggest !== undefined) && (
                <div><button type="button" className="btn small" onClick={() => { const sug = b.withSuggestions(step, merged.answers); const add: b.Answers = {}; for (const q of qs) if (sug[q.k] !== undefined && sug[q.k] !== merged.answers[q.k]) add[q.k] = sug[q.k]; edit({ ...state, answers: { ...state.answers, ...add }, confirmed: { ...state.confirmed, [stepId]: false } }, true); }}>Fill the blanks with suggested answers</button>
                  <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>Only questions you haven't answered. Check them: they are examples, not your decisions.</span></div>
              )}
            </section>
          </div>
        </div>
      )}

      {view === "policy" && (
        <section className="card pad stack" aria-label="The whole document">
          <div className="muted" style={{ fontSize: 13 }}>Highlighted text is a gap. Fix it in the area it comes from.</div>
          {built.map((x, i) => (
            <div key={x.id} className="stack" style={{ gap: 6 }}>
              <h2 className="sec-h">{i + 1}. {x.title} {x.confirmed ? <span className="chip green">Confirmed</span> : <span className="chip amber">Not confirmed</span>} <button type="button" className="btn small" onClick={() => { setStepId(x.id); setView("steps"); }}>Open</button></h2>
              <Text text={x.text} />
            </div>
          ))}
        </section>
      )}

      {view === "versions" && (
        <>
          <section className="card pad stack" aria-label="Save a version">
            <h2 className="sec-h">Save a version</h2>
            <p className="muted" style={{ margin: 0 }}>A saved version is a fixed copy you can export later, even after the answers change. The version table at the end of the policy is built from these.</p>
            <div className="row-wrap" style={{ gap: 10, alignItems: "end" }}>
              <label className="field" style={{ minWidth: 280 }}><span>What changed, or why it was reviewed</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={versions.length ? "For example annual review, no change" : "First version"} /></label>
              <label className="field"><span>Person responsible</span><input className="input" value={by} onChange={(e) => setBy(e.target.value)} /></label>
              <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> Approved</label>
              <button type="button" className="btn primary" onClick={saveVersion}>Save as version {b.nextVersion(versions)}</button>
            </div>
          </section>
          <section className="card pad stack" aria-label="Saved versions">
            <h2 className="sec-h">Saved versions</h2>
            {versions.length === 0 ? <p className="muted" style={{ margin: 0 }}>None yet.</p> : (
              <div className="stack" style={{ gap: 8 }}>
                {[...versions].reverse().map((v) => (
                  <div key={v.v} className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                    <span><strong>Version {v.v}</strong>, {v.date}, {v.approved ? "approved" : "draft"}{v.by ? `, ${v.by}` : ""}. {v.note}</span>
                    <span className="row-wrap" style={{ gap: 6 }}><button type="button" className="btn small" onClick={() => exportVersion(v, "word")}>Word</button><button type="button" className="btn small" onClick={() => exportVersion(v, "pdf")}>PDF</button></span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
