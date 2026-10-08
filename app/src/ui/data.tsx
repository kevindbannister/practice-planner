// Loads the planner's lists once, keeps them in memory, and saves edits straight
// back to SharePoint. Components read from here with useData().
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Client, Job } from "../lib/domain";
import { ListKey, Row } from "../lib/schema";
import { SharePointStore, friendlyError } from "../lib/sharepoint";

export type Data = {
  clients: Client[];
  contacts: Row[];
  groups: Row[];
  members: Row[];
  services: Row[];
  stageTemplates: Row[];
  clientServices: Row[];
  clientStages: Row[];
  jobs: Job[];
  history: Row[];
};

type Status = "connecting" | "needs-setup" | "loading" | "ready" | "error";
type SaveState = { state: "idle" | "saving" | "saved" | "error"; at?: Date; error?: string };

type Ctx = {
  status: Status;
  error?: string;
  data: Data;
  store: SharePointStore;
  user?: string;
  save: SaveState;
  reload: () => Promise<void>;
  update: (list: ListKey, row: Row, patch: Row) => Promise<void>;
};

const EMPTY: Data = {
  clients: [], contacts: [], groups: [], members: [], services: [], stageTemplates: [],
  clientServices: [], clientStages: [], jobs: [], history: [],
};

const DataContext = createContext<Ctx | null>(null);

const SOURCE: [keyof Data, ListKey][] = [
  ["clients", "Clients"], ["contacts", "Contacts"], ["groups", "Groups"], ["members", "GroupMembers"],
  ["services", "Services"], ["stageTemplates", "StageTemplates"], ["clientServices", "ClientServices"],
  ["clientStages", "ClientServiceStages"], ["jobs", "Jobs"], ["history", "JobHistory"],
];

export function DataProvider({ store, user, children }: { store: SharePointStore; user?: string; children: ReactNode }) {
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string>();
  const [data, setData] = useState<Data>(EMPTY);
  const [save, setSave] = useState<SaveState>({ state: "idle" });

  const reload = useCallback(async () => {
    try {
      setStatus("connecting");
      await store.connect();
      const schema = await store.checkSchema();
      if (schema.some((s) => !s.exists || s.missingColumns.length)) {
        setStatus("needs-setup");
        return;
      }
      setStatus("loading");
      const loaded = await Promise.all(SOURCE.map(([, list]) => store.readAll(list)));
      const next = { ...EMPTY };
      SOURCE.forEach(([k], i) => ((next as any)[k] = loaded[i]));
      next.clients.sort((a, b) => a.Title.localeCompare(b.Title));
      setData(next);
      setStatus(next.clients.length ? "ready" : "needs-setup");
    } catch (e) {
      setError(friendlyError(e));
      setStatus("error");
    }
  }, [store]);

  useEffect(() => {
    reload();
  }, [reload]);

  const update = useCallback(
    async (list: ListKey, row: Row, patch: Row) => {
      const key = SOURCE.find(([, l]) => l === list)![0];
      const apply = (values: Row) =>
        setData((d) => ({
          ...d,
          [key]: (d[key] as Row[]).map((r) => (r._id === row._id ? { ...r, ...normalise(values) } : r)),
        }));
      const before: Row = {};
      for (const k of Object.keys(patch)) before[k] = row[k];
      apply(patch); // show the change at once
      setSave({ state: "saving" });
      try {
        await store.update(list, row._id!, patch);
        setSave({ state: "saved", at: new Date() });
      } catch (e) {
        apply(before); // put it back if SharePoint refused
        setSave({ state: "error", error: friendlyError(e) });
        throw e;
      }
    },
    [store],
  );

  const value = useMemo(() => ({ status, error, data, store, user, save, reload, update }), [
    status, error, data, store, user, save, reload, update,
  ]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

function normalise(patch: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(patch)) out[k] = v === "" ? undefined : v;
  return out;
}

export function useData(): Ctx {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be inside DataProvider");
  return ctx;
}

/** Lookups built once per data load. */
export function useIndex() {
  const { data } = useData();
  return useMemo(() => {
    const clientByKey = new Map(data.clients.map((c) => [c.Key, c]));
    const groupByKey = new Map(data.groups.map((g) => [g.Key as string, g]));
    const serviceName = new Map(data.services.map((s) => [s.Key as string, s.Title as string]));
    const jobsByClient = new Map<string, Job[]>();
    for (const j of data.jobs) {
      if (!jobsByClient.has(j.ClientKey)) jobsByClient.set(j.ClientKey, []);
      jobsByClient.get(j.ClientKey)!.push(j);
    }
    for (const list of jobsByClient.values()) list.sort((a, b) => (a.Deadline || "9999").localeCompare(b.Deadline || "9999"));
    const groupsByMember = new Map<string, Row[]>();
    const membersByGroup = new Map<string, Row[]>();
    for (const m of data.members) {
      const g = groupByKey.get(m.GroupKey as string);
      if (!g) continue;
      const mk = m.MemberKey as string;
      if (!groupsByMember.has(mk)) groupsByMember.set(mk, []);
      groupsByMember.get(mk)!.push(g);
      if (!membersByGroup.has(g.Key as string)) membersByGroup.set(g.Key as string, []);
      membersByGroup.get(g.Key as string)!.push(m);
    }
    const servicesByClient = new Map<string, Set<string>>();
    for (const s of data.clientServices) {
      const ck = s.ClientKey as string;
      if (!servicesByClient.has(ck)) servicesByClient.set(ck, new Set());
      servicesByClient.get(ck)!.add(s.ServiceKey as string);
    }
    for (const j of data.jobs) {
      if (!servicesByClient.has(j.ClientKey)) servicesByClient.set(j.ClientKey, new Set());
      if (j.ServiceKey) servicesByClient.get(j.ClientKey)!.add(j.ServiceKey);
    }
    return { clientByKey, groupByKey, serviceName, jobsByClient, groupsByMember, membersByGroup, servicesByClient };
  }, [data]);
}
