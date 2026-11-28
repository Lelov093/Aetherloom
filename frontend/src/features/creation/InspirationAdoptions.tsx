import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { creationApi, type Inspiration, type InspirationPage } from './api';
import type { SelectedSource } from './ObjectFromSourceDialog';
import {
  adoptionLibraryPath, adoptionManuscriptPath, adoptionSourcePath, adoptionStateLabel,
  inspirationAdoptionApi, type InspirationAdoption,
} from './inspirationAdoptionApi';

export function InspirationAdoptionDialog({ world, selection, onClose, onSaved }: {
  world: string; selection: SelectedSource; onClose: () => void; onSaved: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<InspirationPage>();
  const [picked, setPicked] = useState<Inspiration>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setPage(undefined);
    setError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim(), offset: String(offset), limit: '12' });
      creationApi.inspirations(world, params).then(value => {
        if (active) setPage(value);
      }).catch(error => { if (active) setError(error.message); });
    }, query ? 200 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [world, query, offset, retry]);

  async function save() {
    if (!picked || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await inspirationAdoptionApi.add(world, picked.id, selection);
      onSaved(result.id);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }

  return <Dialog title="将选段关联到灵感" busy={busy} onClose={onClose}>
    <p className="dialog-intro">{selection.title} · 正文 v{selection.source_version}</p>
    <blockquote className="adoption-selection">{selection.text}</blockquote>
    <label className="field"><span>搜索灵感</span><input value={query} maxLength={200} disabled={busy}
      placeholder="按标题或笔记搜索" onChange={event => { setQuery(event.target.value); setOffset(0); setPicked(undefined); }}/></label>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {!page && (error ? <Button onClick={() => setRetry(value => value + 1)}>重试读取灵感</Button>
      : <p role="status">正在读取灵感…</p>)}
    {page && <>
      <div className="adoption-candidates" aria-label="可关联的灵感">
        {page.items.length === 0 && <p>没有符合条件的灵感。</p>}
        {page.items.map(item => <Button key={item.id} variant="ghost" aria-pressed={picked?.id === item.id}
          disabled={busy} onClick={() => setPicked(item)}>{item.title}<small>{item.origin === 'simulation' ? '模拟摘录' : '作者手记'}</small></Button>)}
      </div>
      {page.total > page.limit && <div className="writing-inspiration-actions">
        <Button disabled={busy || offset === 0} onClick={() => { setOffset(offset - page.limit); setPicked(undefined); }}>上一页</Button>
        <Button disabled={busy || offset + page.limit >= page.total} onClick={() => { setOffset(offset + page.limit); setPicked(undefined); }}>下一页</Button>
      </div>}
    </>}
    <div className="dialog-actions">
      <Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
      <Button variant="primary" disabled={!picked || busy} onClick={() => void save()}>{busy ? '正在关联…' : '确认采用'}</Button>
    </div>
  </Dialog>;
}

export function InspirationAdoptionList({ world, id, kind, activeId, version }: {
  world: string; id: string; kind: 'inspiration' | 'node'; activeId?: string | null; version?: number;
}) {
  const [items, setItems] = useState<InspirationAdoption[]>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const activeRow = useRef<HTMLLIElement>(null);
  useEffect(() => {
    let active = true;
    setError('');
    inspirationAdoptionApi[kind](world, id).then(rows => {
      if (active) setItems(rows);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [world, id, kind, version, retry]);
  useEffect(() => {
    if (!activeRow.current) return;
    activeRow.current.scrollIntoView({ block: 'center' });
    activeRow.current.focus({ preventScroll: true });
  }, [activeId, items]);

  return <section className="inspiration-adoptions" aria-label="正文采用">
    <h3>正文采用</h3>
    {error ? <><ErrorNotice>{error}</ErrorNotice><Button onClick={() => setRetry(value => value + 1)}>重试读取采用记录</Button></>
      : !items ? <p role="status">正在读取采用记录…</p>
      : !items.length ? <p className="context-hint">尚无采用记录。</p>
      : <ul className="writing-inspiration-list">
        {items.map(row => {
          const active = row.id === activeId;
          return <li key={row.id} ref={active ? activeRow : undefined} tabIndex={active ? -1 : undefined}
            data-active={active || undefined}>
            <strong>{kind === 'inspiration' ? `${row.work_title} · ${row.path}` : row.inspiration_title}</strong>
            <small>原选段 v{row.source_version} · {adoptionStateLabel[row.anchor_state]}</small>
            <blockquote>{row.quote}</blockquote>
            <div className="writing-inspiration-actions">
              {kind === 'node'
                ? <Link className="text-link" to={adoptionLibraryPath(world, row)}>在灵感库查看 →</Link>
                : row.anchor_state !== 'archived' && <Link className="text-link" to={adoptionManuscriptPath(world, row)}>
                  {row.anchor_state === 'current' ? '定位当前正文' : '打开当前正文'} →
                </Link>}
              <Link className="text-link" to={adoptionSourcePath(world, row.id)}>查看原选段 →</Link>
            </div>
          </li>;
        })}
      </ul>}
  </section>;
}
