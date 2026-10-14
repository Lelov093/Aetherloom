import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {Button,ErrorNotice} from '../../components/ui';
import {NumberInput} from '../../components/FormControls';
import {creationApi,type LibraryItem,type ContentNode} from '../creation/api';
import {simApi,type Inputs,type Setup} from './api';
import {ObjectBrowser} from '../objects/ObjectBrowser';

const initial:Setup={expected_revision:1,title:'新的世界线',intent:'',start_label:'',time_basis:'',participants:[],places:[],items:[],records:[],materials:[],rules:[],narrative_guidance:'',unsupported_hard_rules:[],max_steps:12,max_calls:12,budget_yuan:2,confirmed:false};
const toggle=(ids:string[],id:string)=>ids.includes(id)?ids.filter(v=>v!==id):[...ids,id];

export function SimulationSetup({world,onCreated}:{world:string;onCreated:()=>void}){
 const navigate=useNavigate(),[params]=useSearchParams();
 const draftKey=`aetherloom:simulation-draft:${world}`;
 const savedDraft=useRef<Setup|null>((()=>{try{return JSON.parse(sessionStorage.getItem(draftKey)||'null')}catch{return null}})());
 const [inputs,setInputs]=useState<Inputs>(),[data,setData]=useState<Setup>(savedDraft.current?{...savedDraft.current,confirmed:false}:initial),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [prepared,setPrepared]=useState<Awaited<ReturnType<typeof simApi.prepare>>>();
 const errorRef=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(error)errorRef.current?.scrollIntoView({block:'center'})},[error]);
 const [library,setLibrary]=useState<LibraryItem[]>([]),[material,setMaterial]=useState<ContentNode>(),[quote,setQuote]=useState(''),[occurrence,setOccurrence]=useState(0);
 const [purpose,setPurpose]=useState('author_reference'),[receivers,setReceivers]=useState<string[]>([]);
 const [browseMaterial,setBrowseMaterial]=useState(false);
 const [rulePlace,setRulePlace]=useState(''),[ruleItem,setRuleItem]=useState(''),[unsupported,setUnsupported]=useState(data.unsupported_hard_rules.join('\n'));
 useEffect(()=>{let active=true;Promise.all([simApi.inputs(world),creationApi.contentLibrary(world,new URLSearchParams({limit:'100'}))]).then(([i,l])=>{
  if(active){setInputs(i);setLibrary(l.items);if(!savedDraft.current)setData(d=>({...d,expected_revision:i.revision}));}
 }).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[world]);
 useEffect(()=>{const id=params.get('source');if(id)void creationApi.node(id).then(setMaterial).catch(e=>setError(e.message))},[params]);
 useEffect(()=>{if(inputs)try{sessionStorage.setItem(draftKey,JSON.stringify({...data,confirmed:false}))}catch{}},[data,inputs,draftKey]);
 function update(next:Partial<Setup>){setData(d=>({...d,...next,confirmed:false}));setPrepared(undefined);setError('')}
 const entities=inputs?.entities.filter(e=>e.status==='active'&&!e.merged_into)||[];
 const name=(id:string)=>entities.find(e=>e.id===id)?.name||id;
 const participantChoices=(ids:string[],change:(v:string[])=>void)=><div className="sim-checks">{data.participants.map(p=><label key={p.entity_id}><input type="checkbox" checked={ids.includes(p.entity_id)} onChange={()=>change(toggle(ids,p.entity_id))}/>{name(p.entity_id)}</label>)}</div>;
 async function check(){setError('');if(data.participants.length<3||data.places.length<1||!data.intent.trim()||!data.start_label.trim()||!data.time_basis.trim()||data.participants.some(p=>!p.goal.trim())){setError('请至少选择3名角色与1个地点，填写模拟意图、起点及确认依据，并为每位角色设定目标。');return}setBusy(true);try{setPrepared(await simApi.prepare(world,data))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 async function create(){setBusy(true);try{const s=await simApi.create(world,data);sessionStorage.removeItem(draftKey);onCreated();navigate(`/worlds/${world}/simulate?session=${s.id}`)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const matches:number[]=[];if(material?.plain_text&&quote){let p=material.plain_text.indexOf(quote);while(p>=0){matches.push(p);p=material.plain_text.indexOf(quote,p+1)}}
 async function addMaterial(){if(!material?.plain_text)return;let start=0,end=material.plain_text.length;
  if(purpose==='agent_knowledge'&&!receivers.length){setError('请选择至少一位明确获知这份资料的角色。');return}
  if(quote){if(matches[occurrence]===undefined){setError('引用片段不在资料中，请选择准确的原文位置。');return}start=matches[occurrence];end=start+quote.length}
  start=Array.from(material.plain_text.slice(0,start)).length;end=Array.from(material.plain_text.slice(0,end)).length;
  update({materials:[...data.materials,{node_id:material.id,version:material.version,start,end,purpose,known_by:purpose==='agent_knowledge'?receivers:[]}]});setQuote('');setReceivers([]);
 }
 if(!inputs)return <section><ErrorNotice>{error||'正在读取正式资料…'}</ErrorNotice><Button onClick={()=>navigate(0)}>重新载入</Button></section>;
 return <section className="sim-setup"><h2>准备本次场景</h2><p>只准备这次模拟需要的信息。未选资料、作者计划和未审阅候选不会自动成为世界事实。<Link to={`/worlds/${world}/create/objects`}>整理人物与地点 →</Link></p>
 {error&&<div ref={errorRef}><ErrorNotice>{error}</ErrorNotice></div>}<Button onClick={async()=>{try{const i=await simApi.inputs(world);setInputs(i);update({expected_revision:i.revision})}catch(e){setError((e as Error).message)}}}>重新读取当前 Canon 基线</Button>
 <div className="sim-fields">
  <label className="field"><span>世界线名称</span><input value={data.title} onChange={e=>update({title:e.target.value})}/></label>
  <label className="field"><span>模拟意图（作者参考）</span><textarea value={data.intent} onChange={e=>update({intent:e.target.value})}/></label>
  <label className="field"><span>世界时间／状态起点</span><input placeholder="例如：集会开始前，信使刚到港口" value={data.start_label} onChange={e=>update({start_label:e.target.value})}/></label>
  <label className="field"><span>起点确认依据</span><textarea placeholder="说明本次事实在此时是否成立；正文位置不自动等于世界时间" value={data.time_basis} onChange={e=>update({time_basis:e.target.value})}/></label>
 </div>
 <fieldset><legend>场景地点（1–5 个）</legend><div className="sim-checks">{entities.filter(e=>e.kind==='location').map(e=><label key={e.id}><input type="checkbox" checked={data.places.some(p=>p.entity_id===e.id)} onChange={()=>update({places:data.places.some(p=>p.entity_id===e.id)?data.places.filter(p=>p.entity_id!==e.id):[...data.places,{entity_id:e.id,version:e.version,public_description:'',neighbors:[]}]})}/>{e.name}</label>)}</div>
 {data.places.map((p,index)=><div className="sim-card" key={p.entity_id}><h3>{name(p.entity_id)}</h3><label className="field"><span>在此处可观察的环境</span><textarea value={p.public_description} onChange={e=>update({places:data.places.map((v,i)=>i===index?{...v,public_description:e.target.value}:v)})}/></label><span>可从这里前往</span><div className="sim-checks">{data.places.filter(v=>v.entity_id!==p.entity_id).map(v=><label key={v.entity_id}><input type="checkbox" checked={p.neighbors.includes(v.entity_id)} onChange={()=>update({places:data.places.map((entry,i)=>i===index?{...entry,neighbors:toggle(p.neighbors,v.entity_id)}:entry)})}/>{name(v.entity_id)}</label>)}</div></div>)}
 </fieldset>
 <fieldset><legend>参与角色（3–8 名）</legend><div className="sim-checks">{entities.filter(e=>e.kind==='character').map(e=><label key={e.id}><input type="checkbox" checked={data.participants.some(p=>p.entity_id===e.id)} onChange={()=>update({participants:data.participants.some(p=>p.entity_id===e.id)?data.participants.filter(p=>p.entity_id!==e.id):[...data.participants,{entity_id:e.id,version:e.version,location_id:data.places[0]?.entity_id||'',persona:'',goal:'',beliefs:[]}]})}/>{e.name}</label>)}</div>
 {data.participants.map((p,index)=><div className="sim-card" key={p.entity_id}><h3>{name(p.entity_id)}</h3><div className="sim-fields">
  <label className="field"><span>{name(p.entity_id)}的初始地点</span><select value={p.location_id} onChange={e=>update({participants:data.participants.map((v,i)=>i===index?{...v,location_id:e.target.value}:v)})}><option value="">选择地点</option>{data.places.map(v=><option key={v.entity_id} value={v.entity_id}>{name(v.entity_id)}</option>)}</select></label>
  <label className="field"><span>{name(p.entity_id)}的目标</span><textarea value={p.goal} onChange={e=>update({participants:data.participants.map((v,i)=>i===index?{...v,goal:e.target.value}:v)})}/></label>
  <label className="field"><span>角色自身可用的性格／背景</span><textarea placeholder="只写该角色可使用的信息，不自动复制全部作者秘密" value={p.persona} onChange={e=>update({participants:data.participants.map((v,i)=>i===index?{...v,persona:e.target.value}:v)})}/></label>
  <label className="field"><span>角色信念（可能错误，每行一条）</span><textarea value={p.beliefs.join('\n')} onChange={e=>update({participants:data.participants.map((v,i)=>i===index?{...v,beliefs:e.target.value.split('\n').filter(Boolean)}:v)})}/></label>
 </div><details><summary>参考现有角色资料（不会自动发送）</summary>{Object.entries(entities.find(e=>e.id===p.entity_id)?.core||{}).map(([key,value])=><p key={key}>{key}：{value}</p>)}</details></div>)}
 </fieldset>
 <fieldset><legend>相关正式记录与知识边界</legend><p>逐项确认起点语义；“过去”表示历史经历，“有效”表示起点仍成立。未来／排除记录不会进入任何角色上下文。</p>
 {(['assertion','event','relationship'] as const).map(kind=>(inputs[{assertion:'assertions',event:'events',relationship:'relationship_states'}[kind] as 'assertions'|'events'|'relationship_states']).map(r=>{
  const selected=data.records.find(v=>v.id===r.id&&v.kind===kind);return <div className="sim-record" key={r.id}><label><input type="checkbox" checked={!!selected} onChange={()=>update({records:selected?data.records.filter(v=>v!==selected):[...data.records,{id:r.id,kind,version:r.version,at_start:'excluded',reason:'用户明确选择本次起点语义',known_by:[]}]})}/>{r.subject_id&&`${name(r.subject_id)} · `}{r.title||r.label||`${r.predicate}：${r.value}`}</label><small>{r.status} · {r.valid_from||'起始未知'} → {r.valid_until||'结束未知'}</small>
   {selected&&<><label className="field"><span>起点语义</span><select value={selected.at_start} onChange={e=>update({records:data.records.map(v=>v===selected?{...v,at_start:e.target.value,known_by:[]}:v)})}><option value="excluded">本次排除</option><option value="effective">起点仍有效</option><option value="past">过去已发生／已结束</option><option value="future">起点之后才发生</option></select></label><label className="field"><span>确认／消歧依据</span><input value={selected.reason} onChange={e=>update({records:data.records.map(v=>v===selected?{...v,reason:e.target.value}:v)})}/></label>{['effective','past'].includes(selected.at_start)&&<><span>哪些角色已经知道</span>{participantChoices(selected.known_by,known_by=>update({records:data.records.map(v=>v===selected?{...v,known_by}:v)}))}</>}</>}
  </div>;
 }))}</fieldset>
 <fieldset><legend>资料与准确来源（可选）</legend><label className="field"><span>选择近期资料</span><select value={material?.id||''} onChange={e=>{setQuote('');if(!e.target.value){setMaterial(undefined);return}void creationApi.node(e.target.value).then(setMaterial).catch(e=>setError(e.message))}}><option value="">选择已有资料</option>{library.map(v=><option key={v.id} value={v.id}>{v.work_title} / {v.title}</option>)}</select></label><Button onClick={()=>setBrowseMaterial(true)}>查找全部资料</Button>
 {material&&<><p>{material.title} · v{material.version} <Link to={`/worlds/${world}/create?work=${material.work_id}&node=${material.id}&mode=read`}>阅读资料 →</Link></p><label className="field"><span>引用原文片段（留空引用全文）</span><textarea value={quote} onChange={e=>{setQuote(e.target.value);setOccurrence(0)}}/></label>{matches.length>1&&<label className="field"><span>同文片段出现位置</span><select value={occurrence} onChange={e=>setOccurrence(Number(e.target.value))}>{matches.map((p,i)=><option key={p} value={i}>第{i+1}处：{material.plain_text?.slice(Math.max(0,p-20),p+quote.length+20)}</option>)}</select></label>}<label className="field"><span>资料用途</span><select value={purpose} onChange={e=>setPurpose(e.target.value)}><option value="author_reference">作者参考（不进入角色知识）</option><option value="agent_knowledge">明确给角色的已知资料</option></select></label>{purpose==='agent_knowledge'&&participantChoices(receivers,setReceivers)}<Button onClick={addMaterial}>关联本次资料</Button></>}
 {data.materials.map((v,i)=><div className="sim-row" key={i}><span>{library.find(n=>n.id===v.node_id)?.title||material?.title||'保存的资料'} · v{v.version} · {v.purpose==='author_reference'?'作者参考':'角色已知资料'}</span><Button onClick={()=>update({materials:data.materials.filter((_,j)=>i!==j)})}>移除</Button></div>)}
 </fieldset>
 <fieldset><legend>物品与规则</legend>{entities.filter(e=>e.kind==='item').map(e=>{const item=data.items.find(v=>v.entity_id===e.id);return <div className="sim-row" key={e.id}><label><input type="checkbox" checked={!!item} onChange={()=>update({items:item?data.items.filter(v=>v!==item):[...data.items,{entity_id:e.id,version:e.version,holder_id:data.places[0]?.entity_id||''}]})}/>{e.name}</label>{item&&<label className="field"><span>{e.name}的初始持有者／所在地点</span><select value={item.holder_id} onChange={e=>update({items:data.items.map(v=>v===item?{...v,holder_id:e.target.value}:v)})}><option value="">请选择</option>{[...data.participants,...data.places].map(p=><option key={p.entity_id} value={p.entity_id}>{name(p.entity_id)}</option>)}</select></label>}</div>})}
 <p>机制固定检查地点连通、交互范围和物品归属。可额外配置“持有所需物品才能进入地点”。</p><div className="sim-row"><label className="field"><span>受限制地点</span><select value={rulePlace} onChange={e=>setRulePlace(e.target.value)}><option value="">选择地点</option>{data.places.map(p=><option key={p.entity_id} value={p.entity_id}>{name(p.entity_id)}</option>)}</select></label><label className="field"><span>所需物品</span><select value={ruleItem} onChange={e=>setRuleItem(e.target.value)}><option value="">选择物品</option>{data.items.map(p=><option key={p.entity_id} value={p.entity_id}>{name(p.entity_id)}</option>)}</select></label><Button disabled={!rulePlace||!ruleItem} onClick={()=>update({rules:[...data.rules,{type:'requires_item',destination_id:rulePlace,item_id:ruleItem}]})}>添加进入条件</Button></div>
 {data.rules.map((r,i)=><div className="sim-row" key={i}><span>进入{name(r.destination_id)}需持有{name(r.item_id)}</span><Button onClick={()=>update({rules:data.rules.filter((_,j)=>j!==i)})}>移除条件</Button></div>)}
 <label className="field"><span>叙事指导（作者参考，不作为硬约束）</span><textarea value={data.narrative_guidance} onChange={e=>update({narrative_guidance:e.target.value})}/></label>
 <label className="field"><span>本次仍必需、但上述机制不支持的硬规则</span><textarea placeholder="有此类规则则先阻止启动；留空表示上述机制足够" value={unsupported} onChange={e=>{setUnsupported(e.target.value);update({unsupported_hard_rules:e.target.value.split('\n').filter(Boolean)})}}/></label>
 </fieldset>
 <fieldset><legend>本段运行额度</legend><div className="sim-fields"><label className="field"><span>最多行动步数</span><NumberInput aria-label="最多行动步数" min="1" max="120" value={data.max_steps} onValueChange={value=>update({max_steps:Number(value)})}/></label><label className="field"><span>最多模型请求（包含失败）</span><NumberInput aria-label="最多模型请求（包含失败）" min="1" max="48" value={data.max_calls} onValueChange={value=>update({max_calls:Number(value)})}/></label><label className="field"><span>费用预算（元）</span><NumberInput aria-label="费用预算（元）" min="0.1" step="0.1" max="10" value={data.budget_yuan} onValueChange={value=>update({budget_yuan:Number(value)})}/></label></div><p>当前本地数据库累计最多48次／¥10；不足时暂停。创建世界线不调用模型，显式继续后才开始计费。</p></fieldset>
 <Button disabled={busy} onClick={check}>核对本次准备</Button>
 {prepared&&<section className="sim-card"><h3>{prepared.errors.length?'仍需处理':'本次准备可用'}</h3>{prepared.errors.map(v=><ErrorNotice key={v}>{v}</ErrorNotice>)}{prepared.warnings.map(v=><p key={v}>{v}</p>)}<details open><summary>核对每位角色实际获得的信息</summary>{Object.entries(prepared.initial_state.agents).map(([id,a])=><div key={id}><h4>{name(id)} · {name(a.location)}</h4><p>目标：{a.goal}</p><p>自身背景：{a.persona||'未填写'}；信念：{a.beliefs.join('；')||'无'}</p><p>已知记录：{Object.keys(a.known).map(k=>{const r=[...inputs.assertions,...inputs.events,...inputs.relationship_states].find(v=>v.id===k);return r?.title||r?.label||r?.value||'已明确关联的资料片段'}).join('；')||'无'}。其他资料保持未知。</p></div>)}</details>
 {!prepared.errors.length&&<><label className="sim-confirm"><input type="checkbox" checked={data.confirmed} onChange={e=>setData({...data,confirmed:e.target.checked})}/>我已核对起点、初始状态、规则与各角色知识；确认冻结本次输入。</label><Button variant="primary" disabled={busy||!data.confirmed} onClick={create}>创建并保存世界线</Button></>}
 </section>}
 {browseMaterial&&<ObjectBrowser world={world} title="选择本次模拟资料" types={['content']} onClose={()=>setBrowseMaterial(false)} onPick={async object=>{try{setMaterial(await creationApi.node(object.id));setQuote('');setBrowseMaterial(false)}catch(e){setError((e as Error).message)}}}/>}
 </section>;
}
