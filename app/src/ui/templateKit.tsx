// Reading and applying dependency templates. Shared by the Dependencies screen and the step that runs when a recurring job is created.
import { useMemo } from "react";
import { newKey } from "../lib/planning";
import { Row } from "../lib/schema";
import { depEventRow, dependencyRow, readDependency } from "../lib/work/dependencies";
import { Env, plan, readJobLite, readTemplate, dependencyFor, taskAndDependency } from "../lib/work/templates";
import { useData, useIndex } from "./data";

/** What the templates need to read. Shared by this page and the automatic step when a job is created. */
export function useTemplateEnv() {
  const { data } = useData(); const idx = useIndex();
  return useMemo(() => {
    const jobs = (data.jobs as Row[]).map(readJobLite);
    const stages = (service: string) => (idx.stagesByService.get(service) || []).slice().sort((a, b) => Number(a.StageNo) - Number(b.StageNo)).map((x) => String(x.Title || ""));
    const env: Env = { jobs, deps: (data.dependencies as Row[]).map(readDependency), decisions: (data.templateDecisions as Row[]).map((r) => ({ templateKey: String(r.TemplateKey), dependentKey: String(r.DependentKey) })), stages };
    return { env, templates: (data.depTemplates as Row[]).map(readTemplate), open: jobs.filter((j) => !["Complete", "Done", "Cancelled"].includes(j.status)) };
  }, [data.jobs, data.dependencies, data.templateDecisions, data.depTemplates, idx]);
}

/** Create the dependencies (and information tasks) a plan calls for. Only what is certain; reviews are left for a person. */
export function useApplyTemplates() {
  const { create, user } = useData();
  return async (p: ReturnType<typeof plan>, env: Env) => {
    const c = () => ({ user: user || "", now: new Date().toISOString(), key: () => newKey("DP") });
    let made = 0; const skipped: string[] = [];
    const log = async (key: string, why: string) => create("DependencyEvents", depEventRow({ key: newKey("V"), dependencyKey: key, type: "create", at: new Date().toISOString(), by: user || "", before: "", after: "active", reason: why }));
    for (const o of p.links) { const d = dependencyFor(o, o.prerequisite, o.preStage, env, c()); if ("error" in d) { skipped.push(d.error); continue; } await create("Dependencies", dependencyRow(d)); await log(d.key, `From template: ${o.template.title}`); made++; }
    for (const o of p.tasks) { const r = taskAndDependency(o, { ...c(), taskKey: newKey("T") }); await create("Tasks", r.task); await create("Dependencies", dependencyRow(r.dependency)); await log(r.dependency.key, `From template: ${o.template.title}`); made++; }
    return { made, skipped };
  };
}


/** After a new job is created (the next period of a recurring job): create the dependencies the templates are certain about. Never blocks or fails the job; anything uncertain
 *  is left as a review on the Dependencies screen. */
export function useTemplatesForNewJob() {
  const { env, templates } = useTemplateEnv(); const apply = useApplyTemplates();
  return async (row: Row) => {
    try {
      const j = readJobLite(row); if (!templates.some((t) => t.enabled)) return;
      const e: Env = { ...env, jobs: env.jobs.some((x) => x.key === j.key) ? env.jobs : [...env.jobs, j] };
      await apply(plan(templates, [j], e), e);
    } catch { /* the job is already saved; the Dependencies screen will offer anything missed */ }
  };
}
