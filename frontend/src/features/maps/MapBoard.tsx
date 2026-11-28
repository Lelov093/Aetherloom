import { useEffect, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, ViewportPortal, getViewportForBounds, useReactFlow, type Viewport } from '@xyflow/react';
import { MapPin, Maximize, Minus, Plus } from 'lucide-react';
import { Button } from '../../components/ui';
import { featureKinds, featureName, mapsApi, type MapDetail, type MapFeature, type Point } from './api';

const minZoom = .07;
const maxZoom = 3;
export type MapLocate = { id: string; key: string };

function readCamera(key: string): Viewport | undefined {
  try {
    const view = JSON.parse(localStorage.getItem(key) || 'null');
    if (view && [view.x, view.y, view.zoom].every(Number.isFinite) && view.zoom >= minZoom && view.zoom <= maxZoom) return view;
  } catch { /* Display the fitted map when local preferences cannot be read. */ }
}

function saveCamera(key: string, view: Viewport) {
  try { localStorage.setItem(key, JSON.stringify(view)); }
  catch { /* Preferences are optional. Map content is stored separately. */ }
}

function featureCenter(feature: MapFeature) {
  const sum = feature.points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / feature.points.length, y: sum.y / feature.points.length };
}

interface Props {
  world: string;
  map: MapDetail;
  selected?: string;
  drawing: boolean;
  vertices: Point[];
  locate?: MapLocate;
  onLocated: (id: string) => void;
  onPoint: (point: Point) => void;
  onSelect: (id?: string) => void;
}

function Board({ world, map, selected, drawing, vertices, locate, onLocated, onPoint, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const storageKey = `aetherloom:map-camera:${world}:${map.id}`;
  const viewport = useRef<Viewport | undefined>(undefined);
  const initial = useRef(false);
  const usedLocate = useRef<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [failedBackground, setFailedBackground] = useState<string>();
  const background = map.has_background ? mapsApi.background(world, map) : undefined;
  const unit = 1200 / Math.max(map.width, map.height);
  const width = map.width * unit;
  const height = map.height * unit;
  const failed = background && failedBackground === background;
  const polygon = (points: Point[]) => points.map(p => `${p.x * width},${p.y * height}`).join(' ');

  function record(value: Viewport) {
    viewport.current = value;
    setZoom(value.zoom);
  }
  function move(value: Viewport) {
    record(value);
    saveCamera(storageKey, value);
    void flow.setViewport(value);
  }
  function fitted() {
    const box = host.current?.getBoundingClientRect();
    return box ? getViewportForBounds({ x: 0, y: 0, width, height }, box.width, box.height, minZoom, 1.3, .12)
      : { x: 0, y: 0, zoom: 1 };
  }
  useEffect(() => {
    if (!ready) return;
    const location = locate && locate.key !== usedLocate.current ? locate : undefined;
    if (location) {
      usedLocate.current = location.key;
      const feature = map.features.find(item => item.id === location.id);
      const box = host.current?.getBoundingClientRect();
      if (feature && box) {
        const point = featureCenter(feature);
        const scale = Math.max(viewport.current?.zoom ?? readCamera(storageKey)?.zoom ?? fitted().zoom, .6);
        move({ x: box.width / 2 - point.x * width * scale, y: box.height / 2 - point.y * height * scale, zoom: scale });
      } else if (!initial.current) move(readCamera(storageKey) ?? fitted());
      onLocated(location.id);
    } else if (!initial.current) move(readCamera(storageKey) ?? fitted());
    initial.current = true;
  }, [ready, locate, map]);
  useEffect(() => () => {
    if (viewport.current) saveCamera(storageKey, viewport.current);
  }, [storageKey]);

  return <div className={`author-map-board ${drawing ? 'is-drawing' : ''}`}>
    <div ref={host} className="author-map-viewport" role="region" aria-label="地图画布"><ReactFlow onInit={() => setReady(true)}
      minZoom={minZoom} maxZoom={maxZoom} zoomOnDoubleClick={false} panOnDrag={!drawing}
      nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
      proOptions={{ hideAttribution: false }}
      onMove={(_, value) => record(value)}
      onMoveEnd={(_, value) => { record(value); if (initial.current) saveCamera(storageKey, value); }}
      onPaneClick={event => {
        if (!drawing) return onSelect();
        const p = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
        if (p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height) onPoint({ x: p.x / width, y: p.y / height });
      }}>
      <ViewportPortal>
        <div className="author-map-sheet" style={{ width, height }}>
          {background && !failed && <img className="author-map-image" src={background} alt={`${map.title}的底图`} draggable={false}
            onError={() => setFailedBackground(background)}/>}
          <svg className="author-map-geometry" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            {map.features.filter(feature => feature.kind === 'region').map(feature =>
              <polygon key={feature.id} points={polygon(feature.points)} data-region={feature.id}
                fill={feature.color} stroke={feature.color} vectorEffect="non-scaling-stroke"
                className={feature.id === selected ? 'is-selected' : undefined}
                onClick={event => { event.stopPropagation(); if (!drawing) onSelect(feature.id); }}/>)}
            {vertices.length > 0 && <polyline points={polygon(vertices)} fill="none" stroke="#156d83" strokeWidth={2.5} vectorEffect="non-scaling-stroke"/>}
            {vertices.map((point, i) => <circle key={i} cx={point.x * width} cy={point.y * height}
              r={4 / zoom} fill="#fff" stroke="#156d83" strokeWidth={2} vectorEffect="non-scaling-stroke"/>)}
          </svg>
          {map.features.map(feature => {
            const point = featureCenter(feature);
            return <button key={feature.id} type="button" aria-label={`${featureKinds[feature.kind]} ${featureName(feature)}`}
              title={featureName(feature)} disabled={drawing} aria-pressed={feature.id === selected}
              className={`author-map-mark kind-${feature.kind} nodrag nopan`} data-map-feature={feature.id}
              style={{ left: point.x * width, top: point.y * height, backgroundColor: feature.kind === 'region' ? feature.color : undefined,
                transform: `translate(-50%, -50%) scale(${1 / zoom})` }}
              onClick={event => { event.stopPropagation(); onSelect(feature.id); }}>
              {feature.kind === 'marker' && <MapPin size={16} fill={feature.color} color="white"/>}
              <span>{featureName(feature)}</span>
            </button>;
          })}
        </div>
      </ViewportPortal>
    </ReactFlow>
    {failed && <p className="author-map-image-warning" role="status">底图暂不可用。仍可从地图要素列表定位标记。</p>}</div>
    <div className="author-map-camera" aria-label="地图镜头">
      <Button aria-label="缩小地图" title="缩小地图" disabled={!ready || zoom <= minZoom} onClick={() => void flow.zoomOut()}><Minus size={16}/></Button>
      <span aria-label="地图缩放">{Math.round(zoom * 100)}%</span>
      <Button aria-label="放大地图" title="放大地图" disabled={!ready || zoom >= maxZoom} onClick={() => void flow.zoomIn()}><Plus size={16}/></Button>
      <Button aria-label="适配全图" title="适配全图" disabled={!ready} onClick={() => move(fitted())}><Maximize size={15}/></Button>
    </div>
  </div>;
}

export function MapBoard(props: Props) {
  return <ReactFlowProvider><Board {...props}/></ReactFlowProvider>;
}
