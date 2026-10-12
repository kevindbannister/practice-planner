// Meetings and calls with clients: a template gives the agenda; notes go under each agenda
// item; afterwards a summary, decisions and actions (yours can go straight into the plan).
import { fmtDate } from "./domain";

export type MeetingKind = "meeting" | "video" | "call";
export type AgendaItem = { item: string; notes: string };
export type Action = { text: string; who: string; due: string; taskKey?: string; done?: boolean };

export const KIND_NAMES: Record<MeetingKind, string> = { meeting: "In person", video: "Video call", call: "Phone call" };

export type Template = { key: string; name: string; kind: MeetingKind; minutes: number; agenda: string[] };

export const TEMPLATES: Template[] = [
  {
    key: "year-end", name: "Year-end accounts review", kind: "meeting", minutes: 60,
    agenda: [
      "Results for the year (turnover and profit against last year)",
      "Balance sheet and cash",
      "Director's loan account",
      "Corporation tax: how much and when it's due",
      "Salary and dividends for the year ahead",
      "Questions, and approving the accounts",
      "Next steps",
    ],
  },
  {
    key: "tax-planning", name: "Tax planning", kind: "video", minutes: 45,
    agenda: [
      "Income so far this tax year and what's expected",
      "Salary, dividends and drawings",
      "Pension contributions",
      "Allowances: ISA, capital gains, marriage allowance, gift aid",
      "Payments on account: due dates, and whether to reduce them",
      "Actions",
    ],
  },
  {
    key: "sa-review", name: "Self Assessment review", kind: "call", minutes: 30,
    agenda: [
      "Income sources this year",
      "Tax due and when (balancing payment and payments on account)",
      "Anything new next year",
      "Records for next year",
      "Actions",
    ],
  },
  {
    key: "onboarding", name: "New client meeting", kind: "meeting", minutes: 60,
    agenda: [
      "About them and the business",
      "Services they need",
      "Records, software and bank feeds",
      "Key dates and deadlines",
      "Fees and the engagement letter",
      "ID and AML checks",
      "HMRC and Companies House authorisation",
      "Next steps",
    ],
  },
  {
    key: "advisory", name: "Advisory catch-up", kind: "video", minutes: 60,
    agenda: [
      "Recent performance",
      "Cash flow and the months ahead",
      "Goals and progress since last time",
      "Problems or decisions coming up",
      "Actions",
    ],
  },
  { key: "call", name: "Quick call", kind: "call", minutes: 15, agenda: ["Why they called", "What was agreed"] },
  { key: "blank", name: "Blank", kind: "meeting", minutes: 30, agenda: [] },
];

export const templateFor = (key?: string) => TEMPLATES.find((t) => t.key === key) || TEMPLATES[TEMPLATES.length - 1];

export function readJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string" || !v.trim()) return fallback;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(fallback) && !Array.isArray(parsed) ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

/** "Mon 12 Oct 2026, 14:30" from a "2026-10-12T14:30" value. */
export function fmtWhen(when?: string): string {
  if (!when) return "";
  const day = fmtDate(when.slice(0, 10), { weekday: true });
  const time = when.slice(11, 16);
  return time ? `${day}, ${time}` : day;
}

/** Plain-text email of the meeting notes for the client: summary, decisions, then who's doing what. */
export function summaryEmail(o: {
  greeting: string; title: string; when: string; summary: string; decisions: string[]; actions: Action[]; sender: string;
}): { subject: string; body: string } {
  const date = o.when ? fmtDate(o.when.slice(0, 10)) : "";
  const parts: string[] = [o.greeting, `Thank you for your time${date ? ` on ${date}` : ""}. Here's a summary of what we discussed.`];
  if (o.summary.trim()) parts.push(o.summary.trim());
  const decisions = o.decisions.filter((d) => d.trim());
  if (decisions.length) parts.push(`**What we agreed**\n${decisions.map((d) => `- ${d}`).join("\n")}`);
  const yours = o.actions.filter((a) => a.text.trim() && /client|you/i.test(a.who));
  const mine = o.actions.filter((a) => a.text.trim() && !/client|you/i.test(a.who));
  const line = (a: Action) => `- ${a.text}${a.due ? ` (by ${fmtDate(a.due)})` : ""}`;
  if (yours.length) parts.push(`**What we need from you**\n${yours.map(line).join("\n")}`);
  if (mine.length) parts.push(`**What I'll do next**\n${mine.map(line).join("\n")}`);
  parts.push("If I've missed anything, just let me know.");
  parts.push(`Kind regards,\n${o.sender}`);
  return { subject: `Notes from our ${o.title.toLowerCase().startsWith("quick") ? "call" : "meeting"}${date ? ` on ${date}` : ""}`, body: parts.join("\n\n") };
}
