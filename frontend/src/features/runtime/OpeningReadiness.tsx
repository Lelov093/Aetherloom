import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui';
import type { Entity } from '../creation/api';
import { materialKey, type MaterialDraft } from './BackgroundPicker';
import type { OpeningCheck, OpeningCitation, OpeningRoleCheck, ScenarioScopeEntry } from './api';

type Basis = 'initial' | 'experienced' | 'reported' | 'belief';

const basisLabels: Record<Basis, string> = {
  initial: '开局已知', experienced: '亲历', reported: '转述', belief: '信念（可能有误）',
};

export interface EvidenceDraft {
  id: string; basis: Basis; text: string; reporter: string; source: string;
}
export interface CharacterDraft {
  location: string; goal: string; voiceSample: string; evidence: EvidenceDraft[];
}
export interface RuleDraft { mechanism: '' | 'entry_item'; destination: string; item: string; holder: string }

const emptyRole: CharacterDraft = { location: '', goal: '', voiceSample: '', evidence: [] };
export const emptyRule: RuleDraft = { mechanism: '', destination: '', item: '', holder: '' };

function EntityOptions({ entities }: { entities: Entity[] }) {
  return <>{entities.map(entity => <option key={entity.id} value={entity.id}>
    {entity.name}{entities.some(other => other.id !== entity.id && other.name === entity.name) ? ` · ${entity.id.slice(0, 8)}` : ''}
  </option>)}</>;
}

export function RoleRoster({ people, cast, candidates, scenery, materials, drafts, disabled, onRoster, onRole }: {
  people: Entity[]; cast: string[]; candidates: string[]; scenery: Entity[]; materials: MaterialDraft[];
  drafts: Record<string, CharacterDraft>; disabled: boolean;
  onRoster: (group: 'cast' | 'candidate', ids: string[]) => void;
  onRole: (id: string, value: CharacterDraft) => void;
}) {
  const [choice, setChoice] = useState({ cast: '', candidate: '' });
  const available = people.filter(person => !cast.includes(person.id) && !candidates.includes(person.id));
  return <div className="opening-roster">
    {([
      { group: 'cast', title: '参与人物', label: '加入参与人物', ids: cast, limit: 12, empty: '至少选一位开局出场。' },
      { group: 'candidate', title: '候选人物', label: '加入候选人物', ids: candidates, limit: 6,
        empty: '候选收到作者的定向邀请后，从其所在地点开始参与。' },
    ] as const).map(({ group, title, label, ids, limit, empty }) => {
      const pick = available.find(person => person.id === choice[group])?.id ?? '';
      return <fieldset className="opening-group" key={group} disabled={disabled}>
        <legend>{title}</legend>
        <div className="opening-pick">
          <select aria-label={title} value={pick} onChange={event => setChoice({ ...choice, [group]: event.target.value })}>
            <option value="">选择{title}</option><EntityOptions entities={available} />
          </select>
          <Button type="button" disabled={!pick || ids.length >= limit} onClick={() => {
            onRoster(group, [...ids, pick]); setChoice({ ...choice, [group]: '' });
          }}>{label}</Button>
        </div>
        {!ids.length && <p className="opening-note">{empty}</p>}
        {ids.map(id => {
          const name = people.find(person => person.id === id)?.name ?? '人物已收起';
          return <details className="opening-role" id={`opening-role-${id}`} key={id}>
            <summary>{name} · 设置位置与知情</summary>
            <CharacterFields name={name} draft={drafts[id] ?? emptyRole} places={scenery} materials={materials}
              candidate={group === 'candidate'} onChange={value => onRole(id, value)} />
            <Button type="button" variant="ghost" aria-label={`移出${title}：${name}`}
              onClick={() => onRoster(group, ids.filter(value => value !== id))}>移出{title}</Button>
          </details>;
        })}
      </fieldset>;
    })}
  </div>;
}

function CharacterFields({ name, draft, places, materials, candidate, onChange }: {
  name: string; draft: CharacterDraft; places: Entity[]; materials: MaterialDraft[]; candidate: boolean;
  onChange: (value: CharacterDraft) => void;
}) {
  function editEntry(id: string, change: Partial<EvidenceDraft>) {
    onChange({ ...draft, evidence: draft.evidence.map(row => row.id === id ? { ...row, ...change } : row) });
  }
  return <div className="opening-detail">
    <div className="preparation-fields">
      <label>{candidate ? '候选所在地点' : '本线开局位置'}
        <select aria-label={`${name} · ${candidate ? '候选所在地点' : '本线开局位置'}`} value={draft.location}
          onChange={event => onChange({ ...draft, location: event.target.value })}>
          <option value="">沿用有效设定或开场地点</option><EntityOptions entities={places} />
        </select>
      </label>
      <label>本场角色目标<input maxLength={400} value={draft.goal} onChange={event => onChange({ ...draft, goal: event.target.value })} /></label>
    </div>
    <label>口吻样句<textarea rows={2} maxLength={250} value={draft.voiceSample}
      onChange={event => onChange({ ...draft, voiceSample: event.target.value })} /></label>
    {draft.evidence.map((entry, index) => <fieldset className="opening-evidence" key={entry.id}>
      <legend>角色输入 {index + 1}</legend>
      <div className="preparation-fields">
        <label>获知方式<select value={entry.basis} onChange={event => editEntry(entry.id, { basis: event.target.value as Basis })}>
          {Object.entries(basisLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {entry.basis === 'reported' && <label>谁告诉了角色<input maxLength={80} value={entry.reporter}
          onChange={event => editEntry(entry.id, { reporter: event.target.value })} /></label>}
      </div>
      <label>交给角色的内容<textarea rows={2} maxLength={450} value={entry.text}
        onChange={event => editEntry(entry.id, { text: event.target.value })} /></label>
      <label>原文依据（可选）<select value={entry.source} onChange={event => editEntry(entry.id, { source: event.target.value })}>
        <option value="">本场手工填写</option>
        {entry.source && !materials.some(row => materialKey(row) === entry.source) &&
          <option value={entry.source}>原选段已移除，请重新指定</option>}
        {materials.map(row => <option key={materialKey(row)} value={materialKey(row)}>
          {row.title} · v{row.version} · {row.quote.slice(0, 26)}
        </option>)}
      </select></label>
      <Button type="button" variant="ghost" onClick={() => onChange({
        ...draft, evidence: draft.evidence.filter(row => row.id !== entry.id),
      })}>移除此条输入</Button>
    </fieldset>)}
    <Button type="button" disabled={draft.evidence.length >= 8} onClick={() => onChange({
      ...draft, evidence: [...draft.evidence, { id: crypto.randomUUID(), basis: 'initial', text: '', reporter: '', source: '' }],
    })}>添加角色输入</Button>
  </div>;
}

export function OpeningRules({ rules, places, items, holders, drafts, disabled, onRule }: {
  rules: ScenarioScopeEntry[]; places: Entity[]; items: Entity[]; holders: Entity[];
  drafts: Record<string, RuleDraft>; disabled: boolean; onRule: (id: string, value?: RuleDraft) => void;
}) {
  if (!rules.length) return <p className="opening-note">当前关联范围没有规则卡。</p>;
  return <ul className="opening-rules">
    {rules.map(rule => {
      const settings = drafts[rule.id];
      return <li id={`opening-rule-${rule.id}`} key={rule.id}>
        <div className="opening-rule-top">
          <strong>{rule.title} · v{rule.version}</strong>
          <select aria-label={`${rule.title} · 本场用途`} disabled={disabled} value={settings ? 'required' : 'reference'}
            onChange={event => onRule(rule.id, event.target.value === 'required' ? emptyRule : undefined)}>
            <option value="reference">作者参考</option><option value="required">本场必须执行</option>
          </select>
        </div>
        {settings && <fieldset className="opening-detail opening-rule-fields" disabled={disabled}>
          <label>可检查的后果<select aria-label={`${rule.title} · 可检查的后果`} value={settings.mechanism}
            onChange={event => onRule(rule.id, { ...settings, mechanism: event.target.value as RuleDraft['mechanism'] })}>
            <option value="">尚未配置执行机制</option>
            <option value="entry_item">进入地点时必须持有物品</option>
          </select></label>
          {settings.mechanism === 'entry_item' && <div className="preparation-fields">
            <label>限制进入的地点<select value={settings.destination} onChange={event => onRule(rule.id, { ...settings, destination: event.target.value })}>
              <option value="">选择本场地点</option><EntityOptions entities={places} />
            </select></label>
            <label>所需物品<select value={settings.item} onChange={event => onRule(rule.id, { ...settings, item: event.target.value })}>
              <option value="">选择物品卡</option><EntityOptions entities={items} />
            </select></label>
            <label>物品初始归属<select value={settings.holder} onChange={event => onRule(rule.id, { ...settings, holder: event.target.value })}>
              <option value="">选择参与人物或本场地点</option><EntityOptions entities={holders} />
            </select></label>
          </div>}
        </fieldset>}
      </li>;
    })}
  </ul>;
}

function RoleInspection({ role, citation }: { role: OpeningRoleCheck; citation: (source: OpeningCitation) => ReactNode }) {
  const input = role.input;
  const hasEvidence = input && (Object.keys(input.knowledge).length > 0 || Object.keys(input.beliefs).length > 0);
  const recordSource = (key: string) => input?.citations[key] ? <small>{citation(input.citations[key])}</small> : null;
  return <details className="opening-role">
    <summary>{role.name} · {role.candidate ? '候选获邀后的输入' : '开局输入'}</summary>
    <div className="opening-detail">
      {role.options.length > 1 && <p>原设定中的位置：{role.options.map(location => location.name).join('、')}。
        {role.chosen ? `本线采用${role.location_name}。` : '请在人物设置中选定本线位置。'}</p>}
      {input && <>
        <p>{role.candidate ? '候选所在地点' : '所在地点'} · {role.location_name}
          {role.chosen && '（本线选定）'}</p>
        {role.candidate && <p className="opening-note">收到邀请时，所见和收到的消息会按当时状态计算。</p>}
        <p>目标 · {input.goal}</p>
        {input.voice_sample && <p>口吻样句 · {input.voice_sample}</p>}
        {hasEvidence ? <ul className="opening-input-list">
          {Object.entries(input.knowledge).map(([key, value]) => <li key={key}>
            <strong>{basisLabels[value.basis]}</strong> {value.text}{recordSource(key)}
          </li>)}
          {Object.entries(input.beliefs).map(([key, text]) => <li key={key}>
            <strong>{basisLabels.belief}</strong> {text}{recordSource(key)}
          </li>)}
        </ul> : <p>未配置额外的角色知情。</p>}
        {Object.keys(input.expression?.past ?? {}).length > 0 && <div>
          <p>可补充的本线往事</p>
          <ul>{Object.entries(input.expression?.past ?? {}).map(([id, text]) => <li key={id}>{text}</li>)}</ul>
        </div>}
        <p>在场 · {Object.values(input.profile.people_names).join('、') || '无'}</p>
        <p>可见出口 · {input.perception.exits.map(id => input.profile.place_names[id]).filter(Boolean).join('、') || '无'}</p>
        {Object.keys(input.profile.item_names).length > 0 && <p>可见物品 · {Object.values(input.profile.item_names).join('、')}</p>}
      </>}
    </div>
  </details>;
}

export function OpeningInspection({ check, citation, onIssue }: {
  check: OpeningCheck; citation: (source: OpeningCitation) => ReactNode;
  onIssue?: (issue: OpeningCheck['blockers'][number]) => void;
}) {
  return <div className="opening-inspection">
    {check.blockers.length > 0 && <ul className="opening-blockers" aria-label="需要处理的开局问题">
      {check.blockers.map(issue => <li key={`${issue.kind}:${issue.id}`}>
        {issue.message}
        {onIssue && <Button type="button" variant="ghost" onClick={() => onIssue(issue)}>
          {issue.kind === 'role' ? '定位人物设置' : '定位规则设置'}
        </Button>}
      </li>)}
    </ul>}
    {check.reference_people.length > 0 &&
      <p>仅作背景的人物 · {check.reference_people.map(person => person.name).join('、')}</p>}
    {check.roles.map(role => <RoleInspection key={role.id} role={role} citation={citation} />)}
    {check.rules.length > 0 && <ul className="opening-input-list" aria-label="规则检查结果">
      {check.rules.map(rule => <li key={rule.id}>
        <strong>{rule.title}</strong> · {{reference: '作者参考', supported: '可检查', blocked: '待处理'}[rule.status]}
        {rule.consequence && <small>{rule.consequence}</small>}
        {rule.holder_name && <small>初始归属 · {rule.holder_name}</small>}
      </li>)}
    </ul>}
    {check.observation_question && <p>作者观察问题 · {check.observation_question}</p>}
  </div>;
}
