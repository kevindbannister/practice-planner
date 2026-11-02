// One slide of a client deck, drawn at 960 x 540 and scaled to fit wherever it is shown (the editor, the thumbnails, presenting, printing).
import { CSSProperties, ReactNode, useEffect, useRef, useState } from "react";
import { Deck, Slide, kfmt, mix, themeOf } from "../lib/deck";

export const SW = 960, SH = 540;

const fmtVal = (v: number, unit: string) => (unit === "%" ? `${v}%` : kfmt(v));

function Bars({ s, T }: { s: Slide; T: ReturnType<typeof themeOf> }) {
  const b = s.bars!;
  const W = 840, H = 300, series = b.names.length;
  const all = b.rows.flatMap((r) => r.values), lo = Math.min(0, ...all), hi = Math.max(0, ...all) || 1, span = hi - lo || 1;
  const colour = (j: number) => (series > 1 ? (j === series - 1 ? T.primary : T.grey) : T.primary);
  const legend = series > 1 && (
    <g>{b.names.map((n, j) => <g key={n} transform={`translate(${W - 220 + j * 110},8)`}><rect width="12" height="12" fill={colour(j)} rx="2" /><text x="18" y="11" fontSize="13" fill={T.muted}>{n}</text></g>)}</g>
  );
  if (b.horizontal) {
    const left = 170, right = 70, rowH = (H - 30) / Math.max(1, b.rows.length), bw = Math.min(26, (rowH - 8) / series), x0 = left + ((0 - lo) / span) * (W - left - right);
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img" aria-label="Bar chart">
        {legend}
        {b.rows.map((r, i) => (
          <g key={i} transform={`translate(0,${26 + i * rowH})`}>
            <text x={left - 12} y={rowH / 2 + 4} fontSize="14" fill={T.muted} textAnchor="end">{r.label}</text>
            {r.values.map((v, j) => {
              const w = (Math.abs(v) / span) * (W - left - right), x = v >= 0 ? x0 : x0 - w, y = (rowH - bw * series) / 2 + j * bw;
              return <g key={j}><rect x={x} y={y} width={Math.max(1, w)} height={bw - 2} fill={colour(j)} rx="3" /><text x={v >= 0 ? x + w + 6 : x - 6} y={y + bw / 2 + 3} fontSize="12" fontWeight="700" fill={T.ink} textAnchor={v >= 0 ? "start" : "end"}>{fmtVal(v, b.unit)}</text></g>;
            })}
          </g>
        ))}
        <line x1={x0} x2={x0} y1="22" y2={H} stroke={T.muted} strokeWidth="1" />
      </svg>
    );
  }
  const bottom = 46, top = 34, cw = (W - 20) / Math.max(1, b.rows.length), bw = Math.min(54, (cw - 16) / series), y0 = top + ((hi - 0) / span) * (H - top - bottom);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img" aria-label="Bar chart">
      {legend}
      <line x1="10" x2={W - 10} y1={y0} y2={y0} stroke={T.muted} strokeWidth="1" />
      {b.rows.map((r, i) => (
        <g key={i}>
          {r.values.map((v, j) => {
            const h = (Math.abs(v) / span) * (H - top - bottom), x = 10 + i * cw + (cw - bw * series) / 2 + j * bw, y = v >= 0 ? y0 - h : y0;
            return <g key={j}><rect x={x} y={y} width={bw - 3} height={Math.max(1, h)} fill={colour(j)} rx="3" /><text x={x + (bw - 3) / 2} y={v >= 0 ? y - 5 : y + h + 13} fontSize="11" fontWeight="700" fill={T.ink} textAnchor="middle">{fmtVal(v, b.unit)}</text></g>;
          })}
          <text x={10 + i * cw + cw / 2} y={H - 16} fontSize="13" fill={T.muted} textAnchor="middle">{r.label.length > 20 ? `${r.label.slice(0, 19)}…` : r.label}</text>
        </g>
      ))}
    </svg>
  );
}

function Bridge({ s, T }: { s: Slide; T: ReturnType<typeof themeOf> }) {
  const rows = s.bridge!.rows, W = 840, H = 300, top = 34, bottom = 46;
  let run = 0;
  const bars = rows.map((r) => { if (r.total) { run = r.value; return { lo: Math.min(0, r.value), hi: Math.max(0, r.value), r }; } const a = run; run += r.value; return { lo: Math.min(a, run), hi: Math.max(a, run), r }; });
  const lo = Math.min(0, ...bars.map((x) => x.lo)), hi = Math.max(...bars.map((x) => x.hi), 1), span = hi - lo || 1;
  const Y = (v: number) => top + ((hi - v) / span) * (H - top - bottom), cw = (W - 20) / rows.length, bw = Math.min(70, cw - 18);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img" aria-label="Bridge chart">
      <line x1="10" x2={W - 10} y1={Y(0)} y2={Y(0)} stroke={T.muted} strokeWidth="1" />
      {bars.map((x, i) => {
        const fill = x.r.total ? T.primary : x.r.value >= 0 ? T.up : T.down, cx = 10 + i * cw + cw / 2, y = Y(x.hi), h = Math.max(2, Y(x.lo) - Y(x.hi));
        return (
          <g key={i}>
            <rect x={cx - bw / 2} y={y} width={bw} height={h} fill={fill} rx="3" />
            <text x={cx} y={y - 6} fontSize="12" fontWeight="700" fill={x.r.total ? T.ink : fill} textAnchor="middle">{x.r.total ? kfmt(x.r.value) : `${x.r.value >= 0 ? "+" : "-"}${kfmt(Math.abs(x.r.value))}`}</text>
            <text x={cx} y={H - 18} fontSize="12.5" fill={T.muted} textAnchor="middle">{x.r.label.length > 16 ? `${x.r.label.slice(0, 15)}…` : x.r.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Line({ s, T }: { s: Slide; T: ReturnType<typeof themeOf> }) {
  const l = s.line!, W = 840, H = 300, left = 56, bottom = 34, top = 30;
  const hi = Math.max(1, ...l.series.flatMap((x) => x.values)), n = Math.max(1, l.categories.length), X = (i: number) => left + (n === 1 ? (W - left) / 2 : (i / (n - 1)) * (W - left - 20)), Y = (v: number) => top + ((hi - v) / hi) * (H - top - bottom);
  const colour = (j: number) => (l.series.length > 1 ? (j === l.series.length - 1 ? T.primary : T.grey) : T.primary);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img" aria-label="Line chart">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => <g key={t}><line x1={left} x2={W - 10} y1={Y(hi * t)} y2={Y(hi * t)} stroke={mix(T.bg, T.muted, 0.25)} strokeWidth="1" /><text x={left - 8} y={Y(hi * t) + 4} fontSize="11" fill={T.muted} textAnchor="end">{kfmt(hi * t)}</text></g>)}
      {l.categories.map((c, i) => <text key={i} x={X(i)} y={H - 10} fontSize="12" fill={T.muted} textAnchor="middle">{c}</text>)}
      {l.series.map((x, j) => (
        <g key={j}>
          <polyline fill="none" stroke={colour(j)} strokeWidth="3" strokeLinejoin="round" points={x.values.map((v, i) => `${X(i)},${Y(v)}`).join(" ")} />
          {x.values.map((v, i) => <circle key={i} cx={X(i)} cy={Y(v)} r="4" fill={colour(j)} />)}
          {l.series.length > 1 && <g transform={`translate(${W - 220 + j * 110},6)`}><rect width="12" height="12" fill={colour(j)} rx="2" /><text x="18" y="11" fontSize="13" fill={T.muted}>{x.name}</text></g>}
        </g>
      ))}
    </svg>
  );
}

function Body({ s, deck, T, head }: { s: Slide; deck: Deck; T: ReturnType<typeof themeOf>; head: string }) {
  const take = s.takeaway ? <div style={{ position: "absolute", left: 48, right: 48, bottom: 66, textAlign: "center", color: T.primary, fontWeight: 700, fontSize: 18, lineHeight: 1.3 }}>{s.takeaway}</div> : null;
  const subt = s.subtitle ? <div style={{ position: "absolute", left: 48, top: 96, fontSize: 16, fontWeight: 700, color: T.muted }}>{s.subtitle}</div> : null;
  const chartBox = { position: "absolute", left: 48, right: 48, top: 126, height: 330 } as CSSProperties;
  void deck;
  switch (s.type) {
    case "kpis": {
      const t = s.tiles || [];
      return (
        <>
          <div style={{ position: "absolute", left: 48, right: 48, top: 140, display: "grid", gridTemplateColumns: `repeat(${Math.max(1, t.length)}, 1fr)`, gap: 22 }}>
            {t.map((x, i) => (
              <div key={i} style={{ background: T.card, border: `1px solid ${mix(T.bg, T.muted, 0.25)}`, borderRadius: 16, padding: "22px 12px", textAlign: "center", minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.muted, letterSpacing: 0.4 }}>{x.label}</div>
                <div style={{ fontFamily: head, fontSize: t.length > 4 ? 34 : 44, fontWeight: 700, margin: "14px 0 10px", color: T.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.value}</div>
                {x.change && <div style={{ fontSize: 22, fontWeight: 700, color: x.tone === "up" ? T.up : x.tone === "down" ? T.down : T.muted }}>{x.change}</div>}
                {x.sub && <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>{x.sub}</div>}
              </div>
            ))}
          </div>
          {take}
        </>
      );
    }
    case "bars": return <>{subt}<div style={chartBox}>{s.bars && <Bars s={s} T={T} />}</div>{take}</>;
    case "bridge": return <>{subt}<div style={chartBox}>{s.bridge && <Bridge s={s} T={T} />}</div>{take}</>;
    case "line": return <>{subt}<div style={chartBox}>{s.line && <Line s={s} T={T} />}</div>{take}</>;
    case "timeline": {
      const p = s.points || [];
      return (
        <>
          <div style={{ position: "absolute", left: 48, right: 48, top: 276, borderTop: `2px solid ${T.muted}` }} />
          {p.map((x, i) => {
            const w = (960 - 96) / Math.max(1, p.length), cx = 48 + w * i + w / 2, up = i % 2 === 0;
            return (
              <div key={i}>
                <div style={{ position: "absolute", left: cx - 9, top: 268, width: 18, height: 18, borderRadius: 9, background: T.primary, border: `3px solid ${T.bg}` }} />
                <div style={{ position: "absolute", left: cx - w / 2, width: w, textAlign: "center", ...(up ? { bottom: 540 - 258 } : { top: 296 }) }}>
                  <div style={{ fontFamily: head, fontSize: 30, fontWeight: 700, color: T.ink }}>{x.value}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.muted }}>{x.label}</div>
                  {x.sub && <div style={{ fontSize: 13, color: T.muted }}>{x.sub}</div>}
                </div>
              </div>
            );
          })}
          {take}
        </>
      );
    }
    case "table": {
      const t = s.table || { head: [], rows: [] };
      return (
        <>
          <div style={{ position: "absolute", left: 48, right: 48, top: 116, maxHeight: 330, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16 }}>
              <thead><tr>{t.head.map((h, i) => <th key={i} style={{ background: T.primary, color: T.onPrimary, padding: "9px 12px", textAlign: i === 0 || t.head.length === 2 ? "left" : "right", fontWeight: 700 }}>{h}</th>)}</tr></thead>
              <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} style={{ padding: "8px 12px", background: T.card, borderBottom: `1px solid ${mix(T.bg, T.muted, 0.25)}`, color: T.ink, textAlign: j === 0 || t.head.length === 2 ? "left" : "right", fontWeight: j === 0 && /^net |^total/i.test(c) ? 700 : 400 }}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {take}
        </>
      );
    }
    case "checklist": {
      const it = s.items || [];
      return (
        <>
          <div style={{ position: "absolute", left: 48, right: 48, top: 116 }}>
            {it.map((x, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 18, padding: "11px 0", borderBottom: `1px solid ${mix(T.bg, T.muted, 0.25)}` }}>
                <span style={{ fontFamily: head, fontSize: 26, fontWeight: 700, color: T.primary, width: 44 }}>{String(i + 1).padStart(2, "0")}</span>
                <span style={{ fontSize: 19, fontWeight: 700, color: T.ink, flex: x.text ? "0 0 300px" : 1 }}>{x.title}</span>
                {x.text && <span style={{ fontSize: 16, color: T.muted, flex: 1 }}>{x.text}</span>}
              </div>
            ))}
          </div>
          {s.band && (s.band.left || s.band.right) && (
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 52, height: 50, background: T.dark, color: T.onDark, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 48px", fontSize: 19, fontWeight: 700 }}>
              <span>{s.band.left}</span><span style={{ color: T.primary }}>{s.band.right}</span>
            </div>
          )}
        </>
      );
    }
    case "callout": return (
      <>
        <div style={{ position: "absolute", left: 48, right: 48, top: 150, textAlign: "center", fontFamily: head, fontSize: 110, fontWeight: 700, color: T.primary, lineHeight: 1.1 }}>{s.big?.value}</div>
        <div style={{ position: "absolute", left: 48, right: 48, top: 292, textAlign: "center", fontSize: 26, fontWeight: 700, color: T.ink }}>{s.big?.caption}</div>
        {take}
      </>
    );
    case "text": return <ul style={{ position: "absolute", left: 70, right: 60, top: 120, margin: 0, padding: 0, fontSize: 24, lineHeight: 1.5, color: T.ink }}>{(s.bullets || []).map((b, i) => <li key={i} style={{ marginBottom: 10 }}>{b}</li>)}</ul>;
    default: return null;
  }
}

export function DeckSlide({ slide, deck, n, total, firmLogo }: { slide: Slide; deck: Deck; n: number; total: number; firmLogo?: string }) {
  const b = deck.brand, T = themeOf(b), head = b.serif ? "Cambria, Georgia, 'Times New Roman', serif" : "Calibri, Carlito, Arial, sans-serif";
  const dark = slide.type === "cover" || slide.type === "section";
  const base: CSSProperties = { position: "relative", width: SW, height: SH, overflow: "hidden", fontFamily: "Calibri, Carlito, Arial, sans-serif", background: dark ? T.dark : T.bg, color: dark ? T.onDark : T.ink };
  if (dark) {
    const half = slide.type === "cover";
    return (
      <div style={base} data-slide={slide.id}>
        {half && b.cover && <img src={b.cover} alt="" style={{ position: "absolute", right: 0, top: 0, width: SW / 2, height: SH, objectFit: "cover" }} />}
        {b.logo && <img src={b.logo} alt={`${b.clientName} logo`} style={{ position: "absolute", left: 48, top: 40, maxWidth: 160, maxHeight: 76, objectFit: "contain" }} />}
        <div style={{ position: "absolute", left: 48, top: 160, width: half ? 420 : 860 }}>
          <div style={{ fontFamily: head, fontSize: half ? 46 : 54, fontWeight: 700, lineHeight: 1.12 }}>{slide.title}</div>
          {slide.subtitle && <div style={{ marginTop: 22, fontSize: 21, fontWeight: 700, color: T.primary }}>{slide.subtitle}</div>}
        </div>
        {b.firmLogo && firmLogo && <img src={firmLogo} alt="Firm logo" style={{ position: "absolute", left: 48, bottom: 36, maxWidth: 120, maxHeight: 40, objectFit: "contain" }} />}
      </div>
    );
  }
  const Frame = ({ children }: { children: ReactNode }) => <div style={base} data-slide={slide.id}>{children}</div>;
  return (
    <Frame>
      {b.logo && <img src={b.logo} alt={`${b.clientName} logo`} style={{ position: "absolute", left: 48, top: 30, maxWidth: 96, maxHeight: 48, objectFit: "contain" }} />}
      <div style={{ position: "absolute", left: b.logo ? 164 : 48, right: 48, top: 30, height: 48, display: "flex", alignItems: "center", fontFamily: head, fontSize: 30, fontWeight: 700, color: T.ink, lineHeight: 1.1 }}>{slide.title}</div>
      <Body s={slide} deck={deck} T={T} head={head} />
      <div style={{ position: "absolute", left: 48, bottom: 18, fontSize: 13, color: T.muted }}>{n} / {total}</div>
      {b.footer && <div style={{ position: "absolute", left: 200, right: 200, bottom: 18, textAlign: "center", fontSize: 13, color: T.muted }}>{b.footer}</div>}
      {b.firmLogo && firmLogo && <img src={firmLogo} alt="Firm logo" style={{ position: "absolute", right: 48, bottom: 12, maxWidth: 90, maxHeight: 30, objectFit: "contain" }} />}
    </Frame>
  );
}

/** A slide scaled to the width of its container. */
export function ScaledSlide(props: { slide: Slide; deck: Deck; n: number; total: number; firmLogo?: string; fit?: "width" | "box" }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.5);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => { const w = el.clientWidth, h = el.clientHeight; setK(props.fit === "box" && h ? Math.min(w / SW, h / SH) : w / SW); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.fit]);
  return (
    <div ref={box} style={props.fit === "box" ? { width: "100%", height: "100%", display: "grid", placeItems: "center" } : { width: "100%", aspectRatio: `${SW} / ${SH}`, overflow: "hidden", position: "relative" }}>
      <div style={props.fit === "box" ? { width: SW * k, height: SH * k, overflow: "hidden", position: "relative" } : { position: "absolute", left: 0, top: 0 }}>
        <div style={{ width: SW, height: SH, transform: `scale(${k})`, transformOrigin: "top left" }}><DeckSlide {...props} /></div>
      </div>
    </div>
  );
}
