import type React from 'react';

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
}

/** The grab bar on top of a panel: drag it, or tap it to hide/show the panel. */
export default function SheetHandle({ collapsed, onToggle, handlers }: Props) {
  return (
    <button
      type="button"
      className="sheet-handle"
      aria-label={collapsed ? 'Show panel' : 'Hide panel'}
      aria-expanded={!collapsed}
      onPointerDown={handlers.onPointerDown}
      onClickCapture={handlers.onClickCapture}
      // a drag already decided; only a real tap toggles
      onClick={(e) => !e.defaultPrevented && onToggle()}
    >
      <span />
    </button>
  );
}
