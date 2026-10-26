// Loads the portal's people and status for the staff screens, and runs the actions on them.
import { createContext, createElement, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getAccessToken } from "../lib/auth";
import { PortalAdminApi, PortalAdminError, PortalEvent, PortalOverview, PortalPerson, PortalStatus } from "../lib/portalAdmin";
import { isDemo } from "./commsKit";
import { useData } from "./data";

export type PortalState = {
  api: PortalAdminApi;
  status: PortalStatus | null;
  overview: PortalOverview | null;
  error: string;
  loading: boolean;
  reload: () => Promise<void>;
  /** Run an action, then refresh. Returns its result, or throws a PortalAdminError with a plain message. */
  run: <T>(work: (api: PortalAdminApi) => Promise<T>) => Promise<T>;
  events: (q?: { clientKey?: string; userId?: string; limit?: number }) => Promise<PortalEvent[]>;
  forPerson: (personKey: string) => PortalPerson | undefined;
  forClient: (clientKey: string) => { person: PortalPerson; level: string; levelLabel: string }[];
};

const Ctx = createContext<PortalState | null>(null);

export function PortalProvider({ children }: { children: ReactNode }) {
  const { data } = useData();
  const api = useMemo(() => new PortalAdminApi(async () => (isDemo() ? "demo" : getAccessToken())), []);
  const [status, setStatus] = useState<PortalStatus | null>(null);
  const [overview, setOverview] = useState<PortalOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const started = useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      if (isDemo()) {
        // The test server stands in for the planner's lists: tell it which clients exist.
        await fetch("/dev/clients", { method: "PUT", body: JSON.stringify(data.clients) }).catch(() => undefined);
      }
      const s = await api.status();
      setStatus(s);
      if (!s.configured) {
        setOverview(null);
        setError("");
        return;
      }
      setOverview(await api.overview());
      setError("");
    } catch (e) {
      setError(e instanceof PortalAdminError ? e.message : "Couldn't load the client portal.");
    } finally {
      setLoading(false);
    }
  }, [api, data.clients]);

  useEffect(() => {
    if (!data.clients.length || started.current) return;
    started.current = true;
    void reload();
  }, [data.clients.length, reload]);

  const run = useCallback(
    async <T,>(work: (a: PortalAdminApi) => Promise<T>) => {
      const out = await work(api);
      await reload();
      return out;
    },
    [api, reload],
  );

  const value = useMemo<PortalState>(
    () => ({
      api, status, overview, error, loading, reload, run,
      events: (q) => api.events(q),
      forPerson: (key) => (key ? overview?.users.find((u) => u.personKey === key) : undefined),
      forClient: (clientKey) =>
        (overview?.users || []).flatMap((p) => p.businesses.filter((b) => b.clientKey === clientKey).map((b) => ({ person: p, level: b.level, levelLabel: b.levelLabel }))),
    }),
    [api, status, overview, error, loading, reload, run],
  );
  return createElement(Ctx.Provider, { value }, children);
}

/** Refresh the portal's people when a staff screen is opened, and every minute while it stays open. */
export function useFresh(): void {
  const { reload, status } = usePortal();
  useEffect(() => {
    if (status && !status.configured) return;
    void reload();
    const t = setInterval(() => void reload(), 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.configured]);
}

export function usePortal(): PortalState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePortal needs PortalProvider");
  return v;
}

export const say = (e: unknown, fallback = "That didn't work.") => (e instanceof PortalAdminError ? e.message : e instanceof Error ? e.message : fallback);
