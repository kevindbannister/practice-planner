// Loads the planner's lists once, keeps them in memory, and saves edits straight
// back to SharePoint. Components read from here with useData().
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Client, Job, Task, isOpen, setTightDays } from "../lib/domain";
import { PlannerSettings, newKey, readSettings } from "../lib/planning";
import { changeEvents, createdEvent } from "../lib/timeline";
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
  tasks: Task[];
  settings: Row[];
  chFlags: Row[];
  comms: Row[];
  taxPayments: Row[];
  meetings: Row[];
  papers: Row[];
  paperLines: Row[];
  projects: Row[];
  docTemplates: Row[];
  docVersions: Row[];
  documents: Row[];
  activities: Row[];
};

type Status = "connecting" | "needs-setup" | "loading" | "ready" | "error";
type SaveState = { state: "idle" | "saving" | "saved" | "error"; at?: Date; error?: string };

type Ctx = {
  status: Status;
  error?: string;
  data: Data;
  settings: PlannerSettings;
  store: SharePointStore;
  user?: string;
  save: SaveState;
  reload: () => Promise<void>;
  update: (list: ListKey, row: Row, patch: Row) => Promise<void>;
  updateMany: (list: ListKey, changes: { row: Row; patch: Row }[]) => Promise<void>;
  create: (list: ListKey, row: Row) => Promise<Row>;
  /** Add many rows at once (in batches), then read the list again. */
  createMany: (list: ListKey, rows: Row[]) => Promise<void>;
  /** Delete many rows at once (in batches). */
  removeMany: (list: ListKey, rows: Row[]) => Promise<void>;
  remove: (list: ListKey, row: Row) => Promise<void>;
  saveSetting: (key: string, value: unknown) => Promise<void>;
};

const EMPTY: Data = {
  clients: [], contacts: [], groups: [], members: [], services: [], stageTemplates: [],
  clientServices: [], clientStages: [], jobs: [], history: [], tasks: [], settings: [], chFlags: [], comms: [], taxPayments: [], meetings: [], papers: [], paperLines: [], projects: [], docTemplates: [], docVersions: [], documents: [], activities: [],
};

const DataContext = createContext<Ctx | null>(null);

export const SOURCE: [keyof Data, ListKey][] = [
  ["clients", "Clients"], ["contacts", "Contacts"], ["groups", "Groups"], ["members", "GroupMembers"],
  ["services", "Services"], ["stageTemplates", "StageTemplates"], ["clientServices", "ClientServices"],
  ["clientStages", "ClientServiceStages"], ["jobs", "Jobs"], ["history", "JobHistory"], ["tasks", "Tasks"],
  ["settings", "Settings"], ["chFlags", "CHFlags"], ["comms", "Communications"], ["taxPayments", "TaxPayments"], ["meetings", "Meetings"], ["papers", "WorkingPapers"], ["paperLines", "PaperLines"], ["projects", "Projects"],
  ["docTemplates", "DocTemplates"], ["docVersions", "DocVersions"], ["documents", "Documents"], ["activities", "Activities"],
];
const keyFor = (list: ListKey) => SOURCE.find(([, l]) => l === list)![0];

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
      if (!schema.find((s) => s.list.key === "Clients")?.exists) {
        setStatus("needs-setup");
        return;
      }
      // New versions of the app may add lists or columns; add them quietly (no data changes).
      if (schema.some((s) => !s.exists || s.missingColumns.length)) {
        try {
          await store.ensureSchema();
        } catch (e) {
          // A list the app couldn't add must not stop everything else loading; its page will say so when used.
          console.warn("Couldn't add a list or column", e);
        }
      }
      setStatus("loading");
      const loaded = await Promise.all(SOURCE.map(([, list]) => (store.hasList(list) ? store.readAll(list) : Promise.resolve([] as Row[]))));
      const next = { ...EMPTY };
      SOURCE.forEach(([k], i) => ((next as any)[k] = loaded[i]));
      next.clients.sort((a, b) => String(a.Title || "").localeCompare(String(b.Title || "")));
      await migrate(store, next);
      setTightDays(readSettings(next.settings).tightDays);
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

  const track = useCallback(async <T,>(work: () => Promise<T>): Promise<T> => {
    setSave({ state: "saving" });
    try {
      const out = await work();
      setSave({ state: "saved", at: new Date() });
      return out;
    } catch (e) {
      setSave({ state: "error", error: friendlyError(e) });
      throw e;
    }
  }, []);

  // Meaningful changes (a job's status, stage, planned date or deadline; a job or task created by hand) leave a
  // line on the client timeline. The line is saved quietly: if it can't be, the change itself still stands.
  const dataRef = useRef(data);
  dataRef.current = data;
  const logged = useRef(new Set<string>());
  const log = useCallback((rows: Row[]) => {
    if (!rows.length || !store.hasList("Activities")) return;
    for (const r of rows) {
      const k = String(r.EventKey);
      if (logged.current.has(k) || dataRef.current.activities.some((a) => a.EventKey === k)) continue;
      logged.current.add(k);
      const full = { ...r, Created: new Date().toISOString() };
      store.create("Activities", full).then((created) => setData((d) => ({ ...d, activities: [...d.activities, { ...full, ...created }] }))).catch(() => logged.current.delete(k));
    }
  }, [store]);
  const update = useCallback(
    async (list: ListKey, row: Row, patch: Row) => {
      const key = keyFor(list);
      const apply = (values: Row) =>
        setData((d) => ({
          ...d,
          [key]: (d[key] as Row[]).map((r) => (r._id === row._id ? { ...r, ...normalise(values) } : r)),
        }));
      const before: Row = {};
      for (const k of Object.keys(patch)) before[k] = row[k] ?? "";
      apply(patch); // show the change at once
      try {
        await track(() => store.update(list, row._id!, patch));
        log(changeEvents(list, row, patch, { actor: user || "", now: new Date().toISOString(), newKey }));
      } catch (e) {
        apply(before); // put it back if SharePoint refused
        throw e;
      }
    },
    [store, track, log, user],
  );

  const updateMany = useCallback(
    async (list: ListKey, changes: { row: Row; patch: Row }[]) => {
      if (!changes.length) return;
      const key = keyFor(list);
      const byId = new Map(changes.map((c) => [c.row._id, c]));
      const apply = (pick: (c: { row: Row; patch: Row }) => Row) =>
        setData((d) => ({ ...d, [key]: (d[key] as Row[]).map((r) => (byId.has(r._id) ? { ...r, ...normalise(pick(byId.get(r._id)!)) } : r)) }));
      apply((c) => c.patch);
      try {
        await track(() => store.updateMany(list, changes.map((c) => ({ itemId: c.row._id!, patch: c.patch }))));
      } catch (e) {
        apply((c) => Object.fromEntries(Object.keys(c.patch).map((k) => [k, c.row[k] ?? ""])));
        throw e;
      }
    },
    [store, track],
  );

  const create = useCallback(
    async (list: ListKey, row: Row) => {
      const created = await track(() => store.create(list, row));
      const full = { ...row, ...created };
      setData((d) => ({ ...d, [keyFor(list)]: [...(d[keyFor(list)] as Row[]), full] }));
      const made = createdEvent(list, full, { actor: user || "", now: new Date().toISOString(), newKey });
      if (made) log([made]);
      return full;
    },
    [store, track, log, user],
  );

  const createMany = useCallback(
    async (list: ListKey, rows: Row[]) => {
      if (!rows.length) return;
      const res = await track(async () => {
        const r = await store.createMany(list, rows);
        const all = await store.readAll(list);
        setData((d) => ({ ...d, [keyFor(list)]: all }));
        return r;
      });
      if (res.failed) throw new Error(res.error || `${res.failed} couldn't be saved`);
    },
    [store, track],
  );

  const removeMany = useCallback(
    async (list: ListKey, rows: Row[]) => {
      if (!rows.length) return;
      const ids = new Set(rows.map((r) => r._id));
      const res = await track(() => store.removeMany(list, [...ids] as string[]));
      setData((d) => ({ ...d, [keyFor(list)]: (d[keyFor(list)] as Row[]).filter((r) => !ids.has(r._id)) }));
      if (res.failed) throw new Error(`${res.failed} couldn't be removed`);
    },
    [store, track],
  );

  const remove = useCallback(
    async (list: ListKey, row: Row) => {
      await track(() => store.remove(list, row._id!));
      setData((d) => ({ ...d, [keyFor(list)]: (d[keyFor(list)] as Row[]).filter((r) => r._id !== row._id) }));
    },
    [store, track],
  );

  const saveSetting = useCallback(
    async (key: string, value: unknown) => {
      const existing = data.settings.find((s) => s.Key === key);
      const v = JSON.stringify(value);
      if (existing) await update("Settings", existing, { Value: v });
      else await create("Settings", { Key: key, Title: key, Value: v });
      if (key === "tightDays") setTightDays(value as number);
    },
    [data.settings, update, create],
  );

  const settings = useMemo(() => readSettings(data.settings), [data.settings]);

  const value = useMemo(
    () => ({ status, error, data, settings, store, user, save, reload, update, updateMany, create, createMany, remove, removeMany, saveSetting }),
    [status, error, data, settings, store, user, save, reload, update, updateMany, create, createMany, remove, removeMany, saveSetting],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

/**
 * One-off data fixes, each recorded in Settings so it runs once.
 * estimates-v1: Engager's job budgets were mostly outsourced preparation time. Keep only
 * hours on stages done by the client's partner, so capacity reflects your own time.
 */
async function migrate(store: SharePointStore, d: Data): Promise<void> {
  if (d.settings.some((s) => s.Key === "migrated.estimates-v1")) return;
  const partnerOf = new Map(d.clients.map((c) => [c.Key, c.Partner as string]));
  for (const j of d.jobs) {
    if (!j.EstimateHours || j.Source !== "Engager") continue;
    const own = d.clientStages
      .filter((s) => s.ClientKey === j.ClientKey && s.ServiceKey === j.ServiceKey && s.Who === partnerOf.get(j.ClientKey))
      .reduce((t, s) => t + ((s.BudgetHours as number) || 0), 0);
    if (own !== j.EstimateHours) {
      await store.update("Jobs", j._id!, { EstimateHours: own || ("" as any) });
      j.EstimateHours = own || undefined;
    }
  }
  const row = await store.create("Settings", { Key: "migrated.estimates-v1", Title: "migrated.estimates-v1", Value: "true" });
  d.settings.push(row);
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

/** Lookups built once per data change. Only open jobs and tasks are indexed by client. */
export function useIndex() {
  const { data } = useData();
  return useMemo(() => {
    const clientByKey = new Map(data.clients.map((c) => [c.Key, c]));
    const groupByKey = new Map(data.groups.map((g) => [g.Key as string, g]));
    const serviceName = new Map(data.services.map((s) => [s.Key as string, s.Title as string]));
    const openJobs = data.jobs.filter(isOpen);
    const openTasks = data.tasks.filter(isOpen);
    const jobsByClient = new Map<string, Job[]>();
    for (const j of openJobs) {
      if (!jobsByClient.has(j.ClientKey)) jobsByClient.set(j.ClientKey, []);
      jobsByClient.get(j.ClientKey)!.push(j);
    }
    for (const list of jobsByClient.values()) list.sort((a, b) => (a.Deadline || "9999").localeCompare(b.Deadline || "9999"));
    const tasksByClient = new Map<string, Task[]>();
    for (const t of openTasks) {
      if (!t.ClientKey) continue;
      if (!tasksByClient.has(t.ClientKey)) tasksByClient.set(t.ClientKey, []);
      tasksByClient.get(t.ClientKey)!.push(t);
    }
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
    // work you've stopped doing for a client: "ClientKey|ServiceKey"
    const servicesOff = new Set<string>();
    for (const s of data.clientServices) if (s.Off === true || s.Off === "true") servicesOff.add(`${s.ClientKey}|${s.ServiceKey}`);
    for (const j of openJobs) {
      if (!servicesByClient.has(j.ClientKey)) servicesByClient.set(j.ClientKey, new Set());
      if (j.ServiceKey) servicesByClient.get(j.ClientKey)!.add(j.ServiceKey);
    }
    const stagesByService = new Map<string, Row[]>();
    for (const s of data.stageTemplates) {
      const k = s.ServiceKey as string;
      if (!stagesByService.has(k)) stagesByService.set(k, []);
      stagesByService.get(k)!.push(s);
    }
    for (const list of stagesByService.values()) list.sort((a, b) => (a.StageNo as number) - (b.StageNo as number));
    return {
      clientByKey, groupByKey, serviceName, openJobs, openTasks, jobsByClient, tasksByClient,
      groupsByMember, membersByGroup, servicesByClient, servicesOff, stagesByService,
    };
  }, [data]);
}

/** A JSON value saved in the Settings list, or undefined. */
export function readSetting<T>(settings: Row[], key: string): T | undefined {
  const row = settings.find((s) => s.Key === key);
  if (!row?.Value) return undefined;
  try {
    return JSON.parse(String(row.Value)) as T;
  } catch {
    return undefined;
  }
}
