import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { runtimeRequest, type HostSession } from './api';

export interface ObservationNote {filename:string;markdown:string}
export function downloadObservation(note:ObservationNote) {
  const url=URL.createObjectURL(new Blob([note.markdown],{type:'text/markdown;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url;link.download=note.filename;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function RuntimeObservationExport({session,world,line,seq,eventOptions,connected}:{session:HostSession;world:string;line:string;seq:number;eventOptions:{seq:number;label:string;logicalTick?:number;actionType?:string}[];connected:boolean}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[note,setNote]=useState<{key:string;value:ObservationNote}>();
  const [capturing,setCapturing]=useState(false),[saved,setSaved]=useState<{id:string;title:string}>(),[title,setTitle]=useState(`第${seq}步观察`),[draft,setDraft]=useState(''),[tags,setTags]=useState(''),[selectedSeqs,setSelectedSeqs]=useState<number[]>([seq]);
  const key=`${session.viewer_scope}:${line}:${seq}`,current=useRef(key),request=useRef<AbortController|null>(null);
  current.current=key;
  useEffect(()=>{setNote(undefined);setSaved(undefined);setError('');setBusy(false);setTitle(`第${seq}步观察`);setDraft('');setTags('');setSelectedSeqs([seq]);return()=>request.current?.abort();},[key,seq]);
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
      const value=await runtimeRequest<{id:string;title:string}>(session,`/worldlines/${encodeURIComponent(line)}/inspirations`,undefined,'POST',{seq:selectedSeqs[0],seqs:selectedSeqs,title:title.trim(),note:draft,tags:tags.split(/[，,]/).map(value=>value.trim()).filter(Boolean)});
      setSaved(value);setCapturing(false);
    } catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  }
  return <>
    <Button disabled={!connected||busy} onClick={()=>void prepare()}>{busy?'正在读取已保存记录…':'整理为观察笔记'}</Button>
    <Button disabled={!connected||busy} onClick={()=>{setError('');setCapturing(true);}}>保存为灵感</Button>
    {error&&<ErrorNotice>{error}</ErrorNotice>}
    {note?.key===key&&<section aria-label="观察笔记导出"><p>保留来源的创作笔记，不写入正式设定。</p><Button onClick={()=>downloadObservation(note.value)}>下载 Markdown 笔记</Button></section>}
    {saved&&<p role="status">灵感已保存。<Link className="text-link" to={`/worlds/${world}/inspirations?id=${saved.id}`}>打开「{saved.title}」</Link></p>}
    {capturing&&<Dialog title="保存为灵感" busy={busy} onClose={()=>setCapturing(false)}>
      <p className="dialog-intro">来源会固定到当前世界线已选择的 {selectedSeqs.length} 条已提交记录。保存灵感不会写入Canon，也不会修改Runtime事件。</p>
      {eventOptions.length>1&&<fieldset className="runtime-inspiration-events"><legend>来源核对摘要 · 世界线 {line}</legend>{eventOptions.map(event=><label key={event.seq}><input type="checkbox" checked={selectedSeqs.includes(event.seq)} onChange={change=>setSelectedSeqs(current=>change.target.checked?[...current,event.seq]:current.filter(value=>value!==event.seq))}/><span>第{event.seq}步 · 逻辑时刻 {event.logicalTick ?? '未知'} · {event.actionType || '事件'} · {event.label}</span></label>)}</fieldset>}
      <label className="field"><span>标题</span><input maxLength={160} value={title} onChange={event=>setTitle(event.target.value)}/></label>
      <label className="field"><span>创作笔记</span><textarea maxLength={20000} rows={7} value={draft} onChange={event=>setDraft(event.target.value)} placeholder="记录值得保留的情境、疑问或改编方向…"/></label>
      <label className="field"><span>标签（逗号分隔）</span><input maxLength={800} value={tags} onChange={event=>setTags(event.target.value)} placeholder="例如：关系转折，港口，待改写"/></label>
      <div className="dialog-actions"><Button variant="ghost" disabled={busy} onClick={()=>setCapturing(false)}>取消</Button><Button variant="primary" disabled={busy||!title.trim()||!selectedSeqs.length} onClick={()=>void saveInspiration()}>保存灵感</Button></div>
    </Dialog>}
  </>;
}
