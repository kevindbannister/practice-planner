// The client deck: the draft accounts as a presentation for the client. Standard slides come from the accounts figures; every slide
// can be changed, hidden, moved or added to, the client's logo and colours are used throughout, and it can be presented on screen,
// printed to PDF or taken into PowerPoint. The deck is kept with the year (a file on OneDrive), so it can be changed whenever.
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Client } from "../lib/domain";
import { brandOf, readBranding } from "../lib/docBranding";
import { detailGroups } from "../lib/accounts";
import { Deck, DeckBrand, DeckInput, SLIDE_TYPES, Slide, SlideType, blankSlide, duplicateSlide, isHex, moveSlide, presentable, readDeck, refreshDeck, starterDeck } from "../lib/deck";
import { buildPptx } from "../lib/deckPptx";
import { accountsFigures } from "../lib/tbMap";
import { linesFor, priorPeriod, setupOf } from "../lib/papers";
import { Icon } from "./bits";
import { downloadFile } from "./commsKit";
import { useData } from "./data";
import { DeckSlide, ScaledSlide } from "./DeckSlide";
import { useAccountsData, useWriter } from "./PaperSchedules";

export const DECK_ITEM = "_deck";
const FOLDER = "Practice Planner Decks";
export const deckFile = (clientKey: string, period: string) => `/me/drive/root:/${encodeURIComponent(FOLDER)}/${encodeURIComponent(clientKey)}/${encodeURIComponent(`${period} client deck.json`)}`;

// ------------------------------------------------------------------ pictures

/** A picture picked from disk, made small enough to keep in the deck (a logo stays PNG so it keeps its transparency). */
export function pictureData(file: File, max: number, png: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL(png ? "image/png" : "image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That picture could not be read. Use a PNG or JPEG.")); };
    img.src = url;
  });
}

/** The strongest colour in a logo: the commonest shade that isn't white, black, grey or see-through. */
export function logoColour(dataUrl: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"), s = 64;
      c.width = s; c.height = s;
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0, s, s);
      const px = g.getImageData(0, 0, s, s).data, bins = new Map<number, { n: number; r: number; g: number; b: number }>();
      for (let i = 0; i < px.length; i += 4) {
        const [r, gg, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        if (a < 200 || mx < 40 || mn > 225 || mx - mn < 40) continue;
        const key = ((r >> 4) << 8) | ((gg >> 4) << 4) | (b >> 4), e = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        e.n++; e.r += r; e.g += gg; e.b += b; bins.set(key, e);
      }
      const top = [...bins.values()].sort((a, b) => b.n - a.n)[0];
      resolve(top ? `#${[top.r, top.g, top.b].map((v) => Math.round(v / top.n).toString(16).padStart(2, "0")).join("")}` : undefined);
    };
    img.onerror = () => resolve(undefined);
    img.src = dataUrl;
  });
}

// ------------------------------------------------------------------ small inputs

function Num({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  const [t, setT] = useState(String(value));
  useEffect(() => { if (Number(t.replace(/,/g, "")) !== value) setT(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input className="input mono deck-num" inputMode="decimal" aria-label={label} value={t} onChange={(e) => { setT(e.target.value); const n = Number(e.target.value.replace(/[£,\s]/g, "")); if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n); }} />;
}
const Txt = ({ value, onChange, label, area, placeholder }: { value: string; onChange: (v: string) => void; label: string; area?: boolean; placeholder?: string }) => (
  <label className="doc-field">{label}{area ? <textarea className="input" rows={3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /> : <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}</label>
);
const Mini = ({ onClick, label, children, disabled }: { onClick: () => void; label: string; children: ReactNode; disabled?: boolean }) => <button type="button" className="deck-mini" aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</button>;

// ------------------------------------------------------------------ the form for one slide

function SlideForm({ s, set }: { s: Slide; set: (p: Partial<Slide>) => void }) {
  const detach = { auto: undefined } as Partial<Slide>;
  const move = <T,>(list: T[], i: number, by: number) => { const j = i + by; if (j < 0 || j >= list.length) return list; const c = [...list]; [c[i], c[j]] = [c[j], c[i]]; return c; };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <Txt label="Title" value={s.title} onChange={(v) => set({ title: v })} />
      {["bars", "bridge", "line", "cover", "section"].includes(s.type) && <Txt label={s.type === "cover" || s.type === "section" ? "Line under the title" : "Sub-heading"} value={s.subtitle || ""} onChange={(v) => set({ subtitle: v })} />}
      {s.tiles && (
        <fieldset className="deck-set"><legend>Figures</legend>
          {s.tiles.map((t, i) => (
            <div key={i} className="deck-row">
              <input className="input" aria-label={`Label ${i + 1}`} placeholder="Label" value={t.label} onChange={(e) => set({ ...detach, tiles: s.tiles!.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
              <input className="input" aria-label={`Value ${i + 1}`} placeholder="£169k" value={t.value} onChange={(e) => set({ ...detach, tiles: s.tiles!.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} />
              <input className="input" aria-label={`Change ${i + 1}`} placeholder="+19%" value={t.change} onChange={(e) => set({ ...detach, tiles: s.tiles!.map((x, k) => (k === i ? { ...x, change: e.target.value } : x)) })} />
              <select className="input" aria-label={`Colour ${i + 1}`} value={t.tone} onChange={(e) => set({ tiles: s.tiles!.map((x, k) => (k === i ? { ...x, tone: e.target.value as "up" | "down" | "flat" } : x)) })}><option value="up">Good</option><option value="down">Bad</option><option value="flat">Neutral</option></select>
              <Mini label="Remove this figure" onClick={() => set({ tiles: s.tiles!.filter((_, k) => k !== i) })}>×</Mini>
            </div>
          ))}
          {s.tiles.length < 5 && <button type="button" className="btn small" onClick={() => set({ tiles: [...s.tiles!, { label: "Figure", value: "£0", change: "", sub: "", tone: "flat" }] })}>+ Add a figure</button>}
        </fieldset>
      )}
      {s.bars && (
        <fieldset className="deck-set"><legend>Chart</legend>
          <div className="deck-row">
            <label className="row-wrap" style={{ gap: 6 }}>Shown as <select className="input" value={s.bars.unit} onChange={(e) => set({ bars: { ...s.bars!, unit: e.target.value } })}><option value="£">£ amounts</option><option value="%">Percentages</option></select></label>
            <label className="row-wrap" style={{ gap: 6 }}><input type="checkbox" checked={s.bars.horizontal} onChange={(e) => set({ bars: { ...s.bars!, horizontal: e.target.checked } })} /> Horizontal</label>
          </div>
          <div className="deck-grid" style={{ gridTemplateColumns: `1.4fr repeat(${s.bars.names.length}, 1fr) auto` }}>
            <span />{s.bars.names.map((n, j) => <input key={j} className="input" aria-label={`Series ${j + 1} name`} value={n} onChange={(e) => set({ bars: { ...s.bars!, names: s.bars!.names.map((x, k) => (k === j ? e.target.value : x)) } })} />)}<span />
            {s.bars.rows.map((r, i) => (
              <div key={i} style={{ display: "contents" }}>
                <input className="input" aria-label={`Row ${i + 1} label`} value={r.label} onChange={(e) => set({ ...detach, bars: { ...s.bars!, rows: s.bars!.rows.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) } })} />
                {s.bars!.names.map((_, j) => <Num key={j} label={`${r.label} ${s.bars!.names[j]}`} value={r.values[j] ?? 0} onChange={(n) => set({ ...detach, bars: { ...s.bars!, rows: s.bars!.rows.map((x, k) => (k === i ? { ...x, values: s.bars!.names.map((__, jj) => (jj === j ? n : x.values[jj] ?? 0)) } : x)) } })} />)}
                <Mini label={`Remove ${r.label}`} onClick={() => set({ bars: { ...s.bars!, rows: s.bars!.rows.filter((_, k) => k !== i) } })}>×</Mini>
              </div>
            ))}
          </div>
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn small" onClick={() => set({ bars: { ...s.bars!, rows: [...s.bars!.rows, { label: "New", values: s.bars!.names.map(() => 0) }] } })}>+ Add a row</button>
            {s.bars.names.length < 3 && <button type="button" className="btn small" onClick={() => set({ bars: { ...s.bars!, names: [...s.bars!.names, "Series"], rows: s.bars!.rows.map((r) => ({ ...r, values: [...r.values, 0] })) } })}>+ Add a series</button>}
            {s.bars.names.length > 1 && <button type="button" className="btn small" onClick={() => set({ bars: { ...s.bars!, names: s.bars!.names.slice(0, -1), rows: s.bars!.rows.map((r) => ({ ...r, values: r.values.slice(0, -1) })) } })}>Remove the last series</button>}
          </div>
        </fieldset>
      )}
      {s.bridge && (
        <fieldset className="deck-set"><legend>Bridge</legend>
          {s.bridge.rows.map((r, i) => (
            <div key={i} className="deck-row">
              <input className="input" aria-label={`Step ${i + 1} label`} value={r.label} onChange={(e) => set({ ...detach, bridge: { rows: s.bridge!.rows.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) } })} />
              <Num label={`${r.label} amount`} value={r.value} onChange={(n) => set({ ...detach, bridge: { rows: s.bridge!.rows.map((x, k) => (k === i ? { ...x, value: n } : x)) } })} />
              <label className="row-wrap" style={{ gap: 4, fontSize: 12 }}><input type="checkbox" checked={!!r.total} onChange={(e) => set({ bridge: { rows: s.bridge!.rows.map((x, k) => (k === i ? { ...x, total: e.target.checked } : x)) } })} /> Total</label>
              <Mini label="Move up" disabled={i === 0} onClick={() => set({ bridge: { rows: move(s.bridge!.rows, i, -1) } })}>↑</Mini><Mini label="Move down" disabled={i === s.bridge!.rows.length - 1} onClick={() => set({ bridge: { rows: move(s.bridge!.rows, i, 1) } })}>↓</Mini>
              <Mini label={`Remove ${r.label}`} onClick={() => set({ bridge: { rows: s.bridge!.rows.filter((_, k) => k !== i) } })}>×</Mini>
            </div>
          ))}
          <button type="button" className="btn small" onClick={() => set({ bridge: { rows: [...s.bridge.rows.slice(0, -1), { label: "Change", value: 0 }, s.bridge.rows[s.bridge.rows.length - 1]] } })}>+ Add a step</button>
        </fieldset>
      )}
      {s.line && (
        <fieldset className="deck-set"><legend>Chart</legend>
          <div className="deck-grid" style={{ gridTemplateColumns: `1fr repeat(${s.line.series.length}, 1fr) auto` }}>
            <span />{s.line.series.map((x, j) => <input key={j} className="input" aria-label={`Line ${j + 1} name`} value={x.name} onChange={(e) => set({ line: { ...s.line!, series: s.line!.series.map((y, k) => (k === j ? { ...y, name: e.target.value } : y)) } })} />)}<span />
            {s.line.categories.map((c, i) => (
              <div key={i} style={{ display: "contents" }}>
                <input className="input" aria-label={`Point ${i + 1} label`} value={c} onChange={(e) => set({ line: { ...s.line!, categories: s.line!.categories.map((x, k) => (k === i ? e.target.value : x)) } })} />
                {s.line!.series.map((x, j) => <Num key={j} label={`${c} ${x.name}`} value={x.values[i] ?? 0} onChange={(n) => set({ line: { ...s.line!, series: s.line!.series.map((y, k) => (k === j ? { ...y, values: s.line!.categories.map((__, ii) => (ii === i ? n : y.values[ii] ?? 0)) } : y)) } })} />)}
                <Mini label={`Remove ${c}`} onClick={() => set({ line: { categories: s.line!.categories.filter((_, k) => k !== i), series: s.line!.series.map((y) => ({ ...y, values: y.values.filter((__, k) => k !== i) })) } })}>×</Mini>
              </div>
            ))}
          </div>
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn small" onClick={() => set({ line: { categories: [...s.line!.categories, "New"], series: s.line!.series.map((y) => ({ ...y, values: [...y.values, 0] })) } })}>+ Add a point</button>
            {s.line.series.length < 3 && <button type="button" className="btn small" onClick={() => set({ line: { ...s.line!, series: [...s.line!.series, { name: "Line", values: s.line!.categories.map(() => 0) }] } })}>+ Add a line</button>}
          </div>
        </fieldset>
      )}
      {s.points && (
        <fieldset className="deck-set"><legend>Points</legend>
          {s.points.map((p, i) => (
            <div key={i} className="deck-row">
              <input className="input" aria-label={`Point ${i + 1} figure`} placeholder="£0.9k" value={p.value} onChange={(e) => set({ points: s.points!.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} />
              <input className="input" aria-label={`Point ${i + 1} label`} placeholder="Opening credit" value={p.label} onChange={(e) => set({ points: s.points!.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
              <input className="input" aria-label={`Point ${i + 1} note`} placeholder="Note" value={p.sub} onChange={(e) => set({ points: s.points!.map((x, k) => (k === i ? { ...x, sub: e.target.value } : x)) })} />
              <Mini label="Remove this point" onClick={() => set({ points: s.points!.filter((_, k) => k !== i) })}>×</Mini>
            </div>
          ))}
          {s.points.length < 6 && <button type="button" className="btn small" onClick={() => set({ points: [...s.points!, { label: "Point", value: "£0", sub: "" }] })}>+ Add a point</button>}
        </fieldset>
      )}
      {s.table && (
        <fieldset className="deck-set"><legend>Table</legend>
          <div className="deck-grid" style={{ gridTemplateColumns: `repeat(${s.table.head.length}, 1fr) auto` }}>
            {s.table.head.map((h, j) => <input key={j} className="input" style={{ fontWeight: 700 }} aria-label={`Column ${j + 1} heading`} value={h} onChange={(e) => set({ ...detach, table: { ...s.table!, head: s.table!.head.map((x, k) => (k === j ? e.target.value : x)) } })} />)}<span />
            {s.table.rows.map((r, i) => (
              <div key={i} style={{ display: "contents" }}>
                {r.map((c, j) => <input key={j} className="input" aria-label={`Row ${i + 1} column ${j + 1}`} value={c} onChange={(e) => set({ ...detach, table: { ...s.table!, rows: s.table!.rows.map((x, k) => (k === i ? x.map((y, kk) => (kk === j ? e.target.value : y)) : x)) } })} />)}
                <Mini label={`Remove row ${i + 1}`} onClick={() => set({ table: { ...s.table!, rows: s.table!.rows.filter((_, k) => k !== i) } })}>×</Mini>
              </div>
            ))}
          </div>
          <div className="row-wrap" style={{ gap: 8 }}>
            <button type="button" className="btn small" onClick={() => set({ table: { ...s.table!, rows: [...s.table!.rows, s.table!.head.map(() => "")] } })}>+ Add a row</button>
            {s.table.head.length < 5 && <button type="button" className="btn small" onClick={() => set({ table: { head: [...s.table!.head, ""], rows: s.table!.rows.map((r) => [...r, ""]) } })}>+ Add a column</button>}
            {s.table.head.length > 2 && <button type="button" className="btn small" onClick={() => set({ table: { head: s.table!.head.slice(0, -1), rows: s.table!.rows.map((r) => r.slice(0, -1)) } })}>Remove the last column</button>}
          </div>
        </fieldset>
      )}
      {s.items && (
        <fieldset className="deck-set"><legend>Points</legend>
          {s.items.map((it, i) => (
            <div key={i} className="deck-row">
              <input className="input" aria-label={`Point ${i + 1}`} value={it.title} onChange={(e) => set({ items: s.items!.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} />
              <input className="input" aria-label={`Point ${i + 1} detail`} placeholder="Detail (optional)" value={it.text} onChange={(e) => set({ items: s.items!.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) })} />
              <Mini label="Move up" disabled={i === 0} onClick={() => set({ items: move(s.items!, i, -1) })}>↑</Mini><Mini label="Move down" disabled={i === s.items!.length - 1} onClick={() => set({ items: move(s.items!, i, 1) })}>↓</Mini>
              <Mini label="Remove this point" onClick={() => set({ items: s.items!.filter((_, k) => k !== i) })}>×</Mini>
            </div>
          ))}
          {s.items.length < 7 && <button type="button" className="btn small" onClick={() => set({ items: [...s.items!, { title: "Point", text: "" }] })}>+ Add a point</button>}
          <div className="deck-row"><input className="input" aria-label="Band, left" placeholder="Closing band, left" value={s.band?.left || ""} onChange={(e) => set({ band: { left: e.target.value, right: s.band?.right || "" } })} /><input className="input" aria-label="Band, right" placeholder="Closing band, right" value={s.band?.right || ""} onChange={(e) => set({ band: { left: s.band?.left || "", right: e.target.value } })} /></div>
        </fieldset>
      )}
      {s.big && <div className="deck-row"><input className="input" aria-label="Big figure" value={s.big.value} onChange={(e) => set({ big: { ...s.big!, value: e.target.value } })} /><input className="input" aria-label="What it is" value={s.big.caption} onChange={(e) => set({ big: { ...s.big!, caption: e.target.value } })} /></div>}
      {s.bullets && <Txt area label="Points (one per line)" value={s.bullets.join("\n")} onChange={(v) => set({ bullets: v.split("\n") })} />}
      {s.takeaway !== undefined && !["cover", "section", "checklist", "text"].includes(s.type) && <Txt label="Message at the foot of the slide" value={s.takeaway} onChange={(v) => set({ takeaway: v })} />}
      <div className="row-wrap" style={{ gap: 14 }}>
        <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={!!s.hidden} onChange={(e) => set({ hidden: e.target.checked })} /> Hide this slide</label>
        <label className="row-wrap" style={{ gap: 6, fontSize: 13 }} title="Left out of the presentation, the PDF and the PowerPoint unless you include internal slides"><input type="checkbox" checked={!!s.internal} onChange={(e) => set({ internal: e.target.checked })} /> For us only</label>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ branding

function BrandForm({ brand, set, firmLogo }: { brand: DeckBrand; set: (p: Partial<DeckBrand>) => void; firmLogo: string }) {
  const [error, setError] = useState("");
  const pick = async (file: File | undefined, key: "logo" | "cover") => {
    if (!file) return;
    setError("");
    try { set({ [key]: await pictureData(file, key === "logo" ? 500 : 1400, key === "logo") }); } catch (e) { setError(e instanceof Error ? e.message : "That picture could not be used."); }
  };
  return (
    <section className="card pad stack deck-brand" aria-label="Branding">
      <div className="grid-2">
        <div className="stack" style={{ gap: 8 }}>
          <strong>Client logo</strong>
          <div className="row-wrap" style={{ gap: 10 }}>
            {brand.logo ? <img src={brand.logo} alt="" className="deck-logo-preview" /> : <span className="muted">No logo yet</span>}
            <label className="btn small">{brand.logo ? "Change" : "Upload a logo"}<input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => void pick(e.target.files?.[0], "logo")} /></label>
            {brand.logo && <button type="button" className="btn small" onClick={() => set({ logo: "" })}>Remove</button>}
            {brand.logo && <button type="button" className="btn small" onClick={async () => { const c = await logoColour(brand.logo); if (c) set({ primary: c }); else setError("No clear colour was found in that logo."); }}>Use the logo's colour</button>}
          </div>
          <strong>Cover picture</strong>
          <div className="row-wrap" style={{ gap: 10 }}>
            {brand.cover ? <img src={brand.cover} alt="" className="deck-logo-preview" style={{ maxWidth: 120 }} /> : <span className="muted">None (the cover is plain)</span>}
            <label className="btn small">{brand.cover ? "Change" : "Upload a picture"}<input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => void pick(e.target.files?.[0], "cover")} /></label>
            {brand.cover && <button type="button" className="btn small" onClick={() => set({ cover: "" })}>Remove</button>}
          </div>
          {error && <p className="error-text" role="alert" style={{ margin: 0 }}>{error}</p>}
        </div>
        <div className="stack" style={{ gap: 8 }}>
          <div className="deck-colours">
            {([["primary", "Accent"], ["dark", "Dark panels"], ["background", "Background"]] as const).map(([k, label]) => (
              <label key={k} className="doc-field">{label}
                <span className="row-wrap" style={{ gap: 6 }}>
                  <input type="color" value={isHex(brand[k]) ? brand[k] : "#000000"} aria-label={label} onChange={(e) => set({ [k]: e.target.value })} />
                  <input className="input mono" style={{ width: 96 }} value={brand[k]} aria-label={`${label} colour code`} onChange={(e) => set({ [k]: e.target.value })} />
                </span>
              </label>
            ))}
          </div>
          <Txt label="Footer on every slide (optional)" value={brand.footer} onChange={(v) => set({ footer: v })} placeholder="e.g. Draft for discussion" />
          <div className="row-wrap" style={{ gap: 14 }}>
            <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={brand.serif} onChange={(e) => set({ serif: e.target.checked })} /> Serif headings</label>
            <label className="row-wrap" style={{ gap: 6, fontSize: 13 }}><input type="checkbox" checked={brand.firmLogo} disabled={!firmLogo} onChange={(e) => set({ firmLogo: e.target.checked })} /> Our logo{firmLogo ? "" : " (add it in Documents settings)"}</label>
          </div>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ presenting

function Present({ deck, slides, firmLogo, onClose }: { deck: Deck; slides: Slide[]; firmLogo: string; onClose: () => void }) {
  const [i, setI] = useState(0);
  const go = useCallback((by: number) => setI((x) => Math.max(0, Math.min(slides.length - 1, x + by))), [slides.length]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(1); }
      else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) { e.preventDefault(); go(-1); }
    };
    document.addEventListener("keydown", key);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => { document.removeEventListener("keydown", key); if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); };
  }, [go, onClose]);
  if (!slides.length) return null;
  return createPortal(
    <div className="deck-present" role="dialog" aria-label="Presenting" aria-modal="true">
      <div className="deck-present-stage" onClick={() => go(1)}><ScaledSlide slide={slides[i]} deck={deck} n={i + 1} total={slides.length} firmLogo={firmLogo} fit="box" /></div>
      <div className="deck-present-bar">
        <button type="button" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous slide">‹</button>
        <span>{i + 1} / {slides.length}</span>
        <button type="button" onClick={() => go(1)} disabled={i === slides.length - 1} aria-label="Next slide">›</button>
        <button type="button" onClick={onClose} aria-label="Stop presenting">Close</button>
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ the screen

declare global { interface Window { PptxGenJS?: new () => unknown } }
const loadPptx = (): Promise<new () => unknown> => new Promise((resolve, reject) => {
  if (window.PptxGenJS) return resolve(window.PptxGenJS);
  const s = document.createElement("script");
  s.src = "/pdf/pptxgen.bundle.js";
  s.onload = () => (window.PptxGenJS ? resolve(window.PptxGenJS) : reject(new Error("The PowerPoint maker did not load.")));
  s.onerror = () => reject(new Error("The PowerPoint maker did not load."));
  document.head.appendChild(s);
});

export function ClientDeck({ client, period }: { client: Client; period: string }) {
  const { data, store } = useData();
  const w = useWriter();
  const acc = useAccountsData();
  const meta = w.setup(DECK_ITEM) as { file?: string };
  const [deck, setDeckState] = useState<Deck | undefined>();
  const [state, setState] = useState<"loading" | "none" | "ready" | "error">(meta.file ? "loading" : "none");
  const [sel, setSel] = useState("");
  const [showBrand, setShowBrand] = useState(false);
  const [adding, setAdding] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const dirty = useRef(false), loaded = useRef(false);
  const timer = useRef<number>();
  const file = meta.file || deckFile(String(client.Key), period);
  const branding = useMemo(() => brandOf(readBranding(data.settings)), [data.settings]);
  const firmLogo = branding.logo || "";

  // open the saved deck
  useEffect(() => {
    if (!meta.file) { setState("none"); return; }
    if (dirty.current || loaded.current) return; // already open here: the saved copy is not newer
    let live = true;
    setState("loading");
    store.graph.download(meta.file).then((bytes) => {
      if (!live) return;
      const d = readDeck(JSON.parse(new TextDecoder().decode(bytes)));
      if (d) { loaded.current = true; setDeckState(d); setSel((s) => s || d.slides[0]?.id || ""); setState("ready"); } else setState("error");
    }, () => live && setState("error"));
    return () => { live = false; };
  }, [meta.file, store]);

  // save a little after the last change
  const persist = useCallback(async (d: Deck) => {
    try {
      await store.graph.put(`${file}:/content`, new TextEncoder().encode(JSON.stringify(d)), "application/json");
      if (!meta.file) await w.writeSetup(DECK_ITEM, { file });
      setSaved(`Saved ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`);
    } catch { setError("The deck could not be saved. Check the connection and make another change to try again."); }
  }, [store, file, meta.file, w]);
  const setDeck = useCallback((next: Deck | ((d: Deck) => Deck)) => {
    setDeckState((d) => {
      if (!d) return d;
      const n = typeof next === "function" ? next(d) : next;
      dirty.current = true;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { dirty.current = false; void persist(n); }, 900);
      return n;
    });
  }, [persist]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const input = useMemo<DeckInput>(() => {
    const f = accountsFigures(acc.maps || []), p = acc.priorMaps ? accountsFigures(acc.priorMaps) : undefined;
    const g = detailGroups(acc.maps || []), pg = acc.priorMaps ? detailGroups(acc.priorMaps) : undefined;
    return { clientName: client.Title, period, f, p, groups: { expenses: g.expenses, costs: g.costs }, priorGroups: pg ? { expenses: pg.expenses, costs: pg.costs } : undefined,
      queries: linesFor(data.paperLines, client.Key, period, "queries", "main").filter((l) => l.Detail.trim()).map((l) => ({ question: l.Detail, answer: l.Remark })) };
  }, [acc.maps, acc.priorMaps, client, period, data.paperLines]);

  const make = async () => {
    setBusy("make"); setError("");
    try {
      // the client's logo and colours carry over from last year's deck
      let brand: Partial<DeckBrand> = {};
      const prior = (setupOf(data.papers, client.Key, priorPeriod(period), DECK_ITEM) as { file?: string }).file;
      if (prior) { try { const d = readDeck(JSON.parse(new TextDecoder().decode(await store.graph.download(prior)))); if (d) brand = { ...d.brand, footer: d.brand.footer }; } catch { /* a first deck starts plain */ } }
      const d = starterDeck(input, brand);
      loaded.current = true; setDeckState(d); setSel(d.slides[0].id); setState("ready");
      await persist(d);
    } finally { setBusy(""); }
  };

  const slides = deck?.slides || [];
  const current = slides.find((s) => s.id === sel) || slides[0];
  const patchSlide = (id: string, p: Partial<Slide>) => setDeck((d) => ({ ...d, slides: d.slides.map((s) => (s.id === id ? { ...s, ...p } : s)) }));
  const shown = deck ? presentable(deck, internal) : [];

  const exportPptx = async () => {
    if (!deck) return;
    setBusy("pptx"); setError("");
    try {
      const Ctor = await loadPptx();
      const buf = await buildPptx(Ctor as never, deck, { includeInternal: internal, firmLogo, firmName: branding.practiceName });
      downloadFile(new Uint8Array(buf), `${period} ${client.Title} business review.pptx`.replace(/[\\/:*?"<>|]+/g, " "), "application/vnd.openxmlformats-officedocument.presentationml.presentation");
    } catch (e) { setError(e instanceof Error ? e.message : "The PowerPoint file could not be made."); } finally { setBusy(""); }
  };
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("deck-printing");
    const done = () => { document.body.classList.remove("deck-printing"); setPrinting(false); };
    window.addEventListener("afterprint", done, { once: true });
    const t = window.setTimeout(() => window.print(), 250);
    return () => { window.clearTimeout(t); window.removeEventListener("afterprint", done); document.body.classList.remove("deck-printing"); };
  }, [printing]);

  if (state === "none") return (
    <section className="card pad stack" aria-label="Client deck">
      <h2 style={{ margin: 0 }}>Client deck</h2>
      <p className="muted" style={{ margin: 0, maxWidth: "62ch" }}>Make a presentation to talk the client through their draft accounts: the headline, how profit moved, where the money went, what the company owns and owes, tax, your questions and next steps. It is worked out from the figures, and you can change every slide, add your own, and use the client's logo and colours.</p>
      {!acc.maps && <p className="notice" role="status">There is no trial balance for this year yet, so the slides will be empty. Add it in the working papers first.</p>}
      <div><button type="button" className="btn primary" disabled={busy === "make"} onClick={() => void make()}>{busy === "make" ? "Making the deck…" : "Make the deck"}</button></div>
      {error && <p className="error-text" role="alert">{error}</p>}
    </section>
  );
  if (state === "loading") return <section className="card pad" aria-label="Client deck"><p className="muted" role="status">Opening the deck…</p></section>;
  if (state === "error" || !deck || !current) return <section className="card pad stack" aria-label="Client deck"><p className="error-text" role="alert">The saved deck could not be opened.</p><div><button type="button" className="btn" onClick={() => void make()}>Start a new deck</button></div></section>;

  const idx = slides.findIndex((s) => s.id === current.id);
  return (
    <section className="stack client-deck" aria-label="Client deck">
      <div className="card pad row-wrap deck-bar">
        <strong style={{ fontSize: 16 }}>{client.Title}: client deck</strong>
        <span className="muted" style={{ fontSize: 12 }}>{saved || "Changes save as you go"}</span>
        <span className="deck-actions">
          <label className="row-wrap" style={{ gap: 6, fontSize: 13 }} title="Include the slides marked For us only"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Include internal slides</label>
          <button type="button" className="btn small" aria-expanded={showBrand} onClick={() => setShowBrand(!showBrand)}>Branding</button>
          <button type="button" className="btn small" title="Bring the standard slides' figures up to date with the accounts and papers" onClick={() => setDeck((d) => refreshDeck(d, input))}><Icon name="refresh" size={14} /> Refresh figures</button>
          <button type="button" className="btn small" disabled={!shown.length} onClick={() => setPrinting(true)}><Icon name="print" size={14} /> PDF</button>
          <button type="button" className="btn small" disabled={busy === "pptx"} onClick={() => void exportPptx()}><Icon name="download" size={14} /> {busy === "pptx" ? "Making…" : "PowerPoint"}</button>
          <button type="button" className="btn small primary" disabled={!shown.length} onClick={() => setPresenting(true)}>Present</button>
        </span>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {showBrand && <BrandForm brand={deck.brand} firmLogo={firmLogo} set={(p) => setDeck((d) => ({ ...d, brand: { ...d.brand, ...p } }))} />}

      <div className="deck-layout">
        <nav className="deck-thumbs card" aria-label="Slides">
          {slides.map((s, i) => (
            <div key={s.id} className={`deck-thumb${s.id === current.id ? " on" : ""}${s.hidden ? " hid" : ""}`}>
              <button type="button" className="deck-thumb-pic" aria-label={`Slide ${i + 1}: ${s.title}`} aria-current={s.id === current.id} onClick={() => setSel(s.id)}>
                <ScaledSlide slide={s} deck={deck} n={i + 1} total={slides.length} firmLogo={firmLogo} />
              </button>
              <div className="deck-thumb-bar"><span>{i + 1}{s.hidden ? " · hidden" : s.internal ? " · us only" : ""}</span>
                <Mini label="Move up" disabled={i === 0} onClick={() => setDeck((d) => moveSlide(d, s.id, -1))}>↑</Mini><Mini label="Move down" disabled={i === slides.length - 1} onClick={() => setDeck((d) => moveSlide(d, s.id, 1))}>↓</Mini>
                <Mini label="Copy this slide" onClick={() => setDeck((d) => duplicateSlide(d, s.id))}>⧉</Mini>
                <Mini label="Delete this slide" disabled={slides.length === 1} onClick={() => { if (window.confirm(`Delete "${s.title}"?`)) { setDeck((d) => ({ ...d, slides: d.slides.filter((x) => x.id !== s.id) })); if (s.id === current.id) setSel(slides[Math.max(0, i - 1)].id); } }}>×</Mini>
              </div>
            </div>
          ))}
          <div className="stack" style={{ gap: 6 }}>
            <button type="button" className="btn small" aria-expanded={adding} onClick={() => setAdding(!adding)}>+ Add a slide</button>
            {adding && (
              <div className="deck-gallery" role="menu">
                {SLIDE_TYPES.map((t) => <button key={t.type} type="button" role="menuitem" onClick={() => { const n = blankSlide(t.type as SlideType); setDeck((d) => ({ ...d, slides: [...d.slides.slice(0, idx + 1), n, ...d.slides.slice(idx + 1)] })); setSel(n.id); setAdding(false); }}><strong>{t.name}</strong><span>{t.hint}</span></button>)}
              </div>
            )}
          </div>
        </nav>
        <div className="deck-main stack">
          <div className="card deck-preview"><ScaledSlide slide={current} deck={deck} n={idx + 1} total={slides.length} firmLogo={firmLogo} /></div>
          <label className="doc-field">Speaker notes (not shown to the client)
            <textarea className="input" rows={3} value={current.notes} onChange={(e) => patchSlide(current.id, { notes: e.target.value })} placeholder="Sources, caveats and what to say" />
          </label>
        </div>
        <aside className="card pad deck-form" aria-label="Edit this slide">
          <h3 style={{ margin: "0 0 10px" }}>Edit slide {idx + 1}</h3>
          <SlideForm s={current} set={(p) => patchSlide(current.id, p)} />
        </aside>
      </div>

      {presenting && <Present deck={deck} slides={shown} firmLogo={firmLogo} onClose={() => setPresenting(false)} />}
      {printing && createPortal(
        <div className="deck-print-root" aria-hidden="true">
          {shown.map((s, i) => <div className="deck-page" key={s.id}><DeckSlide slide={s} deck={deck} n={i + 1} total={shown.length} firmLogo={firmLogo} /></div>)}
        </div>, document.body)}
    </section>
  );
}
