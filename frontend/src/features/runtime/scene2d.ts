import type { Projection, ViewerLayout } from "./api";

export interface Point { x: number; y: number }
export interface Place2D extends Point { id: string; width: number; height: number; known: boolean }
export interface Sprite2D extends Point { id: string; kind: "actor" | "item"; place: string; holder?: string }
export interface Scene2D {
  places: Place2D[];
  sprites: Sprite2D[];
  edges: { from: string; to: string }[];
}

/** Only the authorized DTO enters this adapter. Coordinates carry no world meaning. */
export function scene2d(p: Projection, layout?: ViewerLayout | null): Scene2D {
  const topology = p.world.place_topology;
  const ids = [...new Set([...Object.keys(topology), ...Object.values(topology).flat()])].sort();
  const saved = new Map(layout?.places.map(place => [place.id, place]) || []);
  const columns = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
  const population = new Map(ids.map(id => [id, Object.entries(p.agents).filter(([, a]) => a.location === id).sort(([a],[b]) => a.localeCompare(b))]));
  const rowHeight = Math.max(280, ...ids.map(id => 180 + Math.ceil((population.get(id)?.length || 0) / 5) * 54));
  const places: Place2D[] = ids.map((id, i) => ({ id, x: saved.get(id)?.x ?? (i % columns) * 370,
    y: saved.get(id)?.y ?? Math.floor(i / columns) * rowHeight,
    width: 306, height: 135 + Math.max(1, Math.ceil((population.get(id)?.length || 0) / 5)) * 54,
    known: Object.hasOwn(topology, id) }));
  const sprites: Sprite2D[] = [];
  const actorPoints = new Map<string, Sprite2D>();
  for (const place of places) {
    for (const [i, [id]] of (population.get(place.id) || []).entries()) {
      const sprite: Sprite2D = { id, kind: "actor", place: place.id,
        x: place.x - place.width / 2 + 42 + (i % 5) * 55,
        y: place.y - place.height / 2 + 85 + Math.floor(i / 5) * 54 };
      actorPoints.set(id, sprite); sprites.push(sprite);
    }
    const loose = Object.entries(p.world.items).filter(([, holder]) => holder === place.id).sort();
    for (const [i, [id]] of loose.entries()) sprites.push({ id, kind: "item", place: place.id, holder: place.id,
      x: place.x - place.width / 2 + 30 + (i % 12) * 22, y: place.y + place.height / 2 - 28 - Math.floor(i / 12) * 20 });
  }
  const carried = new Map<string, number>();
  for (const [id, holder] of Object.entries(p.world.items).sort()) {
    const actor = actorPoints.get(holder);
    if (!actor) continue; // no attempt to infer a hidden holder's location
    const slot = carried.get(holder) || 0; carried.set(holder, slot + 1);
    sprites.push({ id, kind: "item", place: actor.place, holder, x: actor.x + 13 + slot * 10, y: actor.y + 5 });
  }
  return { places, sprites, edges: Object.entries(topology).flatMap(([from, targets]) => targets.map(to => ({ from, to }))) };
}

export function fitCamera(scene: Scene2D, width: number, height: number): ViewerLayout["camera"] {
  if (!scene.places.length) return { x: width / 2, y: height / 2, zoom: 1 };
  const left = Math.min(...scene.places.map(p => p.x - p.width / 2)) - 35;
  const right = Math.max(...scene.places.map(p => p.x + p.width / 2)) + 35;
  const top = Math.min(...scene.places.map(p => p.y - p.height / 2)) - 35;
  const bottom = Math.max(...scene.places.map(p => p.y + p.height / 2)) + 35;
  const zoom = Math.min(1.3, Math.max(.15, Math.min(width / (right-left), height / (bottom-top))));
  return { x: width / 2 - (left+right) / 2 * zoom, y: height / 2 - (top+bottom) / 2 * zoom, zoom };
}

export function moveAvailable(p: Projection, place: string, connected: boolean): boolean {
  if (!connected || p.historical || p.role !== "participant" || p.control.status !== "running" || !p.actor_id) return false;
  const me = p.agents[p.actor_id];
  return Boolean(me && p.world.place_topology[me.location]?.includes(place));
}
