// Co Sec foundation screens: the portfolio summary and Add company, a company's service level, and its share ledger
// (holdings and ownership at any date, entries, corrections, and the comparison with the working register).
import { useMemo, useState } from "react";
import { fmtDate, todayIso } from "../lib/domain";
import { COSEC_ONLY, LEVELS, Level, addCompany, counts, filesCs01, findDuplicate, levelLabel, profileFor, responsible, setLevel, validNumber, normNumber } from "../lib/cosecProfile";
import { ENTRY_LABEL, Entry, EntryType, NewEntry, openingFromRegister, ownership, readEntry, reconcile, record, replay, supersede } from "../lib/shareLedger";
import { PortfolioRow } from "../lib/portfolio";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { href } from "./bits";
import { useCompaniesHouse } from "./CompaniesHouse";
import { useCoSec } from "./cosecKit";

const s = (v: unknown) => (v == null ? "" : String(v));
const now = () => new Date().toISOString();
const say = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't work. Try again.");

// ------------------------------------------------------------------ portfolio summary

export function PortfolioSummary({ rows }: { rows: PortfolioRow[] }) {
  const k = useCoSec();
  const c = useMemo(() => counts(k.data.clients, k.data.cosecProfiles, rows, todayIso()), [k.data.clients, k.data.cosecProfiles, rows]);
  const tile = (label: string, value: number, tone = "", title?: string) => (
    <div className="card pad" style={{ minWidth: 130, flex: "1 1 130px" }} title={title}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600 }}>{value}{value > 0 && tone ? <span className={`chip ${tone}`} style={{ marginLeft: 8, fontSize: 11 }}>{tone === "red" ? "act" : "soon"}</span> : null}</div>
    </div>
  );
  return (
    <div className="row-wrap" style={{ gap: 10, alignItems: "stretch" }} aria-label="Portfolio summary">
      {tile("Companies", c.total)}
      {tile("Managed by the practice", c.managed, "", "Fully managed, or specific filings only")}
      {tile("Monitoring only", c.monitoring, "", "Watched for changes; the practice files nothing")}
      {tile("Confirmation statements overdue", c.cs01Overdue, "red", "Only where the practice files the CS01")}
      {tile("Confirmation statements due soon", c.cs01Soon, "amber", "Within 60 days")}
      {tile("Accounts overdue", c.accountsOverdue, "red", "Only where the practice is responsible")}
      {tile("Accounts due soon", c.accountsSoon, "amber", "Within 60 days")}
      {tile("Filings waiting", c.outstanding)}
    </div>
  );
}

export function LevelChip({ client }: { client: Row }) {
  const k = useCoSec();
  const p = profileFor(client, k.data.cosecProfiles);
  return <span className={`chip ${responsible(p.level) ? "green" : p.level === "monitoring" ? "amber" : ""}`} title={LEVELS.find((l) => l.key === p.level)?.help}>{levelLabel(p.level)}</span>;
}

// ------------------------------------------------------------------ add a company

export function AddCompany({ onClose }: { onClose: () => void }) {
  const k = useCoSec();
  const ch = useCompaniesHouse();
  const [how, setHow] = useState<"existing" | "ch" | "manual">("ch");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [kind, setKind] = useState<"Ltd" | "LLP">("Ltd");
  const [level, setLv] = useState<Level>("monitoring");
  const [existing, setExisting] = useState("");
  const [found, setFound] = useState<{ name: string; number: string; kind: "Ltd" | "LLP"; incorporated: string; office: string; status: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const clients = k.data.clients;
  const candidates = clients.filter((c) => (c.Kind === "Ltd" || c.Kind === "LLP") && !s(c.CompanyNumber).trim()).sort((a, b) => s(a.Title).localeCompare(s(b.Title)));
  const dup = number.trim() ? findDuplicate(clients, number) : undefined;

  const run = async (work: () => Promise<string>) => { setBusy(true); setMsg(undefined); try { setMsg({ ok: true, text: await work() }); } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); } };

  const lookup = () => run(async () => {
    setFound(null);
    if (!validNumber(number)) throw new Error("A company number is 8 characters, e.g. 01234567 or SC123456.");
    const n = normNumber(number);
    const p = await ch.get(`company/${n}`);
    const a = p.registered_office_address || {};
    setFound({ name: s(p.company_name), number: n, kind: /llp/i.test(s(p.type)) ? "LLP" : "Ltd", incorporated: s(p.date_of_creation), office: [a.premises, a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code].filter(Boolean).join(", "), status: [p.company_status, p.company_status_detail].filter(Boolean).join(", ") });
    return "Found at Companies House. Check it is the right company, then add it.";
  });

  const create = (c: { name: string; number: string; kind: "Ltd" | "LLP"; incorporated?: string; office?: string }) => run(async () => {
    if (!k.can("edit")) throw new Error("You can't add companies.");
    const a = addCompany({ name: c.name, number: c.number, kind: c.kind, incorporated: c.incorporated, registeredOffice: c.office, level }, clients, newKey, now(), k.me);
    if (a.error) throw new Error(a.duplicate ? `${a.error} Open it from the portfolio, or choose "Existing XProFlow company".` : a.error);
    await k.apply({ creates: [{ list: "Clients", row: a.client! }, { list: "CoSecProfiles", row: a.profile! }], patches: [], log: [], activities: [] });
    onClose();
    return "Added.";
  });

  const useExisting = () => run(async () => {
    const c = clients.find((x) => x.Key === existing);
    if (!c) throw new Error("Choose a client.");
    if (!validNumber(number)) throw new Error("Enter this company's registration number.");
    const dupe = findDuplicate(clients, number);
    if (dupe && dupe.Key !== c.Key) throw new Error(`${s(dupe.Title)} already has that number.`);
    const w = setLevel(c, k.data.cosecProfiles, level, newKey, now(), k.me);
    await k.update("Clients", c, { CompanyNumber: normNumber(number) });
    await k.apply({ creates: w.create ? [{ list: "CoSecProfiles", row: w.create }] : [], patches: w.patch ? [{ list: "CoSecProfiles", ...w.patch }] : [], log: [], activities: [] });
    onClose();
    return "Added to Co Sec.";
  });

  return (
    <section className="card pad stack" aria-label="Add a company">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>Add a company</h3><button type="button" className="linkbtn" onClick={onClose}>Close</button></div>
      <div className="row-wrap" role="tablist" aria-label="How to add">
        {([["ch", "From Companies House"], ["existing", "Existing XProFlow company"], ["manual", "Enter by hand"]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={how === key} className={`btn${how === key ? " primary" : ""}`} onClick={() => { setHow(key); setMsg(undefined); setFound(null); }}>{label}</button>)}
      </div>
      <div className="tl-form">
        {how === "existing" && <label className="doc-field"><span>Client</span><select className="input" value={existing} onChange={(e) => setExisting(e.target.value)}><option value="">Choose a company or LLP client…</option>{candidates.map((c) => <option key={s(c.Key)} value={s(c.Key)}>{s(c.Title)}</option>)}</select></label>}
        {how === "manual" && <label className="doc-field"><span>Registered name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>}
        <label className="doc-field"><span>Company number</span><input className="input" value={number} onChange={(e) => { setNumber(e.target.value); setFound(null); }} placeholder="e.g. 01234567 or SC123456" /></label>
        {how === "manual" && <label className="doc-field"><span>Type</span><select className="input" value={kind} onChange={(e) => setKind(e.target.value as "Ltd" | "LLP")}><option value="Ltd">Limited company</option><option value="LLP">LLP</option></select></label>}
        <label className="doc-field"><span>The practice's role</span><select className="input" value={level} onChange={(e) => setLv(e.target.value as Level)}>{LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{LEVELS.find((l) => l.key === level)?.help}</p>
      {dup && how !== "existing" && <p className="error-text" role="alert" style={{ margin: 0 }}>{s(dup.Title)} is already on file with that number. <a href={href("cosec", "company", s(dup.Key))}>Open it</a></p>}
      {found && <div className="import-list"><strong>{found.name}</strong><div className="muted" style={{ fontSize: 13 }}>{found.number} · {found.kind === "LLP" ? "LLP" : "Limited company"} · {found.status}{found.incorporated ? ` · incorporated ${fmtDate(found.incorporated)}` : ""}<br />{found.office}</div></div>}
      {msg && <p className={msg.ok ? undefined : "error-text"} role={msg.ok ? "status" : "alert"} style={{ margin: 0 }}>{msg.text}</p>}
      <div className="row-wrap">
        {how === "ch" && !found && <button type="button" className="btn primary" disabled={busy || !number.trim()} onClick={() => void lookup()}>Look up at Companies House</button>}
        {how === "ch" && found && <button type="button" className="btn primary" disabled={busy || !!dup} onClick={() => void create({ name: found.name, number: found.number, kind: found.kind, incorporated: found.incorporated, office: found.office })}>Add {found.name}</button>}
        {how === "manual" && <button type="button" className="btn primary" disabled={busy} onClick={() => void create({ name, number, kind })}>Add company</button>}
        {how === "existing" && <button type="button" className="btn primary" disabled={busy || !existing} onClick={() => void useExisting()}>Add to Co Sec</button>}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>A company that isn't a client is kept as one record marked "Co Sec only", so it is never a second copy. Adding a company does not make the practice responsible for any filing unless you choose a managed role.</p>
    </section>
  );
}

// ------------------------------------------------------------------ service level on a company

export function ServiceLevel({ client }: { client: Row }) {
  const k = useCoSec();
  const p = profileFor(client, k.data.cosecProfiles);
  const [level, setLv] = useState<Level>(p.level);
  const [who, setWho] = useState(p.responsible);
  const [cs, setCs] = useState(p.filesCs01 === null ? "default" : p.filesCs01 ? "yes" : "no");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const dirty = level !== p.level || who !== p.responsible || cs !== (p.filesCs01 === null ? "default" : p.filesCs01 ? "yes" : "no");
  const save = async () => {
    setBusy(true); setMsg(undefined);
    try {
      const w = setLevel(client, k.data.cosecProfiles, level, newKey, now(), k.me, { responsible: who, filesCs01: cs === "default" ? null : cs === "yes" });
      await k.apply({ creates: w.create ? [{ list: "CoSecProfiles", row: w.create }] : [], patches: w.patch ? [{ list: "CoSecProfiles", ...w.patch }] : [], log: [], activities: [] });
      setMsg({ ok: true, text: "Saved." });
    } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); }
  };
  const draftFile = filesCs01({ ...p, level, filesCs01: cs === "default" ? null : cs === "yes" });
  return (
    <section className="card pad stack" aria-label="The practice's role">
      <h3 style={{ margin: 0 }}>The practice's role {s(client.Status).toLowerCase() === COSEC_ONLY && <span className="chip">Co Sec only (not a client)</span>}</h3>
      <div className="tl-form">
        <label className="doc-field"><span>Service level</span><select className="input" disabled={!k.can("edit")} value={level} onChange={(e) => setLv(e.target.value as Level)}>{LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
        <label className="doc-field"><span>Responsible person</span><input className="input" disabled={!k.can("edit")} value={who} onChange={(e) => setWho(e.target.value)} /></label>
        <label className="doc-field"><span>Practice files the confirmation statement</span><select className="input" disabled={!k.can("edit")} value={cs} onChange={(e) => setCs(e.target.value)}><option value="default">Follow the service level</option><option value="yes">Yes</option><option value="no">No</option></select></label>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{LEVELS.find((l) => l.key === level)?.help} The practice {draftFile ? "will" : "will not"} be treated as responsible for this company's confirmation statement.</p>
      {msg && <p className={msg.ok ? undefined : "error-text"} role={msg.ok ? "status" : "alert"} style={{ margin: 0 }}>{msg.text}</p>}
      {dirty && k.can("edit") && <div><button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>Save</button></div>}
    </section>
  );
}

// ------------------------------------------------------------------ the share ledger

const TYPES: EntryType[] = ["opening", "allotment", "bonus", "transfer", "redemption", "cancellation"];

export function Ledger({ client }: { client: Row }) {
  const k = useCoSec();
  const ck = s(client.Key);
  const rows = useMemo(() => k.data.cosecLedger.filter((r) => r.ClientKey === ck), [k.data.cosecLedger, ck]);
  const entries = useMemo(() => rows.map(readEntry), [rows]);
  const classes = useMemo(() => k.data.cosecShareClasses.filter((c) => c.ClientKey === ck && s(c.Status) !== "former").map((c) => s(c.Name)), [k.data.cosecShareClasses, ck]);
  const register = useMemo(() => k.data.cosecShares.filter((r) => r.ClientKey === ck), [k.data.cosecShares, ck]);
  const [asOf, setAsOf] = useState(todayIso());
  const [adding, setAdding] = useState(false);
  const [fixing, setFixing] = useState<Entry | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const ready = k.data.cosecLedger !== undefined;
  const at = replay(entries.filter((e) => e.clientKey === ck), asOf);
  const own = ownership(at.holdings);
  const rec = reconcile(register, entries);
  const canEdit = k.can("edit");
  const run = async (work: () => Promise<string>) => { setBusy(true); setMsg(undefined); try { setMsg({ ok: true, text: await work() }); } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); } };
  const log = (text: string, detail = "") => ({ Key: newKey("A"), ClientKey: ck, Type: "cosec-flag", Title: text, Summary: detail, At: now(), Actor: k.me, Source: "cosec", SourceKey: "ledger", EventKey: `ledger:${newKey("E")}`, Visibility: "normal", Created: now() });

  const carryIn = () => run(async () => {
    const date = s(client.Incorporated).slice(0, 10) || register.map((r) => s(r.From).slice(0, 10)).filter(Boolean).sort()[0] || todayIso();
    const made = openingFromRegister(register, entries, ck, date, k.me, now());
    if (!made.length) return "Nothing to carry in.";
    await k.apply({ creates: [...made.map((row) => ({ list: "CoSecLedger" as const, row })), ] as never, patches: [], log: [], activities: [log(`Share ledger: opening balances carried in from the register (${made.length})`, `Dated ${date}. Earlier history is not recorded.`)] });
    return `${made.length} opening balance${made.length === 1 ? "" : "s"} recorded, dated ${fmtDate(date)}. Change a date by correcting the entry.`;
  });

  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad stack" aria-label="Holdings">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Who holds what</h3>
          <span className="row-wrap"><label className="row-wrap muted" style={{ fontSize: 13 }}>As at <input className="input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: "auto" }} /></label>{canEdit && <button type="button" className="btn primary" onClick={() => setAdding(!adding)} disabled={!ready}>{adding ? "Close" : "Add entry"}</button>}</span>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Worked out from the ledger below, never typed in. Percentages are by number of shares; voting and dividend rights are not yet taken into account, so this is not a test of who has significant control.</p>
        {at.problems.length > 0 && <div className="alert red" role="alert"><strong>The ledger doesn't add up</strong><span>{at.problems[0]}</span></div>}
        {!own.holders.length ? <p className="muted" style={{ margin: 0 }}>{entries.length ? "No shares were held on that date." : "The ledger is empty. Add an opening balance, or carry in the register below."}</p> : (
          <div className="table-wrap"><table className="grid" style={{ minWidth: 520 }}>
            <thead><tr><th scope="col">Holder</th><th scope="col">Class</th><th scope="col" style={{ textAlign: "right" }}>Shares</th><th scope="col" style={{ textAlign: "right" }}>% of class</th><th scope="col" style={{ textAlign: "right" }}>% of all shares</th></tr></thead>
            <tbody>{own.holders.flatMap((h) => h.byClass.map((c, i) => <tr key={h.id + c.cls}><td>{i === 0 ? h.name : ""}</td><td>{c.cls}</td><td style={{ textAlign: "right" }}>{c.number.toLocaleString("en-GB")}</td><td style={{ textAlign: "right" }}>{c.percentOfClass}%</td><td style={{ textAlign: "right" }}>{i === 0 ? `${h.percent}%` : ""}</td></tr>))}
              <tr><th scope="row" colSpan={2}>Issued</th><th style={{ textAlign: "right" }}>{own.issued.toLocaleString("en-GB")}</th><td colSpan={2} className="muted">{own.byClass.map((c) => `${c.cls}: ${c.issued.toLocaleString("en-GB")}`).join(" · ")}</td></tr></tbody>
          </table></div>
        )}
      </section>

      {adding && canEdit && <AddEntry client={client} entries={entries} classes={classes} onDone={() => setAdding(false)} />}
      {fixing && <Correct entry={fixing} rows={rows} entries={entries} onDone={() => setFixing(null)} />}
      {msg && <p className={msg.ok ? undefined : "error-text"} role={msg.ok ? "status" : "alert"} style={{ margin: 0 }}>{msg.text}</p>}

      {(register.length > 0 || entries.length > 0) && (
        <section className="card pad stack" aria-label="Ledger and register">
          <h3 style={{ margin: 0 }}>Ledger and working register</h3>
          {rec.differences.length === 0 ? <p className="muted" style={{ margin: 0 }}>{register.some((r) => s(r.Status) === "current") ? `The ledger and the register agree (${rec.matches} holding${rec.matches === 1 ? "" : "s"}).` : "There is nothing in the working register to compare."}</p> : (
            <>
              <p style={{ margin: 0 }}>The ledger and the working register differ. Nothing has been changed.</p>
              <div className="table-wrap"><table className="grid" style={{ minWidth: 520 }}>
                <thead><tr><th scope="col">Holder</th><th scope="col">Class</th><th scope="col" style={{ textAlign: "right" }}>Register</th><th scope="col" style={{ textAlign: "right" }}>Ledger</th><th scope="col">What</th></tr></thead>
                <tbody>{rec.differences.map((d) => <tr key={d.holder + d.cls}><td>{d.holder}</td><td>{d.cls}</td><td style={{ textAlign: "right" }}>{d.register}</td><td style={{ textAlign: "right" }}>{d.ledger}</td><td>{d.kind === "register-only" ? "Only in the register" : d.kind === "ledger-only" ? "Only in the ledger" : "Different numbers"}</td></tr>)}</tbody>
              </table></div>
              {canEdit && rec.differences.some((d) => d.register > d.ledger) && <div><button type="button" className="btn" disabled={busy} onClick={() => void carryIn()}>Carry the register into the ledger as opening balances</button></div>}
            </>
          )}
        </section>
      )}

      <section className="card pad stack" aria-label="Ledger entries">
        <h3 style={{ margin: 0 }}>Ledger entries <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>{entries.length}</span></h3>
        {!entries.length ? <p className="muted" style={{ margin: 0 }}>No entries yet.</p> : (
          <div className="table-wrap"><table className="grid" style={{ minWidth: 760 }}>
            <thead><tr><th scope="col">Date</th><th scope="col">Entry</th><th scope="col">Class</th><th scope="col" style={{ textAlign: "right" }}>Shares</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Note</th><th scope="col"><span className="sr-only">Correct</span></th></tr></thead>
            <tbody>{[...entries].sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created)).map((e) => (
              <tr key={e.key} style={e.active ? undefined : { opacity: 0.55 }}>
                <td className="mono">{fmtDate(e.date)}</td><td>{ENTRY_LABEL[e.type]}{!e.active && <span className="chip" style={{ marginLeft: 6 }}>Corrected</span>}</td><td>{e.cls}</td><td style={{ textAlign: "right" }}>{e.number.toLocaleString("en-GB")}</td><td>{e.from}</td><td>{e.to}</td>
                <td style={{ fontSize: 12 }}>{e.supersedes ? `Corrects an earlier entry: ${e.reason}` : e.notes}{e.consideration ? ` Consideration: ${e.consideration}.` : ""}</td>
                <td>{e.active && canEdit && <button type="button" className="linkbtn" onClick={() => setFixing(e)}>Correct</button>}</td>
              </tr>))}</tbody>
          </table></div>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Entries are never edited or deleted. A correction adds a new entry that replaces the old one, with the reason, and the old entry stays visible.</p>
      </section>
    </div>
  );
}

function AddEntry({ client, entries, classes, onDone }: { client: Row; entries: Entry[]; classes: string[]; onDone: () => void }) {
  const k = useCoSec();
  const ck = s(client.Key);
  const [type, setType] = useState<EntryType>("opening");
  const [f, setF] = useState({ date: "", cls: classes[0] || "Ordinary", number: "", from: "", to: "", nominal: "", paid: "", premium: "", consideration: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const needsFrom = type === "transfer" || type === "redemption" || type === "cancellation";
  const needsTo = type === "transfer" || type === "opening" || type === "allotment" || type === "bonus";
  const holders = [...new Set(replay(entries).holdings.map((h) => h.name))];
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const e: NewEntry = { type, date: f.date, cls: f.cls, number: Number(f.number), from: needsFrom ? f.from : "", to: needsTo ? f.to : "", nominal: Number(f.nominal) || 0, paid: Number(f.paid) || 0, premium: Number(f.premium) || 0, consideration: f.consideration, notes: f.notes, idem: `ui:${ck}:${type}:${f.date}:${f.cls}:${f.number}:${f.from}:${f.to}:${f.consideration}` };
      const r = record(e, ck, entries, classes, k.me, now());
      if (r.skipped) throw new Error("That entry is already in the ledger.");
      if (r.error) throw new Error(r.error);
      await k.apply({ creates: [{ list: "CoSecLedger", row: r.row! }], patches: [], log: [], activities: [{ Key: newKey("A"), ClientKey: ck, Type: "cosec-flag", Title: `Share ledger: ${ENTRY_LABEL[type].toLowerCase()} of ${e.number} ${e.cls} shares`, Summary: [e.from && `From ${e.from}`, e.to && `to ${e.to}`, `effective ${fmtDate(e.date)}`].filter(Boolean).join(" "), At: now(), Actor: k.me, Source: "cosec", SourceKey: "ledger", EventKey: `ledger:${s(r.row!.Key)}`, Visibility: "normal", Created: now() }] });
      onDone();
    } catch (x) { setErr(say(x)); } finally { setBusy(false); }
  };
  return (
    <section className="card pad stack" aria-label="Add a ledger entry">
      <h3 style={{ margin: 0 }}>Add a ledger entry</h3>
      <div className="tl-form">
        <label className="doc-field"><span>Entry</span><select className="input" value={type} onChange={(e) => setType(e.target.value as EntryType)}>{TYPES.map((t) => <option key={t} value={t}>{ENTRY_LABEL[t]}</option>)}</select></label>
        <label className="doc-field"><span>Effective date</span><input className="input" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></label>
        <label className="doc-field"><span>Share class</span>{classes.length ? <select className="input" value={f.cls} onChange={(e) => set({ cls: e.target.value })}>{classes.map((c) => <option key={c}>{c}</option>)}</select> : <input className="input" value={f.cls} onChange={(e) => set({ cls: e.target.value })} />}</label>
        <label className="doc-field"><span>Number of shares</span><input className="input" inputMode="numeric" value={f.number} onChange={(e) => set({ number: e.target.value })} /></label>
        {needsFrom && <label className="doc-field"><span>{type === "transfer" ? "Transferor" : "Whose shares"}</span><input className="input" list="ledger-holders" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>}
        {needsTo && <label className="doc-field"><span>{type === "transfer" ? "Transferee" : "Receives the shares"}</span><input className="input" list="ledger-holders" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>}
        <label className="doc-field"><span>Nominal value each</span><input className="input" inputMode="decimal" value={f.nominal} onChange={(e) => set({ nominal: e.target.value })} /></label>
        <label className="doc-field"><span>Paid per share</span><input className="input" inputMode="decimal" value={f.paid} onChange={(e) => set({ paid: e.target.value })} /></label>
        <label className="doc-field"><span>Premium per share</span><input className="input" inputMode="decimal" value={f.premium} onChange={(e) => set({ premium: e.target.value })} /></label>
        <label className="doc-field"><span>Consideration</span><input className="input" value={f.consideration} onChange={(e) => set({ consideration: e.target.value })} placeholder="e.g. £100 cash, gift" /></label>
        <label className="doc-field" style={{ gridColumn: "1 / -1" }}><span>Notes</span><input className="input" value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
      </div>
      <datalist id="ledger-holders">{holders.map((h) => <option key={h} value={h} />)}</datalist>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>This records the corporate event in the ledger only. It does not prepare or send anything to Companies House.</p>
      {err && <p className="error-text" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div className="form-actions"><button type="button" className="btn" onClick={onDone} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Add to the ledger"}</button></div>
    </section>
  );
}

function Correct({ entry, rows, entries, onDone }: { entry: Entry; rows: Row[]; entries: Entry[]; onDone: () => void }) {
  const k = useCoSec();
  const [f, setF] = useState({ date: entry.date, cls: entry.cls, number: String(entry.number), from: entry.from, to: entry.to, reason: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const row = rows.find((r) => r.Key === entry.key)!;
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const rep: NewEntry = { type: entry.type, date: f.date, cls: f.cls, number: Number(f.number), from: f.from, fromKey: entry.fromKey, to: f.to, toKey: entry.toKey, currency: entry.currency, nominal: entry.nominal, paid: entry.paid, premium: entry.premium, consideration: entry.consideration, notes: entry.notes };
      const r = supersede(entry, row, rep, entries, k.me, now(), f.reason);
      if (r.error) throw new Error(r.error);
      await k.apply({ creates: [{ list: "CoSecLedger", row: r.row! }], patches: [{ list: "CoSecLedger", row, patch: r.patch! }], log: [], activities: [{ Key: newKey("A"), ClientKey: entry.clientKey, Type: "cosec-flag", Title: "Share ledger: an entry was corrected", Summary: f.reason, At: now(), Actor: k.me, Source: "cosec", SourceKey: "ledger", EventKey: `ledger:${s(r.row!.Key)}`, Visibility: "normal", Created: now() }] });
      onDone();
    } catch (x) { setErr(say(x)); } finally { setBusy(false); }
  };
  return (
    <section className="card pad stack" aria-label="Correct a ledger entry">
      <h3 style={{ margin: 0 }}>Correct this {ENTRY_LABEL[entry.type].toLowerCase()}</h3>
      <div className="tl-form">
        <label className="doc-field"><span>Effective date</span><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="doc-field"><span>Share class</span><input className="input" value={f.cls} onChange={(e) => setF({ ...f, cls: e.target.value })} /></label>
        <label className="doc-field"><span>Number of shares</span><input className="input" inputMode="numeric" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></label>
        {(entry.type === "transfer" || entry.type === "redemption" || entry.type === "cancellation") && <label className="doc-field"><span>From</span><input className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>}
        {entry.type !== "redemption" && entry.type !== "cancellation" && <label className="doc-field"><span>To</span><input className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>}
        <label className="doc-field" style={{ gridColumn: "1 / -1" }}><span>Reason for the correction (required)</span><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
      </div>
      {err && <p className="error-text" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div className="form-actions"><button type="button" className="btn" onClick={onDone} disabled={busy}>Cancel</button><button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>Record the correction</button></div>
    </section>
  );
}
