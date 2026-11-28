import { useState } from 'react';
import { ChevronDown, ChevronRight, Link2 } from 'lucide-react';
import { Button } from '../../components/ui';
import { entityKinds } from '../creation/api';
import type { ScenarioScopeEntry } from './api';

export interface PreparationScopePreview {
  context: ScenarioScopeEntry[];
  direct_keys: string[];
  children: Record<string, string[]>;
  expandable_keys: string[];
}

interface ScopeNode {
  entry: ScenarioScopeEntry;
  path: string;
  reference: boolean;
  children: ScopeNode[];
}

const kinds: Record<string, string> = { ...entityKinds, node: '关联资料', map: '地图',
  event: '事件', assertion: '对象字段', relationship: '关系' };

function scopeTree(scope: PreparationScopePreview): ScopeNode[] {
  const entries = new Map(scope.context.map(entry => [entry.key, entry]));
  const placed = new Set(scope.direct_keys);
  function branch(key: string, ancestors: string[] = []): ScopeNode {
    const lineage = [...ancestors, key];
    const reference = ancestors.length > 0 && placed.has(key);
    placed.add(key);
    const children = reference ? [] : (scope.children[key] ?? []).filter(child => !lineage.includes(child))
      .map(child => branch(child, lineage));
    return { entry: entries.get(key)!, path: lineage.join('/'), reference, children };
  }
  return scope.direct_keys.map(key => branch(key));
}

export function PreparationScope({ scope, excluded, requested, loading, saving, onDiscover, onInclude }: {
  scope?: PreparationScopePreview;
  excluded: string[];
  requested: string[];
  loading: boolean;
  saving: boolean;
  onDiscover: (key: string) => void;
  onInclude: (key: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const excludedKeys = new Set(excluded);
  const requestedKeys = new Set(requested);
  const expandable = new Set(scope?.expandable_keys);

  function row({ entry, path, reference, children }: ScopeNode, depth: number) {
    const included = entry.included;
    const changing = loading && excludedKeys.has(entry.key) === included;
    const discoverable = !reference && expandable.has(entry.key);
    const canOpen = children.length > 0 || discoverable;
    const opened = open[path] ?? depth > 0;
    const pending = discoverable && requestedKeys.has(entry.key) && loading;
    const childId = `preparation-branch-${path}`;
    return <li key={path} className="preparation-scope-item" data-scope-key={reference ? undefined : entry.key}
      data-scope-depth={depth} data-reference-key={reference ? entry.key : undefined}>
      <div className="preparation-scope-row" data-included={included}>
        {canOpen ? <Button type="button" variant="ghost" className="scope-disclosure"
          aria-expanded={opened} aria-controls={opened ? childId : undefined}
          disabled={saving && !opened && discoverable}
          title={opened ? '折叠关联' : '展开关联'}
          aria-label={`${opened ? '折叠' : '展开'}关联：${entry.title}`}
          onClick={() => {
            setOpen(rows => ({ ...rows, [path]: !opened }));
            if (!opened && discoverable) onDiscover(entry.key);
          }}>
          {opened ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </Button> : <span className="scope-disclosure-space" />}
        <div className="preparation-scope-description">
          <div className="preparation-scope-name">
            {reference && <Link2 size={13} aria-label="同一背景条目" />}
            <strong>{entry.title}</strong><span className="preparation-item-version">v{entry.version}</span>
          </div>
          {!reference && <small title={depth > 0 ? entry.reasons.join(' · ') : undefined}>
            {kinds[entry.kind] || entry.kind}{depth === 0 && ` · ${entry.reasons.join(' · ')}`}
          </small>}
        </div>
        {reference ? (included ? null : <small>已移除</small>) :
          <Button type="button" variant="ghost" aria-label={`${included ? '移除' : '恢复'}背景：${entry.title}`}
            aria-disabled={changing} disabled={saving} onClick={() => { if (!changing) onInclude(entry.key); }}>
            {included ? '移除' : '恢复'}
          </Button>}
      </div>
      {canOpen && opened && <ul id={childId} className="preparation-scope-list preparation-scope-children" aria-label={`${entry.title}下的关联`}>
        {children.map(child => row(child, depth + 1))}
        {pending && <li className="preparation-scope-note" role="status">正在读取关联…</li>}
      </ul>}
    </li>;
  }

  const nodes = scope ? scopeTree(scope) : [];
  if (!nodes.length) return <p className="context-hint">{loading ? '正在读取关联…' : '所选章段暂无直接关联。'}</p>;
  return <ul aria-label="关联背景" className="preparation-scope-list" aria-busy={loading}>
    {nodes.map(root => row(root, 0))}
  </ul>;
}
