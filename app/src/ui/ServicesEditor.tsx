// "Edit services and fees": every service the practice offers in one list, tick the ones this client has, set the agreed fee and how often
// it is charged. Totals update as you go. All the rules (who may change a fee, the reason, the history) live in lib/fees.ts.
import { useMemo, useState } from "react";
import { todayIso } from "../lib/domain";
import { PERIOD_OPTIONS, ServiceEdit, periodsPerYear, planServiceEdit, periodText, readFeeLine, readFeeSettings, feeCan } from "../lib/fees";
import { clientTypeFor } from "../lib/proposals";
import { Row } from "../lib/schema";
import { isStatutory, statutoryRank } from "../lib/workGroups";
import { useData } from "./data";
import { useSales } from "./salesKit";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const gbp = (n: number) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });
type Line = { key: string; name: string; statutory: boolean; suggested: number; suggestedPeriod: string; typical: boolean; had: boolean };

export function ServicesEditor({ client, onClose, onSaved }: { client: Row; onClose: () => void; onSaved?: (text: string) => void }) {
  const s = useSales();
  const { data } = useData();
  const reviewMonths = useMemo(() => readFeeSettings(data.settings).reviewMonths, [data.settings]);
  const ck = str(client.Key);
  const type = clientTypeFor(str(client.Kind));
  const mine = data.clientServices.filter((r) => str(r.ClientKey) === ck);
  const canFees = feeCan(s.cfg, s.me, "adjust");
  const lines: Line[] = useMemo(() => {
    const byKey = new Map(data.services.map((x) => [str(x.Key), x]));
    return s.catalogue.filter((c) => c.active || mine.some((r) => str(r.ServiceKey) === c.key)).map((c) => {
      const price = c.pricing[type]?.price ?? c.price;
      const freq = c.pricing[type]?.frequency ?? c.frequency;
      return { key: c.key, name: c.name || c.key, statutory: isStatutory(byKey.get(c.key), c.key), suggested: price, suggestedPeriod: periodText(freq) || "", typical: !c.types.length || c.types.includes(type), had: mine.some((r) => str(r.ServiceKey) === c.key) };
    }).sort((a, b) => statutoryRank(a.key) - statutoryRank(b.key) || a.name.localeCompare(b.name));
  }, [s.catalogue, data.services, data.clientServices, ck]); // eslint-disable-line react-hooks/exhaustive-deps
  const initial = (l: Line): ServiceEdit => {
    const row = mine.filter((r) => str(r.ServiceKey) === l.key).find((r) => !str(r.EndedOn)) || mine.find((r) => str(r.ServiceKey) === l.key);
    if (!row) return { serviceKey: l.key, on: false, fee: "", period: l.suggestedPeriod || "annually" };
    const f = readFeeLine(row);
    return { serviceKey: l.key, on: !f.held && !f.ended, fee: f.fee ? String(f.fee) : "", period: f.period || (f.oneOff ? "" : "annually") };
  };
  const [edits, setEdits] = useState<Record<string, ServiceEdit>>(() => Object.fromEntries(lines.map((l) => [l.key, initial(l)])));
  const [q, setQ] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const set = (k: string, p: Partial<ServiceEdit>) => setEdits((e) => ({ ...e, [k]: { ...e[k], ...p } }));
  const toggle = (l: Line, on: boolean) => {
    const e = edits[l.key];
    // a service the client has never had starts at the suggested fee, which can be changed
    set(l.key, { on, ...(on && !l.had && !e.fee && l.suggested > 0 && canFees ? { fee: String(l.suggested), period: l.suggestedPeriod || e.period } : {}) });
  };
  const shown = lines.filter((l) => !q.trim() || l.name.toLowerCase().includes(q.trim().toLowerCase()));
  const on = lines.filter((l) => edits[l.key]?.on);
  const total = (p: string) => on.reduce((a, l) => (edits[l.key].period === p ? a + (Number(edits[l.key].fee) || 0) : a), 0);
  const annual = on.reduce((a, l) => a + (Number(edits[l.key].fee) || 0) * periodsPerYear(edits[l.key].period), 0);
  const save = async () => {
    setBusy(true); setErr(undefined);
    try {
      const w = planServiceEdit({ client, schedule: data.clientServices, edits: lines.map((l) => edits[l.key]), today: todayIso(), reviewMonths, reason, vatFor: (k) => s.catalogue.find((c) => c.key === k)?.vat || "standard", can: s.pcan }, s.ctx());
      if ("error" in w) { setErr(w.error); return; }
      await s.apply(w);
      onSaved?.("Services and fees saved."); onClose();
    } catch (e) { setErr(e instanceof Error && e.message ? e.message : "That didn't save. Nothing has changed; try again."); } finally { setBusy(false); }
  };
  const group = (title: string, list: Line[]) => list.length ? (
    <div className="stack" style={{ gap: 2 }}>
      <h3 style={{ margin: "8px 0 2px", fontSize: 13 }} className="muted">{title}</h3>
      {list.map((l) => {
        const e = edits[l.key];
        return (
          <div key={l.key} className="row-wrap" style={{ gap: 10, alignItems: "center", padding: "3px 0", borderBottom: "1px solid var(--line-2)", opacity: l.typical || e.on ? 1 : 0.6 }}>
            <label className="row-wrap" style={{ gap: 8, flex: "1 1 220px", minWidth: 200 }}>
              <input type="checkbox" checked={e.on} onChange={(ev) => toggle(l, ev.target.checked)} aria-label={`${l.name}: this client has it`} />
              <span>{l.name}{!l.typical && <span className="muted" style={{ fontSize: 12 }}> · not usually for this type</span>}</span>
            </label>
            <label className="row-wrap" style={{ gap: 4 }}>
              <span className="sr-only">Fee for {l.name}</span>
              <span className="muted">£</span>
              <input className="input" type="number" min={0} step="0.01" style={{ width: 96 }} value={e.fee} disabled={!canFees || !e.on} placeholder={e.on ? "0" : ""} onChange={(ev) => set(l.key, { fee: ev.target.value })} />
            </label>
            <select className="input" style={{ width: 118 }} aria-label={`How often ${l.name} is charged`} value={e.period} disabled={!canFees || !e.on} onChange={(ev) => set(l.key, { period: ev.target.value })}>
              {PERIOD_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <span className="muted mono" style={{ width: 92, textAlign: "right", fontSize: 12 }}>{e.on && Number(e.fee) > 0 && periodsPerYear(e.period) ? `${gbp(Number(e.fee) * periodsPerYear(e.period))} a year` : ""}</span>
            <span style={{ width: 130, fontSize: 12 }} className="muted">
              {canFees && l.suggested > 0 ? (e.fee === String(l.suggested) ? `list ${gbp(l.suggested)}` : <button type="button" className="linkbtn" style={{ minHeight: 0, padding: 0, fontSize: 12 }} disabled={!e.on} onClick={() => set(l.key, { fee: String(l.suggested), period: l.suggestedPeriod || e.period })}>Use list {gbp(l.suggested)}</button>) : ""}
            </span>
          </div>
        );
      })}
    </div>
  ) : null;
  return (
    <section className="card pad stack" role="group" aria-label="Edit services and fees" style={{ gap: 10 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Edit services and fees for {str(client.Title)}</h3>
        <input className="input" placeholder="Find a service" aria-label="Find a service" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Tick the services this client has. Unticking turns a service off: any open job stays until you complete it and no new job is created. {canFees ? "Fees are agreed fees before VAT." : "Only a manager or partner can set or change fees; you can still switch services on and off."}</p>
      {group("Statutory work", shown.filter((l) => l.statutory))}
      {group("Other services", shown.filter((l) => !l.statutory))}
      {!shown.length && <p className="muted">No service matches.</p>}
      <div className="card" style={{ padding: 10 }}>
        <div className="row-wrap" style={{ gap: 18 }}>
          <span>Annual <strong>{gbp(total("annually"))}</strong></span>
          <span>Quarterly <strong>{gbp(total("quarterly"))}</strong></span>
          <span>Monthly <strong>{gbp(total("monthly"))}</strong></span>
          <span>One-off <strong>{gbp(total(""))}</strong></span>
          <span style={{ marginLeft: "auto" }}>Total a year <strong>{gbp(annual)}</strong></span>
        </div>
      </div>
      {canFees && <input className="input" aria-label="Why a fee is changing" placeholder="Why is a fee changing? (needed when you change an existing fee)" value={reason} onChange={(e) => setReason(e.target.value)} />}
      {err && <p role="alert" style={{ color: "var(--red-ink)", margin: 0 }}>{err}</p>}
      <div className="row-wrap"><button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save services and fees"}</button><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button></div>
    </section>
  );
}
