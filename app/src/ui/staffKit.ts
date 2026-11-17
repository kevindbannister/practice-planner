// The people the practice has set up (Settings, in the job checklists' staff list) and who is signed in. Job owners and the
// people who do each stage are chosen from this list.
import { useMemo } from "react";
import { Config, readConfig } from "../lib/checklist";
import { useData } from "./data";

export function useStaff(): { cfg: Config; names: string[]; user: string } {
  const { data, user } = useData();
  const cfg = useMemo(() => readConfig(data.settings), [data.settings]);
  return { cfg, names: cfg.staff.map((s) => s.name), user: user || "" };
}
