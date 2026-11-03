// Reading a past return with the AI, then checking what it gave. The AI only reads: every figure it returns has to be printed
// in the PDFs' text (anything else is left out), and the planner's own tax calculation has to agree with the income tax the
// document itself prints. Nothing is sent to HMRC from here: the PDFs are kept as copies for the client's history.

import { compute, emptyReturn, newId, TaxReturn } from "./tax";
import { ImportFile, ImportResult, readImport } from "./taxImport";
import { yearLabel } from "./taxRates";
import type { TaxReadAnswer } from "./ai";

const gbp = (v: number) => `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Every number printed in the files' text, as the planner reads it (commas, pound signs and brackets taken out). */
export function printedNumbers(files: ImportFile[]): Set<number> {
  const out = new Set<number>();
  for (const f of files) for (const page of f.pages) for (const line of page) {
    for (const m of line.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const v = Number(m[0].replace(/,/g, ""));
      if (Number.isFinite(v)) out.add(round2(v));
    }
  }
  return out;
}

const TOP = ["front", "employments", "selfEmployments", "partnerships", "nic", "interest", "dividends", "otherDividends", "property", "pensions", "benefits", "otherIncome", "foreign", "gains", "gainsLossesBf", "reliefs", "allowances", "studentLoan", "childBenefit", "winterFuel", "charityGifts", "payments"];
const ENUMS: Record<string, string[]> = {
  region: ["england", "scotland", "wales"], kind: ["residential", "shares", "other", "crypto"], marriage: ["none", "transfer", "receive"],
  box: ["11", "12", "13", "14", "15", "16", "17", "18", "19"],
};
const PLANS = ["plan1", "plan2", "plan4", "plan5"];
const DATE_KEYS = new Set(["dob", "start", "end", "date"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The AI's return, kept to the planner's fields. A number that isn't printed in the PDFs is dropped and its path reported.
 * Texts must fit their field (a date, or one of the listed options); lists keep only the entries that are well formed.
 */
export function sanitiseRead(raw: Record<string, unknown>, printed: Set<number>): { ret: TaxReturn; dropped: string[] } {
  const dropped: string[] = [];
  const walk = (v: unknown, key: string, path: string): unknown => {
    if (typeof v === "number") {
      if (v === 0 || printed.has(round2(Math.abs(v)))) return v;
      dropped.push(path);
      return undefined;
    }
    if (typeof v === "string") {
      const t = v.trim();
      if (!t) return undefined;
      if (ENUMS[key] && !ENUMS[key].includes(t)) return undefined;
      if (DATE_KEYS.has(key) && !DATE_RE.test(t)) return undefined;
      return t;
    }
    if (typeof v === "boolean") return v;
    if (Array.isArray(v)) {
      if (key === "plans") return v.filter((p) => typeof p === "string" && PLANS.includes(p));
      return v.map((x, i) => walk(x, key, `${path}[${i + 1}]`)).filter((x) => x !== undefined && !(typeof x === "object" && x !== null && !Object.keys(x).length));
    }
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const c = walk(x, k, `${path}.${k}`);
        if (c !== undefined) out[k] = c;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return undefined;
  };
  const base = emptyReturn() as unknown as Record<string, unknown>;
  for (const k of TOP) {
    const c = walk(raw[k], k, k);
    if (c === undefined) continue;
    const old = base[k];
    base[k] = old && typeof old === "object" && !Array.isArray(old) && c && typeof c === "object" && !Array.isArray(c) ? { ...(old as object), ...(c as object) } : c;
  }
  // the fields each entry needs, and an id for each entry
  const withIds = (list: unknown, defaults: Record<string, unknown>) =>
    Array.isArray(list) ? list.map((x) => ({ ...defaults, ...(x as object), id: (x as { id?: string }).id || newId() })) : undefined;
  const r = base as Record<string, any>;
  if (r.employments) r.employments = withIds(r.employments, { name: "", paye: "", pay: 0, tax: 0, benefits: {}, expenses: {} });
  if (r.selfEmployments) r.selfEmployments = withIds(r.selfEmployments, { name: "", turnover: 0, expenses: 0 })?.map((s: any) => ({
    ...s, expenseItems: Array.isArray(s.expenseItems) ? s.expenseItems.map((x: any) => ({ label: "Expense", amount: 0, ...x, id: x.id || newId() })) : s.expenseItems,
  }));
  if (r.partnerships) r.partnerships = withIds(r.partnerships, { name: "", profit: 0 });
  if (r.interest) r.interest = withIds(r.interest, { payer: "", untaxed: 0 });
  if (r.dividends) r.dividends = withIds(r.dividends, { company: "", amount: 0 });
  if (r.gains) r.gains = withIds(r.gains, { description: "", kind: "other", proceeds: 0, cost: 0 });
  if (r.pensions?.others) r.pensions.others = withIds(r.pensions.others, { payer: "", amount: 0, tax: 0 });
  if (r.payments?.credits) r.payments.credits = (r.payments.credits as any[]).map((c) => ({ description: "", amount: 0, ...c, key: c.key || `ai:${c.date || ""}:${c.amount}` }));
  return { ret: base as unknown as TaxReturn, dropped };
}

/** The lines the review shows for what was read (the same kind of lines the local reader shows). */
function foundLines(ret: TaxReturn): string[] {
  const out: string[] = [];
  for (const e of ret.employments) out.push(`Employment: ${e.name || "(no name)"}, pay ${gbp(e.pay)}, tax ${gbp(e.tax)}`);
  for (const s of ret.selfEmployments) out.push(`Self-employment: ${s.name || "(no name)"}, turnover ${gbp(s.turnover)}, expenses ${gbp(s.expenses)}${s.expenseItems?.length ? ` (${s.expenseItems.length} lines)` : ""}`);
  for (const i of ret.interest) out.push(`Interest: ${i.payer}${i.accountNumber ? ` (account ${i.accountNumber})` : ""} ${gbp(i.untaxed)}${i.foreign ? " (foreign)" : ""}`);
  for (const d of ret.dividends) out.push(`Dividends: ${d.company} ${gbp(d.amount)}`);
  for (const p of ret.pensions?.others || []) out.push(`Pension: ${p.payer}, gross ${gbp(p.amount)}, tax ${gbp(p.tax)}${p.net !== undefined ? `, net ${gbp(p.net)}` : ""}`);
  for (const g of ret.gains) out.push(`Capital gain: ${g.description || "disposal"}, proceeds ${gbp(g.proceeds)}, costs ${gbp(g.cost)}`);
  return out;
}

/** How many values (numbers, texts, true or false) a piece of the AI's answer holds. */
function countLeaves(v: unknown): number {
  if (Array.isArray(v)) return v.reduce<number>((a, x) => a + countLeaves(x), 0);
  if (v && typeof v === "object") return Object.values(v).reduce<number>((a, x) => a + countLeaves(x), 0);
  return v === undefined || v === null || v === "" ? 0 : 1;
}

/** The planner's reading of the PDFs with the AI's figures in place of the local reader's, and the checks on them. */
export function readWithAi(files: ImportFile[], answer: TaxReadAnswer, names: string[] = []): ImportResult {
  const local = readImport(files, names);
  const { ret, dropped } = sanitiseRead(answer.ret as Record<string, unknown>, printedNumbers(files));
  const warnings: string[] = [];
  const given = countLeaves(answer.ret), kept = countLeaves(ret);
  if (given === 0) warnings.push("The AI gave no figures for this return. Try Read with AI again.");
  else if (kept === 0) warnings.push(`The AI gave ${given} figures, but none of them could be matched to the PDFs' text. Open 'What the AI returned' to see them.`);
  if (dropped.length) {
    const shown = dropped.slice(0, 6).join(", ");
    warnings.push(`${dropped.length} figure${dropped.length === 1 ? " the AI gave isn't" : "s the AI gave aren't"} printed in the PDFs, so ${dropped.length === 1 ? "it was" : "they were"} left out: ${shown}${dropped.length > 6 ? " and more" : ""}.`);
  }
  const found = foundLines(ret);
  const docTax = answer.totals.incomeTaxDue;
  if (!local.year) warnings.push("The tax year couldn't be found in the files, so the figures can't be checked.");
  else if (docTax === undefined) warnings.push("The income tax figure printed in the document wasn't found, so the figures can't be checked against it.");
  else {
    const ours = compute(ret, local.year).incomeTax;
    if (Math.abs(ours - docTax) > 0.005) warnings.push(`The document prints income tax of ${gbp(docTax)}, but these figures give ${gbp(ours)}. Check the figures before bringing it in.`);
    else found.unshift(`Income tax agrees with the document: ${gbp(docTax)}`);
  }
  const aiRaw = JSON.stringify({ return: answer.ret, totals: answer.totals }, null, 1).slice(0, 8000);
  return { ...local, ret, found, aiRaw, warnings: [...warnings, ...local.warnings] };
}

const HISTORY_FOLDER = "Practice Planner Tax History";

/**
 * Keeps copies of the return's PDFs in OneDrive as history, one per file, named for the client and the year. They are copies
 * only: nothing here sends anything to HMRC, and a later amendment is kept as a new file beside these.
 */
export async function keepTaxHistory(
  graph: { post: (path: string, body: unknown) => Promise<unknown>; put: (path: string, body: Uint8Array, type: string) => Promise<any> },
  client: string, year: number, files: { name: string; bytes: Uint8Array }[],
): Promise<string[]> {
  try {
    await graph.post("/me/drive/root/children", { name: HISTORY_FOLDER, folder: {}, "@microsoft.graph.conflictBehavior": "fail" });
  } catch {
    /* already there */
  }
  const safe = (s: string) => s.replace(/[\\/:*?"<>|#%]/g, " ").replace(/\s+/g, " ").trim();
  const links: string[] = [];
  for (const f of files) {
    const name = `${safe(client)} ${yearLabel(year)} ${safe(f.name)}`;
    const item = await graph.put(`/me/drive/root:/${encodeURIComponent(HISTORY_FOLDER)}/${encodeURIComponent(name)}:/content`, f.bytes, "application/pdf");
    if (item?.webUrl) links.push(item.webUrl);
  }
  return links;
}
