import { useState } from 'react';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { ObjectBrowser } from '../objects/ObjectBrowser';
import { creationApi, type Inspiration } from './api';
import { inspirationLinkStatus } from './InspirationObjects';

export function InspirationAssignmentEditor({ world, item, onClose, onSaved }: {
  world: string; item: Inspiration; onClose: () => void; onSaved: (item: Inspiration) => void;
}) {
  const [places, setPlaces] = useState(() => item.assigned_nodes.map(place => ({
    id: place.id, label: `${place.work_title} · ${place.path}${inspirationLinkStatus[place.status] || ''}`,
  })));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unchanged = places.length === item.assigned_node_ids.length &&
    places.every(place => item.assigned_node_ids.includes(place.id));

  if (picking) return <ObjectBrowser world={world} types={['content']} writingOnly title="选择分配章幕"
    excludeIds={places.map(place => place.id)} onClose={() => setPicking(false)} onPick={picked => {
      setPlaces(current => [...current, { id: picked.id, label: picked.subtitle || picked.label }]);
      setPicking(false);
    }}/>;
  return <Dialog title="编辑灵感分配" onClose={onClose} busy={busy} focusFirstInput={false}>
    <p>{item.title}</p>
    <Button disabled={busy} onClick={() => setPicking(true)}>添加分配位置</Button>
    {places.length ? <ul className="inspiration-assignment-draft">{places.map(place =>
      <li key={place.id}><span>{place.label}</span><Button variant="ghost" disabled={busy}
        aria-label={`移除分配 ${place.label}`} onClick={() => setPlaces(current => current.filter(value => value.id !== place.id))}>移除</Button></li>)}</ul>
      : <p className="context-hint">未分配</p>}
    {error && <ErrorNotice>{error}</ErrorNotice>}
    <div className="dialog-actions">
      <Button disabled={busy} onClick={onClose}>取消</Button>
      <Button variant="primary" disabled={busy || unchanged} onClick={async () => {
        setBusy(true);
        setError('');
        try {
          const saved = await creationApi.updateInspiration(item, { assigned_node_ids: places.map(place => place.id) });
          onSaved(saved);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}>保存分配</Button>
    </div>
  </Dialog>;
}
