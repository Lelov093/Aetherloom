import { useEffect, useState } from 'react';
import { exploreApi, type TimelinePage, type TimeLayer, type YearRange } from './api';

export function useTimeline(world: string, enabled: boolean, query: { focus: string; range: YearRange; layers: TimeLayer[]; uncertain: boolean; placedOffset: number; unplacedOffset: number; locate: string }, retry: number) {
  const key = JSON.stringify(query);
  const [loaded, setLoaded] = useState<{ key: string; placed: TimelinePage; unplaced: TimelinePage }>();
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setLoading(true); setError('');
    const q = JSON.parse(key) as typeof query;
    Promise.all(['placed', 'unplaced'].map(section => exploreApi.timeline(world, q.focus, q.range, q.layers, q.uncertain, section, section === 'placed' ? q.placedOffset : q.unplacedOffset, q.locate)))
      .then(([placed, unplaced]) => { if (active) setLoaded({ key, placed, unplaced }); })
      .catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [world, enabled, key, retry]);
  return { ...loaded, loading: enabled && (loading || loaded?.key !== key && !error), error };
}
