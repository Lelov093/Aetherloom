import { useEffect, useState, type FormEvent } from 'react';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { ObjectBrowser } from '../objects/ObjectBrowser';
import { request } from './api';
import type { SelectedSource } from './ObjectFromSourceDialog';
import {
  clueStatuses, narrativeApi, passageUses, type ClueStatus, type NarrativeClue,
  type NarrativePassage, type PassageUse, type WorkNarrativeData,
} from './narrativeApi';

type EventRef = { id: string; label: string };
type Target = 'event' | 'new-clue' | 'clue';

export function PassageEditor({ world, onClose, onSaved, ...draft }: {
  world: string; onClose: () => void; onSaved: () => void;
} & ({ selection: SelectedSource; work: string } | { row: NarrativePassage })) {
  const row = 'row' in draft ? draft.row : undefined;
  const selection = 'selection' in draft ? draft.selection : undefined;
  const work = 'work' in draft ? draft.work : undefined;
  const [requestId] = useState(() => crypto.randomUUID());
  const [useKind, setUseKind] = useState<PassageUse>(row?.use_kind ?? 'mention');
  const [note, setNote] = useState(row?.note ?? '');
  const [target, setTarget] = useState<Target>('event');
  const [event, setEvent] = useState<EventRef>();
  const [clueTitle, setClueTitle] = useState('');
  const [clueId, setClueId] = useState('');
  const [clues, setClues] = useState<NarrativeClue[]>();
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [clueError, setClueError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (target !== 'clue' || !work) return;
    let live = true;
    setClueError('');
    request<WorkNarrativeData>(`/works/${work}/narrative`)
      .then(data => { if (live) setClues(data.clues); })
      .catch(e => { if (live) setClueError(e.message); });
    return () => { live = false; };
  }, [target, work, retry]);

  const link = target === 'event' ? event && { event_id: event.id }
    : target === 'clue' ? clueId && { clue_id: clueId }
      : clueTitle.trim() && { clue_title: clueTitle.trim() };

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || (!row && (!selection || !link))) return;
    setError('');
    setBusy(true);
    try {
      if (row) {
        await narrativeApi.edit(row, useKind, note, removing ? 'removed' : 'active');
      } else if (selection && link) {
        const { node_id, source_version, start, end } = selection;
        await narrativeApi.add(world, { request_id: requestId, node_id, source_version, start, end, use_kind: useKind, note, ...link });
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (picking) return <ObjectBrowser world={world} types={['event']} title="选择世界事件"
    onClose={() => setPicking(false)} onPick={picked => { setEvent(picked); setPicking(false); }} />;
  return <Dialog title={removing ? '解除选段记录？' : row ? '编辑叙事记录' : '记录选段的叙事作用'}
    onClose={onClose} busy={busy} className="narrative-dialog" focusFirstInput={false}>
    <form onSubmit={save}>
      {removing ? <p>作品正文和保存的选段仍可读取。</p> : <>
        {selection && <blockquote className="source-snapshot" tabIndex={0} aria-label="已选原文">{selection.text}</blockquote>}
        {!row && <>
          <label className="field"><span>关联目标</span><select aria-label="关联目标" value={target} onChange={e => setTarget(e.target.value as Target)}>
            <option value="event">既有世界事件</option>
            <option value="new-clue">新线索（真相未定）</option>
            <option value="clue">这部作品的已有线索</option>
          </select></label>
          {target === 'event' && <div className="narrative-actions">
            <Button type="button" onClick={() => setPicking(true)}>{event ? '更换世界事件' : '选择世界事件'}</Button>
            {event && <strong>{event.label}</strong>}
          </div>}
          {target === 'new-clue' && <label className="field"><span>线索名称</span>
            <input value={clueTitle} onChange={e => setClueTitle(e.target.value)} maxLength={160} required />
          </label>}
          {target === 'clue' && <>
            <label className="field"><span>已有线索</span><select aria-label="已有线索" required value={clueId} onChange={e => setClueId(e.target.value)}>
              <option value="">{clues?.length === 0 ? '本作品还没有线索' : '选择已有线索'}</option>
              {clues?.map(clue => <option key={clue.id} value={clue.id}>{clue.title} · {clueStatuses[clue.status]}</option>)}
            </select></label>
            {!clues && !clueError && <p role="status">正在读取线索…</p>}
            {clueError && <><ErrorNotice>{clueError}</ErrorNotice><Button type="button" onClick={() => setRetry(n => n + 1)}>重读线索</Button></>}
          </>}
        </>}
        <label className="field"><span>叙事作用</span><select aria-label="叙事作用" value={useKind} onChange={e => setUseKind(e.target.value as PassageUse)}>
          {Object.entries(passageUses).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
        </select></label>
        <label className="field"><span>读者在此得知（可选）</span>
          <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={500} />
        </label>
      </>}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions">
        {row && !removing && <Button type="button" variant="ghost" disabled={busy} onClick={() => setRemoving(true)}>解除记录</Button>}
        <Button type="button" disabled={busy} onClick={removing ? () => setRemoving(false) : onClose}>取消</Button>
        <Button type="submit" variant={removing ? 'danger' : 'primary'} disabled={busy || (!row && !link)}>
          {removing ? '确认解除' : '保存叙事记录'}
        </Button>
      </div>
    </form>
  </Dialog>;
}

export function ClueEditor({ world, clue, onClose, onSaved }: {
  world: string; clue: NarrativeClue; onClose: () => void; onSaved: () => void;
}) {
  const [title, setTitle] = useState(clue.title);
  const [status, setStatus] = useState(clue.status);
  const [event, setEvent] = useState<EventRef | undefined>(
    clue.event_id ? { id: clue.event_id, label: clue.event_title ?? '' } : undefined,
  );
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (picking) return <ObjectBrowser world={world} types={['event']} title="选择线索关联的世界事件"
    onClose={() => setPicking(false)} onPick={picked => { setEvent(picked); setPicking(false); }} />;
  return <Dialog title="编辑线索" onClose={onClose} busy={busy}>
    <form onSubmit={async e => {
      e.preventDefault();
      if (busy || !title.trim()) return;
      setBusy(true);
      setError('');
      try {
        await narrativeApi.editClue(clue, { title: title.trim(), status, event_id: event?.id ?? null });
        onSaved();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    }}>
      <label className="field"><span>线索名称</span><input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} required /></label>
      <label className="field"><span>回收状态</span><select aria-label="回收状态" value={status} onChange={e => setStatus(e.target.value as ClueStatus)}>
        {Object.entries(clueStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <div className="narrative-actions">
        <Button type="button" onClick={() => setPicking(true)}>{event ? '更换关联事件' : '关联已有世界事件'}</Button>
        {event && <><strong>{event.label}</strong><Button type="button" variant="ghost" onClick={() => setEvent(undefined)}>解除事件关联</Button></>}
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions"><Button type="button" onClick={onClose} disabled={busy}>取消</Button>
        <Button type="submit" variant="primary" disabled={busy || !title.trim()}>保存线索</Button></div>
    </form>
  </Dialog>;
}
