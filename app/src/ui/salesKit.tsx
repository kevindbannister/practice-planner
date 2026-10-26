// Shared bits for the Sales screens: who you are, the pipeline settings, and one place that saves what the sales logic decided.
import { useMemo } from "react";
import { todayIso } from "../lib/domain";
import { newKey } from "../lib/planning";
import { practiceId } from "../lib/checklistRows";
import { Row, ListKey } from "../lib/schema";
import { Lead, Opp, SalesAction, Written, DEFAULT_LOST_REASONS, DEFAULT_SOURCES, logRow, outcomeOf, readPipeline, readStrings, salesCan, salesConfig, wonStage } from "../lib/sales";
import { useData } from "./data";

export function useSales() {
  const { data, user, create, updateMany } = useData();
  const stages = useMemo(() => readPipeline(data.settings), [data.settings]);
  const sources = useMemo(() => readStrings(data.settings, "sales.sources", DEFAULT_SOURCES), [data.settings]);
  const lostReasons = useMemo(() => readStrings(data.settings, "sales.lostReasons", DEFAULT_LOST_REASONS), [data.settings]);
  const cfg = useMemo(() => salesConfig(data.settings), [data.settings]);
  const me = user || "";
  const can = (a: SalesAction) => salesCan(cfg, me, a);
  const ctx = () => ({ actor: me, now: new Date().toISOString(), pid: practiceId(data.settings), newKey });
  const opps = data.opportunities as Opp[];
  const leads = data.leads as Lead[];

  /** Save what the sales logic produced: the changes, the audit lines and the timeline entries. */
  const apply = async (w: Written) => {
    const by = new Map<string, { row: Row; patch: Row }[]>();
    for (const p of w.patches) by.set(p.list, [...(by.get(p.list) || []), { row: p.row, patch: p.patch }]);
    for (const [list, changes] of by) await updateMany(list as ListKey, changes);
    for (const l of w.log) await create("SalesLog", l);
    for (const a of w.activities) await create("Activities", a);
  };

  /** A plain edit of a few fields (value, owner, notes...), with an audit line saying what changed. */
  const edit = async (list: "Leads" | "Opportunities", row: Row, patch: Row) => {
    const changed: Record<string, [unknown, unknown]> = {};
    for (const [k, v] of Object.entries(patch)) if (String(row[k] ?? "") !== String(v ?? "")) changed[k] = [row[k] ?? "", v];
    if (!Object.keys(changed).length) return;
    const o = ctx();
    await updateMany(list, [{ row, patch: { ...patch, Updated: o.now } }]);
    const refs = list === "Leads" ? { leadKey: String(row.Key), clientKey: String(row.ClientKey || "") } : { leadKey: String(row.LeadKey || ""), clientKey: String(row.ClientKey || "") };
    await create("SalesLog", logRow(o, "edited", list === "Leads" ? "lead" : "opportunity", String(row.Key), refs, changed));
  };

  const nameOf = (o: Row): string => {
    if (o.ClientKey) return data.clients.find((c) => c.Key === o.ClientKey)?.Title || "Client";
    if (o.LeadKey) return String(leads.find((l) => l.Key === o.LeadKey)?.Title || "Lead");
    return "";
  };
  return { data, me, stages, sources, lostReasons, can, ctx, apply, edit, opps, leads, nameOf, won: wonStage(stages), today: todayIso() };
}

export const money = (v: unknown) => {
  const n = Number(v) || 0;
  return n ? "£" + n.toLocaleString("en-GB", { maximumFractionDigits: 0 }) : "";
};

export const outcomeChip = (o: Row) => {
  const x = outcomeOf(o);
  return x === "won" ? { label: "Won", cls: "green" } : x === "lost" ? { label: "Lost", cls: "red" } : x === "deferred" ? { label: "Deferred", cls: "amber" } : null;
};
