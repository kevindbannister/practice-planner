// Settings › Xero: setting up the Xero app, choosing what to read, connecting, and linking each
// Xero organisation to its client in Practice Planner.
import { useEffect, useRef, useState } from "react";
import { Row } from "../lib/schema";
import { getAccessToken } from "../lib/auth";
import { FakeXero } from "../lib/fakeXero";
import { DEFAULT_OPTIONS, HttpXero, SCOPE_GROUPS, XeroApi, XeroError, XeroOptions, XeroStatus, XeroTenant, matchClient, scopesFor } from "../lib/xero";
import { Icon, href, useRoute } from "./bits";
import { isDemo } from "./commsKit";
import { readSetting, useData } from "./data";

export type XeroLinks = Record<string, string>; // tenantId -> client key
export type XeroOrgs = { tenants: XeroTenant[]; scopes: string[]; at: string };

/** The Xero bridge (one for the whole app), with the sealed sign-in kept in the app's settings. */
const latest: { settings: Row[]; saveSetting?: (key: string, value: unknown) => Promise<void> } = { settings: [] };
let xeroApi: XeroApi | null = null;
let pending: string | undefined | null = null; // written, and not yet back from SharePoint
export function useXero(): XeroApi {
  const { data, saveSetting } = useData();
  if (latest.settings !== data.settings) {
    latest.settings = data.settings;
    if (pending !== null && (readSetting<string>(data.settings, "xero.connection") || undefined) === (pending || undefined)) pending = null;
  }
  latest.saveSetting = saveSetting;
  if (!xeroApi) {
    const store = {
      read: () => (pending !== null ? pending : readSetting<string>(latest.settings, "xero.connection")) || undefined,
      write: async (s: string | undefined) => {
        pending = s ?? "";
        await latest.saveSetting?.("xero.connection", s ?? "");
      },
    };
    xeroApi = isDemo() ? new FakeXero(store) : new HttpXero(getAccessToken, store);
  }
  return xeroApi;
}

/** Which client each Xero organisation belongs to, and the tenant for a client. */
export function useXeroLinks() {
  const { data } = useData();
  const links = readSetting<XeroLinks>(data.settings, "xero.links") || {};
  const orgs = readSetting<XeroOrgs>(data.settings, "xero.orgs");
  const tenantFor = (clientKey: string) => {
    const id = Object.keys(links).find((t) => links[t] === clientKey);
    return id ? orgs?.tenants.find((t) => t.tenantId === id) || { id: "", tenantId: id, tenantName: "Xero organisation", tenantType: "ORGANISATION" } : undefined;
  };
  return { links, orgs, tenantFor, connected: !!readSetting<string>(data.settings, "xero.connection") };
}

const FAILED: Record<string, string> = {
  invalid_scope: "Xero refused one of the things asked for. Most likely your Xero app hasn't got the Account Data API (beta) or Full journals: untick them below and connect again.",
  access_denied: "The connection was cancelled at Xero.",
  expired: "The Xero sign-in took longer than 15 minutes. Connect again.",
  "not-configured": "The Xero app's client ID and secret aren't in Azure yet (see the steps below).",
  unauthorized_client: "Xero didn't recognise the app: check the client ID in Azure and that the redirect URI below is on the Xero app exactly as shown.",
  invalid_client: "Xero didn't accept the client ID and secret in Azure. Check them, or generate a new secret.",
  invalid_grant: "Xero didn't accept the sign-in code. Check the redirect URI below is on the Xero app exactly as shown, then connect again.",
  token: "Xero didn't hand over the connection. Check the client secret in Azure, then connect again.",
  unreachable: "The app's server couldn't reach Xero. Try again shortly.",
};

export function XeroSettings() {
  const { data, saveSetting } = useData();
  const xero = useXero();
  const { parts } = useRoute();
  const { links, orgs } = useXeroLinks();
  const opts = { ...DEFAULT_OPTIONS, ...(readSetting<XeroOptions>(data.settings, "xero.options") || {}) };
  const [status, setStatus] = useState<XeroStatus>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string>();
  const [note, setNote] = useState<string>();
  const connected = !!readSetting<string>(data.settings, "xero.connection");
  const clients = data.clients.filter((c) => c.Title).sort((a, b) => String(a.Title).localeCompare(String(b.Title)));

  useEffect(() => {
    void xero.status().then(setStatus);
  }, [xero]);

  const refresh = async () => {
    setBusy("Reading your Xero organisations…");
    setError(undefined);
    try {
      const r = await xero.connections();
      await saveSetting("xero.orgs", { tenants: r.tenants, scopes: r.scopes, at: new Date().toISOString() } satisfies XeroOrgs);
      // link new organisations to their client by name
      const next = { ...links };
      let changed = false;
      for (const t of r.tenants) {
        if (next[t.tenantId]) continue;
        const c = matchClient(t.tenantName, clients as { Key: string; Title: string }[]);
        if (c && !Object.values(next).includes(c.Key)) {
          next[t.tenantId] = c.Key;
          changed = true;
        }
      }
      if (changed) await saveSetting("xero.links", next);
    } catch (e) {
      setError(e instanceof XeroError ? e.message : "Xero didn't answer. Try again.");
    } finally {
      setBusy("");
    }
  };

  // back from Xero: keep the sealed connection, then list the organisations
  const back = parts[2];
  const handled = useRef("");
  useEffect(() => {
    const sealed = parts.slice(3).join("/");
    if (back === "connected" && sealed && handled.current !== sealed) {
      handled.current = sealed;
      void (async () => {
        await saveSetting("xero.connection", sealed);
        history.replaceState(null, "", "#/settings/xero");
        setNote("Connected to Xero.");
        await refresh();
      })();
    }
    if (back === "failed") {
      const code = parts[3] || "";
      setError(FAILED[code] || `Xero didn't connect (${code}).`);
      history.replaceState(null, "", "#/settings/xero");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [back]);

  const connect = async () => {
    setBusy("Opening Xero…");
    setError(undefined);
    try {
      window.location.assign(await xero.start(scopesFor(opts)));
    } catch (e) {
      setBusy("");
      setError(e instanceof XeroError ? e.message : "Couldn't start the Xero sign-in.");
    }
  };
  const disconnectAll = async () => {
    setBusy("Disconnecting…");
    try {
      await xero.disconnect();
      await saveSetting("xero.orgs", { tenants: [], scopes: [], at: new Date().toISOString() } satisfies XeroOrgs);
      setNote("Disconnected from Xero. Links to clients are kept for when you connect again.");
    } catch (e) {
      setError(e instanceof XeroError ? e.message : "Couldn't disconnect.");
    } finally {
      setBusy("");
    }
  };
  const removeOrg = async (t: XeroTenant) => {
    setBusy(`Removing ${t.tenantName}…`);
    try {
      await xero.disconnect(t.id);
      await refresh();
    } catch (e) {
      setError(e instanceof XeroError ? e.message : "Couldn't remove it.");
      setBusy("");
    }
  };
  const setOpts = (o: XeroOptions) => void saveSetting("xero.options", o);
  const link = (tenantId: string, clientKey: string) => {
    const next = { ...links };
    if (clientKey) next[tenantId] = clientKey;
    else delete next[tenantId];
    void saveSetting("xero.links", next);
  };
  const copy = (s: string) => void navigator.clipboard?.writeText(s).then(() => setNote("Copied."), () => undefined);
  const granted = new Set(orgs?.scopes || []);
  const missing = connected && orgs?.scopes?.length ? scopesFor(opts).filter((s) => !granted.has(s)) : [];

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 900 }}>
      <section className="card pad stack" aria-labelledby="xero-h">
        <div className="card-title-row">
          <h2 id="xero-h">Xero</h2>
          <div className="row-wrap">
            {connected && <button type="button" className="btn" disabled={!!busy} onClick={() => void refresh()}><Icon name="refresh" /> Refresh</button>}
            <button type="button" className="btn primary" disabled={!!busy || status?.configured === false} onClick={() => void connect()}>
              {connected ? "Connect again" : "Connect to Xero"}
            </button>
          </div>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Reads a company's trial balance, nominal ledger, debtors and creditors, bank, VAT and payroll from Xero into its working papers. Practice Planner only reads from Xero; it never changes anything there.
        </p>
        {status?.configured === false && <div className="alert amber"><strong>Not set up yet</strong><span>The Xero app's client ID and secret need adding to Azure first. Follow the steps below.</span></div>}
        {busy && <p className="muted" role="status" style={{ margin: 0 }}>{busy}</p>}
        {note && !busy && <p className="muted" role="status" style={{ margin: 0 }}>{note}</p>}
        {error && <div className="alert red" role="alert"><strong>Xero</strong><span>{error}</span></div>}
        {missing.length > 0 && <div className="alert amber"><strong>Connect again to use your choices</strong><span>This connection hasn't got: {missing.join(", ")}.</span></div>}
        {connected && orgs && (
          <div className="stack" style={{ gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Connected organisations</h3>
            {orgs.tenants.length === 0 ? <p className="muted" style={{ margin: 0 }}>None yet. Connect to Xero and tick the organisations to read.</p> : (
              <div className="table-wrap">
                <table className="grid">
                  <thead><tr><th scope="col">Xero organisation</th><th scope="col">Client in Practice Planner</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
                  <tbody>
                    {orgs.tenants.map((t) => (
                      <tr key={t.tenantId}>
                        <td>{t.tenantName}</td>
                        <td>
                          <select className="input" aria-label={`Client for ${t.tenantName}`} value={links[t.tenantId] || ""} onChange={(e) => link(t.tenantId, e.target.value)}>
                            <option value="">Not linked</option>
                            {clients.map((c) => <option key={c.Key as string} value={c.Key as string}>{c.Title as string}</option>)}
                          </select>
                        </td>
                        <td style={{ textAlign: "right" }}><button type="button" className="linkbtn" disabled={!!busy} onClick={() => void removeOrg(t)}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              To add a client's organisation, press Connect again and tick it at Xero (you need access to it as an adviser). Then open the client's working papers and use Import from Xero.
            </p>
            <div><button type="button" className="linkbtn" disabled={!!busy} onClick={() => void disconnectAll()}>Disconnect from Xero</button></div>
          </div>
        )}
      </section>

      <section className="card pad stack" aria-labelledby="xero-what-h">
        <h2 id="xero-what-h">What to read from Xero</h2>
        <p className="muted" style={{ margin: 0 }}>Changes here take effect the next time you connect.</p>
        <div className="stack" style={{ gap: 10 }}>
          {SCOPE_GROUPS.map((g) => (
            <label key={g.key} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <input type="checkbox" style={{ width: 18, height: 18, marginTop: 2 }} disabled={g.required} checked={g.required || opts.groups.includes(g.key)}
                onChange={(e) => setOpts({ ...opts, groups: e.target.checked ? [...opts.groups, g.key] : opts.groups.filter((k) => k !== g.key) })} />
              <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <span>{g.label}{g.required ? " (always)" : ""}</span>
                {g.note && <span className="muted" style={{ fontSize: 12 }}>{g.note}</span>}
              </span>
            </label>
          ))}
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <input type="checkbox" style={{ width: 18, height: 18, marginTop: 2 }} checked={opts.classic} onChange={(e) => setOpts({ ...opts, classic: e.target.checked })} />
            <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
              <span>My Xero app was made before 2 March 2026</span>
              <span className="muted" style={{ fontSize: 12 }}>Older apps can still use Xero's broad permissions until September 2027. Leave this off for a new app.</span>
            </span>
          </label>
        </div>
      </section>

      <section className="card pad stack" aria-labelledby="xero-setup-h">
        <h2 id="xero-setup-h">Setting up the Xero app (once)</h2>
        <ol className="stack" style={{ gap: 10, margin: 0, paddingLeft: 20 }}>
          <li>
            Sign in at <a href="https://developer.xero.com/app/manage" target="_blank" rel="noreferrer">developer.xero.com › My Apps</a> and choose <strong>New app</strong>. Integration type: <strong>Web app</strong>. Company or application URL: this app's address.
          </li>
          <li>
            For <strong>Redirect URI</strong>, enter exactly:
            <div className="row-wrap" style={{ gap: 8, marginTop: 6 }}>
              <code className="mono" style={{ padding: "6px 10px", background: "var(--surface-2)", borderRadius: 6, wordBreak: "break-all" }}>{status?.redirectUri || `${location.origin}/api/xero/callback`}</code>
              <button type="button" className="btn small" onClick={() => copy(status?.redirectUri || `${location.origin}/api/xero/callback`)}><Icon name="copy" /> Copy</button>
            </div>
          </li>
          <li>Open the app's <strong>Configuration</strong>, copy the <strong>Client id</strong>, and press <strong>Generate a secret</strong> (copy it straight away; Xero shows it once).</li>
          <li>
            In the <a href="https://portal.azure.com" target="_blank" rel="noreferrer">Azure portal</a>, open the Static Web App for Practice Planner › <strong>Settings › Environment variables</strong>, add <code>XERO_CLIENT_ID</code> and <code>XERO_CLIENT_SECRET</code> with those values, and press <strong>Apply</strong>.
          </li>
          <li>Come back here and press <strong>Connect to Xero</strong>. At Xero, tick each organisation to read (your practice's clients that you have adviser access to) and allow access.</li>
        </ol>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Xero's developer pricing (from 2 March 2026) lets a free app connect 5 organisations, with 1,000 calls a day each. Integrations an accounting practice builds for its own use are exempt from the fees; ask Xero to confirm yours (Developer portal › Manage plan › Get in touch) before connecting more than five clients.
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          The connection lapses if it isn't used for 60 days; connect again when it does. The Xero sign-in is kept sealed: only the app's server can open it.
        </p>
      </section>
      <p className="muted" style={{ fontSize: 12 }}><a href={href("papers")}>Go to the working papers</a></p>
    </div>
  );
}
