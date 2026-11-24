"""Read-only timeline data for the Creator Replay editor."""
import json

from .domain import RuntimeFault
from .replay import apply_transition


def timeline(store, conn, worldline, *, offset=0, limit=100, actor_id=None,
             location_id=None, action_type=None, min_tick=None, max_tick=None,
             query=''):
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
    rows = conn.execute(
        'SELECT payload FROM runtime_v2_journal WHERE worldline_id=? ORDER BY seq',
        (worldline,),
    ).fetchall()
    all_events = []
    replay_state = store._read_at(conn, worldline, 0)
    for payload_row in rows:
        value = json.loads(payload_row['payload'])
        command = value.get('command') or {}
        args = command.get('args') or {}
        event_location_id = (
            replay_state.agents.get(value.get('actor_id')).location
            if replay_state and value.get('actor_id') in replay_state.agents
            else None
        ) or (
            args.get('place_id')
            or args.get('destination_id')
            or value.get('location_id')
        )
        text = value.get('text') or args.get('text') or args.get('speech') or ''
        item = {
            key: value.get(key)
            for key in (
                'event_id', 'seq', 'actor_id', 'action_type', 'accepted',
                'reason_code', 'sim_time_before', 'sim_time_after', 'kind',
            )
        } | {
            'location_id': event_location_id,
            'text': text,
            'source': {
                'worldline_id': worldline,
                'seq': value.get('seq'),
                'event_id': value.get('event_id'),
            },
        }
        all_events.append(item)
        if replay_state is not None:
            replay_state = apply_transition(replay_state, value)
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
    events = filtered[offset:offset + limit]
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
