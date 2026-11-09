// The number of clients waiting to be chased, for the menu badge. Apart from the Chase page so the badge doesn't load that page.
import { useMemo } from "react";
import { chaseItems, groupByClient } from "../lib/chase";
import { todayIso } from "../lib/domain";
import { useData, useIndex } from "./data";

export function useChaseCount(): number {
  const { data } = useData();
  const idx = useIndex();
  const today = todayIso();
  return useMemo(
    () => groupByClient(chaseItems(idx.openJobs, data.services, today, data.stageTemplates)).filter((g) => g.status !== "chased").length,
    [idx.openJobs, data.services, today, data.stageTemplates],
  );
}
