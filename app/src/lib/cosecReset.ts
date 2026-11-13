// TEMPORARY: reset the Co Sec filings that change detection prepared, then prepare them again from what Companies House shows now, as if each
// company had just been added. This exists to clear out test and stale drafts. Remove it once Co Sec's filings are settled.
//
// What is removed: drafts that were never sent to Companies House and that the planner prepared by itself (from a year end, name or
// office difference), plus the records that stopped the same difference being picked up again. What is never touched: anything filed,
// submitted or rejected by Companies House, and anything a person started by hand in Co Sec (appointments, share transfers, confirmation
// statements, a change of accounting reference date on request), because those can't be worked out again from Companies House.
import { Snapshot, Verified, scanDifferences, txStatus } from "./cosec";
import { Row } from "./schema";
import { Ctx, Written } from "./sales";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const keysOf = (v: unknown): string[] => { try { const x = JSON.parse(str(v)); return Array.isArray(x) ? x.map(String) : []; } catch { return []; } };

/** Statuses of a filing that never reached Companies House. */
const UNFILED = ["draft", "info", "approved", "declined", "cancelled"];
/** A filing the reset may remove: never sent, and prepared by change detection rather than started by a person in Co Sec. */
export const resettable = (t: Row): boolean => UNFILED.includes(txStatus(t)) && str(t.Source) !== "cosec";

export type ResetPlan = { txs: Row[]; events: Row[] };
/** What a reset would remove, without removing it. */
export function resetPlan(snap: Pick<Snapshot, "txs" | "events">): ResetPlan {
  const txs = snap.txs.filter(resettable);
  const txKeys = new Set(txs.map((t) => str(t.Key)));
  const eventKeys = new Set(txs.flatMap((t) => keysOf(t.EventKeys)));
  const events = snap.events.filter((e) => txKeys.has(str(e.TxKey)) || eventKeys.has(str(e.EventKey)));
  return { txs, events };
}

/**
 * The reset as one calculation: what to remove, and the drafts to prepare once it is gone. `verified` is what Companies House shows now
 * for each company key; a company missing from it is compared against whatever was last recorded for it. Nothing is saved here.
 */
export function regenerate(snap: Snapshot, verified: Record<string, Verified>, o: Ctx): { plan: ResetPlan; write: Written & { found: number } } {
  const plan = resetPlan(snap);
  const goneTx = new Set(plan.txs.map((t) => str(t.Key)));
  const goneEv = new Set(plan.events.map((e) => str(e.Key)));
  const clients = snap.clients.map((c) => (verified[str(c.Key)] ? { ...c, CHVerified: JSON.stringify(verified[str(c.Key)]) } : c));
  const next: Snapshot = { ...snap, clients, txs: snap.txs.filter((t) => !goneTx.has(str(t.Key))), events: snap.events.filter((e) => !goneEv.has(str(e.Key))) };
  return { plan, write: scanDifferences(next, o, "other") };
}
