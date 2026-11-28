import { request } from '../creation/api';

export type Point = { x: number; y: number };
export type FeatureKind = 'marker' | 'region' | 'label';
export const featureKinds = { marker: '地点标记', region: '区域', label: '文字标签' } as const;

export interface MapInfo {
  id: string;
  title: string;
  width: number;
  height: number;
  version: number;
  has_background: 0 | 1;
}
export interface FeatureData {
  kind: FeatureKind;
  name: string;
  points: Point[];
  color: string;
  entity_id: string | null;
  child_map_id: string | null;
  new_location?: string;
}
export interface MapFeature extends FeatureData {
  id: string;
  version: number;
  entity: { id: string; name: string; kind: string; status: string } | null;
}
export interface MapDetail extends MapInfo { features: MapFeature[] }
export interface MapDirectory {
  maps: MapInfo[];
  links: { map_id: string; child_map_id: string }[];
}
interface MapPosition {
  map_id: string;
  map_title: string;
  feature_id: string;
  kind: FeatureKind;
  name: string;
}

const base = (world: string) => `/worlds/${world}/maps`;
export function mapPath(world: string, map?: string, focus?: { id: string; locate?: boolean }) {
  const params = new URLSearchParams();
  if (map) params.set('map', map);
  if (focus) params.set(focus.locate ? 'locate' : 'item', focus.id);
  return `/worlds/${world}/explore/maps${params.size ? `?${params}` : ''}`;
}
export const featureName = (feature: MapFeature) => feature.name || feature.entity?.name || featureKinds[feature.kind];
export const mapsApi = {
  list: (world: string) => request<MapDirectory>(base(world)),
  map: (world: string, map: string) => request<MapDetail>(`${base(world)}/${map}`),
  background: (world: string, map: MapInfo) => `/api${base(world)}/${map.id}/background?v=${map.version}`,
  saveMap: (world: string, data: FormData, map?: string) => request<MapInfo>(map ? `${base(world)}/${map}` : base(world),
    { method: map ? 'PATCH' : 'POST', body: data }),
  saveFeature: (world: string, map: string, id: string, data: FeatureData, version?: number) =>
    request<MapFeature>(`${base(world)}/${map}/features${version ? `/${id}` : ''}`,
      { method: version ? 'PATCH' : 'POST', body: JSON.stringify(version ? { ...data, version } : { ...data, id }) }),
  removeFeature: (world: string, map: string, feature: MapFeature) =>
    request<{ id: string }>(`${base(world)}/${map}/features/${feature.id}?version=${feature.version}`, { method: 'DELETE' }),
  positions: (world: string, entity: string) => request<MapPosition[]>(`/worlds/${world}/locations/${entity}/map-positions`),
};
