// Backups in the app: a copy of every list goes to your OneDrive automatically the first time
// you open the planner each day (your data only changes when you use it), and whenever you
// press Export now. You can also download a copy straight to this device.
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BACKUP_FOLDER, BackupFailure, BackupRecord, backupDue, backupName, buildBackup, uploadBackup } from "../lib/backup";
import { fmtDate } from "../lib/domain";
import { LISTS, ListKey, Row } from "../lib/schema";
import { friendlyError } from "../lib/sharepoint";
import { XLSX_TYPE } from "../lib/xlsx";
import { readSetting, useData } from "./data";

type State = { running: boolean; step?: string; error?: string; justDone?: boolean };
type Ctx = {
  state: State;
  last?: BackupRecord;
  failed?: BackupFailure;
  run: (auto?: boolean) => Promise<void>;
  download: () => Promise<void>;
};

const BackupCtx = createContext<Ctx | null>(null);
const STALE_DAYS = 3;

export function BackupProvider({ children }: { children: ReactNode }) {
  const ctx = useData();
  const latest = useRef(ctx);
  latest.current = ctx;
  const [state, setState] = useState<State>({ running: false });
  const running = useRef(false);
  const autoTried = useRef(false);
  const last = readSetting<BackupRecord>(ctx.data.settings, "backup.last");
  const failedRec = readSetting<BackupFailure>(ctx.data.settings, "backup.failed");
  const failed = failedRec && (!last || failedRec.at > last.at) ? failedRec : undefined;

  /** Every list, read fresh from SharePoint so the copy matches what's stored. */
  const readEverything = useCallback(async () => {
    const out: Partial<Record<ListKey, Row[]>> = {};
    for (const l of LISTS) {
      setState((s) => ({ ...s, step: `Reading ${l.displayName.replace(/^PP /, "")}…` }));
      out[l.key] = latest.current.store.hasList(l.key) ? await latest.current.store.readAll(l.key) : [];
    }
    return out;
  }, []);

  const run = useCallback(async (auto = false) => {
    if (running.current) return;
    running.current = true;
    setState({ running: true, step: "Starting…" });
    try {
      const now = new Date();
      const data = await readEverything();
      setState((s) => ({ ...s, step: "Making the Excel file…" }));
      const { bytes, rows } = await buildBackup(data, now);
      setState((s) => ({ ...s, step: "Saving to OneDrive…" }));
      const name = backupName(now);
      const up = await uploadBackup(latest.current.store.graph, bytes, name);
      await latest.current.saveSetting("backup.last", {
        at: new Date().toISOString(), name, webUrl: up.webUrl, folderUrl: up.folderUrl, size: up.size, rows, auto,
      } satisfies BackupRecord);
      setState({ running: false, justDone: true });
    } catch (e) {
      const message = friendlyError(e);
      setState({ running: false, error: message });
      try {
        await latest.current.saveSetting("backup.failed", { at: new Date().toISOString(), message } satisfies BackupFailure);
      } catch {
        /* shown on screen anyway */
      }
    } finally {
      running.current = false;
    }
  }, [readEverything]);

  // the daily copy, the first time the planner opens after 20 hours
  useEffect(() => {
    if (ctx.status !== "ready" || autoTried.current) return;
    autoTried.current = true;
    if (backupDue(readSetting<BackupRecord>(ctx.data.settings, "backup.last"), new Date())) {
      window.setTimeout(() => run(true), 4000); // let the planner finish opening first
    }
  }, [ctx.status, ctx.data.settings, run]);

  const download = useCallback(async () => {
    setState({ running: true, step: "Starting…" });
    try {
      const now = new Date();
      const { bytes } = await buildBackup(await readEverything(), now);
      const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: XLSX_TYPE }));
      const a = document.createElement("a");
      a.href = url;
      a.download = backupName(now);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
      setState({ running: false });
    } catch (e) {
      setState({ running: false, error: friendlyError(e) });
    }
  }, [readEverything]);

  const value = useMemo(() => ({ state, last, failed, run, download }), [state, last, failed, run, download]);
  return <BackupCtx.Provider value={value}>{children}</BackupCtx.Provider>;
}

export function useBackup(): Ctx {
  const c = useContext(BackupCtx);
  if (!c) throw new Error("useBackup must be inside BackupProvider");
  return c;
}

/** For the bell: the last backup failed, or none for a few days. */
export function useBackupAlert(): { level: "red" | "amber"; title: string; detail: string } | null {
  const { last, failed, state } = useBackup();
  if (state.running) return null;
  if (failed) return { level: "red", title: "Backup to OneDrive didn't work", detail: failed.message };
  if (!last) return null; // the first one runs shortly after opening
  const days = (Date.now() - Date.parse(last.at)) / 86400000;
  if (days > STALE_DAYS) return { level: "amber", title: "No backup for a few days", detail: `Last one ${fmtDate(last.at.slice(0, 10))}` };
  return null;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })} at ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};
const size = (b?: number) => (!b ? "" : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function BackupSettings() {
  const { state, last, failed, run, download } = useBackup();
  return (
    <section className="card pad stack" aria-labelledby="bk-h" style={{ maxWidth: 720 }}>
      <div className="card-title-row">
        <h2 id="bk-h">Backups</h2>
        <div className="row-wrap">
          <button type="button" className="btn" onClick={download} disabled={state.running}>Download a copy</button>
          <button type="button" className="btn primary" onClick={() => run(false)} disabled={state.running}>
            {state.running ? "Working…" : "Export now"}
          </button>
        </div>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        A copy of every list, as one Excel file with a sheet per list, goes to the <strong>{BACKUP_FOLDER}</strong> folder in your
        OneDrive. It happens by itself the first time you open the planner each day, so there's a copy from every day you've made
        changes. Your live data stays in SharePoint, which also keeps a version history of every record.
      </p>
      {state.running && <p role="status" style={{ margin: 0, fontSize: 14 }}>{state.step}</p>}
      {!state.running && (
        <div role="status" className="stack" style={{ gap: 4, fontSize: 14 }}>
          {last ? (
            <>
              <span>
                Last backup <strong>{when(last.at)}</strong>{last.auto ? " (automatic)" : ""}
                {state.justDone ? " · just now" : ""}
              </span>
              <span className="muted" style={{ fontSize: 13 }}>
                {last.name}{last.size ? ` · ${size(last.size)}` : ""}{last.rows ? ` · ${last.rows.toLocaleString("en-GB")} rows` : ""}
              </span>
              <span className="row-wrap" style={{ gap: 16 }}>
                {last.webUrl && <a href={last.webUrl} target="_blank" rel="noreferrer">Open the file</a>}
                {last.folderUrl && <a href={last.folderUrl} target="_blank" rel="noreferrer">Open the backups folder</a>}
              </span>
            </>
          ) : (
            <span>No backup yet.</span>
          )}
        </div>
      )}
      {(state.error || failed) && !state.running && (
        <div className="alert red" role="alert">
          <strong>The last backup didn't work</strong>
          <span>{state.error || failed?.message} Try Export now; if it keeps failing, Download a copy in the meantime.</span>
        </div>
      )}
    </section>
  );
}
