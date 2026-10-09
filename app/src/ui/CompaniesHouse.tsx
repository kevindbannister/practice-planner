// Companies House checks in the app: runs the check (automatically once a day, or on
// demand), keeps the list of changes found, and the Settings › Companies House screen where
// you apply or ignore each one.
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getAccessToken } from "../lib/auth";
import {
  ChApi, ChError, HttpCh, Proposal, chDeadlines, chNumber, compareCompany, flagAction, isCompany, people, reconcile, statusText,
} from "../lib/companiesHouse";
import { Client, fmtDate, isOpen, todayIso } from "../lib/domain";
import { FakeCh } from "../lib/fakeCh";
import { newKey, rollForward, ruleFor } from "../lib/planning";
import { Row } from "../lib/schema";
import { ClientBadge, companiesHouseUrl, href } from "./bits";
import { useData, useIndex } from "./data";

const DAY_GAP_MS = 20 * 60 * 60 * 1000; // check again after 20 hours
const STOP_CODES = ["not-configured", "unauthorised", "key-rejected", "no-bridge"];

type LastRun = { at: string; companies: number; checked: number; errors: string[]; auto?: boolean };
type Progress = { running: boolean; done: number; total: number; now?: string; error?: ChError; finished?: boolean };

type ChCtx = {
  progress: Progress;
  lastRun?: LastRun;
  openFlags: Row[];
  run: (auto?: boolean) => Promise<void>;
  test: () => Promise<string>;
  apply: (flag: Row) => Promise<void>;
  setStatus: (flag: Row, status: "Ignored" | "Open") => Promise<void>;
};

const Ctx = createContext<ChCtx | null>(null);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readSetting<T>(settings: Row[], key: string): T | undefined {
  const row = settings.find((s) => s.Key === key);
  if (!row?.Value) return undefined;
  try {
    return JSON.parse(String(row.Value)) as T;
  } catch {
    return undefined;
  }
}

export function CompaniesHouseProvider({ demo, children }: { demo: boolean; children: ReactNode }) {
  const ctx = useData();
  const latest = useRef(ctx);
  latest.current = ctx;
  const api = useMemo<ChApi>(
    () => (demo ? new FakeCh(() => latest.current.data) : new HttpCh(getAccessToken)),
    [demo],
  );
  const [progress, setProgress] = useState<Progress>({ running: false, done: 0, total: 0 });
  const running = useRef(false);
  const autoTried = useRef(false);
  const lastRun = readSetting<LastRun>(ctx.data.settings, "ch.lastRun");

  /** A GET that waits and tries once more if Companies House asks us to slow down. */
  const get = useCallback(async (path: string) => {
    try {
      return await api.get(path);
    } catch (e) {
      if (e instanceof ChError && e.code === "rate-limited") {
        await sleep(Math.min(e.retryAfter || 30, 60) * 1000);
        return api.get(path);
      }
      throw e;
    }
  }, [api]);

  const orNull = (p: Promise<any>) => p.catch((e) => {
    if (e instanceof ChError && e.code === "not-found") return null;
    throw e;
  });

  const run = useCallback(async (auto = false) => {
    if (running.current) return;
    running.current = true;
    const { data, update } = latest.current;
    const companies = data.clients.filter(isCompany).sort((a, b) => chNumber(a).localeCompare(chNumber(b)));
    const before = readSetting<Record<string, { officers?: string[]; pscs?: string[] }>>(data.settings, "ch.people") || {};
    const nextPeople = { ...before };
    const found: Proposal[] = [];
    const checked = new Set<string>();
    const errors: string[] = [];
    setProgress({ running: true, done: 0, total: companies.length });
    try {
      for (let i = 0; i < companies.length; i++) {
        const c = companies[i];
        const num = chNumber(c);
        setProgress({ running: true, done: i, total: companies.length, now: c.Title });
        try {
          const profile = await orNull(get(`company/${num}`));
          let officers: string[] | null = null;
          let pscs: string[] | null = null;
          if (profile) {
            officers = people(await orNull(get(`company/${num}/officers?items_per_page=100`)), "officers");
            pscs = people(await orNull(get(`company/${num}/persons-with-significant-control?items_per_page=100`)), "pscs");
            nextPeople[num] = { officers, pscs };
          }
          const jobs = latest.current.data.jobs.filter((j) => j.ClientKey === c.Key && isOpen(j));
          found.push(...compareCompany({ client: c, profile, jobs, officers, pscs, before: before[num] }));
          checked.add(c.Key);
          const st = profile ? statusText(profile) : "Not found at Companies House";
          if (c.CHStatus !== st || !c.CHChecked) await update("Clients", c, { CHStatus: st, CHChecked: true });
          for (const { job, CHDeadline } of chDeadlines(profile, jobs)) await update("Jobs", job, { CHDeadline });
        } catch (e) {
          if (e instanceof ChError && STOP_CODES.includes(e.code)) throw e;
          errors.push(`${c.Title}: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (!demo) await sleep(150); // well inside Companies House's limit of 600 calls per 5 minutes
      }
      const { create, update: upd, saveSetting } = latest.current;
      const writes = reconcile(found, latest.current.data.chFlags, checked, todayIso());
      for (const row of writes.create) await create("CHFlags", row);
      for (const w of writes.update) await upd("CHFlags", w.row, w.patch);
      await saveSetting("ch.people", nextPeople);
      await latest.current.saveSetting("ch.lastRun", {
        at: new Date().toISOString(), companies: companies.length, checked: checked.size, errors, auto,
      } satisfies LastRun);
      setProgress({ running: false, done: companies.length, total: companies.length, finished: true });
    } catch (e) {
      const err = e instanceof ChError ? e : new ChError("upstream", e instanceof Error ? e.message : String(e));
      setProgress((p) => ({ ...p, running: false, error: err }));
    } finally {
      running.current = false;
    }
  }, [demo, get]);

  // the daily check, the first time the planner opens after 20 hours
  useEffect(() => {
    if (ctx.status !== "ready" || autoTried.current) return;
    autoTried.current = true;
    const last = readSetting<LastRun>(ctx.data.settings, "ch.lastRun");
    if (!last || Date.now() - Date.parse(last.at) > DAY_GAP_MS) run(true);
  }, [ctx.status, ctx.data.settings, run]);

  const test = useCallback(async () => {
    const first = latest.current.data.clients.filter(isCompany)[0];
    const num = first ? chNumber(first) : "00000006";
    const p = await api.get(`company/${num}`);
    return `Connected. Companies House found ${p.company_name || "the company"} (${num}).`;
  }, [api]);

  const apply = useCallback(async (flag: Row) => {
    const { data, update, create } = latest.current;
    const a = flagAction(flag);
    const today = todayIso();
    const client = data.clients.find((c) => c.Key === flag.ClientKey);
    const job = "jobKey" in a ? data.jobs.find((j) => j.Key === a.jobKey) : undefined;
    const firstStage = (service?: string) =>
      (data.stageTemplates.filter((s) => s.ServiceKey === service).sort((x, y) => (x.StageNo as number) - (y.StageNo as number))[0]?.Title as string) || "";

    if (a.do === "complete" && job && isOpen(job)) {
      if (a.next) {
        const rolled = rollForward(job, ruleFor(job.ServiceKey, data.services), today, newKey("J")) || {
          Key: newKey("J"), Title: job.Title, ClientKey: job.ClientKey, ClientName: job.ClientName, ServiceKey: job.ServiceKey, Status: "Open",
        };
        const next: Row = {
          ...rolled, PeriodEnd: a.next.PeriodEnd, Deadline: a.next.Deadline, CHDeadline: a.next.Deadline,
          DeadlineSource: "Companies House", StageNo: 1, StageName: firstStage(job.ServiceKey), Source: "Companies House",
        };
        if (next.SuggestedSlot && String(next.SuggestedSlot) > a.next.Deadline) next.SuggestedSlot = undefined;
        await create("Jobs", next); // the next one first, so nothing is lost if the second step fails
      }
      await update("Jobs", job, { Status: "Complete", CompletedDate: today });
    } else if (a.do === "dates" && job) {
      await update("Jobs", job, { PeriodEnd: a.PeriodEnd, Deadline: a.Deadline, CHDeadline: a.Deadline, DeadlineSource: "Companies House" });
    } else if (a.do === "create" && client) {
      const name = (data.services.find((s) => s.Key === a.serviceKey)?.Title as string) || a.serviceKey;
      await create("Jobs", {
        Key: newKey("J"), Title: name, ClientKey: client.Key, ClientName: client.Title, ServiceKey: a.serviceKey,
        PeriodEnd: a.PeriodEnd, Deadline: a.Deadline, CHDeadline: a.Deadline, DeadlineSource: "Companies House",
        StageNo: 1, StageName: firstStage(a.serviceKey), Status: "Open", Source: "Companies House",
      });
    } else if (a.do === "client" && client) {
      await update("Clients", client, a.patch);
    }
    await update("CHFlags", flag, { Status: a.do === "none" ? "Seen" : "Applied", Resolved: today });
  }, []);

  const setStatus = useCallback(async (flag: Row, status: "Ignored" | "Open") => {
    await latest.current.update("CHFlags", flag, status === "Open" ? { Status: "Open", Resolved: "" } : { Status: status, Resolved: todayIso() });
  }, []);

  const openFlags = useMemo(() => ctx.data.chFlags.filter((f) => f.Status === "Open"), [ctx.data.chFlags]);

  const value = useMemo(
    () => ({ progress, lastRun, openFlags, run, test, apply, setStatus }),
    [progress, lastRun, openFlags, run, test, apply, setStatus],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompaniesHouse(): ChCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCompaniesHouse must be inside CompaniesHouseProvider");
  return c;
}

export function fmtWhen(iso?: string): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return `${fmtDate(todayIso(d), { year: false })} at ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

// ------------------------------------------------------------------ settings screen

const RANK = { red: 0, amber: 1, info: 2 } as Record<string, number>;

export function CompaniesHouseSettings() {
  const { data } = useData();
  const idx = useIndex();
  const ch = useCompaniesHouse();
  const [testing, setTesting] = useState<{ ok?: string; error?: ChError | Error }>();
  const companies = data.clients.filter(isCompany);
  const open = [...ch.openFlags].sort(
    (a, b) => (RANK[a.Severity as string] ?? 3) - (RANK[b.Severity as string] ?? 3) ||
      String(idx.clientByKey.get(a.ClientKey as string)?.Title || "").localeCompare(String(idx.clientByKey.get(b.ClientKey as string)?.Title || "")),
  );
  const earlier = data.chFlags
    .filter((f) => f.Status !== "Open")
    .sort((a, b) => String(b.Resolved || b.Found || "").localeCompare(String(a.Resolved || a.Found || "")))
    .slice(0, 60);

  const runTest = async () => {
    setTesting({});
    try {
      setTesting({ ok: await ch.test() });
    } catch (e) {
      setTesting({ error: e as Error });
    }
  };
  const p = ch.progress;

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 860 }}>
      <section className="card pad stack" aria-labelledby="ch-h">
        <div className="card-title-row">
          <h2 id="ch-h">Companies House checks</h2>
          <div className="row-wrap">
            <button type="button" className="btn" onClick={runTest} disabled={p.running}>Test connection</button>
            <button type="button" className="btn primary" onClick={() => ch.run(false)} disabled={p.running}>
              {p.running ? "Checking…" : "Check now"}
            </button>
          </div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Your {companies.length} companies are checked automatically the first time you open the planner each day.
          Nothing in your records changes until you apply it below.
        </p>
        {p.running ? (
          <div className="stack" style={{ gap: 6 }} role="status">
            <span style={{ fontSize: 13 }}>Checking {Math.min(p.done + 1, p.total)} of {p.total}{p.now ? `: ${p.now}` : ""}</span>
            <div className="progress" aria-hidden="true"><span style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></div>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 14 }} role="status">
            Last checked <strong>{fmtWhen(ch.lastRun?.at)}</strong>
            {ch.lastRun ? ` · ${ch.lastRun.checked} of ${ch.lastRun.companies} companies` : ""}
            {p.finished ? " · just now" : ""}
          </p>
        )}
        {p.error && <ChProblem error={p.error} />}
        {!!ch.lastRun?.errors?.length && !p.running && (
          <div className="alert amber">
            <strong>{ch.lastRun.errors.length} compan{ch.lastRun.errors.length === 1 ? "y" : "ies"} couldn't be checked last time</strong>
            <span>{ch.lastRun.errors.slice(0, 5).join(" · ")}</span>
          </div>
        )}
        {testing?.ok && <div className="alert" style={{ borderColor: "var(--green)", background: "var(--green-soft)", color: "var(--green)" }}><strong>{testing.ok}</strong></div>}
        {testing?.error && <ChProblem error={testing.error} />}
      </section>

      <section className="card" aria-labelledby="ch-review-h">
        <div className="card-head">
          <h2 id="ch-review-h">To review</h2>
          <span className="muted" style={{ fontSize: 13 }}>{open.length ? `${open.length} change${open.length === 1 ? "" : "s"}` : "Nothing to review"}</span>
        </div>
        {open.length ? (
          <ul className="ch-list">
            {open.map((f) => <FlagRow key={f.Key as string} flag={f} />)}
          </ul>
        ) : (
          <p className="muted" style={{ margin: 0, padding: 16 }}>
            {ch.lastRun ? "The planner agrees with Companies House." : "Run a check to compare your companies with Companies House."}
          </p>
        )}
      </section>

      {earlier.length > 0 && (
        <details className="card">
          <summary className="card-head" style={{ cursor: "pointer" }}><h2 style={{ display: "inline" }}>Earlier changes</h2></summary>
          <ul className="ch-list">
            {earlier.map((f) => <FlagRow key={f.Key as string} flag={f} past />)}
          </ul>
        </details>
      )}

      <section className="card pad stack" aria-labelledby="ch-what-h">
        <h2 id="ch-what-h">What's checked</h2>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6, fontSize: 14 }}>
          <li>Accounts and confirmation statements filed while the job is still open (apply to tick it off and set up the next one)</li>
          <li>Period ends and due dates that differ from the planner, and filings Companies House is missing</li>
          <li>Overdue filings, strike-off notices and other status changes</li>
          <li>Registered office and company name</li>
          <li>Directors, officers and people with significant control joining or leaving (from the second check on)</li>
        </ul>
      </section>
    </div>
  );
}

function FlagRow({ flag: f, past }: { flag: Row; past?: boolean }) {
  const idx = useIndex();
  const ch = useCompaniesHouse();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const client = idx.clientByKey.get(f.ClientKey as string) as Client | undefined;
  const action = flagAction(f);
  const info = action.do === "none";
  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch {
      setError("Couldn't save that. Nothing has changed; try again.");
    } finally {
      setBusy(false);
    }
  };
  const label = `${client?.Title || f.ClientKey}: ${f.Title}`;
  const sev = f.Severity === "red" ? "red" : f.Severity === "amber" ? "amber" : "blue";
  const statusChip = { Applied: "green", Ignored: "", Seen: "", Resolved: "green" }[f.Status as string] ?? "";

  return (
    <li className="ch-item" aria-label={label}>
      <div className="ident" style={{ alignItems: "flex-start" }}>
        {client && <ClientBadge client={client} />}
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <div className="row-wrap" style={{ gap: 6 }}>
            {client ? <a className="cell-title" href={href("clients", client.Key)}>{client.Title}</a> : <span>{f.ClientKey}</span>}
            {!past && <span className={`chip ${sev}`}>{f.Severity === "red" ? "Important" : f.Severity === "amber" ? "Planner" : "For info"}</span>}
            {past && <span className={`chip ${statusChip}`}>{f.Status} {f.Resolved ? fmtDate(f.Resolved as string, { year: false }) : ""}</span>}
          </div>
          <strong style={{ fontSize: 14 }}>{f.Title}</strong>
          <span style={{ fontSize: 13 }}>{f.Detail}</span>
          {f.Current && <span className="muted" style={{ fontSize: 12 }}>Planner now: {f.Current}</span>}
          {error && <span className="error-text" role="alert">{error}</span>}
        </div>
      </div>
      <div className="ch-actions">
        {client?.CompanyNumber && (
          <a className="linkbtn" href={companiesHouseUrl(chNumber(client))} target="_blank" rel="noreferrer">View at Companies House</a>
        )}
        {past ? (
          (f.Status === "Ignored" || f.Status === "Seen") && (
            <button type="button" className="btn small" disabled={busy} onClick={() => act(() => ch.setStatus(f, "Open"))}>Review again</button>
          )
        ) : info ? (
          <button type="button" className="btn small" disabled={busy} onClick={() => act(() => ch.apply(f))}>Mark as seen</button>
        ) : (
          <>
            <button type="button" className="btn small" disabled={busy} onClick={() => act(() => ch.setStatus(f, "Ignored"))}>Ignore</button>
            <button type="button" className="btn small primary" disabled={busy} onClick={() => act(() => ch.apply(f))}>
              {busy ? "Applying…" : "Apply"}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function ChProblem({ error }: { error: Error }) {
  const code = error instanceof ChError ? error.code : "";
  return (
    <div className="alert red" role="alert">
      <strong>{error.message}</strong>
      {code === "not-configured" && (
        <span>
          In the Azure portal, open the Practice Planner Static Web App, then Settings › Environment variables. Add{" "}
          <span className="mono">CH_API_KEY</span> with your Companies House key, save, and try again.
        </span>
      )}
      {code === "key-rejected" && (
        <span>Check the key in Azure is a REST API key from the Companies House developer hub, with no spaces around it.</span>
      )}
      {code === "unauthorised" && <span>Reload the page to sign in again, then try once more.</span>}
    </div>
  );
}

/** Open Companies House changes, for the bell. */
export function useChAlerts(): { key: string; level: "red" | "amber"; title: string; detail: string }[] {
  const { openFlags } = useCompaniesHouse();
  const idx = useIndex();
  return openFlags.map((f) => ({
    key: f.Key as string,
    level: f.Severity === "red" ? "red" : "amber",
    title: `${idx.clientByKey.get(f.ClientKey as string)?.Title || ""}: ${f.Title}`,
    detail: "Companies House · review in Settings",
  }));
}

