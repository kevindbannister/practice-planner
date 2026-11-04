// The HMRC Filing area inside a Personal Tax return: where this year's SA100 is on its way to HMRC. The rules are in lib/hmrcFiling.ts; this
// is the screen. Nothing here sends anything to HMRC today: HMRC's XML for the SA100 can't be made until its official artefacts are in,
// and the panel says so rather than offering a button that would do nothing.
import { useEffect, useMemo, useState } from "react";
import { Client, fmtDate } from "../lib/domain";
import { TaxReturn } from "../lib/tax";
import { yearLabel } from "../lib/taxRates";
import { getAccessToken } from "../lib/auth";
import { readConfig } from "../lib/checklist";
import { practiceId } from "../lib/checklistRows";
import { proposalCan } from "../lib/proposals";
import { cosecDividendsFor } from "../lib/taxCosec";
import { ENV_LABEL, Filing, FilingEnv, FilingState, STATE_LABEL, advance, amend, describe, envGate, isFiled, needsRework, newFiling, readFiling, readiness, sha256Hex } from "../lib/hmrcFiling";
import { FilingInfo, fetchFilingInfo, settingsOf } from "../lib/filingApi";
import { coverage, payloadText, preflight } from "../lib/sa100Preflight";
import { Row } from "../lib/schema";
import { isDemo } from "./commsKit";
import { useData } from "./data";

const CHIP: Record<FilingState, string> = { draft: "gray", prepared: "blue", validated: "blue", reviewed: "blue", "client-approved": "blue", ready: "green", submitted: "amber", accepted: "green", rejected: "red" };
const STEP: Partial<Record<FilingState, { to: FilingState; label: string }>> = {
  draft: { to: "prepared", label: "Prepare this version" }, prepared: { to: "validated", label: "Run the checks" }, validated: { to: "reviewed", label: "Mark as reviewed" },
  reviewed: { to: "client-approved", label: "Record the client's approval" }, "client-approved": { to: "ready", label: "Mark ready to file" },
};
const when = (iso: string) => (iso ? `${fmtDate(iso.slice(0, 10))} ${iso.slice(11, 16)}` : "");

export function HmrcFilingPanel({ client, year, ret }: { client: Client; year: number; ret: TaxReturn }) {
  const { data, user, create, update } = useData();
  const cfg = useMemo(() => readConfig(data.settings), [data.settings]);
  const me = user || "";
  const can = (w: "review" | "file") => proposalCan(cfg, me, w === "file" ? "send" : "edit");
  const period = yearLabel(year);
  const [info, setInfo] = useState<FilingInfo | null | undefined>(undefined);
  const [hash, setHash] = useState("");
  const [env, setEnv] = useState<FilingEnv>("mock");
  const [approver, setApprover] = useState(""), [note, setNote] = useState(""), [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { let on = true; if (isDemo()) { setInfo(null); return; } fetchFilingInfo(getAccessToken).then((i) => { if (on) setInfo(i); }); return () => { on = false; }; }, []);
  useEffect(() => { let on = true; const text = payloadText(ret); sha256Hex(text).then((h) => { if (on) setHash(h); }); return () => { on = false; }; }, [ret]);

  const key = String(client.Key);
  const filings = useMemo(() => data.hmrcFilings.filter((r) => r.ClientKey === key && r.Service === "SA100" && r.Period === period).map(readFiling).sort((a, b) => b.version - a.version), [data.hmrcFilings, key, period]);
  const f = filings[0] as Filing | undefined;
  const rowOf = (k: string) => data.hmrcFilings.find((r) => r.Key === k) as Row | undefined;
  const history = useMemo(() => { const keys = new Set(filings.map((x) => x.key)); return data.hmrcFilingLog.filter((r) => keys.has(String(r.FilingKey))).sort((a, b) => String(b.At).localeCompare(String(a.At))); }, [data.hmrcFilingLog, filings]);
  const settings = settingsOf(info ?? null);
  const xml = info === undefined ? { ready: false, reason: "Checking what the server has set up…" }
    : info === null ? { ready: false, reason: "The filing service on the server couldn't be reached (it may not be deployed yet)." }
    : info.services.SA100.adapter ? { ready: true, reason: "" } : { ready: false, reason: info.services.SA100.reason };
  const unlinked = useMemo(() => {
    const names = new Map(data.clients.map((c) => [String(c.Key), String(c.Title || "")]));
    return cosecDividendsFor(key, year, data.cosecDividends, (k) => names.get(k) || "Company").filter((i) => !ret.dividends.some((d) => d.source && d.source.ref === i.ref && d.source.companyKey === i.companyKey)).length;
  }, [data.cosecDividends, data.clients, ret.dividends, key, year]);
  const pid = practiceId(data.settings);

  const run = async (work: () => Promise<string>) => { setBusy(true); setMsg(null); try { const text = await work(); if (text) setMsg({ ok: true, text }); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't save. Try again." }); } finally { setBusy(false); } };
  const write = async (r: { error?: string; patch?: Row; log?: Row }, filing: Filing, ok: string) => {
    if (r.error || !r.patch || !r.log) { setMsg({ ok: false, text: r.error || "Nothing to do." }); return ""; }
    const row = rowOf(filing.key); if (!row) throw new Error("That filing isn't there any more. Reload.");
    await update("HmrcFilings", row, r.patch);
    await create("HmrcFilingLog", { ...r.log, PracticeId: pid });
    return ok;
  };
  const ctxFor = (extra: Record<string, unknown> = {}) => ({ by: me || "unknown", now: new Date().toISOString(), can, currentHash: hash, settings, xml, all: filings, ...extra }) as Parameters<typeof advance>[2];

  const start = () => run(async () => {
    const n = newFiling({ clientKey: key, service: "SA100", period, env, by: me || "unknown", now: new Date().toISOString() });
    await create("HmrcFilings", { ...n.row, PracticeId: pid }); await create("HmrcFilingLog", { ...n.log, PracticeId: pid });
    return "Started. Nothing has been sent to HMRC.";
  });
  const step = (to: FilingState) => run(async () => {
    if (!f) return "";
    let extra: Record<string, unknown> = {};
    if (to === "validated") {
      const v = preflight(ret, year, new Date().toISOString(), f.payloadHash, { codivs: unlinked });
      extra = { validation: v };
      if (v.errors.length) { setMsg({ ok: false, text: `${v.errors.length} problem${v.errors.length === 1 ? "" : "s"}: ${v.errors.join(" ")}` }); return ""; }
    }
    if (to === "client-approved") extra = { approval: { by: approver, note } };
    const r = advance(f, to, ctxFor(extra));
    const text = await write(r, f, `${STATE_LABEL[to]}.`);
    if (text && to === "client-approved") { setApprover(""); setNote(""); }
    return text;
  });
  const rework = () => run(async () => { if (!f) return ""; return write(advance(f, "prepared", ctxFor()), f, "Sent back to Prepared: the return changed after it was prepared."); });
  const newVersion = () => run(async () => {
    if (!f) return "";
    const a = amend(f, me || "unknown", new Date().toISOString(), env);
    if (a.error || !a.row || !a.log) { setMsg({ ok: false, text: a.error || "Couldn't start a new version." }); return ""; }
    await create("HmrcFilings", { ...a.row, PracticeId: pid }); await create("HmrcFilingLog", { ...a.log, PracticeId: pid });
    return `Version ${readFiling(a.row).version} started. The earlier version is unchanged.`;
  });

  const checks = f ? readiness(f, hash, settings, xml) : [];
  const next = f ? STEP[f.state] : undefined;
  const cover = coverage(ret);
  const stale = f ? needsRework(f, hash) : false;

  return (
    <section className="card stack" style={{ padding: 16, gap: 10 }} aria-label="HMRC Filing">
      <div className="row-wrap" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>HMRC Filing <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>{period}</span></h3>
        {f && <span className={`chip ${CHIP[f.state]}`}>{describe(f)}</span>}
      </div>
      <p className="warn" style={{ margin: 0, fontSize: 13 }}>Nothing is sent to HMRC from here yet. {xml.reason || "HMRC XML is available."}</p>
      {info && !info.environments.live.ok && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Live filing is off: {info.environments.live.reason}</p>}

      {!f && <div className="row-wrap" style={{ alignItems: "center" }}>
        <label className="muted" style={{ fontSize: 13 }}>Environment{" "}
          <select className="input" style={{ width: "auto" }} value={env} onChange={(e) => setEnv(e.target.value as FilingEnv)}>
            {(["mock", "ets", "live"] as FilingEnv[]).map((e) => <option key={e} value={e}>{ENV_LABEL[e]}</option>)}
          </select>
        </label>
        <button type="button" className="btn" disabled={busy || !can("review")} onClick={start}>Start a filing for {period}</button>
        {!envGate(env, settings).ok && <span className="muted" style={{ fontSize: 13 }}>{envGate(env, settings).reason}</span>}
      </div>}

      {f && <>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Version {f.version} · {ENV_LABEL[f.env]}{f.supersedes ? " · replaces an earlier version" : ""}{f.submittedAt ? ` · submitted ${when(f.submittedAt)}` : ""}</p>
        {stale && <p className="warn" style={{ margin: 0, fontSize: 13 }}>The return has changed since version {f.version} was prepared{f.approvedHash ? ", so the client's approval no longer covers it" : ""}. <button type="button" className="btn small" disabled={busy} onClick={rework}>Send back to Prepared</button></p>}
        <ul className="tax-found" style={{ margin: 0 }}>
          {checks.map((c) => <li key={c.key} className={c.ok ? "ok-text" : undefined}>{c.ok ? "✓" : "○"} {c.label}{c.detail ? `: ${c.detail}` : ""}</li>)}
        </ul>
        {f.validation && (f.validation.errors.length > 0 || f.validation.warnings.length > 0) && <div className="muted" style={{ fontSize: 13 }}>
          <span>{f.validation.schema}, {when(f.validation.at)}</span>
          {f.validation.errors.map((e) => <div key={e} className="warn">{e}</div>)}{f.validation.warnings.map((w) => <div key={w}>{w}</div>)}
        </div>}

        {f.state === "reviewed" && <div className="row-wrap" style={{ alignItems: "flex-end" }}>
          <label className="tax-field"><span>Approved for the client by</span><input className="input" value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Name of the client or who recorded it" /></label>
          <label className="tax-field"><span>How (email, signed copy, portal)</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>}
        {next && !stale && <div className="row-wrap">
          <button type="button" className="btn" disabled={busy} onClick={() => step(next.to)}>{next.label}</button>
        </div>}
        {f.state === "ready" && <div className="row-wrap" style={{ alignItems: "center" }}>
          <label style={{ fontSize: 13 }}><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I confirm this return is to be filed with HMRC</label>
          <button type="button" className="btn primary" disabled title={xml.ready ? "" : xml.reason}>File with HMRC</button>
        </div>}
        {(f.state === "accepted" || f.state === "rejected") && <div className="row-wrap">
          <button type="button" className="btn" disabled={busy} onClick={newVersion}>{f.state === "rejected" ? "Start a correction (new version)" : "Start an amendment (new version)"}</button>
        </div>}
        {isFiled(f) && <p className="ok-text" style={{ margin: 0 }}>Filed: HMRC accepted this return{f.receipt ? ` (receipt ${f.receipt})` : ""}.</p>}
        {f.messages.length > 0 && <div className="warn" style={{ fontSize: 13 }}>HMRC's messages: {f.messages.map((m) => `${m.number} ${m.text}`).join("; ")}</div>}
      </>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "ok-text" : "warn"} style={{ margin: 0 }}>{msg.text}</p>}

      <details>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Which SA100 pages the planner covers</summary>
        <p className="muted" style={{ fontSize: 12, margin: "6px 0" }}>Not checked against HMRC's official artefacts yet. The checks above are the planner's own, not HMRC's validation.</p>
        <table className="grid"><tbody>
          {cover.map((c) => <tr key={c.page}><td>{c.page}</td><td>{c.name}</td><td>{c.support === "modelled" ? "In the planner" : c.support === "partly" ? "Partly" : "Not in the planner"}</td><td>{c.used ? "Used in this return" : ""}</td><td className="muted">{c.note}</td></tr>)}
        </tbody></table>
      </details>
      {filings.length > 1 && <details><summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>Earlier versions</summary>
        {filings.slice(1).map((x) => <div key={x.key} style={{ fontSize: 13 }}>Version {x.version}: {describe(x)}{x.answeredAt ? `, ${when(x.answeredAt)}` : ""}</div>)}
      </details>}
      {history.length > 0 && <details><summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>History ({history.length})</summary>
        {history.map((h) => <div key={String(h.Key)} style={{ fontSize: 13 }}><span className="muted mono">{when(String(h.At))}</span> {String(h.By)}: {String(h.Event)}{h.To ? ` (${STATE_LABEL[String(h.To) as FilingState] || String(h.To)})` : ""}</div>)}
      </details>}
    </section>
  );
}
