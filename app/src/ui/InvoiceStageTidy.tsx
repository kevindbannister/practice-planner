// Once, the first time the planner opens after invoices became their own jobs: takes any "Raise invoice" (or similar) stage out
// of every type of work, moves the jobs on it back a stage, and closes up the stages after it (see withoutInvoiceStages). What was
// done is kept in Settings under TIDY_KEY, which also stops it running again (so a stage added on purpose later stays).
import { useEffect, useRef } from "react";
import { withoutInvoiceStages } from "../lib/invoicing";
import { readSetting, useData } from "./data";

export const TIDY_KEY = "tidy.invoiceStages";

export function InvoiceStageTidy() {
  const { status, data, remove, updateMany, saveSetting } = useData();
  const started = useRef(false);
  useEffect(() => {
    if (status !== "ready" || started.current || readSetting(data.settings, TIDY_KEY)) return;
    started.current = true;
    void (async () => {
      const t = withoutInvoiceStages(data.stageTemplates, data.jobs, data.clientStages);
      try {
        for (const s of t.removeStages) await remove("StageTemplates", s);
        await updateMany("StageTemplates", t.stagePatches);
        await updateMany("Jobs", t.jobPatches);
        for (const r of t.removeClientStages) await remove("ClientServiceStages", r);
        await updateMany("ClientServiceStages", t.clientStagePatches);
        await saveSetting(TIDY_KEY, {
          at: new Date().toISOString(), stages: t.removeStages.map((s) => `${s.ServiceKey}: ${s.Title}`), jobsMoved: t.jobPatches.length,
        });
      } catch {
        started.current = false; // try again next time the planner opens
      }
    })();
  }, [status, data.settings]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
