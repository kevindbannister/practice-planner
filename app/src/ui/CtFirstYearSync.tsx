// Watches the open Corporation Tax jobs and splits any whose period is a company's long first accounts period into its 12-month
// Corporation Tax returns (see lib/ctSplit). It runs as the planner opens and whenever jobs or clients change, so a CT job that is
// added, rolled forward or imported, or a company whose incorporation date comes in from Companies House, is picked up. Renders nothing.
import { useEffect, useRef } from "react";
import { isOpen } from "../lib/domain";
import { CT_SERVICE, splitFirstYear } from "../lib/ctSplit";
import { newKey } from "../lib/planning";
import { useData } from "./data";

export function CtFirstYearSync() {
  const { status, data, create, update } = useData();
  const done = useRef(new Set<string>());
  useEffect(() => {
    if (status !== "ready") return;
    const byKey = new Map(data.clients.map((c) => [String(c.Key), c]));
    for (const job of data.jobs) {
      if (String(job.ServiceKey || "") !== CT_SERVICE || !isOpen(job) || done.current.has(String(job.Key))) continue;
      const split = splitFirstYear(job, byKey.get(String(job.ClientKey || "")), () => newKey("J"));
      if (!split) continue;
      done.current.add(String(job.Key)); // once per visit, even if it fails part way (it is tried again next time the planner opens)
      void (async () => {
        try {
          // the new part first, so nothing is lost if the second step fails; one left from a split that didn't finish isn't made twice
          for (const row of split.create) {
            const there = data.jobs.some((j) => j.ClientKey === row.ClientKey && j.ServiceKey === CT_SERVICE && j.Source === row.Source && j.PeriodEnd === row.PeriodEnd);
            if (!there) await create("Jobs", row);
          }
          await update("Jobs", job, split.patch);
        } catch (e) {
          console.warn("Couldn't split the first-year Corporation Tax job", job.Key, e);
        }
      })();
    }
  }, [status, data.jobs, data.clients]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
