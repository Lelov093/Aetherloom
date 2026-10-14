import { useEffect, useRef, useState, type PointerEvent } from 'react';

/** Display preferences are local to this device; they never alter content versions. */
export function useCreatePanel(side: 'left' | 'right', defaultWidth: number, breakpoint: number) {
  const key = `aetherloom:create-panel:${side}`;
  const min = side === 'left' ? 220 : 280;
  const max = side === 'left' ? 380 : 480;
  const initial = useRef<{ width: number; open: boolean } | undefined>(undefined);
  if (!initial.current) {
    let value: { width?: number; open?: boolean } = {};
    try { value = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* Use defaults. */ }
    initial.current = {
      width: Number.isFinite(value?.width) ? Math.max(min, Math.min(max, value.width!)) : defaultWidth,
      open: window.innerWidth >= breakpoint && value?.open !== false,
    };
  }
  const [width, setWidth] = useState(initial.current.width);
  const [open, setOpen] = useState(initial.current.open);
  const [floating, setFloating] = useState(window.innerWidth < breakpoint);
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify({ width, open })); } catch { /* Storage may be unavailable. */ }
  }, [key, width, open]);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const update = () => {
      setFloating(!mq.matches);
      if (!mq.matches) setOpen(false);
    };
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpoint]);
  useEffect(() => {
    if (!floating || !open) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = document.getElementById(side === 'left' ? 'create-directory' : 'create-context');
    const targets = () => [...(frame?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, textarea, summary, [tabindex="0"]') || [])]
      .filter(element => element.getClientRects().length > 0 && (element.tagName === 'SUMMARY' || !element.closest('details:not([open])')));
    targets()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key === 'Tab') {
        const items = targets(), first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => { window.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus(); };
  }, [floating, open, side]);
  return { width, setWidth, open, setOpen, floating, min, max, side };
}

export function PanelResize({ panel, controls }: {
  panel: ReturnType<typeof useCreatePanel>;
  controls: string;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const separator = useRef<HTMLDivElement>(null);
  const [actual, setActual] = useState({ width: panel.width, max: panel.max });
  useEffect(() => {
    const frame = separator.current?.parentElement;
    if (!frame) return;
    const measure = () => setActual({
      width: Math.round(frame.getBoundingClientRect().width),
      max: panel.side === 'right' ? Math.max(panel.min, Math.min(panel.max, Math.floor(frame.parentElement!.getBoundingClientRect().width - 432))) : panel.max,
    });
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    measure();
    return () => observer.disconnect();
  }, [panel.side, panel.min, panel.max]);
  const clamp = (value: number) => Math.max(panel.min, Math.min(actual.max, value));
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) panel.setWidth(clamp(drag.current.width + (event.clientX - drag.current.x) * (panel.side === 'left' ? 1 : -1)));
  };
  return <div
    className={`create-resize create-resize--${panel.side}`}
    ref={separator}
    role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={panel.side === 'left' ? '调整作品目录宽度' : '调整上下文宽度'}
    aria-controls={controls} aria-valuemin={panel.min} aria-valuemax={actual.max} aria-valuenow={actual.width}
    title="拖动调宽；方向键微调；Home / End 调至最小 / 最大"
    onPointerDown={event => {
      if (event.button !== 0) return;
      drag.current = { x: event.clientX, width: actual.width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={move}
    onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      const direction = panel.side === 'left' ? 1 : -1;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        panel.setWidth(clamp(actual.width + (event.key === 'ArrowRight' ? 16 : -16) * direction));
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); panel.setWidth(event.key === 'Home' ? panel.min : actual.max);
      }
    }}
  />;
}
