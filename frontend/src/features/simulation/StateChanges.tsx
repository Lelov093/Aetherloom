import type {Agent,SimEvent} from './api';
export function StateChanges({diff,name}:{diff:SimEvent['diff'];name:(id:string)=>string}){
 const before=(diff.agents?.before||{}) as Record<string,Agent>,after=(diff.agents?.after||{}) as Record<string,Agent>;
 return <div>{Object.entries(after).map(([id,a])=>{const b=before[id];return <div key={id}>
  {b&&a.location!==b.location&&<p>{name(id)}：{name(b.location)} → {name(a.location)}</p>}
  {b&&a.goal!==b.goal&&<p>{name(id)}的目标：{b.goal} → {a.goal}</p>}
  {b&&Object.keys(a.known).filter(k=>!(k in b.known)).map(k=>{const v=a.known[k] as {text?:string;basis?:string;sender_id?:string};return <p key={k}>{name(id)}收到{v.sender_id?name(v.sender_id):'明确提供的'}信息：{v.text||'记录'}（获知依据：{v.basis==='reported'?'他人报告，未自动确认为真':'明确的起点资料'}）</p>})}
 </div>})}
 {diff.items&&Object.entries(diff.items.after as Record<string,string>).filter(([id,holder])=>(diff.items.before as Record<string,string>)[id]!==holder).map(([id,holder])=><p key={id}>{name(id)}：{name((diff.items.before as Record<string,string>)[id])} → {name(holder)}</p>)}
 {diff.tick&&<p>模拟经过的行动步：{String(diff.tick.before)} → {String(diff.tick.after)}</p>}
 </div>;
}
