// The client risk assessment questions (individual or company template) inside an AML review: sections, questions that show when
// they apply, the practice's MUST/SHOULD rating rules, and answers the planner can suggest.
import { Ans, LEVEL_LABEL, Template, evaluate, hints, HintCtx, isShown } from "../lib/amlTemplate";

const RATE = ["Low", "Normal", "High"];
const urlParts = (text: string) => text.split(/(https?:\/\/[^\s)]+)/g).map((p, i) => (/^https?:/.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p));

export function AmlRiskForm({ tpl, answers, setAnswers, ctx }: { tpl: Template; answers: Ans; setAnswers: (a: Ans) => void; ctx: HintCtx }) {
  const res = evaluate(tpl, answers);
  const hint = hints(tpl, ctx);
  const set = (k: string, v: string | string[]) => setAnswers({ ...answers, [k]: v });
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div>
        <strong>Risk assessment questions</strong>
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>Your own {tpl.id === "company" ? "company" : "individual"} risk assessment. Answer every question, rate each section, then the overall rating below. Where the answers mean a rating must be high, it says so.</p>
      </div>
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
                  <label className="field" style={{ gap: 4 }}>
                    <span>{q.label}{q.need && <span className="muted"> *</span>}</span>
                    {q.t === "one" && <select className="input" value={String(v ?? "")} onChange={(e) => set(q.k, e.target.value)}><option value="">Choose</option>{q.options!.map((o) => <option key={o} value={o}>{o}</option>)}</select>}
                    {q.t === "risk" && <select className="input" value={String(v ?? "")} onChange={(e) => set(q.k, e.target.value)}><option value="">Choose</option>{RATE.map((o) => <option key={o} value={o}>{o}</option>)}</select>}
                    {q.t === "text" && <input spellCheck lang="en-GB" className="input" value={String(v ?? "")} onChange={(e) => set(q.k, e.target.value)} />}
                    {q.t === "date" && <input className="input" type="date" value={String(v ?? "")} onChange={(e) => set(q.k, e.target.value)} />}
                    {q.t === "long" && <textarea spellCheck lang="en-GB" className="input" rows={4} value={String(v ?? "")} onChange={(e) => set(q.k, e.target.value)} />}
                  </label>
                  {q.t === "many" && <div className="row-wrap" role="group" aria-label={q.label} style={{ gap: 12 }}>{q.options!.map((o) => { const cur = Array.isArray(v) ? v : []; return <label key={o} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={cur.includes(o)} onChange={() => set(q.k, cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o])} /> {o}</label>; })}</div>}
                  {q.help && <span className="muted" style={{ fontSize: 12 }}>{urlParts(q.help)}</span>}
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
