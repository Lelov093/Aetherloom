import { request } from './api';
import type { SelectedSource } from './ObjectFromSourceDialog';

export interface InspirationAdoption {
  id: string;
  inspiration_id: string;
  inspiration_title: string;
  node_id: string;
  work_id: string;
  title: string;
  work_title: string;
  path: string;
  start: number;
  end: number;
  quote: string;
  source_version: number;
  current_version: number;
  anchor_state: 'current' | 'revised' | 'missing' | 'archived';
}

export const inspirationAdoptionApi = {
  add: (world: string, inspiration: string, { node_id, source_version, start, end }: SelectedSource) =>
    request<{ id: string }>(`/worlds/${world}/inspiration-adoptions`, {
      method: 'POST', body: JSON.stringify({ inspiration_id: inspiration, node_id, source_version, start, end }),
    }),
  node: (world: string, node: string) =>
    request<InspirationAdoption[]>(`/worlds/${world}/nodes/${node}/inspiration-adoptions`),
  inspiration: (world: string, inspiration: string) =>
    request<InspirationAdoption[]>(`/worlds/${world}/inspirations/${inspiration}/adoptions`),
  source: (world: string, id: string) =>
    request<InspirationAdoption>(`/worlds/${world}/inspiration-adoptions/${id}`),
};

export function adoptionLibraryPath(world: string, row: InspirationAdoption) {
  return `/worlds/${world}/inspirations?${new URLSearchParams({ id: row.inspiration_id, adoption: row.id })}`;
}

export function adoptionSourcePath(world: string, id: string) {
  return `/worlds/${world}/create/sources/${id}?adoption=1`;
}

export function adoptionManuscriptPath(world: string, row: Pick<InspirationAdoption, 'work_id' | 'node_id' | 'id' | 'anchor_state'>) {
  const query = new URLSearchParams({ work: row.work_id, node: row.node_id, mode: 'read' });
  if (row.anchor_state === 'current') query.set('adoption', row.id);
  return `/worlds/${world}/create?${query}`;
}

export const adoptionStateLabel = {
  current: '可定位当前正文',
  revised: '正文已修订，请查看原选段或重新选段。',
  missing: '当前正文已无原选段，请查看原选段或重新选段。',
  archived: '正文已归档，仍可查看原选段。',
};
