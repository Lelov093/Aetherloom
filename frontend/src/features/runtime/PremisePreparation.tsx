import { Button } from '../../components/ui';
import type { Entity } from '../creation/api';
import type { KeyUnknown, OrdinaryPast } from './api';

export type PastDraft = OrdinaryPast & { id: string };
export type UnknownDraft = KeyUnknown & { id: string };

export function PremisePreparation({ people, ordinary, unknowns, disabled, onOrdinary, onUnknowns }: {
  people: Entity[];
  ordinary: PastDraft[];
  unknowns: UnknownDraft[];
  disabled: boolean;
  onOrdinary: (values: PastDraft[]) => void;
  onUnknowns: (values: UnknownDraft[]) => void;
}) {
  return <details className="opening-role">
    <summary>往事与关键未知{ordinary.length + unknowns.length > 0 && ` · ${ordinary.length + unknowns.length} 项`}</summary>
    <div className="opening-detail">
      <p className="opening-note">默认按角色陈述记录对白。作者可逐条允许补充本线往事，或允许在本线确定一个尚无答案的问题。</p>
      {ordinary.map((row, index) => {
        const update = (patch: Partial<OrdinaryPast>) => onOrdinary(ordinary.map(other => other.id === row.id ? { ...row, ...patch } : other));
        return <fieldset key={row.id} className="opening-evidence" disabled={disabled}>
          <legend>普通往事 {index + 1}</legend>
          <label>允许补充的内容<textarea rows={2} maxLength={450} value={row.text}
            onChange={event => update({ text: event.target.value })} /></label>
          <PremisePeople label="亲历者" people={people} selected={row.witnesses} onChange={witnesses => update({ witnesses })} />
          <Button type="button" variant="ghost" onClick={() => onOrdinary(ordinary.filter(other => other.id !== row.id))}>移除往事</Button>
        </fieldset>;
      })}
      <Button type="button" disabled={disabled || ordinary.length >= 6 || people.length === 0}
        onClick={() => onOrdinary([...ordinary, { id: crypto.randomUUID(), text: '', witnesses: [] }])}>授权一条普通往事</Button>
      {unknowns.map((row, index) => {
        const update = (patch: Partial<KeyUnknown>) => onUnknowns(unknowns.map(other => other.id === row.id ? { ...row, ...patch } : other));
        return <fieldset key={row.id} className="opening-evidence" disabled={disabled}>
          <legend>关键未知 {index + 1}</legend>
          <label>还没有答案的问题<input value={row.title} maxLength={100} onChange={event => update({ title: event.target.value })} /></label>
          <label className="preparation-choice"><input type="checkbox" checked={row.may_resolve} onChange={event => {
            update(event.target.checked ? { may_resolve: true } : { may_resolve: false, knowers: [] });
          }} />允许作者在本线确定答案</label>
          {row.may_resolve && <PremisePeople label="答案确定后直接获知的角色" people={people} selected={row.knowers}
            onChange={knowers => update({ knowers })} />}
          <Button type="button" variant="ghost" onClick={() => onUnknowns(unknowns.filter(other => other.id !== row.id))}>移除问题</Button>
        </fieldset>;
      })}
      <Button type="button" disabled={disabled || unknowns.length >= 6}
        onClick={() => onUnknowns([...unknowns, { id: crypto.randomUUID(), title: '', may_resolve: false, knowers: [] }])}>登记一个关键未知</Button>
    </div>
  </details>;
}

function PremisePeople({ label, people, selected, onChange }: {
  label: string; people: Entity[]; selected: string[]; onChange: (ids: string[]) => void;
}) {
  return <fieldset className="opening-group">
    <legend>{label}</legend>
    {people.map(person => <label className="preparation-choice" key={person.id}>
      <input type="checkbox" checked={selected.includes(person.id)}
        disabled={selected.length >= 12 && !selected.includes(person.id)}
        onChange={event => onChange(event.target.checked ? [...selected, person.id] : selected.filter(id => id !== person.id))} />
      {person.name}
    </label>)}
  </fieldset>;
}
