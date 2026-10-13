// Subtasks on a task: a checklist kept on the task as JSON.
import { newKey } from "./planning";

export type Subtask = { id: string; text: string; done: boolean };

export function readSubtasks(v: unknown): Subtask[] {
  if (typeof v !== "string" || !v.trim()) return [];
  try {
    const list = JSON.parse(v);
    return Array.isArray(list)
      ? list.filter((s) => s && typeof s.text === "string").map((s) => ({ id: String(s.id || newKey("S")), text: s.text, done: !!s.done }))
      : [];
  } catch {
    return [];
  }
}

export const writeSubtasks = (list: Subtask[]) => JSON.stringify(list.filter((s) => s.text.trim()).map(({ id, text, done }) => ({ id, text: text.trim(), done })));

export function progress(list: Subtask[]): { done: number; total: number } {
  const real = list.filter((s) => s.text.trim());
  return { done: real.filter((s) => s.done).length, total: real.length };
}
