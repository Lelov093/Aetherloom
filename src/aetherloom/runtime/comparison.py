"""Small, read-only Creator comparison over two committed Runtime worldlines."""
from .domain import RuntimeFault, state_hash
from . import transcript


def _path(state):
    inherited = [(anchor.worldline_id, anchor.seq) for anchor in state.lineage.ancestors] if state.lineage else []
    return [*inherited, (state.worldline_id, state.head_seq)]


def _common_anchor(store, conn, left, right):
    right_path = dict(_path(right))
    for identity, seq in reversed(_path(left)):
        if identity in right_path:
            common = store._read_at(conn, identity, min(seq, right_path[identity]))
            return dict(worldline_id=identity, seq=common.head_seq, state_hash=state_hash(common),
                        sim_time_tick=common.sim_time_tick)
    return None


def _name(manifest, identity):
    if not manifest:
        return identity
    setup = manifest.get('setup', {})
    for item in setup.get('roles', []) + setup.get('places', []) + setup.get('items', []):
        if item.get('id') == identity:
            return item.get('name', identity)
    return identity


def _summary(state, manifest, control, initial_tick, latest_tick, selected_tick):
    return {
        'worldline_id': state.worldline_id,
        'title': manifest.get('title', state.worldline_id),
        'purpose': manifest.get('purpose', 'unclassified'),
        'seq': state.head_seq,
        'sim_time_tick': state.sim_time_tick,
        'initial_tick': initial_tick,
        'latest_tick': latest_tick,
        'selected_tick': selected_tick if selected_tick is not None else latest_tick,
        'state_hash': state_hash(state),
        'control_status': control['status'],
    }


def _value_changes(left, right, manifest, guarded):
    changes = []

    def add(path, label, left_value, right_value, category, entity_id=None):
        if left_value != right_value:
            changes.append(dict(path=path, label=label, left=left_value, right=right_value,
                                category=category, entity_id=entity_id))

    environment = set(left.world.environment) | set(right.world.environment)
    for key in sorted(environment) if not guarded else ():
        add(f'world.environment.{key}', f'环境 · {key}',
            left.world.environment.get(key), right.world.environment.get(key), 'environment', key)
    items = set(left.world.items) | set(right.world.items)
    for key in sorted(items):
        add(f'world.items.{key}', f'{_name(manifest, key)}的持有者',
            left.world.items.get(key), right.world.items.get(key), 'item', key)
    agents = set(left.agents) | set(right.agents)
    for key in sorted(agents):
        left_agent = left.agents.get(key)
        right_agent = right.agents.get(key)
        for field, suffix in (('location', '的位置'),) if guarded else (('location', '的位置'), ('goal', '的目标')):
            add(f'agents.{key}.{field}', _name(manifest, key) + suffix,
                getattr(left_agent, field, None), getattr(right_agent, field, None), 'agent', key)
        if not guarded:
            add(f'agents.{key}.committed_plans', _name(manifest, key) + '的计划',
                getattr(left_agent, 'committed_plans', None), getattr(right_agent, 'committed_plans', None), 'plan', key)
    return changes


def _events(store, conn, state, anchor, guarded):
    path = dict(_path(state))
    ranges, remaining, truncated = [], 500, False
    for identity, last in reversed(list(path.items())):
        at_anchor = anchor and anchor['worldline_id'] == identity
        first = anchor['seq'] + 1 if at_anchor else 1
        window_start = max(first, last - remaining + 1)
        truncated |= window_start > first
        if window_start <= last:
            ranges.append((identity, window_start, last))
            remaining -= last - window_start + 1
        if at_anchor:
            break
    return [dict(transcript.summary(*record, guarded=guarded), worldline_id=identity)
            for identity, first, last in reversed(ranges)
            for record in transcript.records(store, conn, identity, first, last)], truncated


def _at_tick(store, conn, latest, tick):
    initial = store._read_at(conn, latest.worldline_id, 0)
    if tick is None or tick == latest.sim_time_tick:
        return latest, initial.sim_time_tick
    if tick < initial.sim_time_tick or tick > latest.sim_time_tick:
        raise RuntimeFault('comparison_tick_out_of_range')
    # Multiple commits can share a tick. Read the last saved step at or before it.
    match = conn.execute("""SELECT seq FROM runtime_v2_journal WHERE worldline_id=?
                         AND json_extract(payload,'$.sim_time_after')<=? ORDER BY seq DESC LIMIT 1""",
                         (latest.worldline_id, tick)).fetchone()
    return (store._read_at(conn, latest.worldline_id, match['seq']) if match else initial), initial.sim_time_tick


def compare(store, conn, left_id, right_id, *, left_tick=None, right_tick=None, guarded=False):
    if left_id == right_id:
        raise RuntimeFault('comparison_same_worldline')
    left_latest = store._state(conn, left_id)
    right_latest = store._state(conn, right_id)
    if left_latest.world_id != right_latest.world_id:
        raise RuntimeFault('scope_mismatch')
    left, left_initial = _at_tick(store, conn, left_latest, left_tick)
    right, right_initial = _at_tick(store, conn, right_latest, right_tick)
    controls = {
        left_id: dict(conn.execute(
            'SELECT status FROM runtime_v2_execution_control WHERE worldline_id=?', (left_id,)
        ).fetchone()),
        right_id: dict(conn.execute(
            'SELECT status FROM runtime_v2_execution_control WHERE worldline_id=?', (right_id,)
        ).fetchone()),
    }
    left_manifest = store.scenario(left_id, conn=conn) or {}
    right_manifest = store.scenario(right_id, conn=conn) or {}
    anchor = _common_anchor(store, conn, left, right)
    left_events, left_truncated = _events(store, conn, left, anchor, guarded)
    right_events, right_truncated = _events(store, conn, right, anchor, guarded)
    return {
        'world_id': left.world_id,
        'common_anchor': anchor,
        'left': _summary(left, left_manifest, controls[left_id], left_initial, left_latest.sim_time_tick, left_tick),
        'right': _summary(right, right_manifest, controls[right_id], right_initial, right_latest.sim_time_tick, right_tick),
        'changes': _value_changes(left, right, left_manifest or right_manifest, guarded),
        'events': {'left': left_events, 'right': right_events},
        'events_truncated': left_truncated or right_truncated,
    }
