import { useState, type FormEvent } from 'react';
import { FilePicker } from '../../components/FormControls';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { ObjectBrowser } from '../objects/ObjectBrowser';
import { featureKinds, featureName, mapsApi, type FeatureData, type FeatureKind, type MapFeature, type MapInfo, type Point } from './api';

export function MapForm({ world, map, parent, onClose, onSaved }: {
  world: string;
  map?: MapInfo;
  parent?: MapFeature;
  onClose: () => void;
  onSaved: (map: MapInfo) => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(map?.title ?? '');
  const [file, setFile] = useState<File>();
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData();
    data.set('title', title.trim());
    if (file && !remove) data.set('file', file);
    if (map) {
      data.set('version', String(map.version));
      data.set('remove_background', String(remove));
    } else {
      data.set('id', id);
      if (parent) {
        data.set('parent_feature', parent.id);
        data.set('feature_version', String(parent.version));
      }
    }
    try { onSaved(await mapsApi.saveMap(world, data, map?.id)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog title={map ? '地图设置' : parent ? '新建子图' : '新建地图'} onClose={onClose} busy={busy}>
    <form onSubmit={save}>
      <label className="field"><span>地图名称</span><input value={title} onChange={e => setTitle(e.target.value)} required maxLength={120} disabled={busy}/></label>
      <label className="field"><span>地图底图（可选）</span><FilePicker accept="image/png,image/jpeg,image/webp"
        disabled={busy || remove} onChange={e => setFile(e.target.files?.[0])}/></label>
      <p className="context-hint">{map ? '更换或移除底图会保留标注的相对位置。' : '未选择图片时创建空白画布。可用 PNG、JPEG 或 WebP（4 MB 以内）。'}</p>
      {!!map?.has_background && <label><input type="checkbox" checked={remove} disabled={busy} onChange={e => setRemove(e.target.checked)}/>移除底图</label>}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions"><Button type="button" onClick={onClose} disabled={busy}>取消</Button>
        <Button variant="primary" type="submit" disabled={busy || !title.trim()}>{busy ? '正在保存…' : map ? '保存设置' : '创建地图'}</Button>
      </div>
    </form>
  </Dialog>;
}

export interface DrawFeature {
  kind: FeatureKind;
  feature?: MapFeature;
}

export function FeatureForm({ world, map, maps, kind, feature, points, onClose, onSaved, onRemoved }: {
  world: string;
  map: string;
  maps: MapInfo[];
  kind: FeatureKind;
  feature?: MapFeature;
  points: Point[];
  onClose: () => void;
  onSaved: (feature: MapFeature) => void;
  onRemoved: (id: string) => void;
}) {
  const [id] = useState(() => feature?.id ?? crypto.randomUUID());
  const [name, setName] = useState(feature?.name ?? '');
  const [color, setColor] = useState(feature?.color ?? (kind === 'region' ? '#45898c' : '#267f91'));
  const [entityId, setEntityId] = useState<string | null>(feature?.entity_id ?? null);
  const [entityName, setEntityName] = useState(feature?.entity?.name ?? '');
  const [child, setChild] = useState(feature?.child_map_id ?? '');
  const [newLocation, setNewLocation] = useState('');
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const marker = kind === 'marker';
  const bindable = kind !== 'label';
  const typeName = featureKinds[kind];
  const valid = marker ? creatingLocation ? !!newLocation.trim() : !!entityId : !!name.trim();

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data: FeatureData = {
      kind, points, name: name.trim(), color,
      entity_id: bindable && !creatingLocation ? entityId : null,
      child_map_id: bindable && child ? child : null,
      new_location: creatingLocation ? newLocation.trim() : undefined,
    };
    try { onSaved(await mapsApi.saveFeature(world, map, id, data, feature?.version)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!feature) return;
    setBusy(true);
    setError('');
    try { await mapsApi.removeFeature(world, map, feature); onRemoved(id); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (picking) return <ObjectBrowser world={world} title={marker ? '选择地点卡' : '选择关联对象'}
    types={['entity']} entityKind={marker ? 'location' : undefined} onClose={() => setPicking(false)}
    onPick={object => { setEntityId(object.id); setEntityName(object.label); setCreatingLocation(false); setPicking(false); }}/>;
  if (removing && feature) return <Dialog title={`移除${typeName}？`} onClose={() => setRemoving(false)} busy={busy}>
    <p className="dialog-intro">将从当前地图移除「{featureName(feature)}」。关联资料仍可打开。</p>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    <div className="dialog-actions"><Button disabled={busy} onClick={() => setRemoving(false)}>取消</Button>
      <Button variant="danger" disabled={busy} onClick={() => void remove()}>确认移除</Button>
    </div>
  </Dialog>;
  return <Dialog title={`${feature ? '编辑' : '添加'}${typeName}`} onClose={onClose} busy={busy}>
    <form onSubmit={save}>
      <label className="field"><span>{marker ? '图上名称（可选）' : `${typeName}名称`}</span>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={160} required={!marker}
          placeholder={marker ? (entityName || '沿用地点卡名称') : undefined} disabled={busy}/></label>
      {kind !== 'label' && <label className="author-map-color"><span>{typeName}颜色</span><input type="color" value={color}
        disabled={busy} onChange={e => setColor(e.target.value)}/></label>}
      {bindable && <div className="author-map-bind">
        <span>{creatingLocation ? '保存时创建地点卡' : entityName || (marker ? '还未选择地点卡' : '还未关联对象')}</span>
        <Button type="button" disabled={busy} onClick={() => setPicking(true)}>{marker ? '选择已有地点' : '选择关联对象'}</Button>
        {marker && !creatingLocation && <Button type="button" disabled={busy} onClick={() => setCreatingLocation(true)}>新建地点</Button>}
        {!marker && entityId && <Button type="button" disabled={busy} onClick={() => { setEntityId(null); setEntityName(''); }}>解除关联</Button>}
      </div>}
      {creatingLocation && <label className="field"><span>新地点名称</span><input value={newLocation} maxLength={160}
        required disabled={busy} onChange={e => setNewLocation(e.target.value)}/></label>}
      {bindable && <label className="field"><span>关联子图</span>
        <select value={child} disabled={busy} onChange={e => setChild(e.target.value)}>
          <option value="">尚无子图</option>
          {maps.filter(item => item.id !== map).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions">
        {feature && <Button type="button" disabled={busy} onClick={() => { setError(''); setRemoving(true); }}>{`移除${typeName}`}</Button>}
        <Button type="button" disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="primary" type="submit" disabled={busy || !valid}>{busy ? '正在保存…' : `保存${typeName}`}</Button>
      </div>
    </form>
  </Dialog>;
}
