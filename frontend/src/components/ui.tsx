import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle, X } from 'lucide-react';

export function Button({ variant = 'secondary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return <button className={`button button--${variant} ${className}`} {...props} />;
}

export function ErrorNotice({ children }: { children: ReactNode }) {
  return <div className="error-notice" role="alert"><AlertCircle size={18} /><span>{children}</span></div>;
}

export function Dialog({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    ref.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')?.focus();
    return () => { ref.current?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className="dialog" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <header className="dialog-heading"><h2 id={titleId}>{title}</h2><Button type="button" variant="ghost" aria-label="关闭对话框" onClick={onClose} disabled={busy}><X size={20} /></Button></header>
    {children}
  </dialog>;
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h2>{title}</h2><p>{children}</p>{action}</div>;
}

export function Inspector({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus();
  }, []);
  return <aside className="inspector" aria-label="世界资料检查器" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
    <header><span>世界资料</span><button ref={closeButton} className="button button--ghost" onClick={onClose} aria-label="关闭检查器"><X size={18} /></button></header>
    <div className="inspector-content">{children}</div>
  </aside>;
}
