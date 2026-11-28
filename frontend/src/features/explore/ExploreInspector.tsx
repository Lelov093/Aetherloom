import { useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BookOpen, History, Link2, Map as MapIcon, Orbit, ScrollText, Crosshair } from 'lucide-react';
import { Button, ErrorNotice } from '../../components/ui';
import { EntityMark } from '../../components/EntityMark';
import { Portrait } from '../objects/Portrait';
import { entityKinds } from '../creation/api';
import { EventNarrativeButton } from '../creation/Narrative';
import { runtimeCanonSources } from '../runtime/reviewAccess';
import { exploreApi, familyNames, period, recordMapFocus, type Detail, type ExploreGraph, type SourceLink } from './api';
import { groupEdges, type Selection } from './graphModel';
import { periodCardPath, type StoryMoment } from '../periods/api';

const statusNames: Record<string, string> = { active: '收录中', withdrawn: '已撤回', superseded: '已替代', deleted: '已删除' };
type FollowLink = (event: MouseEvent<HTMLAnchorElement>, destination: string) => void;
export interface InspectorView {
  tab: 'overview' | 'sources' | 'history';
  override?: { anchor: string; kind: string; id: string };
  openFacts?: string[];
}

function Sources({ world, kind, id, values, onOpen }: {
  world: string; kind: string; id: string; values: SourceLink[]; onOpen: FollowLink;
}) {
  const key = `${world}/${kind}/${id}`;
  const [loaded, setLoaded] = useState<{ key: string; links: SourceLink[]; failed?: boolean }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    runtimeCanonSources(world, kind, id).then(sources => {
      if (!active) return;
      setLoaded({ key, links: sources.map(source => ({
        label: `${source.title} · 第${source.seq}步`,
        to: `/worlds/${world}/review/simulation?${new URLSearchParams({ proposal: source.id })}`,
        kind: 'simulation',
      })) });
    }).catch(() => { if (active) setLoaded({ key, links: [], failed: true }); });
    return () => { active = false; };
  }, [world, kind, id, key, retry]);
  const result = loaded?.key === key ? loaded : undefined;
  const links = [...values, ...(result?.links ?? [])];
  return <>
    {!!links.length && <div className="explore-sources">{links.map((source, i) => (
      <Link key={`${source.to}:${i}`} to={source.to} onClick={event => onOpen(event, source.to)}>
        <BookOpen size={14}/>
        <span>{source.label}<small>{source.kind === 'simulation' ? '已接受记录的模拟依据' : source.kind === 'material' ? '明确关联的原版本资料' : '正文审阅依据'}</small></span>
        <ArrowUpRight size={14}/>
      </Link>
    ))}</div>}
    {!result && <p className="explore-muted" role="status">正在读取模拟来源…</p>}
    {result?.failed && <div className="review-source-error" role="status">
      模拟来源读取失败<Button variant="ghost" onClick={() => { setLoaded(undefined); setRetry(value => value + 1); }}>重试来源</Button>
    </div>}
    {result && !result.failed && !links.length && <p className="explore-muted">暂无可查阅的来源。</p>}
  </>;
}

export function ExploreInspector({ world, graph, selection, portraits, onSelect, onFocus, onReference = onFocus, onTime, onMap, focusNode, timeline, overview, connectionsVisible, view, onViewChange, onFollowLink, moment }: {
  world: string; graph?: ExploreGraph; selection?: Selection; portraits: Record<string, number>;
  onSelect: (selection: Selection) => void; onFocus: (key: string) => void;
  onReference?: (key: string) => void;
  onTime?: (kind: string, id: string) => void; focusNode?: import('./api').ExploreNode | null;
  onMap?: (location: string, record: string) => void;
  timeline?: boolean;
  overview?: boolean;
  connectionsVisible: boolean;
  view: InspectorView; onViewChange: (view: InspectorView) => void; onFollowLink: FollowLink;
  moment?: StoryMoment;
}) {
  const groups = graph ? groupEdges(graph) : [];
  const node = selection?.type === 'node' ? graph?.nodes.find(n => n.key === selection.key) || (focusNode?.key === selection.key ? focusNode : undefined) : undefined;
  const group = selection?.type === 'edge' ? groups.find(g => g.id === selection.key) : undefined;
  const { tab, override } = view;
  const setTab = (tab: InspectorView['tab']) => onViewChange({ ...view, tab });
  const setOverride = (override: InspectorView['override']) => onViewChange({ ...view, override });
  function factEvidence(fact: Detail['facts'][number], overview: boolean) {
    const openFacts = view.openFacts ?? [];
    const open = openFacts.includes(fact.id);
    return <details className="explore-fact" key={fact.id} open={open} onToggle={event => {
      const expanded = event.currentTarget.open;
      if (expanded !== open) onViewChange({
        ...view, openFacts: expanded ? [...openFacts, fact.id] : openFacts.filter(id => id !== fact.id),
      });
    }}>
      <summary><span>{fact.predicate}<strong>{fact.value}</strong></span></summary>
      {open && <>
        {overview && <><p>{period(fact)}</p>{fact.source_note && <p>{fact.source_note}</p>}</>}
        <Sources world={world} kind="assertion" id={fact.id} values={fact.sources} onOpen={onFollowLink}/>
      </>}
    </details>;
  }
  const direct = selection?.type === 'record' ? { kind: selection.key.split(':')[0], id: selection.key.slice(selection.key.indexOf(':') + 1) } : undefined;
  const chosen = override?.anchor === selection?.key ? override : direct || (group ? { kind: group.records[0].record_type, id: group.records[0].record_id } : node ? { kind: node.type, id: node.id } : undefined);
  const recordKey = chosen ? `${chosen.kind}:${chosen.id}` : '';
  const requested = recordKey && `${recordKey}:${JSON.stringify(moment || null)}`;
  const [loaded, setLoaded] = useState<{ key: string; detail: Detail }>(), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!chosen) return;
    let active = true;
    setLoading(true); setError('');
    exploreApi.detail(world, chosen.kind, chosen.id, moment).then(detail => { if (active) setLoaded({ key: requested, detail }); })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [world, requested, retry]);
  const detail = loaded?.detail, stale = loaded?.key !== requested;
  const editRelation = detail?.kind === 'relationship' && detail.record.status === 'active'
    ? `/worlds/${world}/create/records?tab=relations&relationship=${encodeURIComponent(detail.id)}` : undefined;
  const relatedEvents = detail?.kind === 'relationship' ? detail.references.filter(ref => ref.kind === 'event') : [];
  const references = detail?.kind === 'relationship' ? detail.references.filter(ref => ref.kind !== 'event') : detail?.references ?? [];
  const location = timeline && detail?.kind === 'event' && detail.record.status === 'active' && detail.record.location_id;
  const beforeAfter = location && detail ? periodCardPath(world, location, { event: detail.id, side: 'after' }) : undefined;
  const fullCard = node?.type === 'entity' && moment ? periodCardPath(world, node.id, moment) : node?.to;
  const mapFocus = onMap && detail && (detail.kind === 'entity'
    ? detail.record.kind === 'location' && detail.record.status === 'active' ? `entity:${detail.id}` : undefined
    : recordMapFocus({ kind: detail.kind, location_id: detail.record.location_id }, detail.references.filter(ref => ref.active), graph?.focus));
  const setupRoute = detail?.kind === 'event' && detail.record.status === 'active'
    ? `/worlds/${world}/simulate?${new URLSearchParams({
        setup: 'event', canon_event: detail.id, event_version: String(detail.record.version),
      })}`
    : undefined;
  const identity = loaded ? graph?.nodes.find(n => n.id === detail?.id) || (focusNode?.id === detail?.id ? focusNode : undefined) : undefined;
  const connections = groups.filter(g => g.source === identity?.key || g.target === identity?.key);
  const name = (key: string) => graph?.nodes.find(n => n.key === key)?.label || '查看关联对象';
  function referenceRows(items: Detail['references']) {
    return items.map(ref => <button type="button" className="explore-contact-row" key={ref.key} disabled={!ref.active} onClick={() => onReference(ref.key)}>
      <span>{ref.label}<small>{ref.role}{!ref.active ? ' · 已不在活跃范围' : ''}</small></span><Crosshair size={14}/>
    </button>);
  }
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
      {node && fullCard && <div className="explore-identity-actions">{node.key !== graph?.focus && <Button onClick={() => onFocus(node.key)}><Crosshair size={14}/>{overview ? '查看局部邻域' : '设为焦点'}</Button>}<Link className="text-link" to={fullCard} onClick={event => onFollowLink(event, fullCard)}>完整资料 <ArrowUpRight size={14}/></Link></div>}
      {(detail.kind === 'event' || onTime || mapFocus || setupRoute || editRelation || beforeAfter) && <div className="explore-identity-actions">
        {detail.kind === 'event' && <EventNarrativeButton key={detail.id} world={world} identity={detail.id} onOpen={onFollowLink} />}
        {beforeAfter && <Link className="text-link" to={beforeAfter} onClick={event => onFollowLink(event, beforeAfter)}>查看事件前后 <ArrowUpRight size={14}/></Link>}
        {editRelation && <Link className="text-link" to={editRelation} onClick={event => onFollowLink(event, editRelation)}>编辑关系 <ArrowUpRight size={14}/></Link>}
        {onTime && <Button onClick={() => onTime(chosen.kind, chosen.id)}><History size={14}/>在时间轴查看</Button>}
        {onMap && mapFocus && <Button onClick={() => onMap(mapFocus, recordKey)}><MapIcon size={14}/>在地图查看</Button>}
        {setupRoute && <Link className="text-link" to={setupRoute} onClick={event => onFollowLink(event, setupRoute)}><Orbit size={14}/>准备模拟</Link>}
      </div>}
      <div className="explore-detail-tabs" role="tablist" aria-label="探索详情页签">{([['overview', '资料'], ['sources', '依据'], ['history', '修改历史']] as const).map(([value, label], index) => <button type="button" role="tab" key={value} aria-selected={tab === value} aria-controls="explore-detail-body" id={`explore-tab-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const values = ['overview', 'sources', 'history'] as const; const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3; setTab(values[next]); document.getElementById(`explore-tab-${values[next]}`)?.focus(); } }}>{label}</button>)}</div>
      <div id="explore-detail-body" role="tabpanel" aria-labelledby={`explore-tab-${tab}`}>
        {tab === 'overview' && <>
          {detail.kind === 'entity' ? <>
            <section className="explore-detail-section"><h3><ScrollText size={14}/>作者资料</h3>{detail.settings.length ? <dl>{detail.settings.map((setting, i) => <div key={i}><dt>{setting.label}</dt><dd>{setting.text.length > 140 ? <details><summary>{setting.text.slice(0, 90)}…</summary><p>{setting.text}</p></details> : setting.text}</dd></div>)}</dl> : <p className="explore-muted">尚未填写说明。</p>}<p className="explore-boundary">作者说明与计划不自动成为正式事实或角色知识。</p></section>
            <section className="explore-detail-section"><h3><BookOpen size={14}/>正式事实 <small>{detail.facts.length}</small></h3>{detail.facts.length ? detail.facts.map(fact => factEvidence(fact, true)) : <p className="explore-muted">尚无正式事实。</p>}</section>
          </> : <section className="explore-detail-section"><h3>记录与有效时间</h3><p className="explore-record-description">{detail.record.description || detail.record.value || '尚未填写说明。'}</p><dl><div><dt>故事时间</dt><dd>{period(detail.record)}</dd></div>{detail.record.strength !== undefined && detail.record.strength !== null && <div><dt>记录强度</dt><dd>{detail.record.strength}</dd></div>}<div><dt>来源说明</dt><dd>{detail.record.source_note || '未注明'}</dd></div></dl>
            {detail.record.metadata?.before_state && <p>事件前：{detail.record.metadata.before_state}</p>}{detail.record.metadata?.after_state && <p>事件后：{detail.record.metadata.after_state}</p>}
            <p className="explore-boundary">收录状态不等于某个故事时刻的有效状态。</p>
          </section>}
          {!!connections.length && <section className="explore-detail-section"><h3><Link2 size={14}/>{connectionsVisible ? '可见联系' : '范围内联系'} <small>{connections.length}</small></h3>{connections.map(g => <button type="button" className="explore-contact-row" key={g.id} onClick={() => onSelect({ type: 'edge', key: g.id })}><span>{name(g.source === node?.key ? g.target : g.source)}<small>{g.source === node?.key ? '→' : '←'} {g.records[0].label}{g.records.length > 1 ? ` · ${g.records.length} 条` : ''}</small></span><ArrowUpRight size={14}/></button>)}</section>}
          {!!references.length && <section className="explore-detail-section"><h3>关联对象</h3>{referenceRows(references)}</section>}
          {!!relatedEvents.length && <section className="explore-detail-section">
            <h3><ScrollText size={14}/>相关正式事件</h3>
            <p className="explore-muted">按端点的参与或发生地查找，按标题显示最多 12 条。</p>
            {referenceRows(relatedEvents)}
          </section>}
          {!!detail.states.length && <section className="explore-detail-section"><h3><History size={14}/>此对象对的关系记录</h3>{detail.states.map(state => <button type="button" key={state.id} className="explore-state-row" aria-pressed={detail.id === state.id} onClick={() => setOverride({ anchor: selection.key, kind: 'relationship', id: state.id })}><strong>{state.label}<small>{statusNames[state.status] || state.status}</small></strong><span>{period(state)}</span></button>)}<p className="explore-boundary">按记录列出，不推测故事时间的先后。</p></section>}
          <section className="explore-detail-section"><h3><BookOpen size={14}/>记录依据</h3><Sources world={world} kind={detail.kind} id={detail.id} values={detail.sources} onOpen={onFollowLink}/></section>
        </>}
        {tab === 'sources' && <>
          <section className="explore-detail-section">
            <h3>直接来源与关联资料</h3>
            <Sources world={world} kind={detail.kind} id={detail.id} values={detail.sources} onOpen={onFollowLink}/>
            <p className="explore-boundary">资料关联用于查阅依据，不额外生成事实连线。</p>
          </section>
          {!!detail.facts.length && <section className="explore-detail-section">
            <h3>正式事实依据 <small>{detail.facts.length}</small></h3>
            {detail.facts.map(fact => factEvidence(fact, false))}
          </section>}
        </>}
        {tab === 'history' && <section className="explore-detail-section"><h3><History size={14}/>记录修改历史</h3><p className="explore-boundary">以下时间为本机保存时间，关系有效期另见资料页。</p>{detail.history.map(version => <details className="explore-version" key={version.version}><summary><strong>v{version.version}</strong><span>{version.saved_at ? new Date(version.saved_at.includes('T') ? version.saved_at : version.saved_at.replace(' ', 'T') + 'Z').toLocaleString() : '保存时间未记录'}</span></summary><dl>{Object.entries(version.payload).filter(([key, v]) => ['name', 'title', 'label', 'predicate', 'value', 'description', 'valid_from', 'valid_until', 'status', 'source_note', 'strength'].includes(key) && v !== null && v !== '').map(([key, value]) => <div key={key}><dt>{({ name: '名称', title: '标题', label: '关系', predicate: '字段', value: '值', description: '说明', valid_from: '有效起始', valid_until: '有效结束', status: '收录状态', source_note: '来源说明', strength: '强度' } as Record<string, string>)[key]}</dt><dd>{String(value)}</dd></div>)}</dl></details>)}</section>}
      </div>
    </div>}
  </div>;
}
