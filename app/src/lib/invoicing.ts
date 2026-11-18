// Billing finished work. When a job is completed the person is asked whether an invoice needs raising. If it does, a separate
// "Invoices to raise" job is made for it, carrying the client, the work it bills, the period and the fee, so the finished job can
// close (it has been filed) while the billing is still tracked, with its own deadline, on Home and in the plan.
import type { Row } from "./schema";
import type { WorkGroup } from "./jobBands";
import { isStatutory } from "./workGroups";

export const INVOICE_SERVICE = "INVOICE";
/** Days from completing the work to the invoice being due to go out. */
export const DEFAULT_INVOICE_DAYS = 7;
/** Where an invoice job says which job it bills (kept in the job's Source). */
const SOURCE_PREFIX = "invoice-for:";

export const isInvoiceJob = (job: object) => String((job as Record<string, unknown>).ServiceKey || "") === INVOICE_SERVICE;

/** The type of work invoice jobs belong to: one-off, not statutory, a quarter of an hour. */
export const invoiceServiceRow = (): Row => ({
  Key: INVOICE_SERVICE, Title: "Invoices", RepeatMonths: 0, DefaultHours: 0.25, Statutory: "no", Active: true, Offered: false,
  Category: "Billing", Description: "Raising the invoice for finished work. Made when a job is completed and an invoice is needed.",
});

const addDays = (iso: string, n: number) => { const t = new Date(`${iso.slice(0, 10)}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const money = (v: unknown): number | undefined => { const n = Number(String(v ?? "").replace(/[£,\s]/g, "")); return String(v ?? "").trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined; };
export const readAmount = money;

/** The invoice job for a finished job. `amount` is what to bill (the job's fee unless changed); `note` is anything the person adds. */
export function invoiceJobFor(job: Row, o: { key: string; today: string; amount?: number; note?: string; days?: number; serviceName?: string; clientName?: string }): Row {
  const due = addDays(o.today, o.days ?? DEFAULT_INVOICE_DAYS);
  const what = String(job.Title || o.serviceName || "the work");
  const lines = [
    `Invoice for ${what}${job.PeriodEnd ? `, period to ${String(job.PeriodEnd).slice(0, 10)}` : ""}.`,
    `Work completed ${o.today}.`,
    o.amount !== undefined ? `Amount: £${o.amount.toFixed(2)}${job.FeePeriod ? ` (${job.FeePeriod})` : ""}.` : "Amount: not set.",
    o.note?.trim() ? o.note.trim() : "",
  ].filter(Boolean);
  return {
    Key: o.key, ClientKey: job.ClientKey, ClientName: o.clientName || job.ClientName || "", ServiceKey: INVOICE_SERVICE,
    Title: `Invoice: ${what}`, PeriodEnd: job.PeriodEnd || "", StageNo: 1, StageName: "To raise", Status: "Open",
    Deadline: due, DeadlineSource: "Invoice", Owner: job.Owner || "", EstimateHours: 0.25, RemainingHours: 0.25,
    ...(o.amount !== undefined ? { Fee: o.amount } : {}), FeePeriod: job.FeePeriod || "",
    Source: `${SOURCE_PREFIX}${job.Key}`, Notes: lines.join("\n"),
  };
}

/** The key of the job an invoice job bills, if it is one. */
export function billedJobKey(job: Row): string | undefined {
  const s = String(job.Source || "");
  return isInvoiceJob(job) && s.startsWith(SOURCE_PREFIX) ? s.slice(SOURCE_PREFIX.length) : undefined;
}

/** Which Work by type group a type of work sits in. */
export function workGroupOf(serviceKey: string, services: Row[]): WorkGroup {
  if (serviceKey === INVOICE_SERVICE) return "invoice";
  return isStatutory(services.find((x) => x.Key === serviceKey), serviceKey) ? "statutory" : "other";
}
export const GROUP_NAME: Record<WorkGroup, string> = { statutory: "Statutory deadlines", other: "Other deadlines", invoice: "Invoices to raise" };

/* ---------- no invoice stage inside a job ---------- */
// Raising the invoice is its own job now, so a stage for it inside the work (often the last one, "Raise invoice") is taken out
// of every type of work. Jobs sitting on that stage go back to the stage before it, ready to be completed (which asks about the
// invoice); the stages after it close up; and the client-by-client settings for the stage go with it.

/** A stage whose whole job is invoicing or billing the client ("Raise invoice", "Invoicing", "Bill client"), not one that just
 *  mentions invoices ("Review purchase invoices" is bookkeeping, and stays). */
export const isInvoiceStage = (title: unknown) =>
  /^(raise|send|issue|prepare|create|draft|do)?\s*(the\s+|an\s+|final\s+)?(invoice|invoices|invoicing|bill|billing)(\s+(to\s+)?(the\s+)?(client|customer))?$/i.test(String(title || "").trim().replace(/[.:]+$/, ""));

export type StageTidy = {
  removeStages: Row[]; stagePatches: { row: Row; patch: Row }[]; jobPatches: { row: Row; patch: Row }[];
  removeClientStages: Row[]; clientStagePatches: { row: Row; patch: Row }[];
};

export function withoutInvoiceStages(stageTemplates: Row[], jobs: Row[], clientStages: Row[]): StageTidy {
  const out: StageTidy = { removeStages: [], stagePatches: [], jobPatches: [], removeClientStages: [], clientStagePatches: [] };
  const services = new Set(stageTemplates.filter((s) => isInvoiceStage(s.Title)).map((s) => String(s.ServiceKey || "")));
  for (const svc of services) {
    const stages = stageTemplates.filter((s) => String(s.ServiceKey || "") === svc).sort((a, b) => Number(a.StageNo) - Number(b.StageNo));
    const kept = stages.filter((s) => !isInvoiceStage(s.Title));
    out.removeStages.push(...stages.filter((s) => isInvoiceStage(s.Title)));
    // each old stage number's new number: a kept stage keeps its place in the order; a removed one goes to the kept stage before it
    const map = new Map<number, number>();
    let last = 1;
    for (const s of stages) {
      const i = kept.indexOf(s);
      if (i >= 0) { last = i + 1; map.set(Number(s.StageNo), last); } else map.set(Number(s.StageNo), kept.length ? last : 1);
    }
    kept.forEach((s, i) => { if (Number(s.StageNo) !== i + 1) out.stagePatches.push({ row: s, patch: { StageNo: i + 1 } }); });
    const removedNos = new Set(stages.filter((s) => isInvoiceStage(s.Title)).map((s) => Number(s.StageNo)));
    for (const j of jobs) {
      if (String(j.ServiceKey || "") !== svc) continue;
      const old = Number(j.StageNo || 1);
      const now = map.get(old) ?? old;
      if (now !== old || removedNos.has(old)) out.jobPatches.push({ row: j, patch: { StageNo: now, StageName: String(kept[now - 1]?.Title || "") } });
    }
    for (const cs of clientStages) {
      if (String(cs.ServiceKey || "") !== svc) continue;
      const old = Number(cs.StageNo);
      if (removedNos.has(old)) out.removeClientStages.push(cs);
      else if ((map.get(old) ?? old) !== old) out.clientStagePatches.push({ row: cs, patch: { StageNo: map.get(old)! } });
    }
  }
  return out;
}

/** An import bundle with any invoice stages taken out the same way, so importing again doesn't bring them back. */
export function bundleWithoutInvoiceStages<T extends { lists: Partial<Record<string, Row[]>> }>(bundle: T): T {
  const st = bundle.lists.StageTemplates || [];
  if (!st.some((s) => isInvoiceStage(s.Title))) return bundle;
  const t = withoutInvoiceStages(st, bundle.lists.Jobs || [], bundle.lists.ClientServiceStages || []);
  const apply = (rows: Row[] | undefined, gone: Row[], patches: { row: Row; patch: Row }[]) => rows && rows
    .filter((r) => !gone.includes(r))
    .map((r) => { const p = patches.find((x) => x.row === r); return p ? { ...r, ...p.patch } : r; });
  return {
    ...bundle,
    lists: {
      ...bundle.lists,
      StageTemplates: apply(st, t.removeStages, t.stagePatches),
      Jobs: apply(bundle.lists.Jobs, [], t.jobPatches),
      ClientServiceStages: apply(bundle.lists.ClientServiceStages, t.removeClientStages, t.clientStagePatches),
    },
  };
}
