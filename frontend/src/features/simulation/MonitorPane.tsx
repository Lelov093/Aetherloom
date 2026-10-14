import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function MonitorPane({ side, floating, children, onClose }: {
  side: 'log' | 'inspector'; floating: boolean; children: ReactNode; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const title = side === 'log' ? '世界日志' : '检视器';
  const label = side === 'log' ? '世界日志' : '模拟详情';
  useLayoutEffect(() => {
    if (!floating) return;
    const previous = document.activeElement === document.body
      ? document.querySelector<HTMLElement>(`.monitor-dock button[aria-label="${side === 'log' ? '显示世界日志' : '显示模拟详情'}"]`)
      : document.activeElement as HTMLElement | null;
    const pane = dialog.current;
    pane?.showModal(); close.current?.focus();
    return () => { pane?.close(); if (previous?.isConnected) previous.focus(); };
  }, [floating, side]);
  const content = <><header><h2>{title}</h2><button ref={close} type="button" className="monitor-icon" aria-label={side === 'log' ? '收起世界日志' : '收起模拟详情'} onClick={onClose}><X size={17}/></button></header>{children}</>;
  return floating ? <dialog ref={dialog} className={`monitor-pane monitor-${side} monitor-drawer`} aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const targets = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]')]
      .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && (element.tagName === 'SUMMARY' || !element.closest('details:not([open])')) && (element.tagName === 'SELECT' || !element.closest('select')));
    const first = targets[0], last = targets.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>{content}</dialog>
    : <aside className={`monitor-pane monitor-${side}`} aria-label={label}>{content}</aside>;
}
