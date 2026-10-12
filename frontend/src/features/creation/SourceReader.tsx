import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button, ErrorNotice } from '../../components/ui';
import { request } from './api';
import { ImportSources } from './ImportSources';
import { materialCategories, materialTags } from './MaterialClassification';
import type { MaterialSource } from './MaterialSources';

type Snapshot = MaterialSource & {text:string;metadata:Record<string,string>};
export function SourceReader({world}:{world:string}) {
  const {sourceId} = useParams(), [params] = useSearchParams();
  const [source,setSource] = useState<Snapshot>(), [error,setError] = useState(''), [retry,setRetry] = useState(0);
  const mark = useRef<HTMLElement>(null);
  const query = params.toString();
  useEffect(()=>{let alive=true;setSource(undefined);setError('');
    request<Snapshot>(params.has('simulation') ? `/worlds/${world}/simulation-material?${query}` : sourceId ? `/worlds/${world}/material-sources/${sourceId}` : `/worlds/${world}/material-mention?${query}`)
      .then(s=>{if(alive)setSource(s);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};
  },[world,sourceId,query,retry]);
  useEffect(()=>{if(source)mark.current?.scrollIntoView({block:'center'});},[source]);
  const chars = Array.from(source?.text || '');
  return <main id="main-content" className="page source-reader">
    <span className="eyebrow">SAVED MATERIAL SOURCE</span>
    {error&&<><ErrorNotice>{error}</ErrorNotice><Button onClick={()=>setRetry(v=>v+1)}>重新读取</Button></>}
    {!source&&!error&&<p role="status">正在读取保存的来源版本…</p>}
    {source&&<>
      <h1>{source.title}</h1><p>{source.work_title} · 来源 v{source.source_version} · {source.scope==='fragment'?'明确片段':'整份资料'}</p>
      <p className="context-hint">{materialCategories[source.metadata.material_category || 'unclassified']} · {materialTags(source.metadata).join(' · ') || '无资料标签'}</p>
      <p>{source.note}</p>
      {source.stale&&<p role="status">当前资料已修订为 v{source.current_version}。这里保留的是关联时的原版本；更新来源需重新明确关联。</p>}
      {source.source_archived&&<p>来源已收起；保存的历史原文仍可阅读。</p>}
      {source.status==='removed'&&<p>这条关联已解除，历史来源保留。</p>}
      <div className="canon-row-actions"><Link className="text-link" to={source.target_to}>{source.target_label} →</Link>
        <Link className="text-link" to={`/worlds/${world}/create?work=${source.work_id}&node=${source.node_id}&mode=read`}>打开当前资料 →</Link>
        <Button onClick={()=>mark.current?.scrollIntoView({block:'center'})}>定位来源选区</Button></div>
      <article className="source-reader-text" aria-label="保存的来源原文">
        {chars.slice(0,source.start).join('')}<mark ref={mark} tabIndex={0} aria-label="关联来源选区">{chars.slice(source.start,source.end).join('')}</mark>{chars.slice(source.end).join('')}
      </article>
      {source.metadata.import_batch&&<ImportSources world={world} batch={source.metadata.import_batch} pages={source.metadata.import_source_pages} files={source.metadata.import_files}/>}
    </>}
  </main>;
}
