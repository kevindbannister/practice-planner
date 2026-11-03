// Court and council orders taken from pay: attachment of earnings orders (a normal deduction with protected earnings, arrears carried for
// priority orders such as maintenance), Child Maintenance Service deduction orders, and council tax attachments in England (a table of
// percentages of net earnings). Worked out on attachable earnings: pay after tax, NI and pension contributions. A £1 admin fee may be
// taken for each deduction. Always follow the wording of the order itself.
import { Freq } from "./engine";

const r2 = (v: number) => Math.round(v * 100) / 100 + 0;
export type OrderKind = "aeo" | "cms" | "council-tax" | "fixed";
export const ORDER_LABEL: Record<OrderKind, string> = { aeo: "Attachment of earnings order (court)", cms: "Child Maintenance deduction order", "council-tax": "Council tax attachment (England)", fixed: "Other order: fixed amount" };
export type Order = { id: string; kind: OrderKind; ref: string; normal: number; protected: number; carryArrears: boolean; fee: boolean; start: string; end: string; cap: number };
export const readOrders = (v: unknown): Order[] => {
  let a: any[] = [];
  try { a = JSON.parse(String(v || "[]")); } catch { a = []; }
  return (Array.isArray(a) ? a : []).map((o, i) => ({
    id: String(o.id || `o${i + 1}`), kind: (["aeo", "cms", "council-tax", "fixed"] as const).find((k) => k === o.kind) || "fixed", ref: String(o.ref || ""),
    normal: Math.max(0, Number(o.normal) || 0), protected: Math.max(0, Number(o.protected) || 0), carryArrears: o.carryArrears === true || o.kind === "cms", fee: o.fee !== false,
    start: String(o.start || ""), end: String(o.end || ""), cap: Math.max(0, Number(o.cap) || 0),
  }));
};

// Council Tax (Administration and Enforcement) Regulations 1992, Schedule 4 (England), as amended: net earnings bands and percentages.
const CT_MONTHLY: [number, number][] = [[300, 0], [550, 0.03], [740, 0.05], [900, 0.07], [1420, 0.12], [2020, 0.17]];
const CT_WEEKLY: [number, number][] = [[75, 0], [135, 0.03], [185, 0.05], [225, 0.07], [355, 0.12], [505, 0.17]];
export function councilTaxDeduction(net: number, freq: Freq): number {
  const mult = freq === "W2" ? 2 : freq === "W4" ? 4 : 1;
  const table = freq === "M1" ? CT_MONTHLY : CT_WEEKLY.map(([b, p]) => [b * mult, p] as [number, number]);
  const top = table[table.length - 1][0];
  if (net > top) return r2(top * 0.17 + (net - top) * 0.5);
  const band = table.find(([b]) => net <= b)!;
  return r2(net * band[1]);
}

export type OrderState = { arrears: number; collected: number };
/** Take each order in turn from attachable earnings, oldest first. Returns what was taken, any fee and any shortfall. */
export function applyOrders(orders: Order[], attachable: number, freq: Freq, payday: string, state: Record<string, OrderState>) {
  let left = Math.max(0, attachable);
  const out: { id: string; label: string; amount: number; fee: number; shortfall: number }[] = [];
  for (const o of [...orders].sort((a, b) => a.start.localeCompare(b.start))) {
    if ((o.start && payday < o.start) || (o.end && payday > o.end)) continue;
    const st = state[o.id] || { arrears: 0, collected: 0 };
    const remaining = o.cap ? Math.max(0, o.cap - st.collected) : Infinity;
    if (remaining <= 0) continue;
    let due: number, can: number;
    if (o.kind === "council-tax") { due = councilTaxDeduction(left, freq); can = due; }
    else { due = r2(o.normal + (o.carryArrears ? st.arrears : 0)); can = Math.max(0, left - o.protected); }
    const amount = r2(Math.min(due, can, remaining));
    const fee = o.fee && amount > 0 && left - amount - 1 >= (o.kind === "council-tax" ? 0 : o.protected) ? 1 : 0;
    const shortfall = o.kind === "council-tax" ? 0 : r2(Math.max(0, Math.min(due, remaining) - amount));
    left = r2(left - amount - fee);
    out.push({ id: o.id, label: `${ORDER_LABEL[o.kind]}${o.ref ? ` ${o.ref}` : ""}`, amount, fee, shortfall });
  }
  return out;
}
