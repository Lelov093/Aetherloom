import { useEffect, useState } from 'react';
import { Archive, ArrowLeft, BookOpen, Check, Feather, Info, Pencil, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Dialog, ErrorNotice, Inspector } from '../../components/ui';
import { WorldHorizon } from '../../components/WorldHorizon';
import { worldApi, type World } from './api';
import { WorldForm } from './WorldForm';
import { workspaceDestination } from '../../app/workspaceResume';
import { creationApi, type ContentSummary, workKinds } from '../creation/api';
import { MaterialRow } from '../creation/ContentLibrary';
import {DisplayImage,useDisplayImages} from '../objects/DisplayImages';

export function WorldHome({ world, onUpdated }: { world: World; onUpdated: (world: World) => void }) {
  const {images:covers}=useDisplayImages(world.id,'work');
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [summary,setSummary] = useState<ContentSummary>(),[summaryError,setSummaryError] = useState(''),[retry,setRetry] = useState(0);
  useEffect(()=>{let alive=true;setSummary(undefined);setSummaryError('');
    if(!world.archived)creationApi.contentSummary(world.id).then(value=>{if(alive)setSummary(value);}).catch(e=>{if(alive)setSummaryError(e.message);});
    return()=>{alive=false;};},[world.id,world.archived,retry]);
  async function changeArchive() {
    setBusy(true); setError('');
    try { onUpdated(await worldApi.update(world, { archived: !world.archived })); setArchiving(false); setNotice(world.archived ? '世界已恢复。' : '世界已归档，资料完整保留。'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const details = <><span className="eyebrow">WORLD INFORMATION</span><h2>{world.name}</h2><span className="context-label"><span className="local-dot" />{world.archived ? '已归档' : 'Working Canon'}</span><dl><dt>创建日期</dt><dd>{new Date(world.created_at).toLocaleDateString('zh-CN')}</dd><dt>最近更新</dt><dd>{new Date(world.updated_at).toLocaleString('zh-CN')}</dd><dt>资料保存</dt><dd>本机</dd></dl><p className="inspector-note">世界资料与正式设定的历史版本分别管理。修改名称和简介不会生成 Canon Revision。</p></>;
  return <main id="main-content" className={`page world-home ${inspecting ? 'with-inspector' : ''}`}>
    <div className="world-home-heading"><Link className="back-link" to={world.archived ? '/?view=archived' : '/'}><ArrowLeft size={16} />我的世界</Link><Button variant="ghost" aria-label="查看世界资料" onClick={() => setInspecting(true)}><Info size={18} />世界资料</Button></div>
    <section className="world-welcome"><WorldHorizon compact /><div className="world-welcome-copy"><span className="eyebrow">{world.archived ? 'A WORLD AT REST' : 'YOUR WORLD, TAKING SHAPE'}</span><h1>{world.name}</h1><p>{world.description || '给这个世界一点时间，也给想象一点空间。'}</p><div className="world-actions">{world.archived ? <Button variant="primary" onClick={changeArchive} disabled={busy}><RotateCcw size={17} />{busy ? '正在恢复…' : '恢复世界'}</Button> : <><Link className="button button--primary" to={`/worlds/${world.id}/create?view=library`}>阅读创作资料</Link><Link className="button button--secondary" to={workspaceDestination(world.id,'create')}>进入创作</Link><Button variant="ghost" onClick={() => setEditing(true)}><Pencil size={16} />编辑世界资料</Button></>}</div></div></section>
    {notice && <p className="save-notice" role="status"><Check size={16} />{notice}</p>}
    {error && !archiving && <ErrorNotice>{error}</ErrorNotice>}
    {world.archived ? <section className="world-journal"><div className="journal-mark"><Feather size={26} strokeWidth={1.2}/></div><div><h2>暂时收起，随时回来。</h2><p>世界资料与历史保留在本机。恢复后可继续阅读和创作。</p></div></section> : <section className="world-content-overview" aria-label="世界内容概览">
      <div className="collection-heading"><h2>资料与正式设定</h2><Link className="text-link" to={`/worlds/${world.id}/create?view=library`}>查看全部资料 →</Link></div>
      {summaryError&&<><ErrorNotice>{summaryError}</ErrorNotice><Button onClick={()=>setRetry(v=>v+1)}>重新读取世界内容</Button></>}
      {!summary&&!summaryError&&<p role="status">正在读取世界内容…</p>}
      {summary&&<>
        <div className="world-content-counts">{[
          ['works','作品',`/worlds/${world.id}/create`],['content','目录与资料',`/worlds/${world.id}/create?view=library`],
          ['entity','世界对象',`/worlds/${world.id}/create/objects`],['assertion','正式事实',`/worlds/${world.id}/create/objects`],
          ['event','正式事件',`/worlds/${world.id}/create/records`],['relationship','关系状态',`/worlds/${world.id}/create/records?tab=relations`],
        ].map(([key,label,to])=><Link key={key} to={to}><strong>{summary.counts[key]}</strong><span>{label}</span></Link>)}</div>
        <p className="context-hint">统计当前活跃资料与正式记录；不是某个故事时刻的世界状态。待审阅提案不计为正式设定。</p>
        <div className="world-content-columns"><section><h3>作品</h3>{summary.works.map(w=><Link key={w.id} className="world-work-entry" to={`/worlds/${world.id}/create?work=${w.id}`}><DisplayImage owner="work" id={w.id} name={w.title} version={covers[w.id]} className="work-entry-cover"/><strong>{w.title}</strong><small>{workKinds[w.kind]} · {w.content_count} 个目录与资料条目</small></Link>)}{!summary.works.length&&<p className="context-hint">还没有作品。进入创作即可导入已有资料，或手工建立内容。</p>}</section>
          <section><h3>最近修改的资料</h3>{summary.recent.map(item=><MaterialRow key={item.id} world={world.id} item={item}/>)}{!summary.recent.length&&<p className="context-hint">已有设定、大纲和正文都可以成为起点。</p>}</section></div>
      </>}
      <div className="availability-note"><BookOpen size={17}/><span>模拟从你确认的起点运行；演化结果经你审阅后，才能进入正式设定。</span><Link className="text-link" to={workspaceDestination(world.id,'simulate')}>准备或查看世界模拟 →</Link></div>
    </section>}
    <div className="world-management"><span>世界管理</span>{!world.archived && <Button variant="ghost" onClick={() => { setError(''); setArchiving(true); }}><Archive size={16} />归档世界</Button>}<Link className="text-link" to="/">返回世界库</Link></div>
    {inspecting && <Inspector onClose={() => setInspecting(false)}>{details}</Inspector>}
    {editing && <WorldForm world={world} onClose={() => setEditing(false)} onSaved={value => { onUpdated(value); setEditing(false); setNotice('世界资料已保存。'); }} />}
    {archiving && <Dialog title="暂时收起这个世界？" onClose={() => setArchiving(false)} busy={busy}><p className="dialog-intro">「{world.name}」会移入已归档世界，资料保留。你可以随时恢复。</p>{error && <ErrorNotice>{error}</ErrorNotice>}<div className="dialog-actions"><Button variant="ghost" onClick={() => setArchiving(false)} disabled={busy}>取消</Button><Button onClick={changeArchive} disabled={busy}><Archive size={16} />{busy ? '正在归档…' : '确认归档'}</Button></div></Dialog>}
  </main>;
}
