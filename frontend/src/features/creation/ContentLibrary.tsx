import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, ErrorNotice } from '../../components/ui';
import { creationApi, type LibraryItem, type LibraryPage, type Work } from './api';
import { materialCategories, materialTags } from './MaterialClassification';

export function MaterialRow({world,item}:{world:string;item:LibraryItem}) {
  return <Link className="material-library-row" to={`/worlds/${world}/create?${new URLSearchParams({work:item.work_id,node:item.id,mode:'read'})}`}>
    <div><strong>{item.title}</strong><small>{item.work_title} · {materialCategories[item.metadata.material_category || 'unclassified']}
      {materialTags(item.metadata).length > 0 && ` · ${materialTags(item.metadata).join(' · ')}`}</small>
      {item.excerpt && <p>{item.excerpt}</p>}</div><span>阅读 →</span>
  </Link>;
}

export function ContentLibrary({world,works}:{world:string;works:Work[]}) {
  const [params,setParams] = useSearchParams();
  const q=params.get('q')||'',category=params.get('category')||'',tag=params.get('tag')||'',work=params.get('library_work')||'';
  const offset=Math.max(0,Number(params.get('offset'))||0);
  const [page,setPage]=useState<LibraryPage>(),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let alive=true;setPage(undefined);setError('');
    const timer=setTimeout(()=>{
      const query=new URLSearchParams({q,tag,offset:String(offset),...(category?{category}:{}),...(work?{work_id:work}:{})});
      creationApi.contentLibrary(world,query).then(value=>{if(alive)setPage(value);}).catch(e=>{if(alive)setError(e.message);});
    },200);
    return()=>{alive=false;clearTimeout(timer);};
  },[world,q,category,tag,work,offset,retry]);
  function filter(key:string,value:string) {
    const next=new URLSearchParams(params);next.delete('offset');
    if(value)next.set(key,value);else next.delete(key);
    setParams(next,{replace:true});
  }
  function move(value:number) {const next=new URLSearchParams(params);next.set('offset',String(value));setParams(next);}
  return <section className="content-library content-entry-page" aria-label="世界资料列表">
    <span className="eyebrow">WORLD MATERIALS</span><h1>这个世界的创作资料</h1>
    <p className="context-hint">跨作品查找正文、设定和创作计划。分类与标签不改变正式设定；收起的资料可在作品目录中管理与恢复。</p>
    <div className="material-library-filters">
      <label>搜索资料<input aria-label="搜索世界资料" maxLength={200} value={q} placeholder="标题或资料内容…" onChange={e=>filter('q',e.target.value)}/></label>
      <label>作品<select aria-label="筛选资料作品" value={work} onChange={e=>filter('library_work',e.target.value)}><option value="">全部活跃作品</option>{works.filter(w=>w.status==='active').map(w=><option key={w.id} value={w.id}>{w.title}</option>)}</select></label>
      <label>分类<select aria-label="筛选世界资料分类" value={category} onChange={e=>filter('category',e.target.value)}><option value="">全部分类</option>{Object.entries(materialCategories).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>标签<input aria-label="筛选世界资料标签" value={tag} maxLength={80} placeholder="完整标签…" onChange={e=>filter('tag',e.target.value)}/></label>
    </div>
    {(q||category||tag||work)&&<Button variant="ghost" onClick={()=>setParams({view:'library'},{replace:true})}>清除筛选</Button>}
    {error&&<><ErrorNotice>{error}</ErrorNotice><Button onClick={()=>setRetry(v=>v+1)}>重新读取资料</Button></>}
    {!page&&!error&&<p role="status">正在读取资料…</p>}
    {page&&<><p role="status" className="context-hint">共 {page.total} 个目录与资料条目 · 最近修改优先</p>
      {page.items.map(item=><MaterialRow key={item.id} world={world} item={item}/>)}
      {!page.items.length&&<p className="context-hint">{page.total?'当前页已无条目，请返回上一页。':'没有符合条件的活跃资料。可以调整筛选，或在作品中添加、导入内容。'}</p>}
      <div className="material-library-pagination"><Button disabled={!offset} onClick={()=>move(Math.max(0,offset-page.limit))}>上一页</Button>
        <span>{page.total?`${Math.min(offset+1,page.total)}–${Math.min(offset+page.items.length,page.total)} / ${page.total}`:'0 / 0'}</span>
        <Button disabled={offset+page.limit>=page.total} onClick={()=>move(offset+page.limit)}>下一页</Button></div>
    </>}
  </section>;
}
