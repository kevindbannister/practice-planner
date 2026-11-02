// The statutory accounts for one company and year, made from its working papers: Details, Contents, Notes, Policies,
// View (the PDF) and Check & File, like the tabs in IRIS Elements. The figures come from the final trial balance in the
// papers. Nothing is filed from here: the PDF is for review and for comparing with Elements.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACCOUNTS_SETUP_ITEM, ACCOUNT_TYPES, AccSetup, AccountsInput, INCLUDE_KEYS, TYPE_NAMES, assemble, buildSections, checkAccounts, dateLong, hasErrors, notesFor, policyList, readAccSetup, withType, Director,
} from "../lib/accounts";
import { brandOf, displayName, readBranding } from "../lib/docBranding";
import { accountsFigures } from "../lib/tbMap";
import { Client, fmtDate, todayIso } from "../lib/domain";
import { SECTIONS, priorPeriod, Setup } from "../lib/papers";
import { downloadFile } from "./commsKit";
import { makePdf } from "./docsKit";
import { AccountsStatusSelect } from "./AccountsProduction";
import { useAccountsData, useWriterState } from "./PaperSchedules";
import { Icon, IconName, href, useRoute } from "./bits";
import { AccountsFlow, AccountsReview } from "./AccountsReview";
import { useData } from "./data";

type Tab = "details" | "contents" | "notes" | "policies" | "review" | "view" | "check";
const TAB_KEYS: Tab[] = ["details", "contents", "notes", "policies", "review", "view", "check"];
const MENU: { group: string; items: { key: Tab; label: string; icon: IconName }[] }[] = [
  { group: "Set up", items: [{ key: "details", label: "Details", icon: "building" }, { key: "contents", label: "Contents", icon: "list" }] },
  { group: "Wording", items: [{ key: "notes", label: "Notes", icon: "book" }, { key: "policies", label: "Policies", icon: "scale" }] },
  { group: "Output", items: [{ key: "review", label: "Review", icon: "layout" }, { key: "view", label: "View", icon: "print" }, { key: "check", label: "Check & File", icon: "check" }] },
];

const nextDay = (d: string) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };

/** The setup to work with: what was saved, with the company's own details filled in where nothing is saved yet. */
function useAccSetup(client: Client) {
  const { data } = useData();
  const w = useWriterState();
  const raw = w.setup(ACCOUNTS_SETUP_ITEM) as Setup;
  const officers = useMemo(() => data.cosecOfficers.filter((o) => o.ClientKey === client.Key && /director|member/i.test(String(o.Role || "")) && String(o.Status || "").toLowerCase() !== "removed").map((o): Director => ({
    name: String(o.CorporateName || [o.Title, o.First, o.Last].filter(Boolean).join(" ")).trim(), role: String(o.Role || ""), appointed: String(o.AppointedOn || "").slice(0, 10), resigned: String(o.ResignedOn || "").slice(0, 10),
  })).filter((o) => o.name), [data.cosecOfficers, client.Key]);
  const saved = useMemo(() => readAccSetup(raw, String(client.Kind) === "LLP" ? "llp" : "small"), [raw, client.Kind]);
  const effective: AccSetup = useMemo(() => ({
    ...saved,
    registeredOffice: saved.registeredOffice || String((client as { RegisteredOffice?: string }).RegisteredOffice || ""),
    directors: saved.directors.length ? saved.directors : officers,
  }), [saved, officers, client]);
  return { saved, effective, officers, hasSaved: Object.keys(raw).length > 0 };
}

export function AccountsScreen({ client, period, onPapers }: { client: Client; period: string; onPapers: () => void }) {
  const w = useWriterState();
  const { effective, officers } = useAccSetup(client);
  const { query } = useRoute();
  const wantedTab = query.get("tab");
  const [tab, setTab] = useState<Tab>(TAB_KEYS.includes(wantedTab as Tab) ? (wantedTab as Tab) : "details");
  useEffect(() => { if (TAB_KEYS.includes(wantedTab as Tab)) setTab(wantedTab as Tab); }, [wantedTab]);
  const [a, setA] = useState<AccSetup>(effective);
  const last = useRef(JSON.stringify(effective));
  // pick up changes from elsewhere, but not our own typing
  useEffect(() => { const j = JSON.stringify(effective); if (j !== last.current) { last.current = j; setA(effective); } }, [effective]);
  const save = (next: AccSetup) => { last.current = JSON.stringify(next); setA(next); return w.writeSetup(ACCOUNTS_SETUP_ITEM, next as unknown as Setup); };
  const set = (patch: Partial<AccSetup>, now = true) => { const next = { ...a, ...patch }; setA(next); if (now) void save(next); };
  const commit = () => { if (JSON.stringify(a) !== last.current) void save(a); };

  const { data } = useData();
  const branding = useMemo(() => brandOf(readBranding(data.settings)), [data.settings]);
  const acc = useAccountsData();
  const figures = useMemo(() => (acc.maps ? accountsFigures(acc.maps) : accountsFigures([])), [acc.maps]);
  const prior = useMemo(() => (acc.priorMaps ? accountsFigures(acc.priorMaps) : undefined), [acc.priorMaps]);
  const facts = useMemo(() => ({
    name: client.Title, number: String(client.CompanyNumber || ""), start: nextDay(priorPeriod(period)), end: period, priorEnd: priorPeriod(period),
    firm: displayName(branding), firmAddress: (branding.correspondenceAddress || branding.registeredAddress || "").trim(), kind: String(client.Kind || "Ltd"),
  }), [client, period, branding]);
  const link = (section: string) => (SECTIONS.some((x) => x.key === section) ? `${location.origin}${location.pathname}${href("papers", String(client.Key), period)}?section=${encodeURIComponent(section)}` : undefined);
  const input: AccountsInput = { facts, setup: a, figures, prior, maps: acc.maps, priorMaps: acc.priorMaps, assets: acc.assets, priorAssets: acc.priorAssets, link };
  // the same pages for the on-screen review, with links that stay in the app and bring the person back here
  const reviewLink = (section: string) => (SECTIONS.some((x) => x.key === section) ? `${href("papers", String(client.Key), period)}?section=${encodeURIComponent(section)}&from=accounts` : undefined);
  const sections = useMemo(() => (tab === "review" ? buildSections({ ...input, link: reviewLink }) : []), [tab, a, figures, prior, acc.maps, acc.assets, facts]); // eslint-disable-line react-hooks/exhaustive-deps
  const checks = useMemo(() => checkAccounts(input), [a, figures, prior, acc.maps, facts]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="paper acc-screen">
      <nav className="paper-side" aria-label="Sections of the accounts">
        {MENU.map((g) => (
          <div key={g.group} className="paper-group">
            <div className="paper-group-name" style={{ cursor: "default" }}>{g.group}</div>
            <ul>
              {g.items.map((it) => {
                const bad = it.key === "check" && hasErrors(checks);
                return (
                  <li key={it.key}>
                    <button type="button" className={`paper-item${it.key === tab ? " on" : ""}`} aria-current={it.key === tab ? "true" : undefined} onClick={() => { commit(); setTab(it.key); }}>
                      <span className="paper-ico" aria-hidden="true"><Icon name={it.icon} size={15} /></span>
                      <span className="paper-name">{it.label}</span>
                      {bad && <span className="paper-note-flag" title="Has errors to fix" aria-label="Has errors to fix" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div className="paper-group">
          <div className="paper-group-name" style={{ cursor: "default" }}>Figures</div>
          <ul><li><button type="button" className="paper-item" onClick={onPapers} title="The trial balance is in the working papers"><span className="paper-ico" aria-hidden="true"><Icon name="calc" size={15} /></span><span className="paper-name">Trial balance →</span></button></li></ul>
        </div>
      </nav>
      <section className="paper-main stack" aria-label="Accounts">
      {!acc.maps && <p className="notice" role="status">There is no trial balance for this year yet. Import or paste it in the working papers (Trial balance) and the figures appear here.</p>}
      {tab === "details" && <Details a={a} set={set} commit={commit} facts={facts} officers={officers} />}
      {tab === "contents" && <ContentsTab a={a} set={set} setType={(t) => void save(withType(a, t))} />}
      {tab === "notes" && <NotesTab a={a} set={set} commit={commit} />}
      {tab === "policies" && <PoliciesTab a={a} set={set} commit={commit} />}
      {tab === "review" && <AccountsReview sections={sections} draft={a.draft} />}
      {tab === "view" && <ViewTab input={input} branding={branding} />}
      {tab === "check" && <CheckTab a={a} set={set} commit={commit} checks={checks} client={client} period={period} />}
      {w.error && <p className="error-text" role="alert">{w.error}</p>}
      </section>
    </div>
  );
}

type Common = { a: AccSetup; set: (p: Partial<AccSetup>, now?: boolean) => void; commit: () => void };

function Details({ a, set, commit, facts, officers }: Common & { facts: AccountsInput["facts"]; officers: Director[] }) {
  const setDir = (i: number, p: Partial<Director>, now = false) => set({ directors: a.directors.map((d, k) => (k === i ? { ...d, ...p } : d)) }, now);
  return (
    <section className="card pad stack" aria-label="Details">
      <div className="grid-2">
        <div><strong>Accounting period</strong><div>{fmtDate(facts.start)} to {fmtDate(facts.end)}</div></div>
        <div><strong>Comparative period</strong><div>{a.comparatives ? `Year ended ${fmtDate(facts.priorEnd)}` : "Not shown"}</div></div>
        <div><strong>Company number</strong><div>{facts.number || <span className="error-text">Missing: add it on the client page</span>}</div></div>
      </div>
      <label className="doc-field">Registered office<textarea className="input" rows={3} value={a.registeredOffice} onChange={(e) => set({ registeredOffice: e.target.value }, false)} onBlur={commit} /></label>
      <label className="doc-field">Principal activity<textarea className="input" rows={2} value={a.activity} placeholder="For example: Roofing and building services" onChange={(e) => set({ activity: e.target.value }, false)} onBlur={commit} /></label>
      <div className="grid-2">
        <label className="doc-field">Company secretary (if any)<input className="input" value={a.secretary} onChange={(e) => set({ secretary: e.target.value }, false)} onBlur={commit} /></label>
        <label className="doc-field">Accountant's address (blank: your letterhead address)<textarea className="input" rows={2} value={a.accountant} onChange={(e) => set({ accountant: e.target.value }, false)} onBlur={commit} /></label>
      </div>
      <label className="row-wrap" style={{ gap: 8 }}><input type="checkbox" checked={a.auditExempt} onChange={(e) => set({ auditExempt: e.target.checked })} /> Audit exempt (small company exemption)</label>
      <h3 style={{ margin: 0 }}>{a.type === "llp" ? "Members" : "Directors"}</h3>
      <table className="table">
        <thead><tr><th>Name</th><th>Appointed</th><th>Resigned</th><th /></tr></thead>
        <tbody>
          {a.directors.map((d, i) => (
            <tr key={i}>
              <td><input className="input" aria-label="Name" value={d.name} onChange={(e) => setDir(i, { name: e.target.value })} onBlur={commit} /></td>
              <td><input className="input" type="date" aria-label="Appointed" value={d.appointed} onChange={(e) => setDir(i, { appointed: e.target.value }, true)} /></td>
              <td><input className="input" type="date" aria-label="Resigned" value={d.resigned} onChange={(e) => setDir(i, { resigned: e.target.value }, true)} /></td>
              <td><button type="button" className="linkbtn" onClick={() => set({ directors: a.directors.filter((_, k) => k !== i) })}>Remove</button></td>
            </tr>
          ))}
          {!a.directors.length && <tr><td colSpan={4} className="muted">None yet. Add them, or take them from the company secretarial register.</td></tr>}
        </tbody>
      </table>
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn small" onClick={() => set({ directors: [...a.directors, { name: "", role: "Director", appointed: "", resigned: "" }] })}>Add a {a.type === "llp" ? "member" : "director"}</button>
        {officers.length > 0 && <button type="button" className="btn small" onClick={() => set({ directors: officers })}>Fill from the company secretarial register ({officers.length})</button>}
      </div>
    </section>
  );
}

function ContentsTab({ a, set, setType }: Pick<Common, "a" | "set"> & { setType: (t: AccSetup["type"]) => void }) {
  return (
    <section className="card pad stack" aria-label="Contents">
      <label className="doc-field">Type of accounts
        <select className="input" value={a.type} onChange={(e) => setType(e.target.value as AccSetup["type"])}>{ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{TYPE_NAMES[t]}</option>)}</select>
      </label>
      <p className="muted" style={{ margin: 0 }}>Changing the type resets which pages are included. Everything you have typed stays.</p>
      <fieldset className="stack" style={{ border: 0, padding: 0 }}>
        <legend><strong>Include</strong></legend>
        <label className="row-wrap" style={{ gap: 8 }}><input type="checkbox" checked={a.cover} onChange={(e) => set({ cover: e.target.checked })} /> Cover page (its look is set in Settings, Document design)</label>
        {INCLUDE_KEYS.map((k) => (
          <label key={k.key} className="row-wrap" style={{ gap: 8 }}><input type="checkbox" checked={a.include[k.key]} onChange={(e) => set({ include: { ...a.include, [k.key]: e.target.checked } })} /> {k.label}</label>
        ))}
      </fieldset>
      <label className="row-wrap" style={{ gap: 8 }}><input type="checkbox" checked={a.comparatives} onChange={(e) => set({ comparatives: e.target.checked })} /> Show last year's comparatives</label>
      <label className="row-wrap" style={{ gap: 8 }}><input type="checkbox" checked={a.draft} onChange={(e) => set({ draft: e.target.checked })} /> DRAFT watermark on every page</label>
    </section>
  );
}

function NotesTab({ a, set, commit }: Common) {
  const setNote = (key: string, p: { on?: boolean; text?: string }, now = true) => set({ notes: { ...a.notes, [key]: { ...a.notes[key], ...p } } }, now);
  return (
    <section className="card pad stack" aria-label="Notes">
      <p className="muted" style={{ margin: 0 }}>Notes are numbered in the order shown. Notes marked automatic take their figures from the trial balance; text you type is added to them. The others start with sample wording: check it before you rely on it.</p>
      <div className="grid-2">
        <label className="doc-field">Average employees this year<input className="input" inputMode="numeric" value={a.employees.now} onChange={(e) => set({ employees: { ...a.employees, now: e.target.value } }, false)} onBlur={commit} /></label>
        <label className="doc-field">Average employees last year<input className="input" inputMode="numeric" value={a.employees.before} onChange={(e) => set({ employees: { ...a.employees, before: e.target.value } }, false)} onBlur={commit} /></label>
        <label className="doc-field">Shares issued (number)<input className="input" inputMode="numeric" value={a.shares.count} onChange={(e) => set({ shares: { ...a.shares, count: e.target.value } }, false)} onBlur={commit} /></label>
        <label className="doc-field">Class and nominal value (£)
          <span className="row-wrap" style={{ gap: 6 }}><input className="input" aria-label="Share class" value={a.shares.class} onChange={(e) => set({ shares: { ...a.shares, class: e.target.value } }, false)} onBlur={commit} /><input className="input" aria-label="Nominal value" style={{ width: 80 }} value={a.shares.nominal} onChange={(e) => set({ shares: { ...a.shares, nominal: e.target.value } }, false)} onBlur={commit} /></span>
        </label>
      </div>
      {notesFor(a).map((n) => {
        const on = a.notes[n.key]?.on ?? n.on;
        return (
          <div key={n.key} className="stack" style={{ gap: 6, borderTop: "1px solid var(--line, #ddd)", paddingTop: 8 }}>
            <label className="row-wrap" style={{ gap: 8 }}><input type="checkbox" checked={on} onChange={(e) => setNote(n.key, { on: e.target.checked })} /> <strong>{n.title}</strong>{n.auto && <span className="muted"> (automatic)</span>}</label>
            {on && !["employees", "shares", "policies"].includes(n.key) && (
              <textarea className="input" rows={3} aria-label={`${n.title} text`} value={a.notes[n.key]?.text ?? n.text} placeholder={n.auto ? "Anything you add appears under the figures" : "Add the details"}
                onChange={(e) => setNote(n.key, { text: e.target.value }, false)} onBlur={commit} />
            )}
          </div>
        );
      })}
    </section>
  );
}

function PoliciesTab({ a, set, commit }: Common) {
  const list = policyList(a);
  const setP = (key: string, p: { on?: boolean; text?: string }, now = true) => set({ policies: { ...a.policies, [key]: { ...a.policies[key], ...p } } }, now);
  return (
    <section className="card pad stack" aria-label="Policies">
      <p className="muted" style={{ margin: 0 }}>The accounting policies paragraphs, in order. Edit the wording to fit the company.</p>
      {list.map((p) => (
        <div key={p.key} className="stack" style={{ gap: 6 }}>
          <label className="row-wrap" style={{ gap: 8 }}><input type="checkbox" checked={p.on} onChange={(e) => setP(p.key, { on: e.target.checked })} /> <strong>{p.title}</strong>
            {a.policies[p.key]?.text !== undefined && <button type="button" className="linkbtn" onClick={() => set({ policies: { ...a.policies, [p.key]: { on: a.policies[p.key]?.on } } })}>Reset wording</button>}
          </label>
          {p.on && <textarea className="input" rows={4} aria-label={`${p.title} wording`} value={p.text} onChange={(e) => setP(p.key, { text: e.target.value }, false)} onBlur={commit} />}
        </div>
      ))}
    </section>
  );
}

/** Makes the accounts PDF: once to find where each section starts, again with those page numbers in the contents. */
export async function makeAccountsPdf(input: AccountsInput, branding: ReturnType<typeof brandOf>) {
  const a = input.setup, F = input.facts;
  const sections = buildSections(input);
  const common = {
    layout: {}, branding, title: `Annual report and ${a.auditExempt ? "unaudited " : ""}accounts: ${F.name}`, reference: F.number, client: F.name, date: dateLong(F.end), docType: "accounts" as const,
    watermark: a.draft ? "Draft" : undefined, numberCover: true,
  };
  const marks: number[] = [];
  const first = assemble(sections, a.include.contents, F);
  await makePdf({ ...common, content: first.content, marks } as Parameters<typeof makePdf>[0]);
  const final = assemble(sections, a.include.contents, F, marks, a.cover ? 1 : 0);
  const made = await makePdf({ ...common, content: final.content } as Parameters<typeof makePdf>[0]);
  return made;
}

function ViewTab({ input, branding }: { input: AccountsInput; branding: ReturnType<typeof brandOf> }) {
  const [state, setState] = useState<{ url?: string; pages?: number; bytes?: Uint8Array; error?: string; busy: boolean }>({ busy: false });
  const url = useRef<string>();
  useEffect(() => () => { if (url.current) URL.revokeObjectURL(url.current); }, []);
  const run = async () => {
    setState((s) => ({ ...s, busy: true, error: undefined }));
    try {
      const made = await makeAccountsPdf(input, branding);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(new Blob([made.bytes as BlobPart], { type: "application/pdf" }));
      setState({ busy: false, url: url.current, pages: made.pages, bytes: made.bytes });
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : "The PDF could not be made." });
    }
  };
  const name = `${input.facts.end} Accounts ${input.facts.name}${input.setup.draft ? " DRAFT" : ""}.pdf`.replace(/[\\/:*?"<>|]+/g, " ");
  return (
    <section className="card pad stack" aria-label="View">
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn primary" disabled={state.busy} onClick={run}>{state.busy ? "Making the PDF…" : state.url ? "Refresh the PDF" : "Make the PDF"}</button>
        {state.bytes && <button type="button" className="btn" onClick={() => downloadFile(state.bytes as Uint8Array, name, "application/pdf")}>Download ({state.pages} pages)</button>}
      </div>
      <p className="muted" style={{ margin: 0 }}>Figures in blue are links: click one in the PDF to open that working paper (you need to be signed in). The PDF is made in your browser from the papers. It is not filed anywhere; compare it with Elements before relying on it.</p>
      {state.error && <p className="error-text" role="alert">{state.error}</p>}
      {state.url && <iframe title="Accounts PDF" src={state.url} style={{ width: "100%", height: "75vh", border: "1px solid var(--line, #ddd)", borderRadius: 8 }} />}
    </section>
  );
}

function CheckTab({ a, set, checks, client, period }: Common & { checks: ReturnType<typeof checkAccounts>; client: Client; period: string }) {
  const marker = { error: "✗", warn: "!", ok: "✓" } as const;
  return (
    <section className="card pad stack" aria-label="Check and file">
      <div className="grid-2">
        <label className="doc-field">Signing {a.type === "llp" ? "member" : "director"}
          <select className="input" value={a.signer} onChange={(e) => set({ signer: e.target.value })}>
            <option value="">Choose…</option>
            {a.directors.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </select>
        </label>
        <label className="doc-field">Date approved by the board<input className="input" type="date" value={a.approved} onChange={(e) => set({ approved: e.target.value })} /></label>
      </div>
      <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}>
        {checks.map((c, i) => <li key={i} className={c.level === "error" ? "error-text" : c.level === "warn" ? "warn-text" : "muted"}><strong aria-hidden="true">{marker[c.level]}</strong> <span className="sr-only">{c.level}: </span>{c.text}</li>)}
      </ul>
      <div className="row-wrap" style={{ gap: 12 }}>
        <AccountsStatusSelect clientKey={String(client.Key)} period={period} />
        <label className="row-wrap" style={{ gap: 8 }}>
          <input type="checkbox" checked={!!a.exported} onChange={(e) => set({ exported: e.target.checked ? todayIso() : "" })} /> Put into Elements for comparison{a.exported ? ` (${fmtDate(a.exported)})` : ""}
        </label>
      </div>
      <p className="muted" style={{ margin: 0 }}>Filing with Companies House and HMRC stays in Elements. Nothing is sent from here.</p>
    </section>
  );
}


/** The accounts figures as one scrollable page: the income statement, balance sheet and detailed profit and loss with a divider where each page would break. */
export function AccountsFigures({ client, period }: { client: Client; period: string }) {
  const { effective } = useAccSetup(client);
  const { data } = useData();
  const branding = useMemo(() => brandOf(readBranding(data.settings)), [data.settings]);
  const acc = useAccountsData();
  const figures = useMemo(() => (acc.maps ? accountsFigures(acc.maps) : accountsFigures([])), [acc.maps]);
  const prior = useMemo(() => (acc.priorMaps ? accountsFigures(acc.priorMaps) : undefined), [acc.priorMaps]);
  const facts = useMemo(() => ({
    name: client.Title, number: String(client.CompanyNumber || ""), start: nextDay(priorPeriod(period)), end: period, priorEnd: priorPeriod(period),
    firm: displayName(branding), firmAddress: (branding.correspondenceAddress || branding.registeredAddress || "").trim(), kind: String(client.Kind || "Ltd"),
  }), [client, period, branding]);
  const link = (section: string) => (SECTIONS.some((x) => x.key === section) ? `${href("papers", String(client.Key), period)}?section=${encodeURIComponent(section)}&from=figures` : undefined);
  const sections = useMemo(() => {
    const setup: AccSetup = { ...effective, include: { ...effective.include, income: effective.type !== "dormant", balance: true, detailed: effective.type !== "dormant" } };
    const keep = ["income", "balance", "detailed"];
    return buildSections({ facts, setup, figures, prior, maps: acc.maps, priorMaps: acc.priorMaps, assets: acc.assets, priorAssets: acc.priorAssets, link }).filter((x) => keep.includes(x.key));
  }, [effective, figures, prior, acc.maps, acc.priorMaps, acc.assets, facts]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack">
      {!acc.maps && <p className="notice" role="status">There is no trial balance for this year yet. Import or paste it in the working papers (Trial balance) and the figures appear here.</p>}
      <AccountsFlow sections={sections} draft={effective.draft} />
    </div>
  );
}
