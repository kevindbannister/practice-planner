// The report builder on the reporting centre: a report is a cover and sections, each a list of blocks (text, charts, tables, KPIs, cash flow).
// The blocks only say what to show; the figures come from the client's monthly figures for the report's period when it is drawn or published.
import { PeriodKind, addMonths } from "./reportData";

const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fullMonth = (ym: string) => `${FULL[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

export type Orientation = "portrait" | "landscape";
export type TextStyle = "heading" | "paragraph" | "observation" | "summary";
export type Block =
  | { id: string; type: "text"; style: TextStyle; title?: string; text: string }
  | { id: string; type: "columns"; left: string; right: string }
  | { id: string; type: "line" }
  | { id: string; type: "page" }
  | { id: string; type: "chart"; title: string; measures: string[]; months: 13 | 24 | 36; bars?: boolean }
  | { id: string; type: "table"; statement: "pl" | "bs"; compare: "none" | "prior" | "lastYear" | "months"; detail: "summary" | "detailed"; title: string }
  | { id: string; type: "kpis"; title: string }
  | { id: string; type: "cashflow"; title: string }
  | { id: string; type: "aged"; which: "rec" | "pay"; title: string };
export type Section = { id: string; title: string; blocks: Block[] };
export type ReportDoc = {
  id: string; name: string; kind: PeriodKind; /** the month the period ends in; empty = the latest month read */ anchor: string;
  orientation: Orientation; sections: Section[]; disclaimer: boolean; disclaimerText: string;
  status: "draft" | "published"; createdAt: string; updatedAt: string; publishedAt?: string; /** where the published copy is kept on OneDrive */ file?: string;
};

let seq = 0;
export const uid = (p = "b") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const DISCLAIMER = "This report has been prepared from the accounting records available to us at the date shown and has not been audited or reviewed. It is for the use of the business named above only.";

export function newReport(name: string, kind: PeriodKind, anchor: string, orientation: Orientation, now: string): ReportDoc {
  return { id: uid("r"), name: name.trim() || "Report", kind, anchor, orientation, sections: [{ id: uid("s"), title: "Introduction", blocks: [] }], disclaimer: false, disclaimerText: DISCLAIMER, status: "draft", createdAt: now, updatedAt: now };
}

/** The period in words: "October 2026", "Quarter to October 2026", "Year to October 2026". */
export function periodWords(kind: PeriodKind, anchor: string): string {
  if (!anchor) return "";
  return kind === "month" ? fullMonth(anchor) : `${kind === "quarter" ? "Quarter" : "Year"} to ${fullMonth(anchor)}`;
}

export const moveItem = <T,>(list: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const out = [...list]; const [x] = out.splice(from, 1); out.splice(to, 0, x); return out;
};

// ------------------------------------------------------------------ what can be added

export type Pick = { name: string; note: string; make: () => Block };
export const TEXT_BLOCKS: Pick[] = [
  { name: "Text", note: "Write your own commentary", make: () => ({ id: uid(), type: "text", style: "paragraph", text: "" }) },
  { name: "Heading", note: "A heading to introduce what follows", make: () => ({ id: uid(), type: "text", style: "heading", text: "" }) },
  { name: "Two columns of text", note: "Text beside text", make: () => ({ id: uid(), type: "columns", left: "", right: "" }) },
  { name: "Observation", note: "Call out one thing the numbers show", make: () => ({ id: uid(), type: "text", style: "observation", title: "Observation", text: "" }) },
  { name: "Executive summary", note: "The headlines, up front", make: () => ({ id: uid(), type: "text", style: "summary", title: "Executive summary", text: "" }) },
  { name: "Line break", note: "A thin line between parts", make: () => ({ id: uid(), type: "line" }) },
  { name: "Page break", note: "Start a new page when printed", make: () => ({ id: uid(), type: "page" }) },
];
const chart = (title: string, measures: string[], months: 13 | 24 | 36 = 13, bars = false): Block => ({ id: uid(), type: "chart", title, measures, months, bars });
export const CHART_BLOCKS: Pick[] = [
  { name: "Revenue", note: "Last 13 months", make: () => chart("Revenue", ["revenue"], 13, true) },
  { name: "Revenue, 24 months", note: "Two years, month by month", make: () => chart("Revenue", ["revenue"], 24) },
  { name: "Revenue and profit", note: "Revenue, gross and operating profit", make: () => chart("Revenue and profit", ["revenue", "gross", "operating"]) },
  { name: "Profit", note: "Gross, operating and net profit", make: () => chart("Profit", ["gross", "operating", "net"]) },
  { name: "Margins", note: "Gross, operating and net margin", make: () => chart("Margins", ["gpm", "opm", "npm"]) },
  { name: "Costs", note: "Cost of sales and expenses", make: () => chart("Costs", ["cos", "expenses"], 13, true) },
  { name: "Cash on hand", note: "Bank balances month by month", make: () => chart("Cash on hand", ["cash"], 13, true) },
  { name: "Debtors and creditors", note: "What is owed to and by the business", make: () => chart("Debtors and creditors", ["debtors", "creditors"]) },
  { name: "KPI results", note: "Every KPI against its target", make: () => ({ id: uid(), type: "kpis", title: "KPI results" }) },
  { name: "Cash flow", note: "Where the cash came from and went", make: () => ({ id: uid(), type: "cashflow", title: "Cash flow" }) },
];
const table = (title: string, statement: "pl" | "bs", compare: "none" | "prior" | "lastYear" | "months", detail: "summary" | "detailed" = "summary"): Block => ({ id: uid(), type: "table", title, statement, compare, detail });
export const TABLE_BLOCKS: Pick[] = [
  { name: "Profit & Loss", note: "The period on its own", make: () => table("Profit & Loss", "pl", "none") },
  { name: "Profit & Loss vs last period", note: "With the variance", make: () => table("Profit & Loss vs last period", "pl", "prior") },
  { name: "Profit & Loss vs last year", note: "The same period a year earlier", make: () => table("Profit & Loss vs last year", "pl", "lastYear") },
  { name: "Profit & Loss by month", note: "Every month of the year", make: () => table("Profit & Loss by month", "pl", "months") },
  { name: "Detailed Profit & Loss", note: "Every account", make: () => table("Detailed Profit & Loss", "pl", "prior", "detailed") },
  { name: "Balance Sheet", note: "At the end of the period", make: () => table("Balance Sheet", "bs", "none") },
  { name: "Balance Sheet vs last period", note: "With the movement", make: () => table("Balance Sheet vs last period", "bs", "prior") },
];

const aged = (which: "rec" | "pay"): Block => ({ id: uid(), type: "aged", which, title: which === "rec" ? "Aged Receivables" : "Aged Payables" });
TABLE_BLOCKS.push(
  { name: "Aged Receivables", note: "Who owes the business, by how late", make: () => aged("rec") },
  { name: "Aged Payables", note: "Who the business owes, by how late", make: () => aged("pay") },
);

export type Layout = { name: string; note: string; make: () => Block[] };
export const LAYOUTS: Layout[] = [
  { name: "Monthly summary", note: "Summary, profit and loss, revenue and margins", make: () => [
    { id: uid(), type: "text", style: "summary", title: "Executive summary", text: "" }, TABLE_BLOCKS[1].make(), CHART_BLOCKS[0].make(), CHART_BLOCKS[4].make()] },
  { name: "KPI summary", note: "KPI results with a comment", make: () => [CHART_BLOCKS[8].make(), { id: uid(), type: "text", style: "observation", title: "Observation", text: "" }] },
  { name: "Cash flow analysis", note: "Cash flow, cash on hand and the balance sheet", make: () => [CHART_BLOCKS[9].make(), CHART_BLOCKS[6].make(), TABLE_BLOCKS[6].make()] },
  { name: "Aged Accounts Receivable", note: "Ageing bar and table of customers", make: () => [aged("rec"), { id: uid(), type: "text", style: "observation", title: "Observation", text: "" }] },
  { name: "Aged Accounts Payable", note: "Ageing bar and table of suppliers", make: () => [aged("pay"), { id: uid(), type: "text", style: "observation", title: "Observation", text: "" }] },
  { name: "Revenue charts", note: "Revenue over 13 and 24 months and profit", make: () => [CHART_BLOCKS[0].make(), CHART_BLOCKS[1].make(), CHART_BLOCKS[3].make()] },
  { name: "Full month pack", note: "Everything above, in order", make: () => [
    { id: uid(), type: "text", style: "summary", title: "Executive summary", text: "" }, TABLE_BLOCKS[1].make(), CHART_BLOCKS[2].make(), CHART_BLOCKS[8].make(), { id: uid(), type: "page" }, CHART_BLOCKS[9].make(), TABLE_BLOCKS[6].make(), { id: uid(), type: "page" }, TABLE_BLOCKS[3].make()] },
];

/** A copy to work on from a published report: new ids, back to a draft. */
export function copyReport(r: ReportDoc, now: string): ReportDoc {
  return { ...JSON.parse(JSON.stringify(r)), id: uid("r"), name: `${r.name} (copy)`, status: "draft", createdAt: now, updatedAt: now, publishedAt: undefined, file: undefined };
}

/** The latest month figures exist for, unless the report names one. */
export const anchorFor = (r: Pick<ReportDoc, "anchor">, months: string[]) => (r.anchor && months.includes(r.anchor) ? r.anchor : months[months.length - 1] || "");
export const shiftAnchor = (m: string, n: number) => addMonths(m, n);
