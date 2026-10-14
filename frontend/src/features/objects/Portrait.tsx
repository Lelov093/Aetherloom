import {useState} from 'react';
import {UserRound,ImagePlus} from 'lucide-react';
import {Button,Dialog,ErrorNotice} from '../../components/ui';
import {FilePicker} from '../../components/FormControls';
import {request} from '../creation/api';
import { useDisplayImages, notifyImageChanged } from './DisplayImages';

export function usePortraits(world:string){
 const {images:portraits}=useDisplayImages(world,'entity');
 async function reload(){notifyImageChanged(world,'entity')}
 return {portraits,reload};
}
export function Portrait({id,name,version,size='normal'}:{id:string;name:string;version?:number;size?:'normal'|'large'|'small'}){
 return <span className={`character-portrait character-portrait--${size}`}>{version?<img src={`/api/entities/${id}/portrait?v=${version}`} alt={`${name}的头像`}/>:<UserRound aria-hidden size={size==='small'?16:24}/>}</span>;
}
export function PortraitEditor({id,name,world,onSaved,onClose}:{id:string;name:string;world:string;onSaved:()=>void;onClose:()=>void}){
 const {portraits,reload}=usePortraits(world);const [file,setFile]=useState<File>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 return <Dialog title={`设置${name}的头像`} onClose={onClose} busy={busy}><div className="portrait-preview"><Portrait id={id} name={name} version={portraits[id]} size="large"/><p>头像只用于展示，不确认外貌事实，不改变角色知识或冻结输入。旧记录也使用当前展示头像。</p></div>
 <label className="field"><span>本地头像文件</span><FilePicker aria-label="本地头像文件" disabled={busy} accept="image/png,image/jpeg,image/webp" onChange={e=>{setFile(e.target.files?.[0]);setError('')}}/></label><p className="context-hint">PNG、JPEG 或 WebP；不超过4MB、4096像素。图片保存在本机资料库。</p>{error&&<ErrorNotice>{error}</ErrorNotice>}
 <div className="dialog-actions">{portraits[id]&&<Button disabled={busy} onClick={async()=>{setBusy(true);try{await request(`/entities/${id}/portrait`,{method:'DELETE'});await reload();onSaved()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}>移除头像</Button>}<Button onClick={onClose} disabled={busy}>关闭</Button><Button variant="primary" disabled={busy||!file} onClick={async()=>{if(!file)return;setBusy(true);try{const form=new FormData();form.append('file',file);await request(`/entities/${id}/portrait`,{method:'POST',body:form});onSaved();onClose()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}}><ImagePlus size={16}/>保存头像</Button></div></Dialog>
}
