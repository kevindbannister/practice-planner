// Which approvals still match the server's seal: AML assessments and Co Sec filings. Asked once per change to either; empty (nothing
// shown) when the server part isn't set up or in the demo build.
import { useEffect, useState } from "react";
import { getAccessToken } from "../lib/auth";
import type { SealState } from "../lib/amlSeal";
import { verifySeals } from "../lib/serverCalls";
import { isDemo } from "./commsKit";
import { useData } from "./data";

type Seals = { aml: Record<string, SealState>; cosec: Record<string, SealState> };
let cache: { sig: string; seals: Seals } = { sig: "", seals: { aml: {}, cosec: {} } };
function useAll(): Seals {
  const { data } = useData();
  const sig = [...data.amlAssessments.filter((r) => r.Status === "approved"), ...data.cosecTx.filter((r) => r.ApprovedBy)].map((r) => `${r.Key}:${r.Seal || ""}:${r.Updated || ""}`).join("|");
  const [seals, setSeals] = useState<Seals>(cache.sig === sig ? cache.seals : { aml: {}, cosec: {} });
  useEffect(() => {
    if (isDemo() || !sig) return;
    if (cache.sig === sig) { setSeals(cache.seals); return; }
    let live = true;
    void verifySeals(getAccessToken).then((r) => { if (r.ok) { cache = { sig, seals: { aml: r.data.results, cosec: r.data.cosec || {} } }; if (live) setSeals(cache.seals); } });
    return () => { live = false; };
  }, [sig]);
  return seals;
}
export const useSeals = () => useAll().aml;
export const useCosecSeals = () => useAll().cosec;
