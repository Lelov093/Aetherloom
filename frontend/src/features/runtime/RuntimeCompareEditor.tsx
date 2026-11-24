import { useMemo, useState } from 'react';
import { ArrowRight, GitCompareArrows } from 'lucide-react';
import { Button } from '../../components/ui';
import { displayName, type BranchComparison, type Projection, type RuntimeEvent } from './api';

type Side = 'left' | 'right';

function value(input: unknown) {
  if (input === null || input === undefined || input === '') return '—';
  if (typeof input === 'string') return input;
  return JSON.stringify(input, null, 0);
}

function categoryName(category?: string) {
  return ({ agent: '角色', plan: '计划', item: '物品', environment: '环境' } as Record<string, string>)[category || ''] || '状态';
}

export function RuntimeCompareEditor({ comparison, projection, onJump }: {
  comparison: BranchComparison;
  projection: Projection;
  onJump: (worldline: string, seq: number) => void;
}) {
  const [role, setRole] = useState('all');
  const [location, setLocation] = useState('all');
  const [action, setAction] = useState('all');
  const [minTick, setMinTick] = useState('');
  const [maxTick, setMaxTick] = useState('');
  const events = useMemo(() => [
    ...comparison.events.left.map(event => ({ side: 'left' as Side, event })),
    ...comparison.events.right.map(event => ({ side: 'right' as Side, event })),
  ], [comparison]);
  const roles = [...new Set(events.map(item => item.event.actor_id).filter(Boolean))] as string[];
  const locations = [...new Set(events.map(item => item.event.location_id).filter(Boolean))] as string[];
  const actions = [...new Set(events.map(item => item.event.action_type))];
  const categoryCounts = comparison.changes.reduce<Record<string, number>>((counts, change) => {
    const key = change.category || 'state';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const actionCounts = events.reduce<Record<string, number>>((counts, item) => {
    counts[item.event.action_type] = (counts[item.event.action_type] || 0) + 1;
    return counts;
  }, {});
  function matches(event: RuntimeEvent) {
    const tick = event.sim_time_after;
    return (role === 'all' || event.actor_id === role) &&
      (location === 'all' || event.location_id === location) &&
      (action === 'all' || event.action_type === action) &&
      (!minTick || (tick !== undefined && tick >= Number(minTick))) &&
      (!maxTick || (tick !== undefined && tick <= Number(maxTick)));
  }
  function related(change: BranchComparison['changes'][number], side: Side) {
    const source = side === 'left' ? comparison.events.left : comparison.events.right;
    return source.filter(event => {
      if (change.category === 'agent' || change.category === 'plan') return event.actor_id === change.entity_id;
      if (change.category === 'environment') return event.action_type === 'environment';
      if (change.category === 'item') return ['take', 'transfer'].includes(event.action_type);
      return false;
    }).slice(-3);
  }
  function eventRow(event: RuntimeEvent, side: Side) {
    return <article className="runtime-compare-event" key={`${side}:${event.event_id}`}>
      <button onClick={() => event.worldline_id && event.seq != null && onJump(event.worldline_id, event.seq)}>
        <strong>第{event.seq}步</strong><span>逻辑时刻 {event.sim_time_after ?? '未知'}</span><span>{event.action_type}</span>
        <p>{event.text || (event.accepted === false ? '规则阻止' : '已提交记录')}</p>
        <small>{displayName(projection, event.actor_id)} · {displayName(projection, event.location_id)}</small>
      </button>
      <Button variant="ghost" disabled={event.seq == null || !event.worldline_id} onClick={() => event.worldline_id && event.seq != null && onJump(event.worldline_id, event.seq)}>查看事件 <ArrowRight size={13}/></Button>
    </article>;
  }
  return <section className="runtime-compare-editor" aria-label="世界线比较结果">
    <header className="runtime-compare-heading"><div><span className="eyebrow">READ-ONLY COMPARE</span><h3><GitCompareArrows size={16}/>世界线差异</h3><p>只读比较已保存状态和事件，不创建第二套状态，不写入 Canon。</p></div></header>
    <section className="runtime-compare-anchor"><strong>共同分叉锚点</strong><span>{comparison.common_anchor ? `第${comparison.common_anchor.seq}步 · ${comparison.common_anchor.worldline_id}` : '未找到共同分叉锚点'}</span>{comparison.common_anchor&&<Button variant="ghost" onClick={()=>onJump(comparison.common_anchor!.worldline_id, comparison.common_anchor!.seq)}>查看锚点</Button>}</section>
    <div className="runtime-compare-columns"><article><strong>{comparison.left.title}</strong><span>第{comparison.left.seq}步 · 逻辑时刻 {comparison.left.sim_time_tick} · {comparison.left.control_status}</span></article><article><strong>{comparison.right.title}</strong><span>第{comparison.right.seq}步 · 逻辑时刻 {comparison.right.sim_time_tick} · {comparison.right.control_status}</span></article></div>
    <section className="runtime-compare-aggregate" aria-label="比较聚合概览"><h3>聚合概览</h3><div className="runtime-compare-aggregate-cards"><span>状态差异 <strong>{comparison.changes.length}</strong></span><span>角色 <strong>{categoryCounts.agent || 0}</strong></span><span>计划 <strong>{categoryCounts.plan || 0}</strong></span><span>物品 <strong>{categoryCounts.item || 0}</strong></span><span>环境 <strong>{categoryCounts.environment || 0}</strong></span><span>事件 <strong>{events.length}</strong></span></div><p>事件类型 {Object.entries(actionCounts).map(([key,count])=><span key={key}>{key} · {count}</span>)}</p></section>
    <section className="runtime-compare-filters" aria-label="比较筛选"><label>角色<select aria-label="比较角色筛选" value={role} onChange={event=>setRole(event.target.value)}><option value="all">全部角色</option>{roles.map(id=><option key={id} value={id}>{displayName(projection,id)}</option>)}</select></label><label>地点<select aria-label="比较地点筛选" value={location} onChange={event=>setLocation(event.target.value)}><option value="all">全部地点</option>{locations.map(id=><option key={id} value={id}>{displayName(projection,id)}</option>)}</select></label><label>事件类型<select aria-label="比较事件类型筛选" value={action} onChange={event=>setAction(event.target.value)}><option value="all">全部事件</option>{actions.map(id=><option key={id} value={id}>{id}</option>)}</select></label><label>逻辑时刻起<input aria-label="比较逻辑时刻起" type="number" value={minTick} onChange={event=>setMinTick(event.target.value)}/></label><label>逻辑时刻止<input aria-label="比较逻辑时刻止" type="number" value={maxTick} onChange={event=>setMaxTick(event.target.value)}/></label></section>
    <section className="runtime-compare-state"><h3>状态差异 · {comparison.changes.length}</h3>{comparison.changes.length ? <div className="runtime-compare-change-list">{comparison.changes.map(change=><article key={change.path}><div><span className="runtime-compare-category">{categoryName(change.category)}</span><strong>{change.label}</strong><p>{value(change.left)} <ArrowRight size={13}/> {value(change.right)}</p></div><div className="runtime-compare-change-events"><div>{related(change,'left').map(event=><Button variant="ghost" key={`left:${event.event_id}`} onClick={()=>event.worldline_id&&event.seq!=null&&onJump(event.worldline_id,event.seq)}>左线第{event.seq}步</Button>)}</div><div>{related(change,'right').map(event=><Button variant="ghost" key={`right:${event.event_id}`} onClick={()=>event.worldline_id&&event.seq!=null&&onJump(event.worldline_id,event.seq)}>右线第{event.seq}步</Button>)}</div></div></article>)}</div> : <p className="runtime-muted">当前状态没有差异。</p>}</section>
    <section className="runtime-compare-events"><h3>事件差异</h3><div className="runtime-compare-event-columns"><div><h4>{comparison.left.title} · {comparison.events.left.filter(matches).length}</h4>{comparison.events.left.filter(matches).map(event=>eventRow(event,'left'))}{!comparison.events.left.filter(matches).length&&<p className="runtime-muted">没有匹配事件。</p>}</div><div><h4>{comparison.right.title} · {comparison.events.right.filter(matches).length}</h4>{comparison.events.right.filter(matches).map(event=>eventRow(event,'right'))}{!comparison.events.right.filter(matches).length&&<p className="runtime-muted">没有匹配事件。</p>}</div></div></section>
  </section>;
}
