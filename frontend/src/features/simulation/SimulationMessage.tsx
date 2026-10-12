import {ArrowRight,MapPin,MoreHorizontal,ShieldAlert,Sparkles,Package,Flag,Eye,Clock} from 'lucide-react';
import {Portrait} from '../objects/Portrait';
import type {PresentedEvent} from './presentation';
import {sharedReports} from './presentation';
export function SimulationMessage({p,name,portraits,selected,related,onSelect,onCharacter}:{p:PresentedEvent;name:(id:string)=>string;portraits:Record<string,number>;selected:boolean;related:boolean;onSelect:()=>void;onCharacter:(id:string)=>void}){
 const e=p.event,speech=!!e.accepted&&e.payload.type==='speak',Icon=!e.accepted?ShieldAlert:({move:MapPin,transfer:Package,take:Package,goal:Flag,observe:Eye,wait:Clock} as Record<string,typeof Eye>)[e.payload.type]||Sparkles;
 const reports=sharedReports(p),reportTexts=[...new Set(reports.map(r=>r.text).filter(Boolean))];
 return <article id={`monitor-event-${e.seq}`} className={`scene-entry ${speech?'scene-entry--speech':'scene-entry--action'} ${!e.accepted?'scene-entry--blocked':''} ${selected?'is-selected':''} ${related?'is-related':''}`} onClick={onSelect}>
 {speech?<button className="portrait-button" aria-label={`查看${name(e.actor_id)}的当前状态`} onClick={ev=>{ev.stopPropagation();onCharacter(e.actor_id)}}><Portrait id={e.actor_id} name={name(e.actor_id)} version={portraits[e.actor_id]}/></button>:<span className="scene-action-icon"><Icon size={17}/></span>}
 <div className="scene-entry-content"><header><span className="scene-speaker">{speech?<><button onClick={ev=>{ev.stopPropagation();onCharacter(e.actor_id)}}>{name(e.actor_id)}</button><ArrowRight size={12}/><span>{p.recipients.map(name).join('、')||'在场角色'}</span></>:<span>{p.kind}</span>}</span><span className="scene-entry-meta">第{e.seq}步{p.location&&<> · {name(p.location)}</>}</span><button className="message-detail" aria-label={`查看第${e.seq}步事件详情`} onClick={ev=>{ev.stopPropagation();onSelect()}}><MoreHorizontal size={18}/></button></header>
 <div className={speech?'scene-bubble':'scene-narration'}>{speech?e.payload.speech:e.narration}</div>
 {reportTexts.length>0&&<div className="scene-state-change"><Sparkles size={13}/><span>明确告知：{reportTexts.join('；')}<small>收到报告，不自动确认为真</small></span></div>}
 {!!e.accepted&&e.diff.items&&Object.entries(p.after.items).filter(([id,holder])=>p.before.items[id]!==holder).map(([id,holder])=><div className="scene-state-change" key={id}><Package size={13}/><span>{name(id)}：{name(p.before.items[id])} → {name(holder)}</span></div>)}
 {!!e.accepted&&e.payload.type==='move'&&<div className="scene-state-change"><MapPin size={13}/><span>{name(p.location)} → {name(p.after.agents[e.actor_id].location)}</span></div>}
 {!!e.accepted&&e.payload.type==='goal'&&<div className="scene-state-change"><Flag size={13}/><span>{p.after.agents[e.actor_id].goal}</span></div>}
 </div></article>;
}
