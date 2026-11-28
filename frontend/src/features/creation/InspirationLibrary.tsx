import { useEffect, useRef, useState } from 'react';
import { Archive, Feather, Plus, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { creationApi, type Inspiration, type InspirationPage, type InspirationVersion, type LibraryItem } from './api';
import { InspirationObjectPicker, InspirationObjects, type InspirationObject } from './InspirationObjects';
import { InspirationAssignmentEditor } from './InspirationAssignmentEditor';
import { InspirationLinkedContent, InspirationSourceLinks, InspirationWritingInfo } from './InspirationReferences';
import { InspirationAdoptionList } from './InspirationAdoptions';

type FormTarget = 'draft' | 'editing';
type InspirationForm = { title: string; note: string; tags: string; linked_nodes: string[]; objects: InspirationObject[] };
const emptyForm: InspirationForm = { title: '', note: '', tags: '', linked_nodes: [], objects: [] };

function formFromItem(item: Inspiration): InspirationForm {
  return { title: item.title, note: item.note, tags: item.tags.join('，'), linked_nodes: item.linked_node_ids, objects: item.linked_entities };
}

function sourceLabel(item: Inspiration) {
  return item.origin === 'simulation' ? '模拟观察' : '手工记录';
}

function InspirationHistory({ world, item, onClose }: { world: string; item: Inspiration; onClose: () => void }) {
  const [versions, setVersions] = useState<InspirationVersion[]>();
  const [version, setVersion] = useState(item.version);
  const [snapshot, setSnapshot] = useState<Inspiration>();
  const [listError, setListError] = useState('');
  const [readError, setReadError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setListError('');
    creationApi.inspirationHistory(world, item.id).then(data => { if (active) setVersions(data); })
      .catch(e => { if (active) setListError(e.message); });
    return () => { active = false; };
  }, [world, item.id, retry]);
  useEffect(() => {
    let active = true;
    setSnapshot(undefined);
    setReadError('');
    if (version !== item.version) creationApi.inspirationVersion(world, item.id, version)
      .then(data => { if (active) setSnapshot(data); }).catch(e => { if (active) setReadError(e.message); });
    return () => { active = false; };
  }, [world, item.id, item.version, version, retry]);
  const loaded = version === item.version ? item : snapshot?.version === version ? snapshot : undefined;
  const oldest = versions?.at(-1)?.version;
  return <Dialog title="灵感版本历史" onClose={onClose} focusFirstInput={false} className="inspiration-history">
    {versions ? <label className="field"><span>已保存版本</span>
      <select aria-label="已保存版本" value={version} onChange={e => setVersion(Number(e.target.value))}>
        {versions.map(row => <option key={row.version} value={row.version}>
          v{row.version}{row.version === versions[0].version ? ' · 最新' : ''} · {new Date(row.updated_at).toLocaleString('zh-CN')}
        </option>)}
      </select></label> : !listError && <p role="status">正在读取保存版本…</p>}
    {oldest !== undefined && oldest > 1 && <p className="context-hint">版本记录从 v{oldest} 起，较早修订未留存。</p>}
    {(listError || readError) && <><ErrorNotice>{listError || readError}</ErrorNotice>
      <Button onClick={() => setRetry(value => value + 1)}>重新读取</Button></>}
    {loaded ? <article aria-label={`灵感 v${loaded.version}`}>
      <h3>{loaded.title} · v{loaded.version}</h3>
      <small>{sourceLabel(loaded)} · {loaded.status === 'active' ? '收录中' : '已归档'}</small>
      {loaded.note && <p className="inspiration-history-note">{loaded.note}</p>}
      {loaded.tags.length > 0 && <p>{loaded.tags.join(' · ')}</p>}
      <InspirationWritingInfo world={world} item={loaded}/>
      <InspirationSourceLinks item={loaded}/>
      <InspirationLinkedContent world={world} item={loaded}/>
      {loaded.linked_entities.length > 0 && <InspirationObjects world={world} objects={loaded.linked_entities}/>}
    </article> : !readError && <p role="status">正在读取 v{version}…</p>}
  </Dialog>;
}

export function InspirationLibrary({ world, archived = false }: { world: string; archived?: boolean }) {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const nodeId = params.get('node') || '';
  const worldlineId = params.get('line') || '';
  const characterId = params.get('character') || '';
  const locationId = params.get('location') || '';
  const tag = params.get('tag') || '';
  const origin = params.get('origin') || '';
  const placement = params.get('placement') === 'unassigned' ? 'unassigned' : '';
  const selectedId = params.get('id');
  const statusParam = params.get('status');
  const status = statusParam === 'archived' || statusParam === 'all' ? statusParam : 'active';
  const rawOffset = Number(params.get('offset'));
  const offset = Number.isSafeInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  const [page, setPage] = useState<InspirationPage>();
  const [selected, setSelected] = useState<Inspiration>();
  const [materials, setMaterials] = useState<LibraryItem[]>([]);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [materialsError, setMaterialsError] = useState('');
  const [reload, setReload] = useState(0);
  const [detailRetry, setDetailRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [picker, setPicker] = useState<FormTarget>();
  const [draft, setDraft] = useState(emptyForm);
  const [editing, setEditing] = useState(emptyForm);
  const detailRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const currentId = useRef(selectedId);
  currentId.current = selectedId;

  useEffect(() => {
    let active = true;
    setListError('');
    const search = new URLSearchParams({ status, offset: String(offset), limit: '30' });
    const filters = { q: query, node_id: nodeId, worldline_id: worldlineId, character_id: characterId,
      location_id: locationId, tag, origin, placement };
    for (const [key, value] of Object.entries(filters)) if (value) search.set(key, value);
    creationApi.inspirations(world, search).then(data => { if (active) setPage(data); })
      .catch(e => { if (active) setListError(e.message); });
    return () => { active = false; };
  }, [world, query, nodeId, worldlineId, characterId, locationId, tag, origin, placement, status, offset, reload]);

  useEffect(() => {
    let active = true;
    setSelected(undefined);
    setDetailError('');
    setHistory(false);
    setAssigning(false);
    setError('');
    if (selectedId) creationApi.inspiration(selectedId).then(item => {
      if (!active) return;
      if (item.world_id !== world) throw new Error('这条灵感属于另一世界。');
      setSelected(item);
      setEditing(formFromItem(item));
    }).catch(e => { if (active) setDetailError(e.message); });
    return () => { active = false; };
  }, [world, selectedId, detailRetry]);

  const needsMaterials = !archived && (Boolean(selectedId) || creating);
  useEffect(() => {
    if (!needsMaterials) return;
    let active = true;
    setMaterialsError('');
    creationApi.contentLibrary(world, new URLSearchParams({ limit: '100' }))
      .then(data => { if (active) setMaterials(data.items); })
      .catch(e => { if (active) setMaterialsError(e.message); });
    return () => { active = false; };
  }, [world, needsMaterials]);

  const openId = selected?.id;
  useEffect(() => {
    if (openId && window.matchMedia('(max-width: 900px)').matches) detailRef.current?.scrollIntoView({ block: 'start' });
  }, [openId]);

  useEffect(() => { if (nodeId) setDraft(current => ({ ...current, linked_nodes: [nodeId] })); }, [nodeId]);

  function open(item: Inspiration) {
    const next = new URLSearchParams(params);
    next.set('id', item.id);
    next.delete('adoption');
    setParams(next);
  }

  function filter(key: string, value: string, replace = false) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('id');
    next.delete('adoption');
    next.delete('offset');
    setParams(next, { replace });
  }

  function changePage(nextOffset: number) {
    const next = new URLSearchParams(params);
    next.set('offset', String(nextOffset));
    next.delete('id');
    next.delete('adoption');
    setParams(next);
  }

  async function create() {
    if (!draft.title.trim()) return;
    setBusy(true); setError('');
    try {
      const item = await creationApi.createInspiration(world, {
        title: draft.title.trim(), note: draft.note, tags: draft.tags.split(/[，,]/).map(value=>value.trim()).filter(Boolean),
        linked_nodes: draft.linked_nodes, linked_entities: draft.objects.map(object => object.id),
      });
      setCreating(false);
      setDraft(emptyForm);
      const next = new URLSearchParams(nodeId ? { node: nodeId, id: item.id } : { id: item.id });
      setParams(next);
      setReload(value => value + 1);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!selected || !editing.title.trim()) return;
    setBusy(true); setError('');
    try {
      const item = await creationApi.updateInspiration(selected, {
        title: editing.title.trim(), note: editing.note, tags: editing.tags.split(/[，,]/).map(value=>value.trim()).filter(Boolean),
        linked_node_ids: editing.linked_nodes, linked_entity_ids: editing.objects.map(object => object.id),
      });
      if (currentId.current === item.id) { setSelected(item); setEditing(formFromItem(item)); }
      setReload(value => value + 1);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function changeStatus() {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const item = await creationApi.updateInspiration(selected, { status: selected.status === 'active' ? 'archived' : 'active' });
      if (currentId.current === item.id) setSelected(item);
      setReload(value => value + 1);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function toggleLink(value: string, target: FormTarget) {
    const update = (current: string[]) => current.includes(value) ? current.filter(id => id !== value) : [...current, value];
    if (target === 'draft') setDraft(current => ({ ...current, linked_nodes: update(current.linked_nodes) }));
    else setEditing(current => ({ ...current, linked_nodes: update(current.linked_nodes) }));
  }

  function changeObjects(target: FormTarget, update: (objects: InspirationObject[]) => InspirationObject[]) {
    const setForm = target === 'draft' ? setDraft : setEditing;
    setForm(current => ({ ...current, objects: update(current.objects) }));
  }

  return <main id="main-content" className="content-entry-page inspiration-page">
    <header className="reading-page-heading">
      <h1>灵感库</h1>
      <div className="inspiration-entry-actions">
        <Link className="text-link" to={`/worlds/${world}/review/history`}>旧候选记录 →</Link>
        {!archived && <Button variant="primary" onClick={() => { setError(''); setCreating(true); }}><Plus size={16}/>记录灵感</Button>}
      </div>
    </header>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    <div className="inspiration-search"><Search size={16}/><input aria-label="搜索灵感" value={query} maxLength={200} placeholder="搜索标题或笔记…" onChange={event => filter('q', event.target.value, true)}/></div>
    <div className="quiet-tabs inspiration-placement-filter" role="group" aria-label="分配筛选">
      <button type="button" aria-pressed={!placement} onClick={() => filter('placement', '')}>全部灵感</button>
      <button type="button" aria-pressed={placement === 'unassigned'} onClick={() => filter('placement', 'unassigned')}>未分配</button>
    </div>
    {page?.facets&&<section className="inspiration-facets" aria-label="灵感聚合"><h2>聚合浏览</h2><div className="inspiration-facet-groups">
      <label>世界线<select aria-label="按世界线筛选" value={worldlineId} onChange={e=>filter('line', e.target.value)}><option value="">全部世界线</option>{page.facets.worldlines.map(item=><option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
      <label>角色<select aria-label="按角色筛选" value={characterId} onChange={e=>filter('character', e.target.value)}><option value="">全部角色</option>{page.facets.characters.map(item=><option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
      <label>地点<select aria-label="按地点筛选" value={locationId} onChange={e=>filter('location', e.target.value)}><option value="">全部地点</option>{page.facets.locations.map(item=><option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
      <label>标签<select aria-label="按标签筛选" value={tag} onChange={e=>filter('tag', e.target.value)}><option value="">全部标签</option>{page.facets.tags.map(item=><option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
      <label>来源<select aria-label="按来源类型筛选" value={origin} onChange={e=>filter('origin', e.target.value)}><option value="">全部来源</option><option value="simulation">模拟观察</option><option value="manual">手工记录</option></select></label>
      <label>收录状态<select aria-label="按收录状态筛选" value={status} onChange={e=>filter('status', e.target.value === 'active' ? '' : e.target.value)}>
        <option value="active">收录中</option><option value="archived">已归档</option><option value="all">全部状态</option>
      </select></label>
    </div></section>}
    <div className="inspiration-layout">
      <section className="inspiration-list" aria-label="灵感列表" ref={listRef}>
        {listError ? <><ErrorNotice>{listError}</ErrorNotice><Button onClick={() => setReload(value => value + 1)}>重新读取灵感</Button></>
          : <p className="context-hint">{page ? `${page.total} 条记录` : '正在读取灵感…'}</p>}
        {page?.items.map(item => <button className={`inspiration-list-item ${selectedId === item.id ? 'selected' : ''}`} aria-current={selectedId === item.id ? 'true' : undefined} key={item.id} onClick={() => open(item)}>
          <strong>{item.title}</strong><small>{sourceLabel(item)} · {new Date(item.updated_at).toLocaleString('zh-CN')}</small>{item.note && <p>{item.note}</p>}
        </button>)}
        {page && !page.items.length && <p className="context-hint">还没有符合条件的灵感。可以从模拟事件保存，或手工记录一个想法。</p>}
        {page && (page.total > page.limit || offset > 0) && <div className="inspiration-entry-actions" aria-label="灵感分页">
          <Button disabled={!offset} onClick={() => changePage(Math.max(0, offset - page.limit))}>上一页</Button>
          <Button disabled={offset + page.limit >= page.total} onClick={() => changePage(offset + page.limit)}>下一页</Button>
        </div>}
      </section>
      <section className="inspiration-detail" aria-label="灵感详情" ref={detailRef}>
        {!selectedId && <div className="inspiration-empty"><Feather size={30}/><h2>选择一条灵感</h2></div>}
        {selectedId && (!selected || selected.id !== selectedId) && (detailError ? <>
          <ErrorNotice>{detailError}</ErrorNotice><Button onClick={() => setDetailRetry(value => value + 1)}>重新打开灵感</Button>
        </> : <p role="status">正在打开灵感…</p>)}
        {selected && selected.id === selectedId && <>
          <Button variant="ghost" className="inspiration-back-to-list" onClick={() => listRef.current?.scrollIntoView({ block: 'start' })}>返回灵感列表</Button>
          <div className="inspiration-detail-heading"><div><h2>{selected.title}</h2>
            <span className="inspiration-status">{sourceLabel(selected)} · v{selected.version} · {selected.status === 'active' ? '收录中' : '已归档'}</span></div>
            <Button variant="ghost" onClick={() => setHistory(true)}>版本历史</Button>
          </div>
          <InspirationWritingInfo world={world} item={selected} onEdit={archived || busy ? undefined : () => setAssigning(true)}/>
          <InspirationAdoptionList key={selected.id} world={world} kind="inspiration" id={selected.id} activeId={params.get('adoption')}/>
          <InspirationSourceLinks item={selected}/>
          <InspirationLinkedContent world={world} item={selected}/>
          <label className="field"><span>标题</span><input value={editing.title} maxLength={160} readOnly={archived} onChange={event => setEditing(current => ({ ...current, title: event.target.value }))}/></label>
          <label className="field"><span>创作笔记</span><textarea value={editing.note} maxLength={20000} rows={8} readOnly={archived} onChange={event => setEditing(current => ({ ...current, note: event.target.value }))}/></label>
          <label className="field"><span>标签（逗号分隔）</span><input maxLength={800} value={editing.tags} readOnly={archived} onChange={event => setEditing(current => ({ ...current, tags: event.target.value }))}/></label>
          <InspirationObjects world={world} objects={editing.objects} disabled={busy}
            onChoose={archived ? undefined : () => setPicker('editing')}
            onRemove={archived ? undefined : id => changeObjects('editing', objects => objects.filter(object => object.id !== id))}/>
          {!archived && <>
            <details className="inspiration-links"><summary>选择关联资料</summary>
              {materialsError && <ErrorNotice>{materialsError}</ErrorNotice>}
              {materials.map(item => <label key={item.id}><input type="checkbox" disabled={busy} checked={editing.linked_nodes.includes(item.id)} onChange={() => toggleLink(item.id, 'editing')}/><span>{item.work_title || '作品'} · {item.title}</span></label>)}
            </details>
            <div className="dialog-actions"><Button variant="primary" disabled={busy || !editing.title.trim()} onClick={() => void save()}>保存修改</Button>
              <Button variant="ghost" disabled={busy} onClick={() => void changeStatus()}><Archive size={15}/>{selected.status === 'active' ? '归档灵感' : '恢复灵感'}</Button>
            </div>
          </>}
        </>}
      </section>
    </div>
    {creating && <Dialog title="记录一条灵感" busy={busy} onClose={() => setCreating(false)}>
      <label className="field"><span>标题</span><input maxLength={160} value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))}/></label>
      <InspirationObjects objects={draft.objects} disabled={busy}
        onChoose={() => setPicker('draft')} onRemove={id => changeObjects('draft', objects => objects.filter(object => object.id !== id))}/>
      <label className="field"><span>创作笔记</span><textarea maxLength={20000} rows={7} value={draft.note} onChange={event => setDraft(current => ({ ...current, note: event.target.value }))}/></label>
      <label className="field"><span>标签（逗号分隔）</span><input maxLength={800} value={draft.tags} onChange={event => setDraft(current => ({ ...current, tags: event.target.value }))} placeholder="例如：关系转折，港口"/></label>
      {materialsError && <ErrorNotice>{materialsError}</ErrorNotice>}
      <div className="inspiration-links"><h3>关联资料</h3>{materials.slice(0, 100).map(item => <label key={item.id}><input type="checkbox" checked={draft.linked_nodes.includes(item.id)} onChange={() => toggleLink(item.id, 'draft')}/><span>{item.work_title || '作品'} · {item.title}</span></label>)}</div>
      <div className="dialog-actions"><Button variant="ghost" disabled={busy} onClick={() => setCreating(false)}>取消</Button><Button variant="primary" disabled={busy || !draft.title.trim()} onClick={() => void create()}>保存灵感</Button></div>
    </Dialog>}
    {picker && <InspirationObjectPicker world={world} objects={picker === 'draft' ? draft.objects : editing.objects}
      onClose={() => setPicker(undefined)} onPick={object => changeObjects(picker, objects => [...objects, object])}/>}
    {history && selected && selected.id === selectedId && <InspirationHistory world={world} item={selected} onClose={() => setHistory(false)}/>}
    {assigning && selected && selected.id === selectedId && <InspirationAssignmentEditor world={world} item={selected}
      onClose={() => setAssigning(false)} onSaved={item => {
        setAssigning(false);
        if (currentId.current === item.id) setSelected(item);
        setReload(value => value + 1);
      }}/>}
  </main>;
}
