import { useLayoutEffect, useRef, type MouseEvent, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';

function followsHere(event: MouseEvent<HTMLAnchorElement>) {
  return !event.defaultPrevented && event.button === 0
    && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function ObjectBrowseLink({ to, focusId, backLabel, className, children }: {
  to: string;
  focusId: string;
  backLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigationType();
  const link = useRef<HTMLAnchorElement>(null);
  const position = location.state?.objectPosition;
  useLayoutEffect(() => {
    if (navigation === 'POP' && position?.focusId === focusId) {
      window.scrollTo(0, position.scrollY);
      link.current?.focus({ preventScroll: true });
    }
  }, [focusId, location.key, navigation, position]);
  return <Link ref={link} id={focusId} to={to} className={className} onClick={async event => {
    if (!followsHere(event)) return;
    event.preventDefault();
    const origin = location.pathname + location.search + location.hash;
    const objectPosition = { focusId, scrollY: window.scrollY };
    await navigate(origin, { replace: true, preventScrollReset: true, state: { ...location.state, objectPosition } });
    await navigate(to, { state: { objectOrigin: { to: origin, label: backLabel } } });
  }}>{children}</Link>;
}

export function ObjectBackLink({ to, label }: { to: string; label: string }) {
  const { state } = useLocation();
  const navigate = useNavigate();
  const origin = state?.objectOrigin;
  return <Link className="back-link" to={origin?.to ?? to} onClick={event => {
    if (!origin || !followsHere(event)) return;
    event.preventDefault();
    void navigate(-1);
  }}><ArrowLeft size={16} />{origin?.label ?? label}</Link>;
}

export function useObjectPageTop(ready: boolean) {
  const { key, state } = useLocation();
  const navigation = useNavigationType();
  const opened = useRef('');
  useLayoutEffect(() => {
    if (ready && navigation === 'PUSH' && state?.objectOrigin && opened.current !== key) {
      opened.current = key;
      window.scrollTo(0, 0);
    }
  }, [key, navigation, ready, state]);
}

export function useObjectFilters() {
  const [params, setParams] = useSearchParams();
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true, preventScrollReset: true });
  }
  return [params, setFilter] as const;
}
