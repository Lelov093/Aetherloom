import { useEffect, useState, useRef, type PointerEvent } from 'react';

const bounds = { left: { min: 200, max: 400 }, right: { min: 260, max: 440 } };
const defaults = () => ({ log: true, inspector: true, left: window.innerWidth >= 1560 ? 330 : 300, right: window.innerWidth >= 1560 ? 350 : 340 });
export function useMonitorLayout() {
  const [stored, setStored] = useState(() => {
    const initial = defaults();
    try {
      const saved = JSON.parse(localStorage.getItem('aetherloom:monitor-layout') || '{}');
      for (const side of ['left', 'right'] as const) if (Number.isFinite(saved[side])) initial[side] = Math.max(bounds[side].min, Math.min(bounds[side].max, saved[side]));
      if (typeof saved.log === 'boolean') initial.log = saved.log;
      if (typeof saved.inspector === 'boolean') initial.inspector = saved.inspector;
    } catch { /* Use display defaults. */ }
    return initial;
  });
  const [viewport, setViewport] = useState(window.innerWidth);
  const narrow = viewport < 1200;
  const [drawer, setDrawer] = useState<'log' | 'inspector'>();
  const drag = useRef<{ x: number; width: number; side: 'left' | 'right' } | undefined>(undefined);
  useEffect(() => {
    let wasNarrow = window.innerWidth < 1200;
    const change = () => {
      const isNarrow = window.innerWidth < 1200;
      setViewport(window.innerWidth);
      if (isNarrow !== wasNarrow) setDrawer(undefined);
      wasNarrow = isNarrow;
    };
    window.addEventListener('resize', change);
    return () => window.removeEventListener('resize', change);
  }, []);
  useEffect(() => { try { localStorage.setItem('aetherloom:monitor-layout', JSON.stringify(stored)); } catch { /* Storage may be unavailable. */ } }, [stored]);
  const leftMax = stored.inspector ? Math.min(bounds.left.max, viewport - 120 - 24 - 440 - bounds.right.min) : bounds.left.max;
  const left = Math.max(bounds.left.min, Math.min(stored.left, leftMax));
  const rightMax = Math.max(bounds.right.min, Math.min(bounds.right.max, viewport - 120 - 440 - (stored.log ? left + 24 : 12)));
  const layout = { ...stored, left, right: Math.min(stored.right, rightMax), log: narrow ? drawer === 'log' : stored.log, inspector: narrow ? drawer === 'inspector' : stored.inspector };
  function set(next: Partial<typeof stored>) {
    if (narrow) {
      if (next.log) setDrawer('log'); else if (next.inspector) setDrawer('inspector'); else if (next.log === false || next.inspector === false) setDrawer(undefined);
      if (next.left !== undefined || next.right !== undefined) setStored(old => ({ ...old, ...(next.left !== undefined ? { left: next.left } : {}), ...(next.right !== undefined ? { right: next.right } : {}) }));
    } else setStored(old => ({ ...old, ...next }));
  }
  function resize(side: 'left' | 'right', value: number) {
    setStored(old => ({ ...old, [side]: Math.max(bounds[side].min, Math.min(side === 'left' ? leftMax : rightMax, value)) }));
  }
  function start(side: 'left' | 'right', event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: layout[side], side };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current) { const { side, x, width } = drag.current; resize(side, width + (event.clientX - x) * (side === 'left' ? 1 : -1)); }
  }
  function reset() { setStored(defaults()); setDrawer(undefined); }
  return { layout, set, narrow, resize, start, move, reset, bounds: { left: { ...bounds.left, max: leftMax }, right: { ...bounds.right, max: rightMax } }, end: () => { drag.current = undefined; } };
}
