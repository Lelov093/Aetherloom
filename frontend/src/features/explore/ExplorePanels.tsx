import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { X } from 'lucide-react';

const bounds = { left: { min: 240, max: 380 }, right: { min: 290, max: 450 } };
export function useExplorePanels() {
  const [preferences, setPreferences] = useState(() => {
    const initial = { left: 272, right: 330, leftOpen: true, rightOpen: true };
    try {
      const saved = JSON.parse(localStorage.getItem('aetherloom:explore-panels') || '{}');
      for (const side of ['left', 'right'] as const) if (Number.isFinite(saved?.[side])) initial[side] = Math.max(bounds[side].min, Math.min(bounds[side].max, saved[side]));
      for (const side of ['leftOpen', 'rightOpen'] as const) if (typeof saved?.[side] === 'boolean') initial[side] = saved[side];
    } catch { /* Keep default display preferences. */ }
    return initial;
  });
  const [width, setWidth] = useState(window.innerWidth), [drawer, setDrawer] = useState<'left' | 'right'>();
  const narrow = width < 1200;
  useEffect(() => {
    let wasNarrow = window.innerWidth < 1200;
    const resize = () => {
      const isNarrow = window.innerWidth < 1200;
      setWidth(window.innerWidth);
      if (wasNarrow !== isNarrow) setDrawer(undefined);
      wasNarrow = isNarrow;
    };
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => { try { localStorage.setItem('aetherloom:explore-panels', JSON.stringify(preferences)); } catch { /* Session remains usable. */ } }, [preferences]);
  const leftMax = Math.max(240, Math.min(380, width - 120 - 480 - (preferences.rightOpen ? 290 + 24 : 12)));
  const leftWidth = Math.min(preferences.left, leftMax);
  const rightMax = Math.max(290, Math.min(450, width - 120 - 480 - (preferences.leftOpen ? leftWidth + 24 : 12)));
  const rightWidth = Math.min(preferences.right, rightMax);
  function toggle(side: 'left' | 'right', open: boolean) {
    if (narrow) setDrawer(open ? side : undefined);
    else setPreferences(p => ({ ...p, [`${side}Open`]: open }));
  }
  function resize(side: 'left' | 'right', value: number) {
    setPreferences(p => ({ ...p, [side]: Math.max(bounds[side].min, Math.min(side === 'left' ? leftMax : rightMax, value)) }));
  }
  return { narrow, leftWidth, rightWidth, leftOpen: narrow ? drawer === 'left' : preferences.leftOpen,
    rightOpen: narrow ? drawer === 'right' : preferences.rightOpen, toggle, resize,
    bounds: { left: { ...bounds.left, max: leftMax }, right: { ...bounds.right, max: rightMax } },
    reset: () => { setPreferences({ left: 272, right: 330, leftOpen: true, rightOpen: true }); setDrawer(undefined); } };
}

export function ExplorePane({ side, floating, children, onClose, heading }: { side: 'left' | 'right'; floating: boolean; children: ReactNode; onClose: () => void; heading?: string }) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null);
  const title = heading || (side === 'left' ? '关系探索' : '对象与联系');
  useLayoutEffect(() => {
    if (!floating) return;
    const previous = document.activeElement as HTMLElement | null, pane = dialog.current;
    pane?.showModal(); close.current?.focus();
    return () => { pane?.close(); if (previous?.isConnected) previous.focus(); };
  }, [floating]);
  const content = <><header className="explore-pane-heading"><h2>{title}</h2><button ref={close} type="button" className="explore-icon" aria-label={`收起${title}`} onClick={onClose}><X size={17}/></button></header>{children}</>;
  return floating ? <dialog ref={dialog} className={`explore-pane explore-${side} explore-drawer`} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onKeyDown={e => {
    if (e.key !== 'Tab') return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,select,summary,[tabindex="0"]')]
      .filter(el => el.tabIndex >= 0 && el.getClientRects().length > 0 && (el.tagName === 'SUMMARY' || !el.closest('details:not([open])')) && (el.tagName === 'SELECT' || !el.closest('select')));
    if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus(); }
    else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0]?.focus(); }
  }}>{content}</dialog> : <aside className={`explore-pane explore-${side}`} aria-label={title}>{content}</aside>;
}

export function ExploreResize({ side, panels }: { side: 'left' | 'right'; panels: ReturnType<typeof useExplorePanels> }) {
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  const value = side === 'left' ? panels.leftWidth : panels.rightWidth;
  const move = (e: PointerEvent<HTMLButtonElement>) => { if (drag.current) panels.resize(side, drag.current.width + (e.clientX - drag.current.x) * (side === 'left' ? 1 : -1)); };
  return <button type="button" className={`explore-resize explore-resize-${side}`} role="separator" aria-orientation="vertical" aria-label={`调整${side === 'left' ? '探索栏' : '详情栏'}宽度`} aria-valuemin={panels.bounds[side].min} aria-valuemax={panels.bounds[side].max} aria-valuenow={value}
    onPointerDown={e => { if (e.button !== 0) return; drag.current = { x: e.clientX, width: value }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={move}
    onPointerUp={e => { drag.current = undefined; e.currentTarget.releasePointerCapture(e.pointerId); }} onLostPointerCapture={() => { drag.current = undefined; }}
    onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); panels.resize(side, e.key === 'Home' ? panels.bounds[side].min : e.key === 'End' ? panels.bounds[side].max : value + (e.key === 'ArrowRight' ? 16 : -16) * (side === 'left' ? 1 : -1)); } }}/>;
}
