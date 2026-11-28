"""Read-only timeline data for the Creator Replay editor."""
import json

from .domain import RuntimeFault
from . import transcript


def timeline(store, conn, worldline, *, offset=0, limit=100, actor_id=None,
             location_id=None, action_type=None, min_tick=None, max_tick=None,
             query='', before_seq=None, guarded=False):
    worldline_row = conn.execute(
        'SELECT id,world_id,head_seq FROM runtime_v2_worldlines WHERE id=?',
        (worldline,),
    ).fetchone()
    if worldline_row is None:
        raise RuntimeFault('worldline_unavailable')
    if offset < 0 or limit < 1:
        raise RuntimeFault('invalid_replay_window')
    total = conn.execute(
        'SELECT count(*) FROM runtime_v2_journal WHERE worldline_id=?',
        (worldline,),
    ).fetchone()[0]
    state = store._state(conn, worldline)
    last = state.head_seq if before_seq is None else min(state.head_seq, before_seq - 1)
    backward_window = before_seq is not None and not any((actor_id, location_id, action_type, query)) and min_tick is None and max_tick is None
    first = max(1, last - limit + 1) if backward_window else 1
    all_events = []
    for record in transcript.records(store, conn, worldline, first, last):
        item = transcript.summary(*record, guarded=guarded)
        item['source'] = dict(worldline_id=worldline, seq=item['seq'], event_id=item['event_id'])
        all_events.append(item)
    filtered = [event for event in all_events if (
        (not actor_id or event.get('actor_id') == actor_id)
        and (not location_id or event.get('location_id') == location_id)
        and (not action_type or event.get('action_type') == action_type)
        and (min_tick is None or (event.get('sim_time_after') is not None and event['sim_time_after'] >= min_tick))
        and (max_tick is None or (event.get('sim_time_after') is not None and event['sim_time_after'] <= max_tick))
        and (not query or query.lower() in json.dumps(event, ensure_ascii=False).lower())
    )]
    facets = {
        'actors': _facet(all_events, 'actor_id'),
        'locations': _facet(all_events, 'location_id'),
        'actions': _facet(all_events, 'action_type'),
    }
    events = filtered[-limit:] if before_seq is not None else filtered[offset:offset + limit]
    return {
        'worldline_id': worldline,
        'world_id': worldline_row['world_id'],
        'current_seq': state.head_seq,
        'current_tick': state.sim_time_tick,
        'total': len(filtered),
        'total_all': total,
        'offset': offset,
        'limit': limit,
        'events': events,
        'facets': facets,
    }


def _facet(events, key):
    counts = {}
    for event in events:
        value = event.get(key)
        if value:
            counts[value] = counts.get(value, 0) + 1
    return [dict(value=value, count=count) for value, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))]
