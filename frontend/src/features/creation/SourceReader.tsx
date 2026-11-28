import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button, ErrorNotice } from '../../components/ui';
import { creationApi, request, type ContentNode } from './api';
import { ImportSources } from './ImportSources';
import { materialCategories, materialTags } from './MaterialClassification';
import type { MaterialSource } from './MaterialSources';
import { runtimeReviewRequest } from '../runtime/reviewAccess';
import { ObjectBackLink } from './ObjectNavigation';
import { passageUses, type PassageUse } from './narrativeApi';
import { adoptionManuscriptPath, adoptionStateLabel, type InspirationAdoption } from './inspirationAdoptionApi';

type Snapshot = MaterialSource & {text:string;metadata:Record<string,string>;use_kind?:PassageUse;anchor_state?:InspirationAdoption['anchor_state']};
export function SourceReader({world}:{world:string}) {
  const {sourceId} = useParams(), [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [source,setSource] = useState<Snapshot>(), [error,setError] = useState(''), [retry,setRetry] = useState(0);
  const [loading,setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [current, setCurrent] = useState<ContentNode>();
  const [compareError, setCompareError] = useState('');
  const mark = useRef<HTMLElement>(null);
  const query = params.toString();
  const worldline = params.get('worldline');
  const materialIndex = params.get('index');
  const narrative = params.get('narrative') === '1';
  const adoption = params.get('adoption') === '1';
  useEffect(()=>{let alive=true;setLoading(true);setError('');setSource(undefined);setComparing(false);
    const reading = worldline !== null
      ? runtimeReviewRequest<Snapshot>(world, `/worldlines/${encodeURIComponent(worldline)}/materials?${new URLSearchParams({index: materialIndex ?? ''})}`)
      : request<Snapshot>(params.has('simulation') ? `/worlds/${world}/simulation-material?${query}`
        : sourceId ? `/worlds/${world}/${adoption ? 'inspiration-adoptions' : narrative ? 'narrative-sources' : 'material-sources'}/${sourceId}`
          : `/worlds/${world}/material-mention?${query}`);
    reading
      .then(s=>{if(alive)setSource(s);}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};
  },[world,sourceId,query,worldline,materialIndex,narrative,adoption,retry]);
  const manualSource = sourceId && worldline === null && !params.has('simulation');
  const compareNodeId = comparing && manualSource ? source?.node_id : undefined;
  useEffect(() => {
    setCurrent(undefined);
    setCompareError('');
    if (!compareNodeId) return;
    let active = true;
    creationApi.node(compareNodeId).then(value => {
      if (active) setCurrent(value);
    }).catch(error => {
      if (active) setCompareError(error.message);
    });
    return () => { active = false; };
  }, [compareNodeId]);
  const scrollBlock = worldline === null ? 'center' : 'start';
  useEffect(()=>{
    if (source && (worldline === null || source.start > 0)) {
      mark.current?.scrollIntoView({block: comparing ? 'nearest' : scrollBlock});
    }
  },[source,worldline,scrollBlock,comparing]);
  const chars = Array.from(source?.text || '');
  const frozen = source && <article className="source-reader-text" aria-label="保存的来源原文">
    {chars.slice(0,source.start).join('')}<mark ref={mark} tabIndex={0} aria-label="关联来源选区">{chars.slice(source.start,source.end).join('')}</mark>{chars.slice(source.end).join('')}
  </article>;
  const returnParams = new URLSearchParams();
  if (worldline !== null) {
    const seq = params.get('seq');
    if (seq !== null && /^\d+$/.test(seq)) returnParams.set('seq', seq);
    if (params.get('view') === '2d') returnParams.set('view', '2d');
  }
  return <main id="main-content" className="page source-reader">
    <span className="eyebrow">{adoption ? '采用时的正文选段' : narrative ? '叙事选段' : 'SAVED MATERIAL SOURCE'}</span>
    {location.state?.exploreWorld === world && <div className="canon-row-actions"><Button variant="ghost" onClick={() => navigate(-1)}><ArrowLeft size={15}/>返回探索</Button></div>}
    {error&&<><ErrorNotice>{error}</ErrorNotice><Button onClick={()=>setRetry(v=>v+1)}>重新读取</Button></>}
    {loading&&<p role="status">正在读取保存的来源版本…</p>}
    {source&&<div aria-busy={loading} inert={loading || !!error}>
      <h1>{source.title}</h1><p>{source.work_title} · 来源 v{source.source_version} · {source.use_kind ? passageUses[source.use_kind] : source.scope==='fragment'?'明确片段':'整份资料'}</p>
      {!adoption && <p className="context-hint">{materialCategories[source.metadata.material_category || 'unclassified']} · {materialTags(source.metadata).join(' · ') || '无资料标签'}</p>}
      {source.note && <p>{source.note}</p>}
      {adoption && source.anchor_state && <p role="status">{adoptionStateLabel[source.anchor_state]}</p>}
      {!adoption && source.stale&&<p role="status">{narrative ? '当前资料版本为' : '当前资料已修订为'} v{current?.version ?? source.current_version}。{narrative
        ? '这里保留记录时的原文。'
        : worldline === null
        ? '这里保留的是关联时的原版本；更新来源需重新明确关联。'
        : `此世界线采用冻结的 v${source.source_version}。`}</p>}
      {!adoption && source.source_archived&&<p>来源已收起；保存的历史原文仍可阅读。</p>}
      {source.status==='removed'&&<p>这条关联已解除，历史来源保留。</p>}
      <div className="canon-row-actions">
        {location.state?.objectOrigin ? <ObjectBackLink to={source.target_to} label={source.target_label}/>
          : <Link className="text-link" to={returnParams.size ? `${source.target_to}&${returnParams}` : source.target_to}
            state={worldline !== null && location.state?.fromInspiration ? { runtimeReturn: 'frozen_source' } : undefined}>
            {adoption && '返回灵感 · '}{source.target_label} →</Link>}
        {adoption && source.anchor_state
          ? source.anchor_state !== 'archived' && <Link className="text-link" to={adoptionManuscriptPath(world, { ...source, anchor_state: source.anchor_state })}>
            {source.anchor_state === 'current' ? '定位当前正文' : '打开当前正文'} →
          </Link>
          : <Link className="text-link" to={`/worlds/${world}/create?work=${source.work_id}&node=${source.node_id}&mode=read`}>打开当前资料 →</Link>}
        {manualSource && source.stale && <Button aria-expanded={comparing} onClick={() => setComparing(value => !value)}>
          {comparing ? '收起版本对照' : '对照当前版本'}
        </Button>}
        <Button onClick={()=>mark.current?.scrollIntoView({block: scrollBlock})}>定位来源选区</Button></div>
      {comparing ? <div className="source-version-comparison" role="region" aria-label="来源版本对照">
        <section><h2>冻结 v{source.source_version} · 保存选区</h2>{frozen}</section>
        <section>
          <h2>当前 v{current?.version ?? source.current_version} · 正文</h2>
          {compareError ? <ErrorNotice>{compareError}</ErrorNotice>
            : current ? <article className="source-reader-text" aria-label="当前版本正文">
              {current.title !== source.title && <strong className="source-version-title">{current.title}</strong>}
              {current.plain_text || '当前正文为空。'}
            </article> : <p role="status">正在读取当前正文…</p>}
        </section>
      </div> : frozen}
      {source.metadata.import_batch&&<ImportSources world={world} batch={source.metadata.import_batch} pages={source.metadata.import_source_pages} files={source.metadata.import_files}/>}
    </div>}
  </main>;
}
