// Shared bits for the Co Sec screens: who you are, the records, and one place that saves what the Co Sec logic produced.
import { useEffect, useMemo, useRef } from "react";
import { newKey } from "../lib/planning";
import { practiceId } from "../lib/checklistRows";
import { readConfig } from "../lib/checklist";
import { CoSecAction, CoSecWritten, Snapshot, cosecCan, scanDifferences } from "../lib/cosec";
import { CoSecGateway, FakeGateway, HttpGateway } from "../lib/cosecGateway";
import { Row, ListKey } from "../lib/schema";
import { getAccessToken } from "../lib/auth";
import { useData } from "./data";

let demoMode = false;
/** The demo build has no server, so filings are accepted by a stand-in. Set once by the app. */
export const setCoSecDemo = (v: boolean) => { demoMode = v; };

export function useCoSec() {
  const { data, user, create, updateMany, update, status } = useData();
  const cfg = useMemo(() => readConfig(data.settings), [data.settings]);
  const me = user || "";
  const can = (a: CoSecAction) => cosecCan(cfg, me, a);
  const ctx = () => ({ actor: me, now: new Date().toISOString(), pid: practiceId(data.settings), newKey });
  const snap = (): Snapshot => ({ clients: data.clients, officers: data.cosecOfficers, pscs: data.cosecPscs, shares: data.cosecShares, classes: data.cosecShareClasses, ledger: data.cosecLedger, txs: data.cosecTx, events: data.cosecEvents });
  const companies = useMemo(() => data.clients.filter((c) => (c.Kind === "Ltd" || c.Kind === "LLP") && String(c.CompanyNumber || "").trim()), [data.clients]);
  const gateway = useRef<CoSecGateway>();
  if (!gateway.current) gateway.current = demoMode ? new FakeGateway() : new HttpGateway(getAccessToken);

  /** Save what the Co Sec logic decided: new rows, changes, audit lines, timeline entries, and the client's last-verified record. */
  const apply = async (w: CoSecWritten) => {
    for (const c of w.creates || []) await create(c.list, c.row);
    const by = new Map<string, { row: Row; patch: Row }[]>();
    for (const p of w.patches) by.set(p.list, [...(by.get(p.list) || []), { row: p.row, patch: p.patch }]);
    for (const [list, changes] of by) await updateMany(list as ListKey, changes);
    if (w.verified) { const c = data.clients.find((x) => x.Key === w.verified!.clientKey); if (c) await update("Clients", c, { CHVerified: JSON.stringify(w.verified.value) }, { source: "ch-sync" }); }
    for (const l of w.log) await create("SalesLog", l);
    for (const a of w.activities) await create("Activities", a);
  };
  /** Look for differences from Companies House that no edit announced (for example a portal change the server applied). */
  const scan = async (source: "portal" | "other" = "other") => {
    const w = scanDifferences(snap(), ctx(), source);
    await apply(w);
    return w.found;
  };
  return { data, me, cfg, can, ctx, snap, apply, scan, companies, gateway: gateway.current, update, ready: status === "ready" };
}

export const nameOfClient = (data: { clients: Row[] }, key: unknown) => String(data.clients.find((c) => c.Key === key)?.Title || "Client");

/**
 * Keeps watch quietly: when a company's statutory details or what Companies House last showed change (for example a client change the
 * portal's server applied after staff approved it), any difference is turned into a draft. Each distinct difference is processed once.
 */
export function CoSecSync() {
  const k = useCoSec();
  const { store } = useData();
  const busy = useRef(false);
  const last = useRef("");
  const sig = k.companies.map((c) => `${c.Key}|${c.RegisteredOffice}|${c.Title}|${c.YearEnd}|${String(c.CHVerified || "").length}`).join(";");
  useEffect(() => {
    if (!k.ready || !k.can("edit") || !store.hasList("CoSecTransactions") || !store.hasList("CoSecEvents") || busy.current || sig === last.current) return;
    const timer = setTimeout(async () => {
      busy.current = true;
      try { await k.scan("portal"); last.current = sig; } catch (e) { console.warn("Co Sec couldn't check for changes", e); last.current = sig; } finally { busy.current = false; }
    }, 2500);
    return () => clearTimeout(timer);
  }, [sig, k.ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
