import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Viewport, XYPosition } from '@xyflow/react';
import { ArrowLeft, Check, Compass, Crosshair, Eye, Layers, Network, PanelLeft, PanelRight, RotateCcw, Save, Search, SlidersHorizontal, ScrollText, X, CalendarRange } from 'lucide-react';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { EntityMark } from '../../components/EntityMark';
import { WorkspaceHeader, useWorkspaceTrail } from '../../components/WorkspaceContext';
import { entityKinds } from '../creation/api';
import { ObjectBrowser } from '../objects/ObjectBrowser';
import { Portrait, usePortraits } from '../objects/Portrait';
import { exploreApi, families, familyNames, type ExploreGraph, type Family } from './api';
import { ExploreCanvas } from './ExploreCanvas';
import { ExploreInspector } from './ExploreInspector';
import { ExplorePane, ExploreResize, useExplorePanels } from './ExplorePanels';
import { groupEdges, type Selection } from './graphModel';
import { readViews, writeViews, type SavedView } from './views';
import { timeLayers, type TimeLayer, type TimelineRecord, type YearRange } from './api';
import { useTimeline } from './useTimeline';
import { TimelineCanvas } from './TimelineCanvas';
import { YearFilter } from './YearFilter';
import type { TimeViewport } from './timelineModel';
import { TimelineScope } from './TimelineScope';

export function ExploreWorkspace({ world }: { world: string }) {
  const [params, setParams] = useSearchParams();
  const requestedFocus = params.get('focus') || '';
  const mode = params.get('view') === 'timeline' ? 'timeline' : 'relationship';
  const numberParam = (key: string) => { const text = params.get(key); return text && /^-?\d{1,6}$/.test(text) ? Number(text) : undefined; };
  const range: YearRange = { start: numberParam('year_start'), end: numberParam('year_end') };
  const uncertain = params.get('uncertain') !== 'false';
  const [layers, setTimeLayers] = useState<TimeLayer[]>(timeLayers), [placedOffset, setPlacedOffset] = useState(0), [unplacedOffset, setUnplacedOffset] = useState(0), [locate, setLocate] = useState(params.get('record') || '');
  const [cursor, setCursor] = useState<number>(), [initialTimeViewport, setInitialTimeViewport] = useState<TimeViewport>(), [initialTimeScroll, setInitialTimeScroll] = useState(0);
  const timeSnapshot = useRef<{ viewport?: TimeViewport; scroll: number }>({ scroll: 0 });
  const [graph, setGraph] = useState<ExploreGraph>(), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [graphKey, setGraphKey] = useState('');
  const [hops, setHops] = useState(1), [expanded, setExpanded] = useState<string[]>([]), [chosenFamilies, setFamilies] = useState<Family[]>(families);
  const [kinds, setKinds] = useState<string[]>([]), [limit, setLimit] = useState(12), [labels, setLabels] = useState(true), [search, setSearch] = useState('');
  const [selection, setSelection] = useState<Selection | undefined>(params.get('record') ? { type: 'record', key: params.get('record')! } : requestedFocus ? { type: 'node', key: requestedFocus } : undefined), [picking, setPicking] = useState(false), [saving, setSaving] = useState(false), [saveName, setSaveName] = useState('');
  const [views, setViews] = useState(() => readViews(world)), [viewId, setViewId] = useState(''), [notice, setNotice] = useState('');
  const [restore, setRestore] = useState(0), [initialPositions, setInitialPositions] = useState<Record<string, XYPosition>>({}), [initialViewport, setInitialViewport] = useState<Viewport>();
  const snapshot = useRef<{ positions: Record<string, XYPosition>; viewport?: Viewport }>({ positions: {} });
  const [focusBack, setFocusBack] = useState<string[]>([]);
  const panels = useExplorePanels(), { portraits } = usePortraits(world);
  const timeline = useTimeline(world, mode === 'timeline', { focus: requestedFocus, range, layers, uncertain, placedOffset, unplacedOffset, locate }, retry);
  const focus = mode === 'timeline' ? timeline.placed?.focus_object : graph?.nodes.find(n => n.key === graph.focus);
  const queryKey = JSON.stringify({ focus: requestedFocus, hops, expanded, families: chosenFamilies, kinds, limit, range, uncertain });
  const busy = mode === 'timeline' ? timeline.loading : loading || graphKey !== queryKey && !error;
  const problem = mode === 'timeline' ? timeline.error : error;
  useWorkspaceTrail([{ label: focus?.label || (mode === 'timeline' ? '世界时间轴' : '关系探索') }]);
  function updateParams(changes: Record<string, string | undefined>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) { if (value === undefined || value === '') next.delete(key); else next.set(key, value); }
    setParams(next);
  }
  function changeRange(value: YearRange) { updateParams({ year_start: value.start === undefined ? undefined : String(value.start), year_end: value.end === undefined ? undefined : String(value.end) }); setPlacedOffset(0); setUnplacedOffset(0); setLocate(''); setViewId(''); }
  function switchMode(value: 'relationship' | 'timeline') { updateParams({ view: value === 'timeline' ? value : undefined }); setViewId(''); }
  const recordParam = params.get('record');
  useEffect(() => { setSelection(old => recordParam ? { type: 'record', key: recordParam } : old?.type === 'record' ? requestedFocus ? { type: 'node', key: requestedFocus } : undefined : old); }, [recordParam]);
  useEffect(() => {
    const page = timeline.placed;
    if (mode !== 'timeline' || timeline.loading || !page?.requested_focus || page.requested_focus === page.focus) return;
    setSelection(old => old?.type === 'node' && old.key === page.requested_focus ? { type: 'node', key: page.focus } : old);
    setNotice('原身份已合并，正在展示保留的正式对象。');
  }, [mode, timeline.loading, timeline.placed]);
  useEffect(() => {
    if (mode !== 'relationship') return;
    let active = true;
    setLoading(true); setError('');
    exploreApi.graph(world, JSON.parse(queryKey)).then(value => {
      if (!active) return;
      setGraph(value);
      setGraphKey(queryKey);
      setSelection(old => old && (old.type === 'record' || (old.type === 'node' ? value.nodes.some(n => n.key === old.key) : groupEdges(value).some(g => g.id === old.key))) ? old : value.focus ? { type: 'node', key: value.focus } : undefined);
      if (value.requested_focus && value.requested_focus !== value.focus) setNotice('原身份已合并，正在展示保留的正式对象。');
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [world, mode, queryKey, retry]);
  function changeFocus(key: string, remember = true) {
    if (remember && graph?.focus && graph.focus !== key) setFocusBack(old => [...old, graph.focus].slice(-30));
    updateParams({ focus: key, record: undefined }); setExpanded([]); setSearch(''); setViewId(''); setNotice(''); setPlacedOffset(0); setUnplacedOffset(0); setLocate('');
    setSelection(key ? { type: 'node', key } : undefined);
    setInitialPositions({}); setInitialViewport(undefined);
    if (panels.narrow) panels.toggle('left', false);
  }
  function select(value?: Selection) {
    if (busy || problem) return;
    setSelection(value);
    updateParams({ record: value?.type === 'record' ? value.key : undefined });
    if (value && panels.narrow) panels.toggle('right', true);
  }
  function expand(key: string) {
    if (loading || error || graph?.expanded.includes(key)) return;
    if (expanded.length >= 20) { setNotice('已展开 20 个分支，可收起分支或将对象设为新焦点后继续。'); return; }
    setExpanded(old => [...old, key]); setViewId('');
  }
  function restoreView(id: string) {
    const view = views.find(v => v.id === id);
    if (!view) { setViewId(''); return; }
    if (graph?.focus && graph.focus !== view.focus) setFocusBack(old => [...old, graph.focus]);
    setParams({ ...(view.focus ? { focus: view.focus } : {}), ...(view.mode === 'timeline' ? { view: 'timeline' } : {}), ...((view.range?.start !== undefined) ? { year_start: String(view.range.start) } : {}), ...((view.range?.end !== undefined) ? { year_end: String(view.range.end) } : {}), uncertain: String(view.uncertain !== false) }); setHops(view.hops); setExpanded(view.expanded); setFamilies(view.families); setKinds(view.kinds); setLimit(view.limit); setLabels(view.labels);
    setTimeLayers(view.layers || timeLayers); setCursor(view.cursor); setPlacedOffset(view.timeOffsets?.placed || 0); setUnplacedOffset(view.timeOffsets?.unplaced || 0); setLocate(''); setSelection(view.focus ? { type: 'node', key: view.focus } : undefined);
    setInitialTimeViewport(view.timelineViewport); setInitialTimeScroll(view.timelineScroll || 0);
    setInitialPositions(view.positions); setInitialViewport(view.viewport); setRestore(n => n + 1); setViewId(id); setSearch(''); setNotice('已恢复显示偏好；内容按当前正式记录重新读取。');
  }
  function saveView() {
    if (!saveName.trim()) return;
    const value: SavedView = { id: crypto.randomUUID(), name: saveName.trim(), focus: mode === 'timeline' ? requestedFocus : graph?.focus || '', hops, expanded, families: chosenFamilies, kinds, limit, labels, mode, range, uncertain, layers, cursor, timelineViewport: timeSnapshot.current.viewport, timelineScroll: timeSnapshot.current.scroll, timeOffsets: { placed: timeline.placed?.offset || 0, unplaced: timeline.unplaced?.offset || 0 }, ...snapshot.current };
    const next = [...views, value];
    try { writeViews(world, next); setViews(next); setViewId(value.id); setSaving(false); setNotice('视图已保存在本机。'); }
    catch { setNotice('无法保存本机视图；当前探索仍可继续。'); }
  }
  function reset() {
    updateParams({ year_start: undefined, year_end: undefined, uncertain: undefined }); setPlacedOffset(0); setUnplacedOffset(0); setLocate(''); setTimeLayers(timeLayers); setCursor(undefined); setInitialTimeViewport(undefined); setInitialTimeScroll(0);
    setFamilies(families); setKinds([]); setHops(1); setExpanded([]); setLimit(12); setLabels(true); setSearch(''); setViewId('');
    setInitialPositions({}); setInitialViewport(undefined); setRestore(n => n + 1); panels.reset(); setNotice('已恢复默认探索视图。');
  }
  function showTime(kind: string, id: string) {
    const edge = graph?.edges.find(e => e.record_type === kind && e.record_id === id);
    const key = kind === 'entity' ? `entity:${id}` : kind === 'event' ? `event:${id}` : edge?.source || requestedFocus;
    updateParams({ view: 'timeline', focus: key, record: kind === 'entity' ? undefined : `${kind}:${id}`, year_start: undefined, year_end: undefined, uncertain: undefined });
    setTimeLayers(timeLayers); setPlacedOffset(0); setUnplacedOffset(0); setLocate(kind === 'entity' ? '' : `${kind}:${id}`);
    setSelection(kind === 'entity' ? { type: 'node', key } : { type: 'record', key: `${kind}:${id}` }); setViewId('');
  }
  function showGraph(record?: TimelineRecord) {
    const key = record?.objects.some(o => o.key === requestedFocus) ? requestedFocus : record?.objects[0]?.key || (record?.kind === 'event' ? `event:${record.id}` : requestedFocus);
    updateParams({ view: undefined, focus: key, record: record?.key, ...(cursor !== undefined && !record ? { year_start: String(cursor), year_end: String(cursor) } : {}) });
    setSelection(record ? { type: 'record', key: record.key } : key ? { type: 'node', key } : undefined); setViewId('');
  }
  const objects = graph?.nodes.filter(n => `${n.label} ${n.subtitle} ${entityKinds[n.kind] || n.kind}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) || [];
  return <main id="main-content" className={`explore-workspace ${panels.narrow ? 'is-narrow' : ''}`} style={{ '--explore-left': `${panels.leftWidth}px`, '--explore-right': `${panels.rightWidth}px` } as CSSProperties}>
    <WorkspaceHeader><span className="explore-scope-chip"><Network size={14}/>世界范围 · 正式记录</span></WorkspaceHeader>
    {panels.leftOpen && <div className="explore-side-frame explore-left-frame"><ExplorePane side="left" floating={panels.narrow} heading={mode === 'timeline' ? '时间探索' : '关系探索'} onClose={() => panels.toggle('left', false)}>
      <div className="explore-left-scroll">
        <section className="explore-focus-section"><h3><Crosshair size={14}/>焦点</h3><button type="button" className="explore-focus-card" onClick={() => setPicking(true)}>
          {focus ? <>{focus.kind === 'character' && portraits[focus.id] ? <Portrait id={focus.id} name={focus.label} version={portraits[focus.id]}/> : focus.type === 'event' ? <span className="entity-mark"><ScrollText size={23}/></span> : <EntityMark kind={focus.kind}/>}<span><strong title={focus.label}>{focus.label}</strong><small>{focus.type === 'event' ? '正式事件' : entityKinds[focus.kind] || focus.kind}</small></span></> : <><Compass size={25}/><span>{mode === 'timeline' ? '世界范围' : '选择焦点'}<small>从真实对象或事件开始</small></span></>}<Search size={15}/>
        </button>{!!focusBack.length && <Button variant="ghost" className="explore-back" onClick={() => { const previous = focusBack.at(-1)!; setFocusBack(old => old.slice(0, -1)); changeFocus(previous, false); }}><ArrowLeft size={13}/>上一焦点</Button>}</section>
        <YearFilter range={range} uncertain={uncertain} onChange={changeRange} onUncertain={value => { updateParams({ uncertain: String(value) }); setPlacedOffset(0); setUnplacedOffset(0); setLocate(''); setViewId(''); }}/>
        {mode === 'timeline' ? <TimelineScope placed={timeline.placed} unplaced={timeline.unplaced} layers={layers} onLayers={value => { setTimeLayers(value); setPlacedOffset(0); setUnplacedOffset(0); setLocate(''); setViewId(''); }} onFocus={changeFocus} busy={busy || !!problem}/> : <>
        <section className="explore-left-section"><h3><Layers size={14}/>探索范围</h3><div className="explore-hop-switch" aria-label="联系层数">{[1, 2].map(value => <button type="button" key={value} aria-pressed={hops === value} onClick={() => { setHops(value); setExpanded([]); setViewId(''); }}>{value === 1 ? '直接联系' : '两层联系'}</button>)}</div><p>以焦点为起点，逐层展开已有联系。</p>
          {!!expanded.length && <details className="explore-branches"><summary>手动展开的分支 · {expanded.length}</summary>{expanded.map(key => <button type="button" key={key} onClick={() => setExpanded(old => old.filter(k => k !== key))}><span>{graph?.nodes.find(n => n.key === key)?.label || '已隐藏的分支'}</span><X size={12}/></button>)}<Button variant="ghost" onClick={() => setExpanded([])}>收起手动分支</Button></details>}
        </section>
        <section className="explore-left-section"><h3><Link2Icon/>联系类别 <small>已显示记录</small></h3>{families.map(family => <label key={family} className="explore-filter-row"><input type="checkbox" checked={chosenFamilies.includes(family)} onChange={e => { setFamilies(old => e.target.checked ? [...old, family] : old.filter(f => f !== family)); setViewId(''); }}/><span>{familyNames[family]}</span><small>{graph?.edges.filter(e => e.family === family).length || 0}</small></label>)}
          <details className="explore-kind-filters"><summary><SlidersHorizontal size={13}/>对象类型{!kinds.length ? ' · 全部' : kinds[0] === '__none__' ? ' · 无' : ` · ${kinds.length}`}</summary><p>焦点始终保留，其他对象按类型筛选。</p><Button variant="ghost" onClick={() => setKinds([])}>显示全部类型</Button>{Object.entries({ ...entityKinds, event: '正式事件' }).map(([kind, label]) => <label className="explore-filter-row" key={kind}><input type="checkbox" checked={!kinds.length || kinds.includes(kind)} onChange={e => { const all = Object.keys({ ...entityKinds, event: '' }); setKinds(old => { const current = old.length ? old : all; const next = e.target.checked ? [...new Set([...current.filter(k => k !== '__none__'), kind])] : current.filter(k => k !== kind); return next.length ? next : ['__none__']; }); setViewId(''); }}/><span>{label}</span></label>)}</details>
        </section>
        <section className="explore-left-section explore-objects"><h3>可见对象 <small>{graph?.nodes.length || 0}</small><button type="button" className="explore-icon" aria-label="从世界资料选择焦点" onClick={() => setPicking(true)}><Search size={14}/></button></h3><label className="explore-search"><Search size={14}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="筛选可见对象…" aria-label="筛选可见对象"/></label>
          {objects.map(node => <button type="button" className={`explore-object-row ${selection?.type === 'node' && selection.key === node.key ? 'is-selected' : ''}`} key={node.key} onClick={() => select({ type: 'node', key: node.key })} disabled={loading || !!error}>{node.type === 'event' ? <ScrollText size={17}/> : <EntityMark kind={node.kind} small/>}<span><strong title={node.label}>{node.label}</strong><small>{node.type === 'event' ? '正式事件' : entityKinds[node.kind] || node.kind}{node.key === graph?.focus ? ' · 焦点' : ''}</small></span></button>)}{!objects.length && <p className="explore-muted">{search ? '没有匹配的可见对象。' : '选择焦点后在此查看对象。'}</p>}
        </section>
        </>}
      </div>
    </ExplorePane>{!panels.narrow && <ExploreResize side="left" panels={panels}/>}</div>}
    <section className="explore-center" aria-label={mode === 'timeline' ? '世界时间画布' : '世界关系画布'}>
      <header className="explore-canvas-heading"><div>{mode === 'timeline' ? <CalendarRange size={19} strokeWidth={1.5}/> : <Compass size={19} strokeWidth={1.5}/>}<span><h1>{mode === 'timeline' ? '时间探索' : '关系探索'}</h1><small>{mode === 'timeline' ? timeline.placed ? `${timeline.placed.total} 条可定位记录 · ${timeline.unplaced?.total || 0} 条时间未定` : '沿着时间，读懂世界中的变化' : graph ? `${graph.nodes.length} 个可见对象 · ${graph.edges.length} 条正式记录` : '人物、地点与事件，在这里连成世界'}</small></span></div><div className="explore-toolbar">
        <button className="explore-icon" type="button" aria-label="显示探索栏" aria-pressed={panels.leftOpen} title="探索范围" onClick={() => panels.toggle('left', !panels.leftOpen)}><PanelLeft size={17}/></button>
        {mode === 'relationship' && <button className="explore-icon" type="button" aria-label="显示关系标签" aria-pressed={labels} title="关系标签" onClick={() => { setLabels(v => !v); setViewId(''); }}><Eye size={17}/></button>}
        <button className="explore-icon" type="button" aria-label="显示探索详情" aria-pressed={panels.rightOpen} title="对象与联系" onClick={() => panels.toggle('right', !panels.rightOpen)}><PanelRight size={17}/></button>
        <button className="explore-icon" type="button" aria-label="重新读取正式记录" title="刷新正式记录" onClick={() => setRetry(n => n + 1)}><RotateCcw size={16}/></button>
        <Button variant="primary" className="explore-save" aria-label="保存视图" title="保存视图" disabled={busy || !!problem || views.length >= 20} onClick={() => { setSaveName(`${focus?.label || '世界'}的${mode === 'timeline' ? '时间轴' : '联系'}`); setSaving(true); }}><Save size={15}/><span>保存视图</span></Button>
      </div></header>
      <div className="explore-view-bar"><label><span>本机视图</span><select aria-label="恢复本机探索视图" value={viewId} onChange={e => restoreView(e.target.value)}><option value="">当前探索</option>{views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label><Button variant="ghost" onClick={reset}>恢复默认</Button>{viewId && <Button variant="ghost" onClick={() => { const next = views.filter(v => v.id !== viewId); try { writeViews(world, next); setViews(next); setViewId(''); setNotice('已删除本机显示视图。'); } catch { setNotice('无法删除本机视图。'); } }}>删除视图</Button>}</div>
      <div className="explore-mode-bar"><div className="explore-mode-switch" role="group" aria-label="探索视图"><button type="button" aria-pressed={mode === 'relationship'} onClick={() => switchMode('relationship')}><Network size={14}/>关系</button><button type="button" aria-pressed={mode === 'timeline'} onClick={() => switchMode('timeline')}><CalendarRange size={14}/>时间</button></div><span>{range.start === undefined && range.end === undefined ? '全部年份' : `${range.start ?? '不限'}—${range.end ?? '不限'} 年`}</span><small>年份相关记录 · 非完整世界快照</small></div>
      <div className="explore-surface" hidden={mode !== 'relationship'}><ExploreCanvas graph={graph} loading={busy || !!problem} labels={labels} selection={selection} portraits={portraits} positions={initialPositions} viewport={initialViewport} restore={restore}
        onSelect={select} onFocus={changeFocus} onExpand={expand} onSnapshot={(positions, viewport) => { snapshot.current = { positions, viewport }; }}/>
      </div><div className="explore-surface" hidden={mode !== 'timeline'}><TimelineCanvas placed={timeline.placed} unplaced={timeline.unplaced} loading={busy || !!problem} range={range} selected={selection?.type === 'record' ? selection.key : undefined} cursor={cursor} onCursor={year => { setCursor(year); select(undefined); }} onSelect={record => { setCursor(undefined); select({ type: 'record', key: record.key }); }} onGraph={showGraph} onPage={(section, offset) => { setLocate(''); if (section === 'placed') setPlacedOffset(offset); else setUnplacedOffset(offset); }} context={JSON.stringify({ focus: requestedFocus, range, layers, uncertain })} restore={restore} initialViewport={initialTimeViewport} initialScroll={initialTimeScroll} onSnapshot={(viewport, scroll) => { timeSnapshot.current = { viewport, scroll }; }}/></div>
      <div className="explore-canvas-status" role="status">{busy ? <><span className="explore-status-dot"/>正在读取正式记录，画布保持原位…</> : problem ? <><span>{problem}</span><Button onClick={() => setRetry(n => n + 1)}>重试</Button><Button onClick={() => setPicking(true)}>另选焦点</Button></> : mode === 'timeline' ? <span>年份边界与修改历史分开 · 未定时间不推测</span> : graph?.remaining_links ? <><span>此范围还有 {graph.remaining_links} 条记录未显示。</span>{limit < 120 && <Button onClick={() => { setLimit(old => Math.min(120, old + 12)); setViewId(''); }}>扩大可见范围</Button>}<Button onClick={() => setPicking(true)}>更换焦点</Button></> : <span>{graph?.nodes.length ? '单击查看 · 双击聚焦 · 节点旁展开联系' : <Link to={`/worlds/${world}/create/objects`}>打开世界对象，开始整理资料 →</Link>}</span>}{notice && <span className="explore-view-notice"><Check size={12}/>{notice}</span>}</div>
    </section>
    {panels.rightOpen && <div className="explore-side-frame explore-right-frame"><ExplorePane side="right" floating={panels.narrow} onClose={() => panels.toggle('right', false)}><div className="explore-right-scroll" inert={busy || !!problem} aria-busy={busy}><ExploreInspector world={world} graph={mode === 'relationship' ? graph : undefined} timeline={mode === 'timeline'} focusNode={timeline.placed?.focus_object} selection={selection} portraits={portraits} onSelect={select} onFocus={changeFocus} onTime={mode === 'relationship' ? showTime : undefined}/></div></ExplorePane>{!panels.narrow && <ExploreResize side="right" panels={panels}/>}</div>}
    {picking && <ObjectBrowser world={world} types={['entity', 'event']} title="选择探索焦点" onClose={() => setPicking(false)} onPick={object => { changeFocus(`${object.type}:${object.id}`); setPicking(false); }}/>}
    {saving && <Dialog title="保存探索视图" onClose={() => setSaving(false)}><p className="dialog-intro">保存焦点、年份、筛选与画布位置；下次打开重新读取正式记录。</p><label className="field"><span>视图名称</span><input autoFocus maxLength={80} aria-label="视图名称" value={saveName} onChange={e => setSaveName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && saveName.trim()) saveView(); }}/></label><div className="dialog-actions"><Button onClick={() => setSaving(false)}>取消</Button><Button variant="primary" disabled={!saveName.trim()} onClick={saveView}>保存在本机</Button></div></Dialog>}
    {problem && !(mode === 'timeline' ? timeline.placed : graph) && <div className="explore-initial-error"><ErrorNotice>{problem}</ErrorNotice><Button onClick={() => setPicking(true)}>选择其他对象</Button></div>}
  </main>;
}
function Link2Icon() { return <Network size={14}/>; }
