import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import type { Inspiration } from '../creation/api';
import { InspirationObjectPicker, InspirationObjects, type InspirationObject } from '../creation/InspirationObjects';
import { runtimeRequest, type HostSession } from './api';

export interface ObservationNote {filename:string;markdown:string}
export function downloadObservation(note:ObservationNote) {
  const url=URL.createObjectURL(new Blob([note.markdown],{type:'text/markdown;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download=note.filename;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function RuntimeObservationExport({session,world,line,seq,eventOptions,connected}:{session:HostSession;world:string;line:string;seq:number;eventOptions:{seq:number;label:string;logicalTick?:number}[];connected:boolean}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState<{key:string;value:ObservationNote}>();
  const [capturing,setCapturing]=useState(false),[saved,setSaved]=useState<Inspiration>(),[title,setTitle]=useState(`第${seq}步观察`),[draft,setDraft]=useState(''),[tags,setTags]=useState(''),[selectedSeqs,setSelectedSeqs]=useState<number[]>([seq]);
  const [objects, setObjects] = useState<InspirationObject[]>([]);
  const [picking, setPicking] = useState(false);
  const key=`${session.viewer_scope}:${line}:${seq}`,current=useRef(key),request=useRef<AbortController|null>(null);
  current.current=key;
  useEffect(()=>{setNote(undefined);setSaved(undefined);setError('');setBusy(false);setTitle(`第${seq}步观察`);setDraft('');setTags('');setSelectedSeqs([seq]);setObjects([]);setPicking(false);return()=>request.current?.abort();},[key,seq]);
  if(session.role!=='creator_observer')return null;
  async function prepare(){
    const controller=new AbortController();request.current=controller;
    setBusy(true);setError('');
    try {
      const value=await runtimeRequest<ObservationNote>(session,`/worldlines/${encodeURIComponent(line)}/observation-note?seq=${seq}`,controller.signal);
      if(current.current===key&&!controller.signal.aborted)setNote({key,value});
    }
    catch(e){if(current.current===key&&!controller.signal.aborted)setError((e as Error).message);}
    finally{if(current.current===key&&!controller.signal.aborted)setBusy(false);}
  }
  async function saveInspiration(){
    if(!title.trim()||!selectedSeqs.length)return;
    setBusy(true);setError('');
    try {
      const value=await runtimeRequest<Inspiration>(session,`/worldlines/${encodeURIComponent(line)}/inspirations`,undefined,'POST',{
        seq:selectedSeqs[0], seqs:selectedSeqs, title:title.trim(), note:draft,
        tags:tags.split(/[，,]/).map(value=>value.trim()).filter(Boolean), linked_entities:objects.map(object=>object.id),
      });
      setSaved(value);setCapturing(false);
    } catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  return <>
    <Button disabled={!connected||busy} onClick={()=>void prepare()}>{busy?'正在读取已保存记录…':'整理为观察笔记'}</Button>
    <Button disabled={!connected||busy} onClick={()=>{setError('');setCapturing(true);}}>保存为灵感</Button>
    {error&&<ErrorNotice>{error}</ErrorNotice>}
    {note?.key===key&&<section aria-label="观察笔记导出"><Button onClick={()=>downloadObservation(note.value)}>下载 Markdown 笔记</Button></section>}
    {saved && <div>
      <p role="status">灵感已保存{saved.origin_node?.status === 'active' && `至「${saved.origin_node.title}」`}。</p>
      {saved.origin_node?.status === 'active' && <Link className="text-link" to={`/worlds/${world}/create?${new URLSearchParams({
        work: saved.origin_node.work_id, node: saved.origin_node.id, mode: 'read', context: 'inspirations',
      })}`}>回到发起章幕的灵感侧栏</Link>}
      <Link className="text-link" to={`/worlds/${world}/inspirations?id=${saved.id}`}>打开「{saved.title}」</Link>
    </div>}
    {capturing&&<Dialog title="保存为灵感" busy={busy} onClose={()=>setCapturing(false)}>
      <p className="dialog-intro">已选 {selectedSeqs.length} 条提交记录。若从章幕发起，灵感会归到该处。</p>
      {eventOptions.length>1&&<fieldset className="runtime-inspiration-events"><legend>选取已提交记录</legend>{eventOptions.map(event=><label key={event.seq}><input type="checkbox" checked={selectedSeqs.includes(event.seq)} onChange={change=>setSelectedSeqs(current=>change.target.checked?[...current,event.seq]:current.filter(value=>value!==event.seq))}/><span>第{event.seq}步 · 逻辑时刻 {event.logicalTick ?? '未知'} · {event.label}</span></label>)}</fieldset>}
      <label className="field"><span>标题</span><input maxLength={160} value={title} onChange={event=>setTitle(event.target.value)}/></label>
      <InspirationObjects objects={objects} disabled={busy} onChoose={() => setPicking(true)}
        onRemove={id => setObjects(current => current.filter(object => object.id !== id))}/>
      <label className="field"><span>创作笔记</span><textarea maxLength={20000} rows={7} value={draft} onChange={event=>setDraft(event.target.value)} placeholder="记录值得保留的情境、疑问或改编方向…"/></label>
      <label className="field"><span>标签（逗号分隔）</span><input maxLength={800} value={tags} onChange={event=>setTags(event.target.value)} placeholder="例如：关系转折，港口，待改写"/></label>
      <div className="dialog-actions"><Button variant="ghost" disabled={busy} onClick={()=>setCapturing(false)}>取消</Button><Button variant="primary" disabled={busy||!title.trim()||!selectedSeqs.length} onClick={()=>void saveInspiration()}>保存灵感</Button></div>
    </Dialog>}
    {picking && <InspirationObjectPicker world={world} objects={objects} onClose={() => setPicking(false)}
      onPick={object => setObjects(current => [...current, object])}/>}
  </>;
}
