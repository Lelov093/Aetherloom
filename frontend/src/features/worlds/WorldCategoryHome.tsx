import { useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Folder, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { mapPath } from '../maps/api';
import {
  categoriesApi, categoryDirectoryPath, categoryLabel, categoryPath, categoryTrail, objectsPath,
  useWorldCategories, type CategoryLayout,
} from './categories';

export function WorldCategoryHome({ world }: { world: string }) {
  const { layout, setLayout, error, reload } = useWorldCategories(world);
  const [editing, setEditing] = useState(false);
  const entries = (layout?.home_ids ?? []).flatMap(id => {
    const category = layout?.categories.find(item => item.id === id);
    return category ? [category] : [];
  });
  const explore = `/worlds/${world}/explore`;
  return <section className="world-classification" aria-labelledby="world-classification-heading">
    <div className="collection-heading">
      <h2 id="world-classification-heading">浏览世界</h2>
      {layout && <Button variant="ghost" onClick={() => setEditing(true)}>布置首页</Button>}
    </div>
    <nav className="category-shortcuts" aria-label="世界浏览入口">
      <Link className="text-link" to={categoryDirectoryPath(world)}>全部分类</Link>
      <Link className="text-link" to={objectsPath(world)}>全部对象</Link>
      {entries.length === 0 && <Link className="text-link" to={`${objectsPath(world)}?kind=character`}>人物</Link>}
      <Link className="text-link" to={explore}>关系网</Link>
      <Link className="text-link" to={explore + '?view=timeline'}>时间线</Link>
      <Link className="text-link" to={mapPath(world)}>地图</Link>
    </nav>
    {error && <><ErrorNotice>{error}</ErrorNotice><Button onClick={reload}>重新读取分类</Button></>}
    {layout && entries.length > 0 && <ul className="home-category-grid" aria-label="首页分类">
      {entries.map(category => <li key={category.id}>
        <Link to={categoryPath(world, category.id)}>
          <Folder size={19} aria-hidden="true" />
          <span>
            <strong>{category.name}</strong>
            {category.parent_id && <small>{categoryTrail(category, layout.categories).slice(0, -1).map(parent => parent.name).join(' / ')}</small>}
          </span>
        </Link>
      </li>)}
    </ul>}
    {layout && editing && <HomeArrangement key={world} world={world} layout={layout} onClose={() => setEditing(false)}
      onSaved={home_ids => { setLayout({ ...layout, home_ids }); setEditing(false); }} />}
  </section>;
}

function HomeArrangement({ world, layout, onClose, onSaved }: {
  world: string;
  layout: CategoryLayout;
  onClose: () => void;
  onSaved: (ids: string[]) => void;
}) {
  const [ids, setIds] = useState(layout.home_ids);
  const [selection, setSelection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const available = layout.categories.filter(category => !ids.includes(category.id));
  const labels = new Map(layout.categories.map(category => [category.id, categoryLabel(category, layout.categories)]));
  function reorder(index: number, target: number) {
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    setIds(next);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const saved = await categoriesApi.arrangeHome(world, layout.home_ids, ids);
      onSaved(saved.home_ids);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!layout.categories.length) return <Dialog title="布置首页" onClose={onClose}>
    <p className="context-hint">创建分类后，即可选择在首页显示哪些分类。</p>
    <div className="dialog-actions"><Link className="button button--primary" onClick={onClose} to={categoryDirectoryPath(world)}>前往全部分类</Link></div>
  </Dialog>;

  return <Dialog title="布置首页" onClose={onClose} busy={busy} focusFirstInput={false}>
    <form onSubmit={save}>
      <div className="category-field-choice">
        <label className="field">
          <span>可添加的分类</span>
          <select value={selection} disabled={busy || !available.length} onChange={event => setSelection(event.target.value)}>
            <option value="">选择分类</option>
            {available.map(category => <option key={category.id} value={category.id}>{labels.get(category.id)}</option>)}
          </select>
        </label>
        <Button type="button" disabled={!selection || busy} onClick={() => {
          setIds([...ids, selection]);
          setSelection('');
        }}>添加到首页</Button>
      </div>
      <ol className="category-setting-list" aria-label="首页显示顺序">
        {ids.map((id, index) => <li key={id}>
          <span>{labels.get(id)}</span>
          <div className="category-actions">
            <Button type="button" variant="ghost" aria-label={`上移 ${labels.get(id)}`} disabled={busy || index === 0} onClick={() => reorder(index, index - 1)}><ArrowUp size={16} /></Button>
            <Button type="button" variant="ghost" aria-label={`下移 ${labels.get(id)}`} disabled={busy || index === ids.length - 1} onClick={() => reorder(index, index + 1)}><ArrowDown size={16} /></Button>
            <Button type="button" variant="ghost" aria-label={`从首页移除 ${labels.get(id)}`} disabled={busy} onClick={() => setIds(ids.filter(item => item !== id))}><X size={16} /></Button>
          </div>
        </li>)}
      </ol>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions">
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="primary" disabled={busy}>{busy ? '正在保存…' : '保存首页'}</Button>
      </div>
    </form>
  </Dialog>;
}
