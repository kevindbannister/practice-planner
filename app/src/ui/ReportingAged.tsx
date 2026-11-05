// Reporting › Receivables and Payables: who owes the client money and who the client owes, by how late it is. Read from Xero's open invoices
// and bills as at the day of the read (Refresh reads them again) and kept on OneDrive, so reports can use them too.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { AGED_BUCKETS, AGED_TITLE, AgedBook, AgedData, AgedKind, agedBook, agedItem, fetchOpenInvoices } from "../lib/aged";
import { todayIso } from "../lib/domain";
import { REPORT_FOLDER } from "../lib/reportData";
import { XeroError } from "../lib/xero";
import { useData } from "./data";
import { Seg } from "./reportingKit";
import { useXero } from "./XeroSettings";

type Tenant = { tenantId: string; tenantName: string };
const SHADE = ["#f7e9de", "#f4d9c3", "#f1c6a4", "#edb180", "#e69a5a"];
const money = (n: number) => (n === 0 ? "–" : `${n < 0 ? "-" : ""}£${Math.abs(Math.round(n)).toLocaleString("en-GB")}`);
const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

/** The saved open invoices and bills for a client, with a way to read them again from Xero. */
export function useAgedData(clientKey: string, tenant?: Tenant) {
  const { store } = useData();
  const api = useXero();
  const [s, setS] = useState<{ data?: AgedData; busy: string; error?: string; checked: boolean }>({ busy: "", checked: false });
  const tenantId = tenant?.tenantId;
  useEffect(() => {
    let live = true;
    setS({ busy: "Opening the saved invoices…", checked: false });
    store.graph.download(agedItem(REPORT_FOLDER, clientKey)).then(
      (bytes) => { if (!live) return; try { const saved = JSON.parse(new TextDecoder().decode(bytes)) as AgedData; setS({ data: saved.v === 1 ? saved : undefined, busy: "", checked: true }); } catch { setS({ busy: "", checked: true }); } },
      () => live && setS({ busy: "", checked: true }),
    );
    return () => { live = false; };
  }, [clientKey, store]);
  const refresh = useCallback(async () => {
    if (!tenantId) return;
    setS((x) => ({ ...x, busy: "Reading unpaid sales invoices from Xero…", error: undefined }));
    try {
      const today = todayIso();
      const rec = await fetchOpenInvoices(api, tenantId, "ACCREC", today, (n) => setS((x) => ({ ...x, busy: `Reading unpaid sales invoices… ${n}` })));
      setS((x) => ({ ...x, busy: "Reading unpaid bills from Xero…" }));
      const pay = await fetchOpenInvoices(api, tenantId, "ACCPAY", today, (n) => setS((x) => ({ ...x, busy: `Reading unpaid bills… ${n}` })));
      const d: AgedData = { v: 1, at: new Date().toISOString(), asAt: today, tenantId, rec, pay };
      await store.graph.put(`${agedItem(REPORT_FOLDER, clientKey)}:/content`, new TextEncoder().encode(JSON.stringify(d)), "application/json");
      setS({ data: d, busy: "", checked: true });
    } catch (e) {
      setS((x) => ({ ...x, busy: "", error: e instanceof XeroError ? e.message : "The invoices couldn't be read from Xero or saved. Try again." }));
    }
  }, [api, store, clientKey, tenantId]);
  return { ...s, refresh };
}

/** The ageing bar and table. With onOpen the rows can be opened to show their invoices; without it (a report) it is plain. */
export function AgedView({ data, kind, limit, open, onOpen }: { data: AgedData; kind: AgedKind; limit?: number; open?: string; onOpen?: (contact: string) => void }) {
  const book: AgedBook = agedBook(kind === "rec" ? data.rec : data.pay, data.asAt);
  const who = kind === "rec" ? "customers" : "suppliers";
  const shown = limit ? book.contacts.slice(0, limit) : book.contacts;
  const rest = book.contacts.slice(shown.length);
  const th: React.CSSProperties = { textAlign: "right", padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap", borderBottom: "2px solid #cbd5e1", fontSize: 12 };
  const td: React.CSSProperties = { textAlign: "right", padding: "5px 8px", fontVariantNumeric: "tabular-nums", fontSize: 12 };
  if (!book.count) return <p style={{ fontSize: 14, color: "#7a8591" }}>Nothing is {kind === "rec" ? "owed by customers" : "owed to suppliers"} as at {dmy(data.asAt)}.</p>;
  return (
    <div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "4px 0 12px" }}>
        {([["Total " + (kind === "rec" ? "owed to you" : "you owe"), money(book.totals.total)], ["Overdue", `${money(book.overdue)} (${book.overduePct}%)`], ["Oldest", book.oldestLate ? `${book.oldestLate} days late` : "Nothing late"], ["Invoices", String(book.count)]] as const).map(([l, v]) => (
          <div key={l}><div style={{ fontSize: 11, letterSpacing: 0.5, color: "#59636e", textTransform: "uppercase" }}>{l}</div><div style={{ fontSize: 20 }}>{v}</div></div>
        ))}
      </div>
      <div style={{ display: "flex", height: 34, marginBottom: 4 }} role="img" aria-label={`${AGED_TITLE[kind]} by how late`}>
        {AGED_BUCKETS.map(([k, label], i) => book.totals[k] > 0 && <div key={k} title={`${label}: ${money(book.totals[k])}`} style={{ flex: book.totals[k], background: SHADE[i], borderRight: "1px solid #fff", minWidth: 2 }} />)}
      </div>
      <div style={{ display: "flex", marginBottom: 14 }}>
        {AGED_BUCKETS.map(([k, label]) => book.totals[k] > 0 && <div key={k} style={{ flex: book.totals[k], minWidth: 0, fontSize: 11, color: "#4a5560", overflow: "hidden", whiteSpace: "nowrap" }}><div>{label}</div><div style={{ fontWeight: 600 }}>{money(book.totals[k])} · {Math.round((book.totals[k] / book.totals.total) * 100)}%</div></div>)}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={{ ...th, textAlign: "left" }}>{kind === "rec" ? "Customer" : "Supplier"}</th>{AGED_BUCKETS.map(([k, l]) => <th key={k} style={th}>{l}</th>)}<th style={th}>Total</th></tr></thead>
        <tbody>
          {shown.map((c) => (
            <Fragment key={c.contact}>
              <tr onClick={onOpen ? () => onOpen(c.contact) : undefined} style={{ borderTop: "1px solid #f0f3f6", cursor: onOpen ? "pointer" : undefined }}>
                <td style={{ ...td, textAlign: "left" }}>{onOpen ? <button type="button" aria-expanded={open === c.contact} style={{ border: 0, background: "none", padding: 0, cursor: "pointer", font: "inherit", textAlign: "left", color: "inherit" }}>{open === c.contact ? "▾" : "▸"} {c.contact}</button> : c.contact}</td>
                {AGED_BUCKETS.map(([k], i) => <td key={k} style={{ ...td, background: c[k] ? SHADE[i] + "88" : undefined }}>{money(c[k])}</td>)}
                <td style={{ ...td, fontWeight: 600 }}>{money(c.total)}</td>
              </tr>
              {onOpen && open === c.contact && c.invoices.map((i) => (
                <tr key={i.id} style={{ background: "#fafbfc" }}>
                  <td colSpan={6} style={{ ...td, textAlign: "left", paddingLeft: 28, color: "#4a5560" }}>{i.number || "(no number)"}{i.reference ? ` · ${i.reference}` : ""} · raised {dmy(i.date)} · due {dmy(i.due)} · {i.late ? `${i.late} days late` : "not yet due"}</td>
                  <td style={td}>{money(i.balance)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
          {rest.length > 0 && <tr style={{ borderTop: "1px solid #f0f3f6" }}><td style={{ ...td, textAlign: "left", color: "#59636e" }}>{rest.length} other {who}</td>{AGED_BUCKETS.map(([k]) => <td key={k} style={td}>{money(rest.reduce((a, c) => a + c[k], 0))}</td>)}<td style={{ ...td, fontWeight: 600 }}>{money(rest.reduce((a, c) => a + c.total, 0))}</td></tr>}
          <tr style={{ borderTop: "2px solid #cbd5e1", fontWeight: 700, background: "#f4f7fb" }}><td style={{ ...td, textAlign: "left" }}>Total</td>{AGED_BUCKETS.map(([k]) => <td key={k} style={td}>{money(book.totals[k])}</td>)}<td style={td}>{money(book.totals.total)}</td></tr>
        </tbody>
      </table>
      <p style={{ fontSize: 11, color: "#7a8591", margin: "8px 0 0" }}>As at {dmy(data.asAt)}. Days are counted from the due date. Credit notes and unallocated payments are not netted off.</p>
    </div>
  );
}

export function AgedScreen({ clientKey, clientName, tenant, kind: first }: { clientKey: string; clientName: string; tenant: Tenant; kind: AgedKind }) {
  const r = useAgedData(clientKey, tenant);
  const [kind, setKind] = useState<AgedKind>(first);
  const [open, setOpen] = useState("");
  const [all, setAll] = useState(false);
  const tried = useRef("");
  useEffect(() => { setKind(first); setOpen(""); }, [first]);
  useEffect(() => {
    if (r.checked && !r.data && !r.busy && !r.error && tried.current !== clientKey) { tried.current = clientKey; void r.refresh(); }
  }, [r.checked, r.data, r.busy, r.error, clientKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = r.data;
  return (
    <section className="stack" style={{ gap: 12, minWidth: 0 }} aria-label={AGED_TITLE[kind]}>
      <div className="row-wrap" style={{ gap: 10, alignItems: "center", justifyContent: "space-between" }}>
        <div className="row-wrap" style={{ gap: 10, alignItems: "center" }}><h2 style={{ margin: 0 }}>{AGED_TITLE[kind]}</h2><span className="muted" style={{ fontSize: 13 }}>{clientName}</span></div>
        <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }} aria-live="polite">{r.busy || (d ? `Read from Xero ${new Date(d.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "")}</span>
          <button type="button" className="btn small" disabled={!!r.busy} onClick={() => void r.refresh()}>{d ? "Refresh from Xero" : "Read from Xero"}</button>
        </div>
      </div>
      {r.error && <div className="alert red"><strong>Couldn't read the invoices</strong><span>{r.error}</span></div>}
      {d && (
        <>
          <Seg value={kind} set={(k) => { setKind(k); setOpen(""); }} opts={[["rec", "Receivables"], ["pay", "Payables"]]} label="Which" />
          <div className="card pad" style={{ overflowX: "auto" }}>
            <AgedView data={d} kind={kind} limit={all ? undefined : 15} open={open} onOpen={(c) => setOpen(open === c ? "" : c)} />
          </div>
          <div className="row-wrap" style={{ gap: 8 }}><button type="button" className="btn small" onClick={() => setAll(!all)}>{all ? "Show the top 15" : "Show everyone"}</button></div>
        </>
      )}
    </section>
  );
}
