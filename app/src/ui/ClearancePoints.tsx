// Settings > Clearance points: the list of things the professional clearance letter asks the previous
// accountant for. Each point says whether it is for companies, individuals or both, and which services
// it applies to; a clearance letter only includes the points that fit the client.
import { useMemo, useState } from "react";
import { ItemDef, POINTS_KEY, STANDARD_ITEMS, readPoints } from "../lib/clearance";
import { newKey } from "../lib/planning";
import { useData } from "./data";

export function ClearancePointsSettings() {
  const { data, saveSetting } = useData();
  const saved = useMemo(() => readPoints(data.settings), [data.settings]);
  const custom = data.settings.some((x) => String(x.Key) === POINTS_KEY);
  const [list, setList] = useState<ItemDef[]>(saved);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const services = useMemo(() => data.services.filter((s) => s.Key !== "TASK").sort((a, b) => String(a.Title).localeCompare(String(b.Title))), [data.services]);
  const dirty = JSON.stringify(list) !== JSON.stringify(saved);
  const set = (i: number, p: Partial<ItemDef>) => setList(list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= list.length) return; const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; setList(n); };
  const save = async () => {
    const clean = list.filter((x) => x.label.trim());
    setBusy(true); setMsg("");
    try { await saveSetting(POINTS_KEY, clean); setList(clean); setMsg("Saved. New clearance letters use this list."); } catch { setMsg("That didn't save. Try again."); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <section className="card pad stack" aria-labelledby="cp-h">
        <h2 id="cp-h" style={{ margin: 0 }}>Professional clearance points</h2>
        <p className="muted" style={{ margin: 0 }}>What the clearance letter asks the previous accountant for. A point with no services ticked is asked for every client of that type; with services ticked, only for clients who have one of them. Letters already started keep the points they were made with.{!custom && " You are using the standard list until you save your own."}</p>
        <div className="table-wrap"><table className="grid" style={{ minWidth: 640 }}>
          <thead><tr><th scope="col">Point</th><th scope="col">For</th><th scope="col">Applies to services</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{list.map((p, i) => (
            <tr key={p.key + i}>
              <td><input className="input" aria-label={`Point ${i + 1}`} value={p.label} onChange={(e) => set(i, { label: e.target.value })} style={{ width: "100%", minWidth: 260 }} /></td>
              <td><select className="input" aria-label={`Point ${i + 1} is for`} value={p.for} onChange={(e) => set(i, { for: e.target.value as ItemDef["for"] })}><option value="all">Everyone</option><option value="company">Companies</option><option value="individual">Individuals</option></select></td>
              <td>
                <details><summary>{p.services?.length ? `${p.services.length} service${p.services.length === 1 ? "" : "s"}` : "All clients"}</summary>
                  <div className="stack" style={{ gap: 2, maxHeight: 180, overflow: "auto" }}>
                    {services.map((s) => (
                      <label key={String(s.Key)} className="row" style={{ gap: 6 }}><input type="checkbox" checked={!!p.services?.includes(String(s.Key))} onChange={(e) => set(i, { services: e.target.checked ? [...(p.services || []), String(s.Key)] : (p.services || []).filter((k) => k !== String(s.Key)) })} /> {String(s.Title)}</label>
                    ))}
                  </div>
                </details>
              </td>
              <td><button type="button" className="linkbtn" aria-label={`Move point ${i + 1} up`} onClick={() => move(i, -1)}>Up</button>{" "}<button type="button" className="linkbtn" aria-label={`Move point ${i + 1} down`} onClick={() => move(i, 1)}>Down</button>{" "}<button type="button" className="linkbtn" onClick={() => setList(list.filter((_, j) => j !== i))}>Remove</button></td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="row-wrap" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={() => setList([...list, { key: newKey("CP"), label: "", for: "all", services: [] }])}>Add a point</button>
          <button type="button" className="btn primary" disabled={busy || !dirty} onClick={save}>{busy ? "Saving…" : "Save points"}</button>
          {custom && <button type="button" className="linkbtn" onClick={() => setList(STANDARD_ITEMS)}>Go back to the standard list</button>}
          {dirty && <button type="button" className="linkbtn" onClick={() => setList(saved)}>Discard changes</button>}
          <span role="status" className="muted">{msg}</span>
        </div>
      </section>
    </div>
  );
}
