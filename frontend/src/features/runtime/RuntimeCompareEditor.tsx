import { useMemo, useState } from 'react';
import { ArrowRight, GitCompareArrows } from 'lucide-react';
import { Button } from '../../components/ui';
import { displayName, type BranchComparison, type ComparisonEndpoint, type Projection, type RuntimeEvent } from './api';
import { eventTitle } from './eventText';

type Side = 'left' | 'right';

function value(input: unknown) {
  if (input === null || input === undefined || input === '') return '—';
  if (typeof input === 'string') return input;
  return JSON.stringify(input, null, 0);
}

function categoryName(category?: string) {
  return ({ agent: '角色', plan: '计划', item: '物品', environment: '环境' } as Record<string, string>)[category || ''] || '状态';
}

function endpointText(endpoint: ComparisonEndpoint) {
  const latest = endpoint.selected_tick === endpoint.sim_time_tick ? '' : `所选时刻 ${endpoint.selected_tick} · `;
  return `${latest}第 ${endpoint.seq} 步 · 时刻 ${endpoint.sim_time_tick}`;
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
  const byTick = new Map<number, Record<Side, RuntimeEvent[]>>();
  for (const { side, event } of events) {
    if (!matches(event) || event.sim_time_after === undefined) continue;
    const bucket = byTick.get(event.sim_time_after) ?? { left: [], right: [] };
    bucket[side].push(event);
    byTick.set(event.sim_time_after, bucket);
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
        <strong>第{event.seq}步</strong><span>{eventTitle(event)}</span>
        {event.kind === 'creator_intervention' && <span>作者介入</span>}
        <p>{event.concealed ? '原话已隐藏' : event.text || (event.accepted === false ? '规则阻止' : '已提交记录')}</p>
        <small>{displayName(projection, event.actor_id)} · {displayName(projection, event.location_id)}</small>
      </button>
      <Button variant="ghost" disabled={event.seq == null || !event.worldline_id} onClick={() => event.worldline_id && event.seq != null && onJump(event.worldline_id, event.seq)}>查看事件 <ArrowRight size={13}/></Button>
    </article>;
  }
  return <section className="runtime-compare-editor" aria-label="世界线比较结果">
    <header className="runtime-compare-heading"><div><h3><GitCompareArrows size={16}/>世界线差异</h3></div></header>
    <section className="runtime-compare-anchor">
      {comparison.common_anchor ? <>
        <strong>最后共同起点</strong>
        <span>第 {comparison.common_anchor.seq} 步 · 时刻 {comparison.common_anchor.sim_time_tick}</span>
        <Button variant="ghost" onClick={() => onJump(comparison.common_anchor!.worldline_id, comparison.common_anchor!.seq)}>查看共同起点</Button>
      </> : <strong>两条线从各自的冻结前提起算</strong>}
    </section>
    <div className="runtime-compare-columns">
      <article aria-label="左线比较时点"><strong>{comparison.left.title}</strong><span>{endpointText(comparison.left)}</span></article>
      <article aria-label="右线比较时点"><strong>{comparison.right.title}</strong><span>{endpointText(comparison.right)}</span></article>
    </div>
    <section className="runtime-compare-aggregate" aria-label="比较聚合概览"><h3>聚合概览</h3><div className="runtime-compare-aggregate-cards"><span>状态差异 <strong>{comparison.changes.length}</strong></span><span>角色 <strong>{categoryCounts.agent || 0}</strong></span><span>计划 <strong>{categoryCounts.plan || 0}</strong></span><span>物品 <strong>{categoryCounts.item || 0}</strong></span><span>环境 <strong>{categoryCounts.environment || 0}</strong></span><span>事件 <strong>{events.length}</strong></span></div><p>事件类型 {Object.entries(actionCounts).map(([key,count])=><span key={key}>{key} · {count}</span>)}</p></section>
    <section className="runtime-compare-filters" aria-label="比较筛选"><label>角色<select aria-label="比较角色筛选" value={role} onChange={event=>setRole(event.target.value)}><option value="all">全部角色</option>{roles.map(id=><option key={id} value={id}>{displayName(projection,id)}</option>)}</select></label><label>地点<select aria-label="比较地点筛选" value={location} onChange={event=>setLocation(event.target.value)}><option value="all">全部地点</option>{locations.map(id=><option key={id} value={id}>{displayName(projection,id)}</option>)}</select></label><label>事件类型<select aria-label="比较事件类型筛选" value={action} onChange={event=>setAction(event.target.value)}><option value="all">全部事件</option>{actions.map(id=><option key={id} value={id}>{id}</option>)}</select></label><label>逻辑时刻起<input aria-label="比较逻辑时刻起" type="number" value={minTick} onChange={event=>setMinTick(event.target.value)}/></label><label>逻辑时刻止<input aria-label="比较逻辑时刻止" type="number" value={maxTick} onChange={event=>setMaxTick(event.target.value)}/></label></section>
    <section className="runtime-compare-state"><h3>状态差异 · {comparison.changes.length}</h3>{comparison.changes.length ? <div className="runtime-compare-change-list">{comparison.changes.map(change=><article key={change.path}><div><span className="runtime-compare-category">{categoryName(change.category)}</span><strong>{change.label}</strong><p>{value(change.left)} <ArrowRight size={13}/> {value(change.right)}</p></div><div className="runtime-compare-change-events"><div>{related(change,'left').map(event=><Button variant="ghost" key={`left:${event.event_id}`} onClick={()=>event.worldline_id&&event.seq!=null&&onJump(event.worldline_id,event.seq)}>左线第{event.seq}步</Button>)}</div><div>{related(change,'right').map(event=><Button variant="ghost" key={`right:${event.event_id}`} onClick={()=>event.worldline_id&&event.seq!=null&&onJump(event.worldline_id,event.seq)}>右线第{event.seq}步</Button>)}</div></div></article>)}</div> : <p className="runtime-muted">当前状态没有差异。</p>}</section>
    <section className="runtime-compare-events"><h3>按故事时刻查看事件</h3>
      {comparison.events_truncated && <p className="runtime-muted">每侧显示所选时刻前最近 500 步，较早记录可从历史回看。</p>}
      {!byTick.size && <p className="runtime-muted">所选范围没有匹配事件。</p>}
      {[...byTick.entries()].sort(([left], [right]) => left - right).map(([tick, steps]) =>
        <section className="runtime-compare-tick" aria-label={`时刻 ${tick}`} key={tick}>
          <h4>时刻 {tick}</h4>
          <div className="runtime-compare-event-columns">
            {(['left', 'right'] as const).map(side => <div key={side} aria-label={side === 'left' ? '左线事件' : '右线事件'}>
              {steps[side].map(event => eventRow(event, side))}
              {!steps[side].length && <p className="runtime-muted">
                {tick > comparison[side].selected_tick ? '本侧所选时刻早于此事件。' : '本侧此时刻没有匹配事件。'}
              </p>}
            </div>)}
          </div>
        </section>)}
    </section>
  </section>;
}
