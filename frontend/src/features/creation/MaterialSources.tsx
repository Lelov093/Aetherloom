import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { ObjectBrowser } from '../objects/ObjectBrowser';
import { creationApi, request, type ContentNode } from './api';

export type MaterialTarget = 'entity' | 'assertion' | 'event' | 'relationship';
export interface MaterialSource {
  id: string; node_id: string; work_id: string; title: string; work_title: string;
  source_version: number; current_version: number; version: number; scope: string;
  start: number; end: number; quote: string; note: string; stale: boolean; status: string;
  source_archived: boolean; target_status: string; target_label: string; target_to: string; to: string;
}
const endpoint = (kind: MaterialTarget, id: string) => `/material-targets/${kind}/${id}/sources`;

export function SourceAttach({ world, kind, identity, onClose, onSaved, initialNode, initialRange }: {
  world: string; kind: MaterialTarget; identity: string; onClose: () => void; onSaved: () => void;
  initialNode?: ContentNode; initialRange?: {start: number; end: number};
}) {
  const [node, setNode] = useState<ContentNode | undefined>(initialNode);
  const [picking, setPicking] = useState(!initialNode), [scope, setScope] = useState(initialRange ? 'fragment' : 'document');
  const [range, setRange] = useState(initialRange), [note, setNote] = useState('');
  const [targetVersion, setTargetVersion] = useState<number>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { let alive = true; request<{target_version: number}>(endpoint(kind, identity))
    .then(r => { if (alive) setTargetVersion(r.target_version); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; }; }, [kind, identity]);
  const text = node?.plain_text || '';
  // Only one modal owns the top layer. A child opened on mount would be covered
  // when its parent subsequently calls showModal().
  if (picking) return <ObjectBrowser world={world} types={['content']} title="选择来源资料"
    onClose={() => {if(node)setPicking(false);else onClose();}} onPick={async item => {
      try {setNode(await creationApi.node(item.id));setRange(undefined);setPicking(false);setError('');}
      catch(e) {setError((e as Error).message);setPicking(false);}
    }}/>;
  return <Dialog title="手工关联资料来源" onClose={onClose} busy={busy}>
    <p className="dialog-intro">保存关联不会提取或确认资料中的事实；世界事实由你另行明确保存。</p>
    <Button disabled={busy} onClick={() => setPicking(true)}>选择来源资料</Button>
    {node && <>
      <p>{node.title} · 已保存 v{node.version}</p>
      <label className="field"><span>关联范围</span><select aria-label="关联范围" value={scope} onChange={e => setScope(e.target.value)}>
        <option value="document">整份资料</option><option value="fragment">明确片段</option></select></label>
      {scope === 'fragment' && <>
        <p className="context-hint">在下面的已保存原文中选择片段；相同文字的不同位置分别记录。</p>
        <textarea className="source-selection" aria-label="来源原文选区" readOnly value={text} rows={9} onSelect={e => {
          const el = e.currentTarget;
          setRange({start: Array.from(text.slice(0, el.selectionStart)).length, end: Array.from(text.slice(0, el.selectionEnd)).length});
        }} />
        <blockquote className="source-snapshot">{range ? Array.from(text).slice(range.start, range.end).join('') : '尚未选择片段'}</blockquote>
      </>}
      <label className="field"><span>关联说明（可选）</span><input value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label>
    </>}
    {error && <ErrorNotice>{error}</ErrorNotice>}
    <div className="dialog-actions"><Button onClick={onClose} disabled={busy}>取消</Button>
      <Button variant="primary" disabled={busy || !node || !targetVersion || (scope === 'fragment' && (!range || range.end <= range.start))} onClick={async () => {
        if (!node) return;
        setBusy(true); setError('');
        try {
          await request(endpoint(kind, identity), {method: 'POST', body: JSON.stringify({node_id: node.id, source_version: node.version,
            target_version: targetVersion, scope, ...(scope === 'fragment' ? range : {}), note})});
          onSaved(); onClose();
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>确认保存关联</Button></div>
  </Dialog>;
}

export function MaterialSources({world, kind, identity, editable = true}: {
  world: string; kind: MaterialTarget; identity: string; editable?: boolean;
}) {
  const [sources, setSources] = useState<MaterialSource[]>(), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [adding, setAdding] = useState(false), [removing, setRemoving] = useState<MaterialSource>(), [busy, setBusy] = useState(false);
  const [simSources,setSimSources]=useState<{id:string;title:string;seq:number}[]>([]);
  useEffect(()=>{let active=true;request<{id:string;title:string;seq:number}[]>(`/simulation-targets/${kind}/${identity}/sources`).then(v=>{if(active)setSimSources(v)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[kind,identity,retry]);
  useEffect(() => { let alive = true; setSources(undefined); setError('');
    request<{sources: MaterialSource[]}>(endpoint(kind, identity)).then(r => { if (alive) setSources(r.sources); })
      .catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [kind, identity, retry]);
  return <section className="material-sources" aria-label="手工资料来源">
    {!!simSources.length&&<section><h3>已接受的模拟来源</h3>{simSources.map(s=><Link key={s.id} className="text-link" to={`/worlds/${world}/review/simulation?proposal=${s.id}`}>{s.title} · 第{s.seq}步 · 查看裁决与保存世界线 →</Link>)}</section>}
    <div className="collection-heading"><h3>手工资料来源</h3>{editable && <Button onClick={() => setAdding(true)}>关联资料</Button>}</div>
    {error && <><ErrorNotice>{error}</ErrorNotice><Button onClick={() => setRetry(v => v + 1)}>重新读取</Button></>}
    {!sources && !error && <p role="status">正在读取关联…</p>}
    {sources?.length === 0 && <p className="context-hint">尚无资料关联。纯手工设定可以保留来源说明，无需补造原文。</p>}
    {sources?.map(s => <div key={s.id} className="material-source-row"><Link className="text-link" to={s.to}>{s.work_title} / {s.title} →</Link>
      <small>来源 v{s.source_version} · {s.scope === 'fragment' ? '片段' : '整份资料'}{s.stale && ' · 当前资料已修订'}{s.source_archived && ' · 来源已收起，历史可读'}</small>
      {s.note && <p>{s.note}</p>}{editable && <Button variant="ghost" onClick={() => setRemoving(s)}>解除关联</Button>}</div>)}
    {adding && <SourceAttach world={world} kind={kind} identity={identity} onClose={() => setAdding(false)} onSaved={() => setRetry(v => v + 1)} />}
    {removing && <Dialog title="解除这条资料关联？" onClose={() => setRemoving(undefined)} busy={busy}>
      <p>仅解除当前关联，资料、正式设定和原来源版本仍保留。</p>{error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions"><Button onClick={() => setRemoving(undefined)} disabled={busy}>取消</Button><Button variant="primary" disabled={busy} onClick={async () => {
        setBusy(true); try { await request(`/material-sources/${removing.id}/remove`, {method:'POST', body:JSON.stringify({version:removing.version})});
          setRemoving(undefined); setRetry(v => v + 1); setError(''); } catch (e) { setError((e as Error).message); } finally {setBusy(false);}
      }}>明确解除关联</Button></div></Dialog>}
  </section>;
}

export function DocumentMaterials({world, node, range, prepare, editable=true}: {world:string;node:ContentNode;range?:{start:number;end:number};prepare:()=>Promise<boolean>;editable?:boolean}) {
  const [sources, setSources] = useState<MaterialSource[]>(), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const [picking, setPicking] = useState(false), [target, setTarget] = useState<{kind:MaterialTarget;id:string}>();
  useEffect(() => { let alive = true; setError(''); setSources(undefined); request<MaterialSource[]>(`/nodes/${node.id}/material-sources`)
    .then(r => {if(alive)setSources(r);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;}; },[node.id,node.version,retry]);
  return <section className="context-section"><h3>手工关联资料</h3>
    {editable&&<Button onClick={async()=>{if(await prepare())setPicking(true);}}>关联到对象 / 事件 / 关系</Button>}
    <p className="context-hint">事实来源可在对象的「世界事实」中关联；关联不确认新事实。</p>
    {error && <><ErrorNotice>{error}</ErrorNotice><Button onClick={()=>setRetry(v=>v+1)}>重新读取</Button></>}
    {!sources&&!error&&<p role="status">正在读取关联…</p>}
    {sources?.length===0&&<p className="context-hint">尚无手工关联。</p>}
    {sources?.map(s=><div className="material-source-row" key={s.id}><Link className="text-link" to={s.target_to}>{s.target_label} →</Link>
      <small>来源 v{s.source_version}{s.stale&&' · 当前资料已修订'}{s.target_status!=='active'&&' · 记录已撤回或收起'}</small>
      <Link className="text-link" to={s.to}>查看原版本与选区 →</Link></div>)}
    {picking&&<ObjectBrowser world={world} types={['entity','event','relationship']} title="选择关联对象或记录" onClose={()=>setPicking(false)} onPick={item=>{
      setPicking(false);setTarget({kind:item.type as MaterialTarget,id:item.id});
    }}/>}
    {target&&<SourceAttach world={world} kind={target.kind} identity={target.id} initialNode={node} initialRange={range} onClose={()=>setTarget(undefined)} onSaved={()=>setRetry(v=>v+1)}/>}
  </section>;
}
