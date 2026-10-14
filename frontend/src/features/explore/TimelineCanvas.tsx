import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ArrowLeft, ArrowRight, CalendarRange, Crosshair, Maximize2, Minus, Network, Plus, ScrollText, Link2, BookOpen } from 'lucide-react';
import { Button } from '../../components/ui';
import { period, timeLayerNames, type TimelinePage, type TimelineRecord, type YearRange } from './api';
import { fitYears, ticks, timeLanes, validTimeViewport, zoomYears, type TimeViewport } from './timelineModel';

export function TimelineCanvas({ placed, unplaced, loading, range, selected, cursor, onCursor, onSelect, onGraph, onPage, context, restore, initialViewport, initialScroll, onSnapshot }: {
  placed?: TimelinePage; unplaced?: TimelinePage; loading: boolean; range: YearRange; selected?: string; cursor?: number;
  onCursor: (year: number) => void; onSelect: (record: TimelineRecord) => void; onGraph: (record?: TimelineRecord) => void;
  onPage: (section: 'placed' | 'unplaced', offset: number) => void; context: string; restore: number; initialViewport?: TimeViewport; initialScroll?: number;
  onSnapshot: (viewport: TimeViewport, scroll: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null), scroll = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(680), [view, setView] = useState<TimeViewport>({ start: 0, end: 1 });
  const applied = useRef(''), lastRestore = useRef(-1), lastSelection = useRef('');
  const drag = useRef<{ x: number; view: TimeViewport } | undefined>(undefined);
  const snap = useRef(onSnapshot); snap.current = onSnapshot;
  const viewRef = useRef(view); viewRef.current = view;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(120, entry.contentRect.width - (el.querySelector('.timeline-ruler-label')?.getBoundingClientRect().width || 144))));
    observer.observe(el); return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (loading || !placed) return;
    if (applied.current !== context || lastRestore.current !== restore) {
      const restoring = lastRestore.current !== restore;
      setView(restoring && validTimeViewport(initialViewport) ? initialViewport : fitYears(placed.bounds, range));
      applied.current = context; lastRestore.current = restore;
      requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = restoring ? initialScroll || 0 : 0; });
    }
  }, [placed, loading, context, restore, initialViewport]);
  const lanes = useMemo(() => timeLanes(placed?.items || [], view, width), [placed, view, width]);
  const hasYears = !!placed && (placed.bounds.start !== null || placed.bounds.end !== null || range.start !== undefined || range.end !== undefined);
  const yearTicks = hasYears ? ticks(view, width) : [];
  const currentRecord = [...(placed?.items || []), ...(unplaced?.items || [])].find(r => r.key === selected);
  useEffect(() => {
    if (loading || !selected || lastSelection.current === selected) return;
    lastSelection.current = selected;
    const item = placed?.items.find(r => r.key === selected);
    const anchor = item?.time.start ?? item?.time.end;
    if (anchor !== undefined && anchor !== null) setView(current => {
      // Read the pending fitted/restored camera, not an earlier render's camera.
      // A visible crossing period also remains in place when selected.
      const interval = item?.time.certainty === 'dated' && !(item.kind === 'event' && item.time.start === item.time.end);
      const point = anchor + (item?.kind === 'event' && item.time.certainty === 'dated' && !interval ? .5 : 0);
      const visible = interval ? item!.time.end! + 1 >= current.start && point <= current.end : point >= current.start && point < current.end;
      if (visible) return current;
      const span = Math.max(3, current.end - current.start);
      return { start: point - span / 2, end: point + span / 2 };
    });
    requestAnimationFrame(() => {
      const element = scroll.current?.querySelector<HTMLElement>(`[data-time-key="${selected}"]`);
      if (element && scroll.current) {
        const itemBox = element.getBoundingClientRect(), paneBox = scroll.current.getBoundingClientRect();
        if (itemBox.top < paneBox.top + 52 || itemBox.bottom > paneBox.bottom)
          scroll.current.scrollTop += itemBox.top - paneBox.top - 76;
      }
    });
  }, [selected, placed, loading]);
  useEffect(() => { snap.current(view, scroll.current?.scrollTop || 0); }, [view]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (loading || (!event.ctrlKey && !event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY))) return;
      event.preventDefault();
      if (event.ctrlKey) setView(v => zoomYears(v, event.deltaY > 0 ? 1.15 : 1 / 1.15));
      else setView(v => { const shift = (event.deltaX || event.deltaY) / width * (v.end - v.start); return { start: v.start + shift, end: v.end + shift }; });
    };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, [loading, width]);
  function pan(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const shift = (event.clientX - drag.current.x) / width * (drag.current.view.end - drag.current.view.start);
    setView({ start: drag.current.view.start - shift, end: drag.current.view.end - shift });
  }
  const x = (year: number) => (year - view.start) / (view.end - view.start) * width;
  const move = (factor: number) => setView(v => { const amount = (v.end - v.start) * factor; return { start: v.start + amount, end: v.end + amount }; });
  const icons = { event: ScrollText, relationship: Link2, assertion: BookOpen };
  return <div ref={host} className="timeline-surface" aria-busy={loading}>
    <div className="timeline-tools"><span><CalendarRange size={15}/>年份尺度 <small>期间按整年显示</small></span><div>
      <button className="explore-icon" aria-label="时间轴向前平移" disabled={loading || !hasYears} onClick={() => move(-.3)}><ArrowLeft size={15}/></button>
      <button className="explore-icon" aria-label="时间轴向后平移" disabled={loading || !hasYears} onClick={() => move(.3)}><ArrowRight size={15}/></button>
      <button className="explore-icon" aria-label="放大时间轴" disabled={loading || !hasYears} onClick={() => setView(v => zoomYears(v, .65))}><Plus size={16}/></button>
      <button className="explore-icon" aria-label="缩小时间轴" disabled={loading || !hasYears} onClick={() => setView(v => zoomYears(v, 1.5))}><Minus size={16}/></button>
      <button className="explore-icon" aria-label="适配时间范围" disabled={loading || !hasYears} onClick={() => placed && setView(fitYears(placed.bounds, range))}><Maximize2 size={15}/></button>
    </div></div>
    <div ref={scroll} className="timeline-scroll" onScroll={() => snap.current(viewRef.current, scroll.current?.scrollTop || 0)}>
      <div className="timeline-ruler"><div className="timeline-ruler-label">故事年份</div><div className="timeline-ruler-track">{!hasYears && <span className="timeline-ruler-empty">暂无明确年份</span>}{yearTicks.map(year => <button key={year} disabled={loading} className={year === cursor ? 'is-selected' : ''} style={{ left: x(year) }} aria-label={`选择 ${year} 年`} onClick={() => onCursor(year)}>{year}<i/></button>)}</div></div>
      <div className="timeline-lanes" aria-label="正式记录时间轴" tabIndex={0} onKeyDown={e => {
        if (loading || e.target !== e.currentTarget) return;
        if (['ArrowLeft', 'ArrowRight', '+', '-', 'Home'].includes(e.key)) { e.preventDefault(); if (e.key === 'Home' && placed) setView(fitYears(placed.bounds, range)); else if (e.key === '+' || e.key === '-') setView(v => zoomYears(v, e.key === '+' ? .65 : 1.5)); else move(e.key === 'ArrowLeft' ? -.2 : .2); }
      }} onPointerDown={e => { if (loading || e.button !== 0 || (e.target as HTMLElement).closest('button')) return; drag.current = { x: e.clientX, view }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={pan} onPointerUp={() => { drag.current = undefined; }} onLostPointerCapture={() => { drag.current = undefined; }}>
        {lanes.map(lane => { const Icon = icons[lane.kind]; return <div key={lane.key} className={`timeline-lane layer-${lane.kind}`} style={{ height: lane.height }}>
          <div className="timeline-lane-label"><Icon size={15}/><span title={lane.label}>{lane.label}<small>{timeLayerNames[lane.kind]}</small></span></div>
          <div className="timeline-lane-track">{yearTicks.map(year => <i className="timeline-grid" key={year} style={{ left: x(year) }}/>) }{cursor !== undefined && x(cursor) >= 0 && x(cursor) <= width && <i className="timeline-cursor" style={{ left: x(cursor) }}/>} {lane.placements.map(p => <button type="button" key={p.record.key} data-time-key={p.record.key} disabled={loading} className={`timeline-item ${p.interval ? 'is-interval' : p.record.time.certainty === 'dated' ? 'is-year-event' : 'is-boundary'} ${p.clipped ? 'is-clipped' : ''} ${p.record.key === selected ? 'is-selected' : ''}`} style={{ left: p.left, top: 17 + p.track * 59, width: p.width }} aria-pressed={p.record.key === selected} aria-label={`${p.record.label}，${period(p.record)}${p.record.time.certainty === 'partial' ? '，仅已知单侧边界' : ''}`} title={`${p.record.label}${p.record.value ? ' · ' + p.record.value : ''}\n${period(p.record)}`} onPointerDown={e => e.stopPropagation()} onClick={() => onSelect(p.record)} onKeyDown={e => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); onSelect(p.record); } }}>
            <span className="timeline-item-bar"><i/></span><span className="timeline-item-label"><strong>{p.record.label}{p.record.value && <em> · {p.record.value}</em>}</strong><small>{p.interval ? `${p.record.time.start}—${p.record.time.end}` : p.record.time.certainty === 'dated' ? `${p.record.time.start} 年 · 年内时刻未细分` : p.record.time.start !== null ? `${p.record.time.start} 起始 · 结束未定` : `${p.record.time.end} 结束 · 起始未定`}</small></span>
          </button>)}</div>
        </div>; })}
        {!lanes.length && <div className="timeline-empty"><CalendarRange size={30} strokeWidth={1.3}/><h2>{placed?.counts.undated || placed?.counts.invalid ? '这些记录的时间还未确定' : '此范围暂无可定位记录'}</h2><p>明确年份会出现在时间轴上。未定时间仍可在下方查阅。</p></div>}
      </div>
      {!!placed?.total && <PageControls page={placed} size={120} loading={loading} section="placed" onPage={onPage}/>}
      {!!unplaced?.total && <section className="timeline-unplaced"><header><h3>时间未定 <small>{unplaced.total} 条</small></h3><p>保留原始描述，不根据章节顺序或修改时间定位。</p></header>{unplaced.items.map(record => <button type="button" key={record.key} className={`timeline-unplaced-row ${selected === record.key ? 'is-selected' : ''}`} aria-pressed={selected === record.key} disabled={loading} onClick={() => onSelect(record)}><span><strong>{record.label}</strong><small>{record.lane_label} · {timeLayerNames[record.kind]}</small></span><span>{period(record)}{record.time.certainty === 'invalid' && <small className="year-error">起止年份倒置，需核对</small>}</span></button>)}<PageControls page={unplaced} size={40} loading={loading} section="unplaced" onPage={onPage}/></section>}
    </div>
    <div className="timeline-selection"><span>{currentRecord ? <><Crosshair size={13}/>{currentRecord.label}</> : selected ? '所选记录不在此页或当前筛选范围，详情仍可查阅。' : cursor !== undefined ? <><CalendarRange size={13}/>{cursor} 年</> : '单击记录查看详情 · 拖动空白平移 · 选择刻度定位年份'}</span>{(currentRecord || cursor !== undefined) && <Button variant="ghost" disabled={loading} onClick={() => onGraph(currentRecord)}><Network size={13}/>查看相关关系</Button>}</div>
  </div>;
}
function PageControls({ page, size, loading, section, onPage }: { page: TimelinePage; size: number; loading: boolean; section: 'placed' | 'unplaced'; onPage: (section: 'placed' | 'unplaced', offset: number) => void }) {
  return <div className="timeline-pages"><span>{page.offset + 1}—{page.offset + page.items.length} / {page.total} 条</span><Button variant="ghost" disabled={loading || page.offset === 0} onClick={() => onPage(section, Math.max(0, page.offset - size))}>上一页</Button><Button variant="ghost" disabled={loading || !page.remaining} onClick={() => onPage(section, page.offset + size)}>下一页</Button></div>;
}
