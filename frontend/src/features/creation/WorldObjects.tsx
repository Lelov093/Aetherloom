import {useEffect,useRef,useState} from 'react';
import {Link,useParams,useBlocker,useLocation,useNavigate,useSearchParams} from 'react-router-dom';
import {Plus,ArrowUp,ArrowDown,Archive,RotateCcw,Trash2,Pencil,ArrowUpRight,Search} from 'lucide-react';
import {Button,Dialog,EmptyState,ErrorNotice} from '../../components/ui';
import {CanonHistoryDialog} from './CanonHistoryDialog';
import {Portrait,PortraitEditor,usePortraits} from '../objects/Portrait';
import {DisplayImage,DisplayImageEditor} from '../objects/DisplayImages';
import {ObjectSchemaFields} from './ObjectSchemaFields';
import {EntityMark} from '../../components/EntityMark';
import {EntityKeyProperties} from './EntityKeyProperties';
import {EntitySourceProposals} from './EntitySourceProposals';
import {MaterialSources} from './MaterialSources';
import {CanonSources} from '../review/CanonSources';
import {relationshipPath} from '../explore/links';
import {LocationMaps} from '../maps/LocationMaps';
import {ObjectPeriods} from '../periods/PeriodViews';
import {periodsApi, readMoment, storyParams, withMoment, type StoryMoment} from '../periods/api';
import {FactEditor} from './FactEditor';
import {EntityMergeDialog} from './EntityMergeDialog';
import {ResourceForm} from './ResourceForm';
import {creationApi,entityDraftData,entityKinds,RequestError,type Entity,type Status,type Fact,type FactWrite} from './api';
import {categoryDirectoryPath,categoryPath,objectsPath} from '../worlds/categories';
import {WorldCategories} from './WorldCategories';
import {WorldObjectCard} from './WorldObjectCard';
import {ObjectBackLink,ObjectBrowseLink,useObjectFilters,useObjectPageTop} from './ObjectNavigation';
import {SaveConflict,objectComparison} from './SaveConflict';

export function WorldObjects({world,archived}:{world:string;archived:boolean}){
  const [params]=useSearchParams();
  const categoryId=params.get('category');
  if(categoryId||params.get('view')==='categories')return <WorldCategories world={world} categoryId={categoryId} archived={archived}/>;
  return <AllWorldObjects world={world} archived={archived}/>;
}

function AllWorldObjects({world,archived}:{world:string;archived:boolean}){
  const {portraits}=usePortraits(world);
  const [params,setFilter]=useObjectFilters();
  const kind=params.get('kind')||'';
  const q=params.get('q')||'';
  const status=params.get('status')||'active';
  const [entities,setEntities]=useState<Entity[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[creating,setCreating]=useState(false);
  async function load(){setLoading(true);try{setEntities(await creationApi.entities(world));setError('');}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
  useEffect(()=>{void load();},[world]);
  const list=entities.filter(e=>e.status===status&&(!kind||e.kind===kind)&&`${e.name} ${e.aliases.join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  return <main id="main-content" className="object-library page">
    <header className="reading-page-heading category-heading">
      <h1>世界中的人与万物</h1>
      <div className="category-actions">
        <Link className="button button--ghost" to={categoryDirectoryPath(world)}>全部分类</Link>
        {!archived&&<Button variant="primary" onClick={()=>setCreating(true)}><Plus size={17}/>创建对象</Button>}
      </div>
    </header>
    <div className="object-filters"><label className="search-field"><Search size={17}/><input aria-label="搜索对象" placeholder="搜索名称或别名…" value={q} onChange={e=>setFilter('q',e.target.value)}/></label><select aria-label="对象类型" value={kind} onChange={e=>setFilter('kind',e.target.value)}><option value="">全部类型</option>{Object.entries(entityKinds).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select><select aria-label="对象状态" value={status} onChange={e=>setFilter('status',e.target.value==='active'?'':e.target.value)}><option value="active">活跃对象</option><option value="archived">已归档</option><option value="deleted">已删除 / 可恢复</option></select></div>
    <div className="reading-list-heading"><span role="status">{loading?'正在读取对象…':`${list.length} 个对象`}</span><Link className="text-link" to={`/worlds/${world}/create/records`}>事件与关系 <ArrowUpRight size={14}/></Link></div>
    {error&&<><ErrorNotice>{error}</ErrorNotice><Button onClick={load}>重试</Button></>}
    {!loading&&!error&&(list.length?<div className="object-card-grid">{list.map(entity=>
      <WorldObjectCard key={entity.id} entity={entity} to={`${objectsPath(world)}/${entity.id}`} imageVersion={portraits[entity.id]}/>
    )}</div>:<EmptyState icon={<Search size={25}/>} title={q||kind?'没有匹配的对象':status==='active'?'为世界添加一个对象':'这里还没有对象'}>{q||kind?'调整名称或类型筛选，继续查找。':'从人物、地点或一条世界规则开始，逐步整理你的设定。'}</EmptyState>)}
    {creating&&<ResourceForm title="创建世界对象" kinds={entityKinds} onClose={()=>setCreating(false)} onSubmit={async(name,kind)=>{await creationApi.createEntity(world,entityDraftData({name,kind}));await load();}}/>}
  </main>;
}

export function EntityFullView({world}:{world:string}){
  const location=useLocation();
  const fromExplore=location.state?.exploreWorld===world;
  const {portraits,reload:reloadPortraits}=usePortraits(world);const [portraitEditing,setPortraitEditing]=useState(false);
  const {entityId}=useParams();const navigate=useNavigate();const [params,setParams]=useSearchParams();const tab=params.get('tab')||'overview';const [editing,setEditing]=useState(false);const [merging,setMerging]=useState(false),[history,setHistory]=useState<{kind:string;id:string}>(),[recordAction,setRecordAction]=useState<{fact:Fact;status:string}>();const [entity,setEntity]=useState<Entity>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[factForm,setFactForm]=useState<Fact|true|null>(null),[confirm,setConfirm]=useState<Status|null>(null),[aliasesText,setAliasesText]=useState('');
  const [loading,setLoading]=useState(true);const request=useRef(0);
  const [latest,setLatest]=useState<Entity>();
  const [factTransition,setFactTransition]=useState(false);
  const moment=readMoment(params);
  const category=params.get('category');
  const listPath=category?categoryPath(world,category):objectsPath(world);
  useObjectPageTop(!loading&&entity?.id===entityId);
  function setTab(tab:string, point?:StoryMoment){
    setParams({tab,...(category?{category}:{}),...storyParams(point)},{replace:true,state:location.state,preventScrollReset:true});
  }
  function selectTab(tab:string){setTab(tab,tab==='periods'||tab==='maps'?moment:undefined);}
  async function load(){const ticket=++request.current;setLoading(true);setError('');try{const result=await creationApi.entity(entityId!);if(ticket!==request.current)return;setEntity(result);setAliasesText(result.aliases.join('，'));setDirty(false);setLatest(undefined);}catch(e){if(ticket===request.current)setError((e as Error).message);}finally{if(ticket===request.current)setLoading(false);}}
  useEffect(()=>{setEditing(false);setPortraitEditing(false);void load();return()=>{request.current++;};},[entityId]);
  useEffect(()=>{const id=params.get('fact');if(id&&entity&&tab==='facts')document.getElementById(`fact-${id}`)?.scrollIntoView({block:'nearest'});},[params,entity,tab]);
  const blocker=useBlocker(({currentLocation,nextLocation})=>dirty&&currentLocation.pathname!==nextLocation.pathname);
  useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[dirty]);
  function edit(data:Partial<Entity>){setEntity(e=>e?{...e,...data}:e);setDirty(true);}
  async function save(data:Partial<Entity>={}){
    if(!entity||latest)return false;
    setBusy(true);
    setError('');
    try{
      await creationApi.updateEntity(entity,data);
      await load();
      setConfirm(null);
      return true;
    }catch(error){
      setError((error as Error).message);
      if(editing&&!Object.keys(data).length&&error instanceof RequestError&&error.status===409){
        const saved=await creationApi.entity(entity.id).catch(()=>undefined);
        if(saved&&saved.version!==entity.version){
          setLatest(saved);
          setError('');
        }
      }
      return false;
    }finally{setBusy(false);}
  }
  function updateFactInView(fact:Fact){
    setEntity(current=>{
      if(!current)return current;
      const facts=current.facts??[];
      return {...current,facts:facts.some(item=>item.id===fact.id)?facts.map(item=>item.id===fact.id?fact:item):[...facts,fact]};
    });
  }
  function openFact(value: Fact | true, transition=false){
    setFactForm(value);setFactTransition(transition);
  }
  async function saveFact(data:FactWrite,event?:string){
    if(!entity||!factForm)return;
    let fact:Fact;
    if(factForm!==true&&event){
      fact=await periodsApi.transitionFact(world,factForm.id,{...data,event_id:event});
      updateFactInView({...factForm,version:(data.version??factForm.version)+1,to_event_id:event});
    }else fact=factForm===true?await creationApi.fact(entity.id,data):await creationApi.editFact(factForm.id,data);
    updateFactInView(fact);
    setFactForm(null);
  }
  if(!entity)return <main id="main-content" className="page">{error?<ErrorNotice>{error}</ErrorNotice>:<p>正在读取对象…</p>}</main>;
  if(entity.merged_into)return <main id="main-content" className="entity-document page" inert={loading||entity.id!==entityId}><h1>{entity.name} · 已合并身份</h1><p>原始身份和来源仍保留，当前资料请查阅保留对象。</p><Link className="text-link" to={`/worlds/${world}/create/objects/${entity.merged_into}`}>打开保留对象 →</Link><Button onClick={()=>setHistory({kind:'entity',id:entity.id})}>查看合并历史</Button>{history&&<CanonHistoryDialog {...history} onClose={()=>setHistory(undefined)}/>}</main>;
  return <main id="main-content" className="entity-document page">{loading&&<p role="status">正在打开对象资料…</p>}{error&&entity.id!==entityId&&<><ErrorNotice>{error}</ErrorNotice><Button onClick={load}>重试</Button></>}<div aria-busy={loading} inert={loading||entity.id!==entityId}><ObjectBackLink to={listPath} label={category?'返回分类':'世界对象'}/><header className="entity-header" data-editing={editing}>
      <div className="entity-reading-identity">{entity.kind==='character'?<Portrait id={entity.id} name={entity.name} version={portraits[entity.id]} size="large"/>:entity.kind==='location'&&portraits[entity.id]?<DisplayImage owner="entity" id={entity.id} name={entity.name} version={portraits[entity.id]} className="entity-scene-thumb"/>:<EntityMark kind={entity.kind}/>}
        <div><span className="eyebrow">{entityKinds[entity.kind]} · {entity.status==='active'?'对象资料':entity.status==='archived'?'已归档':'已删除 / 可恢复'}</span>
          {editing?<input className="entity-title" aria-label="对象名称" value={entity.name} disabled={entity.status!=='active'} onChange={e=>edit({name:e.target.value})}/>:<h1>{entity.name}</h1>}
          {!editing&&<p className="entity-aliases">{entity.aliases.length?entity.aliases.join(' · '):'尚无别名'}</p>}
        </div>
        <div className="entity-reading-actions">
          {editing ? <>
            <Button onClick={async()=>{if(!dirty||await save())setEditing(false);}} disabled={busy||!!latest}>返回阅读</Button>
            <Button variant="primary" onClick={()=>void save()} disabled={busy||!!latest||!dirty||entity.status!=='active'}>{busy?'正在保存…':dirty?'保存资料':'已保存'}</Button>
          </> : <>
            <Button onClick={()=>setEditing(true)} disabled={entity.status!=='active'}><Pencil size={16}/>编辑资料</Button>
            {location.state?.mapWorld===world && <Button variant="ghost" onClick={()=>navigate(-1)}>返回地图</Button>}
            {fromExplore && <Button variant="ghost" onClick={()=>navigate(-1)}>返回探索</Button>}
            {entity.status==='active' && (
              <Link className="button button--ghost" to={withMoment(relationshipPath(world,{focus:`entity:${entity.id}`}),moment)}
                state={{relationshipOverview:location.state?.relationshipOverview,relationshipObject:world}}>在关系图查看</Link>
            )}
          </>}
          <Button variant="ghost" onClick={()=>setHistory({kind:'entity',id:entity.id})}>资料历史</Button>
        </div>
      </div>
      {editing&&<div className="entity-header-controls"><label>类型<select value={entity.kind} disabled={entity.status!=='active'} onChange={e=>{if(Object.values(entity.core||{}).some(Boolean)){setError('请先整理并清空当前类型的核心资料，再修改类型；旧值会保留在历史中。');return;}edit({kind:e.target.value,core:{},custom_type:''});}}>{Object.entries(entityKinds).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>别名<input aria-label="对象别名" value={aliasesText} disabled={entity.status!=='active'} onChange={e=>{setAliasesText(e.target.value);edit({aliases:e.target.value.split(/[，,]/).map(v=>v.trim()).filter(Boolean)});}}/></label></div>}
    </header>
    {error&&<ErrorNotice>{error}</ErrorNotice>}
    {latest&&<SaveConflict base={entity.version} current={latest.version} fields={objectComparison(latest,entity)}
      onContinue={latest.status==='active'&&!latest.merged_into?()=>{
        setEntity(current=>current?{...current,version:latest.version,facts:latest.facts,appearances:latest.appearances}:current);
        setLatest(undefined);
      }:undefined}/>}
    <div className="quiet-tabs object-tabs">{[['overview','概览'],['periods','时期与变化'],['facts','世界事实'],['sources','资料来源'],['appearances','正文出场'],
      ...(entity.kind==='location'?[['maps','地图位置']]:[])].map(([id,name])=><button key={id} onClick={()=>selectTab(id)} aria-pressed={tab===id}>{name}</button>)}</div>
    {tab==='maps'&&entity.kind==='location'&&<LocationMaps key={entity.id} world={world} entity={entity.id} moment={moment}/>}
    {tab==='periods'&&<ObjectPeriods key={entity.id} world={world} entity={entity} moment={moment}
      onChange={point=>setTab('periods',point)} onMap={()=>selectTab('maps')}/>}
    {tab!=='periods'&&!moment&&<EntityKeyProperties entity={entity} onOpenFacts={()=>selectTab('facts')}/>}{tab==='overview'&&<><div className="entity-overview-reading">{editing&&['character','location'].includes(entity.kind)&&<div className="object-portrait-setting">{entity.kind==='character'?<Portrait id={entity.id} name={entity.name} version={portraits[entity.id]} size="large"/>:<DisplayImage owner="entity" id={entity.id} name={entity.name} version={portraits[entity.id]} className="entity-scene-thumb"/>}<div><Button disabled={entity.status!=='active'} onClick={()=>setPortraitEditing(true)}>{entity.kind==='character'?'设置头像':'设置地点图片'}</Button><p className="context-hint">本地展示资料，独立于正式事实与角色知识。</p></div></div>}<ObjectSchemaFields world={world} entity={entity} onChange={edit} readOnly={!editing}/><p className="context-hint">说明与笔记可自由编辑。结构化世界事实在「世界事实」中单独确认；世界规则说明尚不代表可执行规则。</p>{!editing&&<section className="object-reading-sections">{entity.sections.filter(section=>section.body.trim()).map((section,index)=><article key={section.id||index}><h2>{section.title||'说明'}</h2><p>{section.body}</p></article>)}</section>}{editing&&entity.sections.map((section,index)=><details className="living-section" key={section.id||index} open><summary>{section.title||'说明段落'}</summary><header><input aria-label={`第 ${index+1} 节标题`} value={section.title} disabled={entity.status!=='active'} onChange={e=>edit({sections:entity.sections.map((s,i)=>i===index?{...s,title:e.target.value}:s)})}/><Button variant="ghost" aria-label="上移段落" disabled={index===0||entity.status!=='active'} onClick={()=>{const ss=[...entity.sections];[ss[index-1],ss[index]]=[ss[index],ss[index-1]];edit({sections:ss});}}><ArrowUp size={15}/></Button><Button variant="ghost" aria-label="下移段落" disabled={index===entity.sections.length-1||entity.status!=='active'} onClick={()=>{const ss=[...entity.sections];[ss[index+1],ss[index]]=[ss[index],ss[index+1]];edit({sections:ss});}}><ArrowDown size={15}/></Button><Button variant="ghost" aria-label="移除说明段落" disabled={entity.status!=='active'} onClick={()=>edit({sections:entity.sections.filter((_,i)=>i!==index)})}><Trash2 size={15}/></Button></header><textarea aria-label={section.title||'说明内容'} rows={4} value={section.body} placeholder="让这个对象更清晰一些…" disabled={entity.status!=='active'} onChange={e=>edit({sections:entity.sections.map((s,i)=>i===index?{...s,body:e.target.value}:s)})}/></details>)}<Button hidden={!editing} disabled={entity.status!=='active'} onClick={()=>edit({sections:[...entity.sections,{id:crypto.randomUUID(),title:'自定义说明',body:''}]})}><Plus size={16}/>添加说明段落</Button></div></>}
    {tab==='facts'&&<><div className="collection-heading"><h2>已确认的世界事实</h2><Button onClick={()=>openFact(true)} disabled={entity.status!=='active'}><Plus size={16}/>明确添加事实</Button></div>{entity.facts?.length?entity.facts.map(f=><section id={`fact-${f.id}`} className={`fact-row ${params.get('fact')===f.id?'canon-record--focused':''}`} key={f.id}><strong>{f.predicate} {f.status&&f.status!=='active'&&`· ${f.status==='withdrawn'?'已撤回':'已替代'}，保留历史`}</strong><p>{f.value}{f.object_id&&<> · <ObjectBrowseLink to={`${objectsPath(world)}/${f.object_id}`} focusId={`fact-reference-${f.id}`} backLabel="返回对象">查看引用对象 →</ObjectBrowseLink></>}</p><div className="canon-row-actions"><Button disabled={entity.status!=='active'||f.status!=='active'} onClick={()=>openFact(f)}>纠错</Button>{entity.status==='active'&&f.status==='active'&&!f.to_event_id&&<Button onClick={()=>openFact(f,true)}>记录历史变化</Button>}<Button disabled={entity.status!=='active'||f.status==='superseded'} onClick={()=>setRecordAction({fact:f,status:f.status==='withdrawn'?'active':'withdrawn'})}>{f.status==='withdrawn'?'恢复事实':'撤回事实'}</Button><Button variant="ghost" onClick={()=>setHistory({kind:'assertion',id:f.id})}>修改历史</Button></div><span>{f.from_event_id?'从事件起':f.valid_from||'起始未知'} → {f.to_event_id?'至变更事件':f.valid_until||'结束未知'} · {f.source_note}</span>{f.sources?.map(id=><Link className="text-link" key={id} to={`/worlds/${world}/review?candidate=${id}`}>查看裁决与原文来源 →</Link>)}<CanonSources record={{id:f.id}} kind="assertion" world={world}/><MaterialSources world={world} kind="assertion" identity={f.id} editable={entity.status==='active'&&f.status==='active'}/></section>):<p className="context-hint">尚无已确认事实。正文里的陈述不会自动出现在这里。</p>}</>}
    {tab==='sources'&&<MaterialSources world={world} kind="entity" identity={entity.id} editable={entity.status==='active'&&!dirty}/>}
    {tab==='ai'&&<EntitySourceProposals key={entity.id} world={world} entityId={entity.id} enabled={!dirty&&entity.status==='active'}/> }
    {tab==='appearances'&&<><h2>正文出场与来源</h2>{entity.appearances?.length?entity.appearances.map((a,i)=><Link key={`${a.id}-${i}`} className="appearance-row" to={`/worlds/${world}/create/source?${new URLSearchParams({node_id:a.id,entity_id:entity.id,version:String(a.version),start:String(a.start),end:String(a.end)})}`}><strong>{a.title}</strong><span>「{a.quote}」 · {a.status==='active'?'当前版本':'已收起文档'}</span></Link>):<p className="context-hint">将正文选区链接到此对象后，可从这里返回原文。</p>}</>}
    <Link className="text-link" to={`/worlds/${world}/create/records?entity=${entity.id}`}>查看世界事件与时态关系 →</Link><footer className="entity-management"><Button disabled={dirty||busy||entity.status!=='active'} onClick={()=>setMerging(true)}>合并到另一对象</Button>{entity.status==='active'?<><Button variant="ghost" onClick={()=>setConfirm('archived')}><Archive size={16}/>归档</Button><Button variant="danger" onClick={()=>setConfirm('deleted')}><Trash2 size={16}/>删除（可恢复）</Button></>:<Button onClick={()=>void save({status:'active'})}><RotateCcw size={16}/>恢复对象</Button>}</footer>
    {confirm&&<Dialog title={confirm==='deleted'?'移入已删除对象？':'归档对象？'} onClose={()=>setConfirm(null)} busy={busy}><p className="dialog-intro">正文链接与历史身份会保留，可从对象列表恢复。此操作会同时保存当前资料修改。</p><div className="dialog-actions"><Button onClick={()=>setConfirm(null)}>取消</Button><Button onClick={()=>void save({status:confirm})} disabled={busy}>确认</Button></div></Dialog>}
    {factForm&&<FactEditor world={world} entity={entity} initial={factForm===true?undefined:factForm} transition={factTransition} onClose={()=>setFactForm(null)} onSubmit={saveFact}/>}
    {portraitEditing&&entity.kind==='location'&&<DisplayImageEditor owner="entity" id={entity.id} name={entity.name} world={world} onClose={()=>setPortraitEditing(false)}/>}
    {portraitEditing&&entity.kind!=='location'&&<PortraitEditor id={entity.id} name={entity.name} world={world} onSaved={()=>{void reloadPortraits().catch(e=>setError(e.message))}} onClose={()=>setPortraitEditing(false)}/>}
    {history&&<CanonHistoryDialog {...history} onClose={()=>setHistory(undefined)}/>}
    {merging&&<EntityMergeDialog entity={entity} onClose={()=>setMerging(false)} onMerged={id=>{setMerging(false);navigate(`/worlds/${world}/create/objects/${id}`);}}/>}
    {recordAction&&<Dialog title={recordAction.status==='active'?'恢复正式事实？':'撤回正式事实？'} onClose={()=>setRecordAction(undefined)} busy={busy}><p className="dialog-intro">{recordAction.fact.predicate}：{recordAction.fact.value}。历史及原始来源保留，此操作只改变这条事实的有效状态。</p>{error&&<ErrorNotice>{error}</ErrorNotice>}<div className="dialog-actions"><Button onClick={()=>setRecordAction(undefined)}>取消</Button><Button variant="primary" disabled={busy} onClick={async()=>{setBusy(true);try{updateFactInView(await creationApi.canonStatus<Fact>('assertion',recordAction.fact.id,recordAction.fact.version,recordAction.status));setRecordAction(undefined);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>明确确认</Button></div></Dialog>}
    {blocker.state==='blocked'&&<Dialog title="对象资料尚未保存" onClose={()=>blocker.reset()}><p className="dialog-intro">保存资料后再离开，或留在这里继续编辑。</p>{error&&<ErrorNotice>{error}</ErrorNotice>}{latest&&<ErrorNotice>已保存版本有更新。打开编辑器可以对照草稿。</ErrorNotice>}<div className="dialog-actions"><Button onClick={()=>blocker.reset()} disabled={busy}>继续编辑</Button><Button variant="primary" disabled={busy||!!latest} onClick={async()=>{if(await save())blocker.proceed();}}>保存并离开</Button></div></Dialog>}
  </div></main>;
}
