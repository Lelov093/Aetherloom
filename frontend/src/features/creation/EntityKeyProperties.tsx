import { Link } from 'react-router-dom';
import { Button } from '../../components/ui';
import type { Entity } from './api';

const keys = new Set(['age', 'species', 'occupation', 'member_of', 'location', 'capital']);
const legacyNames = new Set(['年龄', '年齡', 'age', '种族', '物种', 'species',
  '职业', '職業', 'occupation', 'profession', '所属组织', 'member_of',
  '所在地', 'location', '首都', 'capital']);

export function EntityKeyProperties({ entity, onOpenFacts }: {
  entity: Entity; onOpenFacts: () => void;
}) {
  const facts = entity.facts?.filter(f => f.status === 'active' &&
    (f.field_id ? keys.has(f.field_id) : legacyNames.has(f.predicate.trim().toLowerCase()))) || [];
  if (!facts.length) return null;
  return <section className="entity-key-properties" aria-label="已确认关键事实">
    <header><h2>已确认关键事实</h2><Button variant="ghost" onClick={onOpenFacts}>查看全部世界事实</Button></header>
    <dl>{facts.map(f => <div key={f.id}>
      <dt>{f.predicate}</dt>
      <dd>{f.object_id ? <Link to={`/worlds/${entity.world_id}/create/objects/${f.object_id}`}>{f.value} →</Link> : f.value}</dd>
      <dd className="entity-key-time">{f.valid_from || '起始未知'} → {f.valid_until || '结束未知'}</dd>
    </div>)}</dl>
  </section>;
}
