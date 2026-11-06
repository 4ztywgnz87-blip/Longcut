// A bottom sheet that follows the finger between two resting positions:
// open (whole panel visible) and collapsed (only its top strip visible).
// Past either end it gives a little with growing resistance and springs back.
//
// While dragging, the panel is moved directly (no React re-render per finger move),
// so it stays smooth on phones. React only hears about the result.
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';

/** How far the panel extends below the screen (see .sheet in styles.css). */
export const SHEET_EXTENSION = 120;
const SPRING = 'transform 0.35s cubic-bezier(0.3, 1.4, 0.5, 1)';

/** iOS-like rubber band: gives way easily at first, then harder, never past `max`. */
function rubber(distance: number, max: number): number {
  return max * (1 - 1 / ((distance * 0.55) / max + 1));
}

export function useBottomSheet(
  sheetRef: React.RefObject<HTMLElement | null>,
  followerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  screenKey: string,
) {
  const [collapsed, setCollapsed] = useState(false);
  const dragging = useRef(false);
  // range = how far the panel moves down from open to collapsed
  const [range, setRange] = useState(0);
  // height of the panel that is on screen when open
  const [openHeight, setOpenHeight] = useState(0);
  const [width, setWidth] = useState(0);
  const justDragged = useRef(false);

  // a new screen always opens with its panel shown
  useLayoutEffect(() => setCollapsed(false), [screenKey]);

  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const measure = () => {
      const ext = enabled ? SHEET_EXTENSION : 0;
      const appHeight = el.parentElement?.clientHeight ?? innerHeight;
      // offsetTop ignores transforms, so this is the open position
      const visible = Math.max(0, Math.min(el.offsetHeight - ext, appHeight - el.offsetTop));
      // the strip that stays visible when collapsed ends at the element marked data-peek
      const peek = el.querySelector<HTMLElement>('[data-peek]');
      const pad = parseFloat(getComputedStyle(el).paddingBottom) - ext; // home bar + margin
      const peekHeight = peek ? peek.offsetTop + peek.offsetHeight + Math.max(pad, 12) + 4 : visible;
      setOpenHeight(visible);
      setWidth(el.offsetWidth);
      setRange(enabled ? Math.max(0, visible - peekHeight) : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el, { box: 'border-box' });
    addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      removeEventListener('resize', measure);
    };
  }, [sheetRef, enabled, screenKey]);

  const rest = collapsed && enabled ? range : 0;

  /** Puts the panel (and the button that follows it) at offset `pos` from open. */
  const place = useCallback(
    (pos: number, animate: boolean, restNow: number) => {
      const el = sheetRef.current;
      if (!el) return;
      const transition = animate ? SPRING : 'none';
      el.style.transition = transition;
      el.style.transform = enabled ? `translateY(${pos}px)` : '';
      // 0 = open … 1 = collapsed, used by CSS to fade the summary and the body
      const progress = enabled && range > 0 ? Math.min(1, Math.max(0, pos / range)) : 0;
      el.style.setProperty('--sheet-progress', String(progress));
      const f = followerRef.current;
      if (f) {
        f.style.transition = transition;
        f.style.transform = enabled ? `translateY(${pos - restNow}px)` : '';
      }
    },
    [sheetRef, followerRef, enabled, range],
  );

  // settle at the resting position whenever it changes (open/collapse, resize, new screen)
  useLayoutEffect(() => {
    if (!dragging.current) place(rest, true, rest);
  }, [place, rest, screenKey]);

  // latest values for the window listeners of a running gesture
  const live = useRef({ rest, range, place });
  live.current = { rest, range, place };

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || e.button !== 0) return;
      const startY = e.clientY;
      const { rest: start, range: r, place: put } = live.current;
      let started = false;
      let p = start;
      // recent finger positions, to measure how fast it moved at the end
      const samples: { y: number; t: number }[] = [{ y: startY, t: performance.now() }];

      const move = (ev: PointerEvent) => {
        const dy = ev.clientY - startY;
        if (!started && Math.abs(dy) > 6) {
          started = true;
          dragging.current = true;
          sheetRef.current?.classList.add('dragging');
        }
        if (!started) return;
        const now = performance.now();
        samples.push({ y: ev.clientY, t: now });
        while (samples.length > 2 && now - samples[0].t > 120) samples.shift();
        const raw = start + dy;
        // follow the finger between open (0) and collapsed (r); resist beyond either end
        p = raw < 0 ? -rubber(-raw, 28) : raw > r ? r + rubber(raw - r, 28) : raw;
        put(p, false, start);
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
        if (!started) return;
        justDragged.current = true;
        setTimeout(() => (justDragged.current = false), 80);
        // Throw the panel: project where it would end up from the speed at the end of the
        // drag, then pick the nearest resting position. A finger held still has no speed.
        const last = samples[samples.length - 1];
        const first = samples[0];
        const held = performance.now() - last.t > 120;
        const velocity = held || last.t === first.t ? 0 : (last.y - first.y) / (last.t - first.t); // px/ms
        const toCollapsed = p + velocity * 250 > r / 2;
        dragging.current = false;
        sheetRef.current?.classList.remove('dragging');
        // spring to the chosen spot now; React then records the new state
        put(toCollapsed ? r : 0, true, toCollapsed ? r : 0);
        setCollapsed(toCollapsed);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    },
    [enabled, sheetRef],
  );

  /** Swallows the click that follows a drag, so buttons under the finger don't fire. */
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (justDragged.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return {
    collapsed: collapsed && enabled,
    setCollapsed,
    /** how much of the screen the resting panel covers */
    coveredHeight: Math.max(0, openHeight - rest),
    width,
    handlers: { onPointerDown, onClickCapture },
  };
}
