export function relationshipPath(world: string, { focus, record }: { focus?: string; record?: string }) {
  const params = new URLSearchParams();
  if (focus) params.set('focus', focus);
  if (record) params.set('record', record);
  return `/worlds/${world}/explore${params.size ? `?${params}` : ''}`;
}
