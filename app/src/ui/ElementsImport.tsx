// Load Elements links for your clients from the Elements client list (a CSV with Name and
// Elements Link). Each row is matched to a client by name; you check the matches, fix any, and
// save. The file is read in your browser and only the links are saved, to the client records.
import { useMemo, useRef, useState } from "react";
import { ElementsMatch, matchElements, readElementsCsv } from "../lib/elements";
import { useData } from "./data";
import { Icon } from "./bits";

export function ElementsImport() {
  const { data, updateMany } = useData();
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<ElementsMatch[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number>();
  const input = useRef<HTMLInputElement>(null);
  const clients = useMemo(() => [...data.clients].sort((a, b) => a.Title.localeCompare(b.Title)), [data.clients]);
  const byKey = useMemo(() => new Map(data.clients.map((c) => [c.Key, c])), [data.clients]);

  const close = () => {
    setOpen(false);
    setMatches([]);
    setError(undefined);
    setSaved(undefined);
  };
  const read = async (file?: File) => {
    if (!file) return;
    const { rows, error: err } = readElementsCsv(await file.text());
    if (err || !rows.length) return setError(err || "There are no clients in that file.");
    setError(undefined);
    setMatches(matchElements(rows, data.clients));
    if (input.current) input.current.value = "";
  };
  const choose = (i: number, clientKey: string) => setMatches((m) => m.map((x, n) => (n === i ? { ...x, clientKey, how: clientKey ? "name" : "none" } : x)));

  // one link per client: if two rows point at the same client, the later one is held back
  const chosenTwice = new Set<string>();
  const seen = new Set<string>();
  for (const m of matches) {
    if (!m.clientKey) continue;
    if (seen.has(m.clientKey)) chosenTwice.add(m.clientKey);
    seen.add(m.clientKey);
  }
  const todo = matches.filter((m) => m.clientKey && !chosenTwice.has(m.clientKey) && byKey.get(m.clientKey)?.ElementsLink !== m.row.link);

  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await updateMany("Clients", todo.map((m) => ({ row: byKey.get(m.clientKey)!, patch: { ElementsLink: m.row.link } })));
      setSaved(todo.length);
      setMatches([]);
    } catch {
      setError("Couldn't save the links. Nothing has been lost; try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}><Icon name="download" />Elements links</button>
      {open && (
        <div className="search-wrap" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Import Elements links" style={{ maxWidth: 760, maxHeight: "86vh", overflow: "auto", padding: 18 }}>
            <div className="row-wrap" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>Elements links</h2>
              <button type="button" className="linkbtn" onClick={close}>Close</button>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              Choose the client list you exported from Elements (a CSV with Name and Elements Link). I'll match each row to a client by name, and you can
              fix any before saving. Only the links are saved, on the client records, and they show on all that client's jobs.
            </p>
            {saved !== undefined ? (
              <div className="alert" style={{ borderColor: "var(--green)", background: "var(--green-soft)", color: "var(--green)" }}>
                <strong>{saved} link{saved === 1 ? "" : "s"} saved</strong>
              </div>
            ) : !matches.length ? (
              <div className="stack">
                <input ref={input} type="file" accept=".csv,text/csv" aria-label="Choose the Elements client list" onChange={(e) => void read(e.target.files?.[0])} />
              </div>
            ) : (
              <>
                <p style={{ margin: "0 0 8px", fontSize: 13 }}>
                  <strong>{todo.length}</strong> to save · {matches.filter((m) => !m.clientKey).length} not matched (left alone unless you pick a client).
                </p>
                <div className="table-wrap">
                  <table className="grid" style={{ minWidth: 560 }}>
                    <thead><tr><th scope="col">In Elements</th><th scope="col">Your client</th><th scope="col">Note</th></tr></thead>
                    <tbody>
                      {matches.map((m, i) => (
                        <tr key={i}>
                          <td>{m.row.name}</td>
                          <td>
                            <select className="input" aria-label={`Client for ${m.row.name}`} value={m.clientKey} onChange={(e) => choose(i, e.target.value)}>
                              <option value="">Don't import</option>
                              {clients.map((c) => <option key={c.Key} value={c.Key}>{c.Title}</option>)}
                            </select>
                          </td>
                          <td className="muted" style={{ fontSize: 12 }}>
                            {[m.how === "person" ? "Matched on first and last name" : "", m.clientKey && chosenTwice.has(m.clientKey) ? "Two rows for this client: pick one" : "", m.note].filter(Boolean).join(" · ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="form-actions" style={{ marginTop: 12 }}>
                  <button type="button" className="btn" onClick={() => setMatches([])} disabled={busy}>Choose another file</button>
                  <button type="button" className="btn primary" onClick={save} disabled={busy || !todo.length}>{busy ? "Saving…" : `Save ${todo.length} link${todo.length === 1 ? "" : "s"}`}</button>
                </div>
              </>
            )}
            {error && <p className="error-text" role="alert">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
