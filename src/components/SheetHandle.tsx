import { useRef } from 'react';
import type React from 'react';

/**
 * Drag behaviour for a panel. The panel follows the finger; let go past a short
 * distance and it hides (or shows), otherwise it springs back. A drag never counts
 * as a tap, so buttons under the finger don't fire after a drag.
 */
export function useSheetDrag(collapsed: boolean, onChange: (collapsed: boolean) => void, onDrag: (dy: number | null) => void) {
  const justDragged = useRef(false);
  // latest values for the window listeners of a running gesture
  const latest = useRef({ collapsed, onChange, onDrag });
  latest.current = { collapsed, onChange, onDrag };

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      const startY = e.clientY;
      let dy = 0;
      let dragging = false;
      // follow the finger anywhere on screen, not only while it is over the panel
      const move = (ev: PointerEvent) => {
        dy = ev.clientY - startY;
        if (!dragging && Math.abs(dy) > 6) dragging = true;
        if (dragging) {
          const { collapsed: c, onDrag: d } = latest.current;
          // open panel follows the finger down; a hidden panel lifts with some resistance
          d(c ? Math.max(-60, Math.min(0, dy)) * 0.6 : Math.max(0, dy));
        }
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
        if (!dragging) return;
        justDragged.current = true;
        setTimeout(() => (justDragged.current = false), 80);
        const { collapsed: c, onChange: change, onDrag: d } = latest.current;
        d(null);
        if (!c && dy > 50) change(true);
        else if (c && dy < -15) change(false);
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    },
    // swallow the click that follows a drag
    onClickCapture: (e: React.MouseEvent) => {
      if (justDragged.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
  };
  return handlers;
}

interface Props {
  collapsed: boolean;
  onChange: (collapsed: boolean) => void;
  onDrag: (dy: number | null) => void;
}

/** The grab bar on top of a panel: drag it, or tap it to hide/show the panel. */
export default function SheetHandle({ collapsed, onChange, onDrag }: Props) {
  const drag = useSheetDrag(collapsed, onChange, onDrag);
  return (
    <button
      type="button"
      className="sheet-handle"
      aria-label={collapsed ? 'Show panel' : 'Hide panel'}
      aria-expanded={!collapsed}
      {...drag}
      // a drag already decided; only a real tap toggles
      onClick={(e) => !e.defaultPrevented && onChange(!collapsed)}
    >
      <span />
    </button>
  );
}
