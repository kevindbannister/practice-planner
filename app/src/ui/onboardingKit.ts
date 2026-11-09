// The onboarding data hook, apart from the onboarding screens so the menu's alerts don't load those screens (and the portal admin).
import { useMemo } from "react";
import { todayIso } from "../lib/domain";
import { readFeeSettings } from "../lib/fees";
import { View, onboardingCan, readOnboardingSettings, readStates } from "../lib/onboarding";
import { Row } from "../lib/schema";
import { useData } from "./data";
import { usePortal } from "./portalKit";
import { useSales } from "./salesKit";

/** Everything the onboarding logic needs to describe one onboarding, gathered from the data and the portal. */
export function useOnboarding() {
  const s = useSales();
  const { data } = useData();
  const portal = usePortal();
  const settings = useMemo(() => readOnboardingSettings(data.settings), [data.settings]);
  const can = (a: "view" | "edit" | "approve" | "activate" | "configure") => onboardingCan(s.cfg, s.me, a);
  const pcan = (a: Parameters<typeof s.pcan>[0]) => s.pcan(a);
  const viewFor = (onb: Row): View | undefined => {
    const client = data.clients.find((c) => c.Key === onb.ClientKey);
    if (!client) return undefined;
    const people = portal.forClient(client.Key).map((r) => ({ id: r.person.id, name: r.person.name || r.person.email, status: r.person.status }));
    return { onb, defs: settings.stages, client, engagements: data.engagements, proposals: data.proposals, versions: data.proposalVersions, catalogue: s.catalogue, people, today: todayIso() };
  };
  const fees = useMemo(() => readFeeSettings(data.settings), [data.settings]);
  const authDone = (onb: Row) => { const d = settings.stages.find((x) => x.key === "agent"); return !d?.enabled || readStates(onb.Stages).agent?.status === "done"; };
  return { s, data, portal, settings, fees, can, pcan, viewFor, authDone };
}
