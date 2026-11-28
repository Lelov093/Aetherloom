import { displayName, evidenceText, type Projection } from './api';
import { CognitionInspector } from './CognitionInspector';
import { modelStopMessages } from './RuntimeModelBudget';
const status:Record<string,string>={active:'进行中',blocked:'受阻（本人判断）',completed:'已完成（本人判断）',abandoned:'已放弃',pending:'已作出／待回应',accepted:'对方已接受',fulfilled:'实际行动已履行',fulfilled_late:'实际行动已履行（逾期）',overdue:'已逾约定期限',declined:'已拒绝',open:'交谈中',ended:'已结束',left:'已离场'};
export function executionText(p:Projection):string {
  if(p.historical)return '历史状态 · 只读';
  if(p.conflict_pending)return '关键冲突待处理';
  if(p.control.reason === 'awaiting_activity')return p.scheduler?.pending_jobs.length ? '等待中 · 有新事件可继续' : '等待中 · 暂无后续事项';
  if(p.control.reason === 'observation_pause')return '已命中观察停点';
  if(p.control.reason === 'segment_complete')return '本段已完成';
  if(p.control.reason === 'worldline_switched')return '切线时已暂停';
  if(p.model_budget?.exploration?.recovery?.status === 'commit_unknown')return '提交回执待核对';
  if(p.control.reason === 'model:commit_unknown' && p.model_budget?.exploration?.recovery?.status === 'commit_recovered')return '已找回提交回执';
  if(['model:commit_unknown', 'model:model_connection_lost'].includes(p.control.reason) && p.model_budget?.exploration?.recovery?.status === 'not_committed')return '已核对 · 原步未提交';
  if((p.model_budget?.exploration || p.control.reason === 'story_time_limit') && modelStopMessages[p.control.reason])return modelStopMessages[p.control.reason];
  if(p.model_budget?.exploration && p.control.reason.startsWith('model:'))return '模型请求暂停';
  const e=p.execution;
  if(!e)return p.control.status==='running'?'允许运行':'已暂停';
  const a=p.model_budget?.allocation;
  if(e.state==='paused'&&p.control.reason==='model:model_run_limit'&&a){
    if(a.used_cognition!=null&&a.max_cognition!=null&&a.used_cognition>=a.max_cognition)return `已暂停 · 认知修订额度已用完（${a.used_cognition}/${a.max_cognition}）`;
    if(a.used_actions!=null&&a.max_actions!=null&&a.used_actions>=a.max_actions)return `已暂停 · 模型行动额度已用完（${a.used_actions}/${a.max_actions}）`;
    if(a.elapsed_seconds>=a.runtime_seconds)return `已暂停 · 本线运行用时已达上限（${a.elapsed_seconds}/${a.runtime_seconds}秒）`;
  }
  const labels:Record<string,string>={paused:'已暂停',autonomy_off:'自动调度未启用',model_off:'模型未启用',requesting:'模型正在决策',ready:e.strategy==='model'?'等待角色决策':'无模型规则运行',waiting:'等待下次唤醒'};
  return (labels[e.state]||e.state)+(e.actor_id?` · ${displayName(p,e.actor_id)}`:'')+(e.state==='waiting'&&e.next_tick!=null?` · tick ${e.next_tick}`:'');
}
export function SocialInspector({p,actor}:{p:Projection;actor:string}){
  const s=p.agents[actor]?.social;
  if(!s)return null;
  const citation=(refs:string[])=><details><summary>查看 {refs.length} 条依据</summary>{refs.map(ref=>{
    if(ref.startsWith('perception:'))return <p key={ref}>当次已保存的局部感知<small>具体字段见本次修订的结构化依据；不代表当前仍相同</small></p>;
    const split=ref.indexOf(':'),kind=ref.slice(0,split),key=ref.slice(split+1);
    const record=kind==='knowledge'?p.agents[actor].known?.[key] as {text?:string;basis?:string}|undefined:p.agents[actor].memories?.[Number(key)];
    const text=record?.text==='rule_rejected'?'该次行动被世界规则拒绝，未产生预期状态变化。':evidenceText(record);
    const basis:Record<string,string>={reported:'他人报告，不自动为真',read:'实际阅读的物品文本，不自动为真',checked:'已核对的片段字面结果',initial:'起点确认资料'};
    return <p key={ref}>{text||'起点或已保存经历'}<small>{basis[record?.basis||'']||'自身获准经历'}</small></p>;
  })}</details>;
  return <section aria-label="社会状态">
    <h3>持续计划与社会认知</h3>
    {s.conversations.filter(c=>c.status==='open'&&c.awaiting).map(c=><p key={c.id}>交谈轮次：{c.awaiting===actor?'轮到本人回应':`等待${displayName(p,c.awaiting!)}回应`}<small>角色仍可拒绝、结束或另作安排；等待不表示计划完成。</small></p>)}
    {!s.own.plans.length&&<p>当前没有保留的计划；不表示目标已完成。</p>}
    {s.own.plans.map(plan=><article key={plan.id}><strong>{plan.next_step}</strong><small>{status[plan.status]||plan.status}{plan.due_tick!=null?` · 检查tick ${plan.due_tick}`:''}</small>
      <p>完成：{plan.completion}；放弃／调整：{plan.abandon}</p></article>)}
    {s.own.cognition&&<CognitionInspector state={s.own.cognition} beliefs={p.agents[actor].beliefs||{}} citation={citation}
      describe={text=>Object.keys({...p.scene?.actors,...p.scene?.places,...p.scene?.items}).reduce((value,id)=>value.split(id).join(displayName(p,id)),text)}/>}
    <details><summary>对他人的看法（主观、方向性）</summary>{Object.values(s.own.appraisals).map(a=><article key={a.target_id}><p>{displayName(p,a.target_id)}：{a.judgment}</p>{citation(a.refs)}</article>)}</details>
    <details><summary>反思／摘要（不等于世界事实）</summary>{s.own.reflections.map((r,i)=><article key={i}><p>{r.text}</p>{citation(r.refs)}</article>)}</details>
    <details><summary>交谈与承诺</summary>{s.conversations.map(c=><p key={c.id}>{c.participants.map(id=>displayName(p,id)).join(' ↔ ')} · {status[c.status]||c.status}{c.awaiting?` · 等待${displayName(p,c.awaiting)}`:''}</p>)}
      {Object.entries(s.own.promises).map(([id,c])=><article key={id}><p>向{displayName(p,c.recipient_id)}：{c.text}<small>{status[c.status]||c.status}{c.due_tick!=null?` · 到期tick ${c.due_tick}`:''}</small></p>{citation([c.source_ref])}</article>)}
      {Object.entries(s.incoming_promises).map(([id,c])=><p key={id}>{displayName(p,c.sender_id)}向本人承诺：{c.text}<small>{status[c.status]||c.status}</small></p>)}
    </details>
  </section>;
}
