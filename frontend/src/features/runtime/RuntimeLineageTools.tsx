import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { runtimeRequest, type BranchComparison, type Envelope, type HostSession, type Worldline } from './api';
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
  const [leftTick, setLeftTick] = useState(''), [rightTick, setRightTick] = useState('');
  const [comparison, setComparison] = useState<BranchComparison>(), [compareError, setCompareError] = useState('');
  const [compareBusy, setCompareBusy] = useState(false);
  const current = useRef('');
  current.current = `${session.viewer_scope}:${p.worldline_id}`;
  const candidates = lines.filter(line => line.worldline_id !== p.worldline_id);
  const validTicks = [leftTick, rightTick].every(tick => !tick || /^\d+$/.test(tick) && Number(tick) <= 2147483647);
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
    if (!connected || compareBusy || !compareLine || !validTicks) return;
    const key = current.current;
    setCompareBusy(true); setCompareError('');
    try {
      const query = new URLSearchParams({ left: p.worldline_id, right: compareLine });
      if (leftTick !== '') query.set('left_tick', leftTick);
      if (rightTick !== '') query.set('right_tick', rightTick);
      const result = await runtimeRequest<BranchComparison>(session, `/compare?${query}`);
      if (current.current === key) setComparison(result);
    } catch (e) {
      if (current.current === key) {
        setComparison(undefined);
        setCompareError((e as Error).message === 'comparison_tick_out_of_range'
          ? '请选择对应世界线从起点到最新记录之间的时刻。' : '暂时无法读取比较。');
      }
    } finally { if (current.current === key) setCompareBusy(false); }
  }
  return <>
    {p.capabilities.includes('fork') && <Button disabled={!connected} onClick={() => { setForkAnchor(p); setTitle((p.scene?.title || '世界线') + ' · 分支'); setRequest(crypto.randomUUID()); setError(''); setBusy(false); setDialog(true); }}>从此刻分叉</Button>}
    {p.capabilities.includes('reopen') && connected && <Link className="text-link"
      to={`/worlds/${world}/simulate?prepare=1&reopen=${encodeURIComponent(p.worldline_id)}`}>用新版重开</Link>}
    {p.capabilities.includes('fork') && candidates.length > 0 && <Button disabled={!connected} onClick={() => {
      setCompareLine(candidates[0].worldline_id);
      setLeftTick(p.historical && p.sim_time_tick !== null ? String(p.sim_time_tick) : '');
      setRightTick('');
      setComparison(undefined);
      setCompareError('');
      setCompareOpen(true);
    }}>比较世界线</Button>}
    {dialog && <Dialog title="从已提交节点创建分支" busy={busy} onClose={() => setDialog(false)}>
      <p>{forkAnchor.scene?.title || forkAnchor.worldline_id} · 本线第{forkAnchor.seq}步 · 逻辑时刻 {forkAnchor.sim_time_tick}</p>
      <p>新线保留此刻的世界、认知与待办，从第 0 步开始并默认暂停。{forkAnchor.model_budget?.exploration ? '模型调度开启后使用本轮共享额度。' : '模型调度需要宿主审批额度。'}</p>
      <label className="field"><span>分支名称</span><input aria-label="分支名称" maxLength={100} value={title} disabled={busy} onChange={e => setTitle(e.target.value)}/></label>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions"><Button disabled={busy} onClick={() => setDialog(false)}>取消</Button><Button variant="primary" disabled={busy || !connected || !title.trim()} onClick={() => void fork()}>{busy ? '正在保存…' : '创建暂停分支'}</Button></div>
    </Dialog>}
    {compareOpen && <Dialog title="比较两条世界线" busy={compareBusy} onClose={() => setCompareOpen(false)}>
      {p.spoiler_free && <p>防泄底已开启。</p>}
      <label className="field"><span>对照世界线</span><select aria-label="对照世界线" value={compareLine} disabled={compareBusy} onChange={e => { setCompareLine(e.target.value); setRightTick(''); setComparison(undefined); }}>
        {candidates.map(line => <option key={line.worldline_id} value={line.worldline_id}>{line.title || line.worldline_id}{line.parent_worldline_id ? ` · 父线第${line.parent_anchor_seq}步` : ''}</option>)}
      </select></label>
      <div className="runtime-compare-columns">
        <label className="field">左线时刻<input type="number" min={0} step={1} placeholder="最新" disabled={compareBusy}
          value={leftTick} onChange={event => { setLeftTick(event.target.value); setComparison(undefined); }} /></label>
        <label className="field">右线时刻<input type="number" min={0} step={1} placeholder="最新" disabled={compareBusy}
          value={rightTick} onChange={event => { setRightTick(event.target.value); setComparison(undefined); }} /></label>
      </div>
      {compareError && <ErrorNotice>{compareError}</ErrorNotice>}
      <div className="dialog-actions"><Button disabled={compareBusy} onClick={() => setCompareOpen(false)}>关闭</Button><Button variant="primary" disabled={compareBusy || !connected || !compareLine || !validTicks} onClick={() => void compare()}>{compareBusy ? '正在读取…' : '生成差异'}</Button></div>
      {comparison && <RuntimeCompareEditor comparison={comparison} projection={p} onJump={(line, seq) => {
        setCompareOpen(false);
        onJump(line, seq);
      }}/>}
    </Dialog>}
  </>;
}
