import { useState, type FormEvent } from 'react';
import { Button, Dialog, ErrorNotice } from '../../components/ui';

export function ResourceFields({ name, kind, kinds, disabled, onName, onKind }: {
  name: string;
  kind: string;
  kinds: Record<string, string>;
  disabled?: boolean;
  onName: (name: string) => void;
  onKind: (kind: string) => void;
}) {
  return <>
    <label className="field">
      <span>名称</span>
      <input value={name} onChange={event => onName(event.target.value)} required maxLength={160} disabled={disabled} />
    </label>
    <label className="field">
      <span>类型</span>
      <select value={kind} onChange={event => onKind(event.target.value)} disabled={disabled}>
        {Object.entries(kinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
  </>;
}

export function ResourceForm({ title, initial = '', kinds, initialKind, onClose, onSubmit }: {
  title: string;
  initial?: string;
  kinds: Record<string, string>;
  initialKind?: string;
  onClose: () => void;
  onSubmit: (name: string, kind: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [kind, setKind] = useState(initialKind || Object.keys(kinds)[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(name, kind);
      onClose();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <Dialog title={title} onClose={onClose} busy={busy}>
    <form onSubmit={submit}>
      <ResourceFields name={name} kind={kind} kinds={kinds} onName={setName} onKind={setKind} disabled={busy} />
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions">
        <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>取消</Button>
        <Button variant="primary" disabled={busy}>{busy ? '正在保存…' : '保存'}</Button>
      </div>
    </form>
  </Dialog>;
}
