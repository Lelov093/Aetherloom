import { useLayoutEffect, useRef } from 'react';

/** Reading position is a view preference, independent of saved content versions. */
export function useReadingPosition(world: string, node: string, reading: boolean, ready: boolean) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !reading || !ready) return;
    const key = `aetherloom:reading-position:${world}:${node}`;
    let saved = 0;
    try { saved = Math.max(0, Number(sessionStorage.getItem(key)) || 0); } catch { /* Keep reading without persistence. */ }
    element.scrollTop = saved;
    const remember = () => {
      try { sessionStorage.setItem(key, String(element.scrollTop)); } catch { /* Keep reading without persistence. */ }
    };
    element.addEventListener('scroll', remember, {passive: true});
    return () => { element.removeEventListener('scroll', remember); };
  }, [world, node, reading, ready]);
  return ref;
}
