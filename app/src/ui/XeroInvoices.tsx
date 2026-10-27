// The client's Invoices tab: what the practice has billed this client, read from the practice's own
// Xero organisation (Settings › Xero marks which one that is). Read only: raise, edit and email
// invoices in Xero. Only the choice of which Xero contact is this client is saved here.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Client, fmtDate, todayIso } from "../lib/domain";
import { XeroError } from "../lib/xero";
import { InvoiceFilter, InvoiceRow, InvoiceState, STATE_CHIP, STATE_LABEL, XeroContact, ageLabel, contactUrl, fetchInvoices, filterInvoices, findContacts, money, pickContact, summarise } from "../lib/xeroInvoices";
import { href } from "./bits";
import { readSetting, useData } from "./data";
import { useXero, useXeroLinks } from "./XeroSettings";

type Linked = Record<string, { id: string; name: string }>;
const FILTERS: { key: InvoiceFilter["state"]; label: string }[] = [{ key: "all", label: "All" }, { key: "open", label: "Unpaid" }, { key: "overdue", label: "Overdue" }, { key: "paid", label: "Paid" }, { key: "draft", label: "Draft" }];

export function XeroInvoices({ client }: { client: Client }) {
  const { data, saveSetting } = useData();
  const xero = useXero();
  const { practice, connected } = useXeroLinks();
  const today = todayIso();
  const contacts = readSetting<Linked>(data.settings, "xero.contacts") || {};
  const contact = contacts[client.Key];
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [options, setOptions] = useState<XeroContact[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [state, setState] = useState<InvoiceFilter["state"]>("all");
  const [months, setMonths] = useState(0);
  const [q, setQ] = useState("");

  const say = (e: unknown) => (e instanceof XeroError ? e.message : "Xero didn't answer. Try again.");
  const link = useCallback(async (c: XeroContact | undefined) => {
    const next = { ...contacts };
    if (c) next[client.Key] = { id: c.id, name: c.name }; else delete next[client.Key];
    await saveSetting("xero.contacts", next);
    setRows(null); setOptions(null);
  }, [contacts, client.Key, saveSetting]);

  // find the client's contact in Xero the first time, and link it when the match is clear
  useEffect(() => {
    if (!practice || contact || options) return;
    let live = true;
    setBusy("Looking for this client in Xero…"); setError("");
    findContacts(xero, practice.tenantId, client.Title).then((found) => {
      if (!live) return;
      const one = pickContact(client.Title, found);
      if (one) void link(one); else setOptions(found);
    }).catch((e) => live && setError(say(e))).finally(() => live && setBusy(""));
    return () => { live = false; };
  }, [practice?.tenantId, contact?.id, client.Key]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!practice || !contact) return;
    setBusy("Reading invoices from Xero…"); setError("");
    try { setRows(await fetchInvoices(xero, practice, contact.id, today)); } catch (e) { setError(say(e)); } finally { setBusy(""); }
  }, [practice?.tenantId, contact?.id, today]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const sum = useMemo(() => (rows ? summarise(rows, today) : undefined), [rows, today]);
  const shown = useMemo(() => (rows ? filterInvoices(rows, { state, months, q }, today) : []), [rows, state, months, q, today]);
  const counts = useMemo(() => { const c: Record<string, number> = { all: 0, open: 0, overdue: 0, paid: 0, draft: 0 }; for (const r of rows || []) { if (r.state === "voided") continue; c.all++; c[r.state === "outstanding" ? "open" : r.state]++; if (r.state === "overdue") c.open++; } return c; }, [rows]);

  if (!connected || !practice) {
    return (
      <div className="card pad stack">
        <h2 style={{ margin: 0, fontSize: 16 }}>Invoices</h2>
        <p className="muted" style={{ margin: 0 }}>{!connected ? "Xero isn't connected yet." : "Practice Planner doesn't know which Xero organisation is your own practice."} Connect Xero, then in the list of organisations choose <strong>Our own practice</strong> for yours. Invoices to this client are then read from it.</p>
        <div><a className="btn primary" href={href("settings", "xero")}>Open Xero settings</a></div>
      </div>
    );
  }

  return (
    <div className="stack">
      {contact ? (
        <>
          <div className="tl-summary" role="list" aria-label="Invoice summary">
            <div role="listitem" className="tl-sum"><span className="tl-sum-label">Owed to us</span><strong className={sum && sum.owed ? "warn" : ""}>{sum ? money(sum.owed) : "…"}</strong><span className="muted tl-sum-sub">{sum ? `${sum.openCount} unpaid invoice${sum.openCount === 1 ? "" : "s"}` : ""}</span></div>
            <div role="listitem" className="tl-sum"><span className="tl-sum-label">Overdue</span><strong className={sum && sum.overdue ? "warn" : ""}>{sum ? money(sum.overdue) : "…"}</strong><span className="muted tl-sum-sub">{sum?.oldestOverdue ? `${sum.oldestOverdue.number} was due ${fmtDate(sum.oldestOverdue.due)}` : "Nothing overdue"}</span></div>
            <div role="listitem" className="tl-sum"><span className="tl-sum-label">Billed, last 12 months</span><strong>{sum ? money(sum.billed12) : "…"}</strong><span className="muted tl-sum-sub">{sum ? `${money(sum.paid12)} paid` : ""}</span></div>
          </div>
          <div className="row-wrap tl-bar">
            <div className="row-wrap" role="group" aria-label="Status">
              {FILTERS.map((f) => <button key={f.key} type="button" className={`chip-btn${state === f.key ? " on" : ""}`} aria-pressed={state === f.key} onClick={() => setState(f.key)}>{f.label} <span className="muted">{counts[f.key as string]}</span></button>)}
            </div>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn small" disabled={!!busy} onClick={() => void load()}>{busy ? "Reading…" : "Refresh"}</button>
            <a className="btn primary" href={contactUrl(contact.id)} target="_blank" rel="noopener noreferrer">Open in Xero</a>
          </div>
          <div className="row-wrap tl-filters">
            <input className="input search" type="search" placeholder="Search by invoice number or reference" aria-label="Search invoices" value={q} onChange={(e) => setQ(e.target.value)} />
            <select className="input" style={{ width: "auto" }} aria-label="Raised" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
              <option value={0}>Raised at any time</option><option value={3}>Raised in the last 3 months</option><option value={6}>Raised in the last 6 months</option><option value={12}>Raised in the last 12 months</option>
            </select>
            <span className="muted" style={{ fontSize: 13 }}>Xero contact: {contact.name} · <button type="button" className="linkbtn" onClick={() => void link(undefined)}>Not them?</button></span>
          </div>
        </>
      ) : (
        <div className="card pad stack">
          <h2 style={{ margin: 0, fontSize: 16 }}>Which Xero contact is {client.Title}?</h2>
          {options && !options.length && <p className="muted" style={{ margin: 0 }}>No contact matching "{client.Title}" was found in {practice.tenantName}. Check the name in Xero, or the client hasn't been invoiced yet.</p>}
          {options && options.length > 0 && <>
            <p className="muted" style={{ margin: 0 }}>No single clear match. Choose the right one:</p>
            {options.map((o) => <div key={o.id} className="row-wrap" style={{ justifyContent: "space-between" }}><span><strong>{o.name}</strong>{o.email ? <span className="muted"> · {o.email}</span> : null}</span><button type="button" className="btn small" onClick={() => void link(o)}>This one</button></div>)}
          </>}
        </div>
      )}

      {busy && <p className="muted" role="status" style={{ margin: 0 }}>{busy}</p>}
      {error && <p className="import-list warn" role="alert">{error}</p>}

      {contact && rows && (shown.length ? (
        <div className="table-wrap">
          <table className="grid" style={{ minWidth: 760 }}>
            <thead><tr><th>Invoice</th><th>Raised</th><th style={{ textAlign: "right" }}>Amount</th><th style={{ textAlign: "right" }}>Balance</th><th>Status</th><th>Due</th><th><span className="sr-only">Open</span></th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.number}</strong>{r.reference ? <div className="muted" style={{ fontSize: 12 }}>{r.reference}</div> : null}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}<div className="muted" style={{ fontSize: 12 }}>{ageLabel(r.date, today)}</div></td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(r.total, r.currency)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{r.state === "paid" ? <span className="muted">—</span> : money(r.balance, r.currency)}</td>
                  <td><span className={`chip ${STATE_CHIP[r.state as InvoiceState]}`}>{STATE_LABEL[r.state as InvoiceState]}</span>{r.state === "paid" && r.paidOn ? <div className="muted" style={{ fontSize: 12 }}>{fmtDate(r.paidOn)}</div> : null}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.due ? fmtDate(r.due) : ""}{r.state === "overdue" ? <div className="muted" style={{ fontSize: 12 }}>{ageLabel(r.due, today).replace(" ago", "")} late</div> : null}</td>
                  <td>{r.url && <a className="linkbtn" href={r.url} target="_blank" rel="noopener noreferrer">View in Xero</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="card empty">{rows.length ? "No invoices match these filters." : `No invoices to ${contact.name} were found in Xero.`}</div>)}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>Read from {practice.tenantName}. This view only reads: raise, edit, email and chase invoices in Xero.</p>
    </div>
  );
}
