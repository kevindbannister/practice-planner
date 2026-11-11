// Works out deadline risk for every open job from what is loaded. Read-only: it never changes a date.
import { useMemo } from "react";
import { dayHours } from "../lib/dayTypes";
import { jobHours } from "../lib/planning";
import { progress } from "../lib/jobProgress";
import { Row } from "../lib/schema";
import { assess, splitHours } from "../lib/work/readiness";
import { Facts, Risk, RiskConfig, impacts, readRiskConfig, risk, riskItems } from "../lib/work/risk";
import { todayIso } from "../lib/domain";
import { useData } from "./data";
import { useWorld } from "./DependencyPanel";

export function useRisk() {
  const { data, settings } = useData(); const world = useWorld();
  const today = todayIso();
  const cfg: RiskConfig = useMemo(() => readRiskConfig(data.settings), [data.settings]);
  return useMemo(() => {
    const hoursOn = (d: string) => dayHours(d, settings).total;
    const facts = new Map<string, Facts>(), risks = new Map<string, Risk>();
    for (const j of data.jobs as Row[]) {
      if (["Complete", "Done", "Cancelled"].includes(String(j.Status || ""))) continue;
      const key = String(j.Key), a = assess("job", key, world);
      const p = progress(j, { estimate: jobHours(j as never, data.services), actual: Number(j.ActualHours) || 0, plannedAhead: 0 });
      let actionable = p.actionable;
      if (a.readiness === "blocked") actionable = 0;
      else if (a.held.length) {
        const budgets = new Map((data.stageTemplates as Row[]).filter((s) => s.ServiceKey === j.ServiceKey).map((s) => [Number(s.StageNo), Number(s.DefaultBudget) || 0] as [number, number]));
        const sp = splitHours(p.remaining, budgets, a.held, Number(j.StageNo) || 1);
        actionable = Math.min(actionable, sp.split ? sp.actionable : p.remaining);
      }
      const f: Facts = { key, title: String(j.Title || ""), clientKey: String(j.ClientKey || ""), deadline: String(j.Deadline || "").slice(0, 10), internalTarget: String(j.InternalDeadline || "").slice(0, 10), clientAgreed: "", planned: String(j.PlannedDate || "").slice(0, 10), remaining: p.remaining, actionable, complete: false };
      facts.set(key, f); risks.set(key, risk(f, a, today, hoursOn, cfg));
    }
    return { facts, risks, impacts: impacts(world, facts, risks), items: riskItems(facts, risks, world, today), cfg, today, world };
  }, [world, data.jobs, data.services, data.stageTemplates, settings, cfg, today]);
}
