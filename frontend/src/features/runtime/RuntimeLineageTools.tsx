import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { displayName, purposeNames, runtimeRequest, type BranchComparison, type Envelope, type HostSession, type Worldline } from './api';
import { RuntimeCompareEditor } from './RuntimeCompareEditor';

/** Creator tools stay in the existing monitor and consume its selected history. */
export function RuntimeLineageTools({ world, frame, lines, session, connected, onCreated, onJump }: {
  world: string; frame: Envelope; lines: Worldline[]; session: HostSession; connected: boolean;
  onCreated: (line: string) => Promise<void>;
  onJump: (line: string, seq: number) => void;
}) {
  const p = frame.projection;
  const [dialog, setDialog] = useState(false), [title, setTitle] = useState('');
  const [request, setRequest] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [forkAnchor, setForkAnchor] = useState(p);
  const [compareOpen, setCompareOpen] = useState(false), [compareLine, setCompareLine] = useState('');
  const [comparison, setComparison] = useState<BranchComparison>(), [compareError, setCompareError] = useState('');
  const [compareBusy, setCompareBusy] = useState(false);
  const current = useRef('');
  current.current = `${session.viewer_scope}:${p.worldline_id}`;
  const candidates = lines.filter(line => line.worldline_id !== p.worldline_id);
  async function fork() {
    if (!connected || busy || !title.trim()) return;
    const key = current.current;
    setBusy(true); setError('');
    try {
      const saved = await runtimeRequest<{worldline_id: string}>(session, `/worldlines/${encodeURIComponent(p.worldline_id)}/forks`, undefined, 'POST', {
        request_id: request, seq: forkAnchor.seq, state_hash: forkAnchor.state_hash, title: title.trim(),
      });
      if (current.current === key) { setDialog(false); await onCreated(saved.worldline_id); }
    } catch (e) { if (current.current === key) setError((e as Error).message); }
    finally { if (current.current === key) setBusy(false); }
  }
  async function compare() {
    if (!connected || compareBusy || !compareLine) return;
    setCompareBusy(true); setCompareError('');
    try {
      const result = await runtimeRequest<BranchComparison>(session,
        `/compare?left=${encodeURIComponent(p.worldline_id)}&right=${encodeURIComponent(compareLine)}`);
      setComparison(result);
    } catch (e) { setCompareError((e as Error).message); }
    finally { setCompareBusy(false); }
  }
  return <>
    {p.capabilities.includes('fork') && <Button disabled={!connected} onClick={() => { setForkAnchor(p); setTitle((p.scene?.title || '世界线') + ' · 分支'); setRequest(crypto.randomUUID()); setError(''); setBusy(false); setDialog(true); }}>从此刻分叉</Button>}
    {p.capabilities.includes('fork') && candidates.length > 0 && <Button disabled={!connected} onClick={() => { setCompareLine(candidates[0].worldline_id); setComparison(undefined); setCompareError(''); setCompareOpen(true); }}>比较世界线</Button>}
    {dialog && <Dialog title="从已提交节点创建分支" busy={busy} onClose={() => setDialog(false)}>
      <p>{forkAnchor.scene?.title || forkAnchor.worldline_id} · 本线第{forkAnchor.seq}步 · 逻辑时刻 {forkAnchor.sim_time_tick}</p>
      <p>完整保留此刻的世界、认知与待办。新线从第0步开始，默认暂停、自动策略与模型关闭，费用额度不继承。</p>
      <label className="field"><span>分支名称</span><input aria-label="分支名称" maxLength={100} value={title} disabled={busy} onChange={e => setTitle(e.target.value)}/></label>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions"><Button disabled={busy} onClick={() => setDialog(false)}>取消</Button><Button variant="primary" disabled={busy || !connected || !title.trim()} onClick={() => void fork()}>{busy ? '正在保存…' : '创建暂停分支'}</Button></div>
    </Dialog>}
    {compareOpen && <Dialog title="比较两条世界线" busy={compareBusy} onClose={() => setCompareOpen(false)}>
      <p>只读比较两条世界线的已保存状态和新增事件，不会修改正文设定或灵感。</p>
      <label className="field"><span>对照世界线</span><select aria-label="对照世界线" value={compareLine} disabled={compareBusy} onChange={e => { setCompareLine(e.target.value); setComparison(undefined); }}>
        {candidates.map(line => <option key={line.worldline_id} value={line.worldline_id}>{line.title || line.worldline_id}{line.parent_worldline_id ? ` · 父线第${line.parent_anchor_seq}步` : ''}</option>)}
      </select></label>
      {compareError && <ErrorNotice>{compareError}</ErrorNotice>}
      <div className="dialog-actions"><Button disabled={compareBusy} onClick={() => setCompareOpen(false)}>关闭</Button><Button variant="primary" disabled={compareBusy || !connected || !compareLine} onClick={() => void compare()}>{compareBusy ? '正在读取…' : '生成差异'}</Button></div>
      {comparison && <RuntimeCompareEditor comparison={comparison} projection={p} onJump={onJump}/>}
    </Dialog>}
    <Link className="text-link" to={`/worlds/${world}/review/simulation`}>模拟审阅 →</Link>
  </>;
}

export function RuntimeReviewResults({ world, frame, session, connected }: { world: string; frame: Envelope; session: HostSession; connected: boolean }) {
  const [pending, setPending] = useState(''), [error, setError] = useState('');
  const [saved, setSaved] = useState<Record<string, string>>({});
  const p = frame.projection;
  async function propose(seq: number, kind: string) {
    const key = `${seq}:${kind}`;
    setPending(key); setError('');
    try {
      const result = await runtimeRequest<{id: string}>(session, `/worldlines/${encodeURIComponent(p.worldline_id)}/proposals`, undefined, 'POST', {seq, kind});
      setSaved(old => ({...old, [key]: result.id}));
    } catch (e) { setError((e as Error).message); }
    finally { setPending(''); }
  }
  return <>
    <p>{purposeNames[p.scene?.purpose || ''] || '未分类'} · 结果独立保存。只有主动挑选并在审阅页接受，才会写入 Canon。</p>
    <p>模板对象未绑定原作时，需在提案编辑中明确选择身份。对话与信念不自动成为世界事实。</p>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {frame.events.map(e => <article className="review-context-card" key={e.event_id}>
      <p>第{e.seq}步 · {displayName(p, e.actor_id)} · {e.text || e.action_type}{!e.accepted && '（行动未成立）'}</p>
      {e.accepted && e.seq && p.capabilities.includes('review') && ['event', ...(['move','take','transfer','goal','relocate'].includes(e.action_type) ? ['assertion'] : [])].map(kind => {
        const key = `${e.seq}:${kind}`, id = saved[key];
        return id ? <Link key={key} className="text-link" to={`/worlds/${world}/review/simulation?proposal=${id}`}>打开{kind === 'event' ? '事件' : '事实'}提案 →</Link> : <Button key={key} disabled={!connected || Boolean(pending)} onClick={() => void propose(e.seq!, kind)}>挑选为{kind === 'event' ? '事件' : '事实'}提案</Button>;
      })}
    </article>)}
  </>;
}
