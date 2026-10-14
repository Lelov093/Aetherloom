import type { SimPreview } from '../simulation/api';

export const resolutionLabels: Record<string, string> = { replace: '替代差异记录，保留历史', keep_both: '明确保留双方', temporal: '按已确认的不同时间保留' };
export function filterSimulationReviews(list: SimPreview[], status: string, kind: string, run: string, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return list.filter(preview => {
    const candidate = preview.candidate;
    const payload = candidate.payload;
    const text = [payload.title, payload.name, payload.value, payload.description, payload.predicate, preview.source.title, ...preview.affected_entities.map(entity => entity.name)].join(' ').toLocaleLowerCase();
    return (status === 'all' || (status === 'pending' ? candidate.status === 'pending' : candidate.status !== 'pending')) && (!kind || candidate.kind === kind) && (!run || preview.source.simulation_id === run) && (!needle || text.includes(needle));
  });
}

export function acceptanceEffect(preview: SimPreview, resolution: string) {
  const { candidate, current, field_mapping: mapping } = preview, payload = candidate.payload;
  if (candidate.kind === 'assertion' && current.some(record => record.value === (mapping?.value ?? payload.value) &&
    (record.object_id ?? null) === (payload.object_ref ?? null) && (record.field_id ?? null) === (payload.field_id ?? null) &&
    (record.valid_from ?? null) === (payload.valid_from ?? null) && (record.valid_until ?? null) === (payload.valid_until ?? null))) {
    return '关联到已有相同事实，保留本次模拟来源';
  }
  if (resolution === 'replace' && preview.conflicts.length) return `新增提案事实，替代 ${preview.conflicts.length} 条差异记录；旧记录保留`;
  if (resolution === 'keep_both' && current.length) return '新增独立记录，并保留当前记录';
  if (resolution === 'temporal' && preview.temporal_change) return '新增不同时间的事实，并保留当前记录';
  return candidate.kind === 'event' ? '新增正式事件，保留原始模拟依据' : '新增正式事实，保留原始模拟依据';
}
