// Ownership chart for a company: drawn from the share ledger, following shareholders that are companies the practice also
// keeps a ledger for. Download as an image (SVG) to drop into a document or send to the client.
import { useMemo, useState } from "react";
import { todayIso } from "../lib/domain";
import { NODE_H, NODE_W, buildChart, chartSvg, labelAt, nodeNote } from "../lib/ownershipChart";
import { owners } from "../lib/cosecShares";
import { readEntry } from "../lib/shareLedger";
import { Row } from "../lib/schema";
import { downloadFile } from "./commsKit";
import { useCoSec } from "./cosecKit";

const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")}%`;
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export function OwnershipChart({ client }: { client: Row }) {
  const k = useCoSec();
  const ck = s(client.Key);
  const [asOf, setAsOf] = useState(todayIso());
  const entries = useMemo(() => k.data.cosecLedger.map(readEntry), [k.data.cosecLedger]);
  const kinds = useMemo(() => new Map(k.data.clients.map((c) => [s(c.Key), s(c.Kind)])), [k.data.clients]);
  const chart = useMemo(() => buildChart({
    subjectKey: ck, subjectName: s(client.Title),
    heldBy: (key) => { const o = owners(entries, k.data.cosecShareClasses, key, asOf); return { owners: o.owners, known: entries.some((e) => e.clientKey === key) }; },
    isCompany: (key) => kinds.get(key) === "Ltd" || kinds.get(key) === "LLP",
  }), [ck, client.Title, entries, k.data.cosecShareClasses, kinds, asOf]);
  const by = new Map(chart.nodes.map((n) => [n.id, n]));
  const download = () => downloadFile(new TextEncoder().encode(chartSvg(chart, s(client.Title), asOf)), `Ownership chart ${s(client.Title)} ${asOf}.svg`, "image/svg+xml");
  const empty = chart.nodes.length < 2;

  return (
    <section className="card pad stack" aria-label="Ownership chart">
      <div className="row-wrap" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Ownership chart</h3>
        <span className="row-wrap" style={{ gap: 10 }}>
          <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}>As at <input className="input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
          <button type="button" className="btn small" disabled={empty} onClick={download}>Download image</button>
        </span>
      </div>
      <p className="muted" style={{ margin: 0 }}>Share ownership worked out from the share ledger, following shareholders that are themselves companies the practice keeps a ledger for. It doesn't show control by other means (appointing directors, influence), which a person has to judge.</p>
      {chart.warnings.map((w) => <p key={w} className="alert amber" role="status" style={{ margin: 0 }}>{w}</p>)}
      {!empty && (
        <div style={{ overflowX: "auto" }}>
          <svg role="img" aria-label={`Ownership of ${s(client.Title)}`} width={chart.width} height={chart.height} viewBox={`0 0 ${chart.width} ${chart.height}`} style={{ display: "block", maxWidth: "none" }}>
            {chart.edges.map((e) => {
              const a = by.get(e.from)!, b = by.get(e.to)!;
              const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y;
              return <line key={`${e.from}>${e.to}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeOpacity={0.45} strokeWidth={1.5} />;
            })}
            {chart.nodes.map((n) => (
              <g key={n.id}>
                <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={6} fill={n.kind === "subject" ? "#1f3a5f" : n.kind === "company" ? "#eef2f7" : "#ffffff"} stroke="#1f3a5f" strokeWidth={1.2} />
                <text x={n.x + NODE_W / 2} y={n.y + 24} textAnchor="middle" fontSize={13} fontWeight={600} fill={n.kind === "subject" ? "#ffffff" : "#111827"}>{clip(n.name, 24)}</text>
                {n.kind !== "subject" && <text x={n.x + NODE_W / 2} y={n.y + 42} textAnchor="middle" fontSize={10} fill="#4b5563">{clip(nodeNote(n), 34)}</text>}
              </g>
            ))}
            {chart.edges.map((e) => {
              const a = by.get(e.from)!, b = by.get(e.to)!;
              const p = labelAt(a.x + NODE_W / 2, a.y + NODE_H, b.x + NODE_W / 2, b.y);
              return <text key={`l${e.from}>${e.to}`} x={p.x} y={p.y} fontSize={11} fill="#374151" stroke="#ffffff" strokeWidth={3} paintOrder="stroke">{pct(e.share)}</text>;
            })}
          </svg>
        </div>
      )}
      {!empty && <p className="muted" style={{ margin: 0, fontSize: 12 }}>Lines show the share of each company held. The percentage in each box is that name's total share of {s(client.Title)}, counting every route through other companies. "25%+" is a prompt to check the PSC register, not a finding.</p>}
    </section>
  );
}
