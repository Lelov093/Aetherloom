import { useId, useLayoutEffect, useRef } from 'react';
import { Button } from '../../components/ui';
import { entityKinds, type Entity } from './api';

type Comparison = [label: string, saved: string, draft: string];

export function objectComparison(saved: Entity, draft: Entity): Comparison[] {
  const type = (entity: Entity) => entity.custom_type || entityKinds[entity.kind];
  const core = (entity: Entity) => Object.entries(entity.core).filter(([, text]) => text.trim())
    .map(([key, text]) => `${key} · ${text}`).join('\n');
  const sections = (entity: Entity) => entity.sections.map(section => [section.title, section.body].join('\n')).join('\n\n');
  const states = { active: '活跃', archived: '已归档', deleted: '已删除' };
  return [
    ['名称', saved.name, draft.name],
    ['类型', type(saved), type(draft)],
    ['状态', states[saved.status], states[draft.status]],
    ['别名', saved.aliases.join('、'), draft.aliases.join('、')],
    ['核心资料', core(saved), core(draft)],
    ['说明小节', sections(saved), sections(draft)],
  ];
}

export function SaveConflict({ base, current, fields, onContinue }: {
  base: number;
  current: number;
  fields: Comparison[];
  onContinue?: () => void;
}) {
  const title = useId();
  const section = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    section.current?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  return <section ref={section} className="save-conflict" aria-labelledby={title}>
    <h3 id={title}>保存版本冲突</h3>
    <p role="alert">已保存 v{current}，你的草稿基于 v{base}。草稿仍在编辑器中。</p>
    {fields.filter(([, saved, draft]) => saved !== draft).map(([label, saved, draft]) => <div key={label} className="save-conflict-field">
      <h4>{label}</h4>
      <dl>
        <div><dt>当前已保存</dt><dd>{saved || '空白'}</dd></div>
        <div><dt>本次草稿</dt><dd>{draft || '空白'}</dd></div>
      </dl>
    </div>)}
    {onContinue && <Button type="button" onClick={onContinue}>保留草稿，以 v{current} 继续编辑</Button>}
  </section>;
}
