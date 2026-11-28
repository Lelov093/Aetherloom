import { Link } from 'react-router-dom';
import type { ReopenDifference } from './api';

export function ReopenDifferences({ difference, world, line }: {
  difference: ReopenDifference; world: string; line?: string;
}) {
  const base = `/worlds/${world}`;
  return <section aria-label="重开的版本差异" className="reopen-differences">
    <h3>重开的版本差异</h3>
    <p>原线 · {difference.title} {line && <Link className="text-link"
      to={`${base}/simulate?line=${encodeURIComponent(difference.worldline_id)}`}>查看原世界线</Link>}</p>
    {difference.materials.length === 0 && difference.scope.length === 0 && <p>所选出处与关联范围相同。</p>}
    {difference.materials.map(material => <details key={material.id} className="opening-role">
      <summary>{material.title} · {material.before.map(row => `v${row.version}`).join('、') || '未选'} → {material.after.map(row => `v${row.version}`).join('、') || '未选'}</summary>
      <div className="reopen-version-columns">
        {(['before', 'after'] as const).map(side => <div key={side}>
          <strong>{side === 'before' ? '旧线选段' : '新线选段'}</strong>
          {material[side].map(row => <div key={row.index}>
            <small>v{row.version} · 选区 {row.start}–{row.end}</small>
            <p>{row.quote}</p>
            {line && <Link className="text-link" to={`${base}/create/source?${new URLSearchParams({
              worldline: side === 'before' ? difference.worldline_id : line, index: String(row.index),
            })}`}>{side === 'before' ? '查看旧线冻结原文' : '查看新线冻结原文'}</Link>}
          </div>)}
          {!material[side].length && <p>本侧未选此资料。</p>}
        </div>)}
      </div>
    </details>)}
    {difference.scope.length > 0 && <details className="opening-role">
      <summary>关联与绑定变化 · {difference.scope.length} 项</summary>
      <ul>{difference.scope.map(entry => <li key={entry.id}>{entry.title} · {
        entry.before && entry.after && entry.before.version === entry.after.version
          ? `v${entry.after.version} 的关联内容有变动`
          : `${entry.before ? `v${entry.before.version}` : '未纳入'} → ${entry.after ? `v${entry.after.version}` : '未纳入'}`
      }</li>)}</ul>
    </details>}
    {difference.omitted_observations.length > 0 && <p>需重新设定的观察条件 · {difference.omitted_observations.join('、')}。</p>}
  </section>;
}
