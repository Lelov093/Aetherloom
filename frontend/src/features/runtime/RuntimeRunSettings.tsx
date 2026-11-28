import { useState } from 'react';
import { Button, ErrorNotice } from '../../components/ui';
import { displayName, runtimeRequest, type Envelope, type HostSession, type ObservationCondition, type RunSettings } from './api';

const events: Record<ObservationCondition['event'], string> = {
  scheduled: '定时事件发生', move: '进入地点成功', take: '拾取物品成功', transfer: '转交物品成功', read: '读到物品文本',
};
const errors: Record<string, string> = { invalid_observation_target: '请核对所选事件、地点或物品。',
  stale_view: '当前状态已更新，请核对后重试。', pause_before_run_settings: '请先暂停，再保存运行设置。' };

export function ObservationLabels({ hits }: { hits?: ObservationCondition[] }) {
  return hits?.map(hit => <p className="runtime-observation" key={hit.id}>
    {hit.mode === 'mark' ? '观察标记' : '观察停点'} · {hit.title}
  </p>);
}

export function RuntimeRunSettings({ frame, session, connected, onCommit }: {
  frame: Envelope; session: HostSession; connected: boolean; onCommit: (cursor: string) => void;
}) {
  const p = frame.projection;
  const [draft, setDraft] = useState<RunSettings>(() => p.run?.settings ?? { mode: 'continuous', segment_steps: 3, observations: [] });
  const [busy, setBusy] = useState(false), [result, setResult] = useState(''), [error, setError] = useState('');
  const jobs = p.scheduler?.pending_jobs ?? [];
  const choices = (event: ObservationCondition['event']) => {
    if (event === 'scheduled') return jobs.map(job => [job.id, `时刻 ${job.due_tick} · ${job.payload?.text || job.payload?.key || job.id}`]);
    const keys = Object.keys(event === 'move' ? p.world.place_topology : event === 'read' ? p.world.item_texts ?? {} : p.world.items);
    return keys.map(key => [key, displayName(p, key)]);
  };
  const replace = (id: string, change: Partial<ObservationCondition>) => setDraft(current => ({ ...current,
    observations: current.observations.map(row => row.id === id ? { ...row, ...change } : row),
  }));
  const editable = connected && !p.historical && p.control.status === 'paused' && !busy;
  const invalidSteps = !Number.isInteger(draft.segment_steps) || draft.segment_steps < 1 || draft.segment_steps > 50;
  const invalidTick = draft.story_stop_tick != null && (!Number.isInteger(draft.story_stop_tick) || draft.story_stop_tick < 0 || draft.story_stop_tick > 2147483647);
  const invalid = draft.observations.some(row => !row.title.trim() || !row.target_id) || draft.mode === 'segment' && invalidSteps || invalidTick;
  async function save() {
    const cursor = frame.cursor;
    setBusy(true);
    setError('');
    setResult('');
    try {
      await runtimeRequest(session, `/worldlines/${encodeURIComponent(p.worldline_id)}/run-settings`, undefined, 'POST',
        { cursor, settings: { ...draft, segment_steps: invalidSteps ? 3 : draft.segment_steps } });
      onCommit(cursor);
      setResult('运行方式与观察条件已保存。');
    } catch (problem) {
      setError(errors[(problem as Error).message] ?? '暂时无法保存运行设置。');
    } finally { setBusy(false); }
  }
  return <details>
    <summary>运行方式与观察条件</summary>
    <div className="runtime-command-form">
      {p.control.status !== 'paused' && <p className="runtime-muted">暂停后可修改运行方式和观察条件。</p>}
      <fieldset disabled={!editable}>
        <label>运行方式<select value={draft.mode} onChange={event => setDraft({ ...draft, mode: event.target.value as RunSettings['mode'] })}>
          <option value="continuous">持续运行</option><option value="segment">分段运行</option>
        </select></label>
        {draft.mode === 'segment' && <label>每段推进步数<input type="number" min={1} max={50} value={draft.segment_steps || ''}
          onChange={event => setDraft({ ...draft, segment_steps: Number(event.target.value) })} /></label>}
        <label>故事时限（逻辑时刻）<input type="number" min={0} max={2147483647} step={1} placeholder="留空为不限"
          value={draft.story_stop_tick ?? ''} onChange={event => setDraft({ ...draft,
            story_stop_tick: event.target.value === '' ? null : Number(event.target.value),
          })} /></label>
        {p.model_budget?.exploration && <label className="runtime-checkbox">
          <input type="checkbox" checked={draft.retry_once ?? false} onChange={event => setDraft({ ...draft, retry_once: event.target.checked })} />
          预准一次重试（使用共享额度）
        </label>}
        {draft.observations.map((row, index) => {
          const options = choices(row.event);
          return <fieldset key={row.id}>
            <legend>观察条件 {index + 1}</legend>
            <label>条件名称<input value={row.title} maxLength={100} onChange={event => replace(row.id, { title: event.target.value })} /></label>
            <div className="runtime-command-row">
              <label>何时命中<select value={row.event} onChange={event => replace(row.id, {
                event: event.target.value as ObservationCondition['event'], target_id: '',
              })}>
                {(Object.keys(events) as ObservationCondition['event'][]).filter(kind => kind !== 'read' || p.world.item_texts)
                  .map(kind => <option key={kind} value={kind}>{events[kind]}</option>)}
              </select></label>
              <label>命中后<select value={row.mode} onChange={event => replace(row.id, { mode: event.target.value as ObservationCondition['mode'] })}>
                <option value="mark">发生就标记</option><option value="pause">发生就暂停</option>
              </select></label>
            </div>
            <label>观察哪个事件或目标<select value={row.target_id} onChange={event => replace(row.id, { target_id: event.target.value })}>
              <option value="">请选择</option>
              {row.target_id && !options.some(([id]) => id === row.target_id) && <option value={row.target_id}>原定时事件（已发生）</option>}
              {options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select></label>
            <Button variant="ghost" onClick={() => setDraft({ ...draft, observations: draft.observations.filter(other => other.id !== row.id) })}>移除观察条件</Button>
          </fieldset>;
        })}
        <Button variant="ghost" disabled={draft.observations.length >= 8} onClick={() => setDraft({ ...draft,
          observations: [...draft.observations, { id: crypto.randomUUID(), title: '', mode: 'mark', event: jobs.length ? 'scheduled' : 'move', target_id: '' }],
        })}>添加观察条件</Button>
      </fieldset>
      <Button onClick={() => void save()} disabled={!editable || invalid}>保存运行设置</Button>
      {result && <p role="status">{result}</p>}
      {error && <ErrorNotice>{error}</ErrorNotice>}
    </div>
  </details>;
}
