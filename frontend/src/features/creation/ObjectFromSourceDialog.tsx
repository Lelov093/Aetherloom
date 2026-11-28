import { useState, type FormEvent } from 'react';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { entityKinds, request, type Entity } from './api';
import { ResourceFields } from './ResourceForm';

export interface SelectedSource {
  node_id: string;
  source_version: number;
  title: string;
  start: number;
  end: number;
  text: string;
}

export interface CreatedSourceObject {
  object: Entity;
  source: { id: string; to: string };
}

type Mode = 'source' | 'excerpt' | 'setting';
const modes: [Mode, string][] = [
  ['source', '只绑定出处'],
  ['excerpt', '摘录原文'],
  ['setting', '整理为设定'],
];

export function ObjectFromSourceDialog({ world, selection, onClose, onSaved }: {
  world: string;
  selection: SelectedSource;
  onClose: () => void;
  onSaved: (result: CreatedSourceObject) => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(selection.text.trim().length <= 48 ? selection.text.trim().replace(/\s+/g, ' ') : '');
  const [kind, setKind] = useState('concept');
  const [mode, setMode] = useState<Mode>('source');
  const [setting, setSetting] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const excerpt = Array.from(selection.text);
  const preview = excerpt.length > 320 ? excerpt.slice(0, 320).join('') + '…' : selection.text;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !name.trim() || (mode === 'setting' && !setting.trim())) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<CreatedSourceObject>(`/worlds/${world}/material-objects`, {
        method: 'POST',
        body: JSON.stringify({
          request_id: requestId, name, kind, mode, node_id: selection.node_id,
          source_version: selection.source_version, start: selection.start, end: selection.end,
          ...(mode === 'setting' ? { setting } : {}),
        }),
      });
      onSaved(result);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title="从选段建卡" className="source-object-dialog" onClose={onClose} busy={busy}>
    <form onSubmit={save}>
      <div className="source-object-content">
        <p className="context-hint">{selection.title} · 来源 v{selection.source_version}</p>
        <blockquote className="source-snapshot" aria-label="所选原文">{preview}</blockquote>
        <ResourceFields name={name} kind={kind} kinds={entityKinds} onName={setName} onKind={setKind} disabled={busy} />
        <fieldset className="source-object-modes">
          <legend>写入卡片</legend>
          {modes.map(([value, label]) => <label key={value}>
            <input type="radio" name="source-object-mode" value={value} checked={mode === value}
              disabled={busy} onChange={() => setMode(value)} />{label}
          </label>)}
        </fieldset>
        {mode === 'setting' && <label className="field">
          <span>设定说明</span>
          <textarea rows={4} value={setting} required disabled={busy} maxLength={200000}
            onChange={event => setSetting(event.target.value)} />
        </label>}
        {error && <ErrorNotice>{error}</ErrorNotice>}
      </div>
      <div className="dialog-actions">
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="primary" disabled={busy || !name.trim() || (mode === 'setting' && !setting.trim())}>
          {busy ? '正在保存…' : '创建卡片'}
        </Button>
      </div>
    </form>
  </Dialog>;
}
