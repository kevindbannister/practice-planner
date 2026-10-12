// Meetings and calls: plan one from a template (agenda), take notes under each agenda item,
// then tidy up with AI into a summary, decisions and actions. Your actions and the follow-up
// go into the plan as tasks; the summary can be emailed to the client.
import { useEffect, useRef, useState } from "react";
import { AiError, MeetingTidy } from "../lib/ai";
import { aiContext, emailGreeting, salutationFor } from "../lib/comms";
import { Job, fmtDate, todayIso } from "../lib/domain";
import { Action, AgendaItem, KIND_NAMES, MeetingKind, TEMPLATES, fmtWhen, readJson, summaryEmail, templateFor } from "../lib/meetings";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { stageLabel } from "../lib/stages";
import { TaxPayment, paymentsForAi } from "../lib/taxPayments";
import { Icon, go, href } from "./bits";
import { useData, useIndex } from "./data";
import { CommsTabs, useAi, useCommsPrefs } from "./commsKit";
import { useEditor } from "./Editors";

type M = {
  Key: string; ClientKey: string; JobKey: string; Kind: MeetingKind; Template: string; Status: "planned" | "done"; When: string; Minutes: number;
  Location: string; Attendees: string; agenda: AgendaItem[]; Notes: string; Summary: string; decisions: string[]; actions: Action[];
  FollowUp: string; SummaryCommKey: string; Updated: string;
};

function fromRow(r: Row): M {
  const s = (k: string) => String(r[k] ?? "");
  return {
    Key: s("Key"), ClientKey: s("ClientKey"), JobKey: s("JobKey"), Kind: (s("Kind") || "meeting") as MeetingKind, Template: s("Template"),
    Status: s("Status") === "done" ? "done" : "planned", When: s("When"), Minutes: Number(r.Minutes) || 30, Location: s("Location"),
    Attendees: s("Attendees"), agenda: readJson<AgendaItem[]>(r.Agenda, []), Notes: s("Notes"), Summary: s("Summary"),
    decisions: readJson<string[]>(r.Decisions, []), actions: readJson<Action[]>(r.Actions, []), FollowUp: s("FollowUp"),
    SummaryCommKey: s("SummaryCommKey"), Updated: s("Updated"),
  };
}

function toRow(m: M, clientName: string): Row {
  return {
    Title: `${templateFor(m.Template).name}: ${clientName}`.slice(0, 250), ClientKey: m.ClientKey, JobKey: m.JobKey, Kind: m.Kind, Template: m.Template,
    Status: m.Status, When: m.When, Minutes: m.Minutes, Location: m.Location, Attendees: m.Attendees, Agenda: JSON.stringify(m.agenda), Notes: m.Notes,
    Summary: m.Summary, Decisions: JSON.stringify(m.decisions), Actions: JSON.stringify(m.actions), FollowUp: m.FollowUp,
    SummaryCommKey: m.SummaryCommKey, Updated: m.Updated,
  };
}

const nowLocal = () => {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ------------------------------------------------------------------ lists

export function MeetingsList() {
  return (
    <div className="page">
      <CommsTabs current="meetings" />
      <div className="page-head">
        <div>
          <h1>Meetings and calls</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Plan with an agenda, take notes under each item, then tidy up into a summary and actions.</p>
        </div>
        <NewMeetingButtons />
      </div>
      <MeetingsTable />
    </div>
  );
}

export function NewMeetingButtons({ clientKey }: { clientKey?: string }) {
  const q = (kind: string, template: string) => `#/comms/meetings/new?kind=${kind}&template=${template}${clientKey ? `&client=${encodeURIComponent(clientKey)}` : ""}`;
  return (
    <div className="row-wrap">
      <a className="btn" href={q("call", "call")}><Icon name="clock" />Log a call</a>
      <a className="btn primary" href={q("meeting", "")}><Icon name="plus" />New meeting</a>
    </div>
  );
}

export function MeetingsTable({ clientKey }: { clientKey?: string }) {
  const { data } = useData();
  const idx = useIndex();
  const now = nowLocal();
  const rows = data.meetings.filter((m) => !clientKey || m.ClientKey === clientKey).map((r) => ({ r, m: fromRow(r) }));
  const upcoming = rows.filter(({ m }) => m.Status === "planned" && m.When >= now.slice(0, 10)).sort((a, b) => a.m.When.localeCompare(b.m.When));
  const rest = rows.filter((x) => !upcoming.includes(x)).sort((a, b) => b.m.When.localeCompare(a.m.When));
  const item = ({ m }: { m: M }) => {
    const c = idx.clientByKey.get(m.ClientKey);
    const open = m.actions.filter((a) => a.text.trim() && !a.done).length;
    return (
      <li key={m.Key}>
        <a className="comms-row" href={href("comms", "meetings", m.Key)}>
          <span className={`comms-kind ${m.Kind === "call" ? "email" : "letter"}`} aria-hidden="true"><Icon name={m.Kind === "call" ? "clock" : "groups"} /></span>
          <span className="stack" style={{ gap: 2, minWidth: 0, flex: "1 1 auto" }}>
            <strong className="comms-subject">{templateFor(m.Template).name}{!clientKey && c ? `: ${c.Title}` : ""}</strong>
            <span className="muted comms-meta">{KIND_NAMES[m.Kind]} · {fmtWhen(m.When) || "No date"}{m.Minutes ? ` · ${m.Minutes} min` : ""}</span>
            {m.Summary && <span className="comms-snippet">{m.Summary.slice(0, 140)}</span>}
          </span>
          <span className="row-wrap" style={{ gap: 4, flexShrink: 0 }}>
            {open > 0 && <span className="chip amber">{open} action{open === 1 ? "" : "s"}</span>}
            <span className={`chip${m.Status === "done" ? " green" : " blue"}`}>{m.Status === "done" ? "Done" : "Planned"}</span>
          </span>
        </a>
      </li>
    );
  };
  return (
    <div className="stack">
      {upcoming.length > 0 && (
        <section className="card" aria-label="Coming up">
          <div className="card-head"><h2 style={{ margin: 0 }}>Coming up</h2></div>
          <ul className="comms-list">{upcoming.map(item)}</ul>
        </section>
      )}
      <section className="card" aria-label="Meetings and calls">
        <div className="card-head"><h2 style={{ margin: 0 }}>{upcoming.length ? "Earlier" : "Meetings and calls"}</h2></div>
        {rest.length ? <ul className="comms-list">{rest.map(item)}</ul> : (
          <div className="empty" style={{ padding: 24 }}>{clientKey ? "No meetings or calls with this client yet." : "No meetings or calls yet."}</div>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ one meeting

export function MeetingPage({ meetingKey, initial }: { meetingKey?: string; initial?: { clientKey: string; kind: string; jobKey: string } }) {
  const { data, create, update, remove } = useData();
  const idx = useIndex();
  const prefs = useCommsPrefs();
  const ai = useAi();
  const { open } = useEditor();
  const today = todayIso();
  const existing = meetingKey ? data.meetings.find((r) => r.Key === meetingKey) : undefined;
  const templateFromUrl = new URLSearchParams(window.location.hash.split("?")[1] || "").get("template") || "";

  const [m, setM] = useState<M>(() => {
    if (existing) return fromRow(existing);
    const t = templateFromUrl ? templateFor(templateFromUrl) : null;
    return {
      Key: newKey("MT"), ClientKey: initial?.clientKey || "", JobKey: initial?.jobKey || "", Kind: (t?.kind || initial?.kind || "meeting") as MeetingKind,
      Template: t?.key || "", Status: t?.key === "call" ? "done" : "planned", When: nowLocal(), Minutes: t?.minutes || 30, Location: "", Attendees: "",
      agenda: (t?.agenda || []).map((item) => ({ item, notes: "" })), Notes: "", Summary: "", decisions: [], actions: [], FollowUp: "",
      SummaryCommKey: "", Updated: "",
    };
  });
  const [saved, setSaved] = useState(!!existing);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [undo, setUndo] = useState<Pick<M, "Summary" | "decisions" | "actions"> | null>(null);
  const latest = useRef(m);
  latest.current = m;
  const client = idx.clientByKey.get(m.ClientKey);
  const jobs = (idx.jobsByClient.get(m.ClientKey) || []).filter((j) => j.Status !== "Complete");

  const set = (patch: Partial<M>) => {
    setM((x) => ({ ...x, ...patch }));
    setDirty(true);
  };

  const persist = async (patch: Partial<M> = {}) => {
    const x = { ...latest.current, ...patch, Updated: new Date().toISOString() };
    latest.current = x;
    setM(x);
    if (!x.ClientKey || !x.Template) return;
    const row = data.meetings.find((r) => r.Key === x.Key);
    const fields = toRow(x, idx.clientByKey.get(x.ClientKey)?.Title || "");
    if (row) await update("Meetings", row, fields);
    else {
      await create("Meetings", { Key: x.Key, ...fields });
      setSaved(true);
      window.history.replaceState(null, "", `#/comms/meetings/${encodeURIComponent(x.Key)}`);
    }
    setDirty(false);
  };

  useEffect(() => {
    if (!dirty || !m.ClientKey || !m.Template) return;
    const t = window.setTimeout(() => void persist().catch(() => setError("Couldn't save. Check your connection; your notes are still here.")), 1500);
    return () => window.clearTimeout(t);
  }, [m, dirty]);

  if (meetingKey && !existing && !saved) {
    return <div className="page"><div className="card empty" style={{ padding: 24 }}>That meeting isn't here any more. <a href="#/comms/meetings">Back to meetings and calls</a></div></div>;
  }

  // choosing a template first
  if (!m.Template) {
    return (
      <div className="page">
        <CommsTabs current="meetings" />
        <div className="page-head"><h1>New meeting</h1></div>
        <p className="muted" style={{ margin: 0 }}>Choose what sort of meeting it is. The agenda is filled in for you, and you can change it.</p>
        <div className="template-grid">
          {TEMPLATES.map((t) => (
            <button key={t.key} type="button" className="card template-card" onClick={() => set({ Template: t.key, Kind: t.kind, Minutes: t.minutes, agenda: t.agenda.map((item) => ({ item, notes: "" })), Status: t.key === "call" ? "done" : "planned" })}>
              <strong>{t.name}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{KIND_NAMES[t.kind]} · {t.minutes} min</span>
              {t.agenda.length ? <span className="template-agenda">{t.agenda.slice(0, 4).join(" · ")}{t.agenda.length > 4 ? " …" : ""}</span> : <span className="template-agenda">Your own agenda</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const t = templateFor(m.Template);
  const setItem = (i: number, patch: Partial<AgendaItem>) => set({ agenda: m.agenda.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const setAction = (i: number, patch: Partial<Action>) => set({ actions: m.actions.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const hasNotes = !!m.Notes.trim() || m.agenda.some((a) => a.notes.trim());

  const context = () =>
    client
      ? aiContext({
          client, jobs, job: jobs.find((j) => j.Key === m.JobKey), today, kind: "email", salutation: salutationFor(client), prefs,
          stageName: (j: Job) => stageLabel(j, idx.stagesByService.get(j.ServiceKey || "") || []),
          serviceName: (k?: string) => idx.serviceName.get(k || "") || "",
          payments: paymentsForAi(data.taxPayments as TaxPayment[], client.Key, today),
        })
      : {};

  const tidy = async () => {
    setBusy("tidy");
    setError(undefined);
    try {
      const r: MeetingTidy = await ai.tidyMeeting({
        meeting: { title: t.name, when: m.When, kind: KIND_NAMES[m.Kind], attendees: m.Attendees, agenda: m.agenda, notes: m.Notes },
        context: context(), style: prefs.style || undefined, model: prefs.model || undefined,
      });
      setUndo({ Summary: m.Summary, decisions: m.decisions, actions: m.actions });
      // keep actions already in the plan
      const kept = m.actions.filter((a) => a.taskKey);
      set({
        Summary: r.summary, decisions: r.decisions, Status: "done",
        actions: [...kept, ...r.actions.filter((a) => !kept.some((k) => k.text === a.text)).map((a) => ({ text: a.text, who: a.who === "me" ? "Me" : a.who === "client" ? "Client" : a.who, due: a.due }))],
      });
    } catch (e) {
      setError(e instanceof AiError ? e.message : "The AI couldn't tidy the notes. Try again.");
    } finally {
      setBusy("");
    }
  };

  const mine = m.actions.filter((a) => a.text.trim() && /^me$/i.test(a.who) && !a.taskKey);
  const toPlan = async () => {
    if (!client) return;
    setBusy("plan");
    try {
      const next = [...m.actions];
      for (const a of mine) {
        const key = newKey("T");
        await create("Tasks", { Key: key, Title: a.text.slice(0, 250), ClientKey: client.Key, Type: "Client work", DueDate: a.due || "", Status: "Open", EstimateHours: 0.5, Notes: `From the ${t.name.toLowerCase()} on ${fmtDate(m.When.slice(0, 10))}` });
        next[next.indexOf(a)] = { ...a, taskKey: key };
      }
      await persist({ actions: next });
      setNote(`${mine.length} task${mine.length === 1 ? "" : "s"} added to the Unplanned list in the plan.`);
    } catch {
      setError("Couldn't add the tasks. Try again.");
    } finally {
      setBusy("");
    }
  };

  const followUpTask = async () => {
    if (!client || !m.FollowUp) return;
    await create("Tasks", { Key: newKey("T"), Title: `Follow up with ${client.Title}`.slice(0, 250), ClientKey: client.Key, Type: "Client work", DueDate: m.FollowUp, Status: "Open", EstimateHours: 0.25, Notes: `After the ${t.name.toLowerCase()} on ${fmtDate(m.When.slice(0, 10))}` });
    setNote("Follow-up added to the plan.");
  };

  const emailSummary = async () => {
    if (!client) return;
    const mail = summaryEmail({
      greeting: emailGreeting(client), title: t.name, when: m.When, summary: m.Summary, decisions: m.decisions, actions: m.actions,
      sender: (prefs.signName || "").split(" ")[0] || "[your name]",
    });
    await persist().catch(() => undefined);
    go(`/comms/new?kind=email&client=${encodeURIComponent(client.Key)}&subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}&brief=${encodeURIComponent(`Summary of our ${t.name.toLowerCase()}`)}`);
  };

  const del = async () => {
    if (!window.confirm("Delete this meeting and its notes? Tasks already added to the plan stay.")) return;
    const row = data.meetings.find((r) => r.Key === m.Key);
    if (row) await remove("Meetings", row);
    go(client ? `/clients/${encodeURIComponent(client.Key)}/meetings` : "/comms/meetings");
  };

  return (
    <div className="page meeting-page">
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <a href={client ? href("clients", client.Key, "meetings") : "#/comms/meetings"} className="muted" style={{ fontSize: 13 }}>
            ← {client ? `${client.Title}: meetings and calls` : "Meetings and calls"}
          </a>
          <h1>{t.name}{client ? `: ${client.Title}` : ""}</h1>
        </div>
        <div className="row-wrap" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }} role="status">{dirty ? "Not saved yet" : saved ? "Saved" : ""}</span>
          <div className="seg" role="group" aria-label="Status">
            <button type="button" aria-pressed={m.Status === "planned"} onClick={() => set({ Status: "planned" })}>Planned</button>
            <button type="button" aria-pressed={m.Status === "done"} onClick={() => set({ Status: "done" })}>Done</button>
          </div>
        </div>
      </div>

      <section className="card pad stack" aria-labelledby="md-h">
        <h2 id="md-h" className="composer-h">Details</h2>
        <div className="form meeting-details">
          <label>
            Client
            <select className="input" value={m.ClientKey} disabled={saved} onChange={(e) => set({ ClientKey: e.target.value, JobKey: "" })}>
              <option value="">Choose…</option>
              {data.clients.filter((c) => c.Status !== "Archived").map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}
            </select>
          </label>
          <label>
            About a job (optional)
            <select className="input" value={m.JobKey} onChange={(e) => set({ JobKey: e.target.value })} disabled={!client}>
              <option value="">Not about one job</option>
              {jobs.map((j) => <option key={j.Key} value={j.Key}>{idx.serviceName.get(j.ServiceKey || "") || j.Title}{j.PeriodEnd ? ` · to ${fmtDate(j.PeriodEnd)}` : ""}</option>)}
            </select>
          </label>
          <div className="stack" style={{ gap: 4 }}>
            <span style={{ fontSize: 14 }}>How</span>
            <div className="seg" role="group" aria-label="How">
              {(Object.keys(KIND_NAMES) as MeetingKind[]).map((k) => (
                <button key={k} type="button" aria-pressed={m.Kind === k} onClick={() => set({ Kind: k })}>{KIND_NAMES[k]}</button>
              ))}
            </div>
          </div>
          <label>When<input className="input" type="datetime-local" value={m.When} onChange={(e) => set({ When: e.target.value })} /></label>
          <label>Length (minutes)<input className="input" type="number" min="5" step="5" value={m.Minutes} onChange={(e) => set({ Minutes: Number(e.target.value) || 0 })} /></label>
          <label>{m.Kind === "meeting" ? "Where" : m.Kind === "video" ? "Link" : "Number"}<input className="input" value={m.Location} onChange={(e) => set({ Location: e.target.value })} /></label>
          <label style={{ gridColumn: "1 / -1" }}>Who's there<input className="input" placeholder={client ? `e.g. ${[client.ContactPreferred || client.ContactFirst, client.ContactLast].filter(Boolean).join(" ") || "the client"}, you` : ""} value={m.Attendees} onChange={(e) => set({ Attendees: e.target.value })} /></label>
        </div>
        {!client && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Choose the client, and the meeting saves itself.</p>}
      </section>

      <section className="card pad stack" aria-labelledby="ag-h">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h2 id="ag-h" className="composer-h">Agenda and notes</h2>
          <span className="muted" style={{ fontSize: 12 }}>Type notes under each item as you go. Start a line with "Action:" or "Agreed:" to make tidying up easier.</span>
        </div>
        <ol className="agenda">
          {m.agenda.map((a, i) => (
            <li key={i}>
              <div className="agenda-head">
                <span className="agenda-no" aria-hidden="true">{i + 1}</span>
                <input className="input agenda-item" value={a.item} aria-label={`Agenda item ${i + 1}`} onChange={(e) => setItem(i, { item: e.target.value })} />
                <button type="button" className="iconbtn small" aria-label={`Remove ${a.item || "item"}`} onClick={() => set({ agenda: m.agenda.filter((_, j) => j !== i) })}><Icon name="close" size={14} /></button>
              </div>
              <GrowText className="input agenda-notes" value={a.notes} placeholder="Notes" label={`Notes for ${a.item}`} onChange={(v) => setItem(i, { notes: v })} />
            </li>
          ))}
        </ol>
        <div><button type="button" className="btn small" onClick={() => set({ agenda: [...m.agenda, { item: "", notes: "" }] })}><Icon name="plus" size={14} />Add agenda item</button></div>
        <label>
          Anything else
          <GrowText className="input" value={m.Notes} placeholder="Other notes" label="Other notes" onChange={(v) => set({ Notes: v })} />
        </label>
      </section>

      <section className="card pad stack after-card" aria-labelledby="af-h">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h2 id="af-h" className="composer-h">After the {m.Kind === "call" ? "call" : "meeting"}</h2>
          <div className="row-wrap">
            {undo && <button type="button" className="btn small" onClick={() => { set(undo); setUndo(null); }}>Undo AI tidy-up</button>}
            <button type="button" className="btn" disabled={!hasNotes || busy !== ""} onClick={tidy}><Icon name="spark" />{busy === "tidy" ? "Tidying up…" : "Tidy up with AI"}</button>
          </div>
        </div>
        <label>
          Summary
          <GrowText className="input" value={m.Summary} placeholder="What was discussed, in a few sentences. Tidy up with AI writes this from your notes." label="Summary" onChange={(v) => set({ Summary: v })} />
        </label>

        <div className="stack" style={{ gap: 6 }}>
          <span className="field-label">What was agreed</span>
          {m.decisions.map((d, i) => (
            <div key={i} className="row-wrap" style={{ gap: 6, flexWrap: "nowrap" }}>
              <input className="input" value={d} aria-label={`Decision ${i + 1}`} onChange={(e) => set({ decisions: m.decisions.map((x, j) => (j === i ? e.target.value : x)) })} />
              <button type="button" className="iconbtn small" aria-label="Remove" onClick={() => set({ decisions: m.decisions.filter((_, j) => j !== i) })}><Icon name="close" size={14} /></button>
            </div>
          ))}
          <div><button type="button" className="btn small" onClick={() => set({ decisions: [...m.decisions, ""] })}><Icon name="plus" size={14} />Add</button></div>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="field-label">Actions</span>
          {m.actions.length > 0 && (
            <div className="actions-table">
              {m.actions.map((a, i) => (
                <div key={i} className="action-row">
                  <input type="checkbox" checked={!!a.done} aria-label={`Done: ${a.text}`} onChange={(e) => setAction(i, { done: e.target.checked })} />
                  <input className="input" value={a.text} aria-label={`Action ${i + 1}`} onChange={(e) => setAction(i, { text: e.target.value })} />
                  <input className="input action-who" list="who-list" value={a.who} aria-label="Who" onChange={(e) => setAction(i, { who: e.target.value })} />
                  <input className="input action-due" type="date" value={a.due} aria-label="Due" onChange={(e) => setAction(i, { due: e.target.value })} />
                  {a.taskKey ? (
                    <button type="button" className="chip blue chip-link" onClick={() => open({ kind: "task", key: a.taskKey })}>In the plan</button>
                  ) : <span />}
                  <button type="button" className="iconbtn small" aria-label="Remove" onClick={() => set({ actions: m.actions.filter((_, j) => j !== i) })}><Icon name="close" size={14} /></button>
                </div>
              ))}
            </div>
          )}
          <datalist id="who-list"><option value="Me" /><option value="Client" /></datalist>
          <div className="row-wrap">
            <button type="button" className="btn small" onClick={() => set({ actions: [...m.actions, { text: "", who: "Me", due: "" }] })}><Icon name="plus" size={14} />Add</button>
            {mine.length > 0 && client && (
              <button type="button" className="btn small primary" disabled={busy !== ""} onClick={toPlan}>{busy === "plan" ? "Adding…" : `Add my ${mine.length} action${mine.length === 1 ? "" : "s"} to the plan`}</button>
            )}
          </div>
        </div>

        <div className="row-wrap" style={{ alignItems: "flex-end" }}>
          <label style={{ maxWidth: 220 }}>Follow up on<input className="input" type="date" value={m.FollowUp} onChange={(e) => set({ FollowUp: e.target.value })} /></label>
          {m.FollowUp && client && <button type="button" className="btn small" onClick={followUpTask}>Add follow-up to the plan</button>}
        </div>
      </section>

      {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
      {note && <div className="alert green-alert" role="status">{note}</div>}

      <div className="composer-actions">
        <button type="button" className="linkbtn danger-link" onClick={del}>Delete</button>
        <div className="row-wrap">
          {dirty && <button type="button" className="btn" disabled={!client} onClick={() => persist().catch(() => setError("Couldn't save."))}>Save</button>}
          <button type="button" className="btn primary" disabled={!client || (!m.Summary.trim() && !m.decisions.length && !m.actions.length)} onClick={emailSummary}>
            <Icon name="mail" />Email the summary to the client
          </button>
        </div>
      </div>
    </div>
  );
}

function GrowText({ value, onChange, className, placeholder, label }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(64, el.scrollHeight + 2)}px`;
  }, [value]);
  return <textarea ref={ref} className={className} value={value} placeholder={placeholder} aria-label={label} rows={2} onChange={(e) => onChange(e.target.value)} />;
}
