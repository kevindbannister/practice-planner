// An ownership chart for a company, drawn from the share ledger: who holds the shares, and who holds the shareholders when
// they are companies the practice also keeps a ledger for. Everything is derived from the ledger (percentages are worked out,
// never typed in). It shows share ownership only: control by other means (appointing directors, influence) isn't in the ledger
// and has to be judged by a person.
import type { Owner } from "./cosecShares";

export type Held = { owners: Owner[]; /** true when there is a ledger for this company */ known: boolean };
export type ChartInput = {
  subjectKey: string;
  subjectName: string;
  /** Holders of a company the practice keeps a ledger for. For anything else, known is false. */
  heldBy: (clientKey: string) => Held;
  /** Whether a holder's client key is a company (Ltd or LLP). */
  isCompany: (clientKey: string) => boolean;
  maxDepth?: number;
  maxNodes?: number;
};

export type ChartNode = {
  id: string; name: string; kind: "subject" | "company" | "person";
  clientKey: string;
  /** Share of the subject company owned, counting every route through other companies. */
  effective: number;
  /** Rows up from the subject: 0 is the subject. */
  level: number;
  /** A company with no ledger recorded, so its own owners aren't known. */
  open: boolean;
  /** Over 25% of the subject's shares, directly or through companies: an indicator for the PSC check, not a finding. */
  over25: boolean;
  x: number; y: number;
};
export type ChartEdge = { from: string; to: string; share: number; votes: number };
export type Chart = { nodes: ChartNode[]; edges: ChartEdge[]; width: number; height: number; warnings: string[] };

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, "")}%`;
export const nodeNote = (n: ChartNode) => `${pct(n.effective)} overall${n.open ? " · owners not recorded" : ""}${n.over25 ? " · 25%+" : ""}`;
export const NODE_W = 176, NODE_H = 58, GAP_X = 28, GAP_Y = 84, PAD = 20;
const CORPORATE = /\b(ltd|limited|llp|plc|inc|llc|gmbh|trust|holdings)\b\.?$/i;
const lower = (s: string) => s.trim().toLowerCase();

export function buildChart(inp: ChartInput): Chart {
  const maxDepth = inp.maxDepth ?? 4, maxNodes = inp.maxNodes ?? 60;
  const warnings: string[] = [];
  const nodes = new Map<string, ChartNode>();
  const edges: ChartEdge[] = [];
  const subjectId = `k:${inp.subjectKey}`;
  nodes.set(subjectId, { id: subjectId, name: inp.subjectName, kind: "subject", clientKey: inp.subjectKey, effective: 100, level: 0, open: false, over25: false, x: 0, y: 0 });

  // depth-first from the subject upwards, carrying the share of the subject owned by whoever is reached (product along the way)
  const walk = (key: string, mult: number, level: number, path: string[]) => {
    const h = inp.heldBy(key);
    for (const o of h.owners) {
      const company = o.key ? inp.isCompany(o.key) : CORPORATE.test(o.name);
      const id = o.key ? `k:${o.key}` : `n:${lower(o.name)}`;
      if (path.includes(id)) { warnings.push(`${o.name} owns a company that owns it back, so the loop was cut there.`); continue; }
      if (!nodes.has(id) && nodes.size >= maxNodes) { if (!warnings.some((w) => w.startsWith("The chart is large"))) warnings.push(`The chart is large, so it stops at ${maxNodes} names.`); continue; }
      const eff = (mult * o.sharePercent) / 100;
      const node = nodes.get(id) || { id, name: o.name, kind: (company ? "company" : "person") as ChartNode["kind"], clientKey: o.key, effective: 0, level, open: false, over25: false, x: 0, y: 0 };
      node.effective += eff;
      node.level = Math.max(node.level, level);
      nodes.set(id, node);
      const parent = path.length ? path[path.length - 1] : subjectId;
      if (!edges.some((e) => e.from === id && e.to === parent)) edges.push({ from: id, to: parent, share: o.sharePercent, votes: o.votePercent });
      if (company) {
        const up = o.key ? inp.heldBy(o.key) : { owners: [], known: false };
        if (!up.known || !up.owners.length) node.open = true;
        else if (level >= maxDepth) { node.open = true; warnings.push(`Stopped at ${o.name}: the chart follows ${maxDepth} layers of ownership.`); }
        else walk(o.key, eff, level + 1, [...path, id]);
      }
    }
  };
  const subj = inp.heldBy(inp.subjectKey);
  if (!subj.owners.length) return { nodes: [nodes.get(subjectId)!], edges: [], width: NODE_W + PAD * 2, height: NODE_H + PAD * 2, warnings: ["Nothing on the share ledger yet, so there is nothing to draw."] };
  walk(inp.subjectKey, 100, 1, [subjectId]);

  const list = [...nodes.values()];
  for (const n of list) { n.effective = Math.round(n.effective * 100) / 100; n.over25 = n.kind === "person" && n.effective > 25; }

  // rows: the subject at the bottom, owners above; within a row the biggest owners come first, then rows are centred
  const top = Math.max(...list.map((n) => n.level));
  const rows: ChartNode[][] = Array.from({ length: top + 1 }, () => []);
  for (const n of list) rows[n.level].push(n);
  for (const r of rows) r.sort((a, b) => b.effective - a.effective || a.name.localeCompare(b.name));
  const widest = Math.max(...rows.map((r) => r.length));
  const width = PAD * 2 + widest * NODE_W + (widest - 1) * GAP_X;
  rows.forEach((r, i) => {
    const w = r.length * NODE_W + (r.length - 1) * GAP_X;
    r.forEach((n, j) => { n.x = Math.round((width - w) / 2 + j * (NODE_W + GAP_X)); n.y = PAD + (top - i) * (NODE_H + GAP_Y); });
  });
  return { nodes: list, edges, width, height: PAD * 2 + (top + 1) * NODE_H + top * GAP_Y, warnings: [...new Set(warnings)] };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** Where a line's label sits: near the owner's end, so it isn't hidden behind boxes in between. */
export const labelAt = (x1: number, y1: number, x2: number, y2: number) => ({ x: x1 + (x2 - x1) * 0.2 + 5, y: y1 + (y2 - y1) * 0.2 + 4 });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The chart as a standalone SVG (for the download). The screen draws the same shapes. */
export function chartSvg(c: Chart, title: string, asOf: string): string {
  const by = new Map(c.nodes.map((n) => [n.id, n]));
  const lines = c.edges.map((e) => {
    const a = by.get(e.from)!, b = by.get(e.to)!;
    const x1 = a.x + NODE_W / 2, y1 = a.y + NODE_H, x2 = b.x + NODE_W / 2, y2 = b.y;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#6b7280" stroke-width="1.5"/>`;
  }).join("");
  const labels = c.edges.map((e) => {
    const a = by.get(e.from)!, b = by.get(e.to)!;
    const p = labelAt(a.x + NODE_W / 2, a.y + NODE_H, b.x + NODE_W / 2, b.y);
    return `<text x="${p.x}" y="${p.y}" font-size="11" fill="#374151" stroke="#fff" stroke-width="3" paint-order="stroke">${pct(e.share)}</text>`;
  }).join("");
  const boxes = c.nodes.map((n) => {
    const fill = n.kind === "subject" ? "#1f3a5f" : n.kind === "company" ? "#eef2f7" : "#fff";
    const ink = n.kind === "subject" ? "#fff" : "#111827";
    const sub = n.kind === "subject" ? "" : nodeNote(n);
    return `<g><rect x="${n.x}" y="${n.y}" width="${NODE_W}" height="${NODE_H}" rx="6" fill="${fill}" stroke="#1f3a5f" stroke-width="1.2"/><text x="${n.x + NODE_W / 2}" y="${n.y + 24}" text-anchor="middle" font-size="13" font-weight="600" fill="${ink}">${esc(clip(n.name, 24))}</text>${sub ? `<text x="${n.x + NODE_W / 2}" y="${n.y + 42}" text-anchor="middle" font-size="10" fill="#4b5563">${esc(clip(sub, 34))}</text>` : ""}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height + 24}" viewBox="0 0 ${c.width} ${c.height + 24}" font-family="Arial, Helvetica, sans-serif"><rect width="100%" height="100%" fill="#fff"/><text x="${PAD}" y="16" font-size="12" fill="#374151">${esc(title)}: share ownership as at ${esc(asOf)}</text><g transform="translate(0,24)">${lines}${boxes}${labels}</g></svg>`;
}
