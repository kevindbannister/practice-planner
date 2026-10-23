// Business projects: work on the practice itself (marketing, systems, recruiting) rather than
// for a client. A project has an outcome, a target date and tasks; its tasks are planned onto
// business days like any other task, but count against the day's business hours, never against
// the hours for client work. A project that stops moving is flagged so it doesn't quietly die.
import { Task, daysBetween, fmtDate, isOpen } from "./domain";
import { Row } from "./schema";

export type Category = { key: string; name: string; colour: string };

export const CATEGORIES: Category[] = [
  { key: "marketing", name: "Marketing", colour: "#b3499f" },
  { key: "systems", name: "Systems and software", colour: "#4a55b5" },
  { key: "people", name: "People and training", colour: "#14919b" },
  { key: "finance", name: "Finance and admin", colour: "#c0643e" },
  { key: "strategy", name: "Strategy and planning", colour: "#2e9d6f" },
  { key: "other", name: "Other", colour: "#8d9bb0" },
];

export const categoryOf = (p: Record<string, unknown>): Category =>
  CATEGORIES.find((c) => c.key === p.Category) || CATEGORIES[CATEGORIES.length - 1];

export const PROJECT_STATUSES = ["Active", "On hold", "Done"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const statusOf = (p: Record<string, unknown>): ProjectStatus => (p.Status === "On hold" || p.Status === "Done" ? p.Status : "Active");

/** A project is stalled when it hasn't moved for this many days. */
export const STALL_DAYS = 14;

/** A task that belongs to a business project rather than a client. */
export const isBusinessTask = (t: Record<string, unknown>): boolean => !!t.ProjectKey;

export const tasksOf = (project: { Key?: unknown }, tasks: Task[]): Task[] => tasks.filter((t) => t.ProjectKey === project.Key);

export type Progress = { done: number; open: number; total: number };

/** Finished and open tasks (cancelled ones don't count either way). */
export function progressOf(project: { Key?: unknown }, tasks: Task[]): Progress {
  const mine = tasksOf(project, tasks).filter((t) => t.Status !== "Cancelled");
  const open = mine.filter(isOpen).length;
  return { done: mine.length - open, open, total: mine.length };
}

/** The next thing to do: the soonest planned open task, else the first unplanned one. */
export function nextAction(project: { Key?: unknown }, tasks: Task[]): Task | undefined {
  const open = tasksOf(project, tasks).filter((t) => isOpen(t) && t.Status !== "On hold");
  const planned = open.filter((t) => t.PlannedDate).sort((a, b) => String(a.PlannedDate).localeCompare(String(b.PlannedDate)));
  return planned[0] || open[0];
}

/** The last day anything happened: it was edited, or a task of it was finished. */
export function lastMoved(project: Row, tasks: Task[]): string {
  let last = String(project.Touched || "");
  for (const t of tasksOf(project, tasks)) {
    const d = String(t.CompletedDate || "");
    if (d > last) last = d;
  }
  return last;
}

export type Attention = { level: "red" | "amber"; text: string };

/** Why an active project needs a look, or null if it's moving. The most serious reason wins. */
export function projectAttention(project: Row, tasks: Task[], today: string): Attention | null {
  if (statusOf(project) !== "Active") return null;
  const target = String(project.TargetDate || "");
  if (target && target < today) return { level: "red", text: `Past its target date (${fmtDate(target, { year: false })})` };
  const mine = tasksOf(project, tasks).filter(isOpen);
  if (!mine.length) return { level: "amber", text: "No next step: add a task" };
  const moved = lastMoved(project, tasks);
  const idle = moved ? daysBetween(moved, today) : 0;
  if (moved && idle >= STALL_DAYS) return { level: "amber", text: `Not touched for ${idle} days` };
  const planned = mine.some((t) => t.PlannedDate && String(t.PlannedDate) >= today);
  if (!planned && target && daysBetween(today, target) <= 30) return { level: "amber", text: "Due soon, and nothing is planned" };
  return null;
}

/** Active projects first (by target date), then on hold, then done. */
export function sortProjects(projects: Row[]): Row[] {
  const rank = (p: Row) => ({ Active: 0, "On hold": 1, Done: 2 }[statusOf(p)]);
  return [...projects].sort((a, b) => rank(a) - rank(b) || String(a.TargetDate || "9999").localeCompare(String(b.TargetDate || "9999")) || String(a.Title).localeCompare(String(b.Title)));
}
