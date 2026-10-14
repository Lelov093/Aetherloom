import type {Session,SimEvent,WorldState} from './api';

export const actionNames:Record<string,string>={speak:'交谈',move:'移动',transfer:'交接',take:'拾取',observe:'观察',wait:'等待',goal:'目标变化'};
export interface PresentedEvent {event:SimEvent;before:WorldState;after:WorldState;location:string;recipients:string[];involved:string[];kind:string}

// Derive history from the frozen start and committed differences, never from
// today's Canon or the actor's final location. This is presentation, not replay.
export function presentEvents(session:Session):PresentedEvent[]{
 let state=session.initial_state;
 return session.events.map(event=>{
  const before=state,after={...state} as WorldState;
  for(const [key,diff] of Object.entries(event.diff)) (after as unknown as Record<string,unknown>)[key]=diff.after;
  const location=before.agents[event.actor_id]?.location||'',target=event.payload.target_id;
  const recipients=event.accepted&&event.payload.type==='speak'?(target?[target]:Object.keys(before.agents).filter(id=>id!==event.actor_id&&before.agents[id].location===location)):[];
  state=after;
  return {event,before,after,location,recipients,involved:[event.actor_id,...recipients,...(target?[target]:[])],kind:event.accepted?(actionNames[event.payload.type]||'行动'):'规则阻止'};
 });
}
export function sharedReports(p:PresentedEvent){
 return p.recipients.flatMap(id=>Object.entries(p.after.agents[id]?.known||{}).filter(([key])=>!(key in (p.before.agents[id]?.known||{}))).map(([key,value])=>({key,id,...value as {text?:string;basis?:string}})));
}

export type LogFilter = 'all' | 'speech' | 'action' | 'changes' | 'blocked';
export const logFilters: { value: LogFilter; label: string }[] = [
  { value: 'all', label: '全部' }, { value: 'speech', label: '对话' }, { value: 'action', label: '行动' }, { value: 'changes', label: '变化' }, { value: 'blocked', label: '未成立' },
];

export function hasStateChange(p: PresentedEvent) {
  if (!p.event.accepted) return false;
  return Object.entries(p.after.agents).some(([id, agent]) => {
    const before = p.before.agents[id];
    return before && (before.location !== agent.location || before.goal !== agent.goal || Object.keys(agent.known).some(key => !(key in before.known)));
  }) || Object.entries(p.after.items).some(([id, holder]) => p.before.items[id] !== holder);
}

export function filterLog(events: PresentedEvent[], filter: LogFilter, query: string, name: (id: string) => string, actor = '', location = '') {
  const text = query.trim().toLocaleLowerCase();
  return events.filter(p => {
    const matchesType = filter === 'all' || (filter === 'blocked' ? !p.event.accepted : filter === 'changes' ? hasStateChange(p) : p.event.accepted && (filter === 'speech' ? p.event.payload.type === 'speak' : p.event.payload.type !== 'speak'));
    const haystack = [p.event.narration, p.event.payload.speech, p.event.payload.new_goal, name(p.event.actor_id), ...p.recipients.map(name), name(p.location)].join(' ').toLocaleLowerCase();
    return matchesType && (!text || haystack.includes(text)) && (!actor || p.involved.includes(actor)) && (!location || p.location === location);
  });
}
