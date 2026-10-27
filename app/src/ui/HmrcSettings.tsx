// Settings › HMRC: connect the practice's HMRC agent account (VAT / MTD first) and, in the sandbox,
// try a request on a client. Corporation Tax and PAYE are guided steps until HMRC confirms access.
import { useEffect, useRef, useState } from "react";
import { Row } from "../lib/schema";
import { getAccessToken } from "../lib/auth";
import { HmrcError, HmrcStatus, HttpHmrc, Invitation } from "../lib/hmrc";
import { AuthRecord, STATUS_CHIP, STATUS_LABEL, SOURCE_LABEL, auditRow, fromHmrcStatus, nextAction, readRecord, vatInvitation, vatProblems } from "../lib/hmrcAuth";
import { newKey } from "../lib/planning";
import { fmtDate, todayIso } from "../lib/domain";
import { useRoute } from "./bits";
import { isDemo } from "./commsKit";
import { readSetting, useData } from "./data";

const latest: { settings: Row[]; saveSetting?: (key: string, value: unknown) => Promise<void> } = { settings: [] };
let api: HttpHmrc | null = null;
let pending: string | undefined | null = null;
function useHmrc(): HttpHmrc {
  const { data, saveSetting } = useData();
  if (latest.settings !== data.settings) {
    latest.settings = data.settings;
    if (pending !== null && (readSetting<string>(data.settings, "hmrc.connection") || undefined) === (pending || undefined)) pending = null;
  }
  latest.saveSetting = saveSetting;
  if (!api) {
    api = new HttpHmrc(getAccessToken, {
      read: () => (pending !== null ? pending : readSetting<string>(latest.settings, "hmrc.connection")) || undefined,
      write: async (s) => { pending = s ?? ""; await latest.saveSetting?.("hmrc.connection", s ?? ""); },
    });
  }
  return api;
}

const FAILED: Record<string, string> = {
  access_denied: "The connection was cancelled at HMRC.",
  expired: "The HMRC sign-in took longer than 15 minutes. Connect again.",
  "not-configured": "The HMRC application's client ID and secret (or the token store setting) aren't in Azure yet.",
  invalid_client: "HMRC didn't accept the client ID and secret in Azure. Check them on the Developer Hub.",
  invalid_grant: "HMRC didn't accept the sign-in code. Check the redirect URI on the Developer Hub matches the one shown here, then connect again.",
  invalid_request: "HMRC didn't accept the request. Check the redirect URI on the Developer Hub matches the one shown here.",
  unreachable: "The app's server couldn't reach HMRC. Try again shortly.",
};
const say = (e: unknown) => (e instanceof HmrcError || e instanceof Error ? e.message : "That didn't work. Try again.");

export function HmrcSettings() {
  const { data, saveSetting } = useData();
  const hmrc = useHmrc();
  const [status, setStatus] = useState<HmrcStatus | null>(null);
  const [arn, setArn] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const parts = useRoute().parts;
  const handled = useRef("");
  const demo = isDemo();

  const load = async () => {
    try { const s = await hmrc.status(); setStatus(s); if (s.arn) setArn(s.arn); } catch (e) { setError(say(e)); }
  };
  useEffect(() => { if (!demo) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [demo]);

  const back = parts[2];
  useEffect(() => {
    const sealed = parts.slice(3).join("/");
    if (back === "connected" && sealed && handled.current !== sealed) {
      handled.current = sealed;
      void (async () => { await saveSetting("hmrc.connection", sealed); history.replaceState(null, "", "#/settings/hmrc"); setNote("Connected to HMRC."); await load(); })();
    } else if (back === "connected" && !sealed) { history.replaceState(null, "", "#/settings/hmrc"); setNote("Connected to HMRC."); void load(); }
    if (back === "failed") { const c = parts[3] || ""; setError(FAILED[c] || `HMRC didn't connect (${c}).`); history.replaceState(null, "", "#/settings/hmrc"); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back]);

  const run = async (label: string, work: () => Promise<void>) => { setBusy(label); setError(""); setNote(""); try { await work(); } catch (e) { setError(say(e)); } finally { setBusy(""); } };
  const saveArn = () => run("Saving…", async () => { await hmrc.setArn(arn.trim()); setNote("Agent Reference Number saved."); await load(); });
  const connect = () => run("Taking you to HMRC…", async () => { window.location.assign(await hmrc.start()); });
  const disconnect = () => run("Disconnecting…", async () => { await hmrc.disconnect(); setNote("Disconnected. HMRC may still list the connection under the agent's account."); await load(); });

  const sandbox = status?.env !== "production";
  const canTry = !!status?.connected && !!status.arn;
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <section className="card pad stack" aria-labelledby="hmrc-h">
        <div className="card-title-row">
          <h2 id="hmrc-h">HMRC agent authorisations</h2>
          {status && <span className={`chip ${sandbox ? "amber" : "green"}`}>{sandbox ? "Sandbox (test data only)" : "Production"}</span>}
        </div>
        <p className="muted" style={{ margin: 0 }}>Ask clients to authorise the practice with HMRC and see HMRC's own answer. Only a status read back from HMRC counts as confirmed; anything recorded by hand is labelled as not checked.</p>
        {demo && <div className="alert amber"><strong>Not available in the demo</strong><span>The HMRC connection needs the real app's server. Nothing here talks to HMRC in the demo.</span></div>}
        {busy && <p className="muted" role="status" style={{ margin: 0 }}>{busy}</p>}
        {note && !busy && <p className="muted" role="status" style={{ margin: 0 }}>{note}</p>}
        {error && <div className="alert red" role="alert"><strong>HMRC</strong><span>{error}</span></div>}
        {!demo && status && !status.configured && <div className="alert amber"><strong>Not set up yet</strong><span>The HMRC application's client ID and secret need adding to Azure (HMRC_CLIENT_ID, HMRC_CLIENT_SECRET). Steps below.</span></div>}
        {!demo && status?.configured && !status.storeConfigured && <div className="alert amber"><strong>Nowhere to keep the HMRC sign-in</strong><span>Add the Azure setting HMRC_TOKEN_STORE = sealed to keep it, encrypted, in the app's settings. That is for testing on the practice's own data; a stronger store is recommended before real use.</span></div>}
        {!demo && status?.sealedStore && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Testing mode: the sign-in is kept encrypted in the app's settings. Only the app's server can open it.</p>}
        {!demo && status?.configured && status.storeConfigured && (
          <div className="stack" style={{ gap: 10 }}>
            <div className="inline-form">
              <label className="doc-field" style={{ minWidth: 240 }}><span>Agent Reference Number (ARN)</span><input className="input" value={arn} onChange={(e) => setArn(e.target.value)} placeholder={sandbox ? "From Create Test User, e.g. TARN0000001" : "e.g. XARN1234567"} /></label>
              <button type="button" className="btn" disabled={!!busy || !arn.trim()} onClick={() => void saveArn()}>Save ARN</button>
            </div>
            <div className="row-wrap">
              <span className={`chip ${status.connected ? "green" : "red"}`}>{status.connected ? "Connected" : "Not connected"}</span>
              {status.connected && status.since && <span className="muted" style={{ fontSize: 13 }}>since {fmtDate(status.since.slice(0, 10))}</span>}
              <button type="button" className="btn primary" disabled={!!busy} onClick={() => void connect()}>{status.connected ? "Reconnect" : "Connect to HMRC"}</button>
              {status.connected && <button type="button" className="btn" disabled={!!busy} onClick={() => void disconnect()}>Disconnect</button>}
            </div>
            {status.connected && !status.arn && <p className="muted" style={{ margin: 0 }}>Add the ARN above to send requests.</p>}
          </div>
        )}
      </section>

      {canTry && sandbox && <TryVat hmrc={hmrc} />}

      <section className="card pad stack" aria-labelledby="ctpaye-h">
        <h3 id="ctpaye-h" style={{ margin: 0 }}>Corporation Tax and Employer PAYE</h3>
        <span className="chip amber" style={{ width: "fit-content" }}>Guided steps only</span>
        <p className="muted" style={{ margin: 0 }}>HMRC publishes technical specifications for these two but hasn't confirmed that new software can use them, so there is no direct connection. They work as guided steps (check the details, open HMRC's service, record the postal code, record what you've seen), clearly marked as not checked with HMRC. See the feasibility report for the questions to put to HMRC.</p>
      </section>

      <section className="card pad stack" aria-labelledby="hmrc-setup-h">
        <h3 id="hmrc-setup-h" style={{ margin: 0 }}>Setting up (sandbox)</h3>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li>On HMRC's Developer Hub, create an application and subscribe it to: VAT (MTD), Create Test User, Agent Authorisation, Agent Authorisation Test Support.</li>
          <li>Add the redirect URI <code>{status?.redirectUri || "https://<this app>/api/hmrc/callback"}</code> to the application.</li>
          <li>In Azure, add <code>HMRC_CLIENT_ID</code>, <code>HMRC_CLIENT_SECRET</code>, <code>HMRC_ENV=sandbox</code> and <code>HMRC_TOKEN_STORE=sealed</code>.</li>
          <li>On the Developer Hub create a test <em>agent</em> (Create Test User). Use its Agent Reference Number above, and sign in with its user ID and password when you press Connect.</li>
          <li>Create a test <em>organisation</em> with VAT and put its VAT number and registration date on a client here, then try a request below.</li>
        </ol>
        <p className="muted" style={{ margin: 0 }}>Use test details only in the sandbox. Never use the practice's real Government Gateway sign-in here.</p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ try a request on a client (sandbox)

function TryVat({ hmrc }: { hmrc: HttpHmrc }) {
  const { data, user, create, update } = useData();
  const [client, setClient] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [inv, setInv] = useState<Invitation | null>(null);
  const today = todayIso();
  const c = data.clients.find((x) => x.Key === client);
  const rec = data.hmrcAuths.filter((r) => r.ClientKey === client && r.Service === "vat").sort((a, b) => String(b.Created).localeCompare(String(a.Created)))[0];
  const r: AuthRecord | undefined = rec ? readRecord(rec) : undefined;
  const problems = c ? vatProblems(c, today) : [];
  const withVat = data.clients.filter((x) => String(x.VATNumber || "").trim());

  const log = (type: Parameters<typeof auditRow>[0]["type"], summary: string, st?: AuthRecord["status"], id?: string) =>
    create("HmrcAuthEvents", auditRow({ key: newKey("HE"), clientKey: client, service: "vat", type, summary, user: user || "", at: new Date().toISOString(), status: st, source: "hmrc", hmrcId: id }));
  const run = async (label: string, work: () => Promise<void>) => { setBusy(label); setError(""); setMsg(""); try { await work(); } catch (e) { setError(say(e)); } finally { setBusy(""); } };

  const send = () => run("Sending to HMRC…", async () => {
    if (!c || problems.length) return;
    const got = await hmrc.invite(vatInvitation(c) as never);
    setInv(got);
    const st = fromHmrcStatus(got.status) || "awaiting-client";
    const now = new Date().toISOString();
    await create("HmrcAuthorisations", { Key: newKey("HA"), ClientKey: client, Service: "vat", TaxRef: String(c.VATNumber), Method: "api", HmrcId: got.id, Status: st, StatusSource: "hmrc", Requested: now.slice(0, 10), Expires: got.expiresOn.slice(0, 10), AuthorisedOn: "", LastChecked: now, Owner: user || "", OnboardingKey: "", Env: "sandbox", Notes: "", Created: now, Updated: now });
    await log("submitted", "VAT authorisation request sent to HMRC", st, got.id);
    setMsg(got.note || "Sent to HMRC. The client now has to approve it: this is not authorised yet.");
  });
  const check = () => run("Asking HMRC…", async () => {
    if (!rec || !r) return;
    const got = await hmrc.check(r.hmrcId);
    setInv(got);
    const st = fromHmrcStatus(got.status);
    const now = new Date().toISOString();
    if (!st) { await update("HmrcAuthorisations", rec, { LastChecked: now, Updated: now }); setMsg(`HMRC says "${got.status || "no status"}", which this app doesn't recognise, so the record is unchanged.`); return; }
    await update("HmrcAuthorisations", rec, { Status: st, StatusSource: "hmrc", Expires: (got.expiresOn || r.expires).slice(0, 10), AuthorisedOn: st === "authorised" ? now.slice(0, 10) : "", LastChecked: now, Updated: now });
    await log(st === "authorised" ? "confirmed" : "hmrc-response", `HMRC reports: ${got.status}`, st, r.hmrcId);
    setMsg(st === "authorised" ? "HMRC confirms the client has authorised the practice." : `HMRC reports: ${got.status}.`);
  });
  const cancel = () => run("Cancelling…", async () => {
    if (!rec || !r) return;
    await hmrc.cancel(r.hmrcId);
    const now = new Date().toISOString();
    await update("HmrcAuthorisations", rec, { Status: "cancelled", StatusSource: "hmrc", LastChecked: now, Updated: now });
    await log("cancelled", "Request cancelled with HMRC", "cancelled", r.hmrcId);
    setMsg("Cancelled with HMRC.");
  });
  const accept = () => run("Accepting (test)…", async () => { if (r) { await hmrc.sandboxAccept(r.hmrcId); setMsg("Test acceptance sent. Now check the status."); } });
  const copy = (t: string) => void navigator.clipboard?.writeText(t).then(() => setMsg("Link copied."));

  const link = inv && inv.id === r?.hmrcId ? inv.clientActionUrl : "";
  const open = r && (r.status === "awaiting-client");
  const next = r ? nextAction(r, today) : undefined;
  return (
    <section className="card pad stack" aria-labelledby="try-h">
      <h3 id="try-h" style={{ margin: 0 }}>Try a VAT request (sandbox)</h3>
      <p className="muted" style={{ margin: 0 }}>Sends a real request to HMRC's <strong>test</strong> service for a client whose VAT number and registration date are test details. Nothing here reaches a real taxpayer.</p>
      <label className="doc-field" style={{ maxWidth: 360 }}><span>Client</span><select className="input" value={client} onChange={(e) => { setClient(e.target.value); setInv(null); setMsg(""); setError(""); }}><option value="">Choose a client with a VAT number…</option>{withVat.map((x) => <option key={String(x.Key)} value={String(x.Key)}>{String(x.Title)}</option>)}</select></label>
      {c && !r && (problems.length ? <ul className="plain error-text" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : <div><button type="button" className="btn primary" disabled={!!busy} onClick={() => void send()}>Send VAT request to HMRC</button></div>)}
      {r && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row-wrap"><span className={`chip ${STATUS_CHIP[r.status]}`}>{STATUS_LABEL[r.status]}</span><span className="muted" style={{ fontSize: 13 }}>{SOURCE_LABEL[r.source]}</span></div>
          <div className="muted" style={{ fontSize: 13 }}>HMRC reference {r.hmrcId} · requested {fmtDate(r.requested)}{r.expires ? ` · expires ${fmtDate(r.expires)}` : ""}{r.checked ? ` · last checked ${fmtDate(r.checked.slice(0, 10))}` : ""}</div>
          {next && next.action !== "None" && <div style={{ fontSize: 13 }}>Next: {next.action}</div>}
          {link && <div className="row-wrap"><a href={link} target="_blank" rel="noreferrer">Client approval link</a><button type="button" className="linkbtn" onClick={() => copy(link)}>Copy</button></div>}
          <div className="row-wrap">
            <button type="button" className="btn" disabled={!!busy} onClick={() => void check()}>Check status with HMRC</button>
            {open && <button type="button" className="btn" disabled={!!busy} onClick={() => void cancel()}>Cancel request</button>}
            {open && <button type="button" className="btn" disabled={!!busy} onClick={() => void accept()}>Accept as the test client</button>}
            {r.status !== "awaiting-client" && !problems.length && <button type="button" className="btn" disabled={!!busy} onClick={() => void send()}>Start a new request</button>}
          </div>
        </div>
      )}
      {busy && <p className="muted" role="status" style={{ margin: 0 }}>{busy}</p>}
      {msg && !busy && <p role="status" style={{ margin: 0 }}>{msg}</p>}
      {error && <div className="alert red" role="alert"><strong>HMRC</strong><span>{error}</span></div>}
    </section>
  );
}
