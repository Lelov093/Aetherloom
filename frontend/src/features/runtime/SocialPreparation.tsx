import { useEffect, useState } from 'react';
import { runtimeRequest, type HostSession } from './api';

type Person = {id:string; name:string; enabled:boolean; location:string; goal:string; persona?:string;knowledge?:string[];beliefs?:string[]};
type Source = {kind:string; id:string; version:number; label:string};
type Card = {text:string; category:string; audience:string[]; at_start:string; source_kind?:string; source_id?:string; source_version?:number};
const cardNames:Record<string,string>={prior:'前情',lore:'世界设定',relationship:'关系',period:'时期与文化',rule_reference:'规则说明',effective:'当前有效',past:'已发生的前情'};
export type SocialSetup = {
  contract_version:'social-domain-v1'|'social-domain-v2'; start_time:string; author_intent:string; cards:Card[];
  opening: null | {kind:string; text:string; place_id:string; audience:string[]; due_tick:number};
  initial_plans: Record<string, {id:string; next_step:string; target_id:string|null; due_tick:number|null; completion:string; abandon:string; status:string}[]>;
};
export function SocialPreparation({value,onChange,people,places,session,available}: {
  value:SocialSetup|undefined; onChange:(v:SocialSetup|undefined)=>void; people:Person[];
  places:{id:string;name:string}[]; session?:HostSession; available:boolean;
}) {
  const [sources,setSources] = useState<Source[]>([]), [error,setError] = useState('');
  useEffect(()=>{
    if (!session || !value) return;
    const abort = new AbortController();
    runtimeRequest<Source[]>(session,'/scenario-sources',abort.signal).then(setSources).catch(e=>{
      if(!abort.signal.aborted)setError((e as Error).message);
    });
    return ()=>abort.abort();
  },[session,Boolean(value)]);
  const enabled = people.filter(p=>p.enabled);
  function audience(selected:string[],change:(ids:string[])=>void){return <div className="runtime-command-row">
    {enabled.map(p=><label className="academy-check" key={p.id}><input type="checkbox" checked={selected.includes(p.id)}
      onChange={e=>change(e.target.checked?[...selected,p.id]:selected.filter(id=>id!==p.id))}/>{p.name}</label>)}
  </div>;}
  return <section aria-label="自主社会演化准备">
    <h2>自主社会演化</h2>
    {!available && <p>此工作区尚未启用完整历史与分叉，请先准备支持该能力的开发副本；不会自动升级已有数据。</p>}
    <label className="academy-check"><input type="checkbox" disabled={!available} checked={Boolean(value)} onChange={e=>onChange(e.target.checked?{
      contract_version:'social-domain-v2',start_time:'',author_intent:'',cards:[],opening:null,initial_plans:{},
    }:undefined)}/>为这条新世界线启用持续计划、交往与社会认知</label>
    <p>保存后仍暂停、模型关闭。无模型规则只验证机制；真实自主演化需另行启用模型和额度。</p>
    {value && <>
      <label>已确认的起点、时期与时间依据<input aria-label="社会演化起点" maxLength={300} value={value.start_time}
        placeholder="如：学院秋季学期首日放学后；逻辑tick不自动换算日期" onChange={e=>onChange({...value,start_time:e.target.value})}/></label>
      <label>作者探索意图（不作为角色知识或强制剧情）<textarea maxLength={1200} value={value.author_intent}
        onChange={e=>onChange({...value,author_intent:e.target.value})}/></label>
      <h3>本次纳入的前情、设定与关系</h3>
      <p>逐条确认内容和谁知道。未选择的资料不会进入角色上下文；规则说明仅作参考，硬规则仍须在下方核对。</p>
      {error && <p role="alert">来源列表读取失败：{error}</p>}
      {value.cards.map((card,i)=>{
        const update=(patch:Partial<Card>)=>onChange({...value,cards:value.cards.map((c,j)=>j===i?{...c,...patch}:c)});
        return <fieldset key={i}><legend>输入 {i+1}</legend>
          <label>类型<select value={card.category} onChange={e=>update({category:e.target.value})}>
            <option value="prior">前情</option><option value="lore">世界设定</option><option value="relationship">关系</option>
            <option value="period">时期与文化</option><option value="rule_reference">规则说明</option>
          </select></label>
          <label>来源（可选；正文不自动等同事实）<select value={card.source_id?`${card.source_kind}:${card.source_id}:${card.source_version}`:''}
            onChange={e=>{const s=sources.find(s=>`${s.kind}:${s.id}:${s.version}`===e.target.value);
              update({source_kind:s?.kind,source_id:s?.id,source_version:s?.version});}}>
            <option value="">本次手工确认</option>{sources.map(s=><option key={`${s.kind}:${s.id}:${s.version}`} value={`${s.kind}:${s.id}:${s.version}`}>
              {s.label} · {s.kind} · v{s.version}</option>)}
          </select></label>
          <label>在起点的适用性<select value={card.at_start} onChange={e=>update({at_start:e.target.value,...(['future','excluded'].includes(e.target.value)?{audience:[]}: {})})}>
            <option value="effective">当前有效</option><option value="past">已发生的前情</option><option value="future">未来（仅作者参考）</option><option value="excluded">排除（仅保留选择说明）</option>
          </select></label>
          <label>本次确认的内容／解释<textarea aria-label={`社会输入${i+1}`} maxLength={2000} value={card.text} onChange={e=>update({text:e.target.value})}/></label>
          {!['future','excluded'].includes(card.at_start) && <><span>明确知道此信息的角色</span>{audience(card.audience,ids=>update({audience:ids}))}</>}
          <button type="button" onClick={()=>onChange({...value,cards:value.cards.filter((_,j)=>i!==j)})}>移除此输入</button>
        </fieldset>;
      })}
      <button type="button" disabled={value.cards.length>=16} onClick={()=>onChange({...value,cards:[...value.cards,{category:'prior',text:'',audience:[],at_start:'effective'}]})}>添加相关输入</button>
      <h3>开场／引子（可选）</h3>
      <label>开场类型<select aria-label="开场类型" value={value.opening?.kind||''} onChange={e=>onChange({...value,opening:e.target.value?{
        kind:e.target.value,text:'',place_id:places[0]?.id||'',audience:[],due_tick:0,
      }:null})}><option value="">不给开场，从现状自主行动</option><option value="initial">已确认的初始情境</option><option value="private">单个角色的私有线索</option><option value="event">指定tick在场者可知的事件</option></select></label>
      {value.opening && <>
        <label>开场内容（不预定他人行动或结局）<textarea aria-label="开场内容" maxLength={1500} value={value.opening.text} onChange={e=>onChange({...value,opening:{...value.opening!,text:e.target.value}})}/></label>
        <label>发生地点<select value={value.opening.place_id} onChange={e=>onChange({...value,opening:{...value.opening!,place_id:e.target.value}})}>{places.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        {value.opening.kind==='event' && <label>事件到期tick<input type="number" min={0} value={value.opening.due_tick} onChange={e=>onChange({...value,opening:{...value.opening!,due_tick:Number(e.target.value)}})}/></label>}
        <span>接收者（初始情境须在该地点；私有线索仅选一人）</span>{audience(value.opening.audience,ids=>onChange({...value,opening:{...value.opening!,audience:ids}}))}
      </>}
      <h3>持续计划（可选）</h3>
      {enabled.map(p=>{
        const plan=value.initial_plans[p.id]?.[0];
        const update=(patch:Partial<NonNullable<typeof plan>>)=>onChange({...value,initial_plans:{...value.initial_plans,[p.id]:[{...plan!,...patch}]}});
        return <details key={p.id}><summary>{p.name} · {plan?'已设初始计划':'依据当前目标自行计划'}</summary>
          <label className="academy-check"><input type="checkbox" checked={Boolean(plan)} onChange={e=>onChange({...value,initial_plans:{...value.initial_plans,[p.id]:e.target.checked?[{
            id:'initial',next_step:'',target_id:null,due_tick:null,completion:'',abandon:'',status:'active',
          }]:[]}})}/>指定一条初始计划</label>
          {plan && <><label>下一步<input value={plan.next_step} maxLength={600} onChange={e=>update({next_step:e.target.value})}/></label>
            <label>相关角色<select value={plan.target_id||''} onChange={e=>update({target_id:e.target.value||null})}><option value="">无指定对象</option>{enabled.filter(a=>a.id!==p.id).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
            <label>完成条件<input value={plan.completion} maxLength={400} onChange={e=>update({completion:e.target.value})}/></label>
            <label>放弃／改计划条件<input value={plan.abandon} maxLength={400} onChange={e=>update({abandon:e.target.value})}/></label>
            <label>检查tick（可留空）<input type="number" min={0} value={plan.due_tick??''} onChange={e=>update({due_tick:e.target.value?Number(e.target.value):null})}/></label>
          </>}
        </details>;
      })}
      <details><summary>确认各角色将实际获得什么（无模型预览）</summary>{enabled.map(p=><article key={p.id}>
        <h4>{p.name}</h4><p>起点：{value.start_time||'待填写'}；所在地：{places.find(v=>v.id===p.location)?.name||p.location}</p>
        <p>人设：{p.persona}；目标：{p.goal}</p><p>已知：{p.knowledge?.filter(Boolean).join('；')||'无额外信息'}；暂定信念：{p.beliefs?.filter(Boolean).join('；')||'无'}</p>
        {value.cards.filter(c=>c.audience.includes(p.id)).map((c,i)=><p key={i}>[{cardNames[c.category]} / {cardNames[c.at_start]}] {c.text}</p>)}
        {value.opening?.audience.includes(p.id) && <p>引子：{value.opening.text}{value.opening.kind==='event'?'（届时仍在场才可获知）':''}</p>}
        {value.initial_plans[p.id]?.map(plan=><p key={plan.id}>计划：{plan.next_step}；完成：{plan.completion}；放弃：{plan.abandon}</p>)}
      </article>)}</details>
    </>}
  </section>;
}
