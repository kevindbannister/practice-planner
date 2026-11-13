// Development Hub: the interactive feature map. Drawn from the live inventory, so a status changed anywhere in the Hub shows here
// straight away. Pan by dragging, zoom with the wheel or buttons, click a feature for its details, click the circle to open or close a branch.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Node, PRIORITIES, PRIORITY_LABEL, Priority, STATUSES, Status, buildTree, leafFeatures, rollup } from "../lib/devHub";
import { FeatureDetail, STATUS_COLOR, useHub } from "./devHubKit";

const W = 214, H = 30, GX = 270, GY = 36;

interface Placed { id: string; name: string; kind: Node["kind"] | "root"; x: number; y: number; status: Status | null; kids: number; open: boolean; parent?: string; leaf: boolean }

export function FeatureMap({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const hub = useHub();
  const tree = useMemo(() => buildTree(hub.features), [hub.features]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(["root", ...tree.map((t) => t.f.id)]));
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status | "">("");
  const [prio, setPrio] = useState<Priority | "">("");
  const [blocked, setBlocked] = useState(false);
  const [t, setT] = useState({ x: 20, y: 20, k: 1 });
  const [fitTick, setFitTick] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);

  const filtering = !!(q.trim() || status || prio);
  // which leaves satisfy the filters, and the groups above them
  const { match, path } = useMemo(() => {
    const match = new Set<string>(), path = new Set<string>();
    const ql = q.trim().toLowerCase();
    const walk = (n: Node, chain: string[]) => {
      const leaf = !n.children.length;
      const textHit = !ql || `${n.f.name} ${n.f.desc} ${n.f.id}`.toLowerCase().includes(ql);
      const ok = leaf ? textHit && (!status || n.f.status === status) && (!prio || n.f.priority === prio) : !!ql && !status && !prio && textHit;
      if (filtering && ok) { match.add(n.f.id); chain.forEach((c) => path.add(c)); }
      n.children.forEach((c) => walk(c, [...chain, n.f.id]));
    };
    tree.forEach((r) => walk(r, ["root"]));
    return { match, path };
  }, [tree, q, status, prio, filtering]);
  const hot = useMemo(() => {
    const set = new Set<string>();
    if (!blocked) return set;
    const walk = (n: Node, chain: string[]) => {
      if (!n.children.length && (n.f.status === "Blocked" || n.f.status === "Broken")) { set.add(n.f.id); chain.forEach((c) => set.add(c)); }
      n.children.forEach((c) => walk(c, [...chain, n.f.id]));
    };
    tree.forEach((r) => walk(r, ["root"]));
    return set;
  }, [tree, blocked]);

  const placed = useMemo(() => {
    const out: Placed[] = [];
    let row = 0;
    const isOpen = (id: string) => open.has(id) || (filtering && path.has(id)) || (blocked && hot.has(id) && id !== "root");
    const lay = (n: Node, depth: number, parent: string): number => {
      const kids = n.children;
      const o = isOpen(n.f.id) && kids.length > 0;
      let y: number;
      if (!o) { y = row * GY; row++; }
      else { const ys = kids.map((c) => lay(c, depth + 1, n.f.id)); y = (ys[0] + ys[ys.length - 1]) / 2; }
      out.push({ id: n.f.id, name: n.f.name, kind: n.kind, x: depth * GX, y, status: kids.length ? rollup(n) : n.f.status, kids: kids.length, open: o, parent, leaf: !kids.length });
      return y;
    };
    const rootOpen = open.has("root") || filtering || blocked;
    let rootY = 0;
    if (rootOpen) { const ys = tree.map((r) => lay(r, 1, "root")); rootY = (ys[0] + ys[ys.length - 1]) / 2; } else row = 1;
    out.push({ id: "root", name: "Xproflow", kind: "root", x: 0, y: rootY, status: null, kids: tree.length, open: rootOpen, leaf: false });
    return out;
  }, [tree, open, filtering, path, blocked, hot]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !placed.length) return;
    const minX = Math.min(...placed.map((p) => p.x)), maxX = Math.max(...placed.map((p) => p.x + W));
    const minY = Math.min(...placed.map((p) => p.y)), maxY = Math.max(...placed.map((p) => p.y + H));
    const cw = el.clientWidth, ch = el.clientHeight;
    const k = Math.max(0.55, Math.min(1.2, Math.min((cw - 40) / (maxX - minX), (ch - 40) / (maxY - minY))));
    setT({ k, x: (cw - (maxX - minX) * k) / 2 - minX * k, y: (ch - (maxY - minY) * k) / 2 - minY * k });
  }, [placed]);
  useEffect(() => { const id = requestAnimationFrame(fit); return () => cancelAnimationFrame(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setT((s) => {
      const el = box.current;
      const px = cx ?? (el ? el.clientWidth / 2 : 0), py = cy ?? (el ? el.clientHeight / 2 : 0);
      const k = Math.max(0.2, Math.min(2.5, s.k * factor));
      return { k, x: px - ((px - s.x) / s.k) * k, y: py - ((py - s.y) / s.k) * k };
    });
  }, []);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoomAt]);

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const expandAll = () => { setOpen(new Set(["root", ...hub.features.map((f) => f.id)])); setFitTick((n) => n + 1); };
  const collapseAll = () => { setOpen(new Set(["root", ...tree.map((r) => r.f.id)])); setFitTick((n) => n + 1); };
  useEffect(() => { const id = requestAnimationFrame(fit); return () => cancelAnimationFrame(id); }, [filtering, blocked, fitTick, q, status, prio, !!selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("[data-node]")) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: t.x, oy: t.y, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    setT((s) => ({ ...s, x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
  };
  const up = () => { drag.current = null; };

  const edges = placed.filter((p) => p.parent && byId.get(p.parent)).map((p) => {
    const a = byId.get(p.parent!)!;
    const x1 = a.x + W, y1 = a.y + H / 2, x2 = p.x, y2 = p.y + H / 2, mx = (x1 + x2) / 2;
    return { id: p.id, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, hot: hot.has(p.id) };
  });
  const dim = (p: Placed) => (filtering && p.id !== "root" && !match.has(p.id) && !path.has(p.id)) || (blocked && p.id !== "root" && !hot.has(p.id));
  const total = hub.features.filter((f) => !hub.features.some((x) => x.parent === f.id)).length;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="dh-tools" role="toolbar" aria-label="Map controls">
        <input className="input" type="search" placeholder="Search features" aria-label="Search features" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as Status | "")}><option value="">Any status</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <select className="input" aria-label="Filter by priority" value={prio} onChange={(e) => setPrio(e.target.value as Priority | "")}><option value="">Any priority</option>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
        <button type="button" className={`btn small${blocked ? " primary" : ""}`} aria-pressed={blocked} onClick={() => setBlocked(!blocked)}>Highlight blocked</button>
        <span className="dh-tools-gap" />
        <button type="button" className="btn small" onClick={() => zoomAt(1 / 1.25)} aria-label="Zoom out">−</button>
        <button type="button" className="btn small" onClick={() => zoomAt(1.25)} aria-label="Zoom in">+</button>
        <button type="button" className="btn small" onClick={fit}>Fit to screen</button>
        <button type="button" className="btn small" onClick={expandAll}>Expand all</button>
        <button type="button" className="btn small" onClick={collapseAll}>Collapse</button>
      </div>
      <div className="dh-mapwrap">
        <div className="dh-map" ref={box}>
          <svg ref={svg} width="100%" height="100%" role="group" aria-label={`Feature map of ${total} features`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
              {edges.map((e) => <path key={e.id} d={e.d} className={`dh-edge${e.hot ? " hot" : ""}`} />)}
              {placed.map((p) => {
                const sel = p.id === selected;
                const color = p.status ? STATUS_COLOR[p.status] : "#0a64d8";
                const label = p.name.length > 27 ? `${p.name.slice(0, 26)}…` : p.name;
                return (
                  <g key={p.id} data-node={p.id} transform={`translate(${p.x},${p.y})`} className={`dh-node k-${p.kind}${sel ? " sel" : ""}${hot.has(p.id) && p.id !== "root" ? " hot" : ""}${dim(p) ? " dim" : ""}`}
                    tabIndex={0} role="button" aria-label={`${p.name}${p.status ? `, ${p.status}` : ""}`} aria-pressed={sel}
                    onClick={() => { if (p.id !== "root") onSelect(p.id); else toggle("root"); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (p.id !== "root") onSelect(p.id); } else if (e.key === "ArrowRight" && p.kids && !p.open) toggle(p.id); else if (e.key === "ArrowLeft" && p.open) toggle(p.id); }}>
                    <rect width={p.kind === "root" ? W - 20 : W} height={H} rx={p.kind === "area" || p.kind === "root" ? 15 : 8} />
                    {p.status && <circle cx={14} cy={H / 2} r={5} fill={color} />}
                    <text x={p.status ? 26 : 16} y={H / 2 + 4}>{label}</text>
                    <title>{p.name}{p.status ? ` · ${p.status}` : ""}</title>
                    {p.kids > 0 && (
                      <g className="dh-toggle" transform={`translate(${W - (p.kind === "root" ? 20 : 0)},${H / 2})`} onClick={(e) => { e.stopPropagation(); toggle(p.id); }}>
                        <circle r={9} />
                        <text textAnchor="middle" y={4}>{p.open ? "−" : p.kids}</text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
          {filtering && match.size === 0 && <div className="dh-map-empty">Nothing matches those filters.</div>}
          <div className="dh-legend" aria-label="Status colours">{STATUSES.map((s) => <span key={s}><i style={{ background: STATUS_COLOR[s] }} />{s}</span>)}</div>
        </div>
        {selected && <div className="dh-mapside"><FeatureDetail id={selected} onSelect={onSelect} onClose={() => onSelect("")} /></div>}
      </div>
    </div>
  );
}
