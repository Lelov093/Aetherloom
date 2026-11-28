import type { XYPosition } from '@xyflow/react';
import type { ExploreEdge, ExploreGraph } from './api';

export interface EdgeGroup { id: string; source: string; target: string; family: ExploreEdge['family']; records: ExploreEdge[] }
export type CanvasSelection = { type: 'node' | 'edge'; key: string };
export type Selection = CanvasSelection | { type: 'record'; key: string };
export function groupEdges(graph: ExploreGraph): EdgeGroup[] {
  const groups = new Map<string, EdgeGroup>();
  for (const edge of graph.edges) {
    const key = `${edge.family}|${edge.source}|${edge.target}`;
    if (!groups.has(key)) groups.set(key, { id: key, source: edge.source, target: edge.target, family: edge.family, records: [] });
    groups.get(key)!.records.push(edge);
  }
  return [...groups.values()];
}

/** Pack disconnected groups independently so the world view has no synthetic focus. */
export function arrangeOverview(graph: ExploreGraph): Record<string, XYPosition> {
  const neighbors = new Map(graph.nodes.map(node => [node.key, new Set<string>()]));
  for (const { source, target } of graph.edges) {
    neighbors.get(source)?.add(target);
    neighbors.get(target)?.add(source);
  }
  const positions: Record<string, XYPosition> = {};
  const seen = new Set<string>();
  const nodes = [...graph.nodes].sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  const rowWidth = Math.max(810, Math.ceil(Math.sqrt(nodes.length)) * 235);
  let x = 0, y = 0, rowHeight = 0;
  for (const { key } of nodes) {
    if (seen.has(key)) continue;
    const group = [key];
    seen.add(key);
    for (const member of group) {
      for (const other of neighbors.get(member)!) {
        if (!seen.has(other)) {
          seen.add(other);
          group.push(other);
        }
      }
    }
    const columns = Math.ceil(Math.sqrt(group.length));
    const width = (columns - 1) * 180 + 128;
    const height = (Math.ceil(group.length / columns) - 1) * 190 + 112;
    if (x && x + width > rowWidth) {
      x = 0;
      y += rowHeight + 80;
      rowHeight = 0;
    }
    group.forEach((member, index) => {
      positions[member] = { x: x + (index % columns) * 180, y: y + Math.floor(index / columns) * 190 };
    });
    x += width + 92;
    rowHeight = Math.max(rowHeight, height);
  }
  return positions;
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
