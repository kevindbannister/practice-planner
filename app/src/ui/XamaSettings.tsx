// Settings › Xama: checking the link to Xama (AML checks) and reading each client's AML result
// from it. Only reads: nothing in Xama is ever changed.
import { useEffect, useMemo, useState } from "react";
import { getAccessToken } from "../lib/auth";
import { fmtDate, todayIso } from "../lib/domain";
import { FakeXama } from "../lib/fakeXama";
import { DEFAULT_XAMA_CONFIG, HttpXama, XamaApi, XamaConfig, XamaStatus, XamaTest } from "../lib/xama";
import { Row, isCurrent, patchFor, readAll, readClient, xamaLink } from "../lib/xamaSync";
import { Icon } from "./bits";
import { isDemo } from "./commsKit";
import { readSetting, useData } from "./data";

export function useXamaConfig(): XamaConfig {
  const { data } = useData();
  return { ...DEFAULT_XAMA_CONFIG, ...(readSetting<Partial<XamaConfig>>(data.settings, "xama.config") || {}) };
}

const box = { background: "var(--surface-2)", marginTop: 14, padding: 18 } as const;

export function XamaSettings() {
  const { data, saveSetting, updateMany } = useData();
  const saved = useXamaConfig();
  const api: XamaApi = useMemo(() => (isDemo() ? new FakeXama() : new HttpXama(getAccessToken)), []);
  const [status, setStatus] = useState<XamaStatus | null>(null);
  const [cfg, setCfg] = useState<XamaConfig>(saved);
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<XamaTest | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { void api.status().then(setStatus); }, [api]);
  useEffect(() => { if (!dirty) setCfg(saved); }, [JSON.stringify(saved)]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof XamaConfig, v: string) => { setCfg({ ...cfg, [k]: k === "staleMonths" ? Math.max(0, Math.min(120, Number(v) || 0)) : v } as XamaConfig); setDirty(true); };
  const saveCfg = async () => { await saveSetting("xama.config", cfg); setDirty(false); };
  const firm = cfg.firmId.trim();
  const ready = !!status?.configured && !!firm;

  const runTest = async () => {
    setTesting(true); setResult(null);
    try { setResult(await api.test(firm ? `clients/${encodeURIComponent(firm)}/search` : "", firm ? { query: "a" } : undefined)); } finally { setTesting(false); }
  };

  const read = async () => {
    if (dirty) await saveCfg();
    setRows(null); setMessage(""); setProgress([0, 1]);
    const out = await readAll(api, { ...cfg, firmId: firm }, data.clients, todayIso(), (d, t) => setProgress([d, t]));
    setRows(out); setProgress(null);
  };

  const link = async (i: number, id: string) => {
    if (!rows || !id) return;
    const r = await readClient(api, { ...cfg, firmId: firm }, rows[i].client, todayIso(), id);
    setRows(rows.map((x, j) => (j === i ? r : x)));
  };

  const changes = (rows || []).map((r) => ({ r, patch: patchFor(r) })).filter((x) => x.patch);
  const save = async () => {
    setSaving(true);
    try {
      await updateMany("Clients", changes.map((x) => ({ row: x.r.client, patch: x.patch! })));
      setMessage(`Saved: ${changes.length} client${changes.length === 1 ? "" : "s"} updated.`);
      setRows(null);
    } catch (e) {
      setMessage(`Not saved: ${(e as Error).message}`);
    } finally { setSaving(false); }
  };

  const count = (f: (r: Row) => boolean) => (rows || []).filter(f).length;

  return (
    <section className="card" aria-labelledby="xama-h" style={{ marginTop: 16, padding: 22 }}>
      <h2 id="xama-h">Xama (AML checks)</h2>
      <p className="muted">Reads each client's AML result from your Xama account into the planner. It only reads: nothing in Xama is ever changed.</p>

      <div className="card" style={box}>
        <h3 style={{ marginTop: 0 }}>1. Connection</h3>
        {!status ? <p className="muted">Checking…</p> : status.configured ? (
          <p><Icon name="check" size={16} /> Set up on the server: client ID ending <b>{status.clientIdEnding}</b>, signing in at <b>{status.tokenHost}</b>, reading from <b>{status.apiBase}</b>.</p>
        ) : (
          <>
            <p role="status"><Icon name="alert" size={16} /> Not set up yet. Still needed in Azure: <b>{status.missing.join(", ")}</b>.</p>
            <ol className="steps">
              <li>In Xama, open Open API settings (platform.xamatech.com › Settings › Apps › Open API) and copy the Application ID and Application Secret.</li>
              <li>In the Azure portal, open the Static Web App › Settings › Environment variables and add <code>XAMA_CLIENT_ID</code> and <code>XAMA_CLIENT_SECRET</code>. Xama's addresses are built in, so nothing else is needed.</li>
              <li>Apply, then come back here. The secret is kept on the server and never shown.</li>
            </ol>
          </>
        )}
        <label className="field" style={{ display: "grid", gap: 6, marginTop: 12, maxWidth: 460 }}>
          <span>Your Xama client ID <span className="muted">(Xama calls it the Client ID; it's in every Xama address and is not the OAuth ID)</span></span>
          <input className="input" value={cfg.firmId} onChange={(e) => set("firmId", e.target.value)} spellCheck={false} />
        </label>
        <label className="field" style={{ display: "grid", gap: 6, marginTop: 12, maxWidth: 460 }}>
          <span>Show "Review due" when an approved assessment is older than (months, 0 = never)</span>
          <input className="input" type="number" min={0} max={120} value={cfg.staleMonths} onChange={(e) => set("staleMonths", e.target.value)} />
        </label>
        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" className="btn" disabled={!dirty} onClick={() => void saveCfg()}>Save these</button>
          <button type="button" className="btn primary" disabled={testing || !status?.configured} onClick={() => void runTest()}>{testing ? "Testing…" : "Test connection"}</button>
        </div>
        {result && (
          <ul aria-live="polite" style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
            {result.steps.map((s, i) => (
              <li key={i} style={{ marginBottom: 10 }}>
                <b>{s.ok ? "✓" : "✗"} {s.name}</b>
                <div className={s.ok ? "" : "error-text"}>{s.message}</div>
                {s.sample && <pre style={{ maxHeight: 220, overflow: "auto", fontSize: 12, background: "var(--surface)", padding: 10, borderRadius: 8, whiteSpace: "pre-wrap" }}>{s.sample}</pre>}
              </li>
            ))}
          </ul>
        )}
        {!firm && <p className="muted" style={{ marginTop: 10 }}>Add your Xama client ID to test reading client information.</p>}
      </div>

      <div className="card" style={box}>
        <h3 style={{ marginTop: 0 }}>2. Read AML results</h3>
        <p className="muted">Finds each client in Xama (by the Xama link already on the client, otherwise by an exact name match), reads its latest approved risk assessment, and shows what would change. Nothing is saved until you press Save.</p>
        <button type="button" className="btn primary" disabled={!ready || !!progress} onClick={() => void read()}>
          {progress ? `Reading… ${progress[0]} of ${progress[1]}` : rows ? "Read again" : "Read from Xama"}
        </button>
        {!ready && <span className="muted" style={{ marginLeft: 10 }}>{status?.configured ? "Add your Xama client ID first." : "Finish the connection first."}</span>}
        {message && <p role="status" style={{ marginTop: 12 }}>{message}</p>}

        {rows && (
          <>
            <p style={{ marginTop: 14 }}>
              <b>{rows.length}</b> current clients read: <b>{changes.length}</b> to update, <b>{count((r) => !r.xamaId && !r.error)}</b> not found in Xama or needing a choice, <b>{count((r) => !!r.error)}</b> with a problem.
              {data.clients.length - rows.length > 0 && <span className="muted"> ({data.clients.length - rows.length} ceased clients skipped.)</span>}
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ width: "100%" }}>
                <thead><tr><th scope="col">Client</th><th scope="col">Now</th><th scope="col">From Xama</th><th scope="col"></th></tr></thead>
                <tbody>
                  {rows.filter((r) => r.changed || r.error || !r.xamaId).map((r) => {
                    const i = rows.indexOf(r);
                    return (
                      <tr key={r.client.Key}>
                        <td>{r.client.Title}</td>
                        <td>{String(r.client.XamaStatus || "Not linked")}</td>
                        <td>
                          {r.error ? <span className="error-text">{r.error}</span>
                            : r.summary ? <>{r.summary.status}{r.summary.review ? <span className="muted"> · {fmtDate(r.summary.review)}</span> : null}{r.newlyLinked ? <span className="muted"> · newly linked</span> : null}</>
                            : r.candidates && r.candidates.length ? (
                              <select className="input" aria-label={`Which Xama client is ${r.client.Title}?`} defaultValue="" onChange={(e) => void link(i, e.target.value)}>
                                <option value="">Not sure: choose the right one…</option>
                                {r.candidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.type ? ` (${c.type.toLowerCase()})` : ""}</option>)}
                              </select>
                            ) : <span className="muted">Not found in Xama</span>}
                        </td>
                        <td>{r.xamaId ? <a href={xamaLink(r.xamaId)} target="_blank" rel="noreferrer">Open in Xama</a> : null}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 14 }}>
              <button type="button" className="btn primary" disabled={!changes.length || saving} onClick={() => void save()}>{saving ? "Saving…" : `Save ${changes.length} change${changes.length === 1 ? "" : "s"}`}</button>
            </div>
          </>
        )}
        <p className="muted" style={{ marginTop: 12 }}>
          Clients are updated in three places: the Xama link, the AML status shown on their page and in the client list, and the date the assessment was completed. {data.clients.filter(isCurrent).length} current clients.
        </p>
      </div>
    </section>
  );
}
