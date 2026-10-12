import { Link } from 'react-router-dom';
import type { ContentNode } from './api';
import { materialCategories, materialTags } from './MaterialClassification';

export function WorkContents({world,nodes,parent=null,loading=false}:{world:string;nodes:ContentNode[];parent?:string|null;loading?:boolean}) {
  const children=nodes.filter(n=>n.parent_id===parent&&n.status==='active');
  return <section className="work-contents" aria-label={parent?'当前目录内容':'作品内容列表'}>
    <h2>{parent?'目录中的内容':'作品中的内容'}</h2>
    {loading?<p role="status">正在读取目录…</p>:children.length?children.map(n=><Link className="material-library-row" key={n.id}
      to={`/worlds/${world}/create?${new URLSearchParams({work:n.work_id,node:n.id,mode:'read'})}`}>
      <div><strong>{n.title}</strong><small>{materialCategories[n.metadata.material_category||'unclassified']}
        {materialTags(n.metadata).length>0&&` · ${materialTags(n.metadata).join(' · ')}`}</small></div><span>{nodes.some(c=>c.parent_id===n.id&&c.status==='active')?'打开目录 →':'阅读 →'}</span>
    </Link>):<p className="context-hint">当前目录尚无活跃内容，可从作品目录添加或恢复资料。</p>}
  </section>;
}
