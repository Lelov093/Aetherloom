import { useEffect, useState } from 'react';

export const materialCategories: Record<string, string> = {
  unclassified: '未分类', prose: '正文', lore: '设定资料', outline: '大纲',
  theme: '主题', foreshadowing: '伏笔', note: '笔记 / 其他',
};
export function materialTags(metadata: Record<string, string>): string[] {
  try { const value:unknown = JSON.parse(metadata.material_tags || '[]');
    return Array.isArray(value) ? value.filter((tag):tag is string=>typeof tag==='string') : []; }
  catch { return []; }
}
export function MaterialClassification({ category, tags, onChange }: {
  category: string; tags: string[]; onChange: (category: string, tags: string[]) => void;
}) {
  const [rawTags, setRawTags] = useState(tags.join('，'));
  const serialized = JSON.stringify(tags);
  useEffect(() => {
    // Keep an in-progress delimiter while the parent stores normalized tags.
    if (JSON.stringify(rawTags.split(/[，,]/).map(s => s.trim()).filter(Boolean)) !== serialized)
      setRawTags(tags.join('，'));
  }, [serialized]);
  return <div className="material-classification">
    <label className="field"><span>资料分类</span><select aria-label="资料分类" value={category}
      onChange={e => onChange(e.target.value, tags)}>{Object.entries(materialCategories).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label className="field"><span>资料标签（逗号分隔）</span><input aria-label="资料标签" value={rawTags}
      onChange={e => {setRawTags(e.target.value); onChange(category, e.target.value.split(/[，,]/).map(s => s.trim()).filter(Boolean));}} /></label>
    <p className="context-hint">分类用于整理资料，不会将大纲、计划或正文自动确认为世界事实。</p>
  </div>;
}
