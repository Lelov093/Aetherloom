import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { Viewport, XYPosition } from '@xyflow/react';
import { ArrowLeft, Check, Compass, Crosshair, Eye, Layers, ListChecks, Map as MapIcon, Network, PanelLeft, PanelRight, RotateCcw, Save, Search, SlidersHorizontal, ScrollText, X, CalendarRange } from 'lucide-react';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { EntityMark } from '../../components/EntityMark';
import { mapPath } from '../maps/api';
import { momentLabel, readMoment, storyParams, withMoment, type StoryMoment } from '../periods/api';
import { WorkspaceHeader, useWorkspaceTrail } from '../../components/WorkspaceContext';
import { entityKinds } from '../creation/api';
import { ObjectBrowser } from '../objects/ObjectBrowser';
import { Portrait, usePortraits } from '../objects/Portrait';
import { exploreApi, families, familyNames, type ExploreGraph, type Family, type RelationDirection } from './api';
import { ExploreCanvas } from './ExploreCanvas';
import { ExploreInspector, type InspectorView } from './ExploreInspector';
import { ExplorePane, ExploreResize, useExplorePanels } from './ExplorePanels';
import { groupEdges, type CanvasSelection, type Selection } from './graphModel';
import { readViews, writeViews, type SavedView } from './views';
import { timeLayers, type TimelineRecord, type YearRange } from './api';
import { useTimeline } from './useTimeline';
import { TimelineCanvas } from './TimelineCanvas';
import { YearFilter } from './YearFilter';
import type { TimeViewport } from './timelineModel';
import { TimelineScope } from './TimelineScope';

type DisplayPreferences = Omit<SavedView, 'id' | 'name' | 'focus' | 'mode' | 'range' | 'uncertain'>;
type ExploreReturn = DisplayPreferences & {
  selection?: Selection;
  picks?: CanvasSelection[];
  inspector: InspectorView;
  search: string;
  locate: string;
  viewId: string;
  focusBack: string[];
};
type RelationshipOverview = { world: string; search: string; display: ExploreReturn };
type ExploreOrigin = { relationshipOverview?: RelationshipOverview; relationshipObject?: string };
const clearMoment = { at_year: undefined, at_event: undefined, event_side: undefined };

export function ExploreWorkspace({ world }: { world: string }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [returnView] = useState<ExploreReturn | undefined>(location.state?.exploreReturn);
  const relationshipOverview: RelationshipOverview | undefined = location.state?.relationshipOverview?.world === world
    ? location.state.relationshipOverview : undefined;
  const fromObject = location.state?.relationshipObject === world;
  const origin: ExploreOrigin = { relationshipOverview, relationshipObject: fromObject ? world : undefined };
  const requestedFocus = params.get('focus') || '';
  const recordParam = params.get('record');
  const mode: 'relationship' | 'timeline' | 'map' = params.get('view') === 'timeline' ? 'timeline' : params.get('view') === 'map' ? 'map' : 'relationship';
  const moment = mode !== 'timeline' ? readMoment(params) : undefined;
  const overview = mode === 'relationship' && !requestedFocus;
  const canvasTitle = mode === 'timeline' ? '时间探索' : mode === 'map' ? 'Canon Map' : overview ? '关系总览' : '局部邻域';
  const timelineRelationship = mode === 'timeline' ? params.get('relationship') || '' : '';
  const numberParam = (key: string) => { const text = params.get(key); return text && /^-?\d{1,6}$/.test(text) ? Number(text) : undefined; };
  const range: YearRange = { start: numberParam('year_start'), end: numberParam('year_end') };
  const uncertain = params.get('uncertain') !== 'false';
  const [layers, setTimeLayers] = useState(returnView?.layers ?? timeLayers);
  const [placedOffset, setPlacedOffset] = useState(returnView?.timeOffsets?.placed ?? 0);
  const [unplacedOffset, setUnplacedOffset] = useState(returnView?.timeOffsets?.unplaced ?? 0);
  const [locate, setLocate] = useState(returnView?.locate ?? recordParam ?? '');
  const [cursor, setCursor] = useState(returnView?.cursor);
  const [initialTimeViewport, setInitialTimeViewport] = useState<TimeViewport | undefined>(returnView?.timelineViewport);
  const [initialTimeScroll, setInitialTimeScroll] = useState(returnView?.timelineScroll ?? 0);
  const timeSnapshot = useRef({ viewport: initialTimeViewport, scroll: initialTimeScroll });
  const [graph, setGraph] = useState<ExploreGraph>(), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [graphKey, setGraphKey] = useState('');
  const [hops, setHops] = useState(returnView?.hops ?? 1);
  const [expanded, setExpanded] = useState<string[]>(returnView?.expanded ?? []);
  const [chosenFamilies, setFamilies] = useState<Family[]>(returnView?.families ?? families);
  const [direction, setDirection] = useState<RelationDirection>(returnView?.direction ?? 'any');
  const [relationLabel, setRelationLabel] = useState(returnView?.relationLabel ?? '');
  const [kinds, setKinds] = useState<string[]>(returnView?.kinds ?? []);
  const [limit, setLimit] = useState(returnView?.limit ?? 12);
  const [labels, setLabels] = useState(returnView?.labels ?? true);
  const [showMapConnections, setShowMapConnections] = useState(returnView?.showMapConnections ?? true);
  const connectionsVisible = mode !== 'map' || showMapConnections;
  const [search, setSearch] = useState(returnView?.search ?? '');
  const [selection, setSelection] = useState<Selection | undefined>(() => {
    if (returnView) return returnView.selection;
    if (recordParam) return { type: 'record', key: recordParam };
    if (requestedFocus) return { type: 'node', key: requestedFocus };
  });
  const [picks, setPicks] = useState<CanvasSelection[] | undefined>(returnView?.picks);
  const [inspector, setInspector] = useState<InspectorView>(returnView?.inspector ?? { tab: 'overview' });
  const [picking, setPicking] = useState(false), [eventPicking, setEventPicking] = useState(false), [saving, setSaving] = useState(false), [saveName, setSaveName] = useState('');
  const [mapEvent, setMapEvent] = useState(returnView?.mapEvent);
  const [views, setViews] = useState<SavedView[]>([]), [viewId, setViewId] = useState(returnView?.viewId ?? ''), [notice, setNotice] = useState('');
  const [viewsReady, setViewsReady] = useState(false), [writingView, setWritingView] = useState(false);
  const [restore, setRestore] = useState(0);
  const [restoreSearch, setRestoreSearch] = useState<string>();
  const waitingForView = restoreSearch !== undefined && restoreSearch !== params.toString();
  const [initialPositions, setInitialPositions] = useState<Record<string, XYPosition>>(returnView?.positions ?? {});
  const [initialViewport, setInitialViewport] = useState<Viewport | undefined>(returnView?.viewport);
  const snapshot = useRef({ positions: initialPositions, viewport: initialViewport });
  const [focusBack, setFocusBack] = useState<string[]>(returnView?.focusBack ?? []);
  const panels = useExplorePanels(returnView && 'right'), { portraits } = usePortraits(world);
  const timeline = useTimeline(world, mode === 'timeline', { focus: requestedFocus, relationship: timelineRelationship, range, layers, uncertain, placedOffset, unplacedOffset, locate }, retry);
  const focus = mode === 'timeline' ? timeline.placed?.focus_object : graph?.nodes.find(n => n.key === graph.focus);
  const pair = timeline.placed?.relationship_scope;
  const pairLabel = timelineRelationship && pair?.id === timelineRelationship ? pair.endpoints.map(endpoint => endpoint.label).join(' ↔ ') : '';
  const queryKey = JSON.stringify({
    focus: requestedFocus, hops, expanded, families: chosenFamilies, kinds, limit, range, uncertain,
    projection: mode === 'map' ? 'map' : 'relationship', eventId: mode === 'map' ? mapEvent?.id : undefined,
    scope: overview ? 'world' : 'neighborhood',
    direction: mode === 'relationship' && !overview ? direction : undefined,
    label: mode === 'relationship' ? relationLabel : undefined, moment,
  });
  const busy = waitingForView || (mode === 'timeline' ? timeline.loading : loading || graphKey !== queryKey && !error);
  const problem = mode === 'timeline' ? timeline.error : error;
  const revision = !busy && !problem ? (mode === 'timeline' ? timeline.placed?.revision : graph?.revision) : undefined;
  const graphPicks = mode === 'relationship' ? picks : undefined;
  useWorkspaceTrail([{ label: pairLabel || (!overview && focus?.label) || (mode === 'timeline' ? '世界时间轴' : canvasTitle) }]);
  useEffect(() => {
    if (restoreSearch !== undefined && !waitingForView) setRestoreSearch(undefined);
  }, [restoreSearch, waitingForView]);
  useEffect(() => {
    let active = true;
    readViews(world).then(value => {
      if (active) { setViews(value); setViewsReady(true); }
    }).catch(() => { if (active) setNotice('无法读取本机视图。请重新打开探索后重试。'); });
    return () => { active = false; };
  }, [world]);
  function updateParams(changes: Record<string, string | undefined>, state: ExploreOrigin = origin) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) { if (value === undefined || value === '') next.delete(key); else next.set(key, value); }
    if (next.get('view') !== 'timeline') next.delete('relationship');
    if (next.get('focus') !== params.get('focus') || next.get('view') !== params.get('view')) setPicks(undefined);
    if (next.toString() !== params.toString()) setParams(next, { replace: fromObject, state });
  }
  function changeRange(value: YearRange) { updateParams({ ...clearMoment, year_start: value.start === undefined ? undefined : String(value.start), year_end: value.end === undefined ? undefined : String(value.end) }); setPlacedOffset(0); setUnplacedOffset(0); setLocate(''); setViewId(''); }
  function changeMoment(point?: StoryMoment) {
    updateParams({ ...clearMoment, ...storyParams(point), record: undefined });
    setViewId('');
  }
  function switchMode(value: 'relationship' | 'timeline' | 'map') {
    if (value === mode) return;
    if (value === 'map') {
      const location = focus?.kind === 'location' ? focus.key : undefined;
      setMapEvent(undefined);
      updateParams({ view: 'map', focus: location, record: undefined });
      setSelection(location ? { type: 'node', key: location } : undefined);
    } else {
      updateParams({ view: value === 'relationship' ? undefined : value, ...(value === 'timeline' ? clearMoment : {}),
        ...(timelineRelationship ? { focus: focus?.key } : {}) });
    }
    setViewId('');
  }
  useEffect(() => { setSelection(old => recordParam ? { type: 'record', key: recordParam } : old?.type === 'record' ? requestedFocus ? { type: 'node', key: requestedFocus } : undefined : old); }, [recordParam]);
  useEffect(() => {
    const page = timeline.placed;
    if (mode !== 'timeline' || timeline.loading || !page?.requested_focus || page.requested_focus === page.focus) return;
    setSelection(old => old?.type === 'node' && old.key === page.requested_focus ? { type: 'node', key: page.focus } : old);
    setNotice('原身份已合并，正在展示保留的正式对象。');
  }, [mode, timeline.loading, timeline.placed]);
  useEffect(() => {
    if (mode === 'timeline' || waitingForView) return;
    let active = true;
    setLoading(true); setError('');
    exploreApi.graph(world, JSON.parse(queryKey)).then(value => {
      if (!active) return;
      setGraph(value);
      setGraphKey(queryKey);
      setSelection(old => old && (old.type === 'record' || (old.type === 'node' ? value.nodes.some(n => n.key === old.key) : groupEdges(value).some(g => g.id === old.key))) ? old : value.focus ? { type: 'node', key: value.focus } : undefined);
      if (mode === 'relationship') setPicks(old => {
        if (!old?.length) return old;
        const nodes = new Set(value.nodes.map(node => node.key));
        const groups = new Set(groupEdges(value).map(group => group.id));
        return old.filter(pick => (pick.type === 'node' ? nodes : groups).has(pick.key));
      });
      if (value.requested_focus && value.requested_focus !== value.focus) setNotice('原身份已合并，正在展示保留的正式对象。');
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [world, mode, queryKey, retry, waitingForView]);
  function changeFocus(key: string, remember = true) {
    if (remember && graph?.focus && graph.focus !== key) setFocusBack(old => [...old, graph.focus].slice(-30));
    if (mode === 'map') setMapEvent(undefined);
    const state = overview && key && !busy && graph ? { ...origin, relationshipOverview: captureOverview() } : origin;
    updateParams({ focus: key, record: undefined, relationship: undefined }, state); setExpanded([]); setSearch(''); setViewId(''); setNotice(''); setPlacedOffset(0); setUnplacedOffset(0); setLocate('');
    setSelection(key ? { type: 'node', key } : undefined);
    setInitialPositions({}); setInitialViewport(undefined);
    if (panels.narrow) panels.toggle('left', false);
  }
  function showOverview() {
    if (relationshipOverview) {
      const { search, display } = relationshipOverview;
      const target = new URLSearchParams(search);
      setParams(target, { replace: fromObject });
      applyDisplay(display, target);
      setSelection(display.selection); setPicks(display.picks); setInspector(display.inspector);
      setSearch(display.search); setLocate(display.locate); setViewId(display.viewId); setFocusBack(display.focusBack);
    } else {
      updateParams({ focus: undefined, record: undefined }, {});
      setSelection(undefined); setPicks(undefined); setExpanded([]); setSearch(''); setViewId(''); setFocusBack([]);
      setInitialPositions({}); setInitialViewport(undefined); setRestore(n => n + 1);
    }
    setNotice('');
    if (panels.narrow) panels.toggle('right', false);
  }
  function select(value?: Selection) {
    if (busy || problem) return;
    setSelection(value);
    updateParams({ record: value?.type === 'record' ? value.key : undefined });
    if (value && panels.narrow) panels.toggle('right', true);
  }
  function selectCanvas(value?: CanvasSelection, extend = false) {
    if (mode !== 'relationship' || (!graphPicks && !extend)) {
      select(value);
      return;
    }
    if (busy || problem) return;
    setPicks(previous => {
      if (!value) return [];
      const current = previous ?? (selection && selection.type !== 'record' ? [selection] : []);
      return current.some(pick => samePick(pick, value))
        ? current.filter(pick => !samePick(pick, value))
        : [...current, value];
    });
  }
  function expand(key: string) {
    if (loading || error || graph?.expanded.includes(key)) return;
    if (expanded.length >= 20) { setNotice('已展开 20 个分支，可收起分支或将对象设为新焦点后继续。'); return; }
    setExpanded(old => [...old, key]); setViewId('');
  }
  function applyDisplay(view: DisplayPreferences, target: URLSearchParams) {
    // Route updates can arrive after the display preferences. Apply the camera
    // only once the graph query belongs to the restored route.
    setRestoreSearch(target.toString());
    setMapEvent(view.mapEvent); setHops(view.hops); setExpanded(view.expanded); setFamilies(view.families);
    setKinds(view.kinds); setLimit(view.limit); setLabels(view.labels);
    setDirection(view.direction ?? 'any'); setRelationLabel(view.relationLabel ?? '');
    setShowMapConnections(view.showMapConnections ?? true);
    setTimeLayers(view.layers || timeLayers); setCursor(view.cursor);
    setPlacedOffset(view.timeOffsets?.placed || 0); setUnplacedOffset(view.timeOffsets?.unplaced || 0);
    setInitialTimeViewport(view.timelineViewport); setInitialTimeScroll(view.timelineScroll || 0);
    setInitialPositions(view.positions); setInitialViewport(view.viewport); setRestore(n => n + 1);
  }
  function restoreView(id: string) {
    const view = views.find(v => v.id === id);
    if (!view) { setViewId(''); return; }
    setPicks(undefined);
    if (graph?.focus && graph.focus !== view.focus) setFocusBack(old => [...old, graph.focus]);
    const target = new URLSearchParams({
      ...(view.focus ? { focus: view.focus } : {}),
      ...(view.mode && view.mode !== 'relationship' ? { view: view.mode } : {}),
      ...(view.mode === 'timeline' && view.timelineRelationship ? { relationship: view.timelineRelationship } : {}),
      ...(view.range?.start !== undefined ? { year_start: String(view.range.start) } : {}),
      ...(view.range?.end !== undefined ? { year_end: String(view.range.end) } : {}),
      ...storyParams(view.moment),
      uncertain: String(view.uncertain !== false),
    });
    setParams(target, { replace: fromObject, state: overview && view.focus && (!view.mode || view.mode === 'relationship')
      ? { ...origin, relationshipOverview: captureOverview() } : origin });
    applyDisplay(view, target);
    setLocate(''); setSelection(view.focus ? { type: 'node', key: view.focus } : undefined);
    setViewId(id); setSearch(''); setNotice('已恢复显示偏好；内容按当前正式记录重新读取。');
  }
  function displayPreferences(): DisplayPreferences {
    return {
      hops, expanded, families: chosenFamilies, kinds, limit, labels, layers, cursor, direction, relationLabel, moment,
      mapEvent: mode === 'map' ? mapEvent : undefined,
      showMapConnections: mode === 'map' ? showMapConnections : undefined,
      timelineRelationship: timelineRelationship || undefined,
      timelineViewport: timeSnapshot.current.viewport, timelineScroll: timeSnapshot.current.scroll,
      timeOffsets: { placed: timeline.placed?.offset ?? placedOffset, unplaced: timeline.unplaced?.offset ?? unplacedOffset },
      positions: snapshot.current.positions, viewport: snapshot.current.viewport,
    };
  }
  function captureDisplay(): ExploreReturn {
    return { ...displayPreferences(), selection, picks: graphPicks, inspector, search, locate, viewId, focusBack };
  }
  function captureOverview(): RelationshipOverview {
    return { world, search: location.search, display: captureDisplay() };
  }
  async function followDetailLink(event: MouseEvent<HTMLAnchorElement>, destination: string) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const exploreReturn = captureDisplay();
    // Keep the display state on the originating Explore history entry.
    await navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: { ...origin, exploreReturn } });
    await navigate(destination, { state: { exploreWorld: world, relationshipOverview: overview ? captureOverview() : relationshipOverview } });
  }
  async function saveView() {
    if (!viewsReady || writingView || views.length >= 20 || !saveName.trim()) return;
    const value: SavedView = { ...displayPreferences(), id: crypto.randomUUID(), name: saveName.trim(), focus: focus?.key || '', mode, range, uncertain };
    const next = [...views, value];
    setWritingView(true);
    try { await writeViews(world, next); setViews(next); setViewId(value.id); setSaving(false); setNotice('视图已保存在本机。'); }
    catch { setNotice('无法保存本机视图；当前探索仍可继续。'); }
    finally { setWritingView(false); }
  }
  async function deleteView() {
    if (writingView) return;
    const next = views.filter(view => view.id !== viewId);
    setWritingView(true);
    try { await writeViews(world, next); setViews(next); setViewId(''); setNotice('已删除本机显示视图。'); }
    catch { setNotice('无法删除本机视图。'); }
    finally { setWritingView(false); }
  }
  function reset() {
    setPicks(undefined);
    updateParams({ ...clearMoment, year_start: undefined, year_end: undefined, uncertain: undefined, focus: undefined, record: undefined, relationship: undefined }); setMapEvent(undefined); setPlacedOffset(0); setUnplacedOffset(0); setLocate(''); setTimeLayers(timeLayers); setCursor(undefined); setInitialTimeViewport(undefined); setInitialTimeScroll(0);
    setFamilies(families); setDirection('any'); setRelationLabel(''); setKinds([]); setHops(1); setExpanded([]); setLimit(12); setLabels(true); setSearch(''); setViewId('');
    setShowMapConnections(true);
    setInitialPositions({}); setInitialViewport(undefined); setRestore(n => n + 1); panels.reset(); setNotice('已恢复默认探索视图。');
  }
  function chooseMapEvent(object: { id: string; label: string }) {
    setMapEvent(object); updateParams({ focus: undefined, record: undefined }); setSelection(undefined); setViewId(''); setEventPicking(false);
  }
  function showTime(kind: string, id: string) {
    const edge = graph?.edges.find(e => e.record_type === kind && e.record_id === id);
    const current = focus?.key || requestedFocus;
    const recordFocus = edge && (edge.source === current || edge.target === current) ? current : edge?.source || current;
    const key = kind === 'entity' ? `entity:${id}` : kind === 'event' ? `event:${id}` : recordFocus;
    updateParams({ ...clearMoment, view: 'timeline', focus: key, record: kind === 'entity' ? undefined : `${kind}:${id}`, relationship: kind === 'relationship' ? id : undefined });
    setTimeLayers(timeLayers); setPlacedOffset(0); setUnplacedOffset(0); setLocate(kind === 'entity' ? '' : `${kind}:${id}`);
    setSelection(kind === 'entity' ? { type: 'node', key } : { type: 'record', key: `${kind}:${id}` }); setViewId('');
  }
  function showGraph(record?: TimelineRecord) {
    const current = focus?.key || (timelineRelationship ? '' : requestedFocus);
    const endpoint = record?.objects.find(object => pair?.endpoints.some(member => member.key === object.key && member.active));
    const key = record?.objects.some(object => object.key === current) ? current
      : endpoint?.key || record?.objects[0]?.key || (record?.kind === 'event' ? `event:${record.id}` : current);
    updateParams({ ...clearMoment, view: undefined, focus: key, record: record?.key, ...(cursor !== undefined && !record ? storyParams({ year: cursor }) : {}) });
    setSelection(record ? { type: 'record', key: record.key } : key ? { type: 'node', key } : undefined); setViewId('');
  }
  function showMap(location: string, record: string) {
    setMapEvent(undefined);
    updateParams({ view: 'map', focus: location, record });
    setSelection({ type: 'record', key: record }); setViewId('');
  }
  const objects = graph?.nodes.filter(n => `${n.label} ${n.subtitle} ${entityKinds[n.kind] || n.kind}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) || [];
  const mapLineSummary = showMapConnections ? `${graph?.edges.length ?? 0} 条显式连通` : '连通线已隐藏';
  return <main id="main-content" className={`explore-workspace ${panels.narrow ? 'is-narrow' : ''}`} style={{ '--explore-left': `${panels.leftWidth}px`, '--explore-right': `${panels.rightWidth}px` } as CSSProperties}>
    <WorkspaceHeader><span className="explore-scope-chip">{mode === 'map' ? <MapIcon size={14}/> : mode === 'timeline' ? <CalendarRange size={14}/> : <Network size={14}/>}正式记录</span></WorkspaceHeader>
    {panels.leftOpen && <div className="explore-side-frame explore-left-frame"><ExplorePane side="left" floating={panels.narrow} heading={mode === 'map' ? '地图探索' : canvasTitle} onClose={() => panels.toggle('left', false)}>
      <div className="explore-left-scroll">
        <section className="explore-focus-section"><h3><Crosshair size={14}/>{overview ? '局部邻域' : '焦点'}</h3><button type="button" className="explore-focus-card" onClick={() => setPicking(true)}>
          {pairLabel ? <><Network size={25}/><span><strong title={pairLabel}>{pairLabel}</strong><small>关系两端</small></span></> : focus ? <>{focus.kind === 'character' && portraits[focus.id] ? <Portrait id={focus.id} name={focus.label} version={portraits[focus.id]}/> : focus.type === 'event' ? <span className="entity-mark"><ScrollText size={23}/></span> : <EntityMark kind={focus.kind}/>}<span><strong title={focus.label}>{focus.label}</strong><small>{focus.type === 'event' ? '正式事件' : entityKinds[focus.kind] || focus.kind}</small></span></> : <><Compass size={25}/><span>{mode === 'timeline' ? '世界范围' : mode === 'map' ? '选择地点' : '选择焦点'}<small>从真实对象或事件开始</small></span></>}<Search size={15}/>
        </button>{!overview && !!focusBack.length && <Button variant="ghost" className="explore-back" onClick={() => { const previous = focusBack.at(-1)!; setFocusBack(old => old.slice(0, -1)); changeFocus(previous, false); }}><ArrowLeft size={13}/>上一焦点</Button>}</section>
        <YearFilter range={range} uncertain={uncertain} onChange={changeRange} onUncertain={value => { updateParams({ uncertain: String(value) }); setPlacedOffset(0); setUnplacedOffset(0); setLocate(''); setViewId(''); }}/>
        {mode === 'timeline' ? <TimelineScope placed={timeline.placed} unplaced={timeline.unplaced} layers={layers} onLayers={value => { setTimeLayers(value); setPlacedOffset(0); setUnplacedOffset(0); setLocate(''); setViewId(''); }} onFocus={changeFocus} busy={busy || !!problem}/> : mode === 'map' ? <>
        <section className="explore-left-section"><h3><MapIcon size={14}/>Canon Map</h3><p>显示地点及正式记录中已标记的连通。</p>{mapEvent ? <div className="explore-filter-row"><ScrollText size={14}/><span>事件筛选 · {mapEvent.label}</span><Button variant="ghost" onClick={() => { setMapEvent(undefined); setViewId(''); }}>清除</Button></div> : <Button variant="ghost" onClick={() => setEventPicking(true)}><ScrollText size={14}/>按事件筛选地点</Button>}</section>
        <section className="explore-left-section explore-objects"><h3>可见地点 <small>{graph?.nodes.length || 0}</small><button type="button" className="explore-icon" aria-label="从世界资料选择地点" onClick={() => setPicking(true)}><Search size={14}/></button></h3><label className="explore-search"><Search size={14}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="筛选可见地点…" aria-label="筛选可见地点"/></label>{objects.map(node => <button type="button" className={`explore-object-row ${selection?.type === 'node' && selection.key === node.key ? 'is-selected' : ''}`} key={node.key} onClick={() => select({ type: 'node', key: node.key })} disabled={loading || !!error}><EntityMark kind={node.kind} small/><span><strong title={node.label}>{node.label}</strong><small>地点{node.key === graph?.focus ? ' · 焦点' : ''}</small></span></button>)}{!objects.length && <p className="explore-muted">暂无可见地点。</p>}</section>
        </> : <>
        {!overview && <section className="explore-left-section"><h3><Layers size={14}/>探索范围</h3><div className="explore-hop-switch" aria-label="联系层数">{[1, 2].map(value => <button type="button" key={value} aria-pressed={hops === value} onClick={() => { setHops(value); setExpanded([]); setViewId(''); }}>{value === 1 ? '直接联系' : '两层联系'}</button>)}</div>
          <label className="field explore-direction"><span>相对焦点的方向</span><select value={direction} onChange={e => { setDirection(e.target.value as RelationDirection); setViewId(''); }}>
            <option value="any">全部方向</option><option value="outgoing">从焦点发出</option><option value="incoming">指向焦点</option>
          </select></label>
          {!!expanded.length && <details className="explore-branches"><summary>手动展开的分支 · {expanded.length}</summary>{expanded.map(key => <button type="button" key={key} onClick={() => setExpanded(old => old.filter(k => k !== key))}><span>{graph?.nodes.find(n => n.key === key)?.label || '已隐藏的分支'}</span><X size={12}/></button>)}<Button variant="ghost" onClick={() => setExpanded([])}>收起手动分支</Button></details>}
        </section>}
        <section className="explore-left-section"><h3><Link2Icon/>联系类别 <small>已显示记录</small></h3>{families.map(family => <label key={family} className="explore-filter-row"><input type="checkbox" checked={chosenFamilies.includes(family)} onChange={e => { setFamilies(old => e.target.checked ? [...old, family] : old.filter(f => f !== family)); setViewId(''); }}/><span>{familyNames[family]}</span><small>{graph?.edges.filter(e => e.family === family).length || 0}</small></label>)}
          <form key={relationLabel} className="explore-relation-filter" onSubmit={event => {
            event.preventDefault();
            setRelationLabel(String(new FormData(event.currentTarget).get('label') ?? '').trim()); setViewId('');
          }}>
            <label className="field"><span>正式关系名称</span><input name="label" defaultValue={relationLabel} maxLength={160} placeholder="例如 盟友（精确匹配）"/></label>
            <div className="year-actions"><Button type="submit">筛选关系名称</Button>{relationLabel && <Button type="button" variant="ghost" onClick={() => { setRelationLabel(''); setViewId(''); }}>清除名称</Button>}</div>
          </form>
          <details className="explore-kind-filters"><summary><SlidersHorizontal size={13}/>对象类型{!kinds.length ? ' · 全部' : kinds[0] === '__none__' ? ' · 无' : ` · ${kinds.length}`}</summary>{!overview && <p>焦点始终保留，其他对象按类型筛选。</p>}<Button variant="ghost" onClick={() => setKinds([])}>显示全部类型</Button>{Object.entries({ ...entityKinds, event: '正式事件' }).map(([kind, label]) => <label className="explore-filter-row" key={kind}><input type="checkbox" checked={!kinds.length || kinds.includes(kind)} onChange={e => { const all = Object.keys({ ...entityKinds, event: '' }); setKinds(old => { const current = old.length ? old : all; const next = e.target.checked ? [...new Set([...current.filter(k => k !== '__none__'), kind])] : current.filter(k => k !== kind); return next.length ? next : ['__none__']; }); setViewId(''); }}/><span>{label}</span></label>)}</details>
        </section>
        <section className="explore-left-section explore-objects"><h3>可见对象 <small>{graph?.nodes.length || 0}</small><button type="button" className="explore-icon" aria-label="从世界资料选择焦点" onClick={() => setPicking(true)}><Search size={14}/></button></h3><label className="explore-search"><Search size={14}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="筛选可见对象…" aria-label="筛选可见对象"/></label>
          {objects.map(node => {
            const pick: CanvasSelection = { type: 'node', key: node.key };
            const selected = graphPicks ? graphPicks.some(item => samePick(item, pick)) : samePick(selection, pick);
            return <button type="button" className={`explore-object-row ${selected ? 'is-selected' : ''}`} key={node.key}
              aria-pressed={graphPicks ? selected : undefined} onClick={() => selectCanvas(pick)} disabled={busy || !!problem}>
              {node.type === 'event' ? <ScrollText size={17}/> : <EntityMark kind={node.kind} small/>}
              <span><strong title={node.label}>{node.label}</strong><small>{node.type === 'event' ? '正式事件' : entityKinds[node.kind] || node.kind}{node.key === graph?.focus ? ' · 焦点' : ''}</small></span>
            </button>;
          })}{!objects.length && <p className="explore-muted">{search ? '没有匹配的可见对象。' : '当前范围没有可见对象。'}</p>}
        </section>
        </>}
      </div>
    </ExplorePane>{!panels.narrow && <ExploreResize side="left" panels={panels}/>}</div>}
    <section className="explore-center" aria-label={mode === 'timeline' ? '世界时间画布' : mode === 'map' ? 'Canon 地图画布' : '世界关系画布'}>
      <header className="explore-canvas-heading"><div>{mode === 'timeline' ? <CalendarRange size={19} strokeWidth={1.5}/> : mode === 'map' ? <MapIcon size={19} strokeWidth={1.5}/> : <Compass size={19} strokeWidth={1.5}/>}<span><h1>{canvasTitle}</h1><small>
        {revision !== undefined && <span title="当前 Working Canon">Canon R{revision} · </span>}
        {mode === 'timeline' ? timeline.placed ? `${timeline.placed.total} 条可定位记录 · ${timeline.unplaced?.total || 0} 条时间未定` : '沿着时间，读懂世界中的变化' : mode === 'map' ? graph ? `${graph.nodes.length} 个可见地点 · ${mapLineSummary}` : '地点与显式连通的只读投影' : graph ? `${graph.nodes.length} 个可见对象 · ${graph.edges.length} 条正式记录` : '人物、地点与事件，在这里连成世界'}
      </small></span></div><div className="explore-toolbar">
        <button className="explore-icon" type="button" aria-label="显示探索栏" aria-pressed={panels.leftOpen} title="探索范围" onClick={() => panels.toggle('left', !panels.leftOpen)}><PanelLeft size={17}/></button>
        {mode === 'relationship' && <button className="explore-icon" type="button" aria-label="多选" aria-pressed={!!graphPicks} title="多选对象和联系"
          disabled={busy || !!problem || !graph?.nodes.length} onClick={() => setPicks(current => current ? undefined : [])}><ListChecks size={17}/></button>}
        {mode === 'map' && <button className="explore-icon explore-layer-toggle" type="button" aria-pressed={showMapConnections} title="切换地图连通线"
          onClick={() => { setShowMapConnections(visible => !visible); setViewId(''); }}><Layers size={15}/>连通线</button>}
        {mode !== 'timeline' && <button className="explore-icon" type="button" aria-label="显示关系标签" aria-pressed={labels} title="关系标签" disabled={!connectionsVisible} onClick={() => { setLabels(v => !v); setViewId(''); }}><Eye size={17}/></button>}
        <button className="explore-icon" type="button" aria-label="显示探索详情" aria-pressed={panels.rightOpen} title="对象与联系" onClick={() => panels.toggle('right', !panels.rightOpen)}><PanelRight size={17}/></button>
        <button className="explore-icon" type="button" aria-label="重新读取正式记录" title="刷新正式记录" onClick={() => setRetry(n => n + 1)}><RotateCcw size={16}/></button>
        <Button variant="primary" className="explore-save" aria-label="保存视图" title="保存视图" disabled={busy || !!problem || !viewsReady || writingView || views.length >= 20} onClick={() => { setSaveName(`${focus?.label || '世界'}的${mode === 'timeline' ? '时间轴' : mode === 'map' ? '地图' : '联系'}`); setSaving(true); }}><Save size={15}/><span>保存视图</span></Button>
      </div></header>
      <div className="explore-view-bar"><label><span>本机视图</span><select aria-label="恢复本机探索视图" disabled={!viewsReady || writingView} value={viewId} onChange={e => restoreView(e.target.value)}><option value="">当前探索</option>{views.map(view => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label><Button variant="ghost" onClick={reset}>恢复默认</Button>{viewId && <Button variant="ghost" disabled={writingView} onClick={deleteView}>删除视图</Button>}
        {mode === 'relationship' && !overview && <>
          <Button variant="ghost" onClick={showOverview}><ArrowLeft size={14}/>返回关系总览</Button>
          {fromObject && <Button variant="ghost" onClick={() => navigate(-1)}>返回对象</Button>}
        </>}
      </div>
      <div className="explore-mode-bar"><div className="explore-mode-switch" role="group" aria-label="探索视图"><button type="button" aria-pressed={mode === 'relationship'} onClick={() => switchMode('relationship')}><Network size={14}/>关系</button><button type="button" aria-pressed={mode === 'timeline'} onClick={() => switchMode('timeline')}><CalendarRange size={14}/>时间</button><button type="button" aria-pressed={mode === 'map'} onClick={() => switchMode('map')}><MapIcon size={14}/>地点连通</button></div><Link className="text-link" to={withMoment(mapPath(world),moment)}>作者地图</Link><span>{moment ? momentLabel(moment) : range.start === undefined && range.end === undefined ? '全部年份' : `${range.start ?? '不限'}—${range.end ?? '不限'} 年`}</span>
        {moment && 'event' in moment && <Button variant="ghost" onClick={() => changeMoment({ ...moment, side: moment.side === 'before' ? 'after' : 'before' })}>{moment.side === 'before' ? '切到事件后' : '切到事件前'}</Button>}
        {moment && <Button variant="ghost" onClick={() => changeMoment()}>跨时期总览</Button>}
        {pairLabel ? <span className="timeline-pair-label" title={pairLabel}>关系两端 · {pairLabel}</span>
          : <small>{mode === 'map' ? 'Canon Map · 地点与显式连通' : '年份相关记录 · 非完整世界快照'}</small>}
      </div>
      <div className="explore-surface" hidden={mode === 'timeline'}><ExploreCanvas view={mode === 'map' ? 'map' : overview ? 'overview' : 'relationship'} graph={graph} loading={mode === 'timeline' || busy || !!problem} labels={labels} connectionsVisible={connectionsVisible} selection={selection} picks={graphPicks} portraits={portraits} positions={initialPositions} viewport={initialViewport} restore={restore}
        onSelect={selectCanvas} onFocus={changeFocus} onExpand={expand} onSnapshot={(positions, viewport) => { snapshot.current = { positions, viewport }; }}/>
      </div><div className="explore-surface" hidden={mode !== 'timeline'}><TimelineCanvas placed={timeline.placed} unplaced={timeline.unplaced} loading={busy || !!problem} range={range} selected={selection?.type === 'record' ? selection.key : undefined} cursor={cursor} onCursor={year => { setCursor(year); select(undefined); }} onSelect={record => { setCursor(undefined); select({ type: 'record', key: record.key }); }} onGraph={showGraph} onMap={showMap} onPage={(section, offset) => { setLocate(''); if (section === 'placed') setPlacedOffset(offset); else setUnplacedOffset(offset); }} context={JSON.stringify({ focus: requestedFocus, relationship: timelineRelationship, range, layers, uncertain })} restore={restore} initialViewport={initialTimeViewport} initialScroll={initialTimeScroll} onSnapshot={(viewport, scroll) => { timeSnapshot.current = { viewport, scroll }; }}/></div>
      <div className="explore-canvas-status" role="status">{busy ? <><span className="explore-status-dot"/>正在读取正式记录，画布保持原位…</> : problem ? <><span>{problem}</span><Button onClick={() => setRetry(n => n + 1)}>重试</Button><Button onClick={() => setPicking(true)}>另选焦点</Button></> : mode === 'timeline' ? <span>年份边界与修改历史分开 · 未定时间不推测</span> : mode === 'map' ? <span>Canon Map 只读 · 地图路径不自动赋予通行权</span> : graphPicks ? <span>已选 {graphPicks.length} 项 · 点击对象或联系选入或移除</span> : graph?.remaining_links ? <><span>此范围还有 {graph.remaining_links} 条记录未显示。</span>{limit < 120 && <Button onClick={() => { setLimit(old => Math.min(120, old + 12)); setViewId(''); }}>扩大可见范围</Button>}<Button onClick={() => setPicking(true)}>更换焦点</Button></> : <span>{graph?.nodes.length ? (overview ? '点击对象查看资料或进入局部邻域' : '单击查看 · 节点旁展开联系') : <Link to={`/worlds/${world}/create/objects`}>打开世界对象，开始整理资料 →</Link>}</span>}{notice && <span className="explore-view-notice"><Check size={12}/>{notice}</span>}</div>
    </section>
    {panels.rightOpen && <div className="explore-side-frame explore-right-frame"><ExplorePane side="right" floating={panels.narrow} onClose={() => panels.toggle('right', false)}><div className="explore-right-scroll" inert={busy || !!problem} aria-busy={busy}>
      {graph && !!graphPicks?.length && <PickedItems graph={graph} picks={graphPicks} selection={selection}
        onInspect={select} onRemove={pick => setPicks(old => old?.filter(item => !samePick(item, pick)))}
        onClear={() => setPicks([])}/>}
      <ExploreInspector world={world} graph={mode !== 'timeline' ? graph : undefined} timeline={mode === 'timeline'}
        focusNode={timeline.placed?.focus_object} selection={selection} portraits={portraits} connectionsVisible={connectionsVisible} overview={overview}
        onSelect={select} onFocus={changeFocus} onReference={key => {
          if (mode === 'map' || key.startsWith('event:')) select({ type: 'record', key });
          else changeFocus(key);
        }}
        onTime={mode !== 'timeline' ? showTime : undefined} onMap={mode === 'relationship' ? showMap : undefined}
        view={inspector} onViewChange={setInspector} onFollowLink={followDetailLink} moment={moment}/>
    </div></ExplorePane>{!panels.narrow && <ExploreResize side="right" panels={panels}/>}</div>}
    {picking && <ObjectBrowser world={world} types={mode === 'map' ? ['entity'] : ['entity', 'event']} entityKind={mode === 'map' ? 'location' : undefined} title={mode === 'map' ? '选择地图地点' : '选择探索焦点'} onClose={() => setPicking(false)} onPick={object => { changeFocus(`${object.type}:${object.id}`); setPicking(false); }}/>} 
    {eventPicking && <ObjectBrowser world={world} types={['event']} title="选择地图事件" onClose={() => setEventPicking(false)} onPick={object => chooseMapEvent({ id: object.id, label: object.label })}/>} 
    {saving && <Dialog title="保存探索视图" busy={writingView} onClose={() => setSaving(false)}><p className="dialog-intro">保存焦点、年份、筛选、图层和画布位置。下次打开时重新读取正式记录。</p><label className="field"><span>视图名称</span><input autoFocus maxLength={80} aria-label="视图名称" value={saveName} onChange={e => setSaveName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && saveName.trim()) saveView(); }}/></label><div className="dialog-actions"><Button disabled={writingView} onClick={() => setSaving(false)}>取消</Button><Button variant="primary" disabled={writingView || !saveName.trim()} onClick={saveView}>保存在本机</Button></div></Dialog>}
    {problem && !(mode === 'timeline' ? timeline.placed : graph) && <div className="explore-initial-error"><ErrorNotice>{problem}</ErrorNotice><Button onClick={() => setPicking(true)}>选择其他对象</Button></div>}
  </main>;
}

function samePick(a: Selection | undefined, b: CanvasSelection) {
  return a?.type === b.type && a.key === b.key;
}

function PickedItems({ graph, picks, selection, onInspect, onRemove, onClear }: {
  graph: ExploreGraph; picks: CanvasSelection[]; selection?: Selection;
  onInspect: (pick: CanvasSelection) => void; onRemove: (pick: CanvasSelection) => void; onClear: () => void;
}) {
  const nodes = new Map(graph.nodes.map(node => [node.key, node]));
  const edges = new Map(groupEdges(graph).map(edge => [edge.id, edge]));
  return <section className="explore-detail-section explore-picks" aria-label="当前多选">
    <div className="explore-picks-heading"><h3>已选 {picks.length} 项</h3><Button variant="ghost" onClick={onClear}>清空选择</Button></div>
    <div className="explore-picks-list">{picks.map(pick => {
      const node = pick.type === 'node' ? nodes.get(pick.key) : undefined;
      const edge = pick.type === 'edge' ? edges.get(pick.key) : undefined;
      const label = node?.label ?? edge?.records[0].label;
      if (!label) return null;
      const subtitle = edge ? `${nodes.get(edge.source)?.label} → ${nodes.get(edge.target)?.label}`
        : node?.type === 'event' ? '正式事件' : entityKinds[node!.kind] || node!.kind;
      return <div className="explore-picked-row" key={`${pick.type}:${pick.key}`}>
        <button type="button" className="explore-contact-row" aria-pressed={samePick(selection, pick)} onClick={() => onInspect(pick)}>
          <span>{label}<small>{subtitle}</small></span>
        </button>
        <button type="button" className="explore-icon" aria-label={`移除${label}`} onClick={() => onRemove(pick)}><X size={14}/></button>
      </div>;
    })}</div>
  </section>;
}

function Link2Icon() { return <Network size={14}/>; }
