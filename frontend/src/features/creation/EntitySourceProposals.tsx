import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ErrorNotice } from '../../components/ui';
import { ObjectBrowser } from '../objects/ObjectBrowser';
import { ExtractionPanel } from '../review/ExtractionPanel';
import { request } from './api';

interface Source { id: string; title: string; work_id: string; work_title: string; version?: number; source_versions?: number[] }

export function EntitySourceProposals({ world, entityId, enabled }: { world: string; entityId: string; enabled: boolean }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [picker, setPicker] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoaded(false); setError(''); setSources([]); setSelected('');
    request<{ world_id: string; sources: Source[] }>(`/entities/${entityId}/extraction-sources`)
      .then(result => { if (alive) { setSources(result.sources); setSelected(result.sources[0]?.id || ''); setLoaded(true); } })
      .catch(e => { if (alive) { setError(e.message); setLoaded(true); } });
    return () => { alive = false; };
  }, [entityId, retry]);
  const source = sources.find(item => item.id === selected);
  return <section className="object-proposals" aria-label="从对象来源发起 AI 提案">
    <h2>从对象来源发起 AI 提案</h2>
    <p className="context-hint">选择已关联或补充的正文，再明确发起提取。结果包含该段正文中的世界候选，进入审阅后由你逐项裁决。</p>
    {!enabled ? <p>请先保存资料并恢复对象，再发起提案。</p> : <>
      {!loaded && <p role="status">正在读取正文来源…</p>}
      {error && <><ErrorNotice>{error}</ErrorNotice><Button onClick={() => setRetry(value => value + 1)}>重新读取来源</Button></>}
      {loaded && !error && !sources.length && <p>尚无已关联的正文。可以明确选择补充正文作为本次来源。</p>}
      {!!sources.length && <label className="object-proposal-source">提案正文来源<select aria-label="提案正文来源" value={selected} onChange={event => setSelected(event.target.value)}>
        {sources.map(item => <option key={item.id} value={item.id}>{item.work_title} / {item.title}</option>)}
      </select></label>}
      <Button onClick={() => setPicker(true)}>选择补充正文</Button>
      {source && <>
        <p><Link to={`/worlds/${world}/create?work=${source.work_id}&node=${source.id}`}>打开来源正文 →</Link></p>
        {source.source_versions && <p className="context-hint">关联来源 v{source.source_versions.join('、v')}；当前正文 v{source.version}。本次提取以确认界面显示的当前已保存版本为准。</p>}
        <ExtractionPanel key={source.id} world={world} nodeId={source.id} selection="" allowSelection={false} prepare={async () => true} />
      </>}
      {picker && <ObjectBrowser world={world} title="选择本次提案的正文来源" types={['content']} onClose={() => setPicker(false)} onPick={item => {
        if (!sources.some(source => source.id === item.id)) setSources(list => [...list, {id: item.id, title: item.label, work_title: item.subtitle, work_id: item.work_id!}]);
        setSelected(item.id); setPicker(false);
      }} />}
    </>}
  </section>;
}
