// Working papers. The list is your companies, with the clients they're linked to and their year
// end. Open one and the sections of its working papers are listed down the side; pick a section
// to set its status and keep notes. Each company and year has its own set; the sections are yours
// to edit.
import { useEffect, useMemo, useRef, useState } from "react";
import { Client, Job, fmtDate, todayIso } from "../lib/domain";
import { DEFAULT_ITEMS, PaperItem, PaperStatus, STATUS_LABEL, progress, readItems, statusOf, yearEnds } from "../lib/papers";
import { newKey } from "../lib/planning";
import { Icon, href, useRoute } from "./bits";
import { readSetting, useData, useIndex } from "./data";

const isCompany = (c: Client) => c.Kind === "Ltd" || c.Kind === "LLP" || !!c.CompanyNumber;
const ACCOUNTS = new Set(["ACCS_LTD", "ACCS_LLP"]);

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
  const items = readItems(readSetting<unknown>(data.settings, "papers.items"));
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
                const p = current ? progress(items, data.papers, c.Key, current) : undefined;
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
  const { data, update, create, saveSetting } = useData();
  const idx = useIndex();
  const today = todayIso();
  const c = idx.clientByKey.get(clientKey);
  const items = readItems(readSetting<unknown>(data.settings, "papers.items"));
  const [pick, setPick] = useState<string>();
  const [editing, setEditing] = useState(false);
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
  const period = periodParam && all.includes(periodParam) ? periodParam : periodParam || current;
  const itemKey = items.some((i) => i.key === pick) ? (pick as string) : items[0]?.key;
  const item = items.find((i) => i.key === itemKey);
  const prog = period ? progress(items, data.papers, c.Key, period) : { done: 0, started: 0, total: items.length };

  const write = async (key: string, patch: { Status?: PaperStatus; Note?: string }) => {
    if (!period) return;
    setError(undefined);
    try {
      const { row } = statusOf(data.papers, c.Key, period, key);
      const stamp = { ...patch, Updated: new Date().toISOString() };
      if (row) await update("WorkingPapers", row, stamp);
      else await create("WorkingPapers", { Key: newKey("WP"), ClientKey: c.Key, PeriodEnd: period, ItemKey: key, Status: patch.Status || "todo", ...stamp });
    } catch {
      setError("That didn't save. Try again.");
    }
  };
  const next = () => {
    const i = items.findIndex((x) => x.key === itemKey);
    if (i >= 0 && i < items.length - 1) setPick(items[i + 1].key);
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
        <div className="row-wrap">
          <label className="row-wrap" style={{ gap: 8, fontSize: 14 }}>
            <span>Year to</span>
            <select className="input" value={period} style={{ width: "auto" }} disabled={!all.length}
              onChange={(e) => (window.location.hash = href("papers", c.Key, e.target.value))}>
              {!all.length && <option value="">Set the year end first</option>}
              {all.map((d) => <option key={d} value={d}>{fmtDate(d)}</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => setEditing(!editing)} aria-expanded={editing}>Edit sections</button>
        </div>
      </div>

      {editing && (
        <SectionEditor
          items={items}
          onClose={() => setEditing(false)}
          onSave={async (list) => {
            await saveSetting("papers.items", list);
            setEditing(false);
          }}
        />
      )}

      {!period ? (
        <div className="alert amber"><strong>No year end on this company</strong><span>Add it on the <a href={href("clients", c.Key)}>client page</a> (or Companies House will fill it in) and the papers will appear.</span></div>
      ) : (
        <div className="paper">
          <nav className="paper-side" aria-label="Sections of the working papers">
            <div className="paper-side-head">
              <strong>{prog.done} of {prog.total} done</strong>
              <span className="paper-bar" aria-hidden="true"><span style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} /></span>
            </div>
            <ol>
              {items.map((it, n) => {
                const s = statusOf(data.papers, c.Key, period, it.key);
                return (
                  <li key={it.key}>
                    <button type="button" className={`paper-item ${s.status}${it.key === itemKey ? " on" : ""}`} aria-current={it.key === itemKey ? "true" : undefined} onClick={() => setPick(it.key)}>
                      <span className="paper-dot" aria-hidden="true">{s.status === "done" ? <Icon name="check" size={11} /> : s.status === "na" ? "–" : ""}</span>
                      <span className="paper-name">{n + 1}. {it.title}</span>
                      {s.note && <span className="paper-note-flag" title="Has a note" aria-label="Has a note" />}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          <section className="card pad stack paper-main" aria-labelledby="paper-h">
            {item ? (
              <ItemDetail
                key={`${period}-${item.key}`}
                item={item}
                status={statusOf(data.papers, c.Key, period, item.key)}
                onStatus={(s) => void write(item.key, { Status: s })}
                onNote={(v) => write(item.key, { Note: v })}
                onDoneNext={() => { void write(item.key, { Status: "done" }); next(); }}
                hasNext={items.findIndex((x) => x.key === itemKey) < items.length - 1}
              />
            ) : (
              <p className="muted">No sections. Use Edit sections to add some.</p>
            )}
            {error && <p className="error-text" role="alert">{error}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function ItemDetail({ item, status, onStatus, onNote, onDoneNext, hasNext }: {
  item: PaperItem; status: { status: PaperStatus; note: string; row?: unknown };
  onStatus: (s: PaperStatus) => void; onNote: (v: string) => Promise<void>; onDoneNext: () => void; hasNext: boolean;
}) {
  const [note, setNote] = useState(status.note);
  const saved = useRef(status.note);
  useEffect(() => {
    saved.current = status.note;
    setNote(status.note);
  }, [status.note]);
  const commit = () => {
    if (note !== saved.current) {
      saved.current = note;
      void onNote(note);
    }
  };
  return (
    <>
      <h2 id="paper-h" style={{ margin: 0 }}>{item.title}</h2>
      <div className="seg" role="group" aria-label="Status of this section">
        {(Object.keys(STATUS_LABEL) as PaperStatus[]).map((s) => (
          <button key={s} type="button" aria-pressed={status.status === s} onClick={() => onStatus(s)}>{STATUS_LABEL[s]}</button>
        ))}
      </div>
      <label>
        Notes
        <textarea className="input" rows={10} value={note} placeholder="What you did, what you found, what to ask the client" onChange={(e) => setNote(e.target.value)} onBlur={commit} />
      </label>
      <div className="form-actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="btn primary" onClick={() => { commit(); onDoneNext(); }}>
          <Icon name="check" size={14} />{hasNext ? "Done, next section" : "Done"}
        </button>
      </div>
    </>
  );
}

function SectionEditor({ items, onSave, onClose }: { items: PaperItem[]; onSave: (list: PaperItem[]) => Promise<void>; onClose: () => void }) {
  const [list, setList] = useState<PaperItem[]>(items);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const move = (i: number, by: number) =>
    setList((l) => {
      const j = i + by;
      if (j < 0 || j >= l.length) return l;
      const copy = [...l];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const save = async () => {
    const clean = list.map((x) => ({ ...x, title: x.title.trim() })).filter((x) => x.title);
    if (!clean.length) return setError("Keep at least one section.");
    setBusy(true);
    try {
      await onSave(clean);
    } catch {
      setError("Couldn't save the sections. Try again.");
      setBusy(false);
    }
  };
  return (
    <section className="card pad stack" aria-labelledby="sec-h">
      <h2 id="sec-h" style={{ margin: 0 }}>Edit sections</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>These sections are used for every company. Ones already filled in keep their status and notes if you rename or move them.</p>
      <ol className="section-edit">
        {list.map((it, i) => (
          <li key={it.key}>
            <input className="input" value={it.title} aria-label={`Section ${i + 1}`} onChange={(e) => setList(list.map((x) => (x.key === it.key ? { ...x, title: e.target.value } : x)))} />
            <button type="button" className="iconbtn" aria-label={`Move ${it.title} up`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={14} /></button>
            <button type="button" className="iconbtn" aria-label={`Move ${it.title} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={14} /></button>
            <button type="button" className="iconbtn" aria-label={`Remove ${it.title}`} onClick={() => setList(list.filter((x) => x.key !== it.key))}><Icon name="close" size={14} /></button>
          </li>
        ))}
      </ol>
      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="form-actions" style={{ justifyContent: "space-between" }}>
        <span className="row-wrap">
          <button type="button" className="btn small" onClick={() => setList([...list, { key: newKey("S"), title: "" }])}>+ Add a section</button>
          <button type="button" className="btn small" onClick={() => setList(DEFAULT_ITEMS)}>Back to the standard list</button>
        </span>
        <span className="row-wrap">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save sections"}</button>
        </span>
      </div>
    </section>
  );
}
