import { displayName, perceptionText, type Envelope, type RuntimeEvent } from './api';

const actionNames: Record<string, string> = {
  read: '阅读冻结文本', compare: '核对文本片段', speak: '交谈',
  observe: '观察', move: '移动', take: '拾取', transfer: '交接', wait: '等待',
  goal: '目标变化', cognition: '认知更新', environment: '环境调整',
  relocate: '场景调整', scene_event: '场景事件', schedule: '安排事件', trigger: '定时事件',
  candidate_invite: '候选获邀', advance_idle: '等待唤醒', event_observation: '局部感知',
  resolve_unknown: '确定关键未知',
  attempt_action: '作者指定尝试', item_conflict: '物品争用', hold_consequence: '暂停待定后果', resolve_conflict: '冲突处理',
};

export const reasons: Record<string, string> = {
  entry_requires_item: '未满足进入地点所需物品条件',
  not_connected: '地点之间不可直接通行',
  item_not_available: '物品不在当前地点',
  item_not_owned: '角色未持有该物品',
  item_contest_lost: '本次争用未取得物品',
  no_eligible_claimants: '参与者均不符合拾取条件',
  recipient_not_colocated: '接收者不在同一地点',
  recipient_cannot_hear_words: '接收者听不清定向发言',
  ordinary_past_unavailable: '没有获准补充这条往事，或它已成立',
  expression_basis_unavailable: '角色没有这条依据',
  expression_basis_conflict: '一次只能选择一项表达依据',
};

export function eventTitle(event: RuntimeEvent) {
  if (event.action_type === 'attempt_action') return event.accepted ? '作者指定尝试' : '作者指定尝试 · 规则拒绝';
  if (!event.accepted) return '规则阻止';
  if (event.message_kind === 'private') return '私聊';
  if (event.message_kind === 'directed' && event.action_type !== 'candidate_invite') return '定向事件';
  return actionNames[event.action_type] || event.action_type;
}

export function eventText(frame: Envelope, event: RuntimeEvent) {
  const p = frame.projection;
  const name = displayName(p, event.actor_id);
  const args = event.args ?? {};
  if (event.ruling?.kind === 'attempt') {
    const { attempt, required_items } = event.ruling;
    const action = attempt.action;
    const request = action.kind === 'move' ? `进入${displayName(p, action.destination_id)}`
      : `${action.kind === 'take' ? '拾取' : '转交'}${displayName(p, action.item_id)}`;
    const outcome = event.accepted ? '规则允许' : event.reason_code === 'entry_requires_item' && required_items.length
      ? `须持有${required_items.map(id => displayName(p, id)).join('、')}` : reasons[event.reason_code || ''] || '规则拒绝';
    return `${name}尝试${request} · ${outcome}`;
  }
  if (event.ruling?.kind === 'conflict') {
    const { conflict, result, winner_id } = event.ruling;
    const subject = conflict.detail.kind === 'item' ? displayName(p, conflict.detail.item_id) : '待定后果';
    if (result === 'pending') return `${subject} · 在结果生效前暂停`;
    if (result === 'cancelled') return `${subject} · 已搁置`;
    if (winner_id) return `${subject} · ${displayName(p, winner_id)}取得`;
  }
  if (!event.accepted)
    return `${name}的行动被拒绝：${reasons[event.reason_code || ''] || event.reason_code || '规则未满足'}。`;
  if (event.concealed) return event.message_kind === 'premise' ? '答案已隐藏' : '原话已隐藏';
  if (event.action_type === 'advance_idle') return `等待推进 · 时刻 ${event.sim_time_before} → ${event.sim_time_after}`;
  if (event.channel) return perceptionText(p, event);
  if (event.action_type === 'speak') return event.text || '已提交交谈';
  if (event.action_type === 'move' && args.destination_id)
    return `${name}从${displayName(p, event.location_id)}前往${displayName(p, String(args.destination_id))}。`;
  if (event.action_type === 'goal')
    return `${name}调整了自身目标${args.goal ? `：${args.goal}` : '。'}`;
  if (event.message_kind || event.action_type === 'scene_event') return event.text || '一项场景事件已发生。';
  return `${name} · ${eventTitle(event)}`;
}
