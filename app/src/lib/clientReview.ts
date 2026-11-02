// The client review: the draft accounts talked through with the client, one topic at a time. Everything here is worked out
// from the same figures as the accounts; the wording is a draft for the accountant to change before the meeting.
import { AccountsFigures } from "./tbMap";
import { DetailGroup } from "./accounts";

const r0 = (n: number) => Math.round(n);
export const gbp = (n: number) => `${n < 0 ? "-" : ""}£${Math.abs(r0(n)).toLocaleString("en-GB")}`;
export const pct = (now: number, before: number | undefined) => (before === undefined || !before ? undefined : Math.round(((now - before) / Math.abs(before)) * 100));

export type Fig = { label: string; now: number; prior?: number; change?: number; pct?: number };
const fig = (label: string, now: number, prior?: number): Fig => ({ label, now, prior, change: prior === undefined ? undefined : r0(now - prior), pct: pct(now, prior) });

export const headline = (f: AccountsFigures, p?: AccountsFigures): Fig[] => [
  fig("Turnover", f.turnover, p?.turnover), fig("Gross profit", f.grossProfit, p?.grossProfit), fig("Profit before tax", f.pbt, p?.pbt),
  fig("Profit after tax", f.pat, p?.pat), fig("Cash at bank", f.bank, p?.bank), fig("Net assets", f.netAssets, p?.netAssets),
];

/** From last year's profit before tax to this year's: what each part added or took away. */
export type Step = { label: string; amount: number };
export function bridge(f: AccountsFigures, p: AccountsFigures | undefined, g?: DetailGroup[], pg?: DetailGroup[]): { start: number; steps: Step[]; end: number } | undefined {
  if (!p) return undefined;
  const steps: Step[] = [
    { label: "Turnover", amount: r0(f.turnover - p.turnover) },
    { label: "Cost of sales", amount: -r0(f.costOfSales - p.costOfSales) },
    { label: "Other income", amount: r0(f.otherIncome - p.otherIncome) },
  ];
  const titles = [...new Set([...(g || []).map((x) => x.title), ...(pg || []).map((x) => x.title)])];
  const have = (g || []).reduce((a, x) => a + x.total, 0), had = (pg || []).reduce((a, x) => a + x.total, 0);
  if (titles.length && Math.abs(have - f.expenses) < 1 && Math.abs(had - p.expenses) < 1) {
    for (const t of titles) steps.push({ label: t, amount: -r0((g?.find((x) => x.title === t)?.total || 0) - (pg?.find((x) => x.title === t)?.total || 0)) });
  } else steps.push({ label: "Expenses", amount: -r0(f.expenses - p.expenses) });
  const out = steps.filter((s) => s.amount);
  const start = r0(p.pbt), end = r0(f.pbt);
  const gap = end - start - out.reduce((a, s) => a + s.amount, 0);
  if (gap) out.push({ label: "Rounding", amount: gap });
  return { start, steps: out, end };
}

/** Where the money went: the expense groups, biggest first, with last year beside them. */
export function spend(f: AccountsFigures, g: DetailGroup[], costs: DetailGroup[], pg?: DetailGroup[], pcosts?: DetailGroup[]): { title: string; now: number; prior?: number; share: number }[] {
  const rows = [
    ...(costs.length ? [{ title: "Cost of sales", now: costs.reduce((a, x) => a + x.total, 0), prior: pcosts ? pcosts.reduce((a, x) => a + x.total, 0) : undefined }] : []),
    ...g.map((x) => ({ title: x.title, now: x.total, prior: pg ? pg.find((y) => y.title === x.title)?.total ?? 0 : undefined })),
  ].filter((x) => x.now || x.prior);
  const total = rows.reduce((a, x) => a + Math.max(0, x.now), 0) || f.expenses + f.costOfSales || 1;
  return rows.sort((a, b) => b.now - a.now).map((x) => ({ ...x, share: Math.round((Math.max(0, x.now) / total) * 100) }));
}

export function balanceItems(f: AccountsFigures, p?: AccountsFigures): { owns: Fig[]; owes: Fig[] } {
  return {
    owns: [fig("Fixed assets", f.fixed, p?.fixed), fig("Stock", f.stock, p?.stock), fig("Debtors (owed to the company)", f.debtors, p?.debtors), fig("Cash at bank", f.bank, p?.bank)].filter((x) => x.now || x.prior),
    owes: [fig("Creditors due within a year", f.creditorsWithin, p?.creditorsWithin), fig("Creditors due after a year", f.creditorsAfter, p?.creditorsAfter), fig("Provisions", f.provisions, p?.provisions)].filter((x) => x.now || x.prior),
  };
}

// ------------------------------------------------------------------ dates

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Corporation tax is due nine months and one day after the year end; Companies House accounts nine months after; the tax return twelve months after. */
export function dueDates(end: string) {
  const d = new Date(`${end}T00:00:00Z`);
  const plus = (m: number, days = 0) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m + 1, 0)); const last = x.getUTCDate(); const day = Math.min(d.getUTCDate(), last); const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, day)); r.setUTCDate(r.getUTCDate() + days); return iso(r); };
  return { tax: plus(9, 1), accounts: plus(9), ct600: plus(12) };
}
export const dateWords = (s: string) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");

// ------------------------------------------------------------------ drafted wording

export type StepKey = "headline" | "movement" | "spend" | "position" | "tax" | "questions" | "next";
export const STEPS: { key: StepKey; title: string; short: string }[] = [
  { key: "headline", title: "The headline", short: "Headline" }, { key: "movement", title: "How profit moved", short: "Profit moved" },
  { key: "spend", title: "Where the money went", short: "Spending" }, { key: "position", title: "What the company owns and owes", short: "Owns & owes" },
  { key: "tax", title: "Tax and dividends", short: "Tax" }, { key: "questions", title: "Questions and decisions", short: "Questions" }, { key: "next", title: "Next steps", short: "Next steps" },
];

const upDown = (n: number, up: string, down: string) => (n >= 0 ? up : down);
const moved = (now: number, prior: number | undefined, noun: string) => {
  if (prior === undefined) return "";
  const c = r0(now - prior), p = pct(now, prior);
  if (!c) return `${noun} is unchanged at ${gbp(now)}.`;
  return `${noun} ${upDown(c, "rose", "fell")} ${gbp(Math.abs(c))}${p !== undefined ? ` (${Math.abs(p)}%)` : ""} to ${gbp(now)}.`;
};

export function draft(key: StepKey, f: AccountsFigures, p: AccountsFigures | undefined, g?: DetailGroup[], pg?: DetailGroup[], costs?: DetailGroup[], pcosts?: DetailGroup[], end?: string): string {
  if (key === "headline") {
    const bits = [moved(f.turnover, p?.turnover, "Turnover"), f.pbt >= 0 ? `The company made a profit before tax of ${gbp(f.pbt)}${p ? `, compared with ${gbp(p.pbt)} last year` : ""}.` : `The company made a loss before tax of ${gbp(Math.abs(f.pbt))}${p ? `, compared with a result of ${gbp(p.pbt)} last year` : ""}.`,
      f.bank ? `There was ${gbp(f.bank)} in the bank at the year end${p ? `, ${r0(f.bank - p.bank) >= 0 ? "up" : "down"} ${gbp(Math.abs(f.bank - p.bank))} on last year` : ""}.` : ""];
    return bits.filter(Boolean).join(" ");
  }
  if (key === "movement") {
    const b = bridge(f, p, g, pg);
    if (!b) return "This is the first year we have figures for, so there is nothing to compare with yet.";
    const top = [...b.steps].sort((a, c) => Math.abs(c.amount) - Math.abs(a.amount)).slice(0, 2);
    const delta = b.end - b.start;
    return `Profit before tax ${delta >= 0 ? "increased" : "decreased"} by ${gbp(Math.abs(delta))}.${top.length ? ` The biggest ${top.length > 1 ? "movements were" : "movement was"} ${top.map((s) => `${s.label.toLowerCase()} (${s.amount >= 0 ? "+" : "-"}${gbp(Math.abs(s.amount))})`).join(" and ")}.` : ""}`;
  }
  if (key === "spend") {
    const rows = spend(f, g || [], costs || [], pg, pcosts);
    if (!rows.length) return "Add the trial balance and the spending breakdown appears here.";
    const [a, b] = rows;
    return `The largest cost was ${a.title.toLowerCase()} at ${gbp(a.now)} (${a.share}% of all costs)${b ? `, followed by ${b.title.toLowerCase()} at ${gbp(b.now)}` : ""}.`;
  }
  if (key === "position") {
    return `After everything the company owes is taken off, it is worth ${gbp(f.netAssets)} on paper${p ? `, ${r0(f.netAssets - p.netAssets) >= 0 ? "up" : "down"} ${gbp(Math.abs(f.netAssets - p.netAssets))} on last year` : ""}. ${f.debtors ? `Customers owed the company ${gbp(f.debtors)} at the year end. ` : ""}${f.creditorsWithin ? `It owed ${gbp(f.creditorsWithin)} to suppliers, HMRC and others that falls due within a year.` : ""}`.trim();
  }
  if (key === "tax") {
    const d = end ? dueDates(end) : undefined;
    return `The tax charge for the year is ${gbp(f.tax)}${d && f.tax ? `, payable by ${dateWords(d.tax)}` : ""}. That leaves ${gbp(f.pat)} of profit after tax${f.dividends ? `, of which ${gbp(f.dividends)} was paid out as dividends` : ""}, so ${gbp(f.retained)} stays in the company.`;
  }
  if (key === "questions") return "These are the points we need you to confirm before the accounts are finalised.";
  return "Once you are happy with the figures, the accounts are approved and signed, filed with Companies House, and the tax is paid.";
}

export const NEXT_STEPS = (end?: string): { key: string; text: string }[] => {
  const d = end ? dueDates(end) : undefined;
  return [
    { key: "approve", text: "Client confirms the answers above and approves the figures" },
    { key: "sign", text: "Director signs the balance sheet" },
    { key: "ch", text: `File the accounts with Companies House${d ? ` by ${dateWords(d.accounts)}` : ""}` },
    { key: "ct600", text: `File the company tax return${d ? ` by ${dateWords(d.ct600)}` : ""}` },
    { key: "pay", text: `Pay the corporation tax${d ? ` by ${dateWords(d.tax)}` : ""}` },
  ];
};

export type ReviewState = { notes: Record<string, string>; meeting: string; date: string; next: Record<string, boolean>; client: boolean };
export function readReview(s: Record<string, unknown>): ReviewState {
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const notes: Record<string, string> = {}, next: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(obj(s.notes))) if (typeof v === "string") notes[k] = v;
  for (const [k, v] of Object.entries(obj(s.next))) next[k] = v === true;
  return { notes, next, meeting: typeof s.meeting === "string" ? s.meeting : "", date: typeof s.date === "string" ? s.date : "", client: s.client === true };
}
