// Billing through Adfin: Settings › Adfin (connect), the Billing section of a client's fee schedule, and the practice-wide Billing page.
// Recurring invoices are made in Adfin as drafts and started one at a time, on purpose. Adfin collects the money and puts the invoices into Xero.
import { useEffect, useMemo, useRef, useState } from "react";
import { getAccessToken } from "../lib/auth";
import { todayIso } from "../lib/domain";
import { AdfinApi, AdfinCustomer, AdfinError, AdfinStatus, FakeAdfin, HttpAdfin } from "../lib/adfin";
import {
  ADFIN_CONNECTION_KEY, ADFIN_CUSTOMERS_KEY, ADFIN_SETTINGS_KEY, AML_STOPPED, CustomerLink, LINK_LABEL, Method, SetupInput, billingState, cancelSchedule, createCustomer, getCustomer, liveLinkFor, mandateOf, readAdfinSettings,
  readCustomerLinks, readLink, readRepeating, replaceSchedule, requestMandate, searchCustomers, setupProblems, setupSchedule, startSchedule, startSummary, syncLink, xeroOverlaps,
} from "../lib/billing";
import { FeeLine, periodLabel, readFeeLine } from "../lib/fees";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { Icon, href, useRoute } from "./bits";
import { isDemo, mailAllowed, outlookDraft, useCommsPrefs } from "./commsKit";
import { readSetting, useData } from "./data";
import { useSales } from "./salesKit";
import { useXero, useXeroLinks } from "./XeroSettings";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const msgOf = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't work. Try again.");
const gbp = (n: number) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (d: string) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

// The Adfin bridge and the daily keep-alive live in adfinKit, so the keep-alive (on every page) doesn't pull this whole screen into the first download.
export { useAdfin } from "./adfinKit";

export function useAdfinSettings() {
  const { data } = useData();
  return useMemo(() => readAdfinSettings(readSetting<unknown>(data.settings, ADFIN_SETTINGS_KEY)), [data.settings]);
}
export function useCustomerLinks() {
  const { data } = useData();
  return useMemo(() => readCustomerLinks(readSetting<unknown>(data.settings, ADFIN_CUSTOMERS_KEY)), [data.settings]);
}
export { useAdfinConnected } from "./adfinKit";
import { useAdfin, useAdfinConnected } from "./adfinKit";

const FAILED: Record<string, string> = {
  access_denied: "The connection was cancelled at Adfin.",
  expired: "The Adfin sign-in took longer than 15 minutes. Connect again.",
  "not-configured": "Adfin's client ID and secret aren't in Azure yet (see the steps below).",
  invalid_client: "Adfin didn't accept the client ID and secret in Azure. Check them with Adfin.",
  invalid_grant: "Adfin didn't accept the sign-in code. Check the redirect address below is the one Adfin registered for you, then connect again.",
  token: "Adfin didn't hand over the connection. Check the client secret in Azure, then connect again.",
  unreachable: "The app's server couldn't reach Adfin. Try again shortly.",
};

// ------------------------------------------------------------------ Settings › Adfin

export function AdfinSettings() {
  const { saveSetting } = useData();
  const api = useAdfin();
  const { parts } = useRoute();
  const settings = useAdfinSettings();
  const connected = useAdfinConnected();
  const [status, setStatus] = useState<AdfinStatus>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [vat, setVat] = useState(String(settings.vatRate));
  const [code, setCode] = useState(settings.accountCodeId);
  const [days, setDays] = useState(String(settings.termDays));
  useEffect(() => { void api.status().then(setStatus); }, [api]);

  const back = parts[2];
  const handled = useRef("");
  useEffect(() => {
    const sealed = parts.slice(3).join("/");
    if (back === "connected" && sealed && handled.current !== sealed) {
      handled.current = sealed;
      void (async () => {
        if (!isDemo()) await saveSetting(ADFIN_CONNECTION_KEY, sealed);
        history.replaceState(null, "", "#/settings/adfin");
        setNote("Connected to Adfin.");
      })();
    }
    if (back === "failed") {
      const c = parts[3] || "";
      setError(FAILED[c] || `Adfin didn't connect (${c}).`);
      history.replaceState(null, "", "#/settings/adfin");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back]);

  const connect = async () => {
    setBusy("Opening Adfin…"); setError(undefined); setNote(undefined);
    try { window.location.assign(await api.start()); } catch (e) { setBusy(""); setError(msgOf(e)); }
  };
  const disconnect = async () => {
    setBusy("Disconnecting…");
    try { await api.disconnect(); setNote("Disconnected from Adfin. Schedules already made stay in Adfin and keep running there."); } catch (e) { setError(msgOf(e)); } finally { setBusy(""); }
  };
  const saveSettings = async () => {
    const next = readAdfinSettings({ vatRate: Number(vat), accountCodeId: code, termDays: Number(days) });
    if (code.trim() && !next.accountCodeId) return setError("The account code ID should look like 69bd0549-2696-4a31-b1ed-66ac01abacf2. Adfin support can give you the ID of your sales account.");
    setError(undefined);
    await saveSetting(ADFIN_SETTINGS_KEY, next);
    setNote("Saved.");
  };
  const live = status?.environment === "production";
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <section className="card pad stack" aria-labelledby="adfin-h">
        <div className="card-title-row">
          <h2 id="adfin-h">Adfin</h2>
          <div className="row-wrap">
            {status && <span className={`chip ${live ? "red" : "amber"}`}>{isDemo() ? "Demo: nothing is sent" : live ? "Live Adfin" : "Adfin staging (test)"}</span>}
            {connected && <span className="chip green">Connected</span>}
            {connected && <button type="button" className="btn" disabled={!!busy} onClick={() => void disconnect()}>Disconnect</button>}
            <button type="button" className="btn primary" disabled={!!busy || status?.configured === false} onClick={() => void connect()}>{connected ? "Connect again" : "Connect to Adfin"}</button>
          </div>
        </div>
        <p className="muted" style={{ margin: 0 }}>Bill clients through Adfin from their fee schedule. Adfin makes the recurring invoice, collects by direct debit (or card and bank), and puts the invoices into Xero. A schedule is made as a draft and nothing is invoiced until you start it.</p>
        {busy && <p role="status" style={{ margin: 0 }}>{busy}</p>}
        {error && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{error}</p>}
        {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
        {status?.configured === false && <p className="import-list warn" role="note">Not set up on the server yet. The steps below say what Adfin and Azure need. Until then nothing here can reach Adfin.</p>}
      </section>

      <section className="card pad stack" aria-labelledby="adfin-s">
        <h3 id="adfin-s" style={{ margin: 0 }}>Invoice settings</h3>
        <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
          <label className="doc-field" style={{ width: 120 }}><span>VAT rate (%)</span><input className="input" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} /></label>
          <label className="doc-field" style={{ width: 160 }}><span>Days to pay</span><input className="input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
          <label className="doc-field" style={{ flex: "1 1 320px" }}><span>Sales account code ID (from Adfin)</span><input className="input" value={code} placeholder="needed so invoices land in the right Xero account" onChange={(e) => setCode(e.target.value)} /></label>
          <button type="button" className="btn" onClick={() => void saveSettings()}>Save</button>
        </div>
        {!settings.accountCodeId && <p className="import-list warn" role="note" style={{ margin: 0 }}>No account code yet. Schedules can still be made, but Adfin may not know which Xero sales account to use. Ask Adfin support for the ID of your sales account.</p>}
      </section>

      <section className="card pad stack" aria-labelledby="adfin-g">
        <h3 id="adfin-g" style={{ margin: 0 }}>Getting set up</h3>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>Ask Adfin support for API credentials (staging first). They need your company name and website, a technical contact, and this redirect address: <code>{status?.redirectUri || "(shown once the server is running)"}</code></li>
          <li>Put the client ID and secret into Azure as <code>ADFIN_CLIENT_ID</code> and <code>ADFIN_CLIENT_SECRET</code>. Keep <code>ADFIN_ENV</code> unset (staging) until you have tested.</li>
          <li>Press Connect to Adfin and sign in with your Adfin account.</li>
          <li>Ask Adfin for your sales account code ID and enter it above.</li>
          <li>When staging works, ask Adfin for production credentials and set <code>ADFIN_ENV=production</code>.</li>
        </ol>
        <p className="muted" style={{ margin: 0 }}>The connection is kept sealed: only the app's server can open it, and the app renews it about daily because Adfin drops a connection unused for 5 days. If it ever says to connect again, do so; schedules in Adfin keep running regardless.</p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ the customer for a client

function useCustomerState(clientKey: string) {
  const api = useAdfin();
  const { saveSetting } = useData();
  const links = useCustomerLinks();
  const link: CustomerLink | undefined = links[clientKey];
  const [customer, setCustomer] = useState<AdfinCustomer>();
  const [err, setErr] = useState<string>();
  const reload = async () => {
    if (!link || !api.connected()) return setCustomer(undefined);
    try { setCustomer(await getCustomer(api, link.id)); setErr(undefined); } catch (e) { setErr(msgOf(e)); }
  };
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [link?.id, api.connected()]);
  const save = (c: AdfinCustomer | undefined) => { const next = { ...links }; if (c) next[clientKey] = { id: c.id, name: c.name }; else delete next[clientKey]; return saveSetting(ADFIN_CUSTOMERS_KEY, next); };
  return { api, link, customer, err, reload, save };
}

function CustomerPicker({ client, onDone, state }: { client: Row; onDone: () => void; state: ReturnType<typeof useCustomerState> }) {
  const [text, setText] = useState(str(client.Title));
  const [found, setFound] = useState<AdfinCustomer[]>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [email, setEmail] = useState(str(client.Email));
  const search = async () => { setBusy(true); setErr(""); try { setFound(await searchCustomers(state.api, text)); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
  const pick = async (c: AdfinCustomer) => { setBusy(true); try { await state.save(c); onDone(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
  const make = async () => { setBusy(true); setErr(""); try { const c = await createCustomer(state.api, str(client.Title), email); await state.save(c); onDone(); } catch (e) { setErr(msgOf(e)); } finally { setBusy(false); } };
  return (
    <div className="card stack" style={{ padding: 10, gap: 8 }} role="group" aria-label="Choose the Adfin customer">
      <p className="muted" style={{ margin: 0 }}>Choose the customer this client already is in Adfin (customers synced from Xero are there already, with any direct debit they have signed). Only make a new one if there is none, so nobody is billed twice.</p>
      <div className="row-wrap" style={{ gap: 8 }}>
        <input className="input" aria-label="Search Adfin customers" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
        <button type="button" className="btn small" disabled={busy} onClick={() => void search()}>Search Adfin</button>
        <button type="button" className="linkbtn" onClick={onDone}>Close</button>
      </div>
      {found && !found.length && <p className="muted" style={{ margin: 0 }}>Adfin has no customer matching that.</p>}
      {found?.map((c) => { const m = mandateOf(c); return (
        <div key={c.id} className="row-wrap" style={{ gap: 8, justifyContent: "space-between" }}>
          <span><strong>{c.name}</strong> <span className="muted">· {c.people?.[0]?.email || "no email"} · {m.label}</span></span>
          <button type="button" className="btn small" disabled={busy} onClick={() => void pick(c)}>Use this one</button>
        </div>
      ); })}
      <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
        <label className="doc-field" style={{ flex: "1 1 240px" }}><span>Or make a new customer for {str(client.Title)}. Email:</span><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <button type="button" className="btn small" disabled={busy} onClick={() => void make()}>Make new customer</button>
      </div>
      {err && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ on a client's fee schedule

export function ClientBilling({ client, lines, doW, busy }: { client: Row; lines: { line: FeeLine }[]; doW: (w: any, ok?: string) => void; busy: boolean }) {
  const s = useSales();
  const { data, store } = useData();
  const connected = useAdfinConnected();
  const settings = useAdfinSettings();
  const ck = str(client.Key);
  const cust = useCustomerState(ck);
  const prefs = useCommsPrefs();
  const can = s.pcan("send");
  const [choosing, setChoosing] = useState(false);
  const [working, setWorking] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const eligible = lines.map((x) => x.line).filter((l) => l.status === "active" || data.billingLinks.some((r) => str(r.FeeKey) === l.key && readLink(r).status !== "cancelled"));
  const svc = (k: string) => str(data.services.find((x) => x.Key === k)?.Title) || k;
  const rows = data.billingLinks.filter((r) => str(r.ClientKey) === ck);
  if (!can && !rows.length) return null;
  if (!eligible.length && !rows.length) return null;
  const mandate = mandateOf(cust.customer);

  const wrap = async (label: string, fn: () => Promise<void>) => { setWorking(label); setErr(""); setNote(""); try { await fn(); } catch (e) { setErr(msgOf(e)); } finally { setWorking(""); } };
  const askMandate = () => wrap("Asking Adfin for a direct debit link…", async () => {
    if (!cust.link) throw new Error("Choose the Adfin customer first.");
    const r = await requestMandate(cust.api, cust.link.id);
    const to = str(client.Email);
    if (to && mailAllowed()) {
      const first = str(client.ContactPreferred || client.ContactFirst) || "there";
      await outlookDraft(store.graph, { to, subject: "Setting up your direct debit", body: `Hello ${first},\n\nTo pay our fees by direct debit, please set up the mandate here. It takes about two minutes and you enter your bank details on the bank-secure page, not with us:\n\n${r.url}\n\nThank you.`, signature: prefs.emailSignature });
      setNote("A draft email with the direct debit link is in your Outlook drafts. Check it, then send it.");
    } else setNote(`Direct debit link: ${r.url}. Send it to the client (Outlook drafts aren't available, or the client has no email on file).`);
    await cust.reload();
  });
  return (
    <div className="stack" style={{ gap: 8 }} role="group" aria-label="Billing through Adfin">
      {!!str(client.AmlStopped) && <div className="alert" role="alert"><strong>AML due diligence not completed.</strong> {AML_STOPPED}</div>}
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <strong>Billing through Adfin</strong>
        <a href={href("settings", "adfin")} className="muted">Adfin settings</a>
      </div>
      {!connected && <p className="import-list warn" role="note" style={{ margin: 0 }}>Adfin isn't connected, so billing can't be set up or checked yet. <a href={href("settings", "adfin")}>Connect it in Settings › Adfin</a>.</p>}
      {connected && (
        <div className="row-wrap" style={{ gap: 8 }}>
          <span>Adfin customer: {cust.link ? <strong>{cust.link.name}</strong> : <span className="muted">not chosen</span>}</span>
          {cust.link && <span className={`chip ${mandate.state === "active" ? "green" : mandate.state === "none" || mandate.state === "ended" ? "amber" : ""}`}>{cust.customer ? mandate.label : "checking…"}</span>}
          {can && <button type="button" className="linkbtn" onClick={() => setChoosing(!choosing)}>{cust.link ? "Change" : "Choose customer"}</button>}
          {can && cust.link && mandate.state !== "active" && mandate.state !== "waiting" && <button type="button" className="btn small" disabled={!!working} onClick={() => void askMandate()}>Request direct debit</button>}
          {mandate.state === "waiting" && mandate.mandate?.url && <a href={mandate.mandate.url} target="_blank" rel="noreferrer">Sign-up link</a>}
        </div>
      )}
      {cust.err && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{cust.err}</p>}
      {choosing && connected && <CustomerPicker client={client} state={cust} onDone={() => { setChoosing(false); void cust.reload(); }} />}
      {working && <p role="status" style={{ margin: 0 }}>{working}</p>}
      {err && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{err}</p>}
      {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
      {connected && eligible.map((line) => (
        <FeeBilling key={line.key} client={client} line={line} serviceName={svc(line.serviceKey)} customer={cust.link} settings={settings} can={can} busy={busy || !!working} doW={doW} wrap={wrap} />
      ))}
    </div>
  );
}

function FeeBilling({ client, line, serviceName, customer, settings, can, busy, doW, wrap }: { client: Row; line: FeeLine; serviceName: string; customer?: CustomerLink; settings: ReturnType<typeof useAdfinSettings>; can: boolean; busy: boolean; doW: (w: any, ok?: string) => void; wrap: (label: string, fn: () => Promise<void>) => Promise<void> }) {
  const { data } = useData();
  const s = useSales();
  const api = useAdfin();
  const today = todayIso();
  const row = liveLinkFor(data.billingLinks, line.key) || data.billingLinks.filter((r) => str(r.FeeKey) === line.key).sort((a, b) => str(b.Created).localeCompare(str(a.Created)))[0];
  const b = billingState(line, row);
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>("direct-debit");
  const [start, setStart] = useState(() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); });
  const [desc, setDesc] = useState(`${serviceName}, ${periodLabel(line.period).toLowerCase()} fee`);
  const [confirmXero, setConfirmXero] = useState(false);
  const [starting, setStarting] = useState(false);
  const [checked, setChecked] = useState(false);
  const [cancelWhy, setCancelWhy] = useState<string | null>(null);
  const xeroLinks = useXeroLinks();
  const xero = useXero();
  const [overlap, setOverlap] = useState<{ contact: string; total: number; status: string }[]>([]);
  const input: SetupInput = { line, clientName: str(client.Title), customerId: customer?.id || "", method, startDate: start, description: desc, today, settings, amlStopped: !!str(client.AmlStopped) };
  const problems = setupProblems(input);
  useEffect(() => {
    if (!open || !xeroLinks.practice) return;
    let off = false;
    void xero.get(xeroLinks.practice.tenantId, "accounting", "RepeatingInvoices").then((d) => { if (!off) setOverlap(xeroOverlaps(str(client.Title), readRepeating(d))); }).catch(() => undefined);
    return () => { off = true; };
  }, [open, xeroLinks.practice?.tenantId]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = b.state !== "none" && b.state !== "cancelled";
  return (
    <div className="card" style={{ padding: 10 }} role="group" aria-label={`Billing for ${serviceName}`}>
      <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <span><strong>{serviceName}</strong> · {gbp(line.fee)} {periodLabel(line.period).toLowerCase()} + VAT</span>
        <span className="row-wrap" style={{ gap: 6 }}>
          <span className={`chip ${b.state === "active" ? "green" : b.state === "draft" ? "amber" : ""}`}>{b.state === "none" ? "Not billed through Adfin" : LINK_LABEL[b.state]}</span>
          {b.link?.scheduleNo && <span className="muted">{b.link.scheduleNo}</span>}
          {b.link && b.state === "active" && b.link.nextDate && <span className="muted">next invoice {fmt(b.link.nextDate)}</span>}
        </span>
      </div>
      {b.drift.map((d) => <p key={d} className="import-list warn" role="alert" style={{ margin: "6px 0 0" }}>{d}</p>)}
      {shown && can && (
        <div className="row-wrap" style={{ gap: 8, marginTop: 6 }}>
          {b.state === "draft" && !b.drift.length && <button type="button" className="btn small primary" disabled={busy} onClick={() => { setStarting(!starting); setChecked(false); }}>Review and start billing</button>}
          {b.drift.length > 0 && <button type="button" className="btn small primary" disabled={busy || problems.length > 0} title={problems[0]} onClick={() => wrap("Replacing the schedule…", async () => { doW(await replaceSchedule(api, client, row!, input, customer?.name || "", s.pcan, s.ctx()), "A new draft schedule was made and the old one cancelled. Review and start the new one."); })}>Replace with the current fee (new draft)</button>}
          <button type="button" className="linkbtn" disabled={busy} onClick={() => wrap("Checking Adfin…", async () => { const r = await syncLink(api, row!, new Date().toISOString()); if (r.missing) throw new Error("Adfin has no record of this schedule. Check Adfin."); if (r.patch) await s.apply({ patches: [{ list: "BillingLinks", row: row!, patch: r.patch }], log: [], activities: [] }); })}>Refresh from Adfin</button>
          <button type="button" className="linkbtn" disabled={busy} onClick={() => setCancelWhy(cancelWhy === null ? "" : null)}>Cancel schedule</button>
        </div>
      )}
      {starting && b.link && (
        <div className="import-list" role="group" aria-label="Start billing" style={{ marginTop: 8 }}>
          <p style={{ margin: 0 }}><strong>This will start billing a real client.</strong> {startSummary(b.link, str(client.Title))}</p>
          <label className="row-wrap" style={{ gap: 6, marginTop: 6 }}><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I have checked the amount, the customer and the start date.</label>
          <div className="row-wrap" style={{ gap: 8, marginTop: 6 }}>
            <button type="button" className="btn small primary" disabled={busy || !checked} onClick={() => wrap("Starting billing…", async () => { doW(await startSchedule(api, client, row!, line, s.pcan, s.ctx()), "Billing started. Adfin will issue the first invoice on the start date."); setStarting(false); })}>Start billing</button>
            <button type="button" className="linkbtn" onClick={() => setStarting(false)}>Not yet</button>
          </div>
        </div>
      )}
      {cancelWhy !== null && (
        <div className="row-wrap" style={{ gap: 8, marginTop: 8 }}>
          <input className="input" aria-label="Why cancel the schedule" placeholder="Why?" value={cancelWhy} onChange={(e) => setCancelWhy(e.target.value)} />
          <button type="button" className="btn small" disabled={busy} onClick={() => wrap("Cancelling…", async () => { doW(await cancelSchedule(api, client, row!, cancelWhy, s.pcan, s.ctx()), "Schedule cancelled in Adfin. Invoices already issued are not affected."); setCancelWhy(null); })}>Cancel it in Adfin</button>
        </div>
      )}
      {!shown && can && line.status === "active" && (
        !open ? <div style={{ marginTop: 6 }}><button type="button" className="btn small" onClick={() => setOpen(true)} disabled={!customer} title={customer ? "" : "Choose the Adfin customer first"}>Set up billing</button>{!customer && <span className="muted"> Choose the Adfin customer first.</span>}</div> : (
          <div className="stack" style={{ gap: 8, marginTop: 8 }}>
            <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
              <label className="doc-field" style={{ flex: "2 1 260px" }}><span>Invoice wording</span><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
              <label className="doc-field" style={{ width: 170 }}><span>First invoice on</span><input className="input" type="date" min={today} value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label className="doc-field" style={{ width: 200 }}><span>Collected by</span><select className="input" value={method} onChange={(e) => setMethod(e.target.value as Method)}><option value="direct-debit">Direct debit</option><option value="on-demand">Card or bank (client pays the link)</option></select></label>
            </div>
            <p className="muted" style={{ margin: 0 }}>{gbp(line.fee)} + VAT {periodLabel(line.period).toLowerCase()}, from {fmt(start)}. It is made as a <strong>draft</strong> in Adfin: nothing is invoiced until you start it.</p>
            {overlap.length > 0 && (
              <div className="import-list warn" role="alert">
                <strong>Xero already has a repeating invoice for this name:</strong> {overlap.map((o) => `${o.contact} ${gbp(o.total)} (${o.status.toLowerCase()})`).join(", ")}. Billing it here as well would bill the client twice. Stop the one in Xero before you start this one.
                <label className="row-wrap" style={{ gap: 6, marginTop: 6 }}><input type="checkbox" checked={confirmXero} onChange={(e) => setConfirmXero(e.target.checked)} /> I understand and will deal with the Xero one.</label>
              </div>
            )}
            {problems.length > 0 && <ul role="status" className="muted" style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            <div className="row-wrap" style={{ gap: 8 }}>
              <button type="button" className="btn small primary" disabled={busy || problems.length > 0 || (overlap.length > 0 && !confirmXero)} onClick={() => wrap("Making the draft in Adfin…", async () => { doW(await setupSchedule(api, client, input, data.billingLinks, customer?.name || "", s.pcan, s.ctx()), "Draft schedule made in Adfin. Nothing is invoiced yet: review and start it below."); setOpen(false); })}>Make the draft schedule</button>
              <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the practice-wide Billing page

export function BillingPage() {
  const { data } = useData();
  const s = useSales();
  const api = useAdfin();
  const connected = useAdfinConnected();
  const [filter, setFilter] = useState<"all" | "none" | "draft" | "active" | "drift">("all");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const clientName = (k: string) => str(data.clients.find((c) => c.Key === k)?.Title) || k;
  const svc = (k: string) => str(data.services.find((x) => x.Key === k)?.Title) || k;
  const rows = useMemo(() => data.clientServices.map((r) => ({ r, line: readFeeLine(r) })).filter((x) => x.line.status === "active" && !x.line.oneOff && x.line.fee > 0).map((x) => {
    const link = liveLinkFor(data.billingLinks, x.line.key);
    return { ...x, b: billingState(x.line, link), linkRow: link };
  }), [data.clientServices, data.billingLinks]);
  const counts = { none: rows.filter((x) => x.b.state === "none").length, draft: rows.filter((x) => x.b.state === "draft").length, active: rows.filter((x) => x.b.state === "active").length, drift: rows.filter((x) => x.b.drift.length).length };
  const endedButBilled = data.billingLinks.map(readLink).filter((l) => l.status === "active" || l.status === "draft").filter((l) => { const f = data.clientServices.find((c) => str(c.Key) === l.feeKey); return f && readFeeLine(f).status === "ended"; });
  const shown = rows.filter((x) => filter === "all" || (filter === "drift" ? x.b.drift.length > 0 : x.b.state === filter)).sort((a, b) => clientName(a.line.clientKey).localeCompare(clientName(b.line.clientKey)));
  const monthly = rows.filter((x) => x.b.state === "active").reduce((a, x) => a + x.line.annual / 12, 0);
  const refreshAll = async () => {
    setBusy("Checking each schedule in Adfin…"); setErr("");
    try {
      for (const x of rows.filter((y) => y.linkRow)) {
        const r = await syncLink(api, x.linkRow!, new Date().toISOString());
        if (r.patch) await s.apply({ patches: [{ list: "BillingLinks", row: x.linkRow!, patch: r.patch }], log: [], activities: [] });
      }
    } catch (e) { setErr(msgOf(e)); } finally { setBusy(""); }
  };
  if (!s.can("view")) return null;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="import-list" role="note"><strong>Billing through Adfin.</strong> Adfin makes each recurring invoice, collects the money and puts the invoice into Xero. A schedule is started one at a time from the client's fee schedule. {rows.length ? `${counts.active} of ${rows.length} recurring fees are billing now (${gbp(monthly)} a month in all), ${counts.draft} are drafts waiting to be started and ${counts.none} are not set up.` : "There are no recurring fees to bill yet."}</div>
      {!connected && <p className="import-list warn" role="note" style={{ margin: 0 }}>Adfin isn't connected. <a href={href("settings", "adfin")}>Connect it in Settings › Adfin</a> to set up or check billing.</p>}
      {endedButBilled.length > 0 && <p className="import-list warn" role="alert" style={{ margin: 0 }}><strong>Still billing after the fee ended:</strong> {endedButBilled.map((l) => `${clientName(l.clientKey)} (${l.scheduleNo})`).join(", ")}. Cancel these from the client's fee schedule.</p>}
      <div className="row-wrap" style={{ gap: 8 }}>
        {([["all", `All (${rows.length})`], ["none", `Not set up (${counts.none})`], ["draft", `Drafts (${counts.draft})`], ["active", `Billing (${counts.active})`], ["drift", `Needs attention (${counts.drift})`]] as const).map(([k, l]) => <button key={k} type="button" className="btn small" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
        <button type="button" className="btn small" disabled={!connected || !!busy} onClick={() => void refreshAll()}><Icon name="refresh" /> Check Adfin</button>
        {busy && <span role="status" className="muted">{busy}</span>}
      </div>
      {err && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{err}</p>}
      {!shown.length ? <p className="muted">Nothing to show.</p> : (
        <div className="card" style={{ overflowX: "auto" }}><table className="grid">
          <thead><tr><th>Client</th><th>Service</th><th>Fee</th><th>Billing</th><th>Next invoice</th><th>Attention</th></tr></thead>
          <tbody>{shown.map((x) => (
            <tr key={x.line.key}>
              <td><a href={href("clients", x.line.clientKey)}>{clientName(x.line.clientKey)}</a></td><td>{svc(x.line.serviceKey)}</td>
              <td>{gbp(x.line.fee)} <span className="muted">{periodLabel(x.line.period).toLowerCase()}</span></td>
              <td><span className={`chip ${x.b.state === "active" ? "green" : x.b.state === "draft" ? "amber" : ""}`}>{x.b.state === "none" ? "Not set up" : LINK_LABEL[x.b.state]}</span></td>
              <td>{x.b.link?.nextDate ? fmt(x.b.link.nextDate) : "—"}</td>
              <td>{x.b.drift[0] ? <span className="chip red" title={x.b.drift.join(" ")}>{x.b.drift[0]}</span> : ""}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
