import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/ui';
import type { Inspiration, WritingLocation } from './api';
import { inspirationLinkStatus } from './InspirationObjects';

export function InspirationSourceLinks({ item }: { item: Inspiration }) {
  const source = item.source;
  if (!source?.route) return null;
  return <section className="inspiration-source" aria-label="模拟出处">
    <h3>模拟出处</h3>
    <p>{source.summary || '已保存的模拟事件'}</p>
    {source.events?.length ? <div className="inspiration-source-events">{source.events.map(event =>
      <Link key={`${event.worldline_id}:${event.seq}`} to={event.route || source.route!} state={{ runtimeReturn: 'inspiration' }}>
        第{event.seq}步 · {event.summary || event.action_type || '已提交记录'}<ArrowUpRight size={14}/>
      </Link>)}</div> : <Link to={source.route} state={{ runtimeReturn: 'inspiration' }}>回到第{source.seq}步的世界线<ArrowUpRight size={14}/></Link>}
    <small>世界线 {source.worldline_id} · {source.event_count || 1} 条来源事件</small>
    {!!source.materials?.length && <section aria-label="冻结资料">
      <h3>冻结资料</h3>
      {source.materials.map(material => <Link key={material.route} to={material.route} state={{ fromInspiration: true }}>
        <span>{material.work_title} · {material.title} · v{material.version}
          {material.purpose === 'author_reference' && ' · 作者参考'}</span><ArrowUpRight size={14}/>
      </Link>)}
    </section>}
  </section>;
}

export function InspirationLinkedContent({ world, item }: { world: string; item: Inspiration }) {
  return item.linked_nodes.length > 0 && <section className="inspiration-linked" aria-label="已关联内容">
    <h3>关联出处</h3>
    {item.linked_nodes.map(node => <Link key={node.id} to={`/worlds/${world}/create?${new URLSearchParams({work:node.work_id,node:node.id,mode:'read'})}`}>
      {node.work_title} · {node.title} · v{node.version}{inspirationLinkStatus[node.status]}<ArrowUpRight size={14}/>
    </Link>)}
  </section>;
}

export function WritingLocationLink({ world, location }: { world: string; location: WritingLocation }) {
  return <Link className="text-link" to={`/worlds/${world}/create?${new URLSearchParams({work:location.work_id,node:location.id,mode:'read'})}`}>
    {location.work_title} · {location.path}{inspirationLinkStatus[location.status]}
  </Link>;
}

export function InspirationWritingInfo({ world, item, onEdit }: {
  world: string; item: Inspiration; onEdit?: () => void;
}) {
  return <section className="inspiration-writing-info" aria-label="写作分配">
    {item.origin_node && <div><h3>发起位置</h3><WritingLocationLink world={world} location={item.origin_node}/></div>}
    <div className="inspiration-writing-places">
      <h3>分配位置</h3>
      {item.assigned_nodes.length ? <ul>{item.assigned_nodes.map(place =>
        <li key={place.id}><WritingLocationLink world={world} location={place}/></li>)}</ul>
        : <p>未分配</p>}
      {onEdit && <Button variant="ghost" onClick={onEdit}>编辑分配</Button>}
    </div>
  </section>;
}
