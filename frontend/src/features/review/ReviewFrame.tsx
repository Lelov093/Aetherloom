import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, PanelLeft, FileText, GitBranch } from 'lucide-react';
import { Button, Dialog } from '../../components/ui';

export function ReviewInboxHeader({ world, simulation = false }: { world: string; simulation?: boolean }) {
  return <header className="review-inbox-heading"><span className="eyebrow">REVIEW</span><h1><Inbox size={22}/>审阅收件箱</h1>
    <p>核对来处，再决定哪些内容属于你的世界。</p>
    <nav className="review-source-tabs" aria-label="审阅来源">
      <Link aria-current={!simulation ? 'page' : undefined} to={`/worlds/${world}/review`}><FileText size={14}/>正文候选</Link>
      <Link aria-current={simulation ? 'page' : undefined} to={`/worlds/${world}/review/simulation`}><GitBranch size={14}/>模拟提案</Link>
    </nav></header>;
}

export function ReviewStatusTabs({ status, pending, onChange }: { status: string; pending: number; onChange: (value: string) => void }) {
  const tabs = [['pending', '待处理'], ['processed', '已处理'], ['all', '全部']];
  return <div className="quiet-tabs" role="tablist" aria-label="审阅状态">{tabs.map(([value, label], index) => <button key={value} type="button" role="tab" aria-selected={status === value} tabIndex={status === value ? 0 : -1} onClick={() => onChange(value)} onKeyDown={event => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault(); onChange(tabs[next][0]);
    event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus();
  }}>{label}{value === 'pending' && <span>{pending}</span>}</button>)}</div>;
}

export function ReviewFrame({ inbox, children, selection, simulation = false }: { inbox: ReactNode; children: ReactNode; selection: string | null; simulation?: boolean }) {
  const [narrow, setNarrow] = useState(window.innerWidth < 1100), [open, setOpen] = useState(false);
  useEffect(() => {
    const resize = () => { const next = window.innerWidth < 1100; setNarrow(next); if (!next) setOpen(false); };
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => { setOpen(false); }, [selection]);
  return <main id="main-content" className={`review-workspace review-frame ${simulation ? 'review-simulation' : ''}`}>
    {!narrow && inbox}
    <div className="review-detail-region">
      {narrow && <div className="review-mobile-toolbar"><Button variant="ghost" onClick={() => setOpen(true)}><PanelLeft size={17}/>打开审阅收件箱</Button><span>{simulation ? '模拟来源' : '正文来源'}</span></div>}
      {children}
    </div>
    {narrow && open && <Dialog title="审阅收件箱" className="review-inbox-dialog" focusFirstInput={false} onClose={() => setOpen(false)}>{inbox}</Dialog>}
  </main>;
}
