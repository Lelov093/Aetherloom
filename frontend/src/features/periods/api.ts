import { request, type Fact, type FactWrite } from '../creation/api';
import type { RelationshipState } from '../review/api';

export type StoryMoment = { year: number } | { event: string; side: 'before' | 'after' };
export interface PeriodEvent {
  id: string;
  title: string;
  status: string;
  valid_from: string | null;
  valid_until: string | null;
  location_id: string | null;
}
export interface SettingChange { id: string; event_id: string; event: PeriodEvent | null; value: string; version: number }
export interface PeriodField { key: string; label: string; base: string | null; value: string | null; changes: SettingChange[] }
interface Boundaries { from_event: PeriodEvent | null; to_event: PeriodEvent | null }
export type PeriodRelationship = RelationshipState & Boundaries & {
  subject_id: string; object_id: string; subject_name: string; object_name: string;
};
export interface ObjectPeriod {
  fields: PeriodField[];
  facts: (Fact & Boundaries)[];
  relationships: PeriodRelationship[];
  selected_event: PeriodEvent | null;
  events: PeriodEvent[];
}

export function storyParams(moment?: StoryMoment): Record<string, string> {
  if (!moment) return {};
  return 'year' in moment ? { at_year: String(moment.year) } : { at_event: moment.event, event_side: moment.side };
}

export function readMoment(params: URLSearchParams): StoryMoment | undefined {
  const event = params.get('at_event'), side = params.get('event_side'), year = params.get('at_year');
  if (event && (side === 'before' || side === 'after')) return { event, side };
  if (year && /^-?\d{1,6}$/.test(year)) return { year: Number(year) };
}

export function withMoment(path: string, moment?: StoryMoment) {
  if (!moment) return path;
  const [base, search] = path.split('?');
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(storyParams(moment))) params.set(key, value);
  return `${base}?${params}`;
}

export function periodCardPath(world: string, entity: string, moment?: StoryMoment) {
  return withMoment(`/worlds/${world}/create/objects/${entity}?tab=periods`, moment);
}

const base = (world: string) => `/worlds/${world}/periods`;
const jsonWrite = <T,>(url: string, data: T, method = 'POST') => request(url, { method, body: JSON.stringify(data) });
export const periodsApi = {
  object: (world: string, entity: string, point?: StoryMoment) =>
    request<ObjectPeriod>(withMoment(`${base(world)}/objects/${entity}`, point)),
  events: (world: string) => request<PeriodEvent[]>(`${base(world)}/events`),
  recordValue: (world: string, entity: string, data: { target: string; event_id: string; value: string; version: number }) =>
    jsonWrite(`${base(world)}/objects/${entity}/values`, data),
  correctValue: (world: string, entity: string, change: SettingChange, value: string) =>
    jsonWrite(`${base(world)}/objects/${entity}/values/${change.id}`, { value, version: change.version }, 'PATCH'),
  transitionRelationship: (world: string, id: string, data: object) =>
    jsonWrite(`${base(world)}/relationships/${id}/transition`, data),
  transitionFact: (world: string, id: string, data: FactWrite & { event_id: string }) =>
    request<Fact>(`${base(world)}/facts/${id}/transition`, { method: 'POST', body: JSON.stringify(data) }),
};

export function momentLabel(moment?: StoryMoment, event?: PeriodEvent | null) {
  if (!moment) return '跨时期总览';
  if ('year' in moment) return `${moment.year} 年`;
  return `${event?.title ?? '所选事件'} · 事件${moment.side === 'before' ? '前' : '后'}`;
}

export function recordPeriod(item: Boundaries & { valid_from: string | null; valid_until: string | null }) {
  const start = item.from_event ? `${item.from_event.title}后` : item.valid_from || '起始未知';
  const end = item.to_event ? `${item.to_event.title}前` : item.valid_until || (item.from_event ? '后续未记录变化' : '结束未知');
  return `${start} → ${end}`;
}
