"""Small, read-only Creator comparison over two committed Runtime worldlines."""
import json

from .domain import RuntimeFault, state_hash


def _ancestors(state):
    return list(state.lineage.ancestors) if state.lineage else []


def _common_anchor(left, right):
    candidates = []
    left_ancestors, right_ancestors = _ancestors(left), _ancestors(right)
    for left_anchor in left_ancestors:
        for right_anchor in right_ancestors:
            if left_anchor == right_anchor:
                candidates.append(left_anchor)
    for anchor in left_ancestors:
        if anchor.worldline_id == right.worldline_id and anchor.seq <= right.head_seq:
            candidates.append(anchor)
    for anchor in right_ancestors:
        if anchor.worldline_id == left.worldline_id and anchor.seq <= left.head_seq:
            candidates.append(anchor)
    if not candidates:
        return None
    unique = {(item.worldline_id, item.seq, item.state_hash): item for item in candidates}
    return list(unique.values())[-1].model_dump()


def _name(manifest, identity):
    if not manifest:
        return identity
    setup = manifest.get('setup', {})
    for item in setup.get('roles', []) + setup.get('places', []) + setup.get('items', []):
        if item.get('id') == identity:
            return item.get('name', identity)
    return identity


def _summary(store, conn, state, control):
    manifest = store.scenario(state.worldline_id, conn=conn) or {}
    return {
        'worldline_id': state.worldline_id,
        'title': manifest.get('title', state.worldline_id),
        'purpose': manifest.get('purpose', 'unclassified'),
        'seq': state.head_seq,
        'sim_time_tick': state.sim_time_tick,
        'state_hash': state_hash(state),
        'control_status': control['status'],
    }


def _value_changes(left, right, manifest):
    changes = []

    def add(path, label, left_value, right_value, category, entity_id=None):
        if left_value != right_value:
            changes.append(dict(path=path, label=label, left=left_value, right=right_value,
                                category=category, entity_id=entity_id))

    environment = set(left.world.environment) | set(right.world.environment)
    for key in sorted(environment):
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
        for field, suffix in (('location', '的位置'), ('goal', '的目标')):
            add(f'agents.{key}.{field}', _name(manifest, key) + suffix,
                getattr(left_agent, field, None), getattr(right_agent, field, None), 'agent', key)
        add(f'agents.{key}.committed_plans', _name(manifest, key) + '的计划',
            getattr(left_agent, 'committed_plans', None), getattr(right_agent, 'committed_plans', None), 'plan', key)
    return changes


def _event_text(event):
    if event.get('action_type') in ('speak', 'scene_event', 'trigger') and event.get('accepted'):
        text = next((op.get('evidence', {}).get('text', '') for op in event.get('effects', [])
                     if op.get('op') == 'memory_append'), '')
        if text:
            return text
        return event.get('command', {}).get('args', {}).get('text', '')
    return ''


def _events(conn, state, anchor):
    start = anchor['seq'] if anchor and anchor['worldline_id'] == state.worldline_id else 0
    values = []
    for row in conn.execute(
        'SELECT payload FROM runtime_v2_journal WHERE worldline_id=? AND seq>? ORDER BY seq LIMIT 500',
        (state.worldline_id, start),
    ):
        event = json.loads(row[0])
        command = event.get('command') or {}
        args = command.get('args') or {}
        location_id = args.get('place_id') or args.get('destination_id')
        values.append({
            'worldline_id': state.worldline_id,
            'seq': event['seq'],
            'event_id': event['event_id'],
            'actor_id': event.get('actor_id'),
            'action_type': event['action_type'],
            'accepted': event['accepted'],
            'reason_code': event.get('reason_code'),
            'sim_time_after': event.get('sim_time_after'),
            'sim_time_before': event.get('sim_time_before'),
            'location_id': location_id,
            'args': args,
            'text': _event_text(event),
        })
    return values


def compare(store, conn, left_id, right_id):
    if left_id == right_id:
        raise RuntimeFault('comparison_same_worldline')
    left = store._state(conn, left_id)
    right = store._state(conn, right_id)
    if left.world_id != right.world_id:
        raise RuntimeFault('scope_mismatch')
    controls = {
        left_id: dict(conn.execute(
            'SELECT status FROM runtime_v2_execution_control WHERE worldline_id=?', (left_id,)
        ).fetchone()),
        right_id: dict(conn.execute(
            'SELECT status FROM runtime_v2_execution_control WHERE worldline_id=?', (right_id,)
        ).fetchone()),
    }
    manifest = store.scenario(left_id, conn=conn) or store.scenario(right_id, conn=conn)
    anchor = _common_anchor(left, right)
    return {
        'world_id': left.world_id,
        'common_anchor': anchor,
        'left': _summary(store, conn, left, controls[left_id]),
        'right': _summary(store, conn, right, controls[right_id]),
        'changes': _value_changes(left, right, manifest),
        'events': {
            'left': _events(conn, left, anchor),
            'right': _events(conn, right, anchor),
        },
    }
