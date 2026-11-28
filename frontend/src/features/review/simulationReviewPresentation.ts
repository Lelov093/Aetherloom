import type { SimPreview } from '../simulation/api';

export function filterSimulationReviews(list: SimPreview[], status: string, kind: string, run: string, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return list.filter(preview => {
    const candidate = preview.candidate;
    const payload = candidate.payload;
    const text = [payload.title, payload.name, payload.value, payload.description, payload.predicate, preview.source.title, ...preview.affected_entities.map(entity => entity.name)].join(' ').toLocaleLowerCase();
    return (status === 'all' || (status === 'pending' ? candidate.status === 'pending' : candidate.status !== 'pending')) && (!kind || candidate.kind === kind) && (!run || preview.source.simulation_id === run) && (!needle || text.includes(needle));
  });
}
