// Small pictures of the report components, shown beside each one in the builder's panels so you can see what you're adding.
import { ReactNode } from "react";

const C = { green: "#6f9a3a", blue: "#3b7dd8", navy: "#2b4a6f", orange: "#e8963a", purple: "#7a5cc7", teal: "#2a9d8f", red: "#d1495b", grey: "#d9dee3", ink: "#8a95a1", soft: "#eef2f7" };
const line = (x: number, y: number, w: number, color = C.grey, h = 3) => <rect key={`${x}-${y}-${w}`} x={x} y={y} width={w} height={h} rx={1.5} fill={color} />;
const lines = (x: number, y: number, ws: number[], color = C.grey, gap = 6) => ws.map((w, i) => line(x, y + i * gap, w, color));
const bars = (x: number, base: number, hs: number[], color: string, w = 7, gap = 3) => hs.map((h, i) => <rect key={i} x={x + i * (w + gap)} y={base - h} width={w} height={h} rx={1.5} fill={color} />);
const path = (d: string, color: string, fill = "none", sw = 2) => <path key={d} d={d} stroke={color} strokeWidth={sw} fill={fill} strokeLinecap="round" strokeLinejoin="round" />;

const para = (x = 10, y = 14, w = 100) => <>{lines(x, y, [w, w - 8, w, w - 30, w - 14], C.grey)}</>;
const table = (cols = 3, rows = 6, x = 10, y = 12, w = 100) => {
  const cw = (w - 36) / cols;
  return (
    <>
      {line(x, y, 30, C.navy, 3)}
      {Array.from({ length: cols }, (_, i) => line(x + 36 + i * cw, y, cw - 6, C.navy, 3))}
      <rect x={x} y={y + 6} width={w} height={0.8} fill={C.navy} opacity={0.5} />
      {Array.from({ length: rows }, (_, r) => {
        const yy = y + 12 + r * 8, head = r === 0 || r === rows - 2;
        return (
          <g key={r}>
            {head && <rect x={x - 2} y={yy - 3} width={w + 4} height={8} rx={2} fill={C.soft} />}
            {line(x, yy, head ? 26 : 22 + (r % 3) * 4, head ? C.navy : C.grey, 2.5)}
            {Array.from({ length: cols }, (_, i) => line(x + 36 + i * cw, yy, cw - 10, head ? C.navy : C.grey, 2.5))}
          </g>
        );
      })}
    </>
  );
};
const tableVar = () => (
  <>
    {table(3, 6)}
    {[0, 1, 2, 3, 4].map((r) => <rect key={r} x={84} y={26 + r * 8} width={20} height={4} rx={2} fill={r % 3 === 2 ? "#f3c1c8" : "#bfe0c3"} />)}
  </>
);
const lineChart = (series: [string, number[]][], x = 10, y = 10, w = 100, h = 52) => (
  <>
    {[0, 1, 2, 3].map((i) => <rect key={i} x={x} y={y + (i * h) / 3} width={w} height={0.6} fill={C.grey} />)}
    {series.map(([col, v], si) => path(v.map((p, i) => `${i ? "L" : "M"}${x + (i * w) / (v.length - 1)},${y + h - p * h}`).join(" "), col, "none", 2 - si * 0.1))}
  </>
);
const waterfall = () => (
  <>
    {[0, 1, 2, 3].map((i) => <rect key={i} x={10} y={12 + i * 17} width={100} height={0.6} fill={C.grey} />)}
    {[[14, 40, 30, C.green], [30, 30, 10, C.red], [46, 24, 6, C.red], [62, 24, 22, C.green], [78, 24, 12, C.red], [94, 12, 26, C.blue]].map(([x, y, h, col]) => <rect key={String(x)} x={x as number} y={y as number} width={11} height={h as number} rx={1.5} fill={col as string} />)}
  </>
);
const hbars = (color: string) => (
  <>
    {[88, 74, 62, 50, 40, 30, 22].map((w, i) => (
      <g key={i}>{line(10, 11 + i * 9, 20, C.grey, 3)}<rect x={34} y={10 + i * 9} width={w * 0.8} height={5} rx={2} fill={color} opacity={1 - i * 0.09} /></g>
    ))}
  </>
);
const aged = () => (
  <>
    {[["#6f9a3a", 34], ["#c8b83a", 22], ["#e8963a", 18], ["#d1495b", 14], ["#8f2d3d", 12]].reduce<{ x: number; els: ReactNode[] }>((a, [col, w]) => ({ x: a.x + (w as number), els: [...a.els, <rect key={String(col)} x={a.x} y={11} width={w as number} height={9} fill={col as string} />] }), { x: 10, els: [] }).els}
    {table(3, 4, 10, 28)}
  </>
);
const kpis = () => (
  <>
    {[0, 1, 2, 3].map((i) => (
      <g key={i}>
        <circle cx={18} cy={17 + i * 14} r={5} fill={[C.green, C.green, C.orange, C.red][i]} />
        {line(30, 15 + i * 14, 44 + (i % 2) * 10, C.grey, 3)}
        <rect x={86} y={14 + i * 14} width={24} height={6} rx={3} fill={C.soft} /><rect x={86} y={14 + i * 14} width={[22, 17, 10, 6][i]} height={6} rx={3} fill={[C.green, C.green, C.orange, C.red][i]} />
      </g>
    ))}
  </>
);

const KINDS: Record<string, ReactNode> = {
  rule: <>
    <rect x={10} y={10} width={100} height={26} rx={4} fill="#eaf5e4" stroke="#bcdca8" />
    <circle cx={22} cy={23} r={7} fill={C.green} />{path("M18.5 24.5 22 20.5l3.5 4", "#fff", "none", 1.8)}
    {lines(34, 18, [64, 44], "#a9c995", 6)}
    <rect x={10} y={42} width={100} height={26} rx={4} fill="#fbe9ec" stroke="#f0bcc4" />
    <circle cx={22} cy={55} r={7} fill={C.red} />{path("M18.5 52.5 22 56.5l3.5-4", "#fff", "none", 1.8)}
    {lines(34, 50, [58, 40], "#e5a3ad", 6)}
  </>,
  para: para(),
  heading: <>{line(10, 14, 62, C.navy, 7)}{lines(10, 32, [100, 92, 100, 70], C.grey)}</>,
  cols: <>{lines(10, 14, [46, 40, 46, 30, 44, 36], C.grey, 7)}{lines(64, 14, [46, 44, 38, 46, 28, 40], C.grey, 7)}<rect x={59} y={12} width={0.8} height={52} fill={C.grey} /></>,
  callout: <><rect x={10} y={12} width={100} height={52} rx={4} fill="#fff6e8" stroke="#f1d6a8" /><rect x={10} y={12} width={4} height={52} rx={2} fill={C.orange} />{line(22, 20, 44, C.orange, 4)}{lines(22, 32, [80, 76, 52], "#e2c79c", 7)}</>,
  summary: <><rect x={10} y={10} width={100} height={60} rx={4} fill={C.soft} />{line(18, 18, 54, C.navy, 5)}{[0, 1, 2, 3].map((i) => <g key={i}><circle cx={21} cy={32 + i * 9} r={2} fill={C.blue} />{line(28, 31 + i * 9, 70 - (i % 2) * 14, C.grey, 3)}</g>)}</>,
  rule_line: <>{line(10, 38, 100, C.grey, 1.5)}{lines(10, 16, [80, 60], "#e6e9ed")}{lines(10, 50, [90, 50], "#e6e9ed")}</>,
  page: <>
    <rect x={14} y={8} width={38} height={26} rx={2} fill="#fff" stroke={C.grey} />{lines(19, 14, [26, 20, 24], C.grey)}
    <path d="M8 40h104" stroke={C.blue} strokeDasharray="4 3" strokeWidth={1.5} />
    <rect x={68} y={46} width={38} height={26} rx={2} fill="#fff" stroke={C.grey} />{lines(73, 52, [26, 20, 24], C.grey)}
  </>,
  key: <>
    <rect x={10} y={10} width={100} height={60} rx={6} fill="#fff" stroke={C.grey} />
    {line(20, 20, 38, C.ink, 3)}
    <text x={20} y={46} fontSize={20} fontWeight={700} fill={C.navy} fontFamily="system-ui,sans-serif">£84.2k</text>
    {path("M20 62 30 57 40 59 52 52 64 55 78 48 96 44", C.green, "none", 2)}
    <rect x={78} y={18} width={24} height={9} rx={4.5} fill="#e4f1e6" /><text x={82} y={25} fontSize={7} fontWeight={700} fill={C.green} fontFamily="system-ui,sans-serif">▲ 12%</text>
  </>,
  bars_green: <>{[0, 1, 2, 3].map((i) => <rect key={i} x={10} y={12 + i * 15} width={100} height={0.6} fill={C.grey} />)}{bars(14, 57, [22, 28, 24, 34, 30, 38, 33, 42, 36, 46, 40, 48], C.green, 5, 3.4)}</>,
  bars_two: <>{[0, 1, 2, 3].map((i) => <rect key={i} x={10} y={12 + i * 15} width={100} height={0.6} fill={C.grey} />)}{[30, 34, 28, 38, 32, 40, 36, 42].map((h, i) => <rect key={`a${i}`} x={14 + i * 12} y={57 - h} width={5} height={h} rx={1.5} fill={C.navy} />)}{[18, 20, 24, 22, 26, 24, 28, 30].map((h, i) => <rect key={`b${i}`} x={19.5 + i * 12} y={57 - h} width={5} height={h} rx={1.5} fill={C.orange} />)}</>,
  bars_blue: <>{[0, 1, 2, 3].map((i) => <rect key={i} x={10} y={12 + i * 15} width={100} height={0.6} fill={C.grey} />)}{bars(14, 57, [20, 26, 32, 28, 36, 42, 38, 44, 40, 48, 46, 52], C.blue, 5, 3.4)}</>,
  line1: lineChart([[C.green, [0.2, 0.3, 0.25, 0.45, 0.4, 0.6, 0.55, 0.7, 0.62, 0.85, 0.8, 0.95]]]),
  line3: lineChart([[C.green, [0.5, 0.6, 0.55, 0.7, 0.65, 0.8, 0.75, 0.9]], [C.blue, [0.3, 0.38, 0.32, 0.45, 0.42, 0.5, 0.48, 0.58]], [C.orange, [0.1, 0.15, 0.12, 0.2, 0.18, 0.25, 0.22, 0.3]]]),
  line_margins: lineChart([[C.purple, [0.7, 0.68, 0.72, 0.7, 0.74, 0.72, 0.76, 0.75]], [C.teal, [0.45, 0.4, 0.46, 0.42, 0.5, 0.47, 0.52, 0.5]], [C.red, [0.2, 0.18, 0.25, 0.2, 0.28, 0.24, 0.3, 0.27]]]),
  line2: lineChart([[C.blue, [0.3, 0.4, 0.5, 0.45, 0.6, 0.7, 0.65, 0.8]], [C.orange, [0.6, 0.55, 0.5, 0.58, 0.45, 0.4, 0.46, 0.35]]]),
  top_exp: hbars(C.orange), top_rev: hbars(C.green),
  kpis: kpis(), waterfall: waterfall(),
  table3: table(2, 6), table_var: tableVar(), table_months: table(6, 6), table_bs: table(2, 7),
  aged: aged(),
};

function kindOf(name: string, group: string): string {
  const n = name.toLowerCase();
  if (group === "text") {
    if (n.includes("rule")) return "rule"; if (n === "text") return "para"; if (n === "heading") return "heading"; if (n.includes("column")) return "cols";
    if (n === "observation") return "callout"; if (n.includes("summary")) return "summary"; if (n.includes("line")) return "rule_line"; return "page";
  }
  if (group === "charts") {
    if (n === "key number") return "key"; if (n.startsWith("top 10")) return n.includes("expense") ? "top_exp" : "top_rev";
    if (n.startsWith("kpi")) return "kpis"; if (n === "cash flow") return "waterfall"; if (n === "margins") return "line_margins";
    if (n.includes("24")) return "line1"; if (n.includes("debtors")) return "line2"; if (n === "costs") return "bars_two"; if (n.startsWith("cash")) return "bars_blue";
    if (n === "revenue") return "bars_green"; return "line3";
  }
  if (group === "tables") {
    if (n.startsWith("aged")) return "aged"; if (n.includes("by month")) return "table_months"; if (n.startsWith("balance")) return "table_bs"; if (n.includes(" vs ") || n.startsWith("detailed") || n.startsWith("both")) return "table_var"; return "table3";
  }
  return "table3";
}

const MINI = (el: ReactNode, x: number, y: number, s: number, key = "") => <g key={key || `${x}-${y}`} transform={`translate(${x} ${y}) scale(${s})`}>{el}</g>;
function layoutThumb(name: string): ReactNode {
  const n = name.toLowerCase();
  const pick = (...ks: string[]) => ks.map((k, i) => MINI(KINDS[k], i % 2 ? 61 : 0, Math.floor(i / 2) * 37 + 3, 0.48, `${k}${i}`));
  if (n.includes("receivable") || n.includes("payable")) return <>{MINI(KINDS.aged, 0, 0, 1)}</>;
  if (n.startsWith("monthly")) return <>{pick("summary", "table3", "bars_green", "line_margins")}</>;
  if (n.startsWith("kpi")) return <>{pick("kpis", "callout")}</>;
  if (n.startsWith("cash")) return <>{pick("waterfall", "bars_blue", "table_bs")}</>;
  if (n.startsWith("revenue")) return <>{pick("bars_green", "line1", "line3")}</>;
  return <>{pick("summary", "table3", "line3", "kpis")}</>;
}

/** A picture for a component in the builder's panels. `group` is the panel: text, charts, tables or layouts. */
export function Thumb({ name, group }: { name: string; group: "text" | "charts" | "tables" | "layouts" }) {
  return (
    <svg className="rb-thumb" viewBox="0 0 120 80" width="96" height="64" role="img" aria-label={`${name} preview`}>
      <rect x={0.5} y={0.5} width={119} height={79} rx={6} fill="#fff" stroke="#dfe3e8" />
      {group === "layouts" ? layoutThumb(name) : KINDS[kindOf(name, group)]}
    </svg>
  );
}
