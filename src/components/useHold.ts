// Press and hold a button to repeat its action (like the distance − and +).
// One tap = one step; keep holding and it repeats, a little faster after a while.
import { useEffect, useRef } from 'react';
import type React from 'react';

export function useHold(onStep: () => void) {
  const step = useRef(onStep);
  step.current = onStep;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = () => clearTimeout(timer.current);
  useEffect(() => stop, []);

  const handlers: React.ButtonHTMLAttributes<HTMLButtonElement> = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      stop();
      step.current();
      let n = 0;
      const tick = () => {
        step.current();
        n++;
        timer.current = setTimeout(tick, n < 8 ? 110 : 55);
      };
      timer.current = setTimeout(tick, 420);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e) => e.preventDefault(),
    // keyboard (Enter / Space) gives a click without a pointer
    onClick: (e) => {
      if (e.detail === 0) step.current();
    },
  };
  return handlers;
}
