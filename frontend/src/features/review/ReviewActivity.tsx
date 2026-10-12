import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { reviewApi, taskNames, type ReviewActivity as Activity } from './api';

type Notice = { key: string; text: string };
export function useReviewActivity(world?: string) {
  const [activity, setActivity] = useState<Activity>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<Notice>();
  const previous = useRef<Activity | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    let fetching = false;
    previous.current = undefined;
    setActivity(undefined); setError(''); setNotice(undefined);
    async function refresh() {
      if (!world || fetching) return;
      fetching = true;
      try {
        const next = await reviewApi.activity(world);
        if (!alive) return;
        if (previous.current) {
          const changed = next.tasks.find(task => ['succeeded', 'failed', 'interrupted', 'cancelled'].includes(task.status) &&
            previous.current!.tasks.find(old => old.id === task.id)?.updated_at !== task.updated_at);
          if (changed) setNotice({key: `${changed.id}:${changed.updated_at}`, text: `${changed.title}：${taskNames[changed.status]}。${next.pending} 项待审阅。`});
        }
        previous.current = next;
        setActivity(next); setError('');
      } catch (e) { if (alive) setError((e as Error).message); }
      finally { fetching = false; }
    }
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 3000);
    window.addEventListener('focus', refresh);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [world]);
  return { activity, error, notice };
}

export function ActivityNotice({ world, activity, error, notice }: {
  world: string; activity?: Activity; error: string; notice?: Notice;
}) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState('');
  return <>
    <Button variant="ghost" className="activity-trigger" aria-label="通知与提取任务" onClick={() => setOpen(true)}>
      <Bell size={18} /><span>{activity?.active ? `${activity.active} 项运行中` : '通知'}</span>
    </Button>
    {notice && dismissed !== notice.key && <aside className="activity-completion" role="status" aria-live="polite">
      <span>{notice.text}</span><Link to={`/worlds/${world}/review`} onClick={() => setDismissed(notice.key)}>前往审阅 →</Link>
      <Button variant="ghost" aria-label="关闭任务通知" onClick={() => setDismissed(notice.key)}>关闭</Button>
    </aside>}
    {open && <Dialog title="通知与提取任务" onClose={() => setOpen(false)}>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {!activity && !error && <p role="status">正在读取任务状态…</p>}
      {activity && <>
        <Link className="text-link" onClick={() => setOpen(false)} to={`/worlds/${world}/review`}>{activity.pending} 项待审阅 →</Link>
        <Link className="text-link" onClick={()=>setOpen(false)} to={`/worlds/${world}/review/simulation`}>{activity.simulation_pending} 项模拟提案待审阅 →</Link>
        <p className="context-hint">提取结果等待你的裁决；完成通知不会确认世界事实。</p>
        {activity.tasks.length ? <ul className="activity-tasks">{activity.tasks.map(task => <li key={task.id}>
          <strong>{task.title}</strong><span>{taskNames[task.status]} · {task.completed_chunks}/{task.total_chunks} 段</span>
          <small>{task.work_title} · {new Date(task.updated_at).toLocaleString('zh-CN')}</small>
          <Link onClick={() => setOpen(false)} to={`/worlds/${world}/create?work=${task.work_id}&node=${task.node_id}`}>查看正文与任务 →</Link>
        </li>)}</ul> : <p>还没有提取任务。</p>}
      </>}
    </Dialog>}
  </>;
}
