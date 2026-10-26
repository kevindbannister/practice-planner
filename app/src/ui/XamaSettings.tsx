// Settings › Xama: setting up the link to Xama (AML checks), testing it, and saying how Xama's
// clients and results line up with the practice's own. The link only reads.
import { useEffect, useMemo, useState } from "react";
import { getAccessToken } from "../lib/auth";
import { DEFAULT_XAMA_CONFIG, FakeXama, HttpXama, XamaApi, XamaConfig, XamaStatus, XamaTest } from "../lib/xama";
import { Icon } from "./bits";
import { isDemo } from "./commsKit";
import { readSetting, useData } from "./data";

export function useXamaConfig(): XamaConfig {
  const { data } = useData();
  return { ...DEFAULT_XAMA_CONFIG, ...(readSetting<Partial<XamaConfig>>(data.settings, "xama.config") || {}) };
}

export function XamaSettings() {
  const { saveSetting } = useData();
  const saved = useXamaConfig();
  const api: XamaApi = useMemo(() => (isDemo() ? new FakeXama() : new HttpXama(getAccessToken)), []);
  const [status, setStatus] = useState<XamaStatus | null>(null);
  const [cfg, setCfg] = useState<XamaConfig>(saved);
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<XamaTest | null>(null);
  const [savedAt, setSavedAt] = useState(false);

  useEffect(() => { void api.status().then(setStatus); }, [api]);
  useEffect(() => { if (!dirty) setCfg(saved); }, [JSON.stringify(saved)]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof XamaConfig, v: string) => { setCfg({ ...cfg, [k]: v } as XamaConfig); setDirty(true); setSavedAt(false); };
  const save = async () => { await saveSetting("xama.config", cfg); setDirty(false); setSavedAt(true); };
  const runTest = async () => {
    setTesting(true); setResult(null);
    try { setResult(await api.test(cfg.testPath.trim())); } finally { setTesting(false); }
  };

  return (
    <section className="card" aria-labelledby="xama-h" style={{ marginTop: 16, padding: 22 }}>
      <h2 id="xama-h">Xama (AML checks)</h2>
      <p className="muted">Links to your Xama account so AML check results can be read into the planner. It only reads: nothing in Xama is ever changed.</p>

      <div className="card" style={{ background: "var(--surface-2)", marginTop: 14, padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>1. Connection</h3>
        {!status ? <p className="muted">Checking…</p> : status.configured ? (
          <p><Icon name="check" size={16} /> Set up on the server: client ID ending <b>{status.clientIdEnding}</b>, signing in at <b>{status.tokenHost}</b>, reading from <b>{status.apiBase}</b>.</p>
        ) : (
          <>
            <p role="status"><Icon name="alert" size={16} /> Not set up yet. Still needed in Azure: <b>{status.missing.join(", ")}</b>.</p>
            <ol className="steps">
              <li>In your Xama account, open the page with the OAuth2 client ID and secret, and find the API documentation link there.</li>
              <li>In the Azure portal, open the Static Web App › Settings › Environment variables and add:
                <ul>
                  <li><code>XAMA_CLIENT_ID</code> and <code>XAMA_CLIENT_SECRET</code>: the OAuth2 client ID and secret</li>
                  <li><code>XAMA_TOKEN_URL</code>: Xama's token address (https)</li>
                  <li><code>XAMA_API_BASE</code>: the start of Xama's API addresses (https)</li>
                  <li>Only if Xama says so: <code>XAMA_SCOPE</code>, and <code>XAMA_AUTH_STYLE</code> set to <code>body</code></li>
                </ul>
              </li>
              <li>Apply, then come back and press Test connection. The secret is kept on the server and never shown here.</li>
            </ol>
          </>
        )}
      </div>

      <div className="card" style={{ background: "var(--surface-2)", marginTop: 14, padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>2. Test connection</h3>
        <label className="field" style={{ display: "grid", gap: 6 }}>
          <span>A path to read as well (optional)</span>
          <input className="input" value={cfg.testPath} placeholder="e.g. clients" onChange={(e) => set("testPath", e.target.value)} />
        </label>
        <p className="muted" style={{ margin: "6px 0 10px" }}>Signs in to Xama, then reads that one path and shows what came back, so you can see what Xama holds.</p>
        <button type="button" className="btn primary" disabled={testing || (!!status && !status.configured)} onClick={() => void runTest()}>{testing ? "Testing…" : "Test connection"}</button>
        {result && (
          <ul className="xama-steps" aria-live="polite" style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
            {result.steps.map((s, i) => (
              <li key={i} style={{ marginBottom: 10 }}>
                <b>{s.ok ? "✓" : "✗"} {s.name}</b>
                <div className={s.ok ? "" : "error-text"}>{s.message}</div>
                {s.sample && <pre style={{ maxHeight: 260, overflow: "auto", fontSize: 12, background: "var(--surface)", padding: 10, borderRadius: 8, whiteSpace: "pre-wrap" }}>{s.sample}</pre>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ background: "var(--surface-2)", marginTop: 14, padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>3. How Xama lines up with your clients</h3>
        <p className="muted">Fill these in once the test shows what Xama calls things. They're here so nothing is fixed in the app if Xama names or links things differently.</p>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginTop: 8 }}>
          <label className="field" style={{ display: "grid", gap: 6 }}><span>Your firm's Xama client ID (if the paths need it)</span><input className="input" value={cfg.firmId} onChange={(e) => set("firmId", e.target.value)} /></label>
          <label className="field" style={{ display: "grid", gap: 6 }}><span>Match Xama clients to yours by</span>
            <select className="input" value={cfg.matchBy} onChange={(e) => set("matchBy", e.target.value)}>
              <option value="number-then-name">Company number, then name</option>
              <option value="name">Name only</option>
            </select>
          </label>
          <label className="field" style={{ display: "grid", gap: 6 }}><span>Path that lists clients</span><input className="input" value={cfg.clientsPath} placeholder="e.g. clients" onChange={(e) => set("clientsPath", e.target.value)} /></label>
          <label className="field" style={{ display: "grid", gap: 6 }}><span>Path for one client's AML check (use {"{id}"})</span><input className="input" value={cfg.amlPath} placeholder="e.g. clients/{id}/aml" onChange={(e) => set("amlPath", e.target.value)} /></label>
          <label className="field" style={{ display: "grid", gap: 6 }}><span>Xama words meaning "passed"</span><input className="input" value={cfg.passed} onChange={(e) => set("passed", e.target.value)} /></label>
          <label className="field" style={{ display: "grid", gap: 6 }}><span>…meaning "needs a look"</span><input className="input" value={cfg.review} onChange={(e) => set("review", e.target.value)} /></label>
          <label className="field" style={{ display: "grid", gap: 6 }}><span>…meaning "failed"</span><input className="input" value={cfg.failed} onChange={(e) => set("failed", e.target.value)} /></label>
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" className="btn primary" disabled={!dirty} onClick={() => void save()}>Save</button>
          {savedAt && <span className="muted" role="status">Saved</span>}
        </div>
        <p className="muted" style={{ marginTop: 10 }}>Reading AML results into each client's checks is switched on once the test above shows real data from your account.</p>
      </div>
    </section>
  );
}
