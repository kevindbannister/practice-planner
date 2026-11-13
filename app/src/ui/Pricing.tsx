// Pricing rules (Settings), the pricing check (a client's fee schedule and the fee review list) and catch-up fees.
// A rule only suggests. Nothing here changes an agreed fee; a catch-up fee is proposed and needs a manager's approval.
import { useMemo, useState } from "react";
import { todayIso } from "../lib/domain";
import { CustomDef, valuesOf } from "../lib/customFields";
import { PERIOD_OPTIONS, VAT_OPTIONS, FeeLine, periodLabel, readFeeLine } from "../lib/fees";
import { MAX_MONTHS, approveCatchUp, catchUpPeriod, catchUpWorking, monthName, monthlyRate, overlapping, proposeCatchUp } from "../lib/catchup";
import { Band, Check, PRICING_KEY, PricingRule, ROUNDINGS, activeRule, belowRule, blankRule, checkAll, checkCsv, checkLine, readRules, removeRule, saveRule, suggest } from "../lib/pricing";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { readSetting, useData } from "./data";
import { useCustomDefs } from "./CustomFields";
import { downloadFile } from "./commsKit";
import { href } from "./bits";
import { useSales } from "./salesKit";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const gbp = (n: number) => { const a = Math.abs(n), whole = Math.abs(a - Math.round(a)) < 0.005; return (n < 0 ? "-" : "") + "£" + a.toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }); };

export function useRules(): PricingRule[] {
  const { data } = useData();
  return useMemo(() => readRules(readSetting<unknown>(data.settings, PRICING_KEY)), [data.settings]);
}
const useServiceName = () => { const { data } = useData(); return (k: string) => str(data.services.find((x) => x.Key === k)?.Title) || k || "(no service)"; };

// ------------------------------------------------------------------ Settings

export function PricingSettings() {
  const { data, saveSetting, user } = useData();
  const rules = useRules();
  const defs = useCustomDefs();
  const svc = useServiceName();
  const [draft, setDraft] = useState<PricingRule | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [tryOn, setTryOn] = useState("");
  const nums = defs.filter((d) => d.appliesTo === "client" && d.type === "number");
  const yns = defs.filter((d) => d.appliesTo === "client" && d.type === "yesno");
  const services = data.services.filter((s) => s.Key !== "TASK").sort((a, b) => str(a.Title).localeCompare(str(b.Title)));
  const persist = async (next: PricingRule[]) => { setBusy(true); try { await saveSetting(PRICING_KEY, next); return true; } catch { setProblems(["That didn't save. Try again."]); return false; } finally { setBusy(false); } };
  const save = async () => {
    if (!draft) return;
    const r = saveRule(rules, draft, defs, user || "", new Date().toISOString());
    if (r.problems.length) return setProblems(r.problems);
    if (await persist(r.rules)) { setDraft(null); setProblems([]); }
  };
  const set = (p: Partial<PricingRule>) => draft && setDraft({ ...draft, ...p });
  const sample = useMemo(() => (draft && tryOn ? suggest(draft, valuesOf(data.customValues, "client", tryOn), defs) : null), [draft, tryOn, data.customValues, defs]);
  const clients = useMemo(() => [...data.clients].sort((a, b) => str(a.Title).localeCompare(str(b.Title))), [data.clients]);
  const unused = services.filter((s) => !rules.some((r) => r.serviceKey === s.Key));

  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <section className="card pad stack" aria-labelledby="pr-h">
        <h2 id="pr-h" style={{ margin: 0 }}>Pricing rules</h2>
        <p className="muted tip" style={{ margin: 0 }}>A rule works out the fee you would suggest for a client from their own figures, such as monthly transactions. It only suggests: it never changes an agreed fee, and fees already agreed are untouched when you change a rule. Set the figures up under Your own fields first.</p>
        {!nums.length && !yns.length && <p className="import-list warn" role="note">You haven't made any client number or yes / no fields yet, so a rule can only be a base fee. Add them under <a href={href("settings", "fields")}>Your own fields</a> (for example monthly transactions).</p>}
        {rules.length === 0 ? <p className="muted" style={{ margin: 0 }}>No rules yet. A service with no rule is simply not checked.</p> : (
          <div className="table-wrap"><table className="grid" style={{ minWidth: 520 }}>
            <thead><tr><th scope="col">Service</th><th scope="col">Rule</th><th scope="col">Charged</th><th scope="col">Version</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rules.map((r) => (
              <tr key={r.id}><td>{svc(r.serviceKey)}</td><td>{r.name}</td><td>{periodLabel(r.period)}</td><td>v{r.version}{r.updated ? <span className="muted"> · {r.updated.slice(0, 10)}{r.updatedBy ? ` · ${r.updatedBy}` : ""}</span> : null}</td>
                <td><button type="button" className="linkbtn" onClick={() => { setDraft(r); setProblems([]); }}>Edit</button>{" "}<button type="button" className="linkbtn" disabled={busy} onClick={() => { if (window.confirm(`Delete the rule for ${svc(r.serviceKey)}? Agreed fees are not affected.`)) void persist(removeRule(rules, r.id)); }}>Delete</button></td></tr>
            ))}</tbody>
          </table></div>
        )}
        {!draft && <div><button type="button" className="btn" disabled={!unused.length} onClick={() => { setDraft(blankRule(newKey("PR"), unused[0]?.Key as string)); setProblems([]); setTryOn(""); }}>Add a rule</button>{!unused.length && <span className="muted"> Every service already has a rule.</span>}</div>}
      </section>

      {draft && (
        <section className="card pad stack" aria-label="Edit pricing rule">
          <h3 style={{ margin: 0 }}>{rules.some((r) => r.id === draft.id) ? `Edit rule (now v${draft.version})` : "New rule"}</h3>
          <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
            <label className="doc-field" style={{ flex: "2 1 220px" }}><span>Service</span>
              <select className="input" value={draft.serviceKey} onChange={(e) => set({ serviceKey: e.target.value })}>
                {services.filter((s) => s.Key === draft.serviceKey || !rules.some((r) => r.serviceKey === s.Key)).map((s) => <option key={str(s.Key)} value={str(s.Key)}>{str(s.Title)}</option>)}
              </select></label>
            <label className="doc-field" style={{ flex: "2 1 200px" }}><span>Rule name</span><input className="input" value={draft.name} placeholder="e.g. Bookkeeping by transactions" onChange={(e) => set({ name: e.target.value })} /></label>
            <label className="doc-field" style={{ flex: "1 1 130px" }}><span>Fee is per</span>
              <select className="input" value={draft.period} onChange={(e) => set({ period: e.target.value as PricingRule["period"] })}>{PERIOD_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          </div>
          <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
            <label className="doc-field" style={{ width: 150 }}><span>Base fee (£ net)</span><input className="input" inputMode="decimal" value={String(draft.base)} onChange={(e) => set({ base: Math.max(0, Number(e.target.value) || 0) })} /></label>
            <label className="doc-field" style={{ width: 150 }}><span>Minimum fee (£)</span><input className="input" inputMode="decimal" value={String(draft.minimum)} onChange={(e) => set({ minimum: Math.max(0, Number(e.target.value) || 0) })} /></label>
            <label className="doc-field" style={{ width: 200 }}><span>Round the answer</span>
              <select className="input" value={draft.round} onChange={(e) => set({ round: Number(e.target.value) })}>{ROUNDINGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <strong>Add for each unit</strong>
            {draft.drivers.map((d, i) => (
              <div key={i} className="row-wrap" style={{ gap: 6 }}>
                <select className="input" aria-label="Field" value={d.fieldKey} onChange={(e) => set({ drivers: draft.drivers.map((x, j) => (j === i ? { ...x, fieldKey: e.target.value } : x)) })}>
                  <option value="">Choose a field…</option>{nums.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
                <span>£</span><input className="input" style={{ width: 90 }} inputMode="decimal" aria-label="Rate" value={String(d.rate)} onChange={(e) => set({ drivers: draft.drivers.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) || 0 } : x)) })} />
                <span>for every</span><input className="input" style={{ width: 80 }} inputMode="numeric" aria-label="Units" value={String(d.per)} onChange={(e) => set({ drivers: draft.drivers.map((x, j) => (j === i ? { ...x, per: Math.max(0, Number(e.target.value) || 0) } : x)) })} />
                <button type="button" className="linkbtn" onClick={() => set({ drivers: draft.drivers.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            ))}
            <div><button type="button" className="btn small" disabled={!nums.length} onClick={() => set({ drivers: [...draft.drivers, { fieldKey: nums[0]?.key || "", rate: 0, per: 1 }] })}>Add a per-unit price</button></div>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <strong>Bands (instead of, or as well as, per unit)</strong>
            {draft.bands.length > 0 && <label className="doc-field" style={{ maxWidth: 300 }}><span>Band on</span>
              <select className="input" value={draft.bandField} onChange={(e) => set({ bandField: e.target.value })}><option value="">Choose a field…</option>{nums.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></label>}
            {draft.bands.map((b, i) => (
              <div key={i} className="row-wrap" style={{ gap: 6 }}>
                <span>Up to</span><input className="input" style={{ width: 130 }} inputMode="decimal" aria-label="Band limit" placeholder="no limit" value={b.upTo === null ? "" : String(b.upTo)} onChange={(e) => set({ bands: draft.bands.map((x, j): Band => (j === i ? { ...x, upTo: e.target.value.trim() === "" ? null : Number(e.target.value) || 0 } : x)) })} />
                <span>costs £</span><input className="input" style={{ width: 100 }} inputMode="decimal" aria-label="Band fee" value={String(b.fee)} onChange={(e) => set({ bands: draft.bands.map((x, j) => (j === i ? { ...x, fee: Math.max(0, Number(e.target.value) || 0) } : x)) })} />
                <button type="button" className="linkbtn" onClick={() => set({ bands: draft.bands.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            ))}
            <div><button type="button" className="btn small" disabled={!nums.length} onClick={() => set({ bandField: draft.bandField || nums[0]?.key || "", bands: [...draft.bands, { upTo: null, fee: 0 }] })}>Add a band</button> <span className="muted">Leave the limit empty on the last band to mean "anything above".</span></div>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            <strong>Extras (yes / no fields)</strong>
            {draft.extras.map((e, i) => (
              <div key={i} className="row-wrap" style={{ gap: 6 }}>
                <select className="input" aria-label="Extra field" value={e.fieldKey} onChange={(ev) => set({ extras: draft.extras.map((x, j) => (j === i ? { ...x, fieldKey: ev.target.value } : x)) })}>
                  <option value="">Choose a field…</option>{yns.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
                <span>adds £</span><input className="input" style={{ width: 90 }} inputMode="decimal" aria-label="Extra amount" value={String(e.amount)} onChange={(ev) => set({ extras: draft.extras.map((x, j) => (j === i ? { ...x, amount: Number(ev.target.value) || 0 } : x)) })} />
                <button type="button" className="linkbtn" onClick={() => set({ extras: draft.extras.filter((_, j) => j !== i) })}>Remove</button>
              </div>
            ))}
            <div><button type="button" className="btn small" disabled={!yns.length} onClick={() => set({ extras: [...draft.extras, { fieldKey: yns[0]?.key || "", amount: 0 }] })}>Add an extra</button></div>
          </div>

          <div className="card" style={{ padding: 10 }}>
            <label className="doc-field" style={{ maxWidth: 360 }}><span>Try it on a client</span>
              <select className="input" value={tryOn} onChange={(e) => setTryOn(e.target.value)}><option value="">Choose a client…</option>{clients.map((c) => <option key={str(c.Key)} value={str(c.Key)}>{str(c.Title)}</option>)}</select></label>
            {sample && <Working fee={sample.fee} steps={sample.steps} missing={sample.missing} period={draft.period} />}
          </div>

          {problems.length > 0 && <ul role="alert" style={{ color: "var(--red-ink)", margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>Save rule</button>
            <button type="button" className="btn" onClick={() => { setDraft(null); setProblems([]); }}>Cancel</button>
          </div>
        </section>
      )}
    </div>
  );
}

function Working({ fee, steps, missing, period }: { fee: number; steps: { label: string; amount: number }[]; missing: string[]; period: string }) {
  return (
    <div className="stack" style={{ gap: 4, marginTop: 8 }}>
      <table className="grid"><tbody>
        {steps.map((s, i) => <tr key={i}><td>{s.label}</td><td style={{ textAlign: "right" }}>{gbp(s.amount)}</td></tr>)}
        <tr><td><strong>Suggested fee{period ? ` (${periodLabel(period).toLowerCase()})` : ""}</strong></td><td style={{ textAlign: "right" }}><strong>{gbp(fee)}</strong></td></tr>
      </tbody></table>
      {missing.length > 0 && <p className="import-list warn" role="note" style={{ margin: 0 }}>No figure recorded for {missing.join(", ")}, so those aren't counted.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ on a client's fee schedule

/** Per fee line: what the rule suggests against what the client pays, with the working. Nothing here changes a fee. */
export function ClientPricingCheck({ clientKey, lines }: { clientKey: string; lines: FeeLine[] }) {
  const { data } = useData();
  const rules = useRules();
  const defs = useCustomDefs();
  const svc = useServiceName();
  const values = useMemo(() => valuesOf(data.customValues, "client", clientKey), [data.customValues, clientKey]);
  const checks = lines.map((l) => checkLine(l, rules, values, defs)).filter((c): c is Check => !!c);
  if (!checks.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }} role="group" aria-label="Pricing check">
      <strong>Pricing check</strong>
      {checks.map((c) => (
        <details key={c.serviceKey}>
          <summary>
            {svc(c.serviceKey)}: pays {gbp(c.agreed)}{c.suggested !== undefined ? <>, rule says {gbp(c.suggested)} {" "}
              {c.gap! > 0.004 ? <span className="chip amber">{gbp(c.gap!)} below{c.period ? ` ${periodLabel(c.period).toLowerCase()}` : ""}</span> : c.gap! < -0.004 ? <span className="chip green">{gbp(-c.gap!)} above the rule</span> : <span className="chip green">in line</span>}</> : <span className="muted"> · {c.reason}</span>}
            {!c.complete && c.suggested !== undefined && <span className="chip amber" title={`No figure for ${c.missing.join(", ")}`}>incomplete figures</span>}
          </summary>
          <Working fee={c.suggested ?? 0} steps={c.steps} missing={c.missing} period={c.period} />
          <p className="muted" style={{ margin: "6px 0 0" }}>From pricing rule v{c.ruleVersion}. It suggests only: to change the fee, use Adjust on the fee line.{c.gapYear ? ` A gap of ${gbp(Math.abs(c.gapYear))} a year.` : ""}</p>
        </details>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ fee review list

export function PricingCheckList() {
  const { data } = useData();
  const rules = useRules();
  const defs = useCustomDefs();
  const svc = useServiceName();
  const [min, setMin] = useState("0");
  const [only, setOnly] = useState(true);
  const rows = useMemo(() => checkAll(data.clientServices.map(readFeeLine), rules, (k) => valuesOf(data.customValues, "client", k), defs, (k) => str(data.clients.find((c) => c.Key === k)?.Title) || k), [data.clientServices, data.customValues, data.clients, rules, defs]);
  const shown = only ? belowRule(rows, Number(min) || 0) : rows;
  const below = belowRule(rows, 0);
  const total = below.reduce((a, r) => a + (r.gapYear || 0), 0);
  if (!rules.length) return <div className="import-list" role="note">No pricing rules yet. Add one under <a href={href("settings", "pricing")}>Settings › Pricing rules</a> and the clients paying below it will be listed here.</div>;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="import-list" role="note"><strong>A fee review list, not a price change.</strong> Each line compares what the client pays with what your pricing rule suggests from their recorded figures. {below.length ? `${below.length} line${below.length === 1 ? " is" : "s are"} below the rule, ${gbp(total)} a year in all.` : "Nothing is below the rule."} Clients with missing figures are marked, because their suggestion may be too low.</div>
      <div className="row-wrap" style={{ gap: 10 }}>
        <label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only those paying below the rule</label>
        {only && <label className="row-wrap" style={{ gap: 6 }}>by at least £<input className="input" style={{ width: 90 }} inputMode="decimal" aria-label="Minimum gap a year" value={min} onChange={(e) => setMin(e.target.value)} /> a year</label>}
        <button type="button" className="btn small" disabled={!shown.length} onClick={() => downloadFile(new TextEncoder().encode("﻿" + checkCsv(shown, svc)), `Pricing check ${todayIso()}.csv`, "text/csv")}>Export CSV</button>
      </div>
      {!shown.length ? <p className="muted">Nothing to show.</p> : (
        <div className="card" style={{ overflowX: "auto" }}><table className="grid">
          <thead><tr><th>Client</th><th>Service</th><th>Pays</th><th>Rule says</th><th>Gap</th><th>A year</th><th /></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={`${r.clientKey}${r.serviceKey}`}>
              <td><a href={href("clients", r.clientKey)}>{r.clientName}</a></td><td>{svc(r.serviceKey)}</td>
              <td>{gbp(r.agreed)}{r.period ? <span className="muted"> {periodLabel(r.period).toLowerCase()}</span> : ""}</td>
              <td>{r.suggested !== undefined ? gbp(r.suggested) : <span className="muted">{r.reason}</span>}</td>
              <td>{r.gap !== undefined ? <span className={r.gap > 0.004 ? "chip amber" : "chip green"}>{r.gap > 0 ? "+" : ""}{gbp(r.gap)}</span> : "—"}</td>
              <td>{r.gapYear !== undefined ? gbp(r.gapYear) : "—"}</td>
              <td>{!r.complete && <span className="chip amber" title={`No figure for ${r.missing.join(", ")}`}>missing figures</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ catch-up fees

/** Add a catch-up fee for a backlog, and approve the ones waiting. `charges` are this client's FeeCharges rows. */
export function CatchUp({ client, lines, charges, can, busy, doW }: { client: Row; lines: { line: FeeLine }[]; charges: Row[]; can: boolean; busy: boolean; doW: (w: any, ok?: string) => void }) {
  const s = useSales();
  const { data } = useData();
  const rules = useRules();
  const defs = useCustomDefs();
  const svc = useServiceName();
  const today = todayIso();
  const [open, setOpen] = useState(false);
  const eligible = lines.map((x) => x.line).filter((l) => l.status === "active" && !l.oneOff);
  const [lineKey, setLineKey] = useState("");
  const line = eligible.find((l) => l.key === lineKey) || eligible[0];
  const prev = new Date(); prev.setMonth(prev.getMonth() - 1);
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01`);
  const [to, setTo] = useState(prev.toISOString().slice(0, 7));
  const [basis, setBasis] = useState<"agreed" | "rule">("agreed");
  const [premium, setPremium] = useState("0");
  const [typed, setTyped] = useState("");
  const values = useMemo(() => valuesOf(data.customValues, "client", str(client.Key)), [data.customValues, client.Key]);
  const rule = line ? activeRule(rules, line.serviceKey) : undefined;
  const ruleMonthly = useMemo(() => {
    if (!rule || !line) return undefined;
    const sg = suggest(rule, values, defs);
    const per = rule.period === "monthly" ? 12 : rule.period === "quarterly" ? 4 : rule.period === "annually" ? 1 : 0;
    return per && sg.fee > 0 ? Math.round(((sg.fee * per) / 12) * 100) / 100 : undefined;
  }, [rule, line, values, defs]);
  const waiting = charges.filter((c) => str(c.Status) === "proposed");
  const input = line ? { line, from, to, basis, ruleMonthly, premiumPct: Number(premium) || 0, override: typed.trim() === "" ? undefined : Number(typed), vat: line.vat || "standard", today, serviceName: svc(line.serviceKey) } : undefined;
  const working = input ? catchUpWorking(input) : undefined;
  const clash = input ? overlapping(charges, str(client.Key), input.line.serviceKey, from, to)[0] : undefined;
  const clashP = clash ? catchUpPeriod(clash) : undefined;
  if (!can && !waiting.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }} role="group" aria-label="Catch-up fees">
      <strong>Catch-up fees</strong>
      {waiting.map((c) => (
        <div key={str(c.Key)} className="import-list warn" role="group" aria-label={`Waiting for approval: ${str(c.Label)}`}>
          <strong>Waiting for approval:</strong> {str(c.Label)}, {gbp(Number(c.Amount) || 0)}.
          <div className="muted" style={{ whiteSpace: "pre-line" }}>{str(c.Notes).split("\n").slice(1).join("\n")}</div>
          {can && <div className="row-wrap" style={{ gap: 6, marginTop: 6 }}>
            <button type="button" className="btn small primary" disabled={busy} onClick={() => doW(approveCatchUp(c, client, today, s.pcan, s.ctx()), "Catch-up fee agreed. It is listed with the other agreed charges; invoice it from Xero as usual.")}>Approve</button>
          </div>}
        </div>
      ))}
      {!open ? (can && <div><button type="button" className="btn small" disabled={!eligible.length} onClick={() => setOpen(true)}>Add a catch-up fee</button>{!eligible.length && <span className="muted"> This client has no active recurring fee to base it on.</span>}</div>) : line && (
        <div className="card stack" style={{ padding: 12, gap: 8 }}>
          <p className="muted" style={{ margin: 0 }}>For work already behind when the client joined (months of bookkeeping, a late year of accounts). It is proposed first: it doesn't count as agreed revenue until you approve it, and nothing is invoiced from here.</p>
          <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
            <label className="doc-field" style={{ flex: "2 1 200px" }}><span>Service</span>
              <select className="input" value={line.key} onChange={(e) => setLineKey(e.target.value)}>{eligible.map((l) => <option key={l.key} value={l.key}>{svc(l.serviceKey)} ({gbp(l.fee)} {periodLabel(l.period).toLowerCase()})</option>)}</select></label>
            <label className="doc-field" style={{ width: 160 }}><span>First month</span><input className="input" type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="doc-field" style={{ width: 160 }}><span>Last month</span><input className="input" type="month" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div className="row-wrap" style={{ gap: 8, alignItems: "flex-end" }}>
            <label className="doc-field" style={{ flex: "1 1 220px" }}><span>Monthly rate from</span>
              <select className="input" value={basis} onChange={(e) => setBasis(e.target.value as "agreed" | "rule")}>
                <option value="agreed">The agreed fee ({monthlyRate(line) !== undefined ? `${gbp(monthlyRate(line)!)} a month` : "no monthly rate"})</option>
                <option value="rule" disabled={!rule}>The pricing rule{rule ? ` (${ruleMonthly !== undefined ? `${gbp(ruleMonthly)} a month` : "no figure yet"})` : " (none for this service)"}</option>
              </select></label>
            <label className="doc-field" style={{ width: 130 }}><span>Premium (%)</span><input className="input" inputMode="decimal" value={premium} onChange={(e) => setPremium(e.target.value)} /></label>
            <label className="doc-field" style={{ width: 170 }}><span>Or type the total (£)</span><input className="input" inputMode="decimal" placeholder="use the working" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
          </div>
          {working && ("error" in working
            ? <p className="muted" role="status" style={{ margin: 0 }}>{working.error}</p>
            : <p role="status" style={{ margin: 0 }}>{working.months} month{working.months === 1 ? "" : "s"} ({monthName(from)} to {monthName(to)}) x {gbp(working.monthly)}{working.premiumPct ? ` + ${working.premiumPct}%` : ""} = <strong>{gbp(working.amount)}</strong> net{working.overridden ? " (typed amount)" : ""}. Up to {MAX_MONTHS} months in one charge.</p>)}
          {clashP && <p className="muted" role="status" style={{ margin: 0 }}>There is already a catch-up charge for this service covering {monthName(clashP.from)} to {monthName(clashP.to)} ({str(clash!.Status) === "proposed" ? "waiting for approval" : "agreed"}). Cancel it first if it is wrong.</p>}
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn small primary" disabled={busy || !input || !!clashP} onClick={() => input && doW(proposeCatchUp(client, input, charges, s.pcan, s.ctx()), "Catch-up fee proposed. Approve it when you are happy with it.")}>Propose this charge</button>
            <button type="button" className="linkbtn" onClick={() => setOpen(false)}>Close</button>
          </div>
          <span className="muted">VAT: follows the fee line ({VAT_OPTIONS.find(([k]) => k === (line.vat || "standard"))?.[1]}).</span>
        </div>
      )}
    </div>
  );
}
