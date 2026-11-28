import { useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { request, type ContentNode, type Work } from './api';
import { ClueEditor, PassageEditor } from './NarrativeEditors';
import { clueStatuses, narrativeEventPath, passageUses, workNarrativePath, type NarrativeClue,
  type NarrativePassage, type WorkNarrativeData } from './narrativeApi';

type FollowLink = (event: MouseEvent<HTMLAnchorElement>, destination: string) => void;

function useNarrative<T>(path: string, revision?: unknown) {
  const [result, setResult] = useState<{ path: string; data?: T; error?: string }>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(undefined);
    request<T>(path).then(data => { if (active) setResult({ path, data }); })
      .catch(e => { if (active) setResult({ path, error: e.message }); });
    return () => { active = false; };
  }, [path, revision, refresh]);
  return { ...(result?.path === path ? result : undefined), reload: () => setRefresh(n => n + 1) };
}

function NarrativeLoading({ error, reload }: { error?: string; reload: () => void }) {
  return error ? <><ErrorNotice>{error}</ErrorNotice><Button onClick={reload}>重新读取叙事记录</Button></>
    : <p role="status">正在读取叙事记录…</p>;
}

function PassageRows({ world, passages, showChapter = false, showTarget = false, onOpen, onEdit }: {
  world: string; passages: NarrativePassage[]; showChapter?: boolean; showTarget?: boolean;
  onOpen?: FollowLink; onEdit?: (row: NarrativePassage) => void;
}) {
  return passages.length ? <ul className="narrative-list">{passages.map(row => {
    const source = `/worlds/${world}/create/sources/${row.id}?narrative=1`;
    const chapter = `/worlds/${world}/create?${new URLSearchParams({ work: row.work_id, node: row.node_id, mode: 'read' })}`;
    return <li className="narrative-row" key={row.id}>
      {showChapter && <Link className="text-link narrative-chapter-link" to={chapter} onClick={e => onOpen?.(e, chapter)}>{row.title_path}</Link>}
      <div className="narrative-actions">
        <strong>{passageUses[row.use_kind]}</strong>
        {row.clue_title && <span>{row.clue_title}{row.clue_status && ` · ${clueStatuses[row.clue_status]}`}</span>}
        {showTarget && row.linked_event_id && <Link className="text-link" to={narrativeEventPath(world, row.linked_event_id, row.event_status)}>
          {row.event_title}{row.event_status !== 'active' && '（已撤回）'} →
        </Link>}
      </div>
      {row.note && <p>{row.note}</p>}
      <div className="narrative-actions">
        <Link className="text-link" to={source} onClick={e => onOpen?.(e, source)}>查看冻结选段</Link>
        <small>保存选段 v{row.source_version}{row.current_version !== row.source_version && ` · 当前 v${row.current_version}`}
          {row.source_archived && ' · 正文已收起'}</small>
        {onEdit && !row.source_archived && <Button variant="ghost" onClick={() => onEdit(row)}>编辑记录</Button>}
      </div>
    </li>;
  })}</ul> : <p className="context-hint">尚无叙事记录。</p>;
}

function groupPassages(passages: NarrativePassage[], by: 'work_id' | 'node_id') {
  const groups = new Map<string, NarrativePassage[]>();
  for (const row of passages) {
    const rows = groups.get(row[by]);
    if (rows) rows.push(row);
    else groups.set(row[by], [row]);
  }
  return [...groups.values()];
}

export function ChapterNarrative({ world, node, editable, refresh }: {
  world: string; node: ContentNode; editable: boolean; refresh: number;
}) {
  const { data, error, reload } = useNarrative<NarrativePassage[]>(`/nodes/${node.id}/narrative`, `${node.version}:${refresh}`);
  const [editing, setEditing] = useState<NarrativePassage>();
  return <section className="context-section narrative-chapter" aria-label="本篇叙事记录">
    <h2>本篇叙事记录</h2>
    <Link className="text-link" to={workNarrativePath(world, node.work_id)}>查看整部作品的叙事与线索 →</Link>
    {editable && !data?.length && <p className="context-hint">选中原文，在「更多正文操作」中记录叙事作用。</p>}
    {data ? <PassageRows world={world} passages={data} showTarget onEdit={editable ? setEditing : undefined} />
      : <NarrativeLoading error={error} reload={reload} />}
    {editing && <PassageEditor world={world} row={editing} onClose={() => setEditing(undefined)}
      onSaved={() => { setEditing(undefined); reload(); }} />}
  </section>;
}

export function WorkNarrative({ world, work, directory }: { world: string; work: Work; directory: ContentNode[] }) {
  const { data, error, reload } = useNarrative<WorkNarrativeData>(`/works/${work.id}/narrative`, directory);
  const [editing, setEditing] = useState<NarrativeClue>();
  const [filter, setFilter] = useState<'all' | NarrativeClue['status']>('all');
  const clues = data?.clues.filter(clue => filter === 'all' || clue.status === filter);
  return <div className="creation-empty content-entry-page work-narrative">
    <h1>作品叙事与线索</h1>
    <Link className="text-link" to={`/worlds/${world}/create?work=${encodeURIComponent(work.id)}`}>返回{work.title} →</Link>
    {data ? <>
      <section aria-label="按作品目录排列的叙事记录">
        <h2>章节叙事</h2>
        {data.passages.length ? groupPassages(data.passages, 'node_id').map(rows => {
          const chapter = rows[0];
          return <section key={chapter.node_id} className="narrative-group">
            <h3><Link className="text-link" to={`/worlds/${world}/create?${new URLSearchParams({ work: work.id, node: chapter.node_id, mode: 'read' })}`}>
              {chapter.title_path}
            </Link></h3>
            <PassageRows world={world} passages={rows} showTarget />
          </section>;
        }) : <p className="context-hint">在章节中选段记录，便可在这里按作品目录回看。</p>}
      </section>
      <section aria-label="作品线索">
        <div className="collection-heading">
          <h2>作品线索</h2>
          {data.clues.length > 0 && <label className="narrative-actions"><span>回收状态</span>
            <select aria-label="回收状态" value={filter} onChange={e => setFilter(e.target.value as typeof filter)}>
              <option value="all">全部线索</option>
              {Object.entries(clueStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>}
        </div>
        {clues?.length ? clues.map(clue => {
          const related = data.passages.filter(row => row.clue_id === clue.id);
          return <div className="narrative-group" key={clue.id}>
            <div className="narrative-actions">
              <h3>{clue.title}</h3><span>{clueStatuses[clue.status]}</span>
              {work.status === 'active' && <Button onClick={() => setEditing(clue)}>编辑线索</Button>}
            </div>
            {clue.event_id && <Link className="text-link" to={narrativeEventPath(world, clue.event_id, clue.event_status)}>
              {clue.event_title}{clue.event_status !== 'active' && '（已撤回）'} →
            </Link>}
            <details><summary>查看{related.length}处选段</summary><PassageRows world={world} passages={related} showChapter /></details>
          </div>;
        }) : <p className="context-hint">{filter === 'all' ? '尚无线索。' : '没有符合此状态的线索。'}</p>}
      </section>
    </> : <NarrativeLoading error={error} reload={reload} />}
    {editing && <ClueEditor world={world} clue={editing} onClose={() => setEditing(undefined)}
      onSaved={() => { setEditing(undefined); reload(); }} />}
  </div>;
}

export function EventNarrativeButton({ world, identity, onOpen }: { world: string; identity: string; onOpen?: FollowLink }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button aria-haspopup="dialog" onClick={() => setOpen(true)}>查看作品中的出现</Button>
    {open && <EventNarrative world={world} identity={identity} onClose={() => setOpen(false)} onOpen={onOpen} />}
  </>;
}

function EventNarrative({ world, identity, onClose, onOpen }: {
  world: string; identity: string; onClose: () => void; onOpen?: FollowLink;
}) {
  const { data, error, reload } = useNarrative<NarrativePassage[]>(`/worlds/${world}/events/${identity}/narrative`);
  return <Dialog title="作品中的出现" onClose={onClose} focusFirstInput={false} className="narrative-dialog">
    {data ? data.length ? groupPassages(data, 'work_id').map(rows => <section className="narrative-group" key={rows[0].work_id}>
      <h3>{rows[0].work_title}</h3>
      <PassageRows world={world} passages={rows} showChapter onOpen={onOpen} />
    </section>) : <p className="context-hint">尚无作品记录此事件的叙事作用。</p> : <NarrativeLoading error={error} reload={reload} />}
  </Dialog>;
}
