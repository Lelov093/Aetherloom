import { useEffect, useState } from 'react';
import { Button } from '../../components/ui';
import { creationApi, isWritingNode, type ContentNode, type Work } from '../creation/api';

export interface SelectedMaterial {
  node_id: string; version: number; start: number; end: number;
}

export interface MaterialDraft extends SelectedMaterial {
  title: string; quote: string;
}

export const materialKey = (item: SelectedMaterial) => `${item.node_id}:${item.version}:${item.start}:${item.end}`;

export function materialDraft(node: ContentNode, range?: Pick<SelectedMaterial, 'start' | 'end'>): MaterialDraft | undefined {
  const text = Array.from(node.plain_text ?? '');
  const start = range?.start ?? 0, end = range?.end ?? text.length;
  if (start < 0 || end > text.length || end <= start) return;
  const excerpt = text.slice(start, end);
  if (!excerpt.join('').trim()) return;
  return { node_id: node.id, version: node.version, start, end, title: node.title,
    quote: excerpt.slice(0, 160).join('') };
}

function activeTree(nodes: ContentNode[]) {
  const children = new Map<string | null, ContentNode[]>();
  for (const node of nodes) {
    if (node.status !== 'active') continue;
    const siblings = children.get(node.parent_id) ?? [];
    siblings.push(node);
    children.set(node.parent_id, siblings);
  }
  const ordered: { node: ContentNode; path: string; chapter?: string }[] = [];
  function add(parent: string | null, path: string, chapter?: string) {
    for (const node of children.get(parent) ?? []) {
      const title = path ? `${path} / ${node.title}` : node.title;
      const ancestor = node.kind === 'chapter' ? node.id : chapter;
      ordered.push({ node, path: title, chapter: ancestor });
      add(node.id, title, ancestor);
    }
  }
  add(null, '');
  return ordered;
}

export function BackgroundPicker({ works, origin, disabled, onAdd, onError }: {
  works: Work[]; origin?: ContentNode; disabled: boolean;
  onAdd: (rows: MaterialDraft[]) => void; onError: (message: string) => void;
}) {
  const [work, setWork] = useState(''), [node, setNode] = useState(''), [endChapter, setEndChapter] = useState('');
  const [mode, setMode] = useState('section'), [list, setList] = useState<ContentNode[]>([]);
  const [document, setDocument] = useState<ContentNode>(), [range, setRange] = useState({ start: 0, end: 0 });
  const [busy, setBusy] = useState(false);
  const workId = work || origin?.work_id || works[0]?.id;

  useEffect(() => {
    if (!workId) return;
    let active = true;
    setList([]);
    creationApi.nodes(workId).then(rows => { if (active) setList(rows); })
      .catch(error => { if (active) onError(error.message); });
    return () => { active = false; };
  }, [workId, onError]);
  const tree = activeTree(list);
  const chapters = tree.filter(row => row.node.kind === 'chapter');
  const options = mode === 'chapters' ? chapters : tree;
  const selected = options.find(row => row.node.id === node) ?? options.find(row => row.node.id === origin?.id) ?? options[0];
  const selectedId = selected?.node.id;
  const first = chapters.findIndex(row => row.node.id === selectedId);
  const chapterEnds = chapters.slice(Math.max(first, 0));
  const last = chapters.findIndex(row => row.node.id === endChapter);
  const windowEnd = last >= first ? last : first;
  const visibleDocument = mode === 'passage' && document?.id === selectedId ? document : undefined;

  useEffect(() => {
    setDocument(undefined);
    setRange({ start: 0, end: 0 });
    if (mode !== 'passage' || !selectedId) return;
    let active = true;
    creationApi.node(selectedId).then(value => { if (active) setDocument(value); })
      .catch(error => { if (active) onError(error.message); });
    return () => { active = false; };
  }, [mode, selectedId, onError]);

  async function add() {
    if (!selected) return;
    setBusy(true);
    onError('');
    try {
      if (mode === 'passage') {
        const value = visibleDocument && materialDraft(visibleDocument, range);
        if (value) onAdd([value]);
        else onError('请先在预览正文中选中一段文字。');
        return;
      }
      const scope = mode === 'chapters'
        ? new Set(chapters.slice(first, windowEnd + 1).map(row => row.node.id))
        : new Set(selected.node.kind === 'chapter' ? [selected.node.id] : []);
      const ids = scope.size ? tree.filter(row => row.chapter && scope.has(row.chapter) && isWritingNode(row.node.kind))
        .map(row => row.node.id) : [selected.node.id];
      const rows = (await Promise.all(ids.map(id => creationApi.node(id)))).flatMap(value => {
        const material = materialDraft(value);
        return material ? [material] : [];
      });
      if (rows.length) onAdd(rows);
      else onError('这部分内容还没有可选的正文。');
    } catch (error) { onError((error as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="preparation-picker">
    <div className="preparation-fields">
      <label>作品<select value={workId ?? ''} onChange={event => {
        setWork(event.target.value); setNode(''); setEndChapter(''); setList([]);
      }}>{works.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}</select></label>
      <label>选材范围<select value={mode} onChange={event => { setMode(event.target.value); setEndChapter(''); }}>
        <option value="section">整章或整份资料</option><option value="chapters">连续章节</option><option value="passage">选定段落</option>
      </select></label>
      <label>{mode === 'chapters' ? '起始章节' : '章幕或资料'}
        <select value={selectedId ?? ''} onChange={event => { setNode(event.target.value); setEndChapter(''); }}>
          {options.map(row => <option key={row.node.id} value={row.node.id}>{row.path}</option>)}
        </select>
      </label>
      {mode === 'chapters' && <label>结束章节<select value={chapters[windowEnd]?.node.id ?? ''} onChange={event => setEndChapter(event.target.value)}>
        {chapterEnds.map(row => <option key={row.node.id} value={row.node.id}>{row.path}</option>)}
      </select></label>}
    </div>
    {mode === 'passage' && <label>在此选中原文{visibleDocument && `（v${visibleDocument.version}）`}
      <textarea aria-label="选段预览" readOnly rows={5} value={visibleDocument?.plain_text ?? ''}
        placeholder={selectedId ? '正在读取所选正文…' : '请选择章幕或资料'} aria-busy={Boolean(selectedId && !visibleDocument)} onSelect={event => {
        const { value, selectionStart, selectionEnd } = event.currentTarget;
        setRange({ start: Array.from(value.slice(0, selectionStart)).length,
          end: Array.from(value.slice(0, selectionEnd)).length });
      }} />
    </label>}
    <Button type="button" disabled={!selected || busy || disabled || (mode === 'passage' && (!visibleDocument || range.end <= range.start))}
      onClick={() => void add()}>加入选材</Button>
  </div>;
}
