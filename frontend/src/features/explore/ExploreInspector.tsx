import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BookOpen, History, Link2, ScrollText, Crosshair } from 'lucide-react';
import { Button, ErrorNotice } from '../../components/ui';
import { EntityMark } from '../../components/EntityMark';
import { Portrait } from '../objects/Portrait';
import { entityKinds } from '../creation/api';
import { exploreApi, familyNames, period, type Detail, type ExploreGraph, type SourceLink } from './api';
import { groupEdges, type Selection } from './graphModel';

const statusNames: Record<string, string> = { active: '收录中', withdrawn: '已撤回', superseded: '已替代', deleted: '已删除' };
function Sources({ values }: { values: SourceLink[] }) {
  return values.length ? <div className="explore-sources">{values.map((source, i) => <Link key={`${source.to}:${i}`} to={source.to}><BookOpen size={14}/><span>{source.label}<small>{source.kind === 'simulation' ? '已接受记录的模拟依据' : source.kind === 'material' ? '明确关联的原版本资料' : '正文审阅依据'}</small></span><ArrowUpRight size={14}/></Link>)}</div> : <p className="explore-muted">尚无关联的正文或模拟来源。</p>;
}

export function ExploreInspector({ world, graph, selection, portraits, onSelect, onFocus, onTime, focusNode, timeline }: {
  world: string; graph?: ExploreGraph; selection?: Selection; portraits: Record<string, number>;
  onSelect: (selection: Selection) => void; onFocus: (key: string) => void;
  onTime?: (kind: string, id: string) => void; focusNode?: import('./api').ExploreNode | null;
  timeline?: boolean;
}) {
  const groups = graph ? groupEdges(graph) : [];
  const node = selection?.type === 'node' ? graph?.nodes.find(n => n.key === selection.key) || (focusNode?.key === selection.key ? focusNode : undefined) : undefined;
  const group = selection?.type === 'edge' ? groups.find(g => g.id === selection.key) : undefined;
  const [override, setOverride] = useState<{ anchor: string; kind: string; id: string }>();
  const direct = selection?.type === 'record' ? { kind: selection.key.split(':')[0], id: selection.key.slice(selection.key.indexOf(':') + 1) } : undefined;
  const chosen = override?.anchor === selection?.key ? override : direct || (group ? { kind: group.records[0].record_type, id: group.records[0].record_id } : node ? { kind: node.type, id: node.id } : undefined);
  const requested = chosen ? `${chosen.kind}:${chosen.id}` : '';
  const [loaded, setLoaded] = useState<{ key: string; detail: Detail }>(), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<'overview' | 'sources' | 'history'>('overview'), [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!chosen) return;
    let active = true;
    setLoading(true); setError('');
    exploreApi.detail(world, chosen.kind, chosen.id).then(detail => { if (active) setLoaded({ key: requested, detail }); })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [world, requested, retry]);
  const detail = loaded?.detail, stale = loaded?.key !== requested;
  const identity = loaded ? graph?.nodes.find(n => n.id === detail?.id) || (focusNode?.id === detail?.id ? focusNode : undefined) : undefined;
  const connections = groups.filter(g => g.source === identity?.key || g.target === identity?.key);
  const name = (key: string) => graph?.nodes.find(n => n.key === key)?.label || '查看关联对象';
  if (!selection || !chosen) return <div className="explore-inspector-empty"><Crosshair size={28} strokeWidth={1.4}/><h3>{timeline ? '沿着时间查看记录' : '看清每一条联系'}</h3><p>{timeline ? '选择事件、关系期间或事实，查看详情、原始时间和来源。' : '选择节点查看资料；选择连线查看正式记录、时间和来源。'}</p></div>;
  return <div className="explore-inspector">
    <div className="explore-detail-feedback" aria-live="polite">{loading ? '正在读取所选资料…' : error ? '资料读取失败' : 'Working Canon · 正式记录'}</div>
    {error && <><ErrorNotice>{error}</ErrorNotice><Button onClick={() => setRetry(n => n + 1)}>重新读取资料</Button></>}
    {group && <div className="explore-edge-picker"><span>{name(group.source)} <ArrowUpRight size={13}/> {name(group.target)}</span>
      {group.records.length > 1 && <label>正式记录<select aria-label="选择联系记录" value={chosen.id} onChange={e => { const edge = group.records.find(r => r.record_id === e.target.value); if (edge) setOverride({ anchor: selection.key, kind: edge.record_type, id: edge.record_id }); }}>{group.records.map(r => <option key={r.id} value={r.record_id}>{r.label} · {period(r)}</option>)}</select></label>}
    </div>}
    {detail && <div aria-busy={stale || loading} inert={stale || loading || !!error}>
      <header className="explore-identity">
        {identity && (identity.kind === 'character' && portraits[identity.id] ? <Portrait id={identity.id} name={identity.label} version={portraits[identity.id]}/> : identity.type === 'event' ? <span className="entity-mark"><ScrollText size={26}/></span> : <EntityMark kind={identity.kind}/>)}
        {!identity && <span className="entity-mark">{detail.kind === 'event' ? <ScrollText size={25}/> : <Link2 size={25}/>}</span>}
        <div><small>{identity ? identity.type === 'event' ? '正式事件' : entityKinds[identity.kind] || identity.kind : group ? familyNames[group.family] : ({ event: '正式事件', relationship: '正式关系', assertion: '正式事实' } as Record<string,string>)[detail.kind] || '正式记录'}</small><h2>{detail.title}</h2><span>{statusNames[detail.record.status] || detail.record.status} · v{detail.record.version}</span></div>
      </header>
      {node && <div className="explore-identity-actions"><Button onClick={() => onFocus(node.key)}><Crosshair size={14}/>设为焦点</Button><Link className="text-link" to={node.to}>完整资料 <ArrowUpRight size={14}/></Link></div>}
      {onTime && chosen && <div className="explore-identity-actions"><Button onClick={() => onTime(chosen.kind, chosen.id)}><History size={14}/>在时间轴查看</Button></div>}
      <div className="explore-detail-tabs" role="tablist" aria-label="探索详情页签">{([['overview', '资料'], ['sources', '依据'], ['history', '修改历史']] as const).map(([value, label], index) => <button type="button" role="tab" key={value} aria-selected={tab === value} aria-controls="explore-detail-body" id={`explore-tab-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const values = ['overview', 'sources', 'history'] as const; const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3; setTab(values[next]); document.getElementById(`explore-tab-${values[next]}`)?.focus(); } }}>{label}</button>)}</div>
      <div id="explore-detail-body" role="tabpanel" aria-labelledby={`explore-tab-${tab}`}>
        {tab === 'overview' && <>
          {detail.kind === 'entity' ? <>
            <section className="explore-detail-section"><h3><ScrollText size={14}/>作者资料</h3>{detail.settings.length ? <dl>{detail.settings.map((setting, i) => <div key={i}><dt>{setting.label}</dt><dd>{setting.text.length > 140 ? <details><summary>{setting.text.slice(0, 90)}…</summary><p>{setting.text}</p></details> : setting.text}</dd></div>)}</dl> : <p className="explore-muted">尚未填写说明。</p>}<p className="explore-boundary">作者说明与计划不自动成为正式事实或角色知识。</p></section>
            <section className="explore-detail-section"><h3><BookOpen size={14}/>正式事实 <small>{detail.facts.length}</small></h3>{detail.facts.length ? detail.facts.map(f => <details className="explore-fact" key={f.id}><summary><span>{f.predicate}<strong>{f.value}</strong></span></summary><p>{period(f)}</p><p>{f.source_note}</p><Sources values={f.sources}/></details>) : <p className="explore-muted">尚无正式事实。</p>}</section>
          </> : <section className="explore-detail-section"><h3>记录与有效时间</h3><p className="explore-record-description">{detail.record.description || detail.record.value || '尚未填写说明。'}</p><dl><div><dt>故事时间</dt><dd>{period(detail.record)}</dd></div>{detail.record.strength !== undefined && detail.record.strength !== null && <div><dt>记录强度</dt><dd>{detail.record.strength}</dd></div>}<div><dt>来源说明</dt><dd>{detail.record.source_note || '未注明'}</dd></div></dl>
            {detail.record.metadata?.before_state && <p>事件前：{detail.record.metadata.before_state}</p>}{detail.record.metadata?.after_state && <p>事件后：{detail.record.metadata.after_state}</p>}
            <p className="explore-boundary">收录状态不等于某个故事时刻的有效状态。</p>
          </section>}
          {!!connections.length && <section className="explore-detail-section"><h3><Link2 size={14}/>可见联系 <small>{connections.length}</small></h3>{connections.map(g => <button type="button" className="explore-contact-row" key={g.id} onClick={() => onSelect({ type: 'edge', key: g.id })}><span>{name(g.source === node?.key ? g.target : g.source)}<small>{g.source === node?.key ? '→' : '←'} {g.records[0].label}{g.records.length > 1 ? ` · ${g.records.length} 条` : ''}</small></span><ArrowUpRight size={14}/></button>)}</section>}
          {!!detail.references.length && <section className="explore-detail-section"><h3>关联对象</h3>{detail.references.map(ref => <button type="button" className="explore-contact-row" key={`${ref.role}:${ref.key}`} disabled={!ref.active} onClick={() => onFocus(ref.key)}><span>{ref.label}<small>{ref.role}{!ref.active ? ' · 已不在活跃范围' : ''}</small></span><Crosshair size={14}/></button>)}</section>}
          {!!detail.states.length && <section className="explore-detail-section"><h3><History size={14}/>此对象对的关系记录</h3>{detail.states.map(state => <button type="button" key={state.id} className="explore-state-row" aria-pressed={detail.id === state.id} onClick={() => setOverride({ anchor: selection.key, kind: 'relationship', id: state.id })}><strong>{state.label}<small>{statusNames[state.status] || state.status}</small></strong><span>{period(state)}</span></button>)}<p className="explore-boundary">按记录列出，不推测故事时间的先后。</p></section>}
          <section className="explore-detail-section"><h3><BookOpen size={14}/>记录依据</h3><Sources values={detail.sources}/></section>
        </>}
        {tab === 'sources' && <section className="explore-detail-section"><h3>直接来源与关联资料</h3><Sources values={detail.sources}/>{detail.facts.filter(f => f.sources.length).map(f => <div className="explore-source-fact" key={f.id}><h4>{f.predicate} · {f.value}</h4><Sources values={f.sources}/></div>)}<p className="explore-boundary">资料关联用于查阅依据，不额外生成事实连线。</p></section>}
        {tab === 'history' && <section className="explore-detail-section"><h3><History size={14}/>记录修改历史</h3><p className="explore-boundary">以下时间为本机保存时间，关系有效期另见资料页。</p>{detail.history.map(version => <details className="explore-version" key={version.version}><summary><strong>v{version.version}</strong><span>{version.saved_at ? new Date(version.saved_at.includes('T') ? version.saved_at : version.saved_at.replace(' ', 'T') + 'Z').toLocaleString() : '保存时间未记录'}</span></summary><dl>{Object.entries(version.payload).filter(([key, v]) => ['name', 'title', 'label', 'predicate', 'value', 'description', 'valid_from', 'valid_until', 'status', 'source_note', 'strength'].includes(key) && v !== null && v !== '').map(([key, value]) => <div key={key}><dt>{({ name: '名称', title: '标题', label: '关系', predicate: '字段', value: '值', description: '说明', valid_from: '有效起始', valid_until: '有效结束', status: '收录状态', source_note: '来源说明', strength: '强度' } as Record<string, string>)[key]}</dt><dd>{String(value)}</dd></div>)}</dl></details>)}</section>}
      </div>
    </div>}
  </div>;
}
