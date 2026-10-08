// Loads the one-off Engager import bundle into SharePoint. Rows whose Key is already
// in a list are skipped, so running it twice never creates duplicates.
import { ListKey, Row } from "./schema";
import { SharePointStore } from "./sharepoint";

export type Bundle = { format: "practice-planner-import"; version: 1; created: string; lists: Partial<Record<ListKey, Row[]>> };

export const IMPORT_ORDER: ListKey[] = [
  "Services", "StageTemplates", "Clients", "Contacts", "Groups", "GroupMembers",
  "ClientServices", "ClientServiceStages", "Jobs", "JobHistory",
];

export type ImportStep = { list: ListKey; total: number; skipped: number; created: number; failed: number; error?: string };

export function parseBundle(text: string): Bundle {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't an import bundle (it isn't valid JSON).");
  }
  if (data?.format !== "practice-planner-import" || data?.version !== 1 || typeof data.lists !== "object") {
    throw new Error("That file isn't a Practice Planner import bundle.");
  }
  for (const [list, rows] of Object.entries(data.lists)) {
    if (!IMPORT_ORDER.includes(list as ListKey)) throw new Error(`The bundle has an unknown list: ${list}`);
    if (!Array.isArray(rows) || rows.some((r: any) => !r || typeof r.Key !== "string")) {
      throw new Error(`Every row in ${list} needs a Key.`);
    }
  }
  return data as Bundle;
}

export async function runImport(
  store: SharePointStore,
  bundle: Bundle,
  onStep: (step: ImportStep, progress?: number) => void,
): Promise<ImportStep[]> {
  const steps: ImportStep[] = [];
  for (const list of IMPORT_ORDER) {
    const rows = bundle.lists[list] || [];
    if (!rows.length) continue;
    const existing = new Set((await store.readAll(list)).map((r) => r.Key));
    const toCreate = rows.filter((r) => !existing.has(r.Key));
    const step: ImportStep = { list, total: rows.length, skipped: rows.length - toCreate.length, created: 0, failed: 0 };
    onStep(step, 0);
    if (toCreate.length) {
      const res = await store.createMany(list, toCreate, (done) => onStep(step, done / toCreate.length));
      step.failed = res.failed;
      step.error = res.error;
      step.created = toCreate.length - res.failed;
    }
    onStep(step, 1);
    steps.push(step);
  }
  return steps;
}
