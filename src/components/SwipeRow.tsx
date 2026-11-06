// A list row you can swipe to the left to show a Delete button, like in iPhone apps.
import { useRef } from 'react';
import type React from 'react';
import { Icon } from './Icon';

const WIDTH = 88; // width of the Delete button

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}

export default function SwipeRow({ open, onOpenChange, onSelect, onDelete, children }: Props) {
  const content = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ x: number; y: number; base: number; swiping: boolean; offset: number } | null>(null);
  const swallowClick = useRef(false);

  const place = (x: number, animate: boolean) => {
    const el = content.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1)' : 'none';
    el.style.transform = x ? `translateX(${x}px)` : '';
  };

  return (
    <li className={`swipe-row ${open ? 'open' : ''}`}>
      <button type="button" className="swipe-delete" tabIndex={open ? 0 : -1} aria-hidden={!open} onClick={onDelete}>
        <Icon name="trash" size={20} />
        Delete
      </button>
      <button
        type="button"
        ref={content}
        className="saved-item"
        style={{ transform: open ? `translateX(${-WIDTH}px)` : undefined }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, base: open ? -WIDTH : 0, swiping: false, offset: open ? -WIDTH : 0 };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.swiping) {
            if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (drag.current = null); // scrolling
            if (Math.abs(dx) < 8) return;
            d.swiping = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          let x = d.base + dx;
          if (x > 0) x = x / 4; // a little give the wrong way
          if (x < -WIDTH) x = -WIDTH + (x + WIDTH) / 3;
          d.offset = x;
          place(x, false);
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d?.swiping) return;
          swallowClick.current = true;
          const next = d.offset < -WIDTH / 2;
          place(next ? -WIDTH : 0, true);
          onOpenChange(next);
        }}
        onPointerCancel={() => {
          drag.current = null;
          place(open ? -WIDTH : 0, true);
        }}
        onClick={() => {
          if (swallowClick.current) return void (swallowClick.current = false);
          if (open) {
            place(0, true);
            onOpenChange(false);
          } else onSelect();
        }}
      >
        {children}
      </button>
    </li>
  );
}
