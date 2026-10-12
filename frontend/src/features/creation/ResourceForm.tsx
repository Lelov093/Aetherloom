import {useState, type FormEvent} from 'react';
import {Button, Dialog, ErrorNotice} from '../../components/ui';

export function ResourceForm({title, initial='', kinds, initialKind, onClose, onSubmit}: {title:string;initial?:string;kinds:Record<string,string>;initialKind?:string;onClose:()=>void;onSubmit:(name:string,kind:string)=>Promise<void>}) {
  const [name,setName]=useState(initial), [kind,setKind]=useState(initialKind || Object.keys(kinds)[0]);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent) { event.preventDefault();setBusy(true);setError('');try {await onSubmit(name,kind);onClose();}catch(e){setError((e as Error).message);}finally{setBusy(false);} }
  return <Dialog title={title} onClose={onClose} busy={busy}><form onSubmit={submit}><label className="field"><span>名称</span><input value={name} onChange={e=>setName(e.target.value)} required maxLength={160}/></label><label className="field"><span>类型</span><select value={kind} onChange={e=>setKind(e.target.value)}>{Object.entries(kinds).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>{error&&<ErrorNotice>{error}</ErrorNotice>}<div className="dialog-actions"><Button variant="ghost" type="button" onClick={onClose} disabled={busy}>取消</Button><Button variant="primary" disabled={busy}>{busy?'正在保存…':'保存'}</Button></div></form></Dialog>;
}
