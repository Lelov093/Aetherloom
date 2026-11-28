import { useId, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { categoriesApi, categoryLabel, categoryTrail, type WorldCategory } from '../worlds/categories';
import { cardFieldLabel, cardFieldLabels } from './WorldObjectCard';
import type { ObjectSchema } from './api';

export function CategoryEditor({ world, categories, category, parentId, core, onClose, onSaved }: {
  world: string;
  categories: WorldCategory[];
  category?: WorldCategory;
  parentId?: string;
  core: ObjectSchema['core'];
  onClose: () => void;
  onSaved: (category: WorldCategory) => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [parent, setParent] = useState(category?.parent_id ?? parentId ?? '');
  const [fields, setFields] = useState(category?.card_fields ?? ['summary']);
  const [choice, setChoice] = useState('');
  const [section, setSection] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sectionHint = useId();
  const fieldLabels = cardFieldLabels(core);
  const field = choice === 'section' ? `section:${section.trim()}` : choice;
  const parents = categories.filter(item => !category || !categoryTrail(item, categories).some(entry => entry.id === category.id));

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const input = { name, parent_id: parent || null, card_fields: fields };
    try {
      const saved = category ? await categoriesApi.edit(world, category, input) : await categoriesApi.create(world, input);
      onSaved(saved);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={category ? '编辑分类' : '新建分类'} onClose={onClose} busy={busy} className="category-dialog">
    <form onSubmit={save}>
      <div className="category-dialog-content">
        <label className="field">
          <span>分类名称</span>
          <input required maxLength={80} disabled={busy} value={name} onChange={event => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>上级分类</span>
          <select value={parent} disabled={busy} onChange={event => setParent(event.target.value)}>
            <option value="">顶级分类</option>
            {parents.map(item => <option key={item.id} value={item.id}>{categoryLabel(item, categories)}</option>)}
          </select>
        </label>
        <fieldset className="category-fieldset">
          <legend>卡面字段</legend>
          {fields.length > 0 && <ul className="category-setting-list" aria-label="已选卡面字段">
            {fields.map(field => <li key={field}>
              <span>{cardFieldLabel(field, fieldLabels)}</span>
              <Button variant="ghost" type="button" aria-label={`移除字段 ${cardFieldLabel(field, fieldLabels)}`}
                disabled={busy} onClick={() => setFields(fields.filter(item => item !== field))}><X size={16} /></Button>
            </li>)}
          </ul>}
          <div className="category-field-choice">
            <label className="field">
              <span>可用字段</span>
              <select value={choice} disabled={busy || fields.length >= 24} onChange={event => setChoice(event.target.value)}>
                <option value="">选择字段</option>
                {Object.entries(fieldLabels).map(([id, label]) =>
                  <option key={id} value={id} disabled={fields.includes(id)}>{label}</option>)}
                <option value="section">自定义说明小节</option>
              </select>
            </label>
            <Button type="button" disabled={busy || !choice || field === 'section:' || fields.includes(field) || fields.length >= 24}
              onClick={() => { setFields([...fields, field]); setChoice(''); setSection(''); }}>添加字段</Button>
          </div>
          {choice === 'section' && <>
            <label className="field">
              <span>说明小节标题</span>
              <input aria-describedby={sectionHint} maxLength={160} disabled={busy} value={section}
                onChange={event => setSection(event.target.value)} />
            </label>
            <p id={sectionHint} className="context-hint">卡面读取对象详情中同名小节的内容。</p>
          </>}
        </fieldset>
        {error && <ErrorNotice>{error}</ErrorNotice>}
      </div>
      <div className="dialog-actions">
        <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>取消</Button>
        <Button variant="primary" disabled={busy || !name.trim()}>{busy ? '正在保存…' : '保存分类'}</Button>
      </div>
    </form>
  </Dialog>;
}
