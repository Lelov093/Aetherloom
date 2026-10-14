import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui';
import { reviewApi, type CurrentRecord, type SimulationSource } from './api';

/** Canon can originate in either a saved document or an explicitly accepted worldline. */
export function CanonSources({ record, kind, world }: { record: CurrentRecord; kind: string; world: string }) {
  const [saved, setSaved] = useState<{ id: string; sources: SimulationSource[] }>(), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setError('');
    void reviewApi.simulationSources(kind, record.id).then(sources => { if (active) setSaved({ id: record.id, sources }); }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [record.id, kind, retry]);
  return <div className="current-evidence">
    {record.source_note && <small>{record.source_note}</small>}
    {record.sources?.map(source => <Link key={source.id} className="text-link" to={`/worlds/${world}/review?candidate=${source.id}`}>正文审阅来源 · v{source.source_version} →</Link>)}
    {saved?.id === record.id && saved.sources.map(source => <Link key={source.id} className="text-link" to={`/worlds/${world}/review/simulation?proposal=${source.id}`}>模拟来源 · {source.title} · 第{source.seq}步 →</Link>)}
    {error && <div className="review-source-error" role="status">模拟来源读取失败<Button variant="ghost" onClick={() => setRetry(value => value + 1)}>重试来源</Button></div>}
    {!error && saved?.id === record.id && !saved.sources.length && !record.sources?.length && !record.source_note && <small>未附来源记录</small>}
  </div>;
}
