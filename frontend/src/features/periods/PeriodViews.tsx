import { useEffect, useState, type FormEvent } from 'react';
import { CalendarRange } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import type { Entity } from '../creation/api';
import { CanonHistoryDialog } from '../creation/CanonHistoryDialog';
import { momentLabel, periodsApi, recordPeriod, withMoment, type ObjectPeriod, type PeriodEvent, type SettingChange, type StoryMoment } from './api';

export function EventSelect({ events, value, onChange, label = '生效事件', disabled }: {
  events: PeriodEvent[]; value: string; onChange: (id: string) => void; label?: string; disabled?: boolean;
}) {
  return <label className="field"><span>{label}</span><select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>
    <option value="">选择已有事件</option>
    {events.filter(event => event.status === 'active').map(event =>
      <option key={event.id} value={event.id}>{event.title}{event.valid_from ? ` · ${event.valid_from}` : ' · 时间未定'}</option>)}
  </select></label>;
}

export function useObjectPeriod(world: string, entity: string, moment?: StoryMoment, refresh = 0) {
  const key = JSON.stringify(moment || null);
  const [result, setResult] = useState<{ key: string; data?: ObjectPeriod; error?: string }>();
  const identity = JSON.stringify([world, entity, key, refresh]);
  useEffect(() => {
    let active = true;
    periodsApi.object(world, entity, JSON.parse(key) ?? undefined)
      .then(data => { if (active) setResult({ key: identity, data }); })
      .catch(e => { if (active) setResult({ key: identity, error: e.message }); });
    return () => { active = false; };
  }, [identity]);
  return result?.key === identity ? result : undefined;
}

export function PeriodReadout({ data, moment, compact = false }: {
  data: ObjectPeriod; moment?: StoryMoment; compact?: boolean;
}) {
  const fields = data.fields.filter(field => compact ? field.changes.length : field.base || field.changes.length);
  return <>
    <section className="period-records">
      <h3>正式关系</h3>
      {data.relationships.length ? <ul>{data.relationships.map(relation => <li key={relation.id}>
        <strong>{relation.subject_name} · {relation.label} · {relation.object_name}</strong>
        <small>{recordPeriod(relation)}</small>
      </li>)}</ul> : <p className="context-hint">此范围没有可确认的关系。</p>}
    </section>
    {!compact && (data.facts.length > 0 || moment) && <section className="period-records">
      <h3>世界事实</h3>
      {data.facts.length ? <ul>{data.facts.map(fact => <li key={fact.id}>
        <strong>{fact.predicate} · {fact.value}</strong><small>{recordPeriod(fact)}</small>
      </li>)}</ul> : <p className="context-hint">此范围没有可确认的事实。</p>}
    </section>}
    {fields.length > 0 && <section className="period-records">
      <h3>对象资料</h3>
      {fields.map(field => <article key={field.key}>
        <h4>{field.label}</h4><p>{field.value === '' ? '该时期未填写描述。' : field.value ?? '该时期尚无确定描述。'}</p>
        {!moment && field.changes.length > 0 && <ul>{field.changes.map(change => <li key={change.id}>
          <strong>{change.event?.title ?? '事件未定'}后</strong><p>{change.value}</p>
        </li>)}</ul>}
      </article>)}
    </section>}
  </>;
}

export function ObjectPeriods({ world, entity, moment, onChange, onMap }: {
  world: string; entity: Entity; moment?: StoryMoment; onChange: (moment?: StoryMoment) => void; onMap: () => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [year, setYear] = useState('' + (moment && 'year' in moment ? moment.year : ''));
  const [yearError, setYearError] = useState('');
  const [editor, setEditor] = useState<true | SettingChange>();
  const [history, setHistory] = useState<string>();
  const result = useObjectPeriod(world, entity.id, moment, refresh + entity.version);
  const data = result?.data;
  const event = moment && 'event' in moment ? moment.event : '';
  const side = moment && 'event' in moment ? moment.side : undefined;
  useEffect(() => {
    setYear(moment && 'year' in moment ? String(moment.year) : '');
    setYearError('');
  }, [moment && 'year' in moment ? moment.year : undefined]);
  function showYear(e: FormEvent) {
    e.preventDefault();
    if (!/^-?\d{1,6}$/.test(year.trim())) { setYearError('请输入明确的整数年份。'); return; }
    onChange({ year: Number(year) });
  }
  const explore = withMoment(`/worlds/${world}/explore?focus=${encodeURIComponent(`entity:${entity.id}`)}`, moment);
  return <section className="object-periods">
    <header className="period-heading">
      <h2><CalendarRange size={19}/>{momentLabel(moment, data?.selected_event)}</h2>
      {entity.status === 'active' && <Button disabled={!data?.events.length} onClick={() => setEditor(true)}>记录历史变化</Button>}
    </header>
    <div className="period-controls">
      <EventSelect label="查看事件" events={data?.events ?? []} value={event}
        onChange={id => onChange(id ? { event: id, side: side || 'after' } : undefined)}/>
      <div className="period-sides" role="group" aria-label="事件时点">
        <button type="button" disabled={!event} aria-pressed={side === 'before'} onClick={() => onChange({ event, side: 'before' })}>事件前</button>
        <button type="button" disabled={!event} aria-pressed={side === 'after'} onClick={() => onChange({ event, side: 'after' })}>事件后</button>
      </div>
      <form className="period-year" onSubmit={showYear}><label className="field"><span>故事年份</span>
        <input value={year} inputMode="numeric" onChange={e => setYear(e.target.value)} /></label>
        <Button type="submit">查看年份</Button>
      </form>
      {moment && <Button variant="ghost" onClick={() => onChange()}>跨时期总览</Button>}
    </div>
    {yearError && <ErrorNotice>{yearError}</ErrorNotice>}
    <div className="period-links">
      <Link className="text-link" to={explore}>查看关系图 →</Link>
      {entity.kind === 'location' && <Button variant="ghost" onClick={onMap}>查看地图位置</Button>}
      {!data?.events.length && data && <Link className="text-link" to={`/worlds/${world}/create/records?entity=${entity.id}`}>先记录正式事件 →</Link>}
    </div>
    {result?.error ? <><ErrorNotice>{result.error}</ErrorNotice><Button onClick={() => setRefresh(n => n + 1)}>重新读取</Button></> :
      data ? <PeriodReadout data={data} moment={moment}/> : <p role="status">正在读取时期资料…</p>}
    {!moment && data && data.fields.some(field => field.changes.length) && <section className="period-records">
      <h3>历史变化的修订</h3>
      <ul>{data.fields.flatMap(field => field.changes.map(change => <li key={change.id}>
        <strong>{field.label} · {change.event?.title || '事件未定'}后 · v{change.version}</strong>
        <div className="canon-row-actions">
          {entity.status === 'active' && <Button onClick={() => setEditor(change)}>纠错</Button>}
          <Button variant="ghost" onClick={() => setHistory(change.id)}>修改历史</Button>
        </div>
      </li>))}</ul>
    </section>}
    {editor && data && <ValueEditor world={world} entity={entity} data={data} event={event} change={editor === true ? undefined : editor}
      onClose={() => setEditor(undefined)} onSaved={() => { setEditor(undefined); setRefresh(n => n + 1); }}/>}
    {history && <CanonHistoryDialog kind="setting_state" id={history} onClose={() => setHistory(undefined)}/>}
  </section>;
}

export function MapPeriodDialog({ world, entity, moment, onChange, onClose }: {
  world: string; entity: string; moment: StoryMoment;
  onChange: (moment: StoryMoment) => void; onClose: () => void;
}) {
  const result = useObjectPeriod(world, entity, moment);
  return <Dialog title="地图时期资料" onClose={onClose} focusFirstInput={false}>
    <section aria-label="地图上的故事时点">
      <h3>{momentLabel(moment, result?.data?.selected_event)}</h3>
      {'event' in moment && <div className="period-sides" role="group" aria-label="地图事件时点">
        <button type="button" aria-pressed={moment.side === 'before'} onClick={() => onChange({ ...moment, side: 'before' })}>事件前</button>
        <button type="button" aria-pressed={moment.side === 'after'} onClick={() => onChange({ ...moment, side: 'after' })}>事件后</button>
      </div>}
      {result?.error ? <ErrorNotice>{result.error}</ErrorNotice>
        : result?.data ? <PeriodReadout data={result.data} moment={moment} compact/> : <p role="status">正在读取时期资料…</p>}
    </section>
  </Dialog>;
}

function ValueEditor({ world, entity, data, event, change, onClose, onSaved }: {
  world: string; entity: Entity; data: ObjectPeriod; event: string; change?: SettingChange; onClose: () => void; onSaved: () => void;
}) {
  const [target, setTarget] = useState('');
  const [anchor, setAnchor] = useState(event);
  const [value, setValue] = useState(change?.value ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (change) await periodsApi.correctValue(world, entity.id, change, value);
      else await periodsApi.recordValue(world, entity.id, { target, event_id: anchor, value, version: entity.version });
      onSaved();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog title={change ? '纠正时期描述' : '记录历史变化'} busy={busy} onClose={onClose}>
    <form onSubmit={save}>
      {change ? <p className="dialog-intro">{change.event?.title}后 · 修订这条已生效的描述。</p> : <>
        <EventSelect events={data.events} value={anchor} onChange={setAnchor} disabled={busy}/>
        <label className="field"><span>发生变化的资料项</span><select value={target} onChange={e => setTarget(e.target.value)} disabled={busy}>
          <option value="">选择属性或小节</option>
          {data.fields.filter(field => field.base !== null).map(field => <option key={field.key} value={field.key}>{field.label}</option>)}
        </select></label>
        <p className="dialog-intro">本项从该事件后生效。其他资料沿用各自的记录。</p>
      </>}
      <label className="field"><span>{change ? '修正描述' : '事件后的描述'}</span><textarea value={value}
        disabled={busy} onChange={e => setValue(e.target.value)} maxLength={200000} rows={5}/></label>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions"><Button type="button" disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="primary" type="submit" disabled={busy || !change && (!anchor || !target)}>{change ? '保存纠错' : '保存新状态'}</Button>
      </div>
    </form>
  </Dialog>;
}
