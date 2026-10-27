// The client Overview as cards the user can arrange: move, resize, then Save. Until Save is pressed the page stays in
// arrange mode and nothing is kept. The arrangement is saved per signed-in person (in the planner's Settings list).
import { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useData } from "./data";
import { COLS, GAP, MIN_W, ROW, Layout, Measured, autoHeight, defaultLayout, heightOf, moveItem, parseLayout, readingOrder, reconcile, resizeItem, rowsFor, settle } from "../lib/overviewLayout";

export type OverviewCard = { id: string; label: string; node: ReactNode };
export type DefaultColumn = { w: number; ids: string[] };

const NARROW = 900; // below this the cards stack in one column and can't be rearranged

function savedFor(settings: { Key?: unknown; Value?: unknown }[], key: string): Layout | null {
  const row = settings.find((s) => s.Key === key);
  if (!row) return null;
  try { return parseLayout(JSON.parse(String(row.Value ?? ""))); } catch { return null; }
}

type Drag = { id: string; mode: "move" | "e" | "s" | "se"; sx: number; sy: number; start: Layout; px: number };

export function OverviewGrid({ cards, columns, name }: { cards: OverviewCard[]; columns: DefaultColumn[]; name: string }) {
  const { data, saveSetting, user } = useData();
  const key = `overviewLayout:${user || "me"}`;
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [measured, setMeasured] = useState<Measured>({});
  const [draft, setDraft] = useState<Layout | null>(null); // non-null while arranging
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const bodies = useRef(new Map<string, HTMLElement>());

  const ids = useMemo(() => cards.map((c) => c.id), [cards]);
  const idKey = ids.join("|");
  const fallback = useMemo(() => defaultLayout(columns.map((c) => ({ w: c.w, ids: c.ids.filter((i) => ids.includes(i)) }))), [columns, idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const saved = useMemo(() => savedFor(data.settings, key), [data.settings, key]);
  const base = useMemo(() => reconcile(saved, ids, fallback), [saved, idKey, fallback]); // eslint-disable-line react-hooks/exhaustive-deps
  const layout = useMemo(() => settle(draft ?? base, measured), [draft, base, measured]);
  const narrow = width > 0 && width < NARROW;
  const arranging = draft !== null && !narrow;

  // width of the area
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // how tall each card's content is
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      setMeasured((m) => {
        let changed = false;
        const next: Measured = { ...m };
        bodies.current.forEach((el, id) => {
          const r = rowsFor(el.scrollHeight);
          if (next[id] !== r) { next[id] = r; changed = true; }
        });
        return changed ? next : m;
      });
    });
    bodies.current.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [idKey, narrow, width > 0]);

  const colW = width > 0 ? (width + GAP) / COLS : 0;

  const begin = (e: React.PointerEvent, id: string, mode: Drag["mode"]) => {
    if (!arranging || !draft) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const it = layout.find((i) => i.id === id)!;
    const rows = it.h ?? measured[id] ?? 20;
    setDrag({ id, mode, sx: e.clientX, sy: e.clientY, start: layout, px: rows * ROW });
  };
  const track = (e: React.PointerEvent) => {
    if (!drag || !colW) return;
    const dx = Math.round((e.clientX - drag.sx) / colW);
    const it = drag.start.find((i) => i.id === drag.id)!;
    if (drag.mode === "move") {
      setDraft(moveItem(drag.start, measured, drag.id, it.x + dx, Math.max(0, it.y + Math.round((e.clientY - drag.sy) / ROW))));
    } else {
      const w = drag.mode === "s" ? it.w : it.w + dx;
      const h = drag.mode === "e" ? it.h : (drag.px + (e.clientY - drag.sy)) / ROW;
      setDraft(resizeItem(drag.start, measured, drag.id, w, h));
    }
  };
  const end = () => { if (drag) setDraft((d) => (d ? settle(d, measured) : d)); setDrag(null); };

  const key4 = (e: React.KeyboardEvent, id: string) => {
    if (!draft) return;
    const it = layout.find((i) => i.id === id)!;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!d) return;
    e.preventDefault();
    const rows = it.h ?? measured[id] ?? 20;
    if (e.shiftKey) setDraft(resizeItem(layout, measured, id, it.w + d[0], (rows + d[1] * 2) as number));
    else setDraft(moveItem(layout, measured, id, it.x + d[0], Math.max(0, it.y + d[1] * 2)));
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setErr("");
    try {
      await saveSetting(key, settle(draft, measured).map(({ id, x, y, w, h }) => (h ? { id, x, y, w, h } : { id, x, y, w })));
      setDraft(null);
    } catch {
      setErr("Couldn't save the layout. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const reset = () => setDraft(settle(fallback, measured));
  const setBody = useCallback((id: string) => (el: HTMLElement | null) => { if (el) bodies.current.set(id, el); else bodies.current.delete(id); }, []);

  const stacked = narrow ? readingOrder(layout).map((id) => cards.find((c) => c.id === id)!).filter(Boolean) : null;

  return (
    <div>
      {!narrow && (
        <div className="ovg-bar no-print" role="toolbar" aria-label={`Arrange ${name}`}>
          {arranging ? (
            <>
              <span className="muted">Drag a card to move it. Drag its right edge, bottom edge or corner to resize. Arrow keys move; Shift and arrows resize.</span>
              <span className="grow" />
              {err && <span className="error-text" role="alert">{err}</span>}
              <button type="button" className="btn" onClick={reset} disabled={busy}>Standard layout</button>
              <button type="button" className="btn" onClick={() => { setDraft(null); setErr(""); }} disabled={busy}>Cancel</button>
              <button type="button" className="btn primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save layout"}</button>
            </>
          ) : (
            <>
              <span className="grow" />
              <button type="button" className="btn" onClick={() => setDraft(settle(base, measured))}>Arrange cards</button>
            </>
          )}
        </div>
      )}

      {stacked ? (
        <div className="ov-col">{stacked.map((c) => <div key={c.id} className="ovg-stack">{c.node}</div>)}</div>
      ) : (
        <div ref={wrap} className={`ovg${arranging ? " arranging" : ""}`} style={{ height: colW ? heightOf(layout, measured) * ROW : undefined }}>
          {colW > 0 && layout.map((it) => {
            const c = cards.find((x) => x.id === it.id);
            if (!c) return null;
            const active = drag?.id === it.id;
            const rows = it.h ?? measured[it.id];
            return (
              <div
                key={it.id}
                className={`ovi${active ? " active" : ""}${drag && !active ? " moving" : ""}`}
                style={{ left: it.x * colW, top: it.y * ROW, width: it.w * colW - GAP, height: it.h ? it.h * ROW - GAP : undefined, minWidth: MIN_W * colW - GAP, visibility: rows ? undefined : "hidden" }}
              >
                <div className="ovi-body" ref={setBody(it.id)} style={it.h ? { height: "100%", overflow: "auto" } : undefined}>{c.node}</div>
                {arranging && (
                  <div
                    className="ovi-edit"
                    role="group"
                    tabIndex={0}
                    aria-label={`${c.label}: drag to move, arrow keys to move, shift and arrows to resize`}
                    onPointerDown={(e) => begin(e, it.id, "move")}
                    onPointerMove={track}
                    onPointerUp={end}
                    onPointerCancel={end}
                    onKeyDown={(e) => key4(e, it.id)}
                  >
                    <span className="ovi-tag">⠿ {c.label}</span>
                    {it.h ? <button type="button" className="ovi-auto" onPointerDown={(e) => e.stopPropagation()} onClick={() => setDraft(autoHeight(layout, measured, it.id))}>Auto height</button> : null}
                    <span className="ovi-h e" onPointerDown={(e) => begin(e, it.id, "e")} onPointerMove={track} onPointerUp={end} onPointerCancel={end} />
                    <span className="ovi-h s" onPointerDown={(e) => begin(e, it.id, "s")} onPointerMove={track} onPointerUp={end} onPointerCancel={end} />
                    <span className="ovi-h se" onPointerDown={(e) => begin(e, it.id, "se")} onPointerMove={track} onPointerUp={end} onPointerCancel={end} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
