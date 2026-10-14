import type { XYPosition } from '@xyflow/react';
import type { ExploreEdge, ExploreGraph } from './api';

export interface EdgeGroup { id: string; source: string; target: string; family: ExploreEdge['family']; records: ExploreEdge[] }
export type Selection = { type: 'node' | 'edge' | 'record'; key: string };
export function groupEdges(graph: ExploreGraph): EdgeGroup[] {
  const groups = new Map<string, EdgeGroup>();
  for (const edge of graph.edges) {
    const key = `${edge.family}|${edge.source}|${edge.target}`;
    if (!groups.has(key)) groups.set(key, { id: key, source: edge.source, target: edge.target, family: edge.family, records: [] });
    groups.get(key)!.records.push(edge);
  }
  return [...groups.values()];
}

/** Stable ego layout: no continuously running physics, and no movement of
 * existing neighbours during expansion. Node dragging affects display only. */
export function arrange(graph: ExploreGraph, previous: Record<string, XYPosition> = {}): Record<string, XYPosition> {
  const positions: Record<string, XYPosition> = { ...previous, [graph.focus]: previous[graph.focus] || { x: 0, y: 0 } };
  const center = positions[graph.focus];
  const order = ['character', 'faction', 'location', 'event', 'item', 'species', 'concept', 'world_rule', 'custom'];
  const rings = new Map<number, typeof graph.nodes>();
  for (const node of graph.nodes.filter(n => n.key !== graph.focus)) {
    const depth = Math.min(node.depth, 3);
    if (!rings.has(depth)) rings.set(depth, []);
    rings.get(depth)!.push(node);
  }
  for (const [depth, values] of rings) {
    values.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
    const radius = Math.max(depth === 1 ? 235 : 450 + (depth - 2) * 220, values.length * 29);
    values.forEach((node, index) => {
      if (positions[node.key]) return;
      let angle = -Math.PI / 2 + index * Math.PI * 2 / values.length;
      let point = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
      // New branches use a free slot while preserved nodes remain anchored.
      for (let attempt = 0; attempt < 30 && Object.values(positions).some(p => Math.hypot(p.x - point.x, p.y - point.y) < 145); attempt++) {
        angle += .24;
        point = { x: center.x + Math.cos(angle) * (radius + attempt * 9), y: center.y + Math.sin(angle) * (radius + attempt * 9) };
      }
      positions[node.key] = point;
    });
  }
  return Object.fromEntries(graph.nodes.map(n => [n.key, positions[n.key]]));
}
