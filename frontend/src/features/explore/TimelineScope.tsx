import { Globe2, Layers, ScrollText } from 'lucide-react';
import { Button } from '../../components/ui';
import { EntityMark } from '../../components/EntityMark';
import { timeLayers, timeLayerNames, type TimeLayer, type TimelinePage } from './api';

export function TimelineScope({ placed, unplaced, layers, onLayers, onFocus, busy }: {
  placed?: TimelinePage; unplaced?: TimelinePage; layers: TimeLayer[]; onLayers: (layers: TimeLayer[]) => void; onFocus: (key: string) => void; busy: boolean;
}) {
  const objects = new Map<string, { key: string; label: string; kind: string }>();
  for (const record of [...(placed?.items || []), ...(unplaced?.items || [])]) {
    for (const object of record.objects) objects.set(object.key, object);
    if (record.kind === 'event') objects.set(record.key, { key: record.key, label: record.label, kind: 'event' });
  }
  return <><section className="explore-left-section"><Button variant="ghost" onClick={() => onFocus('')} disabled={busy}><Globe2 size={14}/>查看世界时间轴</Button><p>对象范围仅包含明确的参与、地点、关系两端和事实引用。</p></section>
    <section className="explore-left-section"><h3><Layers size={14}/>时间图层</h3>{timeLayers.map(layer => <label className="explore-filter-row" key={layer}><input type="checkbox" checked={layers.includes(layer)} onChange={e => onLayers(e.target.checked ? [...layers, layer] : layers.filter(x => x !== layer))}/><span>{timeLayerNames[layer]}</span></label>)}{placed && <div className="timeline-counts"><span>明确期间 <strong>{placed.counts.dated}</strong></span><span>边界未定 <strong>{placed.counts.partial}</strong></span><span>时间未定位 <strong>{placed.counts.undated + placed.counts.invalid}</strong></span></div>}</section>
    <section className="explore-left-section explore-objects"><h3>此页相关对象 <small>{objects.size}</small></h3>{[...objects.values()].map(object => <button key={object.key} type="button" className="explore-object-row" disabled={busy} onClick={() => onFocus(object.key)}>{object.kind === 'event' ? <ScrollText size={17}/> : <EntityMark kind={object.kind} small/>}<span><strong title={object.label}>{object.label}</strong><small>聚焦此对象的时间记录</small></span></button>)}{!objects.size && <p>此范围暂无相关对象。</p>}</section></>;
}
