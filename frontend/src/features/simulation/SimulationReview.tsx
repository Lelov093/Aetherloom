import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, CheckCheck, Clock3, FileText, GitBranch, RotateCcw, Search, SlidersHorizontal, UsersRound } from 'lucide-react';
import { Button, EmptyState, ErrorNotice } from '../../components/ui';
import { EntityMark } from '../../components/EntityMark';
import { useWorkspaceTrail } from '../../components/WorkspaceContext';
import { creationApi, type Entity } from '../creation/api';
import { Portrait, usePortraits } from '../objects/Portrait';
import { CanonSources } from '../review/CanonSources';
import { ReviewFrame, ReviewInboxHeader, ReviewStatusTabs } from '../review/ReviewFrame';
import { useReviewPreview } from '../review/useReviewPreview';
import { filterSimulationReviews } from '../review/simulationReviewPresentation';
import { fieldTypeNames, kindNames, proposalTitle, proposalValue, statusNames } from '../review/api';
import { simApi, type SimPreview } from './api';
import { StateChanges } from './StateChanges';

export function SimulationReview({ world }: { world: string }) {
  const [params, setParams] = useSearchParams(), id = params.get('proposal');
  const fromExplore = useLocation().state?.exploreWorld === world;
  const navigate = useNavigate();
  const { portraits } = usePortraits(world);
  const [list, setList] = useState<SimPreview[]>([]), [entities, setEntities] = useState<Entity[]>([]);
  const [listLoading, setListLoading] = useState(true), [error, setError] = useState('');
  const [status, setStatus] = useState('all'), [kind, setKind] = useState(''), [run, setRun] = useState(''), [query, setQuery] = useState('');
  const currentWorld = useRef(world), listSequence = useRef(0);
  currentWorld.current = world;
  const comparison = useReviewPreview(world, id, selectedId => simApi.preview(selectedId, world)), preview = comparison.value, candidate = preview?.candidate;
  useWorkspaceTrail([{ label: '历史模拟提案', to: `/worlds/${world}/review/simulation` }, ...(candidate ? [{ label: proposalTitle(candidate.payload) }] : [])]);
  async function loadList() {
    const sequence = ++listSequence.current, target = world;
    setListLoading(true);
    try {
      const [saved, objects] = await Promise.all([simApi.review(target), creationApi.entities(target)]);
      if (sequence === listSequence.current && target === currentWorld.current) { setList(saved); setEntities(objects); }
    } catch (failure) { if (sequence === listSequence.current) setError((failure as Error).message); }
    finally { if (sequence === listSequence.current) setListLoading(false); }
  }
  useEffect(() => { setList([]); setEntities([]); setError(''); void loadList(); return () => { listSequence.current++; }; }, [world]);
  async function reload() { await Promise.all([loadList(), comparison.reload()]); }
  const name = (ref?: string | null) => entities.find(entity => entity.id === ref)?.name || (ref && preview?.source.entities[ref]?.name) || '来源中的对象';
  const frozenName = (ref: string) => preview?.source.entities[ref]?.name || '保存的对象';
  const filtered = filterSimulationReviews(list, status, kind, run, query);
  const runs = [...new Map(list.map(item => [item.source.simulation_id, item.source.title])).entries()];
  const payload = candidate?.payload;
  const identityOf = (item: SimPreview) => item.affected_entities.find(entity => entity.id === (item.candidate.payload.subject_ref || item.candidate.payload.participants?.[0] || item.candidate.payload.location_ref));
  const identity = preview && identityOf(preview);
  const identityMark = (entity: Entity | undefined, small = false) => entity?.kind === 'character' && portraits[entity.id] ? <Portrait id={entity.id} name={entity.name} version={portraits[entity.id]} size={small ? 'small' : 'normal'}/> : <EntityMark kind={entity?.kind || 'event'} small={small}/>;
  const title = payload ? candidate?.kind === 'assertion' ? `${name(payload.subject_ref)} · ${proposalTitle(payload)}` : proposalTitle(payload) : '';
  const selectedOutsideFilter = Boolean(id && list.some(item => item.candidate.id === id) && !filtered.some(item => item.candidate.id === id));
  const inbox = <aside className="review-inbox" aria-label="历史模拟提案"><ReviewInboxHeader world={world} simulation/>
    <ReviewStatusTabs status={status} pending={list.filter(item => item.candidate.status === 'pending').length} onChange={setStatus} pendingLabel="未裁决"/>
    <label className="review-search"><Search size={15}/><input aria-label="搜索模拟提案" placeholder="搜索提案、对象或世界线…" value={query} onChange={event => setQuery(event.target.value)}/></label>
    <details className="review-filter-panel"><summary><SlidersHorizontal size={15}/>筛选提案<span>{[kind, run].filter(Boolean).length ? `${[kind, run].filter(Boolean).length} 项条件` : '全部类型与世界线'}</span></summary><div className="review-filters">
      <label>类型<select aria-label="模拟提案类型" value={kind} onChange={event => setKind(event.target.value)}><option value="">全部类型</option><option value="event">事件</option><option value="assertion">世界事实</option></select></label>
      <label>世界线<select aria-label="模拟提案世界线" value={run} onChange={event => setRun(event.target.value)}><option value="">全部世界线</option>{runs.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div></details>
    <div className="review-list-meta"><span>{filtered.length}项提案</span><Button variant="ghost" aria-label="刷新模拟提案" onClick={() => void reload()}><RotateCcw size={15}/></Button></div>
    {listLoading && <p role="status" className="review-empty">正在读取提案…</p>}
    {selectedOutsideFilter && <p className="review-filter-notice">当前打开的提案在筛选之外。<button type="button" onClick={() => { setStatus('all'); setKind(''); setRun(''); setQuery(''); }}>显示全部</button></p>}
    <div className="review-issue-list">{filtered.map(item => <div key={item.candidate.id} className={`review-issue ${id === item.candidate.id ? 'selected' : ''}`}><button type="button" aria-current={id === item.candidate.id ? 'true' : undefined} onClick={() => setParams({ proposal: item.candidate.id })}>
      <div><span className="issue-identity">{identityMark(identityOf(item), true)}<strong>{item.candidate.kind === 'assertion' ? `${item.affected_entities.find(entity => entity.id === item.candidate.payload.subject_ref)?.name || '对象'} · ${proposalTitle(item.candidate.payload)}` : proposalTitle(item.candidate.payload)}</strong></span><span className={`review-status review-status--${item.conflicts.length ? 'important' : 'normal'}`}>{item.candidate.status === 'pending' ? '未裁决' : statusNames[item.candidate.status] || item.candidate.status}</span></div>
      <p>{proposalValue(item.candidate.payload)}</p><small>{kindNames[item.candidate.kind]} · {item.source.title} · 第{item.source.seq}步</small>
    </button></div>)}</div>
    {!listLoading && !filtered.length && <p className="review-empty">{list.length ? '没有符合筛选条件的提案。' : '尚无历史模拟提案。'}</p>}
  </aside>;
  return <>
    <ReviewFrame inbox={inbox} selection={id} simulation><section className="review-primary" aria-label="历史模拟提案详情" aria-busy={comparison.loading}>
      {fromExplore && <div className="canon-row-actions"><Button variant="ghost" onClick={() => navigate(-1)}>返回探索</Button></div>}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {(comparison.loading || comparison.error || (id && !comparison.current)) && <div className="review-load-status" role="status">{comparison.error || '正在比较提案与当前 Canon…'}{comparison.error && <Button variant="ghost" onClick={() => void comparison.reload()}>重试比较</Button>}</div>}
      {preview && candidate && payload ? <div className="review-detail-holder" inert={!comparison.current || comparison.loading}><article className="review-detail">
        <div className="review-detail-content"><header className="review-detail-heading"><div className="review-detail-identity">{identityMark(identity)}<div><span className="eyebrow">历史模拟提案 · {kindNames[candidate.kind]}</span><h1>{title}</h1></div></div><span className={`review-status review-status--${preview.conflicts.length ? 'important' : 'normal'}`}>{candidate.status === 'pending' ? '未裁决' : statusNames[candidate.status]}</span></header>
          <div className="canon-comparison"><section className="canon-current"><h2><FileText size={17}/>当前 Canon</h2>
            {preview.current.length ? preview.current.map(record => <div className={`current-value ${candidate.kind === 'event' || (record.value || '').length > 24 || record.predicate === '目标' ? 'current-value--narrative' : ''}`} key={record.id}><small>{record.predicate || record.title || '正式记录'}</small><strong>{record.value || record.description || record.title}</strong>{(record.valid_from || record.valid_until) && <p>{record.valid_from || '起始未知'} → {record.valid_until || '结束未知'}</p>}<CanonSources record={record} kind={candidate.kind} world={world}/></div>) : <p className="context-hint">当前没有对应的正式记录。</p>}
            <small className="canon-revision">当前 Canon {preview.revision}</small>
          </section><ArrowLeftRight size={22} className="comparison-arrow"/><section className="canon-candidate"><h2><GitBranch size={17}/>保存的提案</h2>
            <div className={`candidate-value ${candidate.kind === 'event' || proposalValue(payload).length > 24 || payload.predicate === '目标' ? 'candidate-value--narrative' : ''}`}>{proposalValue(payload)}</div>
            {(payload.subject_ref || payload.object_ref) && <p>{name(payload.subject_ref)}{payload.object_ref && ` → ${name(payload.object_ref)}`}</p>}
            {candidate.status !== 'pending' && <p className="review-notice">此提案已{candidate.status === 'accepted' ? '接受' : '拒绝'}，以下保留裁决时的提案内容。</p>}
            {preview.field_mapping && <p className={preview.field_mapping.error ? 'review-warning' : 'review-mapping'}>字段映射：{preview.field_mapping.label} · {fieldTypeNames[preview.field_mapping.value_type || '']} → {preview.field_mapping.value}{preview.field_mapping.error && `；${preview.field_mapping.error}`}</p>}
            <small>{preview.source.title} · 第{preview.source.seq}步</small>
          </section></div>
          <div className="review-context-grid">
            <section className="review-context-card">
              <h2><GitBranch size={17}/>模拟来源与依据</h2>
              <div className="source-heading">
                <strong>{preview.source.title}</strong>
                <Link className="text-link"
                  to={preview.source.type === "runtime_v2" ? `/worlds/${world}/simulate?line=${preview.source.simulation_id}&seq=${preview.source.seq}` : `/worlds/${world}/simulate?session=${preview.source.simulation_id}&event=${preview.source.seq}`}
                  state={preview.source.type === "runtime_v2" ? { simulationReviewWorld: world } : undefined}>
                  查看第{preview.source.seq}步 →
                </Link>
              </div>
              <p className="review-source-label">已提交的原始模拟事件{preview.source.purpose && ` · ${preview.source.purpose === "original_projection" ? "原作推演" : preview.source.purpose === "template_parallel" ? "模板平行世界" : preview.source.purpose === "sandbox" ? "自由沙盒" : "未分类"}`}</p>
              {preview.source.lineage?.ancestors.map(a => <p key={a.worldline_id}>
                <Link className="text-link" to={`/worlds/${world}/simulate?line=${a.worldline_id}&seq=${a.seq}`} state={{ simulationReviewWorld: world }}>父系来源 · 第{a.seq}步 →</Link>
              </p>)}
              <blockquote>{preview.source.event.narration}</blockquote>
              <details><summary>本步提交的前后状态</summary><StateChanges diff={preview.source.event.diff} name={frozenName}/></details>
            </section>
            <div className="review-context-stack"><section className="review-context-card"><h2><Clock3 size={17}/>时间与冻结基线</h2><p>{preview.source.start}</p><p>{preview.source.time_basis}</p><div className="review-baseline"><span>冻结基线 Canon {preview.source.baseline_revision}</span><span>当前 Canon {preview.revision}</span></div>{(payload.valid_from || payload.valid_until) ? <p>提案有效时间：{payload.valid_from || '起始未知'} → {payload.valid_until || '结束未知'}</p> : <small>未指定正式记录的有效时间；行动步数不是故事日期。</small>}{preview.baseline_stale && <p className="review-notice">正式设定已在冻结后更新。</p>}{preview.temporal_change && <p className="temporal-notice">当前记录与提案对应不同的年份区间。</p>}</section>
              {!!preview.affected_entities.length && <section className="review-context-card"><h2><UsersRound size={17}/>影响对象</h2><div className="affected-objects">{preview.affected_entities.map(entity => <Link key={entity.id} to={`/worlds/${world}/create/objects/${entity.id}`}><EntityMark kind={entity.kind} small/><span>{entity.name}</span></Link>)}</div></section>}
            </div></div>
          {!!preview.conflicts.length && <p className="review-warning">存在 {preview.conflicts.length} 项正式记录差异。</p>}
          {!!preview.dependencies.length && <section className="review-notice"><h2>未核定的身份引用</h2>{preview.dependencies.map(dependency => <p key={dependency.ref}>{dependency.name || '未解决的对象引用'}</p>)}</section>}
        </div>
        {candidate.target_id && <footer className="review-decision-bar">
          <Link className="text-link" to={candidate.target_type === 'assertion' ? `/worlds/${world}/create/objects/${payload.subject_ref}?tab=facts&fact=${candidate.target_id}` : `/worlds/${world}/create/records?event=${candidate.target_id}`}>查看正式记录与来源 →</Link>
        </footer>}
      </article></div> : <EmptyState icon={<CheckCheck size={28}/>} title={id ? '打开模拟提案' : '查阅历史模拟提案'}>{id ? '正在读取保存的提案与原始模拟依据。' : '从列表选择提案，查看当时的内容、模拟原步与当前设定。'}</EmptyState>}
    </section></ReviewFrame>
  </>;
}
