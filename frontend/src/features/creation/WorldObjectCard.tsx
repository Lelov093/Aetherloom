import { ArrowUpRight } from 'lucide-react';
import { EntityMark } from '../../components/EntityMark';
import { DisplayImage } from '../objects/DisplayImages';
import { Portrait } from '../objects/Portrait';
import { entityKinds, type Entity, type ObjectSchema } from './api';
import { ObjectBrowseLink } from './ObjectNavigation';

type CoreLabels = ObjectSchema['core'];

export function cardFieldLabels(core: CoreLabels) {
  const labels: Record<string, string> = { summary: '简介', aliases: '别名' };
  for (const fields of Object.values(core)) {
    for (const [key, label] of Object.entries(fields)) {
      const field = `core:${key}`;
      if (!labels[field]) labels[field] = label;
      else if (!labels[field].split(' / ').includes(label)) labels[field] += ` / ${label}`;
    }
  }
  return labels;
}

export function cardFieldLabel(field: string, labels: Record<string, string>) {
  return field.startsWith('section:') ? field.slice('section:'.length) : labels[field] || field;
}

export function WorldObjectCard({ entity, to, imageVersion, fields, core = {} }: {
  entity: Entity;
  to: string;
  imageVersion?: number;
  fields?: string[];
  core?: CoreLabels;
}) {
  const summary = Object.values(entity.core || {}).find(value => value.trim())
    || entity.sections.find(section => section.body.trim())?.body;
  const aliases = entity.aliases.join(' · ');
  function fieldValue(field: string) {
    if (field === 'summary') return summary;
    if (field === 'aliases') return aliases;
    if (field.startsWith('core:')) return entity.core?.[field.slice('core:'.length)];
    const title = cardFieldLabel(field, {});
    return entity.sections.find(section => section.title === title && section.body.trim())?.body;
  }
  const labels = { summary: '简介', aliases: '别名' };
  return <ObjectBrowseLink className="object-card" to={to} focusId={`object-card-${entity.id}`} backLabel={fields ? '返回分类' : '世界对象'}>
    <header>
      {entity.kind === 'character' ? <Portrait id={entity.id} name={entity.name} version={imageVersion} size="large" />
        : entity.kind === 'location' && imageVersion ? <DisplayImage owner="entity" id={entity.id} name={entity.name} version={imageVersion} className="object-scene-thumb" />
          : <EntityMark kind={entity.kind} />}
      <span className="material-category">{entityKinds[entity.kind]}</span>
      <ArrowUpRight className="object-card-arrow" size={17} />
    </header>
    <h2>{entity.name}</h2>
    {fields ? !!fields.length && <dl className="object-card-fields">
      {fields.map(field => {
        const label = field.startsWith('core:') ? core[entity.kind]?.[field.slice('core:'.length)] : cardFieldLabel(field, labels);
        return label && <div key={field}><dt>{label}</dt><dd>{fieldValue(field)?.trim() || '未填写'}</dd></div>;
      })}
    </dl> : <>
      <small>{aliases || '尚无别名'}</small>
      <p>{summary || '尚未填写说明，可从这里逐步整理。'}</p>
    </>}
    <footer>阅读资料 <span>→</span></footer>
  </ObjectBrowseLink>;
}
