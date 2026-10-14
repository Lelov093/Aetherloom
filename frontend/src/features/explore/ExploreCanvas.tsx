import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, ReactFlowProvider, Handle, Position, BaseEdge, EdgeLabelRenderer, getBezierPath, Controls, ControlButton, MiniMap, Background,
  MarkerType, applyNodeChanges, useReactFlow, useNodesInitialized, getViewportForBounds, type Node, type NodeProps, type Edge, type EdgeProps, type NodeChange, type Viewport, type XYPosition } from '@xyflow/react';
import { Crosshair, Maximize2, Plus, ScrollText, Network } from 'lucide-react';
import { EntityMark } from '../../components/EntityMark';
import { Portrait } from '../objects/Portrait';
import { entityKinds } from '../creation/api';
import { type ExploreNode, type ExploreGraph } from './api';
import { arrange, groupEdges, type EdgeGroup, type Selection } from './graphModel';

type NodeData = { item: ExploreNode; focus: boolean; highlighted: boolean; expanded: boolean; portrait?: number; onExpand: (key: string) => void };
type GraphNode = Node<NodeData, 'world'>;
type EdgeData = { group: EdgeGroup; highlighted: boolean; labels: boolean; reveal: boolean; bend: number; onSelect: () => void };
type GraphEdge = Edge<EdgeData, 'relation'>;

const WorldNode = memo(function WorldNode({ data, selected }: NodeProps<GraphNode>) {
  const { item, focus, highlighted } = data;
  return <div className={`world-graph-node ${focus ? 'is-focus' : ''} ${selected ? 'is-selected' : ''} ${highlighted ? 'is-related' : ''} ${item.depth > 1 ? 'is-secondary' : ''}`}>
    {[Position.Top, Position.Right, Position.Bottom, Position.Left].map(position => <span key={position}>
      <Handle type="target" position={position} id={`target-${position}`} isConnectable={false}/>
      <Handle type="source" position={position} id={`source-${position}`} isConnectable={false}/>
    </span>)}
    <div className="world-node-emblem">{item.kind === 'character' && data.portrait ? <Portrait id={item.id} name={item.label} version={data.portrait}/> : item.type === 'event' ? <ScrollText size={27} strokeWidth={1.5}/> : <EntityMark kind={item.kind}/>}</div>
    <strong title={item.label}>{item.label}</strong><small>{item.type === 'event' ? '正式事件' : entityKinds[item.kind] || item.kind}</small>
    <button className="world-node-expand nodrag nopan" type="button" disabled={data.expanded} aria-label={`展开${item.label}的联系`} title={data.expanded ? '此节点已展开' : '继续展开联系'} onClick={e => { e.stopPropagation(); data.onExpand(item.key); }}><Plus size={13}/></button>
  </div>;
});

const RelationEdge = memo(function RelationEdge(props: EdgeProps<GraphEdge>) {
  const { data, selected } = props;
  let [path, x, y] = getBezierPath(props);
  if (data?.bend) {
    const dx = props.targetX - props.sourceX, dy = props.targetY - props.sourceY;
    const length = Math.max(1, Math.hypot(dx, dy));
    const cx = (props.sourceX + props.targetX) / 2 - dy / length * data.bend;
    const cy = (props.sourceY + props.targetY) / 2 + dx / length * data.bend;
    path = `M ${props.sourceX},${props.sourceY} Q ${cx},${cy} ${props.targetX},${props.targetY}`;
    x = (props.sourceX + props.targetX) / 4 + cx / 2;
    y = (props.sourceY + props.targetY) / 4 + cy / 2;
  }
  const group = data!.group, records = group.records;
  const label = records.length > 1 ? `${records[0].label} · ${records.length} 条记录` : records[0].label;
  return <>
    <BaseEdge path={path} markerEnd={props.markerEnd} interactionWidth={24} className={`world-graph-edge family-${group.family} ${selected || data?.highlighted ? 'is-emphasized' : ''}`}
      style={{ strokeWidth: selected ? 2.5 : records.length === 1 && records[0].strength !== null ? 1.1 + records[0].strength * 1.4 : 1.5 }}/>
    {(data?.labels || selected || data?.highlighted && data.reveal) && <EdgeLabelRenderer><button type="button" onClick={e => { e.stopPropagation(); data!.onSelect(); }} style={{ transform: `translate(-50%, -50%) translate(${x}px,${y}px)` }} className={`world-edge-label nodrag nopan ${selected ? 'is-selected' : ''}`} title={`${label}；${records.length} 条正式记录`} aria-label={`查看${label}`}>
      <span>{label.length > 20 ? label.slice(0, 18) + '…' : label}</span>{records.some(r => r.time_uncertain) && <small title="包含时间边界未定的记录，不能确认整年有效"> · 时间未定</small>}
    </button></EdgeLabelRenderer>}
  </>;
});
const nodeTypes = { world: WorldNode }, edgeTypes = { relation: RelationEdge };

interface Props {
  graph?: ExploreGraph; loading: boolean; labels: boolean; selection?: Selection; portraits: Record<string, number>;
  positions: Record<string, XYPosition>; viewport?: Viewport; restore: number;
  onSelect: (selection?: Selection) => void; onFocus: (key: string) => void; onExpand: (key: string) => void;
  onSnapshot: (positions: Record<string, XYPosition>, viewport: Viewport) => void;
}
function Canvas(props: Props) {
  const { graph, selection, loading, onSnapshot } = props;
  const [nodes, setNodes] = useState<GraphNode[]>([]), [hover, setHover] = useState('');
  const [zoom, setZoom] = useState(1);
  const flow = useReactFlow<GraphNode, GraphEdge>(), current = useRef(''), restoring = useRef(-1);
  const initialized = useNodesInitialized();
  const camera = useRef<{ viewport?: Viewport; duration: number } | undefined>(undefined);
  const snapshot = useRef(props.onSnapshot); snapshot.current = onSnapshot;
  const viewportRef = useRef<Viewport | undefined>(undefined);
  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const host = useRef<HTMLDivElement>(null);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const groups = useMemo(() => graph ? groupEdges(graph) : [], [graph]);
  const selectedGroup = selection?.type === 'edge' ? groups.find(g => g.id === selection.key) : undefined;
  const highlight = hover || (selection?.type === 'node' ? selection.key : '');
  const related = new Set(groups.filter(g => g.source === highlight || g.target === highlight).flatMap(g => [g.source, g.target]));
  function capture() { snapshot.current(Object.fromEntries(nodesRef.current.map(n => [n.id, n.position])), viewportRef.current || flow.getViewport()); }
  function fittedViewport() {
    const positions = nodesRef.current.map(n => n.position), box = host.current?.getBoundingClientRect();
    if (!positions.length || !box) return { x: 0, y: 0, zoom: 1 };
    const x = Math.min(...positions.map(p => p.x)), y = Math.min(...positions.map(p => p.y)) - 10;
    return getViewportForBounds({ x, y, width: Math.max(...positions.map(p => p.x)) - x + 128, height: Math.max(...positions.map(p => p.y)) - y + 140 }, box.width, box.height, .25, 1, .16);
  }
  function fit() {
    const value = fittedViewport(); viewportRef.current = value;
    return flow.setViewport(value, { duration: reduced ? 0 : 240 }).then(capture);
  }
  useLayoutEffect(() => {
    if (!graph) return;
    const changedFocus = current.current !== graph.focus, restored = restoring.current !== props.restore;
    const grown = graph.nodes.length > nodesRef.current.length;
    const previous = changedFocus || restored ? props.positions : Object.fromEntries(nodesRef.current.map(n => [n.id, n.position]));
    const positions = arrange(graph, previous);
    const next: GraphNode[] = graph.nodes.map(item => ({ id: item.key, type: 'world', position: positions[item.key],
      ariaLabel: `${item.label}，${item.type === 'event' ? '正式事件' : entityKinds[item.kind] || item.kind}，按 Enter 查看资料`,
      data: { item, focus: item.key === graph.focus, highlighted: false, expanded: graph.expanded.includes(item.key), portrait: props.portraits[item.id], onExpand: props.onExpand } }));
    nodesRef.current = next; setNodes(next);
    current.current = graph.focus; restoring.current = props.restore;
    if (changedFocus || restored || grown) camera.current = { viewport: restored ? props.viewport : undefined, duration: !restored && !reduced ? 240 : 0 };
    const frame = requestAnimationFrame(capture);
    return () => cancelAnimationFrame(frame);
  }, [graph, props.restore]);
  useLayoutEffect(() => {
    if (!initialized || !camera.current) return;
    const next = camera.current; camera.current = undefined;
    // Compute the camera directly. React Flow's queued fitView can complete
    // after a newly restored view and overwrite its saved viewport.
    const target = next.viewport || fittedViewport(); viewportRef.current = target;
    void flow.setViewport(target, { duration: next.duration }).then(capture);
  }, [initialized, graph, props.restore]);
  useEffect(() => {
    setNodes(values => values.map(node => ({ ...node, selected: selection?.type === 'node' && selection.key === node.id,
      data: { ...node.data, onExpand: props.onExpand, highlighted: related.has(node.id) || !!selectedGroup && [selectedGroup.source, selectedGroup.target].includes(node.id), portrait: props.portraits[node.data.item.id] } })));
  }, [selection, hover, props.portraits, props.onExpand]);
  const edges: GraphEdge[] = groups.map(group => {
    const parallel = groups.filter(g => [g.source, g.target].sort().join('|') === [group.source, group.target].sort().join('|'));
    const bend = parallel.length > 1 ? (parallel.findIndex(g => g.id === group.id) - (parallel.length - 1) / 2) * 90 * (group.source < group.target ? 1 : -1) : 0;
    const a = nodes.find(n => n.id === group.source)?.position || { x: 0, y: 0 }, b = nodes.find(n => n.id === group.target)?.position || { x: 0, y: 0 };
    const horizontal = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
    const source = horizontal ? b.x > a.x ? Position.Right : Position.Left : b.y > a.y ? Position.Bottom : Position.Top;
    const target = horizontal ? b.x > a.x ? Position.Left : Position.Right : b.y > a.y ? Position.Top : Position.Bottom;
    return { id: group.id, source: group.source, target: group.target, sourceHandle: `source-${source}`, targetHandle: `target-${target}`, type: 'relation',
      selected: selectedGroup?.id === group.id, markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: '#789cae' },
      ariaLabel: `${graph?.nodes.find(n => n.key === group.source)?.label} → ${graph?.nodes.find(n => n.key === group.target)?.label}，${group.records.map(e => e.label).join('、')}`,
      data: { group, bend, reveal: graph!.nodes.length <= 12 || highlight !== graph?.focus,
        onSelect: () => { if (!loading) props.onSelect({ type: 'edge', key: group.id }); }, highlighted: group.source === highlight || group.target === highlight,
        labels: props.labels && (zoom > .85 || graph!.nodes.length <= 12) } };
  });
  const changeNodes = useCallback((changes: NodeChange<GraphNode>[]) => {
    const selected = changes.find(c => c.type === 'select' && c.selected);
    if (selected?.type === 'select' && !props.loading) props.onSelect({ type: 'node', key: selected.id });
    setNodes(values => { const next = applyNodeChanges(changes, values); nodesRef.current = next; return next; });
  }, [props.loading, props.onSelect]);
  return <div ref={host} className={`explore-flow ${loading ? 'is-refreshing' : ''}`} aria-busy={loading}>
    <ReactFlow<GraphNode, GraphEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={changeNodes}
      onEdgesChange={changes => { const selected = changes.find(c => c.type === 'select' && c.selected); if (selected?.type === 'select' && !loading) props.onSelect({ type: 'edge', key: selected.id }); }}
      onNodeClick={(_, node) => { if (!loading) props.onSelect({ type: 'node', key: node.id }); }} onEdgeClick={(_, edge) => { if (!loading) props.onSelect({ type: 'edge', key: edge.id }); }}
      onNodeDoubleClick={(_, node) => { if (!loading) props.onFocus(node.id); }} onPaneClick={() => props.onSelect(undefined)}
      onNodeMouseEnter={(_, node) => setHover(node.id)} onNodeMouseLeave={() => setHover('')}
      onNodeDragStop={capture} onMoveEnd={(_, viewport) => { viewportRef.current = viewport; setZoom(viewport.zoom); capture(); }}
      onKeyDown={event => { if (event.key === 'Escape') props.onSelect(undefined); else if (event.key.startsWith('Arrow')) requestAnimationFrame(capture); }}
      onKeyDownCapture={event => {
        if (!['Enter', ' '].includes(event.key) || loading || (event.target as HTMLElement).closest('button')) return;
        const target = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node,.react-flow__edge');
        const key = target?.getAttribute('data-id');
        if (key) {
          // Prevent the same held key from activating the newly focused drawer
          // close button after keyboard selection opens its modal.
          event.preventDefault(); event.stopPropagation();
          props.onSelect({ type: target!.classList.contains('react-flow__node') ? 'node' : 'edge', key });
        }
      }}
      nodesDraggable={!loading} nodesConnectable={false} edgesReconnectable={false} elementsSelectable={!loading} deleteKeyCode={null}
      minZoom={.25} maxZoom={1.8} fitView={false} proOptions={{ hideAttribution: false }}
      ariaLabelConfig={{ 'controls.zoomIn.ariaLabel': '放大关系图', 'controls.zoomOut.ariaLabel': '缩小关系图', 'controls.fitView.ariaLabel': '适配全部可见对象', 'minimap.ariaLabel': '关系图概览' }}>
      <Background gap={32} size={.7} color="#c3d6df"/>
      <MiniMap pannable zoomable position="top-left" style={{ width: 120, height: 82 }} nodeBorderRadius={16} nodeColor={node => node.id === graph?.focus ? '#79d8e9' : '#cfdee9'} maskColor="rgba(249,252,253,.7)"/>
      <Controls showInteractive={false} showFitView={false} position="bottom-right">
        <ControlButton aria-label="适配全部可见对象" title="适配画布" onClick={() => { void fit(); }}><Maximize2 size={17}/></ControlButton>
        <ControlButton aria-label="回到焦点" title="回到焦点" onClick={() => { const node = nodes.find(n => n.id === graph?.focus); if (node) void flow.setCenter(node.position.x + 64, node.position.y + 55, { zoom: Math.max(.75, flow.getZoom()), duration: reduced ? 0 : 240 }).then(capture); }}><Crosshair size={17}/></ControlButton>
      </Controls>
    </ReactFlow>
    {!graph?.nodes.length && <div className="explore-canvas-empty"><Network size={38} strokeWidth={1.3}/><h2>{loading ? '正在读取世界联系…' : '从一个对象开始探索'}</h2><p>选择人物、地点、组织或正式事件，查看已记录的联系。</p></div>}
    {graph && graph.nodes.length > 0 && graph.edges.length === 0 && !loading && <div className="explore-no-links">此范围尚无联系 · 可调整筛选或在对象资料中补充正式记录</div>}
  </div>;
}
export function ExploreCanvas(props: Props) { return <ReactFlowProvider><Canvas {...props}/></ReactFlowProvider>; }
