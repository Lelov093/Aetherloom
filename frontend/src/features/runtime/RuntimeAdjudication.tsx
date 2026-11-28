import { displayName, type AttemptAction, type PendingConflict, type Projection, type RuntimeEvent } from './api';
import { reasons } from './eventText';

export const adjudicationKinds = ['attempt_action', 'item_conflict', 'hold_consequence', 'resolve_conflict'] as const;
type Kind = typeof adjudicationKinds[number];
export const adjudicationLabels: Record<Kind, string> = {
  attempt_action: '指定角色尝试', item_conflict: '登记物品争用', hold_consequence: '暂停待定后果', resolve_conflict: '处理冲突',
};

export interface AdjudicationDraft {
  actor: string;
  action: AttemptAction['kind'];
  destination: string;
  item: string;
  recipient: string;
  claimants: string[];
  critical: boolean;
  description: string;
  method: 'choose' | 'draw' | 'cancel';
}
export const emptyAdjudication: AdjudicationDraft = {
  actor: '', action: 'move', destination: '', item: '', recipient: '', claimants: [], critical: true, description: '', method: 'choose',
};

export function adjudicationPayload(kind: string, p: Projection, draft: AdjudicationDraft): Record<string, unknown> | undefined {
  if (!p.capabilities.includes('adjudicate')) return;
  const { actor, action, item, destination, recipient, critical, claimants, description, method } = draft;
  if (kind === 'attempt_action' && actor) {
    if (action === 'move' && destination) return { actor_id: actor, action: { kind: action, destination_id: destination } };
    if (action === 'take' && item) return { actor_id: actor, action: { kind: action, item_id: item } };
    if (action === 'transfer' && item && recipient) return { actor_id: actor, action: { kind: action, item_id: item, recipient_id: recipient } };
  }
  if (kind === 'item_conflict' && item && claimants.length >= 2) return { item_id: item, actors: claimants, critical };
  if (kind === 'hold_consequence' && description.trim()) return { description: description.trim() };
  const detail = p.pending_conflict?.detail;
  if (kind === 'resolve_conflict' && detail) {
    if (detail.kind === 'consequence' || method === 'cancel') return { method: 'cancel' };
    if (method === 'draw') return { method };
    if (detail.claims.some(claim => claim.actor_id === actor && !claim.blocker)) return { method, actor_id: actor };
  }
}

export function RuntimeAdjudicationFields({ kind, p, draft, onChange }: {
  kind: string; p: Projection; draft: AdjudicationDraft; onChange: (draft: AdjudicationDraft) => void;
}) {
  const actors = Object.keys(p.agents);
  const update = (values: Partial<AdjudicationDraft>) => onChange({ ...draft, ...values });
  const options = (keys: string[]) => keys.map(id => <option key={id} value={id}>{displayName(p, id)}</option>);
  const items = <label>物品<select value={draft.item} onChange={e => update({ item: e.target.value })}>
    <option value="">选择物品</option>{options(Object.keys(p.world.items))}
  </select></label>;
  if (kind === 'attempt_action') return <>
    <label>指定角色<select value={draft.actor} onChange={e => update({ actor: e.target.value, recipient: '' })}>
      <option value="">选择角色</option>{options(actors)}
    </select></label>
    <label>尝试动作<select value={draft.action} onChange={e => update({ action: e.target.value as AttemptAction['kind'] })}>
      <option value="move">进入地点</option><option value="take">拾取物品</option><option value="transfer">转交物品</option>
    </select></label>
    {draft.action === 'move' ? <label>尝试进入的地点<select value={draft.destination} onChange={e => update({ destination: e.target.value })}>
      <option value="">选择地点</option>{options(Object.keys(p.world.place_topology))}
    </select></label> : items}
    {draft.action === 'transfer' && <label>接收者<select value={draft.recipient} onChange={e => update({ recipient: e.target.value })}>
      <option value="">选择角色</option>{options(actors.filter(id => id !== draft.actor))}
    </select></label>}
  </>;
  if (kind === 'item_conflict') return <>
    {items}
    <fieldset>
      <legend>同时尝试拾取的角色</legend>
      {actors.map(id => <label className="runtime-checkbox" key={id}>
        <input type="checkbox" checked={draft.claimants.includes(id)} disabled={!draft.claimants.includes(id) && draft.claimants.length >= 8}
          onChange={e => update({ claimants: e.target.checked ? [...draft.claimants, id] : draft.claimants.filter(person => person !== id) })} />
        {displayName(p, id)}
      </label>)}
    </fieldset>
    <label className="runtime-checkbox"><input type="checkbox" checked={draft.critical} onChange={e => update({ critical: e.target.checked })} />
      标为关键冲突，同等条件时暂停
    </label>
  </>;
  if (kind === 'hold_consequence') return <label>待兑现的后果<textarea value={draft.description} rows={3} maxLength={450}
    onChange={e => update({ description: e.target.value })} /></label>;
  if (kind === 'resolve_conflict' && p.pending_conflict) {
    const detail = p.pending_conflict.detail;
    return <>
      <ConflictDetails p={p} conflict={p.pending_conflict} />
      {detail.kind === 'item' ? <>
        <label>处理方式<select value={draft.method} onChange={e => update({ method: e.target.value as AdjudicationDraft['method'], actor: '' })}>
          <option value="choose">选一位符合规则的角色</option><option value="draw">同条件抽签</option><option value="cancel">搁置争用</option>
        </select></label>
        {draft.method === 'choose' && <label>由谁拾取<select value={draft.actor} onChange={e => update({ actor: e.target.value })}>
          <option value="">选择角色</option>{options(detail.claims.filter(claim => !claim.blocker).map(claim => claim.actor_id))}
        </select></label>}
      </> : <p className="runtime-muted">当前规则无法兑现这项后果。搁置后可继续世界线。</p>}
    </>;
  }
  return null;
}

function ConflictDetails({ p, conflict }: { p: Projection; conflict: PendingConflict }) {
  const detail = conflict.detail;
  if (detail.kind === 'consequence') return <p>{detail.description}</p>;
  return <div>
    <p>{displayName(p, detail.item_id)} · 当时归属 {displayName(p, detail.holder_id)}</p>
    <ul>{detail.claims.map(claim => <li key={claim.actor_id}>{displayName(p, claim.actor_id)} · {claim.blocker
      ? reasons[claim.blocker] || '规则拒绝' : '符合拾取规则'}</li>)}</ul>
  </div>;
}

export function RulingInspection({ p, event, onSource }: { p: Projection; event: RuntimeEvent; onSource: (source: PendingConflict['source']) => void }) {
  const ruling = event.ruling;
  if (!ruling) return null;
  const name = (id: string) => displayName(p, id);
  const effects = event.ruling_effects ?? [];
  const detail = ruling.kind === 'conflict' ? ruling.conflict.detail : undefined;
  const attempt = ruling.kind === 'attempt' ? ruling.attempt : undefined;
  const action = attempt?.action;
  return <div className="runtime-expression">
    <h3>作者意图</h3>
    {action && attempt && <p>{name(attempt.actor_id)}尝试{action.kind === 'move' ? `进入${name(action.destination_id)}`
      : action.kind === 'take' ? `拾取${name(action.item_id)}` : `将${name(action.item_id)}转交给${name(action.recipient_id)}`}</p>}
    {ruling.kind === 'conflict' && <ConflictDetails p={p} conflict={ruling.conflict} />}
    {event.reason && <p>{event.reason}</p>}
    <h3>实际裁决</h3>
    {ruling.kind === 'attempt' ? <>
      <p>{event.accepted ? '规则允许' : `规则拒绝 · ${reasons[event.reason_code || ''] || '条件未满足'}`}</p>
      {ruling.required_items.length > 0 && <p>进入条件 · 须持有{ruling.required_items.map(name).join('、')}</p>}
    </> : <>
      <p>{{ pending: '在结果生效前暂停', blocked: '没有角色符合拾取规则', rules: '按规则判定', draw: '同条件抽签',
        chosen: '作者从符合规则的人中选定', cancelled: '已搁置' }[ruling.result]}</p>
      {ruling.winner_id && <p>{name(ruling.winner_id)}获得物品{ruling.draw_index !== null && ` · 抽中第 ${ruling.draw_index + 1} 位`}</p>}
      {ruling.conflict.source.seq !== event.seq || ruling.conflict.source.worldline_id !== p.worldline_id
        ? <button className="text-link" onClick={() => onSource(ruling.conflict.source)}>回到争议登记的第 {ruling.conflict.source.seq} 步</button> : null}
    </>}
    <h3>后果</h3>
    {effects.length ? effects.map(effect => <p key={`${effect.op}:${effect.op === 'agent_location_set' ? effect.entity_id : effect.item_id}`}>
      {effect.op === 'agent_location_set' ? `${name(effect.entity_id)}的位置` : `${name(effect.item_id)}的归属`} · {name(effect.before)} → {name(effect.after)}
    </p>) : action?.kind === 'move' && ruling.kind === 'attempt'
      ? <p>{name(ruling.attempt.actor_id)}仍在{name(ruling.location_id)}</p>
      : detail?.kind === 'item' ? <p>{name(detail.item_id)}仍归属{name(detail.holder_id)}</p> : <p>本步未生效</p>}
  </div>;
}
