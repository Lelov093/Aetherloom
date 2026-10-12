import {useEffect,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {Button,Dialog,ErrorNotice} from '../../components/ui';
import {creationApi,type Entity} from '../creation/api';
import {CandidateEditor} from '../review/CandidateEditor';
import {proposalTitle,proposalValue} from '../review/api';
import {simApi,type SimPreview} from './api';
import {StateChanges} from './StateChanges';

export function SimulationReview({world}:{world:string}){
 const [params,setParams]=useSearchParams(),id=params.get('proposal');
 const [list,setList]=useState<SimPreview[]>([]),[preview,setPreview]=useState<SimPreview>(),[entities,setEntities]=useState<Entity[]>([]),[error,setError]=useState('');
 const [editing,setEditing]=useState(false),[busy,setBusy]=useState(false),[ack,setAck]=useState(false),[resolution,setResolution]=useState(''),[confirmation,setConfirmation]=useState(false);
 async function load(){const [l,e]=await Promise.all([simApi.review(world),creationApi.entities(world)]);setList(l);setEntities(e);if(id)setPreview(await simApi.preview(id))}
 useEffect(()=>{setPreview(undefined);setAck(false);setResolution('');void load().catch(e=>setError(e.message))},[world,id]);
 const c=preview?.candidate;
 async function decide(action:string){if(!preview)return;setBusy(true);setError('');try{await simApi.decide(preview,action,resolution||null,ack);setConfirmation(false);await load()}catch(e){setError((e as Error).message);setConfirmation(false)}finally{setBusy(false)}}
 return <main id="main-content" className="page simulation-page"><header><span className="eyebrow">REVIEW · 模拟来源</span><h1>审阅世界线结果</h1><p>这里的提案来自独立模拟，未接受前不会改动正式设定。<Link to={`/worlds/${world}/review`}>正文候选审阅 →</Link></p></header>{error&&<ErrorNotice>{error}</ErrorNotice>}
 <div className="sim-layout"><section><h2>模拟提案</h2>{!list.length&&<p>尚无模拟提案。先从世界演化记录选择事件或状态事实。</p>}{list.map(p=><Button key={p.candidate.id} className="sim-proposal" variant={id===p.candidate.id?'primary':'secondary'} onClick={()=>setParams({proposal:p.candidate.id})}>{proposalTitle(p.candidate.payload)} · {({pending:'待审阅',accepted:'已接受',rejected:'已拒绝'} as Record<string,string>)[p.candidate.status]}</Button>)}</section>
 {preview&&c&&<section className="sim-card"><h2>{proposalTitle(c.payload)}</h2><p>{proposalValue(c.payload)}</p><p>{c.payload.description}</p><p>世界线「{preview.source.title}」· 第{preview.source.seq}步 · 基线 Canon {preview.source.baseline_revision} · 当前 Canon {preview.revision}</p><Link className="text-link" to={`/worlds/${world}/simulate?session=${preview.source.simulation_id}`}>回到保存的世界线 →</Link><h3>原始模拟事件</h3><p className="sim-source-text">{preview.source.event.narration}</p><details><summary>本步提交的前后状态</summary><StateChanges diff={preview.source.event.diff} name={id=>entities.find(e=>e.id===id)?.name||'保存的对象'}/></details>
 <h3>当前正式记录与差异</h3>{preview.current.length?preview.current.map((r,i)=><p key={i}>{String(r.title||r.label||r.predicate||'')}：{String(r.value||r.description||'')}</p>):<p>没有同字段／同名正式记录。</p>}{preview.conflicts.length>0&&<ErrorNotice>存在 {preview.conflicts.length} 项正式记录差异，需明确处理方式。</ErrorNotice>}{preview.warnings.map(w=><p key={w}>{w}</p>)}{preview.baseline_stale&&<p>Canon 已不同于模拟冻结基线，请核对当前差异；不会改变旧世界线。</p>}
 {c.status==='pending'?<><label className="field"><span>差异处理方式</span><select value={resolution} onChange={e=>setResolution(e.target.value)}><option value="">选择（有差异时必需）</option><option value="keep_both">明确保留两者</option><option value="replace">替代冲突记录并保留历史</option><option value="temporal">按已确认的不同时间保留</option></select></label><label className="sim-confirm"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>已核对模拟来源、身份、当前 Canon 差异与可能的推断／改写</label><div className="sim-row"><Button onClick={()=>setEditing(true)}>编辑提案</Button><Button disabled={busy} onClick={()=>decide('reject')}>拒绝</Button><Button variant="primary" disabled={busy||!ack||!!preview.dependencies.length} onClick={()=>setConfirmation(true)}>预览接受</Button><Button onClick={()=>{void load().catch(e=>setError(e.message))}}>重新比较</Button></div></>:<p>此提案已经显式{c.status==='accepted'?'接受':'拒绝'}。原始来源仍保留。</p>}
 {c.target_id&&<Link className="text-link" to={c.target_type==='assertion'?`/worlds/${world}/create/objects/${c.payload.subject_ref}?tab=facts&fact=${c.target_id}`:`/worlds/${world}/create/records?event=${c.target_id}`}>查看正式记录与来源 →</Link>}
 </section>}
 </div>
 {editing&&c&&<CandidateEditor candidate={c} entities={entities} candidates={[]} sourceLabel="原始模拟提交来源" onClose={()=>setEditing(false)} onSaved={load} saveOverride={(payload)=>simApi.edit(c,payload)}/>}
 {confirmation&&preview&&<Dialog title="显式接受模拟提案" onClose={()=>setConfirmation(false)} busy={busy}><p>接受后将写入 Working Canon：「{proposalTitle(preview.candidate.payload)}」。旧模拟输入和已提交事件仍保持原样。</p><p>当前 Canon {preview.revision}；{resolution||'无冲突时新增记录'}。</p><Button variant="primary" disabled={busy} onClick={()=>decide('accept')}>确认接受并写入 Canon</Button></Dialog>}
 </main>;
}
