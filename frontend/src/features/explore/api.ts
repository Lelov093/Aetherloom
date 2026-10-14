import { request, type CanonHistory, type Fact } from '../creation/api';
import type { ObjectRef } from '../objects/api';

export const familyNames = { relationship: '正式关系', assertion: '对象引用', participation: '事件参与', location: '事件地点', cause: '事件因果' };
export type Family = keyof typeof familyNames;
export const families = Object.keys(familyNames) as Family[];
export interface ExploreNode extends ObjectRef { key: string; depth: number; version: number }
export interface ExploreEdge {
  id: string; source: string; target: string; family: Family;
  record_type: 'relationship' | 'assertion' | 'event'; record_id: string;
  label: string; valid_from: string | null; valid_until: string | null; strength: number | null; version: number;
  time_uncertain?: boolean;
}
export interface YearRange { start?: number; end?: number }
export type TimeLayer = 'event' | 'relationship' | 'assertion';
export const timeLayers: TimeLayer[] = ['event', 'relationship', 'assertion'];
export const timeLayerNames = { event: '正式事件', relationship: '关系状态', assertion: '正式事实' };
export interface TimelineRecord {
  key: string; kind: TimeLayer; id: string; label: string; value: string; version: number;
  valid_from: string | null; valid_until: string | null; lane_key: string; lane_label: string;
  time: { start: number | null; end: number | null; certainty: 'dated' | 'partial' | 'undated' | 'invalid' };
  objects: { key: string; label: string; kind: string }[];
}
export interface TimelinePage {
  focus: string; requested_focus: string; focus_object: ExploreNode | null; revision: number;
  items: TimelineRecord[]; counts: Record<'dated' | 'partial' | 'undated' | 'invalid' | 'outside', number>;
  bounds: { start: number | null; end: number | null }; total: number; remaining: number; offset: number;
}
export function yearParams(range: YearRange = {}, uncertain = true) {
  return { ...(range.start !== undefined ? { year_start: String(range.start) } : {}),
    ...(range.end !== undefined ? { year_end: String(range.end) } : {}), uncertain: String(uncertain) };
}
export interface ExploreGraph {
  focus: string; requested_focus: string; revision: number; nodes: ExploreNode[];
  edges: ExploreEdge[]; remaining_links: number; expanded: string[];
}
export interface SourceLink { label: string; to: string; kind: string }
export interface Detail {
  kind: string; id: string; title: string;
  record: { kind?: string; aliases?: string[]; status: string; version: number; description?: string; value?: string;
    valid_from?: string | null; valid_until?: string | null; strength?: number | null; source_note?: string;
    metadata?: { before_state?: string; after_state?: string } };
  settings: { label: string; text: string }[];
  facts: (Fact & { sources: SourceLink[] })[];
  references: { key: string; label: string; role: string; active: boolean }[];
  sources: SourceLink[];
  states: { id: string; label: string; valid_from: string | null; valid_until: string | null; status: string; version: number }[];
  history: CanonHistory[];
}
export interface GraphQuery { focus: string; hops: number; expanded: string[]; families: Family[]; kinds: string[]; limit: number; range?: YearRange; uncertain?: boolean }
export const exploreApi = {
  graph: (world: string, query: GraphQuery) => request<ExploreGraph>(`/worlds/${world}/explore/graph?${new URLSearchParams({
    focus: query.focus, hops: String(query.hops), expanded: query.expanded.join(','), families: query.families.join(','), kinds: query.kinds.join(','), limit: String(query.limit),
    ...yearParams(query.range, query.uncertain),
  })}`),
  timeline: (world: string, focus: string, range: YearRange, layers: TimeLayer[], uncertain: boolean, section: string, offset: number, locate = '') => request<TimelinePage>(`/worlds/${world}/explore/timeline?${new URLSearchParams({ focus, layers: layers.join(','), ...yearParams(range, uncertain), section, offset: String(offset), locate, limit: section === 'placed' ? '120' : '40' })}`),
  detail: (world: string, kind: string, id: string) => request<Detail>(`/worlds/${world}/explore/detail/${kind}/${id}`),
};
export function period(value: { valid_from?: string | null; valid_until?: string | null }) {
  return value.valid_from || value.valid_until ? `${value.valid_from || '起始未知'} → ${value.valid_until || '结束未知'}` : '故事时间未注明';
}
