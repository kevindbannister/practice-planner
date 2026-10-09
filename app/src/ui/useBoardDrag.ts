// Dragging cards on the planning board, with a mouse, pen or finger.
//
// - Mouse or pen: press on a card and move a few pixels.
// - Touch: press on the card's grip and move straight away, or press and hold anywhere on
//   the card for a moment (so an ordinary swipe still scrolls the page).
//
// Anything marked data-drop="<target>" is a drop target. A floating copy of the card follows
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

export function useBoardDrag(onDrop: (key: string, target: string) => void) {
  const [dragKey, setDragKey] = useState<string>();
  const [target, setTarget] = useState<string>();
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  // one set of handlers for the life of the board, so listeners add and remove cleanly
  const drag = useMemo(() => {
    let pending: Pending | null = null;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let pos = { x: 0, y: 0 };
    let over: string | undefined;
    let raf = 0;
    let justDropped = false;

    const hitTest = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const t = el?.closest<HTMLElement>("[data-drop]")?.dataset.drop;
      if (t !== over) {
        over = t;
        setTarget(t);
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
      if (pending?.timer) window.clearTimeout(pending.timer);
      pending?.el.classList.remove("lifting");
      pending = null;
      dragging = false;
      cancelAnimationFrame(raf);
      ghost?.remove();
      ghost = null;
      over = undefined;
      document.body.classList.remove("is-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cleanup);
      document.removeEventListener("touchmove", stopTouchScroll);
      setDragKey(undefined);
      setTarget(undefined);
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
      const wasDragging = dragging;
      cleanup();
      if (!wasDragging) return;
      justDropped = true;
      window.setTimeout(() => (justDropped = false), 60);
      if (t) dropRef.current(key, t);
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

  return { dragKey, target, cardProps };
}
