import { useRef } from 'react';

interface Props {
  collapsed: boolean;
  onChange: (collapsed: boolean) => void;
}

/** The grab bar on top of a panel: swipe down to hide it, up to show it, or tap to toggle. */
export default function SheetHandle({ collapsed, onChange }: Props) {
  const startY = useRef<number | null>(null);
  return (
    <button
      type="button"
      className="sheet-handle"
      aria-label={collapsed ? 'Show panel' : 'Hide panel'}
      aria-expanded={!collapsed}
      onPointerDown={(e) => {
        startY.current = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={(e) => {
        const dy = startY.current == null ? 0 : e.clientY - startY.current;
        startY.current = null;
        if (dy > 24) onChange(true);
        else if (dy < -24) onChange(false);
        else onChange(!collapsed);
      }}
      onPointerCancel={() => (startY.current = null)}
      // keyboard (Enter/Space) has no pointer events
      onClick={(e) => e.detail === 0 && onChange(!collapsed)}
    >
      <span />
    </button>
  );
}
