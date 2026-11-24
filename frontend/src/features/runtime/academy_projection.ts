import type { Envelope } from "./api";

export const ACADEMY_PLACES = ["courtyard", "classroom", "library", "street"];

/** Renderer DTO, drawn from the already authorized projection. No cognition or sources. */
export function academyProjection(
  frame: Envelope,
  place: string,
  selected: string,
  reduced: boolean,
  follow: boolean,
) {
  const p = frame.projection;
  // A Participant may know an exit label without having a projection of that room.
  const permitted =
    ACADEMY_PLACES.includes(place) &&
    (p.role !== "participant" || p.agents[p.actor_id!]?.location === place);
  const here = permitted
    ? Object.entries(p.agents).filter(([, a]) => a.location === place)
    : [];
  const ids = new Set(here.map(([id]) => id));
  return {
    place: permitted ? place : "",
    revision: frame.cursor,
    historical: p.historical,
    running: p.control.status === "running",
    reduced,
    follow,
    selected: ids.has(selected) ? selected : "",
    actors: here.map(([id], i) => ({
      id,
      avatar: p.scene?.actors[id]?.avatar || 0,
      slot: Math.max(0, (Number(id.replace(/\D/g, "")) || i + 1) - 1),
    })),
    items: permitted
      ? Object.entries(p.world.items)
          .filter(([, holder]) => holder === place)
          .map(([id]) => ({ id }))
      : [],
    exits: permitted
      ? (p.world.place_topology[place] || []).filter((id) =>
          ACADEMY_PLACES.includes(id),
        )
      : [],
    events: permitted
      ? frame.events
          .filter(
            (e) =>
              ids.has(e.actor_id || "") ||
              (e.action_type === "relocate" &&
                ids.has(String(e.args?.actor_id || ""))),
          )
          .map((e) => ({
            id: e.event_id,
            actor:
              e.action_type === "relocate"
                ? String(e.args?.actor_id || "")
                : e.actor_id,
            kind: e.action_type,
            accepted: e.accepted,
            origin: e.location_id || "",
            destination: String(e.args?.destination_id || ""),
            text:
              e.action_type === "speak"
                ? e.text || String(e.args?.speech || "")
                : "",
          }))
      : [],
  };
}
