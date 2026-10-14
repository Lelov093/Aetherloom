import { useCallback, useEffect, useRef, useState } from 'react';

/** Keep the previous comparison visible, but never let it decide the new selection. */
export function useReviewPreview<T extends { candidate: { id: string } }>(scope: string, id: string | null, load: (id: string) => Promise<T>) {
  const [saved, setSaved] = useState<{ scope: string; value: T }>();
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const request = useRef(0), latest = useRef({ scope, id, load });
  latest.current = { scope, id, load };
  const reload = useCallback(async () => {
    const target = latest.current, sequence = ++request.current;
    if (!target.id) { setSaved(undefined); setLoading(false); setError(''); return; }
    const matches = () => sequence === request.current && target.id === latest.current.id && target.scope === latest.current.scope;
    setLoading(true); setError('');
    try {
      const value = await target.load(target.id);
      if (matches()) setSaved({ scope: target.scope, value });
    } catch (failure) {
      if (matches()) setError((failure as Error).message);
    } finally { if (matches()) setLoading(false); }
  }, []);
  useEffect(() => { void reload(); return () => { request.current++; }; }, [scope, id, reload]);
  const value = id && saved?.scope === scope ? saved.value : undefined;
  const current = Boolean(value && value.candidate.id === id);
  return { value, current, loading, error, reload };
}
