// The morning digest: for one person, what is overdue or due soon among their clients' work, and for managers and partners the
// AML positions that need attention. Built by the server each morning (api/digest) from the same lists the planner uses.
import { asStatus, position } from "../lib/amlAssessment";
import { storeFrom } from "../lib/amlPack";
import { screeningPolicy } from "../lib/amlPolicy";
import { screening } from "../lib/amlScreening";
import { isOpen } from "../lib/domain";
import { readOnboardingSettings } from "../lib/onboarding";
import { Row } from "../lib/schema";

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const same = (a: unknown, b: unknown) => str(a).trim().toLowerCase() === str(b).trim().toLowerCase() && str(a).trim() !== "";
const fmt = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export type DigestPerson = { name: string; role: string; email: string; everything?: boolean };
export type DigestData = { clients: Row[]; jobs: Row[]; assessments: Row[]; onboardings: Row[]; settings: Row[]; records: Row[] };
export type Digest = { to: string; name: string; subject: string; sections: { title: string; items: string[] }[]; count: number };

/** One person's digest. `everything` (no staff list set up) gives the whole practice. Managers and partners also get AML. */
export function digestFor(p: DigestPerson, d: DigestData, today: string): Digest {
  const active = d.clients.filter((c) => !c.CeasedOn);
  const mine = p.everything ? active : active.filter((c) => same(c.Manager, p.name) || same(c.Partner, p.name));
  const keys = new Set(mine.map((c) => str(c.Key)));
  const nameOf = (k: unknown) => str(d.clients.find((c) => c.Key === k)?.Title || k);
  const week = addDays(today, 7);
  const open = d.jobs.filter((j) => keys.has(str(j.ClientKey)) && isOpen(j as { Status?: string }) && str(j.Status) !== "On hold" && str(j.Deadline));
  const overdue = open.filter((j) => str(j.Deadline) < today).sort((a, b) => str(a.Deadline).localeCompare(str(b.Deadline)));
  const soon = open.filter((j) => str(j.Deadline) >= today && str(j.Deadline) <= week).sort((a, b) => str(a.Deadline).localeCompare(str(b.Deadline)));
  const sections: Digest["sections"] = [];
  const job = (j: Row) => `${nameOf(j.ClientKey)}: ${str(j.Title)} (deadline ${fmt(str(j.Deadline))})`;
  if (overdue.length) sections.push({ title: `Overdue work (${overdue.length})`, items: overdue.slice(0, 25).map(job).concat(overdue.length > 25 ? [`and ${overdue.length - 25} more`] : []) });
  if (soon.length) sections.push({ title: `Deadlines in the next 7 days (${soon.length})`, items: soon.slice(0, 25).map(job).concat(soon.length > 25 ? [`and ${soon.length - 25} more`] : []) });
  if (p.everything || p.role === "manager" || p.role === "partner") {
    const amlClients = p.everything || p.role === "partner" ? active : mine;
    const settings = readOnboardingSettings(d.settings);
    const sp = screeningPolicy(d.settings, { high: settings.amlMonths.high, medium: settings.amlMonths.medium, low: settings.amlMonths.low });
    const register = storeFrom(d.records, d.settings, "screening").records;
    const review: string[] = [], waiting: string[] = [], screen: string[] = [];
    for (const c of amlClients) {
      const pos = position(c, d.assessments, d.onboardings, today);
      if (pos.state === "overdue") review.push(`${str(c.Title)}: AML review overdue (${fmt(pos.reviewDate)})`);
      else if (pos.state === "soon") review.push(`${str(c.Title)}: AML review due ${fmt(pos.reviewDate)}`);
      else if (pos.state === "stopped") review.push(`${str(c.Title)}: due diligence not completed, no work to be done`);
      const open = d.assessments.find((r) => r.ClientKey === c.Key && asStatus(r.Status) === "inprogress");
      if (open) waiting.push(`${str(c.Title)}: assessment in progress since ${fmt(str(open.Created).slice(0, 10))}`);
      if (pos.current) { const s = screening(c, pos.risk, sp, d.assessments, register, today); if (s.days !== null && s.days < 0) screen.push(`${str(c.Title)}: sanctions and PEP re-screen overdue (${fmt(s.due)})`); else if (s.match) screen.push(`${str(c.Title)}: possible sanctions or PEP match to resolve`); }
    }
    if (review.length) sections.push({ title: `AML reviews (${review.length})`, items: review.slice(0, 25) });
    if (waiting.length) sections.push({ title: `AML assessments in progress (${waiting.length})`, items: waiting.slice(0, 25) });
    if (screen.length) sections.push({ title: `Sanctions and PEP screening (${screen.length})`, items: screen.slice(0, 25) });
  }
  // KPI alerts raised when each client's figures were last read from Xero (kept as settings by Reporting); ignored once over 45 days old
  const alerts: string[] = [];
  for (const c of mine) {
    const row = d.settings.find((r) => r.Key === `reporting.alerts.${str(c.Key)}`);
    let v: { at?: string; month?: string; lines?: string[] } | undefined;
    try { v = row?.Value ? JSON.parse(str(row.Value)) : undefined; } catch { v = undefined; }
    if (!v?.lines?.length || !v.at || v.at.slice(0, 10) < addDays(today, -45)) continue;
    for (const l of v.lines.slice(0, 5)) alerts.push(`${str(c.Title)}: ${l}`);
  }
  if (alerts.length) sections.push({ title: `Client KPI alerts (${alerts.length})`, items: alerts.slice(0, 25) });
  const count = sections.reduce((n, s) => n + s.items.length, 0);
  return { to: p.email, name: p.name, subject: count ? `Xproflow: ${count} thing${count === 1 ? "" : "s"} for today` : "Xproflow: nothing due today", sections, count };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** The email body, as plain text and simple HTML. */
export function digestText(g: Digest, link: string): { text: string; html: string } {
  const first = g.name.split(/\s+/)[0] || "there";
  const text = [`Good morning ${first},`, "", ...g.sections.flatMap((s) => [s.title, ...s.items.map((i) => `- ${i}`), ""]), `Open the planner: ${link}`].join("\n");
  const html = `<p>Good morning ${esc(first)},</p>${g.sections.map((s) => `<h3 style="margin:16px 0 4px;font-size:15px">${esc(s.title)}</h3><ul style="margin:0;padding-left:18px">${s.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`).join("")}<p style="margin-top:16px"><a href="${esc(link)}">Open the planner</a></p>`;
  return { text, html };
}
