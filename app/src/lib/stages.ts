// Re-ordering a type of work's stages, and keeping jobs and per-client stage details pointing
// at the same stage when its number changes.
import { Row } from "./schema";

/** Move the item at `from` to position `to` (both 0-based). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  const [it] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, it);
  return out;
}

export type Renumber = {
  templates: { row: Row; patch: Row }[];
  jobs: { row: Row; patch: Row }[];
  clientStages: { row: Row; patch: Row }[];
};

/**
 * The changes needed after re-ordering: each stage template gets its new number, each open job
 * stays on the same stage (so its number follows the stage), and each client's stage details
 * (who does it, budget) move with their stage.
 */
export function renumberStages(ordered: Row[], jobs: Row[], clientStages: Row[]): Renumber {
  const newNo = new Map<number, number>(); // old number -> new number
  ordered.forEach((st, i) => newNo.set(Number(st.StageNo), i + 1));
  const out: Renumber = { templates: [], jobs: [], clientStages: [] };
  ordered.forEach((st, i) => {
    if (Number(st.StageNo) !== i + 1) out.templates.push({ row: st, patch: { StageNo: i + 1 } });
  });
  for (const j of jobs) {
    const old = Number(j.StageNo || 1);
    const n = newNo.get(old);
    if (n && n !== old) out.jobs.push({ row: j, patch: { StageNo: n, StageName: String(ordered[n - 1].Title || "") } });
  }
  for (const cs of clientStages) {
    const old = Number(cs.StageNo);
    const n = newNo.get(old);
    if (n && n !== old) out.clientStages.push({ row: cs, patch: { StageNo: n } });
  }
  return out;
}
