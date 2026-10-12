export function WorldHorizon({ compact = false }: { compact?: boolean }) {
  return <img className={`world-horizon ${compact ? 'compact' : ''}`} src="/art/harbor-light.webp" alt="" aria-hidden="true" />;
}
