// The client risk assessment questions (individual or company template) inside an AML review: sections, questions that show when
// they apply, the practice's MUST/SHOULD rating rules, and answers the planner can suggest.
import { Choice, fewOptions } from "./Choice";
import { Ans, LEVEL_LABEL, Template, evaluate, hints, HintCtx, isShown } from "../lib/amlTemplate";

const RATE = ["Low", "Normal", "High"];
const urlParts = (text: string) => text.split(/(https?:\/\/[^\s)]+)/g).map((p, i) => (/^https?:/.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p));

/** What the planner already knows that bears on a question, picked by what the question is about. */
export type Knows = { identity: string[]; screening: string[]; ownership: string[]; companiesHouse: string[]; services: string[] };
function knowsFor(label: string, k?: Knows): string[] {
  if (!k) return [];
  const l = label.toLowerCase();
  if (/(pep|politically exposed|sanction)/.test(l)) return k.screening;
  if (/(beneficial owner|ownership|significant control|psc|shareholder)/.test(l)) return [...k.ownership, ...(/companies house/.test(l) ? k.companiesHouse : [])];
  if (/companies house/.test(l)) return k.companiesHouse;
  if (/(identity|verification|verified)/.test(l)) return k.identity;
  if (/service/.test(l)) return k.services;
  return [];
}
const shown = (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));
const empty = (v: unknown) => (Array.isArray(v) ? v.length === 0 : v === undefined || v === null || String(v) === "");

export function AmlRiskForm({ tpl, answers, setAnswers, ctx, previous, previousOn, knows }: { tpl: Template; answers: Ans; setAnswers: (a: Ans) => void; ctx: HintCtx; previous?: Ans; previousOn?: string; knows?: Knows }) {
  const res = evaluate(tpl, answers);
  const hint = hints(tpl, ctx);
  const set = (k: string, v: string | string[]) => setAnswers({ ...answers, [k]: v });
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div>
        <strong>Risk assessment questions</strong>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>Your own {tpl.id === "company" ? "company" : "individual"} risk assessment. Answer every question, rate each section, then the overall rating below. Where the answers mean a rating must be high, it says so.</p>
      </div>
      {previous && (() => {
        const can = tpl.sections.flatMap((s) => s.questions).filter((q) => isShown(tpl, answers, q) && empty(answers[q.k]) && !empty(previous[q.k]));
        return can.length > 0 ? (
          <div className="note" role="status" style={{ fontSize: 13 }}>
            The last approved assessment{previousOn ? ` (${previousOn})` : ""} answered {can.length} of the questions still blank here. Its answer shows under each one as a suggestion.{" "}
            <button type="button" className="btn small" onClick={() => { const n = { ...answers }; for (const q of can) n[q.k] = previous[q.k]; setAnswers(n); }}>Use last time's answers for all {can.length}</button>
            <span className="muted"> Check each one still holds.</span>
          </div>
        ) : null;
      })()}
      {tpl.sections.map((sec) => {
        const qs = sec.questions.filter((q) => isShown(tpl, answers, q));
        return (
          <div key={sec.title} className="stack" style={{ gap: 10, borderTop: "1px solid var(--line, #ddd)", paddingTop: 10 }}>
            <strong>{sec.title}</strong>
            {qs.map((q) => {
              const v = answers[q.k];
              const h = hint[q.k];
              const same = h && JSON.stringify(h.value) === JSON.stringify(v ?? (Array.isArray(h.value) ? [] : ""));
              const finds = res.findings.filter((f) => f.question === q.k);
              return (
                <div key={q.k} className="stack" style={{ gap: 4 }}>
                  <div className="field" style={{ gap: 4 }}>
                    <span>{q.label}{q.need && <span className="muted"> *</span>}</span>
                    {q.t === "one" && fewOptions(q.options) && <Choice label={q.label} options={q.options!} value={String(v ?? "")} onChange={(x) => set(q.k, x)} />}
                    {q.t === "one" && !fewOptions(q.options) && <select aria-label={q.label} className="input" value={String(v ?? "")} onChange={(e) => set(q.k, e.target.value)}><option value="">Choose</option>{q.options!.map((o) => <option key={o} value={o}>{o}</option>)}</select>}
                    {q.t === "risk" && <Choice label={q.label} options={RATE} value={String(v ?? "")} onChange={(x) => set(q.k, x)} />}
                    {q.t === "text" && <input aria-label={q.label} spellCheck lang="en-GB" className="input" value={String(v ?? "")} onChange={(e) => set(q.k, e.target.value)} />}
                    {q.t === "date" && <input aria-label={q.label} className="input" type="date" value={String(v ?? "")} onChange={(e) => set(q.k, e.target.value)} />}
                    {q.t === "long" && <textarea aria-label={q.label} spellCheck lang="en-GB" className="input" rows={4} value={String(v ?? "")} onChange={(e) => set(q.k, e.target.value)} />}
                  </div>
                  {q.t === "many" && <div className="row-wrap" role="group" aria-label={q.label} style={{ gap: 12 }}>{q.options!.map((o) => { const cur = Array.isArray(v) ? v : v ? [String(v)] : []; return <label key={o} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={cur.includes(o)} onChange={() => set(q.k, cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o])} /> {o}</label>; })}</div>}
                  {q.help && <span className="muted" style={{ fontSize: 13 }}>{urlParts(q.help)}</span>}
                  {previous && empty(v) && !empty(previous[q.k]) && <span className="muted" style={{ fontSize: 13 }}>Last time: <strong>{shown(previous[q.k])}</strong>. <button type="button" className="btn small" onClick={() => set(q.k, previous[q.k] as string | string[])}>Use this</button></span>}
                  {knowsFor(q.label, knows).length > 0 && <span className="muted" style={{ fontSize: 13 }}><strong>The planner knows:</strong> {knowsFor(q.label, knows).map((t, i) => <span key={i} style={{ display: "block" }}>· {t}</span>)}</span>}
                  {h && !same && <span className="muted" style={{ fontSize: 13 }}>The planner suggests <strong>{Array.isArray(h.value) ? h.value.join(", ") : h.value}</strong> ({h.from}). <button type="button" className="btn small" onClick={() => set(q.k, h.value)}>Use this</button></span>}
                  {finds.map((f, i) => (
                    <span key={i} role="status" style={{ fontSize: 13, color: f.strict === "MUST" ? "var(--red-ink, #b42318)" : "var(--amber-ink)", fontWeight: f.strict === "MUST" ? 600 : 400 }}>
                      {f.text}{f.wants.op === "eq" && q.t === "risk" && <> <button type="button" className="btn small" onClick={() => set(q.k, f.wants.value)}>Set to {f.wants.value}</button></>}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })}
      <span className="muted" style={{ fontSize: 13 }}>{res.missing.length ? `${res.missing.length} required question${res.missing.length === 1 ? "" : "s"} still to answer.` : "Every required question is answered."}{res.highest ? ` Highest section rating: ${LEVEL_LABEL[res.highest]}.` : ""}</span>
    </div>
  );
}
