import { useEffect, useState, type FormEvent } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { worldApi, type World } from './api';

export function WorldForm({ world, onClose, onSaved }: { world?: World; onClose: () => void; onSaved: (world: World) => void }) {
  const [name, setName] = useState(world?.name ?? '');
  const [description, setDescription] = useState(world?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = name !== (world?.name ?? '') || description !== (world?.description ?? '');
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const data = { name: name.trim(), description: description.trim() };
      onSaved(world ? await worldApi.update(world, data) : await worldApi.create(data));
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <Dialog title={world ? '编辑世界资料' : '创造一个世界'} onClose={onClose} busy={busy}>
    <p className="dialog-intro">{world ? '让名字和简介，承载你对这个世界的想象。' : '从一个名字开始。人物、故事与远方，可以慢慢生长。'}</p>
    <form onSubmit={save}>
      <label className="field"><span>世界名称 <span className="required">必填</span></span><input autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="为你的世界起一个名字" disabled={busy} /></label>
      <label className="field"><span>一句话介绍 <small>选填</small></span><textarea rows={4} maxLength={1200} value={description} onChange={e => setDescription(e.target.value)} placeholder="它是什么样的世界？有什么值得被记住？" disabled={busy} /></label>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions"><Button type="button" variant="ghost" onClick={onClose} disabled={busy}>取消</Button><Button variant="primary" disabled={busy || !name.trim()} type="submit">{world ? <Check size={17} /> : <Sparkles size={17} />}{busy ? '正在保存…' : world ? '保存修改' : '创建世界'}</Button></div>
    </form>
  </Dialog>;
}
