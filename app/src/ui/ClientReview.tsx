// The client review: the draft accounts talked through with the client, a topic at a time, from the same figures as the
// accounts. Wording is drafted and can be changed; the meeting notes, answers and next steps are kept with the year.
import { useMemo, useRef, useState } from "react";
import { Block, Cell, Run } from "../lib/docModel";
import { brandOf, displayName, readBranding } from "../lib/docBranding";
import { Client, fmtDate } from "../lib/domain";
import { detailGroups } from "../lib/accounts";
import { NEXT_STEPS, ReviewState, STEPS, StepKey, balanceItems, bridge, dateWords, draft, dueDates, gbp, headline, readReview, spend, Fig } from "../lib/clientReview";
import { accountsFigures } from "../lib/tbMap";
import { linesFor, priorPeriod } from "../lib/papers";
import { Icon } from "./bits";
import { downloadFile } from "./commsKit";
import { useData } from "./data";
import { makePdf } from "./docsKit";
import { useAccountsData, useWriter } from "./PaperSchedules";

export const REVIEW_ITEM = "_review";

const change = (x: Fig) => (x.change === undefined ? "" : `${x.change >= 0 ? "+" : "-"}${gbp(Math.abs(x.change))}${x.pct !== undefined ? ` (${x.pct >= 0 ? "+" : ""}${x.pct}%)` : ""}`);

export function ClientReview({ client, period, onPaper }: { client: Client; period: string; onPaper: (section: string) => void }) {
  const { data } = useData();
  const w = useWriter();
  const acc = useAccountsData();
  const state: ReviewState = useMemo(() => readReview(w.setup(REVIEW_ITEM) as Record<string, unknown>), [w]);
  const [step, setStep] = useState<StepKey>("headline");
  const [open, setOpen] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const f = useMemo(() => accountsFigures(acc.maps || []), [acc.maps]);
  const p = useMemo(() => (acc.priorMaps ? accountsFigures(acc.priorMaps) : undefined), [acc.priorMaps]);
  const g = useMemo(() => detailGroups(acc.maps || []), [acc.maps]);
  const pg = useMemo(() => (acc.priorMaps ? detailGroups(acc.priorMaps) : undefined), [acc.priorMaps]);
  const queries = linesFor(data.paperLines, client.Key, period, "queries", "main").filter((l) => l.Detail.trim() || l.Remark.trim());
  const save = (patch: Partial<ReviewState>) => w.writeSetup(REVIEW_ITEM, { ...state, ...patch } as never);
  const auto = (k: StepKey) => draft(k, f, p, g.expenses, pg?.expenses, g.costs, pg?.costs, period);
  const text = (k: StepKey) => (k in state.notes ? state.notes[k] : auto(k));
  const idx = STEPS.findIndex((s) => s.key === step);
  const view = state.client;
  const bridgeOf = bridge(f, p, g.expenses, pg?.expenses);
  const rows = spend(f, g.expenses, g.costs, pg?.expenses, pg?.costs);
  const bal = balanceItems(f, p);
  const dates = dueDates(period);
  const steps = NEXT_STEPS(period);
  const timer = useRef<number>();
  void timer;

  const Comment = ({ k }: { k: StepKey }) => (
    view ? <p className="review-comment">{text(k)}</p> : (
      <div className="review-comment-edit">
        <textarea className="input" rows={3} aria-label={`What to say: ${STEPS.find((s) => s.key === k)?.title}`} value={text(k)}
          onChange={(e) => void save({ notes: { ...state.notes, [k]: e.target.value } })} />
        {k in state.notes && <button type="button" className="linkbtn" onClick={() => { const n = { ...state.notes }; delete n[k]; void save({ notes: n }); }}>Reset to the draft wording</button>}
      </div>
    )
  );
  const Tiles = ({ list }: { list: Fig[] }) => (
    <div className="review-tiles">
      {list.map((x) => (
        <div className="review-tile" key={x.label}>
          <span className="review-tile-label">{x.label}</span>
          <strong className="review-tile-num">{gbp(x.now)}</strong>
          {x.prior !== undefined && <span className="review-tile-prior">Last year {gbp(x.prior)} <em className={x.change! >= 0 ? "up" : "down"}>{change(x)}</em></span>}
        </div>
      ))}
    </div>
  );
  const Link = ({ section, children }: { section: string; children: string }) => view ? null : <button type="button" className="linkbtn review-link" onClick={() => onPaper(section)}>{children} ↗</button>;

  const pdf = async () => {
    setBusy(true); setError("");
    try {
      const branding = brandOf(readBranding(data.settings));
      const R = (t: string, o: Partial<Run> = {}): Run => ({ t, ...o });
      const C = (t: string, right = false, b = false): Cell => ({ runs: [R(t, { b })], align: right ? "right" : undefined });
      const para = (t: string): Block => ({ type: "p", runs: [R(t)], align: "left" });
      const h = (t: string): Block => ({ type: "h", level: 2, runs: [R(t)] });
      const table = (head: string[], body: string[][]): Block => ({ type: "table", header: true, rows: [head.map((t, i) => C(t, i > 0, true)), ...body.map((r) => r.map((t, i) => C(t, i > 0)))] });
      const blocks: Block[] = [{ type: "h", level: 1, runs: [R(`${client.Title}: your draft accounts`)] }, { type: "p", runs: [R(`Year to ${dateWords(period)}`, { b: true })], align: "left" }, para(text("headline"))];
      blocks.push(table(["", "This year", "Last year", "Change"], headline(f, p).map((x) => [x.label, gbp(x.now), x.prior === undefined ? "" : gbp(x.prior), change(x)])));
      if (bridgeOf) { blocks.push(h("How profit moved"), para(text("movement")), table(["", "£"], [["Profit before tax last year", gbp(bridgeOf.start)], ...bridgeOf.steps.map((s) => [s.label, `${s.amount >= 0 ? "+" : "-"}${gbp(Math.abs(s.amount))}`]), ["Profit before tax this year", gbp(bridgeOf.end)]])); }
      if (rows.length) blocks.push(h("Where the money went"), para(text("spend")), table(["", "This year", "Last year", "Share"], rows.map((x) => [x.title, gbp(x.now), x.prior === undefined ? "" : gbp(x.prior), `${x.share}%`])));
      blocks.push(h("What the company owns and owes"), para(text("position")), table(["", "This year", "Last year"], [...bal.owns, ...bal.owes, { label: "Net assets", now: f.netAssets, prior: p?.netAssets }].map((x) => [x.label, gbp(x.now), x.prior === undefined ? "" : gbp(x.prior)])));
      blocks.push(h("Tax and dividends"), para(text("tax")));
      if (queries.length) blocks.push(h("Questions and decisions"), para(text("questions")), table(["Question", "Your answer"], queries.map((l) => [l.Detail, l.Remark || ""])));
      if (state.meeting.trim()) blocks.push(h("Notes from our meeting"), ...state.meeting.split(/\n+/).filter(Boolean).map(para));
      blocks.push(h("Next steps"), { type: "list", ordered: false, items: steps.map((s) => [R(s.text)]) }, para("These are draft figures for discussion and may change before the accounts are finalised."));
      const made = await makePdf({ layout: {}, branding, title: `Draft accounts review: ${client.Title}`, reference: String(client.CompanyNumber || ""), client: client.Title, date: dateWords(period), docType: "accounts", content: { blocks }, author: displayName(branding) } as Parameters<typeof makePdf>[0]);
      downloadFile(made.bytes, `${period} Accounts review ${client.Title}.pdf`.replace(/[\\/:*?"<>|]+/g, " "), "application/pdf");
    } catch (e) { setError(e instanceof Error ? e.message : "The summary could not be made."); }
    finally { setBusy(false); }
  };

  return (
    <section className={`card pad stack client-review${view ? " client-view" : ""}`} aria-label="Client review">
      <div className="row-wrap review-head">
        <h2 style={{ margin: 0 }}>Your draft accounts</h2>
        <span className="muted">{client.Title} · year to {fmtDate(period)}</span>
        <span className="review-tools">
          <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={view} onChange={(e) => void save({ client: e.target.checked })} /> Client view</label>
          <button type="button" className="btn small" disabled={busy} onClick={() => void pdf()}><Icon name="download" size={14} /> {busy ? "Making…" : "Summary PDF"}</button>
        </span>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {!acc.maps && <p className="notice" role="status">There is no trial balance for this year yet. Add it in the working papers and the review fills in.</p>}
      <div className="seg review-steps" role="tablist" aria-label="Topics">
        {STEPS.map((s, i) => <button key={s.key} type="button" role="tab" aria-selected={step === s.key} aria-pressed={step === s.key} onClick={() => setStep(s.key)}><span className="review-n">{i + 1}</span> {s.short}</button>)}
      </div>

      <div className="review-body" role="tabpanel" aria-label={STEPS[idx].title}>
        <h3 className="review-title">{STEPS[idx].title}</h3>
        {step === "headline" && <><Tiles list={headline(f, p)} /><Comment k="headline" /></>}
        {step === "movement" && (
          <>
            {bridgeOf ? (
              <div className="review-bridge" role="table" aria-label="From last year's profit to this year's">
                <div className="review-bar-row total" role="row"><span>Profit before tax last year</span><span className="review-bar" /><strong>{gbp(bridgeOf.start)}</strong></div>
                {bridgeOf.steps.map((s) => {
                  const max = Math.max(...bridgeOf.steps.map((x) => Math.abs(x.amount)), 1);
                  return <div className="review-bar-row" role="row" key={s.label}><span>{s.label}</span><span className="review-bar"><i className={s.amount >= 0 ? "up" : "down"} style={{ width: `${Math.max(3, (Math.abs(s.amount) / max) * 100)}%` }} /></span><strong className={s.amount >= 0 ? "up" : "down"}>{s.amount >= 0 ? "+" : "-"}{gbp(Math.abs(s.amount))}</strong></div>;
                })}
                <div className="review-bar-row total" role="row"><span>Profit before tax this year</span><span className="review-bar" /><strong>{gbp(bridgeOf.end)}</strong></div>
              </div>
            ) : <p className="muted">There is no trial balance for last year, so there is nothing to compare with yet.</p>}
            <Comment k="movement" />
            <span className="row-wrap" style={{ gap: 12 }}><Link section="income">Open the income paper</Link><Link section="expenditure">Open the expenditure paper</Link></span>
          </>
        )}
        {step === "spend" && (
          <>
            <div className="review-spend">
              {rows.map((x) => {
                const items = (x.title === "Cost of sales" ? g.costs : g.expenses.filter((y) => y.title === x.title)).flatMap((y) => y.items);
                const isOpen = open === x.title;
                return (
                  <div key={x.title}>
                    <button type="button" className="review-bar-row spend" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : x.title)}>
                      <span><span aria-hidden="true">{isOpen ? "▾" : "▸"}</span> {x.title}</span>
                      <span className="review-bar"><i style={{ width: `${Math.max(3, x.share)}%` }} /></span>
                      <strong>{gbp(x.now)} <small>{x.share}%{x.prior !== undefined ? ` · last year ${gbp(x.prior)}` : ""}</small></strong>
                    </button>
                    {isOpen && <ul className="review-items">{items.map((it, i) => <li key={i}><span>{it.label}</span><span>{gbp(it.amount)}</span></li>)}</ul>}
                  </div>
                );
              })}
              {!rows.length && <p className="muted">No costs to show yet.</p>}
            </div>
            <Comment k="spend" />
            <Link section="expenditure">Open the expenditure paper</Link>
          </>
        )}
        {step === "position" && (
          <>
            <div className="review-two">
              <div><h4>The company owns</h4><Tiles list={bal.owns} /></div>
              <div><h4>The company owes</h4><Tiles list={bal.owes.length ? bal.owes : [{ label: "Nothing owed", now: 0 }]} /></div>
            </div>
            <Tiles list={[{ label: "Net assets", now: f.netAssets, prior: p?.netAssets, change: p ? Math.round(f.netAssets - p.netAssets) : undefined, pct: undefined }]} />
            <Comment k="position" />
            <Link section="summary">Open the accounts summary</Link>
          </>
        )}
        {step === "tax" && (
          <>
            <Tiles list={[{ label: "Profit before tax", now: f.pbt, prior: p?.pbt }, { label: "Tax charge", now: f.tax, prior: p?.tax }, { label: "Profit after tax", now: f.pat, prior: p?.pat }, { label: "Dividends", now: f.dividends, prior: p?.dividends }, { label: "Kept in the company", now: f.retained, prior: p?.retained }].map((x) => ({ ...x, change: x.prior === undefined ? undefined : Math.round(x.now - x.prior), pct: undefined }))} />
            <p className="muted">Corporation tax is normally due {dateWords(dates.tax)}.</p>
            <Comment k="tax" />
            <Link section="taxation">Open the tax paper</Link>
          </>
        )}
        {step === "questions" && (
          <>
            <Comment k="questions" />
            <div className="review-questions">
              {queries.map((l) => (
                <div className="review-q" key={l.Key}>
                  <label className="review-q-done"><input type="checkbox" checked={l.Done} aria-label={`Answered: ${l.Detail}`} onChange={(e) => void w.patchLine(l, { Done: e.target.checked })} /></label>
                  <div className="stack" style={{ gap: 4, flex: 1 }}>
                    <strong>{l.Detail || "Question"}</strong>
                    <textarea className="input" rows={2} placeholder="The client's answer" aria-label={`Answer to: ${l.Detail}`} defaultValue={l.Remark} key={`${l.Key}-${l.Remark}`}
                      onBlur={(e) => { if (e.target.value !== l.Remark) void w.patchLine(l, { Remark: e.target.value }); }} />
                  </div>
                </div>
              ))}
              {!queries.length && <p className="muted">No questions are listed yet.</p>}
              <button type="button" className="btn small" disabled={w.busy} onClick={() => void w.addLines("queries", "main", [{ Detail: "" }])}>+ Add a question</button>
            </div>
            <label className="doc-field">Notes from the meeting
              <textarea className="input" rows={4} value={state.meeting} placeholder="What was agreed, and anything to follow up" onChange={(e) => void save({ meeting: e.target.value })} />
            </label>
            <label className="doc-field" style={{ maxWidth: 220 }}>Meeting date<input className="input" type="date" value={state.date} onChange={(e) => void save({ date: e.target.value })} /></label>
            <Link section="queries">Open the queries paper</Link>
          </>
        )}
        {step === "next" && (
          <>
            <Comment k="next" />
            <ul className="review-checks">
              {steps.map((s) => <li key={s.key}><label><input type="checkbox" checked={!!state.next[s.key]} onChange={(e) => void save({ next: { ...state.next, [s.key]: e.target.checked } })} /> {s.text}</label></li>)}
            </ul>
          </>
        )}
      </div>
      <div className="row-wrap review-nav">
        <button type="button" className="btn small" disabled={idx === 0} onClick={() => setStep(STEPS[idx - 1].key)}><Icon name="left" size={14} /> {idx ? STEPS[idx - 1].short : "Back"}</button>
        <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>{idx + 1} of {STEPS.length}</span>
        <button type="button" className="btn small primary" disabled={idx === STEPS.length - 1} onClick={() => setStep(STEPS[idx + 1].key)}>{idx < STEPS.length - 1 ? STEPS[idx + 1].short : "Done"} <Icon name="right" size={14} /></button>
      </div>
    </section>
  );
}
