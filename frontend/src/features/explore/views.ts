import type { Viewport, XYPosition } from '@xyflow/react';
import { families, type Family } from './api';
import { timeLayers, type TimeLayer, type YearRange } from './api';
import { validTimeViewport, type TimeViewport } from './timelineModel';

export interface SavedView {
  id: string; name: string; focus: string; hops: number; expanded: string[];
  families: Family[]; kinds: string[]; limit: number; labels: boolean;
  positions: Record<string, XYPosition>; viewport?: Viewport;
  mode?: 'relationship' | 'timeline'; range?: YearRange; uncertain?: boolean; layers?: TimeLayer[];
  timelineViewport?: TimeViewport; timelineScroll?: number; cursor?: number;
  timeOffsets?: { placed: number; unplaced: number };
}
const storageKey = (world: string) => `aetherloom:explore-views:${world}`;
export function readViews(world: string): SavedView[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(storageKey(world)) || '[]');
    if (!Array.isArray(values)) return [];
    return values.filter(v => v && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.focus === 'string')
      .slice(0, 20).map(v => ({ ...v, hops: v.hops === 2 ? 2 : 1, expanded: Array.isArray(v.expanded) ? v.expanded.filter((k: unknown) => typeof k === 'string').slice(0, 20) : [],
        families: Array.isArray(v.families) ? v.families.filter((f: Family) => families.includes(f)) : families,
        kinds: Array.isArray(v.kinds) ? v.kinds.filter((k: unknown) => typeof k === 'string') : [],
        limit: Math.max(5, Math.min(120, Number(v.limit) || 60)), labels: v.labels !== false,
        mode: v.mode === 'timeline' ? 'timeline' : 'relationship',
        range: Object.fromEntries(Object.entries(v.range || {}).filter(([key, value]) => ['start', 'end'].includes(key) && Number.isInteger(value) && Math.abs(value as number) <= 999999)),
        uncertain: v.uncertain !== false, layers: Array.isArray(v.layers) ? v.layers.filter((layer: TimeLayer) => timeLayers.includes(layer)) : timeLayers,
        timelineViewport: validTimeViewport(v.timelineViewport) ? v.timelineViewport : undefined,
        timelineScroll: Math.max(0, Number(v.timelineScroll) || 0), cursor: Number.isInteger(v.cursor) && Math.abs(v.cursor) <= 999999 ? v.cursor : undefined,
        timeOffsets: { placed: Math.max(0, Math.floor(Number(v.timeOffsets?.placed) || 0)), unplaced: Math.max(0, Math.floor(Number(v.timeOffsets?.unplaced) || 0)) },
        positions: Object.fromEntries(Object.entries(v.positions || {}).filter(([, p]) => {
          const value = p as XYPosition; return Number.isFinite(value?.x) && Number.isFinite(value?.y);
        })), viewport: v.viewport && [v.viewport.x, v.viewport.y, v.viewport.zoom].every(Number.isFinite) ? v.viewport : undefined }));
  } catch { return []; }
}
export function writeViews(world: string, views: SavedView[]) {
  localStorage.setItem(storageKey(world), JSON.stringify(views));
}
