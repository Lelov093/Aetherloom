import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Folder, Plus, Search } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Dialog, EmptyState, ErrorNotice } from '../../components/ui';
import { ObjectBrowser } from '../objects/ObjectBrowser';
import { usePortraits } from '../objects/Portrait';
import {
  categoriesApi, categoryDirectoryPath, categoryLabel, categoryPath, categoryTrail,
  objectsPath, useWorldCategories, type WorldCategory,
} from '../worlds/categories';
import { creationApi, entityKinds, type Entity, type ObjectSchema } from './api';
import { CategoryEditor } from './CategoryEditor';
import { WorldObjectCard } from './WorldObjectCard';
import { useObjectFilters } from './ObjectNavigation';

export function WorldCategories({ world, categoryId, archived }: {
  world: string;
  categoryId: string | null;
  archived: boolean;
}) {
  const navigate = useNavigate();
  const { layout, setLayout, error, reload } = useWorldCategories(world);
  const [editor, setEditor] = useState<'create' | 'edit'>();
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [schema, setSchema] = useState<ObjectSchema>();
  const [schemaError, setSchemaError] = useState('');
  const [schemaRetry, setSchemaRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setSchemaError('');
    creationApi.schema(world).then(value => {
      if (active) setSchema(value);
    }).catch(error => {
      if (active) setSchemaError(error.message);
    });
    return () => { active = false; };
  }, [world, schemaRetry]);

  const category = layout?.categories.find(item => item.id === categoryId);
  const trail = category && layout ? categoryTrail(category, layout.categories) : [];
  const hasChildren = category && layout?.categories.some(item => item.parent_id === category.id);
  const heading = category?.name || '全部分类';

  async function removeCategory() {
    if (!category || !layout) return;
    setBusy(true);
    setRemoveError('');
    try {
      await categoriesApi.remove(world, category);
      setLayout({
        categories: layout.categories.filter(item => item.id !== category.id),
        home_ids: layout.home_ids.filter(id => id !== category.id),
      });
      setRemoving(false);
      navigate(category.parent_id ? categoryPath(world, category.parent_id) : categoryDirectoryPath(world));
    } catch (error) {
      setRemoveError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <main id="main-content" className="object-library category-page page">
    <nav className="category-trail" aria-label="分类路径">
      <Link className="back-link" to={`/worlds/${world}`}><ArrowLeft size={16} />世界首页</Link>
      {categoryId && <Link className="text-link" to={categoryDirectoryPath(world)}>全部分类</Link>}
      {trail.slice(0, -1).map(parent => <Link key={parent.id} className="text-link" to={categoryPath(world, parent.id)}>{parent.name}</Link>)}
    </nav>
    <header className="reading-page-heading category-heading">
      <h1>{heading}</h1>
      <div className="category-actions">
        <Link className="button button--ghost" to={objectsPath(world)}>全部对象</Link>
        {!archived && layout && schema && (!categoryId || category) && <>
          {category && <Button onClick={() => setEditor('edit')}>编辑分类</Button>}
          <Button onClick={() => setEditor('create')}><Plus size={16} />{category ? '新建子分类' : '新建分类'}</Button>
        </>}
      </div>
    </header>
    {error && <><ErrorNotice>{error}</ErrorNotice><Button onClick={reload}>重新读取分类</Button></>}
    {schemaError && <><ErrorNotice>{schemaError}</ErrorNotice><Button onClick={() => setSchemaRetry(n => n + 1)}>重新读取卡面字段</Button></>}
    {(!layout && !error || !schema && !schemaError) && <p role="status">正在读取分类…</p>}
    {layout && categoryId && !category && <ErrorNotice>此分类已移除或不属于当前世界。</ErrorNotice>}
    {layout && !categoryId && <>
      {layout.categories.length > 0
        ? <CategoryTree world={world} categories={layout.categories} parent={null} />
        : <p className="context-hint">还没有自定义分类。</p>}
      <section className="category-type-links">
        <h2>按对象类型浏览</h2>
        <nav className="category-shortcuts" aria-label="对象类型入口">
          {Object.entries(entityKinds).map(([kind, label]) => <Link key={kind} className="text-link"
            to={`${objectsPath(world)}?kind=${kind}`}>{label}</Link>)}
        </nav>
      </section>
    </>}
    {category && layout && <>
      {hasChildren && <section className="category-children">
        <h2>子分类</h2>
        <CategoryTree world={world} categories={layout.categories} parent={category.id} />
      </section>}
      {schema && <CategoryExhibit key={category.id} world={world} category={category} categories={layout.categories}
        core={schema.core} archived={archived} />}
      {!archived && !hasChildren && <Button variant="ghost" onClick={() => { setRemoveError(''); setRemoving(true); }}>删除分类</Button>}
    </>}
    {layout && schema && editor && <CategoryEditor world={world} categories={layout.categories}
      category={editor === 'edit' ? category : undefined} parentId={category?.id} core={schema.core}
      onClose={() => setEditor(undefined)} onSaved={saved => {
        setLayout({ ...layout, categories: [...layout.categories.filter(item => item.id !== saved.id), saved] });
        setEditor(undefined);
        if (editor === 'create') navigate(categoryPath(world, saved.id));
      }} />}
    {removing && category && <Dialog title="删除分类" onClose={() => setRemoving(false)} busy={busy} focusFirstInput={false}>
      <p>删除「{category.name}」及其陈列位置。对象资料和其他分类中的卡片保留。</p>
      {removeError && <ErrorNotice>{removeError}</ErrorNotice>}
      <div className="dialog-actions">
        <Button type="button" disabled={busy} onClick={() => setRemoving(false)}>取消</Button>
        <Button type="button" variant="danger" disabled={busy} onClick={() => void removeCategory()}>确认删除分类</Button>
      </div>
    </Dialog>}
  </main>;
}

function CategoryTree({ world, categories, parent }: {
  world: string;
  categories: WorldCategory[];
  parent: string | null;
}) {
  const items = categories.filter(item => item.parent_id === parent).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  if (!items.length) return null;
  return <ul className="category-tree">
    {items.map(category => <li key={category.id}>
      <Link to={categoryPath(world, category.id)}><Folder size={17} aria-hidden="true" />{category.name}</Link>
      <CategoryTree world={world} categories={categories} parent={category.id} />
    </li>)}
  </ul>;
}

function CategoryExhibit({ world, category, categories, core, archived }: {
  world: string;
  category: WorldCategory;
  categories: WorldCategory[];
  core: ObjectSchema['core'];
  archived: boolean;
}) {
  const { portraits } = usePortraits(world);
  const [objects, setObjects] = useState<Entity[]>();
  const [params, setFilter] = useObjectFilters();
  const query = params.get('q') ?? '';
  const [picking, setPicking] = useState(false);
  const [moving, setMoving] = useState<Entity>();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoadError('');
    categoriesApi.objects(world, category.id).then(value => {
      if (active) setObjects(value);
    }).catch(error => {
      if (active) setLoadError(error.message);
    });
    return () => { active = false; };
  }, [world, category.id, revision]);
  const visible = objects?.filter(entity => `${entity.name} ${entity.aliases.join(' ')}`.toLowerCase().includes(query.toLowerCase().trim()));

  async function unplace(entity: Entity) {
    setError('');
    setPending(entity.id);
    try {
      await categoriesApi.unplace(world, category.id, entity.id);
      setObjects(items => items?.filter(item => item.id !== entity.id));
      setRevision(n => n + 1);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setPending(undefined);
    }
  }
  return <section className="category-exhibit" aria-label={`${category.name}的卡片`}>
    <div className="category-card-tools">
      <label className="search-field"><Search size={17} /><input aria-label="在本分类查找" placeholder="搜索名称或别名…"
        value={query} onChange={event => setFilter('q', event.target.value)} /></label>
      {!archived && <Button variant="primary" disabled={!!pending} onClick={() => setPicking(true)}><Plus size={16} />添加已有对象</Button>}
    </div>
    {loadError && <><ErrorNotice>{loadError}</ErrorNotice><Button onClick={() => setRevision(n => n + 1)}>重新读取卡片</Button></>}
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {!objects && !loadError && <p role="status">正在读取卡片…</p>}
    {objects && <p className="category-count" role="status">{visible?.length} 张卡片</p>}
    {visible && (visible.length ? <div className="object-card-grid">
      {visible.map(entity => <article key={entity.id} className="category-object">
        <WorldObjectCard
          entity={entity}
          to={`${objectsPath(world)}/${entity.id}?${new URLSearchParams({ category: category.id })}`}
          imageVersion={portraits[entity.id]}
          fields={category.card_fields}
          core={core}
        />
        {!archived && <div className="category-object-actions">
          {categories.length > 1 && <Button variant="ghost" aria-label={`移动 ${entity.name} 的陈列`}
            disabled={!!pending} onClick={() => setMoving(entity)}>移动</Button>}
          <Button variant="ghost" aria-label={`将 ${entity.name} 移出本分类`}
            disabled={!!pending} onClick={() => void unplace(entity)}>移出本分类</Button>
        </div>}
      </article>)}
    </div> : <EmptyState icon={<Folder size={26} />} title={query.trim() ? '没有匹配的对象' : '此分类暂无卡片'}>
      {query.trim() ? '调整名称或别名后再查找。' : '可以从这个世界的已有对象中选卡。'}
    </EmptyState>)}
    {picking && <ObjectBrowser world={world} title="添加已有对象" types={['entity']}
      excludeIds={objects?.map(entity => entity.id)} onClose={() => setPicking(false)} onPick={async item => {
        await categoriesApi.place(world, category.id, item.id);
        setPicking(false);
        setRevision(n => n + 1);
      }} />}
    {moving && <MovePlacement world={world} category={category} entity={moving} categories={categories}
      onClose={() => setMoving(undefined)} onMoved={() => {
        setObjects(items => items?.filter(item => item.id !== moving.id));
        setMoving(undefined);
        setRevision(n => n + 1);
      }} />}
  </section>;
}

function MovePlacement({ world, category, entity, categories, onClose, onMoved }: {
  world: string;
  category: WorldCategory;
  entity: Entity;
  categories: WorldCategory[];
  onClose: () => void;
  onMoved: () => void;
}) {
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function move(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await categoriesApi.move(world, category.id, entity.id, destination);
      onMoved();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <Dialog title={`移动「${entity.name}」的陈列`} onClose={onClose} busy={busy}>
    <form onSubmit={move}>
      <label className="field">
        <span>移到分类</span>
        <select required disabled={busy} value={destination} onChange={event => setDestination(event.target.value)}>
          <option value="">选择分类</option>
          {categories.filter(item => item.id !== category.id).map(item =>
            <option key={item.id} value={item.id}>{categoryLabel(item, categories)}</option>)}
        </select>
      </label>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions">
        <Button type="button" disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="primary" disabled={busy || !destination}>确认移动</Button>
      </div>
    </form>
  </Dialog>;
}
