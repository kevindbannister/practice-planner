// Settings › Detailed P&L: the order of the headings on the detailed profit and loss account (cost of sales, employee costs, premises...)
// and of every IRIS line under each heading. Drag a row (or use the arrows) to move it; the accounts and the deck follow, in any open tab.
import { useState } from "react";
import { DetailOrder, detailLines } from "../lib/accounts";
import { moveItem } from "../lib/stages";
import { Icon } from "./bits";
import { readSetting, useData } from "./data";
import { useChart } from "./PaperSchedules";

type Row = { id: string; label: string };

/** A list whose rows can be dragged up and down (or moved with the arrows, for keyboard use). */
function DragList({ rows, busy, onMove, name }: { rows: Row[]; busy: boolean; onMove: (from: number, to: number) => void; name: string }) {
  const [from, setFrom] = useState<number>();
  const [over, setOver] = useState<number>();
  return (
    <ol className="dpl-order" style={{ margin: 0, paddingLeft: 20 }}>
      {rows.map((r, i) => (
        <li
          key={r.id}
          draggable={!busy}
          onDragStart={(e) => { setFrom(i); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", r.id); } catch { /* fine */ } }}
          onDragOver={(e) => { if (from !== undefined) { e.preventDefault(); setOver(i); } }}
          onDrop={(e) => { e.preventDefault(); if (from !== undefined && from !== i) onMove(from, i); setFrom(undefined); setOver(undefined); }}
          onDragEnd={() => { setFrom(undefined); setOver(undefined); }}
          style={{ padding: "4px 0", cursor: busy ? "default" : "grab", borderTop: over === i && from !== undefined && from !== i ? "2px solid var(--accent, #2563eb)" : "2px solid transparent", opacity: from === i ? 0.5 : 1 }}
        >
          <span className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
            <span aria-hidden="true" className="muted" style={{ cursor: "grab" }}>⠿</span>
            <span style={{ minWidth: 260 }}>{r.label}</span>
            <button type="button" className="iconbtn" aria-label={`Move ${r.label} up in ${name}`} disabled={i === 0 || busy} onClick={() => onMove(i, i - 1)}><Icon name="up" size={14} /></button>
            <button type="button" className="iconbtn" aria-label={`Move ${r.label} down in ${name}`} disabled={i === rows.length - 1 || busy} onClick={() => onMove(i, i + 1)}><Icon name="down" size={14} /></button>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function DetailedPlSettings() {
  const { data, saveSetting } = useData();
  const chart = useChart();
  const saved = readSetting<DetailOrder>(data.settings, "detailedPl");
  const lines = detailLines(chart, saved);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const busy = state === "saving";

  const write = async (next: DetailOrder) => {
    setState("saving");
    try {
      await saveSetting("detailedPl", next);
      setState("saved");
    } catch {
      setState("error");
    }
  };
  const moveLine = (from: number, to: number) => void write({ ...saved, lines: moveItem(lines, from, to).map((l) => l.code) });

  return (
    <section className="card pad stack" aria-labelledby="dpl-h" style={{ maxWidth: 680 }}>
      <h2 id="dpl-h">Detailed profit and loss</h2>
      <p className="muted tip" style={{ margin: 0, fontSize: 13 }}>
        Every IRIS line, in IRIS number order. Drag a line up or down to change where it shows on the detailed profit and loss account (in the accounts, the client deck and
        the PDF). Turnover, cost of sales and administrative expenses stay in their own parts; the order only changes inside each part. A line only shows when the client has a figure on it.
        The accounts update by themselves when you save a change here, even if they are open in another tab.
      </p>
      <DragList name="the detailed profit and loss" busy={busy} rows={lines.map((l) => ({ id: l.code, label: `${l.code} ${l.name}` }))} onMove={moveLine} />
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn small" disabled={busy} onClick={() => void write({ lines: undefined, items: "name" })}>Lines A to Z</button>
        
        <button type="button" className="btn small" disabled={!saved || busy} onClick={() => void write({})}>Put back IRIS number order</button>
        <span className="muted" aria-live="polite" style={{ fontSize: 12 }}>{state === "saving" ? "Saving…" : state === "saved" ? "Saved." : state === "error" ? "That didn't save. Try again." : ""}</span>
      </div>
    </section>
  );
}
