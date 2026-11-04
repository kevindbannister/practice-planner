// Browser side of the HMRC filing bridge (api/filing). It only asks what is set up; HMRC's credentials and every request to HMRC
// stay on the server, and the values of the secrets are never sent here.
import { FilingEnv, FilingService, FilingSettings } from "./hmrcFiling";

export type FilingInfo = {
  store: { provider: string; configured: boolean; signIn: string; error: string };
  environments: Record<FilingEnv, { ok: boolean; reason: string }>;
  services: Record<FilingService, { adapter: boolean; reason: string }>;
  liveEnabled: boolean; liveApprovedBy: string; vendorIdSet: boolean; testCredentialsSet: boolean;
};

export const settingsOf = (i: FilingInfo | null): FilingSettings => i
  ? { vendorIdSet: i.vendorIdSet, testCredentialsSet: i.testCredentialsSet, liveEnabled: i.liveEnabled, liveApprovedBy: i.liveApprovedBy }
  : { vendorIdSet: false, testCredentialsSet: false, liveEnabled: false, liveApprovedBy: "" };

/** What the server has set up for filing, or null when it can't be reached (not deployed yet, offline, or the demo). */
export async function fetchFilingInfo(token: () => Promise<string>): Promise<FilingInfo | null> {
  try {
    const res = await fetch("/api/filing/info", { headers: { "X-PP-Token": await token(), Accept: "application/json" } });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.environments && j.services ? (j as FilingInfo) : null;
  } catch { return null; }
}
