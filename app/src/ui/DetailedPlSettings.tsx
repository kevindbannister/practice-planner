// Settings › Detailed P&L: the order of the headings on the detailed profit and loss account (cost of sales, employee costs, premises...)
// and of every IRIS line under each heading. Drag a row (or use the arrows) to move it; the accounts and the deck follow, in any open tab.
import { useState } from "react";
import { DETAIL_HEADINGS, DetailOrder, detailLines, headingOrder } from "../lib/accounts";
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
  const order = headingOrder(saved?.groups);
  const lines = detailLines(chart, saved);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const title = (k: string) => DETAIL_HEADINGS.find((h) => h.key === k)?.title || k;
  const bucket = (k: string) => DETAIL_HEADINGS.find((h) => h.key === k)?.bucket || "";
  const BUCKETS: [string, string][] = [["income", "Turnover"], ["costs", "Cost of sales"], ["expenses", "Administrative expenses"], ["other", "Other income"], ["tax", "Tax"]];
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
  const moveHeading = (b: string, from: number, to: number) => {
    const same = order.filter((x) => bucket(x) === b);
    const swapped = moveItem(same, from, to);
    let n = 0;
    void write({ ...saved, groups: order.map((x) => (bucket(x) === b ? swapped[n++] : x)), lines: lines.map((l) => l.code) });
  };
  /** Move one IRIS line among the lines of its own heading; the lines of other headings keep their places. */
  const moveLine = (heading: string, from: number, to: number) => {
    const same = lines.filter((l) => l.heading === heading);
    const swapped = moveItem(same, from, to);
    let n = 0;
    void write({ ...saved, lines: lines.map((l) => (l.heading === heading ? swapped[n++] : l)).map((l) => l.code) });
  };

  return (
    <section className="card pad stack" aria-labelledby="dpl-h" style={{ maxWidth: 680 }}>
      <h2 id="dpl-h">Detailed profit and loss</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Drag a heading or an IRIS line up or down to change the order it shows in on the detailed profit and loss account (in the accounts, the client deck and
        the PDF). The parts of the account (turnover, cost of sales, administrative expenses) stay where they are. A line only shows when the client has a figure on it.
        The accounts update by themselves when you save a change here, even if they are open in another tab.
      </p>
      <h3 style={{ margin: 0, fontSize: 14 }}>Headings</h3>
      {BUCKETS.map(([b, label]) => {
        const list = order.filter((k) => bucket(k) === b);
        if (list.length < 2) return null;
        return (
          <div key={b} className="stack" style={{ gap: 6 }}>
            <strong style={{ fontSize: 13 }}>{label}</strong>
            <DragList name={label} busy={busy} rows={list.map((k) => ({ id: k, label: title(k) }))} onMove={(f, t) => moveHeading(b, f, t)} />
          </div>
        );
      })}
      <h3 style={{ margin: 0, fontSize: 14 }}>IRIS lines under each heading</h3>
      {order.map((k) => {
        const own = lines.filter((l) => l.heading === k);
        if (!own.length) return null;
        return (
          <details key={k}>
            <summary style={{ cursor: "pointer", padding: "4px 0" }}>{title(k)} <span className="muted" style={{ fontSize: 12 }}>({own.length} {own.length === 1 ? "line" : "lines"})</span></summary>
            <DragList name={title(k)} busy={busy} rows={own.map((l) => ({ id: l.code, label: `${l.code} ${l.name}` }))} onMove={(f, t) => moveLine(k, f, t)} />
          </details>
        );
      })}
      <div className="row-wrap" style={{ gap: 8 }}>
        <button type="button" className="btn small" disabled={busy} onClick={() => void write({ ...saved, lines: undefined, items: "name" })}>Lines A to Z</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => void write({ ...saved, lines: undefined, items: "iris" })}>Lines by IRIS code</button>
        <button type="button" className="btn small" disabled={!saved || busy} onClick={() => void write({})}>Put back the standard order</button>
        <span className="muted" aria-live="polite" style={{ fontSize: 12 }}>{state === "saving" ? "Saving…" : state === "saved" ? "Saved." : state === "error" ? "That didn't save. Try again." : ""}</span>
      </div>
    </section>
  );
}
