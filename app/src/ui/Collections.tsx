// Billing, from invoice to money in the bank: the practice-wide Billing page (overview, what to invoice, recurring schedules,
// collections and chasing, billed against agreed) and the invoice controls on a one-off charge. Logic is in lib/collections.ts.
// The app never sends anything to a client: invoices are made in Adfin, links and chasers are Outlook drafts a person sends.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { todayIso } from "../lib/domain";
import { readLink } from "../lib/billing";
import {
  BILL_LABEL, BUCKET_LABEL, Bucket, CHASE_STEPS, ClientBook, Debt, Health, ageing, chargeEmail, chargeGross, chargeProblems, chargeVatRate, chaseEmail, chaseState, clientBooks, collectedSince, collectionProblems, daysLate, fetchLedger,
  getCustomers, invoiceCharge, invoiceSummary, matchClients, readChargeBill, readChase, recordChase, recordDispute, recordPromise, reconcile, resolveChase, syncCharge, toInvoice,
} from "../lib/collections";
import { readCharge } from "../lib/fees";
import { Row } from "../lib/schema";
import { InvoiceRow } from "../lib/xeroInvoices";
import { BillingPage as RecurringBilling, useAdfin, useAdfinConnected, useAdfinSettings, useCustomerLinks } from "./Billing";
import { Icon, href } from "./bits";
import { mailAllowed, outlookDraft, useCommsPrefs } from "./commsKit";
import { readSetting, useData } from "./data";
import { useSales } from "./salesKit";
import { useXero, useXeroLinks } from "./XeroSettings";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const msgOf = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't work. Try again.");
const gbp = (n: number) => (n < 0 ? "-£" : "£") + Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: string) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
const first = (c: Row | undefined) => str(c?.ContactPreferred || c?.ContactFirst);

// ------------------------------------------------------------------ invoicing one charge (on the client's fee schedule and the To invoice tab)

export function ChargeBilling({ client, row, busy, doW }: { client: Row; row: Row; busy: boolean; doW: (w: any, ok?: string) => void }) {
  const s = useSales();
  const { store } = useData();
  const api = useAdfin();
  const connected = useAdfinConnected();
  const settings = useAdfinSettings();
  const customer = useCustomerLinks()[str(client.Key)];
  const prefs = useCommsPrefs();
  const today = todayIso();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [working, setWorking] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const c = readCharge(row);
  const bill = readChargeBill(row);
  const can = s.pcan("send");
  if (c.status !== "agreed" && bill.status === "none") return null;
  if (!connected && bill.status === "none") return null;
  const input = { charge: row, clientName: str(client.Title), customerId: customer?.id || "", customerName: customer?.name || "", settings, today };
  const problems = chargeProblems(input);
  const run = async (label: string, fn: () => Promise<void>) => { setWorking(label); setErr(""); setNote(""); try { await fn(); } catch (e) { setErr(msgOf(e)); } finally { setWorking(""); } };
  const gross = bill.amount || chargeGross(c.amount, chargeVatRate(c.vat, settings));
  const email = () => run("Making the draft email…", async () => {
    const m = chargeEmail(first(client), c.label, gross, bill.url, addDays(bill.billedOn || today, settings.termDays));
    const to = str(client.Email);
    if (to && mailAllowed()) { await outlookDraft(store.graph, { to, subject: m.subject, body: m.body, signature: prefs.emailSignature }); setNote("A draft email with the payment link is in your Outlook drafts. Check it, then send it."); }
    else setNote(`Payment link: ${bill.url}. Send it to the client (Outlook drafts aren't available, or the client has no email on file).`);
  });
  return (
    <div className="stack" style={{ gap: 6 }} role="group" aria-label={`Invoice for ${c.label}`}>
      {bill.status !== "none" ? (
        <div className="row-wrap" style={{ gap: 6 }}>
          <span className={`chip ${bill.status === "paid" ? "green" : bill.status === "unpaid" ? "amber" : ""}`}>{BILL_LABEL[bill.status]}</span>
          <span className="muted">{bill.no} · {gbp(gross)}{bill.billedOn ? ` · ${fmt(bill.billedOn)}` : ""}{bill.status === "paid" && bill.paidOn ? ` · paid ${fmt(bill.paidOn)}` : ""}</span>
          {bill.status === "unpaid" && bill.url && can && <button type="button" className="linkbtn" disabled={busy || !!working} onClick={() => void email()}>Email the link</button>}
          {bill.status === "unpaid" && bill.url && <a className="linkbtn" href={bill.url} target="_blank" rel="noreferrer">Open link</a>}
          {bill.status !== "paid" && bill.status !== "void" && connected && <button type="button" className="linkbtn" disabled={busy || !!working} onClick={() => void run("Checking Adfin…", async () => {
            const r = await syncCharge(api, row, today);
            if (r.missing) throw new Error("Adfin has no record of this invoice. Check Adfin.");
            if (r.patch) { await s.apply({ patches: [{ list: "FeeCharges", row, patch: r.patch }], log: [], activities: [] }); setNote(r.status === "paid" ? "Paid." : "Updated from Adfin."); } else setNote("No change in Adfin.");
          })}>Check payment</button>}
        </div>
      ) : can && c.status === "agreed" ? (
        !open ? <div><button type="button" className="btn small" disabled={busy || !!working} onClick={() => { setOpen(true); setChecked(false); }}>Invoice through Adfin</button></div> : (
          <div className="import-list" role="group" aria-label="Invoice this charge">
            <p style={{ margin: 0 }}><strong>This will invoice a real client.</strong> {invoiceSummary(input)}</p>
            {problems.length > 0 && <ul role="status" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            <label className="row-wrap" style={{ gap: 6, marginTop: 6 }}><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I have checked the amount, the VAT and the customer.</label>
            <div className="row-wrap" style={{ gap: 8, marginTop: 6 }}>
              <button type="button" className="btn small primary" disabled={busy || !!working || !checked || problems.length > 0} onClick={() => void run("Making the invoice in Adfin…", async () => { doW(await invoiceCharge(api, client, input, s.pcan, s.ctx()), "Invoice made in Adfin. Email the payment link to the client."); setOpen(false); })}>Make the invoice</button>
              <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Not yet</button>
            </div>
          </div>
        )
      ) : null}
      {working && <p role="status" style={{ margin: 0 }}>{working}</p>}
      {err && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{err}</p>}
      {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
    </div>
  );
}
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

// ------------------------------------------------------------------ the practice's invoices, read from Xero

function useLedger() {
  const xero = useXero();
  const { practice, connected } = useXeroLinks();
  const today = todayIso();
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!practice) return;
    setBusy("Reading invoices from Xero…"); setError("");
    try { setRows(await fetchLedger(xero, practice.tenantId, today, (n) => setBusy(`Reading invoices from Xero… ${n}`))); } catch (e) { setError(msgOf(e)); } finally { setBusy(""); }
  }, [practice?.tenantId, today]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  return { rows, busy, error, reload: load, ready: connected && !!practice, practice };
}

type Tab = "overview" | "invoice" | "recurring" | "collect" | "check";
const TABS: [Tab, string][] = [["overview", "Overview"], ["invoice", "To invoice"], ["recurring", "Recurring"], ["collect", "Collections"], ["check", "Billed v agreed"]];

export function BillingPage() {
  const { data } = useData();
  const s = useSales();
  const api = useAdfin();
  const connected = useAdfinConnected();
  const settings = useAdfinSettings();
  const ledger = useLedger();
  const today = todayIso();
  const [tab, setTab] = useState<Tab>("overview");
  const [health, setHealth] = useState<Health[] | null>(null);
  const [checking, setChecking] = useState("");
  const [err, setErr] = useState("");
  const name = (k: string) => str(data.clients.find((c) => c.Key === k)?.Title) || k;
  const contacts = readSetting<Record<string, { id: string; name: string }>>(data.settings, "xero.contacts") || {};

  const { debts, unmatched } = useMemo(() => matchClients(ledger.rows || [], data.clients, contacts), [ledger.rows, data.clients, data.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const books = useMemo(() => clientBooks(debts, today), [debts, today]);
  const bookBy = useMemo(() => new Map(books.map((b) => [b.clientKey, b])), [books]);
  const age = useMemo(() => ageing(debts, today), [debts, today]);
  const states = useMemo(() => books.map((b) => ({ b, st: chaseState(b, data.billingChases.filter((r) => str(r.ClientKey) === b.clientKey), today) })), [books, data.billingChases, today]);
  const toChase = states.filter((x) => x.st.state === "chase");
  const waiting = toInvoice(data.feeCharges);
  const waitingGross = waiting.reduce((a, r) => { const c = readCharge(r); return a + chargeGross(c.amount, chargeVatRate(c.vat, settings)); }, 0);
  const sentUnpaid = data.feeCharges.filter((r) => readChargeBill(r).status === "unpaid");
  const lateTotal = age.d30 + age.d60 + age.d90 + age.d90p;
  const lateClients = books.filter((b) => b.overdue > 0).length;
  const live = data.billingLinks.map(readLink).filter((l) => l.status === "active");
  const monthly = live.reduce((a, l) => a + (l.period === "monthly" ? l.amount : l.period === "quarterly" ? l.amount / 3 : l.period === "annually" || l.period === "annual" ? l.amount / 12 : 0), 0);

  const check = async () => {
    setChecking("Checking Adfin…"); setErr("");
    try {
      for (const r of sentUnpaid) { const x = await syncCharge(api, r, today); if (x.patch) await s.apply({ patches: [{ list: "FeeCharges", row: r, patch: x.patch }], log: [], activities: [] }); }
      const dd = data.billingLinks.filter((r) => { const l = readLink(r); return (l.status === "active" || l.status === "draft") && l.method === "direct-debit"; });
      setHealth(collectionProblems(dd, await getCustomers(api, dd.map((r) => readLink(r).customerId))));
      await ledger.reload();
    } catch (e) { setErr(msgOf(e)); } finally { setChecking(""); }
  };

  if (!s.can("view")) return null;
  const needsXero = !ledger.ready;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row-wrap" role="tablist" aria-label="Billing" style={{ gap: 8 }}>
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className="btn small" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}{k === "invoice" && waiting.length ? ` (${waiting.length})` : k === "collect" && toChase.length ? ` (${toChase.length} to chase)` : ""}</button>)}
        <span style={{ flex: 1 }} />
        <button type="button" className="btn small" disabled={!!ledger.busy || needsXero} onClick={() => void ledger.reload()}><Icon name="refresh" /> Refresh from Xero</button>
        <button type="button" className="btn small" disabled={!connected || !!checking} onClick={() => void check()}><Icon name="refresh" /> Check Adfin</button>
      </div>
      {(ledger.busy || checking) && <p role="status" className="muted" style={{ margin: 0 }}>{checking || ledger.busy}</p>}
      {(ledger.error || err) && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{ledger.error || err}</p>}
      {needsXero && tab !== "recurring" && tab !== "invoice" && <p className="import-list warn" role="note" style={{ margin: 0 }}>Payments are read from your own practice's Xero, where Adfin puts every invoice. {ledger.ready ? "" : <>Connect Xero and mark your own organisation in <a href={href("settings", "xero")}>Settings › Xero</a> to see what is paid, owed and overdue.</>}</p>}

      {tab === "overview" && (
        <>
          <div className="tl-summary" role="list" aria-label="From invoice to paid">
            <button type="button" role="listitem" className="tl-sum" onClick={() => setTab("invoice")}><span className="tl-sum-label">To invoice</span><strong className={waiting.length ? "warn" : ""}>{gbp(waitingGross)}</strong><span className="muted tl-sum-sub">{waiting.length} agreed charge{waiting.length === 1 ? "" : "s"}</span></button>
            <button type="button" role="listitem" className="tl-sum" onClick={() => setTab("recurring")}><span className="tl-sum-label">Billing now</span><strong>{gbp(monthly)}</strong><span className="muted tl-sum-sub">{live.length} schedule{live.length === 1 ? "" : "s"}, a month</span></button>
            <button type="button" role="listitem" className="tl-sum" onClick={() => setTab("collect")}><span className="tl-sum-label">Awaiting payment</span><strong>{needsXero ? "—" : gbp(age.total)}</strong><span className="muted tl-sum-sub">{needsXero ? "needs Xero" : `${age.count} invoice${age.count === 1 ? "" : "s"}`}</span></button>
            <button type="button" role="listitem" className="tl-sum" onClick={() => setTab("collect")}><span className="tl-sum-label">Overdue</span><strong className={lateTotal ? "warn" : ""}>{needsXero ? "—" : gbp(lateTotal)}</strong><span className="muted tl-sum-sub">{needsXero ? "" : `${lateClients} client${lateClients === 1 ? "" : "s"}`}</span></button>
            <div role="listitem" className="tl-sum"><span className="tl-sum-label">Collected, 30 days</span><strong>{needsXero ? "—" : gbp(collectedSince(debts, today, 30))}</strong><span className="muted tl-sum-sub">settled invoices</span></div>
          </div>
          <div className="card pad stack" style={{ gap: 8 }}>
            <strong>Needs doing</strong>
            {!waiting.length && !toChase.length && !(health || []).length && <p className="muted" style={{ margin: 0 }}>Nothing waiting. {health ? "" : "Press Check Adfin to look at direct debits and invoiced charges."}</p>}
            {waiting.length > 0 && <div className="row-wrap" style={{ gap: 8 }}><span>{waiting.length} agreed charge{waiting.length === 1 ? " has" : "s have"} not been invoiced ({gbp(waitingGross)}).</span><button type="button" className="linkbtn" onClick={() => setTab("invoice")}>Invoice them</button></div>}
            {toChase.slice(0, 6).map(({ b, st }) => <div key={b.clientKey} className="row-wrap" style={{ gap: 8 }}><a href={href("clients", b.clientKey)}>{name(b.clientKey)}</a><span>{gbp(b.overdue)} overdue, {b.oldestLate} days late.</span><span className="chip amber">{st.state === "chase" ? st.label : ""}</span></div>)}
            {toChase.length > 6 && <button type="button" className="linkbtn" onClick={() => setTab("collect")}>and {toChase.length - 6} more to chase</button>}
            {(health || []).map((h) => <div key={h.scheduleNo + h.clientKey} className="row-wrap" style={{ gap: 8 }}><a href={href("clients", h.clientKey)}>{name(h.clientKey)}</a><span>{h.scheduleNo}: {h.problem}</span><span className={`chip ${h.level}`}>{h.level === "red" ? "Won't collect" : "Waiting"}</span></div>)}
          </div>
          {unmatched.length > 0 && <p className="muted" style={{ margin: 0 }}>{unmatched.length} invoice{unmatched.length === 1 ? "" : "s"} in Xero ({gbp(unmatched.filter((u) => u.state === "outstanding" || u.state === "overdue").reduce((a, u) => a + u.balance, 0))} unpaid) could not be matched to a client by name. Open the client's Invoices tab and choose the Xero contact to link them.</p>}
        </>
      )}

      {tab === "invoice" && <ToInvoice name={name} />}
      {tab === "recurring" && <RecurringBilling />}
      {tab === "collect" && !needsXero && <Collections debts={debts} books={books} age={age} name={name} unmatchedCount={unmatched.length} />}
      {tab === "check" && !needsXero && <Check books={books} name={name} />}
    </div>
  );
}

// ------------------------------------------------------------------ to invoice

function ToInvoice({ name }: { name: (k: string) => string }) {
  const { data } = useData();
  const s = useSales();
  const settings = useAdfinSettings();
  const connected = useAdfinConnected();
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const doW = async (w: any, ok?: string) => { setErr(""); setNote(""); if (w?.error) return setErr(w.error); setBusy(true); try { await s.apply(w); if (ok) setNote(ok); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
  const waiting = toInvoice(data.feeCharges);
  const out = data.feeCharges.filter((r) => ["unpaid", "draft"].includes(readChargeBill(r).status));
  const done = data.feeCharges.filter((r) => readChargeBill(r).status === "paid").sort((a, b) => str(readChargeBill(b).paidOn).localeCompare(readChargeBill(a).paidOn)).slice(0, 10);
  const list = (rows: Row[], title: string, empty: string) => (
    <div className="stack" style={{ gap: 6 }}>
      <strong>{title}</strong>
      {!rows.length ? <p className="muted" style={{ margin: 0 }}>{empty}</p> : (
        <div className="card" style={{ overflowX: "auto" }}><table className="grid" style={{ width: "100%" }}>
          <thead><tr><th>Client</th><th>Charge</th><th>Amount</th><th>Agreed</th><th>Invoice</th></tr></thead>
          <tbody>{rows.map((r) => { const c = readCharge(r); const client = data.clients.find((x) => x.Key === c.clientKey); return (
            <tr key={c.key}><td><a href={href("clients", c.clientKey)}>{name(c.clientKey)}</a></td><td>{c.label}</td><td>{gbp(c.amount)} <span className="muted">{c.vat === "standard" ? `+ VAT ${gbp(chargeGross(c.amount, settings.vatRate))}` : c.vat === "zero" ? "no VAT" : "VAT not set"}</span></td><td>{fmt(c.agreedOn)}</td>
              <td>{client ? <ChargeBilling client={client} row={r} busy={busy} doW={doW} /> : null}</td></tr>
          ); })}</tbody>
        </table></div>
      )}
    </div>
  );
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="import-list" role="note"><strong>One-off charges.</strong> Set-up fees and approved catch-up fees are invoiced here through Adfin, which makes a payment link. Nothing is sent to the client by the app: you email the link from an Outlook draft.</div>
      {!connected && <p className="import-list warn" role="note" style={{ margin: 0 }}>Adfin isn't connected. <a href={href("settings", "adfin")}>Connect it in Settings › Adfin</a>. The Adfin customer for each client is chosen on their fee schedule.</p>}
      {err && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{err}</p>}
      {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
      {list(waiting, "Agreed, not yet invoiced", "Every agreed charge has been invoiced.")}
      {list(out, "Invoiced, awaiting payment", "None.")}
      {done.length > 0 && list(done, "Recently paid", "")}
    </div>
  );
}

// ------------------------------------------------------------------ collections and chasing

function Collections({ debts, books, age, name, unmatchedCount }: { debts: Debt[]; books: ClientBook[]; age: ReturnType<typeof ageing>; name: (k: string) => string; unmatchedCount: number }) {
  const { data, store } = useData();
  const s = useSales();
  const prefs = useCommsPrefs();
  const today = todayIso();
  const [open, setOpen] = useState("");
  const [only, setOnly] = useState<"late" | "all">("late");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [promiseOn, setPromiseOn] = useState("");
  const [why, setWhy] = useState("");
  const can = s.pcan("send");
  const rows = books.filter((b) => (only === "all" ? b.owed > 0 : b.overdue > 0));
  const apply = async (w: any, ok: string) => { setErr(""); setNote(""); if (w?.error) return setErr(w.error); setBusy(true); try { await s.apply(w); setNote(ok); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };

  const draft = async (b: ClientBook, level: 1 | 2 | 3) => {
    const client = data.clients.find((c) => c.Key === b.clientKey);
    if (!client) return;
    setErr(""); setNote(""); setPreview(null); setBusy(true);
    try {
      const payUrls = data.feeCharges.filter((r) => str(r.ClientKey) === b.clientKey && readChargeBill(r).status === "unpaid" && readChargeBill(r).url).map((r) => readChargeBill(r).url);
      const hasDirectDebit = data.billingLinks.some((r) => str(r.ClientKey) === b.clientKey && readLink(r).method === "direct-debit" && readLink(r).status === "active");
      const m = chaseEmail({ level, first: first(client), invoices: b.late, hasDirectDebit, payUrls, today });
      const to = str(client.Email);
      if (to && mailAllowed()) { await outlookDraft(store.graph, { to, subject: m.subject, body: m.body, signature: prefs.emailSignature }); setNote("A draft chaser is in your Outlook drafts. Check it, then send it."); }
      else { setPreview(m); setNote("No email on file or Outlook drafts aren't available. Copy this wording."); }
      const w = recordChase(client, level, b.late, "", s.pcan, s.ctx());
      if ("error" in w) throw new Error(w.error);
      await s.apply(w);
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); }
  };

  const bucket = (k: Bucket) => <div key={k} className="tl-sum"><span className="tl-sum-label">{BUCKET_LABEL[k]}</span><strong className={k !== "current" && age[k] ? "warn" : ""}>{gbp(age[k])}</strong></div>;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="tl-summary" role="list" aria-label="Ageing of unpaid invoices">{(["current", "d30", "d60", "d90", "d90p"] as Bucket[]).map(bucket)}</div>
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn small" aria-pressed={only === "late"} onClick={() => setOnly("late")}>Overdue ({books.filter((b) => b.overdue > 0).length})</button>
        <button type="button" className="btn small" aria-pressed={only === "all"} onClick={() => setOnly("all")}>All who owe ({books.filter((b) => b.owed > 0).length})</button>
        <span className="muted">Chasing drafts an email for you to send. It never sends one. Promises and disputes pause chasing.</span>
      </div>
      {err && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{err}</p>}
      {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
      {preview && <div className="import-list"><strong>{preview.subject}</strong><pre style={{ whiteSpace: "pre-wrap", margin: "6px 0 0", font: "inherit" }}>{preview.body}</pre></div>}
      {!rows.length ? <p className="muted">{only === "late" ? "Nothing is overdue." : "Nobody owes anything."}</p> : (
        <div className="card" style={{ overflowX: "auto" }}><table className="grid" style={{ width: "100%" }}>
          <thead><tr><th>Client</th><th>Owed</th><th>Overdue</th><th>Oldest</th><th>Usually pays in</th><th>Chasing</th><th /></tr></thead>
          <tbody>{rows.map((b) => {
            const hist = data.billingChases.filter((r) => str(r.ClientKey) === b.clientKey);
            const st = chaseState(b, hist, today);
            const isOpen = open === b.clientKey;
            return (
              <Fragment key={b.clientKey}>
                <tr>
                  <td><a href={href("clients", b.clientKey)}>{name(b.clientKey)}</a></td><td>{gbp(b.owed)}</td><td>{b.overdue ? <strong>{gbp(b.overdue)}</strong> : "—"}</td><td>{b.oldestLate ? `${b.oldestLate} days late` : "—"}</td><td>{b.avgDaysToPay !== undefined ? `${b.avgDaysToPay} days` : "—"}</td>
                  <td>{st.state === "chase" ? <span className="chip amber">{st.label}{st.again ? " (again)" : ""}</span> : st.state === "wait" ? <span className="muted">{st.reason}</span> : st.state === "promised" ? <span className="chip">Promised by {fmt(st.on)}</span> : st.state === "disputed" ? <span className="chip red">Disputed</span> : <span className="muted">—</span>}</td>
                  <td><button type="button" className="linkbtn" aria-expanded={isOpen} onClick={() => { setOpen(isOpen ? "" : b.clientKey); setPreview(null); setWhy(""); setPromiseOn(""); }}>{isOpen ? "Close" : "Open"}</button></td>
                </tr>
                {isOpen && (
                  <tr><td colSpan={7}>
                    <div className="stack" style={{ gap: 8 }}>
                      <table className="grid" style={{ width: "100%" }}><thead><tr><th>Invoice</th><th>Raised</th><th>Due</th><th>Balance</th><th>Late</th><th /></tr></thead>
                        <tbody>{b.open.map((r) => <tr key={r.id}><td>{r.number}{r.reference ? <span className="muted"> · {r.reference}</span> : null}</td><td>{fmt(r.date)}</td><td>{fmt(r.due)}</td><td>{gbp(r.balance)}</td><td>{daysLate(r, today) ? `${daysLate(r, today)} days` : "—"}</td><td>{r.url && <a className="linkbtn" href={r.url} target="_blank" rel="noopener noreferrer">View in Xero</a>}</td></tr>)}</tbody></table>
                      {can && b.late.length > 0 && (
                        <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
                          {CHASE_STEPS.map((x) => <button key={x.level} type="button" className={`btn small${st.state === "chase" && st.level === x.level ? " primary" : ""}`} disabled={busy} onClick={() => void draft(b, x.level)}>Draft: {x.label.toLowerCase()}</button>)}
                        </div>
                      )}
                      {can && (
                        <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
                          <label className="doc-field" style={{ width: 170 }}><span>Client says they'll pay by</span><input className="input" type="date" min={today} value={promiseOn} onChange={(e) => setPromiseOn(e.target.value)} /></label>
                          <button type="button" className="btn small" disabled={busy} onClick={() => void apply(recordPromise(data.clients.find((c) => c.Key === b.clientKey)!, promiseOn, b.overdue, why, today, s.pcan, s.ctx()), "Promise recorded. Chasing is paused until that date.")}>Record promise</button>
                          <label className="doc-field" style={{ flex: "1 1 240px" }}><span>Note, or what they dispute</span><input className="input" value={why} onChange={(e) => setWhy(e.target.value)} /></label>
                          <button type="button" className="btn small" disabled={busy} onClick={() => void apply(recordDispute(data.clients.find((c) => c.Key === b.clientKey)!, b.late.map((x) => x.number).join(", "), why, s.pcan, s.ctx()), "Dispute recorded. Chasing is paused until it is resolved.")}>Record dispute</button>
                        </div>
                      )}
                      {hist.length > 0 && (
                        <div className="stack" style={{ gap: 4 }}>
                          <strong>History</strong>
                          {hist.map(readChase).sort((a, b2) => b2.at.localeCompare(a.at)).slice(0, 8).map((h) => { const r = hist.find((x) => str(x.Key) === h.key)!; return (
                            <div key={h.key} className="row-wrap" style={{ gap: 8 }}>
                              <span className="muted">{fmt(h.at.slice(0, 10))}</span>
                              <span>{h.kind === "chase" ? `${CHASE_STEPS[Math.max(0, h.level - 1)]?.label || "Chaser"} drafted (${h.invoiceNos})` : h.kind === "promise" ? `Promised to pay by ${fmt(h.promiseOn)}${h.note ? `: ${h.note}` : ""}` : h.kind === "dispute" ? `Disputed${h.note ? `: ${h.note}` : ""}` : h.note}</span>
                              <span className="muted">{h.actor}</span>
                              {h.kind === "promise" && h.status === "open" && can && <><button type="button" className="linkbtn" onClick={() => void apply(resolveChase(r, "kept", s.pcan), "Marked as kept.")}>Kept</button><button type="button" className="linkbtn" onClick={() => void apply(resolveChase(r, "broken", s.pcan), "Marked as broken.")}>Broken</button></>}
                              {h.kind === "dispute" && h.status === "open" && can && <button type="button" className="linkbtn" onClick={() => void apply(resolveChase(r, "resolved", s.pcan), "Dispute resolved. Chasing can resume.")}>Resolved</button>}
                              {h.kind !== "chase" && h.status && h.status !== "open" && <span className="chip">{h.status}</span>}
                            </div>
                          ); })}
                        </div>
                      )}
                    </div>
                  </td></tr>
                )}
              </Fragment>
            );
          })}</tbody>
        </table></div>
      )}
      {unmatchedCount > 0 && <p className="muted" style={{ margin: 0 }}>{unmatchedCount} invoice{unmatchedCount === 1 ? "" : "s"} could not be matched to a client and are not shown here.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ billed against agreed

function Check({ books, name }: { books: ClientBook[]; name: (k: string) => string }) {
  const { data } = useData();
  const settings = useAdfinSettings();
  const today = todayIso();
  const [all, setAll] = useState(false);
  const rec = useMemo(() => reconcile(data.clientServices, data.feeCharges, books, settings.vatRate, today), [data.clientServices, data.feeCharges, books, settings.vatRate, today]);
  const shown = rec.filter((r) => (all ? r.state !== "none" : r.state === "under" || r.state === "over"));
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="import-list" role="note"><strong>Billed against agreed.</strong> What each client's agreed fees come to over a year, with VAT, against what was invoiced in the last 12 months (from Xero). It is approximate: a fee that began or ended during the year, or an invoice Xero holds under a different name, will show a difference. Use it to spot clients nobody has billed.</div>
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn small" aria-pressed={!all} onClick={() => setAll(false)}>Differences ({rec.filter((r) => r.state === "under" || r.state === "over").length})</button>
        <button type="button" className="btn small" aria-pressed={all} onClick={() => setAll(true)}>Everyone ({rec.filter((r) => r.state !== "none").length})</button>
      </div>
      {!shown.length ? <p className="muted">Nothing differs.</p> : (
        <div className="card" style={{ overflowX: "auto" }}><table className="grid" style={{ width: "100%" }}>
          <thead><tr><th>Client</th><th>Agreed, a year</th><th>Invoiced, 12 months</th><th>Difference</th><th /></tr></thead>
          <tbody>{shown.map((r) => <tr key={r.clientKey}>
            <td><a href={href("clients", r.clientKey)}>{name(r.clientKey)}</a></td><td>{gbp(r.expected)}</td><td>{gbp(r.billed)}</td><td>{r.diff > 0 ? "+" : ""}{gbp(r.diff)}</td>
            <td>{r.state === "under" ? <span className="chip amber" title={r.billed === 0 ? "No invoices were found for this client in Xero. Check the Xero contact on the client's Invoices tab." : undefined}>{r.billed === 0 ? "Nothing invoiced found" : "Billed less than agreed"}</span> : r.state === "over" ? <span className="chip amber">{r.expected === 0 ? "Billed, nothing agreed" : "Billed more than agreed"}</span> : <span className="chip green">Matches</span>}</td>
          </tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}
