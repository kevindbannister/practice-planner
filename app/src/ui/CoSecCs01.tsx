// The confirmation statement tab: a guided review worked out from the company's records. It prepares the statement, shows what is ready and what
// isn't, and hands the draft to the usual approval and review. It does not file anything: the statement is filed at Companies House and the
// reference recorded here (see Filings).
import { useMemo, useState } from "react";
import { fmtDate, todayIso } from "../lib/domain";
import { DECLARATIONS, Cs01Model, Cs01Payload, buildCs01, readCs01 } from "../lib/cosecCs01";
import { act, isOpenTx, prepareCs01, txStatus } from "../lib/cosec";
import { money, readFees } from "../lib/cosecFees";
import { readEntry } from "../lib/shareLedger";
import { Row } from "../lib/schema";
import { href } from "./bits";
import { readSetting, useData } from "./data";
import { useCoSec } from "./cosecKit";

const s = (v: unknown) => (v == null ? "" : String(v));
const say = (e: unknown) => (e instanceof Error && e.message ? e.message : "That didn't work. Try again.");

export function useCs01Model(client: Row, payload: Cs01Payload, selfTx?: string): Cs01Model {
  const k = useCoSec();
  const { data } = useData();
  const fees = useMemo(() => readFees(readSetting(data.settings, "cosec.fees")), [data.settings]);
  const ck = s(client.Key);
  return useMemo(() => buildCs01({ client, payload, officers: k.data.cosecOfficers.filter((x) => x.ClientKey === ck), pscs: k.data.cosecPscs.filter((x) => x.ClientKey === ck), ledger: k.data.cosecLedger.filter((x) => x.ClientKey === ck).map(readEntry), classes: k.data.cosecShareClasses, txs: k.data.cosecTx, fees, today: todayIso(), selfTx }), [client, payload, k.data, fees, ck, selfTx]);
}

export function Cs01Steps({ model }: { model: Cs01Model }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {model.steps.map((st, i) => (
        <div key={st.id} className="card pad" style={{ padding: 12 }}>
          <div className="row-wrap" style={{ justifyContent: "space-between" }}><strong>{i + 1}. {st.title}</strong><span className={`chip ${st.state === "ok" ? "green" : st.state === "blocked" ? "red" : "amber"}`}>{st.state === "ok" ? "Ready" : st.state === "blocked" ? "Needs action" : "Check"}</span></div>
          {st.notes.map((n, j) => <div key={j} className="muted" style={{ fontSize: 13, whiteSpace: "pre-line" }}>{n}</div>)}
        </div>
      ))}
    </div>
  );
}

export function Cs01Summary({ model }: { model: Cs01Model }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {model.blockers.length > 0 ? <div className="alert red" role="alert"><strong>Not ready to file</strong><ul style={{ margin: "4px 0 0 18px" }}>{model.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div> : <div className="alert green" role="status"><strong>Ready for review</strong><span>Everything the statement needs is in place.</span></div>}
      {model.warnings.length > 0 && <div className="alert amber"><strong>Worth checking</strong><ul style={{ margin: "4px 0 0 18px" }}>{model.warnings.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
      {model.fee ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>Companies House fee: {money(model.fee.amount)} (from {model.fee.effective ? fmtDate(model.fee.effective) : "an undated entry"}). {model.fee.source}</p> : <p className="muted" style={{ margin: 0, fontSize: 13 }}>No fee is set for this filing. Add one under Settings.</p>}
      {model.dueBy && <p className="muted" style={{ margin: 0, fontSize: 13 }}>To be filed by {fmtDate(model.dueBy)}. The next statement would then be due by {fmtDate(model.nextDue)}.</p>}
    </div>
  );
}

export function Cs01Tab({ client }: { client: Row }) {
  const k = useCoSec();
  const ck = s(client.Key);
  const drafts = k.data.cosecTx.filter((t) => t.ClientKey === ck && s(t.Form) === "CS01").sort((a, b) => s(b.Created).localeCompare(s(a.Created)));
  const open = drafts.find((t) => isOpenTx(t));
  const past = drafts.filter((t) => !isOpenTx(t));
  return (
    <div className="stack" style={{ gap: 14 }}>
      {open ? <Draft client={client} tx={open} /> : <Start client={client} />}
      {past.length > 0 && (
        <section className="card pad stack" aria-label="Earlier confirmation statements">
          <h3 style={{ margin: 0 }}>Earlier statements</h3>
          <ul className="plain">{past.map((t) => <li key={s(t.Key)}><a href={href("cosec", "filing", s(t.Key))}>{s(t.Ref)} · {s(t.Title)}</a> <span className="muted">{txStatus(t) === "external" ? `Filed at Companies House${s(t.ChRef) ? `, reference ${s(t.ChRef)}` : ""}` : txStatus(t)}</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}

function Start({ client }: { client: Row }) {
  const k = useCoSec();
  const ver = (() => { try { return JSON.parse(s(client.CHVerified) || "{}"); } catch { return {}; } })() as { csTo?: string; csDue?: string };
  const [date, setDate] = useState(todayIso());
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true); setMsg(undefined);
    try {
      const r = prepareCs01(client, date, k.snap(), k.can("edit"), k.ctx());
      if ("error" in r) throw new Error(r.error);
      await k.apply(r as never);
    } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); }
  };
  return (
    <section className="card pad stack" aria-label="Start a confirmation statement">
      <h3 style={{ margin: 0 }}>Confirmation statement</h3>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{ver.csTo ? `Companies House shows the last statement made up to ${fmtDate(ver.csTo)}${ver.csDue ? `, next due ${fmtDate(ver.csDue)}` : ""}.` : "No statement date is on file. Refresh from Companies House on the Details tab."} This works out what the statement would say from the company's records and what must be sorted out first. It doesn't file anything.</p>
      <label className="doc-field" style={{ maxWidth: 260 }}><span>Made up to</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      {msg && <p className="error-text" role="alert" style={{ margin: 0 }}>{msg.text}</p>}
      <div><button type="button" className="btn primary" disabled={busy || !k.can("edit")} onClick={() => void start()}>Start the confirmation statement</button></div>
    </section>
  );
}

function Draft({ client, tx }: { client: Row; tx: Row }) {
  const k = useCoSec();
  const stored = readCs01(tx);
  const [p, setP] = useState<Cs01Payload>(stored);
  const dirty = JSON.stringify(p) !== JSON.stringify(stored);
  const model = useCs01Model(client, p, s(tx.Key));
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<string>) => { setBusy(true); setMsg(undefined); try { setMsg({ ok: true, text: await work() }); } catch (e) { setMsg({ ok: false, text: say(e) }); } finally { setBusy(false); } };
  const snapshot = { capital: model.capital.classes.map((c) => `${c.issued.toLocaleString("en-GB")} ${c.cls} shares, ${model.capital.currency} ${c.nominal} each, aggregate nominal ${c.aggregateNominal}`), shareholders: model.shareholders.map((h) => `${h.name}: ${h.holdings.map((x) => `${x.number.toLocaleString("en-GB")} ${x.cls}`).join(", ")}`), officers: model.officers.map((o) => `${o.name}, ${o.role}`) };
  const save = () => run(async () => {
    const w = act(tx, "edit", { payload: { ...p, snapshot } }, k.cfg, k.ctx(), k.snap());
    if ("error" in w) throw new Error(w.error);
    await k.apply(w);
    return "Saved. If it had been approved, it needs approving again.";
  });
  const check = () => run(async () => { const n = await k.scan("other"); return n ? `${n} change${n === 1 ? "" : "s"} found that need filing separately. They are in Filings as drafts.` : "No unreported changes found."; });
  const cancel = () => run(async () => { const w = act(tx, "cancel", {}, k.cfg, k.ctx(), k.snap()); if ("error" in w) throw new Error(w.error); await k.apply(w); return "Cancelled."; });
  return (
    <div className="stack" style={{ gap: 14 }}>
      <section className="card pad stack" aria-label="Confirmation statement">
        <div className="row-wrap" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Confirmation statement made up to {fmtDate(p.madeUpTo)}</h3>
          <a href={href("cosec", "filing", s(tx.Key))}>{s(tx.Ref)}: approval, review and filing</a>
        </div>
        <Cs01Summary model={model} />
        <Cs01Steps model={model} />
        {model.linked.length > 0 && <div className="stack" style={{ gap: 4 }}><strong>Open filings to deal with first</strong>{model.linked.map((t) => <a key={t.key} href={href("cosec", "filing", t.key)}>{t.ref} · {t.form} · {t.title}</a>)}</div>}
        <div><button type="button" className="btn" disabled={busy || !k.can("edit")} onClick={() => void check()}>Check for changes that need reporting separately</button></div>
      </section>
      <section className="card pad stack" aria-label="Statement details">
        <h3 style={{ margin: 0 }}>Details and declarations</h3>
        <div className="tl-form">
          <label className="doc-field"><span>Registered email address</span><input className="input" type="email" value={p.email} onChange={(e) => setP({ ...p, email: e.target.value })} /></label>
          <label className="doc-field"><span>Single alternative inspection location (if registers are kept elsewhere)</span><input className="input" value={p.sail} onChange={(e) => setP({ ...p, sail: e.target.value })} /></label>
          <label className="doc-field"><span>Who is making the statement</span><input className="input" value={p.declaredBy} onChange={(e) => setP({ ...p, declaredBy: e.target.value })} /></label>
        </div>
        <label className="row-wrap" style={{ fontSize: 13 }}><input type="checkbox" checked={!!p.noPsc} onChange={(e) => setP({ ...p, noPsc: e.target.checked })} /> The company has no registrable person with significant control</label>
        {DECLARATIONS.map(([key, text]) => <label key={key} className="row-wrap" style={{ alignItems: "start" }}><input type="checkbox" checked={p.declarations[key]} onChange={(e) => setP({ ...p, declarations: { ...p.declarations, [key]: e.target.checked } })} /> <span>{text}</span></label>)}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>These declarations are recorded here for the company's confirmation. When the statement is filed, the wording on the Companies House form applies.</p>
        {msg && <p className={msg.ok ? undefined : "error-text"} role={msg.ok ? "status" : "alert"} style={{ margin: 0 }}>{msg.text}</p>}
        <div className="row-wrap"><button type="button" className="btn primary" disabled={busy || !dirty || !k.can("edit")} onClick={() => void save()}>Save changes</button><button type="button" className="linkbtn" disabled={busy || !k.can("edit")} onClick={() => void cancel()}>Cancel this draft</button></div>
      </section>
    </div>
  );
}

/** On the filing page: the same readiness view, read-only, with a link back to where it is edited. */
export function Cs01InFiling({ tx, client }: { tx: Row; client?: Row }) {
  const p = readCs01(tx);
  if (!client) return null;
  return <Cs01Inner client={client} tx={tx} p={p} />;
}
function Cs01Inner({ client, tx, p }: { client: Row; tx: Row; p: Cs01Payload }) {
  const model = useCs01Model(client, p, s(tx.Key));
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Cs01Summary model={model} />
      <Cs01Steps model={model} />
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Edit the details and declarations on the company's <a href={href("cosec", "company", s(tx.ClientKey), "cs01")}>Confirmation statement tab</a>. It is filed at Companies House (WebFiling or your filing software); record the reference with "Mark as already filed externally" once done. Direct submission of a confirmation statement isn't built.</p>
    </div>
  );
}
