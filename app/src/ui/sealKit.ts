// Which approved AML assessments still match the server's seal. Asked once per change to the assessments; empty (nothing shown)
// when the server part isn't set up or in the demo build.
import { useEffect, useState } from "react";
import { getAccessToken } from "../lib/auth";
import type { SealState } from "../lib/amlSeal";
import { verifySeals } from "../lib/serverCalls";
import { isDemo } from "./commsKit";
import { useData } from "./data";

let cache: { sig: string; results: Record<string, SealState> } = { sig: "", results: {} };
export function useSeals(): Record<string, SealState> {
  const { data } = useData();
  const sig = data.amlAssessments.filter((r) => r.Status === "approved").map((r) => `${r.Key}:${r.Seal || ""}:${r.Updated || ""}`).join("|");
  const [results, setResults] = useState(cache.sig === sig ? cache.results : {});
  useEffect(() => {
    if (isDemo() || !sig) return;
    if (cache.sig === sig) { setResults(cache.results); return; }
    let live = true;
    void verifySeals(getAccessToken).then((r) => { if (r.ok) { cache = { sig, results: r.data.results }; if (live) setResults(r.data.results); } });
    return () => { live = false; };
  }, [sig]);
  return results;
}
