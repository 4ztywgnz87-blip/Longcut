import { useRef } from 'react';

interface Props {
  collapsed: boolean;
  onChange: (collapsed: boolean) => void;
  /** Live drag offset in px while the finger moves (null when released). */
  onDrag: (dy: number | null) => void;
}

/**
 * The grab bar on top of a panel. Drag it down and the panel follows your finger;
 * let go past a short distance and it hides, otherwise it springs back. Drag up (or
 * tap) to show it again.
 */
export default function SheetHandle({ collapsed, onChange, onDrag }: Props) {
  const startY = useRef<number | null>(null);
  const lastDy = useRef(0);

  const end = () => {
    if (startY.current == null) return;
    const dy = lastDy.current;
    startY.current = null;
    onDrag(null);
    if (Math.abs(dy) < 6) onChange(!collapsed); // a tap
    else if (!collapsed && dy > 60) onChange(true);
    else if (collapsed && dy < -20) onChange(false);
  };

  return (
    <button
      type="button"
      className="sheet-handle"
      aria-label={collapsed ? 'Show panel' : 'Hide panel'}
      aria-expanded={!collapsed}
      onPointerDown={(e) => {
        startY.current = e.clientY;
        lastDy.current = 0;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (startY.current == null) return;
        const dy = e.clientY - startY.current;
        lastDy.current = dy;
        // open panel: follows the finger down; hidden panel: lifts a little, with resistance
        onDrag(collapsed ? Math.max(-40, Math.min(0, dy)) * 0.5 : Math.max(0, dy));
      }}
      onPointerUp={end}
      onPointerCancel={() => {
        startY.current = null;
        onDrag(null);
      }}
      // keyboard (Enter/Space) has no pointer events
      onClick={(e) => e.detail === 0 && onChange(!collapsed)}
    >
      <span />
    </button>
  );
}
