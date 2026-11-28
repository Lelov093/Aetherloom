import { ArrowUpRight, Plus, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui';
import { ObjectBrowser } from '../objects/ObjectBrowser';
import { entityKinds, type Inspiration } from './api';

export type InspirationObject = Pick<Inspiration['linked_entities'][number], 'id' | 'name' | 'kind' | 'status'>;

export const inspirationLinkStatus: Record<string, string> = { archived: ' · 已归档', deleted: ' · 已删除' };
const objectLimit = 12;

export function InspirationObjects({ objects, world, disabled = false, onChoose, onRemove }: {
  objects: InspirationObject[];
  world?: string;
  disabled?: boolean;
  onChoose?: () => void;
  onRemove?: (id: string) => void;
}) {
  return <section className="inspiration-linked inspiration-objects" aria-label="关联对象">
    <div className="inspiration-objects-heading">
      <h3>关联对象</h3>
      {onChoose && <Button type="button" aria-haspopup="dialog" disabled={disabled || objects.length >= objectLimit} onClick={onChoose}>
        <Plus size={15}/>选择对象
      </Button>}
    </div>
    {objects.length > 0 && <ul className="inspiration-object-list">
      {objects.map(object => {
        const kind = entityKinds[object.kind] || object.kind;
        const label = `${object.name} · ${kind}${inspirationLinkStatus[object.status] ?? ''}`;
        return <li key={object.id}>
          {world ? <Link to={`/worlds/${world}/create/objects/${object.id}`}>{label}<ArrowUpRight size={14}/></Link> : <span>{label}</span>}
          {onRemove && <Button type="button" variant="ghost" aria-label={`移除对象 ${object.name}`} disabled={disabled} onClick={() => onRemove(object.id)}>
            <X size={16}/>
          </Button>}
        </li>;
      })}
    </ul>}
    {onChoose && objects.length >= objectLimit && <p className="context-hint">每条灵感最多关联 {objectLimit} 个对象。</p>}
  </section>;
}

export function InspirationObjectPicker({ world, objects, onPick, onClose }: {
  world: string;
  objects: InspirationObject[];
  onPick: (object: InspirationObject) => void;
  onClose: () => void;
}) {
  return <ObjectBrowser world={world} title="选择关联对象" types={['entity']}
    excludeIds={objects.map(object => object.id)} onClose={onClose} onPick={object => {
      onPick({ id: object.id, name: object.label, kind: object.kind, status: 'active' });
      onClose();
    }} />;
}
