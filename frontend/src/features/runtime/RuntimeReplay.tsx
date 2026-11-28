import { useEffect, useState } from 'react';
import { ArrowRight, Clock3, ExternalLink, MapPin, UserRound } from 'lucide-react';
import { Button, ErrorNotice } from '../../components/ui';
import { displayName, runtimeRequest, type Envelope, type HostSession, type ReplayEvent, type ReplayTimeline } from './api';
import { eventText, eventTitle } from './eventText';
import { ObservationLabels } from './RuntimeRunSettings';

export function RuntimeReplay({ world, line, frame, session, history, onHistory, onActor, onPlace, onInspect, onSource }: {
  world:string;
  line:string;
  frame:Envelope;
  session:HostSession;
  history:number|null;
  onHistory:(seq:number|null)=>void;
  onActor:(id:string)=>void;
  onPlace:(id:string)=>void;
  onInspect:(event:ReplayEvent)=>void;
  onSource:()=>void;
}) {
  const [timeline,setTimeline]=useState<ReplayTimeline>();
  const [selected,setSelected]=useState<number>();
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [page,setPage]=useState(0);
  const [actorFilter,setActorFilter]=useState('');
  const [locationFilter,setLocationFilter]=useState('');
  const [actionFilter,setActionFilter]=useState('');
  const [minTick,setMinTick]=useState('');
  const [maxTick,setMaxTick]=useState('');
  const [query,setQuery]=useState('');
  const pageSize=100;
  const p=frame.projection;
  useEffect(()=>{
    let active=true;
    setBusy(true);setError('');
    const search=new URLSearchParams({offset:String(page*pageSize),limit:String(pageSize)});
    if(actorFilter)search.set('actor_id',actorFilter);
    if(locationFilter)search.set('location_id',locationFilter);
    if(actionFilter)search.set('action_type',actionFilter);
    if(minTick)search.set('min_tick',minTick);
    if(maxTick)search.set('max_tick',maxTick);
    if(query)search.set('query',query);
    runtimeRequest<ReplayTimeline>(session,`/worldlines/${encodeURIComponent(line)}/replay?${search}`)
      .then(value=>{if(active){setTimeline(value);setSelected(history ?? value.current_seq)}})
      .catch(e=>{if(active)setError((e as Error).message);})
      .finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[line,session.viewer_scope,page,actorFilter,locationFilter,actionFilter,minTick,maxTick,query]);
  useEffect(()=>{if(timeline)setSelected(history ?? timeline.current_seq);},[history,timeline]);
  function actorName(id:string|null|undefined){return id?displayName(p,id):'作者／系统';}
  function locationName(id:string|undefined){return id?displayName(p,id):'地点未记录';}
  function select(event:ReplayEvent){
    setSelected(event.seq);
    if(event.location_id)onPlace(event.location_id);
    if(event.seq!=null)onHistory(event.seq);
  }
  function resetFilter(update:(value:string)=>void,value:string){setPage(0);update(value);}
  return <section className="runtime-replay" aria-label={`Simulation History · ${world}`}>
    <header className="runtime-replay-heading">
      <div><span className="eyebrow">SIMULATION HISTORY</span><h2>Replay · 已提交历史</h2><p>只读查看事件序列和历史状态，不推进逻辑时间，不调用模型。</p></div>
      {history!==null&&<Button variant="ghost" onClick={()=>onHistory(null)}>返回实时</Button>}
    </header>
    {error&&<ErrorNotice>{error}</ErrorNotice>}
    {busy&&!timeline&&<p className="runtime-muted">正在读取完整事件序列…</p>}
    {timeline&&<>
      <div className="runtime-replay-summary"><span>当前游标 · 第{frame.projection.seq ?? timeline.current_seq}步</span><span>逻辑时刻 · {frame.projection.sim_time_tick ?? timeline.current_tick ?? '未知'}</span><span>筛选后 {timeline.total} 条 · 全部 {timeline.total_all} 条</span></div>
      <section className="runtime-replay-filters" aria-label="历史筛选"><label>搜索<input aria-label="历史记录搜索" value={query} onChange={event=>resetFilter(setQuery,event.target.value)} placeholder="搜索对白、理由或事件…"/></label><label>角色<select aria-label="历史角色筛选" value={actorFilter} onChange={event=>resetFilter(setActorFilter,event.target.value)}><option value="">全部角色</option>{timeline.facets.actors.map(item=><option key={item.value} value={item.value}>{displayName(p,item.value)} · {item.count}</option>)}</select></label><label>地点<select aria-label="历史地点筛选" value={locationFilter} onChange={event=>resetFilter(setLocationFilter,event.target.value)}><option value="">全部地点</option>{timeline.facets.locations.map(item=><option key={item.value} value={item.value}>{displayName(p,item.value)} · {item.count}</option>)}</select></label><label>事件类型<select aria-label="历史事件类型筛选" value={actionFilter} onChange={event=>resetFilter(setActionFilter,event.target.value)}><option value="">全部事件</option>{timeline.facets.actions.map(item=><option key={item.value} value={item.value}>{item.value} · {item.count}</option>)}</select></label><label>逻辑时刻起<input aria-label="历史逻辑时刻起" type="number" value={minTick} onChange={event=>resetFilter(setMinTick,event.target.value)}/></label><label>逻辑时刻止<input aria-label="历史逻辑时刻止" type="number" value={maxTick} onChange={event=>resetFilter(setMaxTick,event.target.value)}/></label></section>
      <div className="runtime-replay-list">
        {timeline.events.map(event=><article className={`runtime-replay-event ${selected===event.seq?'is-selected':''} ${!event.accepted?'is-blocked':''}`} key={event.event_id}>
          <button className="runtime-replay-event-main" onClick={()=>select(event)}>
            <strong>第{event.seq}步</strong><span><Clock3 size={13}/>逻辑时刻 {event.sim_time_after ?? '未知'}</span><span>{eventTitle(event)}</span>
            <p>{event.ruling || event.action_type === 'advance_idle' ? eventText(frame, event) : event.concealed ? '原话已隐藏' : event.text || eventTitle(event)}</p>
            <ObservationLabels hits={event.observations} />
            <small><UserRound size={12}/>{actorName(event.actor_id)}{event.recipient_ids?.length
              ? ` → ${event.recipient_ids.map(actorName).join('、')}` : ''}<MapPin size={12}/>{locationName(event.location_id)}</small>
          </button>
          <div className="runtime-replay-event-actions">
            <Button variant="ghost" disabled={event.seq==null} onClick={()=>select(event)}>查看当步状态 <ArrowRight size={13}/></Button>
            {event.actor_id&&<Button variant="ghost" onClick={()=>onActor(event.actor_id!)}>查看角色</Button>}
            {event.location_id&&<Button variant="ghost" onClick={()=>onPlace(event.location_id!)}>查看地点</Button>}
            {(event.action_type === 'speak' || event.expression || event.message_kind === 'premise' || event.ruling || event.decision_source) &&
              <Button variant="ghost" onClick={() => { select(event); onInspect(event); }}>回查这条记录</Button>}
            {!p.spoiler_free && <Button variant="ghost" onClick={onSource}><ExternalLink size={13}/>查看来源</Button>}
          </div>
        </article>)}
        {!timeline.events.length&&<p className="runtime-muted">这条世界线还没有可重放的提交记录。</p>}
      </div>
      <nav className="runtime-replay-pagination" aria-label="历史分页"><Button variant="ghost" disabled={page===0||busy} onClick={()=>setPage(value=>Math.max(0,value-1))}>上一页</Button><span>第{page+1}页 · {timeline.events.length} 条</span><Button variant="ghost" disabled={(page+1)*pageSize>=timeline.total||busy} onClick={()=>setPage(value=>value+1)}>下一页</Button></nav>
    </>}
  </section>;
}
