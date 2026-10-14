import { useEffect, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { FilePicker } from '../../components/FormControls';
import { request } from '../creation/api';

export type ImageOwner = 'work' | 'entity';
const imagePath = (owner: ImageOwner, id: string) => owner === 'work' ? `/works/${id}/cover` : `/entities/${id}/portrait`;
const changed = 'aetherloom:display-image-changed';

export function notifyImageChanged(world: string, owner: ImageOwner) {
  window.dispatchEvent(new CustomEvent(changed, { detail: { world, owner } }));
}

export function useDisplayImages(world: string, owner: ImageOwner) {
  const [images, setImages] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let sequence = 0;
    async function load() {
      const requestId = ++sequence;
      try {
        const value = await request<Record<string, number>>(`/worlds/${world}/${owner === 'work' ? 'covers' : 'portraits'}`);
        if (active && requestId === sequence) { setImages(value); setError(''); }
      } catch (e) { if (active && requestId === sequence) setError((e as Error).message); }
    }
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.world === world && detail.owner === owner) void load();
    };
    void load();
    window.addEventListener(changed, refresh);
    return () => { active = false; window.removeEventListener(changed, refresh); };
  }, [world, owner]);
  return { images, error };
}

export function DisplayImage({ owner, id, name, version, className = '' }: {
  owner: ImageOwner; id: string; name: string; version?: number; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [id, version]);
  if (!version) return null;
  return <span className={`display-image ${className}`}>
    {failed ? <span className="image-unavailable">图片暂不可用</span> :
      <img src={`/api${imagePath(owner, id)}?v=${version}`} alt={`${name}${owner === 'work' ? '的封面' : '的展示图片'}`} onError={() => setFailed(true)}/>}
  </span>;
}

export function DisplayImageEditor({ owner, id, name, world, onClose }: {
  owner: ImageOwner; id: string; name: string; world: string; onClose: () => void;
}) {
  const { images, error: loadError } = useDisplayImages(world, owner);
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const label = owner === 'work' ? '作品封面' : '展示图片';
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function save(remove = false) {
    setBusy(true); setError('');
    try {
      const form = new FormData();
      if (file) form.append('file', file);
      await request(imagePath(owner, id), remove ? { method: 'DELETE' } : { method: 'POST', body: form });
      notifyImageChanged(world, owner);
      if (remove) setFile(undefined); else onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Dialog title={`设置${name}的${label}`} onClose={onClose} busy={busy}>
    <div className="display-image-preview">{preview ? <img src={preview} alt="待保存图片预览"/> :
      <DisplayImage owner={owner} id={id} name={name} version={images[id]}/>}</div>
    <label className="field"><span>本地图片文件</span><FilePicker aria-label="本地图片文件" disabled={busy} accept="image/png,image/jpeg,image/webp" onChange={e => { setFile(e.target.files?.[0]); setError(''); }}/></label>
    <p className="context-hint">PNG、JPEG 或 WebP；不超过4MB、4096像素。原图保存在本机，展示时居中裁切。</p>
    <p className="context-hint">图片仅用于展示，不改变正文、正式事实、角色知识或模拟冻结输入。旧记录也使用当前展示图片。</p>
    {(error || loadError) && <ErrorNotice>{error || loadError}</ErrorNotice>}
    <div className="dialog-actions">
      {images[id] && <Button disabled={busy} onClick={() => void save(true)}>移除图片</Button>}
      <Button disabled={busy} onClick={onClose}>关闭</Button>
      <Button variant="primary" disabled={busy || !file} onClick={() => void save()}><ImagePlus size={16}/>{busy ? '正在保存…' : '保存图片'}</Button>
    </div>
  </Dialog>;
}
