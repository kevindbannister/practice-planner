// Working papers. The list is your companies, with the clients they're linked to and their year
// end. Open one and the sections of its working papers (as in the Excel working paper) are listed
// down the side; sections not used for a company can be turned off. Each section has a status,
// a Prepared / Reviewed sign-off, notes, and its schedules (see PaperSchedules).
import { useEffect, useMemo, useRef, useState } from "react";
import { AddSchedule, AssetSummary, LeadTable, PaperWriter, Schedule, useWriterState } from "./PaperSchedules";
import { Client, Job, fmtDate, todayIso } from "../lib/domain";
import { GROUPS, PaperStatus, SECTIONS, STATUS_LABEL, Section, progress, sectionsOff, stateOf, subsFor, yearEnds } from "../lib/papers";
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
  const idx = useIndex();
  const today = todayIso();
  const c = idx.clientByKey.get(clientKey);
  const editor = useEditor();

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
  const linked = period ? (idx.jobsByClient.get(c.Key) || []).filter((j) => PAPER_JOBS.has(j.ServiceKey || "") && j.PeriodEnd === period) : [];

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

      {linked.length > 0 && (
        <div className="row-wrap" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>Jobs for this year:</span>
          {linked.map((j) => (
            <button key={j.Key} type="button" className="chip blue" style={{ cursor: "pointer" }} onClick={() => editor.open({ kind: "job", key: j.Key as string })}>
              {j.Title}{j.Status === "done" || j.CompletedDate ? " · complete" : j.Deadline ? ` · due ${fmtDate(j.Deadline as string, { year: false })}` : ""}
            </button>
          ))}
        </div>
      )}

      {!period ? (
        <div className="alert amber"><strong>No year end on this company</strong><span>Add it on the <a href={href("clients", c.Key)}>client page</a> (or Companies House will fill it in) and the papers will appear.</span></div>
      ) : (
        <PaperWriter key={period} client={c} period={period}>
          <PaperBody client={c} period={period} today={today} />
        </PaperWriter>
      )}
    </div>
  );
}

function PaperBody({ client: c, period, today }: { client: Client; period: string; today: string }) {
  const { data, user } = useData();
  const w = useWriterState();
  const [pick, setPick] = useState<string>();
  const [choosing, setChoosing] = useState(false);
  const off = sectionsOff(data.papers, c.Key, period);
  const used = SECTIONS.filter((x) => !off.has(x.key));
  const sec = used.find((x) => x.key === pick) || used[0] || SECTIONS[0];
  const prog = progress(c.Key, period, data.papers);
  const i = used.findIndex((x) => x.key === sec.key);
  const next = () => i >= 0 && i < used.length - 1 && setPick(used[i + 1].key);

  return (
    <div className="paper">
      <nav className="paper-side" aria-label="Sections of the working papers">
        <div className="paper-side-head">
          <strong>{prog.done} of {prog.total} done</strong>
          <span className="paper-bar" aria-hidden="true"><span style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} /></span>
          <button type="button" className="linkbtn" style={{ fontSize: 12, alignSelf: "flex-start" }} aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>
            {choosing ? "Done choosing" : "Choose sections"}
          </button>
        </div>
        {choosing ? (
          <SectionPicker off={off} onSave={(nextOff) => w.writeSetup("_sections", { off: [...nextOff] })} />
        ) : GROUPS.map((g) => {
          const list = used.filter((x) => x.group === g);
          if (!list.length) return null;
          return (
            <div key={g} className="paper-group">
              <div className="paper-group-name">{g}</div>
              <ul>
                {list.map((it) => {
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
          );
        })}
      </nav>
      <section className="paper-main stack" aria-labelledby="paper-h">
        <SectionPage key={`${period}-${sec.key}`} client={c} period={period} sec={sec} user={user || ""} today={today}
          onWrite={(patch) => w.writeSetup(sec.key, {}, patch)} onNext={next} hasNext={i < used.length - 1} />
        {w.error && <p className="error-text" role="alert">{w.error}</p>}
      </section>
    </div>
  );
}

/** Tick the sections this company's papers use. The choice carries to next year. */
function SectionPicker({ off, onSave }: { off: Set<string>; onSave: (off: Set<string>) => void }) {
  const toggle = (key: string, on: boolean) => {
    const next = new Set(off);
    if (on) next.delete(key);
    else next.add(key);
    onSave(next);
  };
  return (
    <div className="stack" style={{ gap: 4, padding: "4px 6px" }}>
      <p className="muted" style={{ margin: "0 0 4px", fontSize: 12 }}>Untick sections this company doesn't need. Next year starts with the same choice.</p>
      {GROUPS.map((g) => (
        <fieldset key={g} className="paper-pick">
          <legend>{g}</legend>
          {SECTIONS.filter((x) => x.group === g).map((x) => (
            <label key={x.key} className="paper-pick-row">
              <input type="checkbox" checked={!off.has(x.key)} onChange={(e) => toggle(x.key, e.target.checked)} />
              <span>{x.title}</span>
            </label>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

const who = (name: string) => name || "Me";

function SectionPage({ client, period, sec, user, today, onWrite, onNext, hasNext }: {
  client: Client; period: string; sec: Section; user: string; today: string; hasNext: boolean;
  onWrite: (patch: Row) => Promise<void>; onNext: () => void;
}) {
  const { data } = useData();
  const w = useWriterState();
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
  const subs = subsFor(sec, data.papers, client.Key, period);
  const isDoc = !sec.subs.length && !sec.canAdd;
  const [link, setLink] = useState(st.link);
  useEffect(() => setLink(st.link), [st.link]);

  return (
    <>
      <div className="card pad stack">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <div className="stack" style={{ gap: 2 }}>
            <span className="eyebrow">{sec.group}</span>
            <h2 id="paper-h" style={{ margin: 0 }}>{sec.title}</h2>
            <span className="muted" style={{ fontSize: 13 }}>{client.Title} · for the year ended {fmtDate(period)}</span>
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
        {isDoc && (
          <label>
            Link to the file (OneDrive, SharePoint or the accounts software)
            <div className="row-wrap" style={{ gap: 8 }}>
              <input className="input" style={{ flex: "1 1 260px" }} value={link} placeholder="https://…" onChange={(e) => setLink(e.target.value)}
                onBlur={() => link !== st.link && void w.writeSetup(sec.key, { link: link.trim() || undefined })} />
              {/^https:\/\//i.test(st.link) && <a className="btn small" href={st.link} target="_blank" rel="noreferrer">Open</a>}
            </div>
          </label>
        )}
      </div>

      {sec.summary === "lead" && <LeadTable section={sec} />}
      {sec.summary === "assets" && <AssetSummary section={sec} />}
      {subs.map((sb) => <Schedule key={sb.key} section={sec} sb={sb} />)}
      {sec.canAdd && <AddSchedule section={sec} />}

      <div className="card pad stack">
        <label>
          {isDoc ? "Notes" : "Notes on this section"}
          <textarea className="input" rows={isDoc ? 8 : 4} value={note} placeholder="What you did, what you found, what to ask the client"
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
