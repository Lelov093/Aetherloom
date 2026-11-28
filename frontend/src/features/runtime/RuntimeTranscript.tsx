import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, Flag, Footprints, Shield, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui';
import { Portrait, usePortraits } from '../objects/Portrait';
import { displayName, runtimeRequest, type Envelope, type HostSession, type ReplayTimeline, type RuntimeEvent } from './api';
import { eventText, eventTitle } from './eventText';
import { ObservationLabels } from './RuntimeRunSettings';
import { executionText } from './SocialInspector';

function privatePair(event: RuntimeEvent) {
  const recipient = event.recipient_ids?.[0];
  return event.message_kind === 'private' && event.actor_id && recipient ? [event.actor_id, recipient].sort() : undefined;
}

function matches(events: RuntimeEvent[], filter: string) {
  const [kind, ...parts] = filter.split(':');
  const id = parts.join(':');
  if (kind === 'place') return events.filter(event => event.location_id === id);
  if (kind === 'private') return events.filter(event => privatePair(event)?.join(':') === id);
  if (kind === 'actor') return events.flatMap(event => {
    if (!event.perceived_by?.includes(id)) return [];
    const witness = event.witnesses?.[id];
    return [witness ? { event_id: event.event_id, seq: event.seq, action_type: 'event_observation', accepted: true,
      reason_code: null, ...witness, actor_id: witness.actor_id ?? null } : event];
  });
  return events;
}

interface HeldReading { events: RuntimeEvent[]; at: number | null; seen: Set<string> }

export function RuntimeTranscript({ frame, session, title, selected, filter, onFilter, onSelect, onSpoiler }: {
  frame: Envelope; session: HostSession; title: string; selected?: string; filter: string;
  onFilter: (filter: string) => void;
  onSelect: (event: RuntimeEvent) => void; onSpoiler: () => void;
}) {
  const p = frame.projection;
  const creator = p.role === 'creator_observer';
  const { portraits } = usePortraits(p.world_id);
  const [held, setHeld] = useState<HeldReading>();
  const [loading, setLoading] = useState(false);
  const [olderError, setOlderError] = useState('');
  const feed = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ id: string; offset: number }>(undefined);
  const previousFilter = useRef(filter);
  const events = held?.events ?? frame.events;
  const visible = matches(events, filter);
  const hasNew = Boolean(held && matches(frame.events, filter).some(event =>
    event.seq != null ? event.seq > (held.at ?? 0) : !held.seen.has(event.event_id)));
  const pairs = new Map([...events, ...frame.events].flatMap(event => {
    const pair = privatePair(event);
    return pair ? [[pair.join(':'), pair] as const] : [];
  }));
  const name = (id?: string | null) => displayName(p, id);
  const first = events[0]?.seq ?? 0;

  useLayoutEffect(() => {
    const element = feed.current;
    if (!element) return;
    if (previousFilter.current !== filter) {
      element.scrollTop = element.scrollHeight;
      previousFilter.current = filter;
    } else if (anchor.current) {
      const { id, offset } = anchor.current;
      const row = document.getElementById(`experience-event-${id}`);
      if (row) element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - offset;
      anchor.current = undefined;
    } else if (!held) element.scrollTop = element.scrollHeight;
  }, [held, frame.events, filter]);

  function hold() {
    return held ?? { events: frame.events, at: p.seq, seen: new Set(frame.events.map(event => event.event_id)) };
  }

  async function earlier() {
    const element = feed.current;
    if (!element || loading || first < 2) return;
    setLoading(true);
    setOlderError('');
    const current = hold();
    setHeld(current);
    try {
      const data = await runtimeRequest<ReplayTimeline>(session,
        `/worldlines/${encodeURIComponent(p.worldline_id)}/replay?before_seq=${first}&limit=50`);
      const top = element.getBoundingClientRect().top;
      const row = [...element.querySelectorAll<HTMLElement>('article[data-event-id]')]
        .find(item => item.getBoundingClientRect().bottom > top);
      if (row?.dataset.eventId) anchor.current = { id: row.dataset.eventId, offset: row.getBoundingClientRect().top - top };
      setHeld({ ...current, events: [...data.events, ...current.events] });
    } catch {
      setOlderError('暂时无法读取更早的消息。');
    } finally { setLoading(false); }
  }

  return <>
    <div className="runtime-transcript-bar">
      {creator && <label>
        <span className="sr-only">消息范围</span>
        <select aria-label="消息范围" value={filter} disabled={loading} onChange={event => onFilter(event.target.value)}>
          <option value="all">全局消息</option>
          <optgroup label="地点">{Object.keys(p.scene?.places ?? p.world.place_topology).map(id =>
            <option key={id} value={`place:${id}`}>地点 · {name(id)}</option>)}</optgroup>
          <optgroup label="跟随角色">{Object.keys(p.agents).map(id =>
            <option key={id} value={`actor:${id}`}>跟随 · {name(id)}</option>)}</optgroup>
          {pairs.size > 0 && <optgroup label="私聊会话">{[...pairs].map(([id, pair]) =>
            <option key={id} value={`private:${id}`}>私聊 · {pair.map(name).join(' ↔ ')}</option>)}</optgroup>}
        </select>
      </label>}
      {creator && <Button type="button" variant="ghost" aria-pressed={Boolean(p.spoiler_free)} onClick={onSpoiler}>
        <ShieldCheck size={16} />防泄底
      </Button>}
    </div>
    <div className="scene-feed runtime-transcript" ref={feed} tabIndex={0} aria-label="对话与演化记录" onScroll={event => {
      const element = event.currentTarget;
      if (!held && element.scrollHeight - element.scrollTop - element.clientHeight > 54) setHeld(hold());
    }}>
      <div className="scene-start"><span>冻结起点 · {title}</span></div>
      {creator && first > 1 && <div className="transcript-earlier">
        <Button variant="ghost" disabled={loading} onClick={() => void earlier()}>{loading ? '正在读取…' : '加载更早的记录'}</Button>
        {olderError && <p role="alert">{olderError}</p>}
      </div>}
      {!visible.length && <p className="monitor-empty">{filter === 'all' ? '尚无已提交的消息或行动。' : '这里还没有匹配的记录。'}</p>}
      {visible.map(event => <article id={`experience-event-${event.event_id}`} data-event-id={event.event_id}
        key={event.event_id} className={`academy-event ${event.message_kind ? 'has-message' : ''} ${!event.accepted ? 'is-blocked' : ''}
          ${selected === event.event_id ? 'is-selected' : ''}`} onClick={() => onSelect(event)}>
        <div>{!event.accepted ? <Shield size={19}/> : event.actor_id && event.message_kind
          ? <Portrait id={event.actor_id} name={name(event.actor_id)} version={portraits[event.actor_id]} size="small"/>
          : event.action_type === 'move' ? <Footprints size={19}/> : <Flag size={19}/>}</div>
        <div>
          <header><strong>{event.actor_id ? name(event.actor_id) : '场景'}</strong>
            {event.recipient_ids?.length ? <span className="transcript-recipient">→ {event.recipient_ids.map(name).join('、')}</span> : null}
            <small>{eventTitle(event)}{event.decision_source && ' · 角色自主'}{event.location_id && ` · ${name(event.location_id)}`}{event.seq != null && ` · 第${event.seq}步`}</small>
          </header>
          <p>{eventText(frame, event)}</p>
          <ObservationLabels hits={event.observations} />
          {(event.message_kind || event.ruling || event.decision_source) && <button type="button" className="text-link transcript-source" onClick={click => {
            click.stopPropagation(); onSelect(event);
          }}>{event.ruling ? '回查裁决' : event.message_kind === 'premise' ? '回查答案' : event.message_kind ? '回查原话' : '回查行动'}</button>}
        </div>
      </article>)}
      <div className="scene-end">{executionText(p)} · 已提交结果已保存</div>
    </div>
    {held && <button className="scene-latest transcript-latest" type="button" disabled={loading}
      onClick={() => {
        if (filter.startsWith('private:') && !matches(frame.events, filter).length) onFilter('all');
        setHeld(undefined);
      }}><ChevronDown size={15}/>{hasNew ? '有新消息，回到最新' : '回到最新'}</button>}
  </>;
}
