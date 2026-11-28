import { useEffect, useMemo, useState } from 'react';
import { Download, File, Folder } from 'lucide-react';
import { Button, Dialog, ErrorNotice } from '../../components/ui';
import { request } from '../creation/api';
import '../../styles/workspace-export.css';

type Packaging = 'folder' | 'zip' | 'rar';
interface Selection {
  work_id: string | null;
  reader: boolean;
  selected: string[] | null;
  formats: Record<string, string>;
}
interface ExportItem {
  key: string;
  title: string;
  directory: string[];
  path: string;
  formats: string[];
  format: string;
  selected: boolean;
  alias: boolean;
  missing: boolean;
}
interface Preview {
  title: string;
  items: ExportItem[];
  generated: string[];
  stamp: string;
  rar: boolean;
}
type ExportResult = { path: string; files: number };
interface ExportFolder { title: string; branches: Map<string, ExportFolder>; files: ExportItem[]; descendants: ExportItem[] }
const formatNames: Record<string, string> = {
  md: 'Markdown (.md)', docx: 'Word (.docx)', pdf: 'PDF (.pdf)', html: 'HTML (.html)',
  png: 'PNG (.png)', jpg: 'JPEG (.jpg)', webp: 'WebP (.webp)', json: 'JSON (.json)', original: '保留原格式',
};

declare global {
  interface Window {
    aetherloomExport?: {
      run(world: string, selection: Selection, packaging: Packaging, stamp: string): Promise<ExportResult | { error: string } | null>;
      reveal(): Promise<void>;
    }
  }
}

function tree(items: ExportItem[]) {
  const root: ExportFolder = { title: '', branches: new Map(), files: [], descendants: items };
  for (const item of items) {
    let parent = root;
    for (const component of item.directory) {
      let branch = parent.branches.get(component);
      if (!branch) {
        branch = { title: component, branches: new Map(), files: [], descendants: [] };
        parent.branches.set(component, branch);
      }
      branch.descendants.push(item);
      parent = branch;
    }
    parent.files.push(item);
  }
  return root;
}

interface TreeProps {
  folder: ExportFolder;
  depth: number;
  selected: Set<string>;
  overrides: Record<string, string>;
  busy: boolean;
  onToggle(items: ExportItem[], enabled: boolean): void;
  onFormat(items: ExportItem[], format: string): void;
}

function ExportBranch({ folder, depth, selected, overrides, busy, onToggle, onFormat }: TreeProps) {
  const [bulkFormat, setBulkFormat] = useState('');
  const chosen = folder.descendants.filter(item => selected.has(item.key));
  const checked = chosen.length === folder.descendants.length;
  const configurable = chosen.filter(item => !item.alias && item.formats.length > 1);
  const formats = [...new Set(configurable.flatMap(item => item.formats))];
  const compatible = configurable.filter(item => item.formats.includes(bulkFormat));
  const appliedFormat = compatible.length > 0 && compatible.every(item => (overrides[item.key] ?? item.format) === bulkFormat)
    ? bulkFormat : '';
  return <details className="export-branch" open={depth < 3}>
    <summary>
      <input type="checkbox" checked={checked} disabled={busy} aria-label={'选择目录 ' + folder.title}
        ref={input => { if (input) input.indeterminate = chosen.length > 0 && !checked; }}
        onClick={event => event.stopPropagation()} onChange={event => onToggle(folder.descendants, event.target.checked)}/>
      <Folder size={16}/><strong>{folder.title}</strong>
      <small>{chosen.length}/{folder.descendants.length}</small>
    </summary>
    <div className="export-branch-content">
      {formats.length > 0 && <label className="export-bulk">
        <span>批量设置</span>
        <select aria-label={'批量格式 ' + folder.title} value={appliedFormat} disabled={busy}
          onChange={event => {
            setBulkFormat(event.target.value);
            onFormat(configurable, event.target.value);
          }}>
          <option value="" disabled>{compatible.length ? '混合格式' : '选中且兼容的文件'}</option>
          {formats.map(format => <option key={format} value={format}>{formatNames[format]}</option>)}
        </select>
      </label>}
      {Array.from(folder.branches.values()).map(branch =>
        <ExportBranch key={branch.title} folder={branch} depth={depth + 1} selected={selected}
          overrides={overrides} busy={busy} onToggle={onToggle} onFormat={onFormat}/>)}
      {folder.files.map(item => <div className="export-file" key={item.key}>
        <label><input type="checkbox" checked={selected.has(item.key)} disabled={busy}
          aria-label={'选择文件 ' + item.title} onChange={event => onToggle([item], event.target.checked)}/>
          <File size={15}/><span>{item.path.split('/').at(-1)}</span></label>
        {item.missing ? <small>缺少原件</small>
          : item.alias ? <small>同卡链接</small>
          : item.formats.length < 2 ? <small>{formatNames[item.format]}</small>
          : <select aria-label={item.title + ' 格式'} value={item.format} disabled={busy || !selected.has(item.key)}
            onChange={event => onFormat([item], event.target.value)}>
            {item.formats.map(format => <option key={format} value={format}>{formatNames[format]}</option>)}
          </select>}
      </div>)}
    </div>
  </details>;
}

export function WorkspaceExport({ world, work, onClose }: {
  world: string; work?: { id: string; title: string }; onClose: () => void;
}) {
  const [reader, setReader] = useState(false);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [formats, setFormats] = useState<Record<string, string>>({});
  const [packaging, setPackaging] = useState<Packaging>('folder');
  const [preview, setPreview] = useState<Preview>();
  const [loaded, setLoaded] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult>();
  const selection: Selection = { work_id: work?.id ?? null, reader, selected, formats };
  const body = JSON.stringify(selection);
  const ready = !!preview && loaded === body;
  useEffect(() => {
    let active = true;
    setError('');
    const timer = window.setTimeout(() => {
      request<Preview>('/worlds/' + world + '/exports/preview', { method: 'POST', body }).then(value => {
        if (!active) return;
        setPreview(value);
        setLoaded(body);
        if (!value.rar) setPackaging(current => current === 'rar' ? 'folder' : current);
      }).catch(error => { if (active) setError(error.message); });
    }, 120);
    return () => { active = false; window.clearTimeout(timer); };
  }, [world, body, refresh]);
  const directories = useMemo(() => tree(preview?.items ?? []), [preview]);
  const checked = new Set(selected ?? preview?.items.filter(item => item.selected).map(item => item.key) ?? []);
  const missing = preview?.items.filter(item => item.missing && checked.has(item.key)) ?? [];

  function toggle(items: ExportItem[], enabled: boolean) {
    const next = new Set(checked);
    for (const item of items) {
      if (enabled) next.add(item.key);
      else next.delete(item.key);
    }
    setSelected([...next]);
    setResult(undefined);
  }

  function setFormat(items: ExportItem[], format: string) {
    setFormats(current => {
      const next = { ...current };
      for (const item of items) {
        if (item.formats.includes(format)) next[item.key] = format;
      }
      return next;
    });
    setResult(undefined);
  }

  function chooseReader(enabled: boolean) {
    if (reader === enabled) return;
    setReader(enabled);
    setSelected(null);
    setFormats({});
    setPreview(undefined);
    setResult(undefined);
  }

  async function exportNow() {
    if (!preview || !ready || busy || missing.length || !checked.size || !window.aetherloomExport) return;
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      const result = await window.aetherloomExport.run(world, selection, packaging, preview.stamp);
      if (result && 'error' in result) setError(result.error);
      else if (result) setResult(result);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={work ? '导出作品' : '导出世界'} onClose={onClose} busy={busy}
    className="workspace-export-dialog" focusFirstInput={false}>
    <div className="workspace-export-controls">
      {work && <div role="group" aria-label="导出预设" className="workspace-export-presets">
        <Button aria-pressed={!reader} disabled={busy} onClick={() => chooseReader(false)}>整部作品</Button>
        <Button aria-pressed={reader} disabled={busy} onClick={() => chooseReader(true)}>读者稿</Button>
      </div>}
      <label className="export-packaging"><span>交付方式</span>
        <select aria-label="交付方式" value={packaging} disabled={busy}
          onChange={event => { setPackaging(event.target.value as Packaging); setResult(undefined); }}>
          <option value="folder">普通文件夹</option>
          <option value="zip">ZIP 压缩包</option>
          <option value="rar" disabled={!preview?.rar}>{preview?.rar ? 'RAR 压缩包' : 'RAR · 需要本机压缩工具'}</option>
        </select>
      </label>
    </div>
    {error && <div className="export-feedback"><ErrorNotice>{error}</ErrorNotice>
      <Button variant="ghost" disabled={busy} onClick={() => {
        setPreview(undefined); setSelected(null); setFormats({}); setRefresh(value => value + 1);
      }}>重新读取预览</Button></div>}
    {!preview && !error && <p role="status">正在读取导出目录…</p>}
    {preview && <div className="workspace-export-preview" aria-label="导出目录预览" aria-busy={!ready}>
      <div className="export-preview-heading"><strong>{preview.title}</strong>
        <span>{checked.size} 项已选{ready && preview.generated.length > 0 && (' · 另含 ' + preview.generated.length + ' 份阅读目录')}</span>
      </div>
      {preview.items.length === 0 && <p className="context-hint">这里还没有可导出的内容。</p>}
      {Array.from(directories.branches.values()).map(folder =>
        <ExportBranch key={folder.title} folder={folder} depth={0} selected={checked}
          overrides={formats} busy={busy} onToggle={toggle} onFormat={setFormat}/>)}
    </div>}
    {missing.length > 0 && <ErrorNotice>缺少原件「{missing[0].title}」{missing.length > 1 && ('等 ' + missing.length + ' 项')}。请恢复原件或取消勾选。</ErrorNotice>}
    {result && <div className="export-result" role="status"><strong>已导出 {result.files} 个文件</strong>
      <span>{result.path}</span><Button variant="ghost" onClick={() => void window.aetherloomExport?.reveal()}>打开导出位置</Button>
    </div>}
    <div className="dialog-actions">
      <Button variant="ghost" disabled={busy} onClick={onClose}>关闭</Button>
      <Button variant="primary" disabled={busy || !ready || !checked.size || !!missing.length || !window.aetherloomExport}
        onClick={() => void exportNow()}><Download size={16}/>{busy ? '正在导出…' : '选择位置并导出'}</Button>
    </div>
  </Dialog>;
}
