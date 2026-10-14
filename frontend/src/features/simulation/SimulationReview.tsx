import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, CheckCheck, Clock3, FileText, GitBranch, PenLine, RotateCcw, Search, SlidersHorizontal, UsersRound } from 'lucide-react';
import { Button, Dialog, EmptyState, ErrorNotice } from '../../components/ui';
import { EntityMark } from '../../components/EntityMark';
import { useWorkspaceTrail } from '../../components/WorkspaceContext';
import { creationApi, type Entity } from '../creation/api';
import { Portrait, usePortraits } from '../objects/Portrait';
import { CandidateEditor } from '../review/CandidateEditor';
import { CanonSources } from '../review/CanonSources';
import { ReviewFrame, ReviewInboxHeader, ReviewStatusTabs } from '../review/ReviewFrame';
import { useReviewPreview } from '../review/useReviewPreview';
import { acceptanceEffect, filterSimulationReviews, resolutionLabels } from '../review/simulationReviewPresentation';
import { fieldTypeNames, kindNames, proposalTitle, proposalValue, statusNames } from '../review/api';
import { simApi, type SimPreview } from './api';
import { StateChanges } from './StateChanges';

export function SimulationReview({ world }: { world: string }) {
  const [params, setParams] = useSearchParams(), id = params.get('proposal');
  const { portraits } = usePortraits(world);
  const [list, setList] = useState<SimPreview[]>([]), [entities, setEntities] = useState<Entity[]>([]);
  const [listLoading, setListLoading] = useState(true), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [status, setStatus] = useState('pending'), [kind, setKind] = useState(''), [run, setRun] = useState(''), [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [ack, setAck] = useState(false), [resolution, setResolution] = useState(''), [confirmation, setConfirmation] = useState(false);
  const selected = useRef({ world, id }), listSequence = useRef(0);
  selected.current = { world, id };
  const comparison = useReviewPreview(world, id, simApi.preview), preview = comparison.value, candidate = preview?.candidate;
  useWorkspaceTrail([{ label: '模拟提案', to: `/worlds/${world}/review/simulation` }, ...(candidate ? [{ label: proposalTitle(candidate.payload) }] : [])]);
  async function loadList() {
    const sequence = ++listSequence.current, target = world;
    setListLoading(true);
    try {
      const [saved, objects] = await Promise.all([simApi.review(target), creationApi.entities(target)]);
      if (sequence === listSequence.current && target === selected.current.world) { setList(saved); setEntities(objects); }
    } catch (failure) { if (sequence === listSequence.current) setError((failure as Error).message); }
    finally { if (sequence === listSequence.current) setListLoading(false); }
  }
  useEffect(() => { setList([]); setEntities([]); setError(''); void loadList(); return () => { listSequence.current++; }; }, [world]);
  useLayoutEffect(() => { setAck(false); setResolution(''); setEditing(false); setConfirmation(false); }, [id, candidate?.version, preview?.revision]);
  useEffect(() => { setMessage(''); setError(''); }, [id]);
  async function reload() { setAck(false); setConfirmation(false); await Promise.all([loadList(), comparison.reload()]); }
  async function decide(action: string) {
    if (!preview || !comparison.current || comparison.loading || busy) return;
    const target = { world, id };
    setBusy(true); setError('');
    try {
      await simApi.decide(preview, action, effectiveResolution || null, ack);
      if (target.id === selected.current.id && target.world === selected.current.world) { await reload(); setMessage(action === 'accept' ? '已显式接受，正式记录与模拟来源已保存。' : '已拒绝提案，未修改 Canon。'); }
    } catch (failure) { if (target.id === selected.current.id) { setError((failure as Error).message); setConfirmation(false); setAck(false); } }
    finally { setBusy(false); }
  }
  const name = (ref?: string | null) => entities.find(entity => entity.id === ref)?.name || (ref && preview?.source.entities[ref]?.name) || '来源中的对象';
  const frozenName = (ref: string) => preview?.source.entities[ref]?.name || '保存的对象';
  const filtered = filterSimulationReviews(list, status, kind, run, query);
  const runs = [...new Map(list.map(item => [item.source.simulation_id, item.source.title])).entries()];
  const effectiveResolution = resolution || (preview?.temporal_change && !preview.conflicts.length ? 'temporal' : '');
  const needsChoice = Boolean(preview && (preview.conflicts.length || (candidate?.kind === 'event' && preview.current.length)));
  const blocked = !comparison.current || comparison.loading || busy || Boolean(preview?.dependencies.length || preview?.field_mapping?.error);
  const canAccept = !blocked && ack && (!needsChoice || Boolean(resolution));
  const payload = candidate?.payload;
  const identityOf = (item: SimPreview) => item.affected_entities.find(entity => entity.id === (item.candidate.payload.subject_ref || item.candidate.payload.participants?.[0] || item.candidate.payload.location_ref));
  const identity = preview && identityOf(preview);
  const identityMark = (entity: Entity | undefined, small = false) => entity?.kind === 'character' && portraits[entity.id] ? <Portrait id={entity.id} name={entity.name} version={portraits[entity.id]} size={small ? 'small' : 'normal'}/> : <EntityMark kind={entity?.kind || 'event'} small={small}/>;
  const title = payload ? candidate?.kind === 'assertion' ? `${name(payload.subject_ref)} · ${proposalTitle(payload)}` : proposalTitle(payload) : '';
  const selectedOutsideFilter = Boolean(id && list.some(item => item.candidate.id === id) && !filtered.some(item => item.candidate.id === id));
  const inbox = <aside className="review-inbox" aria-label="审阅收件箱"><ReviewInboxHeader world={world} simulation/>
    <ReviewStatusTabs status={status} pending={list.filter(item => item.candidate.status === 'pending').length} onChange={setStatus}/>
    <label className="review-search"><Search size={15}/><input aria-label="搜索模拟提案" placeholder="搜索提案、对象或世界线…" value={query} onChange={event => setQuery(event.target.value)}/></label>
    <details className="review-filter-panel"><summary><SlidersHorizontal size={15}/>筛选提案<span>{[kind, run].filter(Boolean).length ? `${[kind, run].filter(Boolean).length} 项条件` : '全部类型与世界线'}</span></summary><div className="review-filters">
      <label>类型<select aria-label="模拟提案类型" value={kind} onChange={event => setKind(event.target.value)}><option value="">全部类型</option><option value="event">事件</option><option value="assertion">世界事实</option></select></label>
      <label>世界线<select aria-label="模拟提案世界线" value={run} onChange={event => setRun(event.target.value)}><option value="">全部世界线</option>{runs.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div></details>
    <div className="review-list-meta"><span>{filtered.length}项提案</span><Button variant="ghost" aria-label="刷新模拟提案" disabled={busy} onClick={() => void reload()}><RotateCcw size={15}/></Button></div>
    {listLoading && <p role="status" className="review-empty">正在读取提案…</p>}
    {selectedOutsideFilter && <p className="review-filter-notice">当前打开的提案在筛选之外。<button type="button" onClick={() => { setStatus('all'); setKind(''); setRun(''); setQuery(''); }}>显示全部</button></p>}
    <div className="review-issue-list">{filtered.map(item => <div key={item.candidate.id} className={`review-issue ${id === item.candidate.id ? 'selected' : ''}`}><button type="button" aria-current={id === item.candidate.id ? 'true' : undefined} disabled={busy} onClick={() => setParams({ proposal: item.candidate.id })}>
      <div><span className="issue-identity">{identityMark(identityOf(item), true)}<strong>{item.candidate.kind === 'assertion' ? `${item.affected_entities.find(entity => entity.id === item.candidate.payload.subject_ref)?.name || '对象'} · ${proposalTitle(item.candidate.payload)}` : proposalTitle(item.candidate.payload)}</strong></span><span className={`review-status review-status--${item.conflicts.length ? 'important' : 'normal'}`}>{statusNames[item.candidate.status] || item.candidate.status}</span></div>
      <p>{proposalValue(item.candidate.payload)}</p><small>{kindNames[item.candidate.kind]} · {item.source.title} · 第{item.source.seq}步</small>
    </button></div>)}</div>
    {!listLoading && !filtered.length && <p className="review-empty">{list.length ? '没有符合筛选条件的提案。' : '尚无模拟提案。请从已保存的演化事件或状态事实建立提案。'}</p>}
  </aside>;
  return <>
    <ReviewFrame inbox={inbox} selection={id} simulation><section className="review-primary" aria-label="模拟审阅详情" aria-busy={comparison.loading}>
      {error && <ErrorNotice>{error}</ErrorNotice>}{message && <p className="review-success" role="status">{message}</p>}
      {(comparison.loading || comparison.error || (id && !comparison.current)) && <div className="review-load-status" role="status">{comparison.error || '正在比较提案与当前 Canon…'}{comparison.error && <Button variant="ghost" onClick={() => void comparison.reload()}>重试比较</Button>}</div>}
      {preview && candidate && payload ? <div className="review-detail-holder" inert={!comparison.current || comparison.loading || busy}><article className="review-detail">
        <div className="review-detail-content"><header className="review-detail-heading"><div className="review-detail-identity">{identityMark(identity)}<div><span className="eyebrow">SIMULATION REVIEW · {kindNames[candidate.kind]}</span><h1>{title}</h1><p>比较正式设定与模拟提案，核对依据后再裁决。</p></div></div><span className={`review-status review-status--${preview.conflicts.length ? 'important' : 'normal'}`}>{candidate.status !== 'pending' ? statusNames[candidate.status] : preview.conflicts.length ? '需要处理差异' : '待审阅'}</span></header>
          <div className="canon-comparison"><section className="canon-current"><h2><FileText size={17}/>当前 Canon</h2>
            {preview.current.length ? preview.current.map(record => <div className={`current-value ${candidate.kind === 'event' || (record.value || '').length > 24 || record.predicate === '目标' ? 'current-value--narrative' : ''}`} key={record.id}><small>{record.predicate || record.title || '正式记录'}</small><strong>{record.value || record.description || record.title}</strong>{(record.valid_from || record.valid_until) && <p>{record.valid_from || '起始未知'} → {record.valid_until || '结束未知'}</p>}<CanonSources record={record} kind={candidate.kind} world={world}/></div>) : <p className="context-hint">{candidate.status === 'pending' ? '尚无对应的正式记录。接受后将新增记录。' : '当前没有对应的正式记录，保存的提案与原始依据仍可查阅。'}</p>}
            <small className="canon-revision">当前 Canon {preview.revision}</small>
          </section><ArrowLeftRight size={22} className="comparison-arrow"/><section className="canon-candidate"><h2><GitBranch size={17}/>{candidate.status === 'pending' ? '待审提案' : '提案记录'}</h2><small>{kindNames[candidate.kind]} · {candidate.status === 'pending' ? '尚未接受的内容与 Canon 独立' : '保存的提案与原始模拟依据分别保留'}</small>
            <div className={`candidate-value ${candidate.kind === 'event' || proposalValue(payload).length > 24 || payload.predicate === '目标' ? 'candidate-value--narrative' : ''}`}>{proposalValue(payload)}</div>
            {(payload.subject_ref || payload.object_ref) && <p>{name(payload.subject_ref)}{payload.object_ref && ` → ${name(payload.object_ref)}`}</p>}
            {candidate.status !== 'pending' && <p className="review-notice">此提案已{candidate.status === 'accepted' ? '接受' : '拒绝'}，以下保留裁决时的提案内容。</p>}
            {preview.field_mapping && <p className={preview.field_mapping.error ? 'review-warning' : 'review-mapping'}>字段映射：{preview.field_mapping.label} · {fieldTypeNames[preview.field_mapping.value_type || '']} → {preview.field_mapping.value}{preview.field_mapping.error && `；${preview.field_mapping.error}`}</p>}
            <small>{preview.source.title} · 第{preview.source.seq}步</small>
          </section></div>
          <div className="review-context-grid"><section className="review-context-card"><h2><GitBranch size={17}/>模拟来源与依据</h2><div className="source-heading"><strong>{preview.source.title}</strong><Link className="text-link" to={`/worlds/${world}/simulate?session=${preview.source.simulation_id}&event=${preview.source.seq}`}>查看第{preview.source.seq}步 →</Link></div><p className="review-source-label">已提交的原始模拟事件</p><blockquote>{preview.source.event.narration}</blockquote><details><summary>本步提交的前后状态</summary><StateChanges diff={preview.source.event.diff} name={frozenName}/></details><small>模拟状态变化不直接改变 Canon；编辑提案不改写原始事件。</small></section>
            <div className="review-context-stack"><section className="review-context-card"><h2><Clock3 size={17}/>时间与冻结基线</h2><p>{preview.source.start}</p><p>{preview.source.time_basis}</p><div className="review-baseline"><span>冻结基线 Canon {preview.source.baseline_revision}</span><span>当前 Canon {preview.revision}</span></div>{(payload.valid_from || payload.valid_until) ? <p>提案有效时间：{payload.valid_from || '起始未知'} → {payload.valid_until || '结束未知'}</p> : <small>未指定正式记录的有效时间；行动步数不是故事日期。</small>}{preview.baseline_stale && <p className="review-notice">Canon 已在冻结后更新。请核对当前比较；版本变化不等于本提案有冲突。</p>}{preview.temporal_change && <p className="temporal-notice">当前记录与提案有明确不重叠的年份区间，可按时间变化保留。</p>}</section>
              {!!preview.affected_entities.length && <section className="review-context-card"><h2><UsersRound size={17}/>影响对象</h2><div className="affected-objects">{preview.affected_entities.map(entity => <Link key={entity.id} to={`/worlds/${world}/create/objects/${entity.id}`}><EntityMark kind={entity.kind} small/><span>{entity.name}</span></Link>)}</div></section>}
            </div></div>
          {!!preview.conflicts.length && <p className="review-warning">存在 {preview.conflicts.length} 项正式记录差异，请选择处理方式。保留双方与替代旧记录具有不同影响。</p>}
          {!!preview.dependencies.length && <section className="review-notice"><h2>需要核对身份引用</h2>{preview.dependencies.map(dependency => <p key={dependency.ref}>{dependency.name || '未解决的对象引用'}</p>)}<p>请先解决引用，再接受提案。</p></section>}
          {preview.warnings.map(warning => <p className="review-warning" key={warning}>{warning}</p>)}
          {candidate.status === 'pending' && <section className="review-preconditions">
            {needsChoice && <label className="field"><span>{candidate.kind === 'event' ? '同名事件处理' : '差异处理方式'}</span><select aria-label="差异处理方式" value={resolution} onChange={event => { setResolution(event.target.value); setAck(false); }}><option value="">明确选择处理方式…</option><option value="keep_both">{candidate.kind === 'event' ? '保持为另一个事件' : resolutionLabels.keep_both}</option>{candidate.kind !== 'event' && <option value="replace">{resolutionLabels.replace}</option>}</select></label>}
            <label className="review-ack"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)}/>我已核对模拟来源、对象身份、当前 Canon 比较{preview.requires_evidence_confirmation ? '及可能的推断／改写' : ''}{preview.baseline_stale ? '，并确认冻结后的版本变化' : ''}。</label>
          </section>}
        </div>
        <footer className="review-decision-bar">{candidate.status === 'pending' ? <><Button variant="ghost" disabled={!comparison.current || comparison.loading || busy} onClick={() => setEditing(true)}><PenLine size={15}/>编辑提案</Button><Button disabled={busy} onClick={() => void decide('reject')}>拒绝提案</Button><Button variant="ghost" disabled={busy} onClick={() => void reload()}><RotateCcw size={15}/>重新比较</Button><Button variant="primary" disabled={!canAccept} onClick={() => setConfirmation(true)}><CheckCheck size={16}/>预览接受</Button></> : <><p>已{candidate.status === 'accepted' ? '接受' : '拒绝'} · 原始来源保留</p>{candidate.target_id && <Link className="text-link" to={candidate.target_type === 'assertion' ? `/worlds/${world}/create/objects/${payload.subject_ref}?tab=facts&fact=${candidate.target_id}` : `/worlds/${world}/create/records?event=${candidate.target_id}`}>查看正式记录与来源 →</Link>}</>}</footer>
      </article></div> : <EmptyState icon={<CheckCheck size={28}/>} title={id ? '打开模拟提案' : '核对变化，再决定是否纳入 Canon'}>{id ? '正在读取保存的提案与原始模拟依据。' : '从收件箱选择提案，比较当前设定、模拟依据与接受影响。'}</EmptyState>}
    </section></ReviewFrame>
    {editing && candidate && comparison.current && !comparison.loading && !busy && <CandidateEditor candidate={candidate} entities={entities} candidates={[]} sourceLabel="原始模拟提交来源" onClose={() => setEditing(false)} onSaved={reload} saveOverride={value => simApi.edit(candidate, value)}/>}
    {confirmation && preview && candidate && comparison.current && <Dialog title="显式接受模拟提案" className="review-confirm-dialog" busy={busy} onClose={() => setConfirmation(false)}><p className="dialog-intro">确认后写入 Working Canon。请最后核对以下内容与处理方式。</p><section className="review-confirm-payload"><small>{kindNames[candidate.kind]}</small><h3>{title}</h3><p>{proposalValue(candidate.payload)}</p>{preview.field_mapping && <p>将保存为：{preview.field_mapping.label} → {preview.field_mapping.value}</p>}</section><p>{acceptanceEffect(preview, effectiveResolution)}</p>{effectiveResolution && <p>处理方式：{resolutionLabels[effectiveResolution]}</p>}{effectiveResolution === 'replace' && <div className="review-replaced-records">{preview.conflicts.map(record => <p key={record.id}>将替代：{record.predicate || record.title} · {record.value || record.description}</p>)}</div>}<p>来源：{preview.source.title} · 第{preview.source.seq}步；当前 Canon {preview.revision}。</p><small>原始事件、冻结输入与正文保持独立。</small>{error && <ErrorNotice>{error}</ErrorNotice>}<div className="dialog-actions"><Button disabled={busy} onClick={() => setConfirmation(false)}>返回比较</Button><Button variant="primary" disabled={!canAccept} onClick={() => void decide('accept')}>{busy ? '正在保存…' : '确认接受并写入 Canon'}</Button></div></Dialog>}
  </>;
}
