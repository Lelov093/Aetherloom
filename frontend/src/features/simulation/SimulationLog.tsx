import { useLayoutEffect, useState, type RefObject } from 'react';
import { Search, MapPin, MessageCircle, ShieldAlert, Package, Flag, Eye, Clock, ArrowRight, SlidersHorizontal } from 'lucide-react';
import { Portrait } from '../objects/Portrait';
import { filterLog, hasStateChange, logFilters, type LogFilter, type PresentedEvent } from './presentation';
import type { Session } from './api';

export function SimulationLog({ session, events, name, portraits, selected, character, onSelect, scrollRef }: {
  session: Session; events: PresentedEvent[]; name: (id: string) => string; portraits: Record<string, number>;
  selected?: number; character?: string; onSelect: (seq: number) => void; scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const [filter, setFilter] = useState<LogFilter>('all'), [query, setQuery] = useState(''), [actor, setActor] = useState(''), [place, setPlace] = useState('');
  const visible = filterLog(events, filter, query, name, actor, place);
  useLayoutEffect(() => {
    if (selected && !visible.some(p => p.event.seq === selected)) { setFilter('all'); setQuery(''); setActor(''); setPlace(''); }
  }, [selected]);
  return <>
    <div className="monitor-log-tabs" role="group" aria-label="日志类型筛选">{logFilters.map(item => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div>
    <div className="monitor-log-tools"><label className="monitor-log-search"><Search size={14}/><input aria-label="搜索世界日志" placeholder="搜索记录…" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <details className="monitor-log-filters"><summary aria-label="按角色与地点筛选日志" title="角色与地点"><SlidersHorizontal size={16}/></summary><div>
        <label>角色<select aria-label="日志角色" value={actor} onChange={event => setActor(event.target.value)}><option value="">全部角色</option>{Object.keys(session.state.agents).map(id => <option key={id} value={id}>{name(id)}</option>)}</select></label>
        <label>地点<select aria-label="日志地点" value={place} onChange={event => setPlace(event.target.value)}><option value="">全部地点</option>{Object.keys(session.state.places).map(id => <option key={id} value={id}>{name(id)}</option>)}</select></label>
        <button type="button" className="text-link" onClick={() => { setActor(''); setPlace(''); }}>清除角色与地点</button>
      </div></details>
    </div>
    <div className="monitor-log-scroll" ref={scrollRef}>
      {visible.map((p, index) => {
        const group = Math.floor((p.event.seq - 1) / 20), previous = visible[index - 1];
        const Icon = !p.event.accepted ? ShieldAlert : ({ speak: MessageCircle, move: MapPin, transfer: Package, take: Package, goal: Flag, observe: Eye, wait: Clock } as Record<string, typeof Eye>)[p.event.payload.type] || ArrowRight;
        return <div key={p.event.seq}>
          {(!previous || Math.floor((previous.event.seq - 1) / 20) !== group) && <div className="monitor-log-group">第{group * 20 + 1}–{Math.min(group * 20 + 20, session.cursor)}步 <span>演化记录</span></div>}
          <button id={`monitor-log-${p.event.seq}`} type="button" aria-current={selected === p.event.seq ? 'step' : undefined}
            className={`monitor-log-row ${selected === p.event.seq ? 'is-selected' : ''} ${character && p.involved.includes(character) ? 'is-related' : ''} ${!p.event.accepted ? 'is-blocked' : ''}`}
            onClick={() => onSelect(p.event.seq)}>
            <span className="log-sequence">{String(p.event.seq).padStart(2, '0')}</span>
            <span className="log-node">{p.event.payload.type === 'speak' && portraits[p.event.actor_id] ? <Portrait id={p.event.actor_id} name={name(p.event.actor_id)} version={portraits[p.event.actor_id]} size="small"/> : <Icon size={16}/>}</span>
            <span className="log-content"><span className="log-summary">{p.event.accepted && p.event.payload.type === 'speak' ? <><strong>{name(p.event.actor_id)}</strong>：{p.event.payload.speech}</> : p.event.narration}</span>
              <span className="log-tags"><span>{p.kind}</span>{p.event.payload.type !== 'speak' && <span>{name(p.event.actor_id)}</span>}{p.location && <span>{name(p.location)}</span>}{hasStateChange(p) && <span className="log-change-tag">状态变化</span>}</span>
            </span>
          </button>
        </div>;
      })}
      {!visible.length && <p className="monitor-empty">{events.length ? '没有符合筛选条件的记录。' : '起点已保存，尚无演化事件。'}</p>}
    </div>
    <div className="monitor-log-foot">{visible.length}条记录 · 作者观察视角</div>
  </>;
}
