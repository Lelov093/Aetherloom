import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, ArrowUpRight, Globe2, Plus, Search, Sparkles } from 'lucide-react';
import { Button, EmptyState, ErrorNotice } from '../../components/ui';
import { WorldHorizon } from '../../components/WorldHorizon';
import { worldApi, type World } from './api';
import { WorldForm } from './WorldForm';

export function WorldLibrary() {
  const [params, setParams] = useSearchParams();
  const archived = params.get('view') === 'archived';
  const query = params.get('q') ?? '';
  const [worlds, setWorlds] = useState<World[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    worldApi.list(archived).then(result => { if (active) setWorlds(result); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [archived, reload]);
  const visible = worlds.filter(w => `${w.name} ${w.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function changeQuery(value: string) { setParams(previous => { if (value) previous.set('q', value); else previous.delete('q'); return previous; }, { replace: true }); }
  return <main id="main-content" className="library page">
    <section className="library-intro"><div className="intro-copy"><span className="eyebrow">A PLACE FOR YOUR WORLDS</span><h1>每个世界，<br />都从一束灵感开始。</h1><p>收藏想象，梳理故事。<br />让你笔下的人与远方，拥有彼此的联系。</p><Button variant="primary" onClick={() => setCreating(true)}><Plus size={18} />创建世界</Button></div><WorldHorizon /></section>
    <section className="world-collection" aria-labelledby="worlds-title">
      <div className="collection-heading"><div><span className="eyebrow">YOUR COLLECTION</span><h2 id="worlds-title">我的世界</h2></div><label className="search-field"><Search size={17} /><input aria-label="搜索世界" placeholder="搜索名称或简介…" value={query} onChange={e => changeQuery(e.target.value)} /></label></div>
      <div className="collection-tabs"><div role="group" aria-label="世界筛选"><button className={!archived ? 'active' : ''} aria-pressed={!archived} onClick={() => setParams(query ? { q: query } : {})}>正在创作</button><button className={archived ? 'active' : ''} aria-pressed={archived} onClick={() => setParams({ view: 'archived', ...(query ? { q: query } : {}) })}><Archive size={14} />已归档</button></div><span>{!loading && !error ? `${visible.length} 个世界` : ''}</span></div>
      {error ? <div className="loading-state"><ErrorNotice>{error}</ErrorNotice><Button onClick={() => setReload(n => n + 1)}>重试</Button></div> : loading ? <p className="loading-state" role="status">正在打开世界库…</p> : visible.length ? <div className="world-grid">{visible.map(world => <Link className="world-card" key={world.id} to={`/worlds/${world.id}`}><div className="world-card-art"><Globe2 size={30} strokeWidth={1.1} /><span>{world.archived ? 'ARCHIVED WORLD' : 'A WORLD IN THE MAKING'}</span><ArrowUpRight size={19} /></div><div className="world-card-body"><h3>{world.name}</h3><p>{world.description || '故事尚未写下，一切皆有可能。'}</p><div className="world-card-footer"><span>{world.archived ? '已归档 · 可恢复' : '打开世界'}</span><time dateTime={world.updated_at}>{new Date(world.updated_at).toLocaleDateString('zh-CN')}</time></div></div></Link>)}</div> : <EmptyState icon={archived ? <Archive size={28} /> : <Sparkles size={30} strokeWidth={1.2} />} title={query ? '还没有找到这个世界' : archived ? '没有归档的世界' : '为想象，留一个位置'} action={query ? <Button onClick={() => changeQuery('')}>清除搜索</Button> : !archived ? <Button variant="secondary" onClick={() => setCreating(true)}><Plus size={16} />创建第一个世界</Button> : undefined}>{query ? '试试其他名字，或清除搜索条件。' : archived ? '暂时收起的世界会保留在这里，随时可以回来。' : '只需要一个名字，就可以开启你的世界。'}</EmptyState>}
    </section>
    <footer className="page-footer"><span className="local-dot" />保存在本机<span className="footer-poem">让想象，有迹可循。</span></footer>
    {creating && <WorldForm onClose={() => setCreating(false)} onSaved={world => navigate(`/worlds/${world.id}`)} />}
  </main>;
}
