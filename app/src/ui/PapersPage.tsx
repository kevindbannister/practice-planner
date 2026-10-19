// Working papers. The list is your companies, with the clients they're linked to and their year
// end. Open one and the sections of its working papers are listed down the side; pick a section
// to set its status and keep notes. Each company and year has its own set; the sections are yours
// to edit.
import { useEffect, useMemo, useRef, useState } from "react";
import { Client, Job, fmtDate, todayIso } from "../lib/domain";
import { GROUPS, PaperStatus, SECTIONS, STATUS_LABEL, Section, Sub, carryForward, leadTotals, linesFor, money, parseAmount, parsePasted, priorFor, priorPeriod, progress, stateOf, total, yearEnds } from "../lib/papers";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { Icon, href, useRoute } from "./bits";
import { useEditor } from "./Editors";
import { useData, useIndex } from "./data";

const isCompany = (c: Client) => c.Kind === "Ltd" || c.Kind === "LLP" || !!c.CompanyNumber;
const ACCOUNTS = new Set(["ACCS_LTD", "ACCS_LLP"]);
const PAPER_JOBS = new Set(["ACCS_LTD", "ACCS_LLP", "CT600"]);

/** The periods to choose from for a company: its accounts jobs, and its year ends. */
function periodsFor(c: Client, jobs: Job[], today: string): { all: string[]; current: string } {
  const fromJobs = jobs.filter((j) => ACCOUNTS.has(j.ServiceKey || "") && j.PeriodEnd).map((j) => j.PeriodEnd as string);
  const ends = yearEnds(c.YearEnd as string | undefined, today, 3);
  const all = [...new Set([...fromJobs, ...ends])].sort((a, b) => b.localeCompare(a));
  // the accounts being worked on now, else the latest year end that has passed
  const current = [...fromJobs].sort()[0] || ends.find((d) => d <= today) || all[0] || "";
  return { all, current };
}

export function PapersPage() {
  const { parts } = useRoute();
  return parts[1] ? <PaperView clientKey={parts[1]} period={parts[2]} /> : <PapersList />;
}

function PapersList() {
  const { data } = useData();
  const idx = useIndex();
  const today = todayIso();
  const [search, setSearch] = useState("");
  const rows = useMemo(
    () =>
      data.clients
        .filter((c) => isCompany(c) && (c.Status === "active" || !c.Status))
        .map((c) => {
          const related = new Set<string>();
          for (const g of idx.groupsByMember.get(c.Key) || []) {
            for (const m of idx.membersByGroup.get(g.Key as string) || []) {
              const other = idx.clientByKey.get(m.MemberKey as string);
              if (other && other.Key !== c.Key && !isCompany(other)) related.add(other.Title); // the people linked to the company
            }
          }
          const contact = [c.ContactFirst, c.ContactLast].filter(Boolean).join(" ");
          const { current } = periodsFor(c, idx.jobsByClient.get(c.Key) || [], today);
          return { c, related: [...related].sort(), contact, current };
        })
        .filter((r) => !search || `${r.c.Title} ${r.c.CompanyNumber || ""} ${r.related.join(" ")} ${r.contact}`.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => a.c.Title.localeCompare(b.c.Title)),
    [data.clients, idx, search, today],
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Working papers</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>{rows.length} compan{rows.length === 1 ? "y" : "ies"}. Open one to work through its papers.</p>
        </div>
      </div>
      <div className="row-wrap">
        <label className="search" style={{ flex: "1 1 280px", maxWidth: 420 }}>
          <Icon name="search" />
          <span className="sr-only">Search companies</span>
          <input type="search" placeholder="Company, client or number" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>
      <section className="card">
        <div className="table-wrap">
          <table className="grid papers-list">
            <thead>
              <tr>
                <th scope="col">Company</th><th scope="col">Client</th><th scope="col">Year end</th><th scope="col">Papers for</th><th scope="col">Progress</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, related, contact, current }) => {
                const p = current ? progress(c.Key, current, data.papers) : undefined;
                return (
                  <tr key={c.Key} className="clickable" onClick={() => (window.location.hash = href("papers", c.Key))}>
                    <td className="cell-title">
                      <a href={href("papers", c.Key)} onClick={(e) => e.stopPropagation()}>{c.Title}</a>
                      {c.CompanyNumber && <div className="cell-sub mono">{c.CompanyNumber}</div>}
                    </td>
                    <td>
                      {related.length || contact ? (
                        <>
                          {related.slice(0, 3).join(", ")}{related.length > 3 ? ` +${related.length - 3}` : ""}
                          {contact && !related.some((n) => n.toLowerCase().includes(contact.toLowerCase().split(" ").pop() || "")) && <div className="cell-sub">{related.length ? "Contact: " : ""}{contact}</div>}
                        </>
                      ) : "—"}
                    </td>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{c.YearEnd ? fmtDate(`2000-${c.YearEnd}`, { year: false }) : <span className="muted">Not set</span>}</td>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{current ? fmtDate(current) : "—"}</td>
                    <td>
                      {p ? (
                        <span className="paper-prog" title={`${p.done} of ${p.total} sections finished`}>
                          <span className="paper-bar" aria-hidden="true"><span style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></span>
                          <span className="mono">{p.done}/{p.total}</span>
                        </span>
                      ) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && <div className="empty">No companies match.</div>}
      </section>
    </div>
  );
}

function PaperView({ clientKey, period: periodParam }: { clientKey: string; period?: string }) {
  const { data, update, create, user } = useData();
  const idx = useIndex();
  const today = todayIso();
  const c = idx.clientByKey.get(clientKey);
  const editor = useEditor();
  const [pick, setPick] = useState<string>();
  const [error, setError] = useState<string>();

  if (!c) {
    return (
      <div className="page">
        <a className="crumb" href="#/papers">Working papers</a>
        <div className="card empty">That company couldn't be found.</div>
      </div>
    );
  }
  const { all, current } = periodsFor(c, idx.jobsByClient.get(c.Key) || [], today);
  const period = periodParam || current;
  const sec = SECTIONS.find((x) => x.key === pick) || SECTIONS[0];
  const prog = period ? progress(c.Key, period, data.papers) : { done: 0, started: 0, total: SECTIONS.length };

  const writeSection = async (key: string, patch: Row) => {
    if (!period) return;
    setError(undefined);
    try {
      const { row } = stateOf(data.papers, c.Key, period, key);
      const stamp = { ...patch, Updated: new Date().toISOString() };
      if (row) await update("WorkingPapers", row, stamp);
      else await create("WorkingPapers", { Key: newKey("WP"), ClientKey: c.Key, PeriodEnd: period, ItemKey: key, Status: "todo", ...stamp });
    } catch {
      setError("That didn't save. Try again.");
    }
  };
  const nextSection = () => {
    const i = SECTIONS.findIndex((x) => x.key === sec.key);
    if (i < SECTIONS.length - 1) setPick(SECTIONS[i + 1].key);
  };

  return (
    <div className="page">
      <a className="crumb" href="#/papers">Working papers</a>
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <h1>{c.Title}</h1>
          <div className="row-wrap" style={{ gap: 6 }}>
            {c.CompanyNumber && <span className="chip mono">{c.CompanyNumber}</span>}
            {c.YearEnd && <span className="chip">Year end {fmtDate(`2000-${c.YearEnd}`, { year: false })}</span>}
            <a className="chip blue" href={href("clients", c.Key)}>Client page</a>
          </div>
        </div>
        <label className="row-wrap" style={{ gap: 8, fontSize: 14 }}>
          <span>Year to</span>
          <select className="input" value={period} style={{ width: "auto" }} disabled={!all.length}
            onChange={(e) => (window.location.hash = href("papers", c.Key, e.target.value))}>
            {!all.length && <option value="">Set the year end first</option>}
            {all.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
          </select>
        </label>
      </div>

      {period && (() => {
        const linked = (idx.jobsByClient.get(c.Key) || []).filter((j) => PAPER_JOBS.has(j.ServiceKey || "") && j.PeriodEnd === period);
        return linked.length ? (
          <div className="row-wrap" style={{ gap: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>Jobs for this year:</span>
            {linked.map((j) => (
              <button key={j.Key} type="button" className="chip blue" style={{ cursor: "pointer" }} onClick={() => editor.open({ kind: "job", key: j.Key as string })}>
                {j.Title}{j.Status === "done" || j.CompletedDate ? " · complete" : j.Deadline ? ` · due ${fmtDate(j.Deadline as string, { year: false })}` : ""}
              </button>
            ))}
          </div>
        ) : null;
      })()}

      {!period ? (
        <div className="alert amber"><strong>No year end on this company</strong><span>Add it on the <a href={href("clients", c.Key)}>client page</a> (or Companies House will fill it in) and the papers will appear.</span></div>
      ) : (
        <div className="paper">
          <nav className="paper-side" aria-label="Sections of the working papers">
            <div className="paper-side-head">
              <strong>{prog.done} of {prog.total} done</strong>
              <span className="paper-bar" aria-hidden="true"><span style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} /></span>
            </div>
            {GROUPS.map((g) => (
              <div key={g} className="paper-group">
                <div className="paper-group-name">{g}</div>
                <ul>
                  {SECTIONS.filter((x) => x.group === g).map((it) => {
                    const st = stateOf(data.papers, c.Key, period, it.key);
                    return (
                      <li key={it.key}>
                        <button type="button" className={`paper-item ${st.status}${it.key === sec.key ? " on" : ""}`} aria-current={it.key === sec.key ? "true" : undefined} onClick={() => setPick(it.key)}>
                          <span className="paper-dot" aria-hidden="true">{st.status === "done" ? <Icon name="check" size={11} /> : st.status === "na" ? "–" : ""}</span>
                          <span className="paper-name">{it.title}</span>
                          {st.reviewedBy && <span className="paper-rev" title={`Reviewed by ${st.reviewedBy}`} aria-label="Reviewed">R</span>}
                          {st.note && <span className="paper-note-flag" title="Has a note" aria-label="Has a note" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <section className="paper-main stack" aria-labelledby="paper-h">
            <SectionPage key={`${period}-${sec.key}`} client={c} period={period} sec={sec} user={user || ""} today={today}
              onWrite={(patch) => writeSection(sec.key, patch)} onNext={nextSection} hasNext={SECTIONS[SECTIONS.length - 1].key !== sec.key} />
            {error && <p className="error-text" role="alert">{error}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

const who = (name: string) => name || "Me";

function SectionPage({ client, period, sec, user, today, onWrite, onNext, hasNext }: {
  client: Client; period: string; sec: Section; user: string; today: string; hasNext: boolean;
  onWrite: (patch: Row) => Promise<void>; onNext: () => void;
}) {
  const { data } = useData();
  const st = stateOf(data.papers, client.Key, period, sec.key);
  const [note, setNote] = useState(st.note);
  const saved = useRef(st.note);
  useEffect(() => {
    saved.current = st.note;
    setNote(st.note);
  }, [st.note]);
  const commit = () => {
    if (note !== saved.current) {
      saved.current = note;
      void onWrite({ Note: note });
    }
  };
  const sign = (kind: "Prepared" | "Reviewed") => {
    const on = kind === "Prepared" ? st.preparedOn : st.reviewedOn;
    return onWrite(on ? { [`${kind}By`]: "", [`${kind}On`]: "" } : { [`${kind}By`]: who(user), [`${kind}On`]: today });
  };

  return (
    <>
      <div className="card pad stack">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="eyebrow">{sec.group}</span>
            <h2 id="paper-h" style={{ margin: 0 }}>{sec.title}</h2>
            <span className="muted" style={{ fontSize: 13 }}>For the year ended {fmtDate(period)}</span>
          </div>
          <div className="signoffs">
            {(["Prepared", "Reviewed"] as const).map((k) => {
              const by = k === "Prepared" ? st.preparedBy : st.reviewedBy, on = k === "Prepared" ? st.preparedOn : st.reviewedOn;
              return (
                <button key={k} type="button" className={`signoff${on ? " on" : ""}`} aria-pressed={!!on} onClick={() => void sign(k)}
                  title={on ? "Click to take the sign-off off" : `Sign this section off as ${k.toLowerCase()}`}>
                  <span className="signoff-k">{k}</span>
                  <span className="signoff-v">{on ? `${by} · ${fmtDate(on, { year: false })}` : "Not yet"}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="seg" role="group" aria-label="Status of this section">
          {(Object.keys(STATUS_LABEL) as PaperStatus[]).map((s) => (
            <button key={s} type="button" aria-pressed={st.status === s} onClick={() => void onWrite({ Status: s })}>{STATUS_LABEL[s]}</button>
          ))}
        </div>
      </div>

      {sec.kind === "lead" && <LeadSchedule client={client} period={period} sec={sec} />}
      {sec.kind === "queries" && (
        <div className="card pad stack">
          <LinesEditor client={client} period={period} sec={sec} sub={{ key: "main", title: sec.title }} mode="queries" />
        </div>
      )}

      <div className="card pad stack">
        <label>
          {sec.kind === "check" ? "Notes" : "Notes on this schedule"}
          <textarea className="input" rows={sec.kind === "check" ? 10 : 4} value={note} placeholder="What you did, what you found, what to ask the client"
            onChange={(e) => setNote(e.target.value)} onBlur={commit} />
        </label>
        <div className="form-actions" style={{ justifyContent: "flex-start" }}>
          <button type="button" className="btn primary" onClick={() => { commit(); void onWrite({ Status: "done" }); onNext(); }}>
            <Icon name="check" size={14} />{hasNext ? "Done, next section" : "Done"}
          </button>
        </div>
      </div>
    </>
  );
}

/** The lead schedule: each detail schedule's total (this year and last), then the schedules themselves. */
function LeadSchedule({ client, period, sec }: { client: Client; period: string; sec: Section }) {
  const { data } = useData();
  const rows = leadTotals(sec, data.paperLines, client.Key, period);
  const within = rows.filter((r) => !r.sub.after), after = rows.filter((r) => r.sub.after);
  const sum = (l: typeof rows, k: "now" | "before") => total(l.map((r) => ({ Amount: r[k] })));
  const block = (list: typeof rows, label?: string) => (
    <>
      {label && <tr className="lead-label"><td colSpan={3}>{label}</td></tr>}
      {list.map((r) => (
        <tr key={r.sub.key}>
          <td>{r.sub.title}</td><td className="num mono">{money(r.now) || "–"}</td><td className="num mono muted">{money(r.before) || "–"}</td>
        </tr>
      ))}
      {list.length > 1 && (
        <tr className="lead-sub"><td>{label ? "Total " + label.toLowerCase() : "Total"}</td><td className="num mono">{money(sum(list, "now")) || "–"}</td><td className="num mono muted">{money(sum(list, "before")) || "–"}</td></tr>
      )}
    </>
  );
  return (
    <>
      <section className="card pad stack" aria-label={`${sec.title} lead schedule`}>
        <table className="grid lead">
          <thead>
            <tr><th scope="col">Lead schedule</th><th scope="col" className="num">{period.slice(0, 4)}</th><th scope="col" className="num">{priorPeriod(period).slice(0, 4)}</th></tr>
          </thead>
          <tbody>
            {after.length ? <>{block(within, "Due within one year")}{block(after, "Due after one year")}</> : block(within)}
            {rows.length > 1 && after.length > 0 && (
              <tr className="lead-total"><td>Total</td><td className="num mono">{money(sum(rows, "now")) || "–"}</td><td className="num mono">{money(sum(rows, "before")) || "–"}</td></tr>
            )}
          </tbody>
        </table>
      </section>
      {(sec.subs || []).map((sub) => (
        <section key={sub.key} className="card pad stack" aria-label={sub.title}>
          <h3 style={{ margin: 0, fontSize: 15 }}>{sub.title}</h3>
          <LinesEditor client={client} period={period} sec={sec} sub={sub} mode="amounts" />
        </section>
      ))}
    </>
  );
}

/** The lines of one detail schedule: detail and this year's figure (last year's beside it), adding up to a total. */
function LinesEditor({ client, period, sec, sub, mode }: { client: Client; period: string; sec: Section; sub: Sub; mode: "amounts" | "queries" }) {
  const { data, update, create, remove } = useData();
  const [error, setError] = useState<string>();
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const lines = linesFor(data.paperLines, client.Key, period, sec.key, sub.key);
  const carry = mode === "amounts" ? carryForward(data.paperLines, client.Key, period, sec.key, sub.key) : [];
  const nextOrder = () => lines.reduce((m, l) => Math.max(m, l.Seq), 0) + 1;
  const base = { ClientKey: client.Key, PeriodEnd: period, SectionKey: sec.key, SubKey: sub.key };
  const safely = async (work: () => Promise<unknown>) => {
    setError(undefined);
    setBusy(true);
    try {
      await work();
    } catch {
      setError("That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const addRow = () => safely(() => create("PaperLines", { Key: newKey("PL"), ...base, Seq: nextOrder(), Updated: new Date().toISOString() }));
  const patch = (l: (typeof lines)[number], p: Row) => safely(() => update("PaperLines", l.row, { ...p, Updated: new Date().toISOString() }));
  const addMany = (list: { Code?: string; Detail: string; Amount?: number }[]) =>
    safely(async () => {
      let o = nextOrder();
      for (const x of list) await create("PaperLines", { Key: newKey("PL"), ...base, Code: x.Code || undefined, Detail: x.Detail, Amount: x.Amount, Seq: o++, Updated: new Date().toISOString() });
    });
  const sum = total(lines);
  const pasted = parsePasted(paste);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="table-wrap">
        <table className={`grid lines ${mode}`}>
          <thead>
            {mode === "amounts" ? (
              <tr><th scope="col" style={{ width: 90 }}>Code</th><th scope="col">Detail</th><th scope="col" className="num">{period.slice(0, 4)}</th><th scope="col" className="num">{priorPeriod(period).slice(0, 4)}</th><th scope="col"><span className="sr-only">Remove</span></th></tr>
            ) : (
              <tr><th scope="col">Notes</th><th scope="col">Comments back</th><th scope="col" style={{ width: 90 }}>Completed</th><th scope="col"><span className="sr-only">Remove</span></th></tr>
            )}
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.Key} className={mode === "queries" && l.Done ? "line-done" : undefined}>
                {mode === "amounts" ? (
                  <>
                    <td><Cell value={l.Code} label="Code" onSave={(v) => patch(l, { Code: v })} /></td>
                    <td><Cell value={l.Detail} label="Detail" onSave={(v) => patch(l, { Detail: v })} /></td>
                    <td className="num"><Cell value={l.Amount === undefined ? "" : String(l.Amount)} label={`Amount for ${l.Detail || "this line"}`} money onSave={(v) => patch(l, { Amount: parseAmount(v) ?? "" })} /></td>
                    <td className="num mono muted">{money(priorFor(data.paperLines, client.Key, period, sec.key, sub.key, l.Detail)) || "–"}</td>
                  </>
                ) : (
                  <>
                    <td><Cell value={l.Detail} label="Note" area onSave={(v) => patch(l, { Detail: v })} /></td>
                    <td><Cell value={l.Remark} label="Comment back" area onSave={(v) => patch(l, { Remark: v })} /></td>
                    <td style={{ textAlign: "center" }}><input type="checkbox" checked={l.Done} aria-label={`Completed: ${l.Detail || "this note"}`} style={{ width: 18, height: 18 }} onChange={(e) => void patch(l, { Done: e.target.checked })} /></td>
                  </>
                )}
                <td><button type="button" className="iconbtn" aria-label={`Remove ${l.Detail || "this line"}`} disabled={busy} onClick={() => void safely(() => remove("PaperLines", l.row))}><Icon name="close" size={14} /></button></td>
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={mode === "amounts" ? 5 : 4} className="muted" style={{ padding: 12 }}>{mode === "amounts" ? "No lines yet." : "Nothing here yet."}</td></tr>}
          </tbody>
          {mode === "amounts" && lines.length > 0 && (
            <tfoot><tr><td /><td><strong>Total</strong></td><td className="num mono"><strong>{money(sum) || "0.00"}</strong></td><td className="num mono muted">{money(total(linesFor(data.paperLines, client.Key, priorPeriod(period), sec.key, sub.key))) || "–"}</td><td /></tr></tfoot>
          )}
        </table>
      </div>
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn small" disabled={busy} onClick={() => void addRow()}>+ {mode === "amounts" ? "Add a line" : "Add a note"}</button>
        {mode === "amounts" && (
          <>
            <button type="button" className="btn small" onClick={() => setPasting(!pasting)} aria-expanded={pasting}>Paste from Excel</button>
            {carry.length > 0 && (
              <button type="button" className="btn small" disabled={busy} onClick={() => void addMany(carry.map((x) => ({ Code: x.Code, Detail: x.Detail })))}>
                Bring in last year's {carry.length} line{carry.length === 1 ? "" : "s"}
              </button>
            )}
          </>
        )}
      </div>
      {pasting && (
        <div className="stack" style={{ gap: 8 }}>
          <label>
            Paste rows: detail and amount (or code, detail and amount), one per line
            <textarea className="input" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Acme Ltd\t1,200.00\nBolt Ltd\t(50.00)"} />
          </label>
          <div className="row-wrap">
            <button type="button" className="btn small primary" disabled={!pasted.length || busy} onClick={() => void addMany(pasted).then(() => { setPaste(""); setPasting(false); })}>
              Add {pasted.length} line{pasted.length === 1 ? "" : "s"}
            </button>
            <span className="muted" style={{ fontSize: 12 }}>{pasted.length ? `Total ${money(total(pasted)) || "0.00"}` : ""}</span>
          </div>
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}
    </div>
  );
}

/** A cell that keeps what you type and saves when you leave it. */
function Cell({ value, label, onSave, money: isMoney, area }: { value: string; label: string; onSave: (v: string) => Promise<unknown> | void; money?: boolean; area?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    if (v !== value) void onSave(v);
  };
  return area ? (
    <textarea className="input cell" rows={2} aria-label={label} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} />
  ) : (
    <input className={`input cell${isMoney ? " money" : ""}`} aria-label={label} inputMode={isMoney ? "decimal" : undefined} value={v}
      onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
  );
}
