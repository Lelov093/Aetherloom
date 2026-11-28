import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { creationApi, type ContentNode, type Inspiration, type WritingInspirationPage } from './api';
import { InspirationLinkedContent, InspirationSourceLinks } from './InspirationReferences';

function InspirationPreview({ world, item }: { world: string; item: Inspiration }) {
  return <>
    {item.note && <p className="inspiration-history-note">{item.note}</p>}
    <InspirationLinkedContent world={world} item={item}/>
    <InspirationSourceLinks item={item}/>
    <Link className="text-link" to={`/worlds/${world}/inspirations?id=${encodeURIComponent(item.id)}`}>在灵感库打开 →</Link>
  </>;
}

function WritingNote({ world, node, onClose, onSaved }: {
  world: string; node: ContentNode; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Dialog title="新建手记" onClose={onClose} busy={busy}>
    <form onSubmit={async e => {
      e.preventDefault();
      if (busy || !title.trim()) return;
      setBusy(true);
      setError('');
      try {
        await creationApi.createInspiration(world, { title: title.trim(), note, origin_node_id: node.id });
        onSaved();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }}>
      <p className="context-hint">归到{node.kind === 'chapter' ? '本章' : '本幕'} · {node.title}</p>
      <label className="field"><span>手记标题</span><input required value={title} maxLength={160} onChange={e => setTitle(e.target.value)}/></label>
      <label className="field"><span>创作笔记</span><textarea value={note} onChange={e => setNote(e.target.value)} rows={5} maxLength={20000}/></label>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions">
        <Button type="button" disabled={busy} onClick={onClose}>取消</Button>
        <Button type="submit" variant="primary" disabled={busy || !title.trim()}>保存手记</Button>
      </div>
    </form>
  </Dialog>;
}

export function WritingInspirations({ world, node, editable }: { world: string; node: ContentNode; editable: boolean }) {
  const [page, setPage] = useState<WritingInspirationPage>();
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    let active = true;
    setPage(undefined);
    setError('');
    creationApi.writingInspirations(world, node.id, offset).then(result => {
      if (active) setPage(result);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [world, node.id, offset, reload]);

  function changePage(nextOffset: number) {
    setChecked([]);
    setOffset(nextOffset);
  }

  const selected = page?.items.filter(item => checked.includes(item.id)) || [];
  const chapter = node.kind === 'chapter';
  return <section className="context-section writing-inspirations" aria-label="写作灵感">
    <h2>{chapter ? '本章灵感' : '本幕灵感'}</h2>
    <div className="writing-inspiration-actions">
      {editable && <Button onClick={() => setCreating(true)}>新建手记</Button>}
      {selected.length > 1 && <Button variant="ghost" onClick={() => setComparing(true)}>并排查看（{selected.length}）</Button>}
      <Link className="text-link" to={`/worlds/${world}/inspirations?placement=unassigned`}>查看未分配 →</Link>
    </div>
    {!page && !error && <p role="status">正在读取写作灵感…</p>}
    {error && <><ErrorNotice>{error}</ErrorNotice><Button onClick={() => setReload(value => value + 1)}>重新读取</Button></>}
    {page?.total === 0 && <p className="context-hint">这里还没有已分配的灵感。</p>}
    {page?.items.length ? <ul className="writing-inspiration-list">{page.items.map(item => <li key={item.id}>
      <label className="writing-inspiration-choice">
        <input type="checkbox" aria-label={`对照 ${item.title}`} checked={checked.includes(item.id)}
          onChange={e => setChecked(current => e.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/>
        <strong>{item.title}</strong>
      </label>
      <small>{item.assigned_nodes.filter(place => page.scope_node_ids.includes(place.id)).map(place =>
        place.id === node.id ? chapter ? '本章' : '本幕' : place.path).join(' · ')}</small>
      <details><summary>展开灵感</summary><InspirationPreview world={world} item={item}/></details>
    </li>)}</ul> : null}
    {page && (offset > 0 || page.total > page.limit) && <div className="writing-inspiration-actions">
      <Button disabled={!offset} onClick={() => changePage(Math.max(0, offset - page.limit))}>上一页</Button>
      <Button disabled={offset + page.limit >= page.total} onClick={() => changePage(offset + page.limit)}>下一页</Button>
    </div>}
    {creating && <WritingNote world={world} node={node} onClose={() => setCreating(false)} onSaved={() => {
      setCreating(false);
      changePage(0);
      setReload(value => value + 1);
    }}/>}
    {comparing && <Dialog title="并排查看灵感" onClose={() => setComparing(false)} className="writing-inspiration-compare" focusFirstInput={false}>
      <div className="writing-inspiration-columns">{selected.map(item => <section key={item.id} aria-label={item.title}>
        <h3>{item.title}</h3><InspirationPreview world={world} item={item}/>
      </section>)}</div>
    </Dialog>}
  </section>;
}
