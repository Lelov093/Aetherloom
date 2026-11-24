import { useEffect, useState } from 'react';
import { ArrowUpRight, Archive, Feather, Plus, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { creationApi, type Inspiration, type LibraryItem, type LibraryPage } from './api';

function sourceLabel(item: Inspiration) {
  return item.origin === 'simulation' ? '模拟观察' : '手工记录';
}

export function InspirationLibrary({ world }: { world: string }) {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const nodeId = params.get('node') || '';
  const worldlineId = params.get('line') || '';
  const characterId = params.get('character') || '';
  const locationId = params.get('location') || '';
  const tag = params.get('tag') || '';
  const origin = params.get('origin') || '';
  const selectedId = params.get('id');
  const [page, setPage] = useState<{ items: Inspiration[]; total: number; offset: number; limit: number; facets?: {worldlines:{value:string;label:string;count:number}[];characters:{value:string;label:string;count:number}[];locations:{value:string;label:string;count:number}[];tags:{value:string;label:string;count:number}[]} }>();
  const [selected, setSelected] = useState<Inspiration>();
  const [materials, setMaterials] = useState<LibraryItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: '', note: '', tags: '', linked_nodes: [] as string[] });
  const [editing, setEditing] = useState({ title: '', note: '', tags: '', linked_nodes: [] as string[] });

  async function loadMaterials() {
    if (materials.length) return materials;
    const result: LibraryPage = await creationApi.contentLibrary(world, new URLSearchParams({ limit: '100' }));
    setMaterials(result.items);
    return result.items;
  }

  async function load() {
    setError('');
    try {
      const next = await creationApi.inspirations(world, new URLSearchParams({ q: query, ...(nodeId ? { node_id: nodeId } : {}), ...(worldlineId ? { worldline_id: worldlineId } : {}), ...(characterId ? { character_id: characterId } : {}), ...(locationId ? { location_id: locationId } : {}), ...(tag ? { tag } : {}), ...(origin ? { origin } : {}), limit: '30' }));
      setPage(next);
      if (selectedId) {
        const item = await creationApi.inspiration(selectedId);
        await loadMaterials();
        setSelected(item);
        setEditing({ title: item.title, note: item.note, tags: item.tags.join('，'), linked_nodes: item.linked_node_ids });
      } else {
        setSelected(undefined);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => { void load(); }, [world, query, nodeId, worldlineId, characterId, locationId, tag, origin, selectedId]);

  useEffect(() => { if (nodeId) setDraft(current => ({ ...current, linked_nodes: [nodeId] })); }, [nodeId]);

  function open(item: Inspiration) {
    setParams(previous => { previous.set('id', item.id); return previous; });
  }

  async function create() {
    if (!draft.title.trim()) return;
    setBusy(true); setError('');
    try {
      const item = await creationApi.createInspiration(world, { title: draft.title.trim(), note: draft.note, tags: draft.tags.split(/[，,]/).map(value=>value.trim()).filter(Boolean), linked_nodes: draft.linked_nodes });
      setCreating(false);
      setDraft({ title: '', note: '', tags: '', linked_nodes: [] });
      setParams(previous => { previous.set('id', item.id); return previous; });
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!selected || !editing.title.trim()) return;
    setBusy(true); setError('');
    try {
      const item = await creationApi.updateInspiration(selected, { title: editing.title.trim(), note: editing.note, tags: editing.tags.split(/[，,]/).map(value=>value.trim()).filter(Boolean), linked_node_ids: editing.linked_nodes });
      setSelected(item); setEditing({ title: item.title, note: item.note, tags: item.tags.join('，'), linked_nodes: item.linked_node_ids });
      setPage(current => current && { ...current, items: current.items.map(value => value.id === item.id ? item : value) });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function archive() {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const item = await creationApi.updateInspiration(selected, { status: 'archived' });
      setSelected(item); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function toggleLink(value: string, target: 'draft' | 'editing') {
    const update = (current: string[]) => current.includes(value) ? current.filter(id => id !== value) : [...current, value];
    if (target === 'draft') setDraft(current => ({ ...current, linked_nodes: update(current.linked_nodes) }));
    else setEditing(current => ({ ...current, linked_nodes: update(current.linked_nodes) }));
  }

  return <main id="main-content" className="content-entry-page inspiration-page">
    <header className="reading-page-heading">
      <div><span className="eyebrow">INSPIRATION BOX</span><h1>灵感与观察</h1><p>保存模拟中的片段和自己的想法，保留来源，继续回到创作。</p></div>
      <Button variant="primary" onClick={() => { setError(''); setCreating(true); void loadMaterials(); }}><Plus size={16}/>记录灵感</Button>
    </header>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    <div className="inspiration-search"><Search size={16}/><input aria-label="搜索灵感" value={query} placeholder="搜索标题或笔记…" onChange={event => setParams(previous => { const value = event.target.value; if (value) previous.set('q', value); else previous.delete('q'); previous.delete('id'); return previous; })}/></div>
    {page?.facets&&<section className="inspiration-facets" aria-label="灵感聚合"><h2>聚合浏览</h2><div className="inspiration-facet-groups">
      <label>世界线<select aria-label="按世界线筛选" value={worldlineId} onChange={event=>setParams(previous=>{const value=event.target.value;if(value)previous.set('line',value);else previous.delete('line');previous.delete('id');return previous;})}><option value="">全部世界线</option>{page.facets.worldlines.map(item=><option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
      <label>角色<select aria-label="按角色筛选" value={characterId} onChange={event=>setParams(previous=>{const value=event.target.value;if(value)previous.set('character',value);else previous.delete('character');previous.delete('id');return previous;})}><option value="">全部角色</option>{page.facets.characters.map(item=><option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
      <label>地点<select aria-label="按地点筛选" value={locationId} onChange={event=>setParams(previous=>{const value=event.target.value;if(value)previous.set('location',value);else previous.delete('location');previous.delete('id');return previous;})}><option value="">全部地点</option>{page.facets.locations.map(item=><option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
      <label>标签<select aria-label="按标签筛选" value={tag} onChange={event=>setParams(previous=>{const value=event.target.value;if(value)previous.set('tag',value);else previous.delete('tag');previous.delete('id');return previous;})}><option value="">全部标签</option>{page.facets.tags.map(item=><option key={item.value} value={item.value}>{item.label} · {item.count}</option>)}</select></label>
      <label>来源<select aria-label="按来源类型筛选" value={origin} onChange={event=>setParams(previous=>{const value=event.target.value;if(value)previous.set('origin',value);else previous.delete('origin');previous.delete('id');return previous;})}><option value="">全部来源</option><option value="simulation">模拟观察</option><option value="manual">手工记录</option></select></label>
    </div></section>}
    <div className="inspiration-layout">
      <section className="inspiration-list" aria-label="灵感列表">
        <p className="context-hint">{page ? `${page.total} 条记录` : '正在读取灵感…'}</p>
        {page?.items.map(item => <button className={`inspiration-list-item ${selected?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => open(item)}>
          <strong>{item.title}</strong><small>{sourceLabel(item)} · {new Date(item.updated_at).toLocaleString('zh-CN')}</small>{item.note && <p>{item.note}</p>}
        </button>)}
        {page && !page.items.length && <p className="context-hint">还没有符合条件的灵感。可以从模拟事件保存，或手工记录一个想法。</p>}
      </section>
      <section className="inspiration-detail" aria-label="灵感详情">
        {!selected && <div className="inspiration-empty"><Feather size={30}/><h2>选择一条灵感</h2><p>灵感保存后仍保持与原模拟事件和资料的来源关系。</p></div>}
        {selected && <>
          <div className="inspiration-detail-heading"><span className="eyebrow">{sourceLabel(selected)}</span><span className="inspiration-status">{selected.status === 'active' ? '收录中' : '已归档'}</span></div>
          <label className="field"><span>标题</span><input value={editing.title} maxLength={160} onChange={event => setEditing(current => ({ ...current, title: event.target.value }))}/></label>
          <label className="field"><span>创作笔记</span><textarea value={editing.note} maxLength={20000} rows={8} onChange={event => setEditing(current => ({ ...current, note: event.target.value }))}/></label>
          <label className="field"><span>标签（逗号分隔）</span><input maxLength={800} value={editing.tags} onChange={event => setEditing(current => ({ ...current, tags: event.target.value }))}/></label>
          <div className="inspiration-links"><h3>关联资料</h3>{materials.length ? materials.slice(0, 100).map(item => <label key={item.id}><input type="checkbox" checked={editing.linked_nodes.includes(item.id)} onChange={() => toggleLink(item.id, 'editing')}/><span>{item.work_title || '作品'} · {item.title}</span></label>) : <p className="context-hint">打开编辑时读取资料列表。</p>}</div>
          {selected.linked_nodes.length > 0 && <div className="inspiration-linked"><h3>已关联内容</h3>{selected.linked_nodes.map(node => <Link key={node.id} to={`/worlds/${world}/create?work=${node.work_id}&node=${node.id}&mode=read`}>{node.work_title} · {node.title}<ArrowUpRight size={14}/></Link>)}</div>}
          {selected.source?.route && <div className="inspiration-source"><h3>来源</h3><p>{selected.source.summary || '已保存的模拟事件'}</p>{selected.source.events?.length ? <div className="inspiration-source-events">{selected.source.events.map(event=><Link key={`${event.worldline_id}:${event.seq}`} to={event.route || selected.source.route!}>第{event.seq}步 · {event.summary || event.action_type || '已提交记录'}<ArrowUpRight size={14}/></Link>)}</div> : <Link to={selected.source.route}>回到第{selected.source.seq}步的世界线<ArrowUpRight size={14}/></Link>}<small>世界线 {selected.source.worldline_id} · {selected.source.event_count || 1} 条来源事件</small></div>}
          <div className="dialog-actions"><Button variant="primary" disabled={busy || !editing.title.trim()} onClick={() => void save()}>保存修改</Button>{selected.status === 'active' && <Button variant="ghost" disabled={busy} onClick={() => void archive()}><Archive size={15}/>归档灵感</Button>}</div>
        </>}
      </section>
    </div>
    {creating && <Dialog title="记录一条灵感" busy={busy} onClose={() => setCreating(false)}>
      <label className="field"><span>标题</span><input maxLength={160} value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))}/></label>
      <label className="field"><span>创作笔记</span><textarea maxLength={20000} rows={7} value={draft.note} onChange={event => setDraft(current => ({ ...current, note: event.target.value }))}/></label>
      <label className="field"><span>标签（逗号分隔）</span><input maxLength={800} value={draft.tags} onChange={event => setDraft(current => ({ ...current, tags: event.target.value }))} placeholder="例如：关系转折，港口"/></label>
      <div className="inspiration-links"><h3>关联资料</h3>{materials.slice(0, 100).map(item => <label key={item.id}><input type="checkbox" checked={draft.linked_nodes.includes(item.id)} onChange={() => toggleLink(item.id, 'draft')}/><span>{item.work_title || '作品'} · {item.title}</span></label>)}</div>
      <div className="dialog-actions"><Button variant="ghost" disabled={busy} onClick={() => setCreating(false)}>取消</Button><Button variant="primary" disabled={busy || !draft.title.trim()} onClick={() => void create()}>保存灵感</Button></div>
    </Dialog>}
  </main>;
}
