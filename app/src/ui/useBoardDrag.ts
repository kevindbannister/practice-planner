// Dragging cards on the planning board, with a mouse, pen or finger.
//
// - Mouse or pen: press on a card and move a few pixels.
// - Touch: press on the card's grip and move straight away, or press and hold anywhere on
//   the card for a moment (so an ordinary swipe still scrolls the page).
//
// Holding a card over data-drop="week-prev" or "week-next" (the screen edges) turns the week
// back or on, again every second while it stays there; nothing is dropped there.
// Anything marked data-drop="<target>" is a drop target. A target that also has data-order
// lets cards (marked data-card) be dropped between others: the drop says where. A target with
// data-time (the hours view) says what time the card's top edge is at instead, in minutes from
// midnight, to the quarter hour; it needs data-from (minutes at its top) and data-ppm (pixels a minute). A floating copy of the card follows
// the pointer, and the page scrolls when you drag near the top or bottom edge.
import { PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

const HOLD_MS = 320;
const MOVE_PX = 5; // mouse movement before a press becomes a drag
const SLOP_PX = 10; // finger movement that means "scrolling", not "holding"
const EDGE_PX = 70;

type Pending = {
  key: string;
  el: HTMLElement;
  pointerId: number;
  touch: boolean;
  fromGrip: boolean;
  x: number;
  y: number;
  dx: number; // pointer position within the card
  dy: number;
  timer?: number;
};

const EDGE_WAIT_MS = 500; // hold at an edge this long before the week turns
const EDGE_REPEAT_MS = 1000;

export function useBoardDrag(onDrop: (key: string, target: string, at?: number, kind?: "index" | "time") => void, onEdge?: (by: 1 | -1) => void) {
  const [dragKey, setDragKey] = useState<string>();
  const [target, setTarget] = useState<string>();
  const [insertAt, setInsertAt] = useState<number>();
  const [dropKind, setDropKind] = useState<"index" | "time">();
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;
  const edgeRef = useRef(onEdge);
  edgeRef.current = onEdge;

  // one set of handlers for the life of the board, so listeners add and remove cleanly
  const drag = useMemo(() => {
    let pending: Pending | null = null;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let pos = { x: 0, y: 0 };
    let over: string | undefined;
    let at: number | undefined;
    let kind: "index" | "time" | undefined;
    let raf = 0;
    let justDropped = false;
    let edgeTimer = 0;
    let edgeLocked = false; // the drag began at an edge: wait until the card has left it
    const clearEdge = () => {
      window.clearTimeout(edgeTimer);
      edgeTimer = 0;
    };
    const armEdge = (t: string | undefined) => {
      clearEdge();
      if (t !== "week-next" && t !== "week-prev") {
        edgeLocked = false;
        return;
      }
      if (edgeLocked) return;
      const by = t === "week-next" ? 1 : -1;
      const turn = () => {
        if (!dragging || over !== t) return;
        edgeRef.current?.(by);
        if (pending?.touch) navigator.vibrate?.(8);
        edgeTimer = window.setTimeout(turn, EDGE_REPEAT_MS);
      };
      edgeTimer = window.setTimeout(turn, EDGE_WAIT_MS);
    };

    const hitTest = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const zone = el?.closest<HTMLElement>("[data-drop]");
      const t = zone?.dataset.drop;
      if (t !== over) {
        over = t;
        setTarget(t);
        armEdge(t);
      }
      // where among the day's cards it would land
      let i: number | undefined;
      let k: "index" | "time" | undefined;
      if (zone && zone.dataset.time !== undefined) {
        // the time at the floating card's top edge
        const r = zone.getBoundingClientRect();
        const top = y - (pending ? pending.dy * scale() : 0);
        const from = Number(zone.dataset.from || 0), ppm = Number(zone.dataset.ppm || 1);
        const m = Math.round((from + (top - r.top) / ppm) / 15) * 15;
        i = Math.max(0, Math.min(24 * 60 - 15, m));
        k = "time";
      } else if (zone && zone.dataset.order !== undefined) {
        k = "index";
        const cards = [...zone.querySelectorAll<HTMLElement>("[data-card]")].filter((c) => c.dataset.card !== pending?.key);
        i = cards.filter((c) => {
          const r = c.getBoundingClientRect();
          return r.top + r.height / 2 < y;
        }).length;
      }
      if (i !== at || k !== kind) {
        at = i;
        kind = k;
        setInsertAt(i);
        setDropKind(k);
      }
    };

    // on a touch screen the floating card is smaller, so the finger and the day strip stay visible
    const scale = () => (pending?.touch ? 0.8 : 1);
    const placeGhost = () => {
      if (!ghost || !pending) return;
      const s = scale();
      ghost.style.transform = `translate(${pos.x - pending.dx * s}px, ${pos.y - pending.dy * s}px) scale(${s})`;
    };

    // scroll the page (and the week, if it scrolls sideways) near the edges while dragging
    const autoScroll = () => {
      if (!dragging) return;
      const { x, y } = pos;
      const h = window.innerHeight;
      let dy = 0;
      if (y < EDGE_PX + 60) dy = -Math.ceil((EDGE_PX + 60 - y) / 6);
      else if (y > h - EDGE_PX) dy = Math.ceil((y - (h - EDGE_PX)) / 6);
      if (dy) window.scrollBy(0, dy);
      const week = document.querySelector<HTMLElement>(".week");
      if (week && week.scrollWidth > week.clientWidth + 1) {
        const r = week.getBoundingClientRect();
        if (y > r.top && y < r.bottom) {
          if (x < r.left + 40) week.scrollLeft -= 12;
          else if (x > r.right - 40) week.scrollLeft += 12;
        }
      }
      if (dy) hitTest(x, y);
      raf = requestAnimationFrame(autoScroll);
    };

    const stopTouchScroll = (e: TouchEvent) => {
      if (dragging) e.preventDefault();
    };

    const cleanup = () => {
      clearEdge();
      if (pending?.timer) window.clearTimeout(pending.timer);
      pending?.el.classList.remove("lifting");
      pending = null;
      dragging = false;
      cancelAnimationFrame(raf);
      ghost?.remove();
      ghost = null;
      over = undefined;
      at = undefined;
      kind = undefined;
      document.body.classList.remove("is-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cleanup);
      document.removeEventListener("touchmove", stopTouchScroll);
      setDragKey(undefined);
      setTarget(undefined);
      setInsertAt(undefined);
      setDropKind(undefined);
    };

    const start = () => {
      if (!pending || dragging) return;
      dragging = true;
      pending.el.classList.remove("lifting");
      const rect = pending.el.getBoundingClientRect();
      const g = pending.el.cloneNode(true) as HTMLElement;
      g.classList.add("drag-ghost");
      g.setAttribute("aria-hidden", "true");
      g.style.width = `${rect.width}px`;
      document.body.appendChild(g);
      ghost = g;
      placeGhost();
      document.body.classList.add("is-dragging");
      document.addEventListener("touchmove", stopTouchScroll, { passive: false });
      if (pending.touch) navigator.vibrate?.(12);
      setDragKey(pending.key);
      edgeLocked = pos.x < 60 || pos.x > window.innerWidth - 60;
      hitTest(pos.x, pos.y);
      raf = requestAnimationFrame(autoScroll);
    };

    function onMove(e: PointerEvent) {
      if (!pending || e.pointerId !== pending.pointerId) return;
      pos = { x: e.clientX, y: e.clientY };
      if (!dragging) {
        const moved = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
        if (pending.touch && !pending.fromGrip) {
          if (moved > SLOP_PX) cleanup(); // they're scrolling
        } else if (moved > MOVE_PX) {
          start();
        }
        return;
      }
      placeGhost();
      hitTest(e.clientX, e.clientY);
    }

    function onUp(e: PointerEvent) {
      if (!pending || e.pointerId !== pending.pointerId) return;
      const key = pending.key;
      const t = over;
      const where = at;
      const whereKind = kind;
      const wasDragging = dragging;
      cleanup();
      if (!wasDragging) return;
      justDropped = true;
      window.setTimeout(() => (justDropped = false), 60);
      if (t && !t.startsWith("week-")) dropRef.current(key, t, where, whereKind);
    }

    const pointerDown = (key: string, e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (pending) cleanup();
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const touch = e.pointerType === "touch";
      const fromGrip = !!(e.target as HTMLElement).closest(".pcard-grip");
      pending = { key, el, pointerId: e.pointerId, touch, fromGrip, x: e.clientX, y: e.clientY, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      pos = { x: e.clientX, y: e.clientY };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", cleanup);
      if (touch && fromGrip) {
        start();
      } else if (touch) {
        el.classList.add("lifting");
        pending.timer = window.setTimeout(start, HOLD_MS);
      }
    };

    return {
      cleanup,
      pointerDown,
      isTouchPending: () => !!pending?.touch,
      justDropped: () => justDropped,
    };
  }, []);

  useEffect(() => drag.cleanup, [drag]);

  /** Spread onto each card. */
  const cardProps = (key: string) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => drag.pointerDown(key, e),
    // a long press shouldn't open the phone's own menu
    onContextMenu: (e: { preventDefault: () => void }) => {
      if (drag.isTouchPending()) e.preventDefault();
    },
    // the click that ends a drag shouldn't open the card
    onClickCapture: (e: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (drag.justDropped()) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
  });

  return { dragKey, target, insertAt, dropKind, cardProps };
}
