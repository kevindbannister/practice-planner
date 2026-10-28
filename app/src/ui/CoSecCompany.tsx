// One company's statutory records in Co Sec: its details (the planner's record beside what Companies House showed and what is
// waiting to be filed), officers, persons with significant control, shares, the printable registers and its filings.
import { useMemo, useState } from "react";
import { fmtDate } from "../lib/domain";
import { PENDING_TARGET, STATUS_LABEL, appointPerson, allotShares, changePerson, companyKind, isOpenTx, officersFromCh, pendingFor, pscsFromCh, terminatePerson, transferShares, txStatus, verifiedFrom, verifiedOf } from "../lib/cosec";
import { OFFICER_ROLES, PSC_KINDS, officerName, pscName } from "../lib/cosecForms";
import { chNumber } from "../lib/companiesHouse";
import { Row } from "../lib/schema";
import { href } from "./bits";
import { useCompaniesHouse } from "./CompaniesHouse";
import { useCoSec } from "./cosecKit";
import { useData } from "./data";
import { newKey } from "../lib/planning";
import { chipFor } from "./CoSecPage";
import { Ledger, LevelChip, ServiceLevel } from "./CoSecFoundation";
import { ImportHistory, RegistersTab } from "./CoSecImport";

const TABS: [string, string][] = [["details", "Details"], ["officers", "Officers"], ["shares", "Shareholders"], ["classes", "Share classes"], ["ledger", "Share ledger"], ["pscs", "People with significant control"], ["registers", "Registers"], ["import", "Import history"], ["filings", "Filings"]];
const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export function CoSecCompany({ clientKey, tab }: { clientKey: string; tab: string }) {
  const k = useCoSec();
  const client = k.data.clients.find((c) => c.Key === clientKey);
  if (!client) return <div className="card empty"><p>That company isn't here. <a href="#/cosec/companies">Back to companies</a></p></div>;
  const kind = companyKind(client);
  if (!kind) return <div className="card empty"><p>{s(client.Title)} isn't a company or LLP, so it has no statutory record in Co Sec.</p></div>;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{s(client.Title)} <span className="muted">{s(client.CompanyNumber)} · {kind === "llp" ? "LLP" : "Limited company"}</span> <LevelChip client={client} /></h2>
        <a href={href("clients", clientKey)}>Open the client record</a>
      </div>
      <nav className="subtabs" aria-label="Company views">
        {TABS.filter(([key]) => (key !== "shares" && key !== "classes" && key !== "ledger") || kind === "limited").map(([key, label]) => <a key={key} href={`#/cosec/company/${clientKey}/${key}`} aria-current={tab === key ? "page" : undefined}>{label}</a>)}
      </nav>
      {tab === "details" && <><ServiceLevel client={client} /><Details client={client} /></>}
      {tab === "officers" && <People client={client} entity="officer" />}
      {tab === "pscs" && <People client={client} entity="psc" />}
      {tab === "shares" && kind === "limited" && <Shares client={client} />}
      {tab === "classes" && kind === "limited" && <ShareClasses client={client} />}
      {tab === "ledger" && kind === "limited" && <Ledger client={client} />}
      {tab === "registers" && <RegistersTab client={client} />}
      {tab === "import" && <ImportHistory client={client} />}
      {tab === "filings" && <Filings client={client} />}
    </div>
  );
}

function Pending({ client, target }: { client: Row; target: string }) {
  const k = useCoSec();
  const open = pendingFor(k.data.cosecTx, s(client.Key), target);
  if (!open.length) return null;
  return <a className="chip amber" href={href("cosec", "filing", s(open[0].Key))} title="A filing is waiting. Companies House has not been updated.">Pending Co Sec review</a>;
}

function Details({ client }: { client: Row }) {
  const k = useCoSec();
  const ch = useCompaniesHouse();
  const v = verifiedOf(client);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [edit, setEdit] = useState<{ RegisteredOffice: string; CorrespondenceAddress: string } | null>(null);
  const run = async (what: () => Promise<string>) => { setBusy(true); setMsg(undefined); try { setMsg({ ok: true, text: await what() }); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't work." }); } finally { setBusy(false); } };
  const checkNow = () => run(async () => {
    const num = chNumber(client as any);
    const profile = await ch.get(`company/${num}`);
    const seen = verifiedFrom(profile, new Date().toISOString());
    await k.update("Clients", client, { CHVerified: JSON.stringify(seen) }, { source: "ch-sync" });
    const found = await k.scan();
    return found ? `Checked. ${found} difference${found === 1 ? "" : "s"} from the planner's record: draft${found === 1 ? "" : "s"} prepared.` : "Checked. Companies House agrees with the planner's record, or the differences are already being dealt with.";
  });
  const importPeople = () => run(async () => {
    const num = chNumber(client as any);
    const [o, p] = await Promise.all([ch.get(`company/${num}/officers?items_per_page=100`), ch.get(`company/${num}/persons-with-significant-control?items_per_page=100`)]);
    const c = k.ctx();
    const off = officersFromCh(client, o, k.data.cosecOfficers, c), pscs = pscsFromCh(client, p, k.data.cosecPscs, c);
    await k.apply({ patches: [], log: [], activities: [], creates: [...off.map((row) => ({ list: "CoSecOfficers" as const, row })), ...pscs.map((row) => ({ list: "CoSecPscs" as const, row }))] });
    return off.length + pscs.length ? `Brought in ${off.length} officer${off.length === 1 ? "" : "s"} and ${pscs.length} person${pscs.length === 1 ? "" : "s"} with significant control. Their residential addresses are not public: add them by hand.` : "Nothing new to bring in.";
  });
  const saveAddresses = () => run(async () => {
    if (!edit) return "";
    const patch: Row = {};
    if (edit.RegisteredOffice.trim() !== s(client.RegisteredOffice).trim()) patch.RegisteredOffice = edit.RegisteredOffice.trim();
    if (edit.CorrespondenceAddress.trim() !== s(client.CorrespondenceAddress).trim()) patch.CorrespondenceAddress = edit.CorrespondenceAddress.trim();
    if (!Object.keys(patch).length) { setEdit(null); return "No changes."; }
    await k.update("Clients", client, patch);
    setEdit(null);
    return patch.RegisteredOffice !== undefined ? "Saved. A change of registered office is prepared in Filings for review. It has not been sent to Companies House." : "Saved. A correspondence address isn't a statutory address, so nothing needs filing.";
  });
  const row = (label: string, planner: string, official: string | undefined, target?: string) => (
    <tr><th scope="row">{label}</th><td>{planner || <span className="muted">Not recorded</span>} {target && <Pending client={client} target={target} />}</td><td>{official ?? <span className="muted">Not checked</span>}</td></tr>
  );
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad stack" aria-label="Company details">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Details</h3>
          <div className="row-wrap">
            <button type="button" className="btn" disabled={busy || !k.can("edit")} onClick={checkNow}>{busy ? "Working…" : "Check Companies House now"}</button>
            <button type="button" className="btn" disabled={busy || !k.can("edit")} onClick={importPeople}>Bring in officers and PSCs from Companies House</button>
          </div>
        </div>
        <p className="muted" style={{ margin: 0 }}>The planner's record and Companies House's are kept apart. Changing an address here does not change Companies House: a filing is prepared and waits for approval. {v.at ? `Companies House last checked ${fmtDate(v.at.slice(0, 10))}.` : "Companies House hasn't been checked yet."}</p>
        <div className="table-wrap"><table className="grid" style={{ minWidth: 560 }}>
          <thead><tr><th scope="col">Detail</th><th scope="col">In the planner</th><th scope="col">Companies House (last checked)</th></tr></thead>
          <tbody>
            {row("Company name", s(client.Title), v.at ? v.name : undefined, PENDING_TARGET.Title)}
            {row("Registered office", s(client.RegisteredOffice), v.at ? v.office : undefined, PENDING_TARGET.RegisteredOffice)}
            {row("Accounting reference date", s(client.YearEnd), v.at ? v.ard : undefined, PENDING_TARGET.YearEnd)}
            {row("SIC codes", s(client.SIC), v.at ? v.sic : undefined)}
            <tr><th scope="row">Trading address</th><td>{s(client.TradingAddress) || <span className="muted">Not recorded</span>}</td><td className="muted">Not held by Companies House</td></tr>
            <tr><th scope="row">Correspondence address</th><td>{s(client.CorrespondenceAddress) || <span className="muted">Not recorded</span>}</td><td className="muted">Not held by Companies House</td></tr>
          </tbody>
        </table></div>
        {edit ? (
          <div className="stack" style={{ gap: 8 }}>
            <label className="doc-field"><span>Registered office (a change prepares an AD01 for review)</span><textarea className="input" rows={2} value={edit.RegisteredOffice} onChange={(e) => setEdit({ ...edit, RegisteredOffice: e.target.value })} /></label>
            <label className="doc-field"><span>Correspondence address (not a statutory address)</span><textarea className="input" rows={2} value={edit.CorrespondenceAddress} onChange={(e) => setEdit({ ...edit, CorrespondenceAddress: e.target.value })} /></label>
            <div className="row-wrap"><button type="button" className="btn primary" disabled={busy} onClick={saveAddresses}>Save</button><button type="button" className="btn" onClick={() => setEdit(null)}>Cancel</button></div>
          </div>
        ) : <div><button type="button" className="btn" disabled={!k.can("edit")} onClick={() => setEdit({ RegisteredOffice: s(client.RegisteredOffice), CorrespondenceAddress: s(client.CorrespondenceAddress) })}>Change an address</button></div>}
        {msg && <p role={msg.ok ? "status" : "alert"} style={{ margin: 0, color: msg.ok ? "var(--green)" : "var(--red-ink)" }}>{msg.text}</p>}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ officers and PSCs

function People({ client, entity }: { client: Row; entity: "officer" | "psc" }) {
  const k = useCoSec();
  const isOff = entity === "officer";
  const list = (isOff ? k.data.cosecOfficers : k.data.cosecPscs).filter((x) => x.ClientKey === client.Key);
  const [adding, setAdding] = useState<Row | null>(null);
  const [ending, setEnding] = useState<{ row: Row; date: string } | null>(null);
  const [changing, setChanging] = useState<{ row: Row; changes: Row } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  const nameOf = isOff ? officerName : pscName;
  const go = async (what: () => Promise<{ text: string } | { error: string }>) => {
    setBusy(true); setMsg(undefined);
    try { const r = await what(); if ("error" in r) setMsg({ ok: false, text: r.error }); else { setMsg({ ok: true, text: r.text }); setAdding(null); setEnding(null); setChanging(null); } }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't save." }); } finally { setBusy(false); }
  };
  const done = (w: any, what: string) => ("error" in w ? w : k.apply(w).then(() => ({ text: `${what} A draft filing is in Filings for review. It has not been sent to Companies House.` })));
  const fields: [string, string][] = isOff
    ? [["Title", "Title"], ["First", "First names"], ["Last", "Last name"], ["CorporateName", "Corporate name"], ["DOB", "Date of birth (YYYY-MM-DD)"], ["Nationality", "Nationality"], ["Occupation", "Occupation"], ["CountryOfResidence", "Country of residence"], ["ServiceAddress", "Service address"], ["ResidentialAddress", "Residential address"], ["AppointedOn", "Appointed on"]]
    : [["Title", "Title"], ["First", "First names"], ["Last", "Last name"], ["CorporateName", "Corporate name"], ["DOB", "Date of birth (YYYY-MM-DD)"], ["Nationality", "Nationality"], ["CountryOfResidence", "Country of residence"], ["ServiceAddress", "Service address"], ["ResidentialAddress", "Residential address"], ["Natures", "Nature of control"], ["NotifiedOn", "Notified on"]];
  const editable = isOff ? ["Title", "First", "Last", "CorporateName", "Nationality", "Occupation", "CountryOfResidence", "ServiceAddress", "ResidentialAddress"] : ["Title", "First", "Last", "CorporateName", "Nationality", "CountryOfResidence", "ServiceAddress", "ResidentialAddress"];
  const label = (f: string) => fields.find(([x]) => x === f)?.[1] || f;
  return (
    <section className="card pad stack" aria-label={isOff ? "Officers" : "People with significant control"}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{isOff ? "Directors, secretaries and members" : "People with significant control"}</h3>
        <button type="button" className="btn" disabled={!k.can("edit")} onClick={() => setAdding(isOff ? { Role: companyKind(client) === "llp" ? "member" : "director", Kind: "individual" } : { Kind: "individual" })}>{isOff ? "Appoint someone" : "Add a PSC"}</button>
      </div>
      <div className="table-wrap"><table className="grid" style={{ minWidth: 620 }}>
        <thead><tr><th scope="col">Name</th>{isOff && <th scope="col">Role</th>}<th scope="col">Status</th><th scope="col">{isOff ? "Appointed" : "Notified"}</th><th scope="col">Linked to</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{list.length ? list.map((x) => {
          const open = pendingFor(k.data.cosecTx, s(client.Key)).filter((t) => { try { return JSON.parse(s(t.Payload)).who === x.Key; } catch { return false; } });
          return (
            <tr key={s(x.Key)}>
              <td>{nameOf(x)}</td>{isOff && <td>{OFFICER_ROLES.find(([r]) => r === x.Role)?.[1] || s(x.Role)}</td>}
              <td>{s(x.Status) === "current" ? "Current" : s(x.Status) === "pending" ? <span className="chip amber">Pending filing</span> : s(x.Status) === "resigned" || s(x.Status) === "ceased" ? `Ended ${fmtDate(s(x.ResignedOn || x.CeasedOn))}` : s(x.Status)}{open.length > 0 && s(x.Status) === "current" && <> <a className="chip amber" href={href("cosec", "filing", s(open[0].Key))}>Pending Co Sec review</a></>}</td>
              <td>{fmtDate(s(x.AppointedOn || x.NotifiedOn))}</td>
              <td><PersonLink row={x} /></td>
              <td>{s(x.Status) === "current" && k.can("edit") && <div className="row-wrap"><button type="button" className="linkbtn" onClick={() => setChanging({ row: x, changes: {} })}>Change details</button><button type="button" className="linkbtn" onClick={() => setEnding({ row: x, date: "" })}>{isOff ? "End appointment" : "Ceased"}</button></div>}</td>
            </tr>);
        }) : <tr><td colSpan={6} className="muted">None recorded. Bring them in from Companies House on the Details tab, or add one.</td></tr>}</tbody>
      </table></div>

      {adding && (
        <div className="card pad stack" role="group" aria-label={isOff ? "Appoint" : "Add a PSC"}>
          <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
            {isOff && <label className="doc-field"><span>Role</span><select className="input" value={s(adding.Role)} onChange={(e) => setAdding({ ...adding, Role: e.target.value })}>{OFFICER_ROLES.filter(([r]) => (companyKind(client) === "llp") === (r === "member")).map(([r, l]) => <option key={r} value={r}>{l}</option>)}</select></label>}
            <label className="doc-field"><span>{isOff ? "Person or company" : "Type"}</span>
              <select className="input" value={s(adding.Kind)} onChange={(e) => setAdding({ ...adding, Kind: e.target.value })}>
                {isOff ? <><option value="individual">Individual</option><option value="corporate">Corporate</option></> : PSC_KINDS.map(([r, l]) => <option key={r} value={r}>{l}</option>)}
              </select></label>
            {fields.map(([f, l]) => <label key={f} className="doc-field"><span>{l}</span><input className="input" type={f === "AppointedOn" || f === "NotifiedOn" ? "date" : "text"} value={s(adding[f])} onChange={(e) => setAdding({ ...adding, [f]: e.target.value })} /></label>)}
            <label className="doc-field"><span>Linked to a client record (their own, if they are a client)</span>
              <select className="input" value={s(adding.PersonClientKey)} onChange={(e) => setAdding({ ...adding, PersonClientKey: e.target.value })}><option value="">Not linked</option>{k.data.clients.filter((c) => c.Kind === "Individual" || !c.Kind).map((c) => <option key={s(c.Key)} value={s(c.Key)}>{s(c.Title)}</option>)}</select></label>
          </div>
          <div className="row-wrap"><button type="button" className="btn primary" disabled={busy} onClick={() => go(async () => done(appointPerson(client, entity, adding, k.snap(), k.can("edit"), k.ctx()), "Recorded as pending."))}>Prepare the filing</button><button type="button" className="btn" onClick={() => setAdding(null)}>Cancel</button></div>
        </div>
      )}
      {ending && (
        <div className="card pad row-wrap" role="group" aria-label="End" style={{ alignItems: "end" }}>
          <label className="doc-field"><span>{nameOf(ending.row)}: date it ended</span><input className="input" type="date" value={ending.date} onChange={(e) => setEnding({ ...ending, date: e.target.value })} /></label>
          <button type="button" className="btn primary" disabled={busy} onClick={() => go(async () => done(terminatePerson(client, entity, ending.row, ending.date, k.snap(), k.can("edit"), k.ctx()), "Termination recorded."))}>Prepare the filing</button>
          <button type="button" className="btn" onClick={() => setEnding(null)}>Cancel</button>
        </div>
      )}
      {changing && (
        <div className="card pad stack" role="group" aria-label="Change details">
          <strong>{nameOf(changing.row)}</strong>
          <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
            {editable.map((f) => <label key={f} className="doc-field"><span>{label(f)}</span><input className="input" value={s(changing.changes[f] ?? changing.row[f])} onChange={(e) => setChanging({ ...changing, changes: { ...changing.changes, [f]: e.target.value } })} /></label>)}
          </div>
          <div className="row-wrap"><button type="button" className="btn primary" disabled={busy} onClick={() => go(async () => done(changePerson(client, entity, changing.row, changing.changes, k.snap(), k.can("edit"), k.ctx()), "Change recorded."))}>Prepare the filing</button><button type="button" className="btn" onClick={() => setChanging(null)}>Cancel</button></div>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} style={{ margin: 0, color: msg.ok ? "var(--green)" : "var(--red-ink)" }}>{msg.text}</p>}
    </section>
  );
}
function PersonLink({ row }: { row: Row }) {
  const k = useCoSec();
  const c = row.PersonClientKey ? k.data.clients.find((x) => x.Key === row.PersonClientKey) : undefined;
  return c ? <a href={href("clients", s(c.Key))}>{s(c.Title)}</a> : <span className="muted">Not linked</span>;
}

// ------------------------------------------------------------------ shares

function Shares({ client }: { client: Row }) {
  const k = useCoSec();
  const list = k.data.cosecShares.filter((x) => x.ClientKey === client.Key);
  const [a, setA] = useState<Row | null>(null);
  const [t, setT] = useState<{ from: Row; to: string; toKey?: string; number: string; date: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  const total = list.filter((x) => x.Status === "current").reduce((n, x) => n + (Number(x.Number) || 0), 0);
  const classes = k.data.cosecShareClasses.filter((x) => x.ClientKey === client.Key && x.Status !== "former");
  const go = async (what: () => Promise<{ text: string } | { error: string }>) => { setBusy(true); setMsg(undefined); try { const r = await what(); if ("error" in r) setMsg({ ok: false, text: r.error }); else { setMsg({ ok: true, text: r.text }); setA(null); setT(null); } } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't save." }); } finally { setBusy(false); } };
  return (
    <section className="card pad stack" aria-label="Shares">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Shareholders <span className="muted">{total.toLocaleString("en-GB")} shares in issue</span></h3>
        <button type="button" className="btn" disabled={!k.can("edit") || !classes.length} title={classes.length ? undefined : "Set up a share class first"} onClick={() => { const c = classes[0]; setA({ Class: s(c.Name), Currency: s(c.Currency) || "GBP", NominalValue: s(c.NominalValue) || "1", PaidPerShare: s(c.NominalValue) || "1", Date: new Date().toISOString().slice(0, 10) }); }}>Allot shares</button>
      </div>
      {!classes.length && <p className="alert amber" role="status" style={{ margin: 0 }}>Shares can't be allotted until a share class is set up. <a href={`#/cosec/company/${s(client.Key)}/classes`}>Set up share classes</a></p>}
      <div className="table-wrap"><table className="grid" style={{ minWidth: 620 }}>
        <thead><tr><th scope="col">Holder</th><th scope="col">Class</th><th scope="col">Shares</th><th scope="col">Nominal</th><th scope="col">Status</th><th scope="col">From</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{list.length ? list.map((x) => (
          <tr key={s(x.Key)}><td>{s(x.Holder)}</td><td>{s(x.Class)}</td><td>{Number(x.Number).toLocaleString("en-GB")}</td><td>{s(x.Currency)} {s(x.NominalValue)}</td>
            <td>{x.Status === "pending" ? <span className="chip amber">Pending filing</span> : x.Status === "current" ? "Current" : `Former (to ${fmtDate(s(x.To))})`}</td><td>{fmtDate(s(x.From))}</td>
            <td>{x.Status === "current" && k.can("edit") && <button type="button" className="linkbtn" onClick={() => setT({ from: x, to: "", number: s(x.Number), date: new Date().toISOString().slice(0, 10) })}>Transfer</button>}</td></tr>
        )) : <tr><td colSpan={7} className="muted">No shareholders recorded yet.</td></tr>}</tbody>
      </table></div>
      {a && (
        <div className="card pad stack" role="group" aria-label="Allot shares">
          <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
            <div className="doc-field" style={{ gridColumn: "1 / -1" }}>
              <span>Shares go to</span>
              <HolderPicker company={client} value={s(a.Holder)} valueKey={s(a.HolderKey)} onPick={(name, key) => setA({ ...a, Holder: name, HolderKey: key })} />
            </div>
            <label className="doc-field"><span>Class</span>
              <select className="input" value={s(a.Class)} onChange={(e) => { const c = classes.find((x) => s(x.Name) === e.target.value); setA({ ...a, Class: e.target.value, Currency: s(c?.Currency) || s(a.Currency), NominalValue: s(c?.NominalValue) || s(a.NominalValue) }); }}>
                {classes.map((c) => <option key={s(c.Key)} value={s(c.Name)}>{s(c.Name)}</option>)}
              </select>
            </label>
            {[["Number", "Number of shares"], ["Currency", "Currency"], ["NominalValue", "Nominal value each"], ["PaidPerShare", "Paid per share"]].map(([f, l]) => <label key={f} className="doc-field"><span>{l}</span><input className="input" value={s(a[f])} onChange={(e) => setA({ ...a, [f]: e.target.value })} /></label>)}
            <label className="doc-field"><span>Date of allotment</span><input className="input" type="date" value={s(a.Date)} onChange={(e) => setA({ ...a, Date: e.target.value })} /></label>
          </div>
          <div className="row-wrap"><button type="button" className="btn primary" disabled={busy} onClick={() => go(async () => { const r: any = allotShares(client, { holder: s(a.Holder), holderKey: s(a.HolderKey), class: s(a.Class), number: Number(a.Number), currency: s(a.Currency), nominal: Number(a.NominalValue), paid: Number(a.PaidPerShare), date: s(a.Date) }, k.snap(), k.can("edit"), k.ctx()); if ("error" in r) return r; await k.apply(r); return { text: "Allotment recorded as pending. An SH01 is in Filings for review. It has not been sent to Companies House." }; })}>Prepare the filing</button><button type="button" className="btn" onClick={() => setA(null)}>Cancel</button></div>
        </div>
      )}
      {t && (
        <div className="card pad row-wrap" role="group" aria-label="Transfer shares" style={{ alignItems: "end" }}>
          <div className="doc-field" style={{ minWidth: 260 }}><span>From {s(t.from.Holder)}: transfer to</span><HolderPicker company={client} value={t.to} valueKey={t.toKey} onPick={(name, key) => setT({ ...t, to: name, toKey: key })} /></div>
          <label className="doc-field"><span>Shares</span><input className="input" style={{ width: 110 }} value={t.number} onChange={(e) => setT({ ...t, number: e.target.value })} /></label>
          <label className="doc-field"><span>Date</span><input className="input" type="date" value={t.date} onChange={(e) => setT({ ...t, date: e.target.value })} /></label>
          <button type="button" className="btn primary" disabled={busy} onClick={() => go(async () => { const r: any = transferShares(client, t.from, { holder: t.to, holderKey: t.toKey }, Number(t.number), t.date, k.can("edit"), k.ctx()); if ("error" in r) return r; await k.apply(r); return { text: "Transfer recorded in the register. Check the next confirmation statement." }; })}>Record the transfer</button>
          <button type="button" className="btn" onClick={() => setT(null)}>Cancel</button>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} style={{ margin: 0, color: msg.ok ? "var(--green)" : "var(--red-ink)" }}>{msg.text}</p>}
    </section>
  );
}

/** Pick who shares go to from the client database: this company's directors and people with significant control first, then everyone else, with a filter. */
function HolderPicker({ company, value, valueKey, onPick }: { company: Row; value: string; valueKey?: string; onPick: (name: string, key: string) => void }) {
  const k = useCoSec();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const options = useMemo(() => {
    const ck = s(company.Key);
    const seen = new Set<string>();
    const out: { key: string; name: string; tag: string }[] = [];
    const add = (key: string, name: string, tag: string) => { const id = key || `n:${name.toLowerCase()}`; if (!name || seen.has(id)) return; seen.add(id); out.push({ key, name, tag }); };
    for (const o of k.data.cosecOfficers.filter((x) => x.ClientKey === ck && x.Status === "current")) add(s(o.PersonClientKey), officerName(o), s(o.Role) || "Director");
    for (const p of k.data.cosecPscs.filter((x) => x.ClientKey === ck && x.Status === "current")) add(s(p.PersonClientKey), pscName(p), "Significant control");
    const rest = k.data.clients.filter((c) => c.Key !== ck && s(c.Kind) !== "").map((c) => ({ key: s(c.Key), name: s(c.Title), tag: s(c.Kind) === "Individual" ? "Client" : "Client (company)" })).sort((a, b) => a.name.localeCompare(b.name));
    for (const r of rest) add(r.key, r.name, r.tag);
    return out;
  }, [k.data.cosecOfficers, k.data.cosecPscs, k.data.clients, company.Key]);
  const needle = q.trim().toLowerCase();
  const shown = (needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options).slice(0, 12);
  return (
    <div style={{ position: "relative" }}>
      <input className="input" role="combobox" aria-expanded={open} aria-label="Search the client database" placeholder={value ? `${value}${valueKey ? " (in client database)" : ""}` : "Search clients, directors first"} value={open ? q : value} onFocus={() => { setOpen(true); setQ(""); }} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && (
        <ul role="listbox" className="card" style={{ position: "absolute", zIndex: 20, left: 0, right: 0, margin: "4px 0 0", padding: 4, listStyle: "none", maxHeight: 260, overflow: "auto", background: "#fff", boxShadow: "0 8px 24px rgba(15,40,70,.18)" }}>
          {shown.map((o) => (
            <li key={o.key || o.name} role="option" aria-selected={o.key === valueKey && o.name === value}>
              <button type="button" className="linkbtn" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", minHeight: 0, padding: "6px 8px", textAlign: "left" }} onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(o.name, o.key); setOpen(false); }}>
                <span>{o.name}</span><span className="muted" style={{ fontSize: 12 }}>{o.tag}</span>
              </button>
            </li>
          ))}
          {!shown.length && <li className="muted" style={{ padding: "6px 8px" }}>No match in the client database.</li>}
          {needle && !options.some((o) => o.name.toLowerCase() === needle) && (
            <li><button type="button" className="linkbtn" style={{ minHeight: 0, padding: "6px 8px" }} onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(q.trim(), ""); setOpen(false); }}>Use "{q.trim()}" (not in the client database)</button></li>
          )}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ share classes

function ShareClasses({ client }: { client: Row }) {
  const k = useCoSec();
  const { create, update } = useData();
  const [showFormer, setShowFormer] = useState(false);
  const [f, setF] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const all = k.data.cosecShareClasses.filter((x) => x.ClientKey === client.Key);
  const list = all.filter((x) => showFormer ? x.Status === "former" : x.Status !== "former");
  const holdings = k.data.cosecShares.filter((x) => x.ClientKey === client.Key && x.Status === "current");
  const usedNames = [...new Set(holdings.map((h) => s(h.Class)).filter(Boolean))].filter((n) => !all.some((c) => s(c.Name).toLowerCase() === n.toLowerCase()));
  const stats = (name: string) => { const h = holdings.filter((x) => s(x.Class).toLowerCase() === name.toLowerCase()); return { shares: h.reduce((n, x) => n + (Number(x.Number) || 0), 0), holders: new Set(h.map((x) => s(x.HolderKey) || s(x.Holder))).size }; };
  const now = () => new Date().toISOString();
  const save = async () => {
    if (!f) return;
    const name = s(f.Name).trim();
    if (!name) return setMsg({ ok: false, text: "Give the share class a name, for example Ordinary £1.00." });
    if (all.some((c) => c.Key !== f.Key && s(c.Name).toLowerCase() === name.toLowerCase())) return setMsg({ ok: false, text: "This company already has a share class with that name." });
    setBusy(true); setMsg(undefined);
    try {
      const fields = { Name: name, Currency: s(f.Currency) || "GBP", NominalValue: Number(f.NominalValue) || 1, Rights: s(f.Rights), Updated: now() };
      if (f.Key) await update("CoSecShareClasses", all.find((c) => c.Key === f.Key)!, fields);
      else await create("CoSecShareClasses", { Key: newKey("SC"), PracticeId: k.ctx().pid, ClientKey: s(client.Key), ...fields, Status: "current", Created: now() });
      setF(null);
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't save." }); } finally { setBusy(false); }
  };
  const fromHoldings = async () => {
    setBusy(true); setMsg(undefined);
    try {
      for (const n of usedNames) {
        const h = holdings.find((x) => s(x.Class) === n);
        await create("CoSecShareClasses", { Key: newKey("SC"), PracticeId: k.ctx().pid, ClientKey: s(client.Key), Name: n, Currency: s(h?.Currency) || "GBP", NominalValue: Number(h?.NominalValue) || 1, Rights: "", Status: "current", Created: now(), Updated: now() });
      }
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't save." }); } finally { setBusy(false); }
  };
  const setStatus = async (row: Row, status: "current" | "former") => {
    if (status === "former" && stats(s(row.Name)).shares > 0) return setMsg({ ok: false, text: "This class still has shares in issue, so it can't be marked former." });
    setMsg(undefined);
    try { await update("CoSecShareClasses", row, { Status: status, Updated: now() }); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't save." }); }
  };
  return (
    <section className="card pad stack" aria-label="Share classes">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Share classes</h3>
        <span className="row-wrap">
          <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={showFormer} onChange={(e) => setShowFormer(e.target.checked)} /> Former</label>
          <button type="button" className="btn" disabled={!k.can("edit")} onClick={() => setF({ Name: "", Currency: "GBP", NominalValue: "1", Rights: "" })}>Add share class</button>
        </span>
      </div>
      {!all.length && <p className="alert amber" role="status" style={{ margin: 0 }}>No share classes yet. Set one up before allotting shares.{usedNames.length > 0 && <> This company already has holdings in {usedNames.join(", ")}. <button type="button" className="linkbtn" disabled={busy || !k.can("edit")} onClick={() => void fromHoldings()}>Create {usedNames.length === 1 ? "that class" : "those classes"} from the holdings</button></>}</p>}
      {all.length > 0 && usedNames.length > 0 && <p className="muted" style={{ margin: 0 }}>Holdings exist in {usedNames.join(", ")}, which isn't set up as a class. <button type="button" className="linkbtn" disabled={busy} onClick={() => void fromHoldings()}>Create it</button></p>}
      <div className="table-wrap"><table className="grid" style={{ minWidth: 560 }}>
        <thead><tr><th scope="col">Share class</th><th scope="col">Number of shares</th><th scope="col">Number of holders</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{list.length ? list.map((c) => { const st = stats(s(c.Name)); return (
          <tr key={s(c.Key)}>
            <td>{s(c.Name)}{c.Rights ? <div className="cell-sub">{s(c.Rights)}</div> : null}<div className="cell-sub">{s(c.Currency)} {s(c.NominalValue)} nominal</div></td>
            <td>{st.shares.toLocaleString("en-GB")}</td><td>{st.holders}</td>
            <td>{c.Status === "former" ? "Former" : "Current"}</td>
            <td>{k.can("edit") && <span className="row-wrap" style={{ gap: 8 }}>
              <button type="button" className="linkbtn" onClick={() => setF({ ...c })}>Edit</button>
              {c.Status === "former" ? <button type="button" className="linkbtn" onClick={() => void setStatus(c, "current")}>Reinstate</button> : <button type="button" className="linkbtn" onClick={() => void setStatus(c, "former")}>Mark former</button>}
            </span>}</td>
          </tr>); }) : <tr><td colSpan={5} className="muted">{showFormer ? "No former share classes." : "None."}</td></tr>}</tbody>
      </table></div>
      {f && (
        <div className="card pad stack" role="group" aria-label={f.Key ? "Edit share class" : "Add share class"}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
            <label className="doc-field"><span>Name</span><input className="input" placeholder="Ordinary £1.00" value={s(f.Name)} onChange={(e) => setF({ ...f, Name: e.target.value })} /></label>
            <label className="doc-field"><span>Currency</span><input className="input" value={s(f.Currency)} onChange={(e) => setF({ ...f, Currency: e.target.value })} /></label>
            <label className="doc-field"><span>Nominal value each</span><input className="input" value={s(f.NominalValue)} onChange={(e) => setF({ ...f, NominalValue: e.target.value })} /></label>
            <label className="doc-field" style={{ gridColumn: "1 / -1" }}><span>Rights (optional)</span><input className="input" placeholder="Voting, dividend and capital rights" value={s(f.Rights)} onChange={(e) => setF({ ...f, Rights: e.target.value })} /></label>
          </div>
          <div className="row-wrap"><button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>Save share class</button><button type="button" className="btn" onClick={() => { setF(null); setMsg(undefined); }}>Cancel</button></div>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} style={{ margin: 0, color: msg.ok ? "var(--green)" : "var(--red-ink)" }}>{msg.text}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ registers and filings

function Filings({ client }: { client: Row }) {
  const k = useCoSec();
  const rows = useMemo(() => k.data.cosecTx.filter((t) => t.ClientKey === client.Key).sort((a, b) => s(b.Created).localeCompare(s(a.Created))), [k.data.cosecTx, client.Key]);
  return (
    <section className="card pad stack" aria-label="Company filings">
      <h3 style={{ margin: 0 }}>Filings</h3>
      {!rows.length ? <p className="muted">No filings prepared for this company.</p> : <ul className="plain">{rows.map((t) => (
        <li key={s(t.Key)}><a href={href("cosec", "filing", s(t.Key))}>{s(t.Ref)} · {s(t.Form)} · {s(t.Title)}</a> <span className={`chip ${chipFor(txStatus(t))}`}>{STATUS_LABEL[txStatus(t)]}</span></li>
      ))}</ul>}
    </section>
  );
}
export { isOpenTx };
