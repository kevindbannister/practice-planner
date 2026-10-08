// First-run setup: create the SharePoint lists, then load the Engager import bundle.
import { useEffect, useState } from "react";
import { ImportStep, parseBundle, runImport } from "../lib/importer";
import { LIST_BY_KEY } from "../lib/schema";
import { SchemaStatus, friendlyError } from "../lib/sharepoint";
import { useData } from "./data";

export function SetupPage() {
  const { store, data, reload } = useData();
  const [schema, setSchema] = useState<SchemaStatus[]>();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [steps, setSteps] = useState<ImportStep[]>([]);
  const [progress, setProgress] = useState<{ list: string; pct: number }>();

  const check = async () => {
    try {
      setSchema(await store.checkSchema());
    } catch (e) {
      setError(friendlyError(e));
    }
  };
  useEffect(() => {
    check();
  }, []);

  const listsReady = schema?.every((s) => s.exists && !s.missingColumns.length);
  const toCreate = schema?.filter((s) => !s.exists).length || 0;
  const toFix = schema?.filter((s) => s.exists && s.missingColumns.length).length || 0;

  const createLists = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await store.ensureSchema((msg) => setLog((l) => [...l, msg]));
      await check();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    setBusy(true);
    setError(undefined);
    setSteps([]);
    try {
      const bundle = parseBundle(await file.text());
      const done = await runImport(store, bundle, (step, pct) => {
        setProgress({ list: LIST_BY_KEY[step.list].displayName, pct: pct ?? 0 });
        if (pct === 1) setSteps((s) => [...s.filter((x) => x.list !== step.list), { ...step }]);
      });
      setProgress(undefined);
      if (done.some((s) => s.failed)) {
        setError("Some rows didn't load (listed below). Running the import again will retry just those.");
      }
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const loaded = steps.length > 0 && steps.every((s) => !s.failed);

  return (
    <div className="center">
      <div className="panel">
        <span className="eyebrow">Setup</span>
        <h1>Get Practice Planner ready</h1>
        <p className="muted" style={{ margin: 0 }}>
          Two steps, both safe to run again: nothing already there is changed or duplicated.
        </p>

        <section className="stack" aria-labelledby="s1">
          <h2 id="s1" style={{ margin: 0, fontSize: 16 }}>1. Create the lists in SharePoint</h2>
          {!schema ? (
            <p className="muted">Checking the Practice Planner site…</p>
          ) : listsReady ? (
            <p style={{ margin: 0, color: "var(--green)", fontWeight: 600 }}>All {schema.length} lists are ready.</p>
          ) : (
            <>
              <p style={{ margin: 0 }}>
                {toCreate ? `${toCreate} list${toCreate > 1 ? "s" : ""} to create` : ""}
                {toCreate && toFix ? " and " : ""}
                {toFix ? `${toFix} to update` : ""} on the Practice Planner site.
              </p>
              <div>
                <button type="button" className="btn primary" onClick={createLists} disabled={busy}>
                  {busy ? "Creating…" : "Create the lists"}
                </button>
              </div>
            </>
          )}
          {log.length > 0 && !listsReady && (
            <ul className="steps">{log.slice(-4).map((l, i) => <li key={i}>{l}</li>)}</ul>
          )}
        </section>

        <section className="stack" aria-labelledby="s2" style={{ opacity: listsReady ? 1 : 0.5 }}>
          <h2 id="s2" style={{ margin: 0, fontSize: 16 }}>2. Load your Engager data</h2>
          <p style={{ margin: 0 }}>
            Choose the import file (<span className="mono">practice-planner-import.json</span>). It takes a minute or two.
          </p>
          <label className="btn" style={{ alignSelf: "flex-start" }} aria-disabled={!listsReady || busy}>
            {busy && listsReady ? "Loading…" : "Choose import file"}
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              disabled={!listsReady || busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) importFile(f);
              }}
            />
          </label>
          {progress && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: 13 }}>Loading {progress.list}…</span>
              <div className="progress" role="progressbar" aria-valuenow={Math.round(progress.pct * 100)} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${Math.round(progress.pct * 100)}%` }} />
              </div>
            </div>
          )}
          {steps.length > 0 && (
            <ul className="steps">
              {steps.map((s) => (
                <li key={s.list}>
                  <span>{LIST_BY_KEY[s.list].displayName}</span>
                  <span className={s.failed ? "error-text" : "muted"}>
                    {s.created} added{s.skipped ? `, ${s.skipped} already there` : ""}
                    {s.failed ? `, ${s.failed} failed` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <p className="error-text" role="alert">{error}</p>}

        <div className="row-wrap" style={{ justifyContent: "flex-end" }}>
          {(loaded || data.clients.length > 0) && (
            <button
              type="button"
              className="btn primary"
              onClick={async () => {
                await reload();
                window.location.hash = "/clients";
              }}
            >
              Open Practice Planner
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
