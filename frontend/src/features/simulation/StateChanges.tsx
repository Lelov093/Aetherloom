import type {Agent,SimEvent} from './api';
type SocialAgentDiff={plans:{id:string;next_step:string;status:string}[];appraisals:Record<string,{judgment:string}>;promises:Record<string,{text:string;status:string}>};
function SocialChanges({diff,name}:{diff:SimEvent['diff'];name:(id:string)=>string}){
 const prior=diff.social.before as {agents:Record<string,SocialAgentDiff>},next=diff.social.after as {agents:Record<string,SocialAgentDiff>};
 const labels:Record<string,string>={pending:'作出承诺',accepted:'接受承诺',fulfilled:'实际履行',fulfilled_late:'逾期后实际履行',overdue:'已逾期',declined:'已拒绝',active:'进行中',completed:'本人判断已完成',abandoned:'已放弃'};
 return <details><summary>社会状态变化（含主观认知）</summary>{Object.entries(next.agents).map(([id,a])=>{const b=prior.agents[id];return <div key={id}>
  {Object.entries(a.appraisals).filter(([target,j])=>j.judgment!==b.appraisals[target]?.judgment).map(([target,j])=><p key={target}>{name(id)}对{name(target)}的主观看法：{b.appraisals[target]?.judgment||'未记录'} → {j.judgment}（不等于客观关系成立）</p>)}
  {a.plans.filter(p=>JSON.stringify(p)!==JSON.stringify(b.plans.find(q=>q.id===p.id))).map(p=><p key={p.id}>{name(id)}的计划：{p.next_step} · {labels[p.status]||p.status}</p>)}
  {Object.entries(a.promises).filter(([key,p])=>JSON.stringify(p)!==JSON.stringify(b.promises[key])).map(([key,p])=><p key={key}>{name(id)}的承诺：{p.text} · {labels[p.status]||p.status}</p>)}
 </div>})}</details>;
}
export function StateChanges({diff,name}:{diff:SimEvent['diff'];name:(id:string)=>string}){
 const before=(diff.agents?.before||{}) as Record<string,Agent>,after=(diff.agents?.after||{}) as Record<string,Agent>;
 return <div>{Object.entries(after).map(([id,a])=>{const b=before[id];return <div key={id}>
  {b&&a.location!==b.location&&<p>{name(id)}：{name(b.location)} → {name(a.location)}</p>}
  {b&&a.goal!==b.goal&&<p>{name(id)}的目标：{b.goal} → {a.goal}</p>}
  {b&&Object.keys(a.known).filter(k=>!(k in b.known)).map(k=>{const v=a.known[k] as {text?:string;basis?:string;sender_id?:string};return <p key={k}>{name(id)}收到{v.sender_id?name(v.sender_id):'明确提供的'}信息：{v.text||'记录'}（获知依据：{v.basis==='reported'?'他人报告，未自动确认为真':'明确的起点资料'}）</p>})}
 </div>})}
 {diff.items&&Object.entries(diff.items.after as Record<string,string>).filter(([id,holder])=>(diff.items.before as Record<string,string>)[id]!==holder).map(([id,holder])=><p key={id}>{name(id)}：{name((diff.items.before as Record<string,string>)[id])} → {name(holder)}</p>)}
 {diff.tick&&<p>模拟经过的行动步：{String(diff.tick.before)} → {String(diff.tick.after)}</p>}
 {diff.social&&<SocialChanges diff={diff} name={name}/>}
 </div>;
}
