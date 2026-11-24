"""Versioned checkpoints and complete, isolated forks of committed history."""
import json
from uuid import uuid4

from .contracts import RuntimeAggregate, Lineage, AncestorAnchor, FORK_STATE, FORK_EVENT, INTERACTIVE_STATES, FORK_CORE_STATE, FORK_CORE_EVENT
from .domain import RuntimeFault, canonical, state_hash, invariants

CHECKPOINT_INTERVAL = 32


def available(store):
    return store.layout == 'shared' and store.storage_version >= 4


def tick_counts(conn, state):
    row = conn.execute("""SELECT count(*),coalesce(sum(json_extract(payload,'$.kind')='scheduled_event'),0)
        FROM runtime_v2_journal WHERE worldline_id=? AND seq<=?
        AND json_extract(payload,'$.sim_time_after')=?
        AND json_extract(payload,'$.sim_time_before')=json_extract(payload,'$.sim_time_after')""",
        (state.worldline_id, state.head_seq, state.sim_time_tick)).fetchone()
    zero, scheduled = row
    if state.lineage and state.lineage.tick == state.sim_time_tick:
        zero += state.lineage.zero_count
        scheduled += state.lineage.scheduled_count
    return zero, scheduled


def save_checkpoint(store, conn, state):
    if not available(store): return
    value = (canonical(state.model_dump()), state_hash(state))
    old = conn.execute('SELECT state,state_hash FROM runtime_v2_checkpoints WHERE worldline_id=? AND seq=?',
                       (state.worldline_id, state.head_seq)).fetchone()
    if old and tuple(old) != value: raise RuntimeFault('checkpoint_corrupted')
    if not old:
        conn.execute('INSERT INTO runtime_v2_checkpoints VALUES(?,?,?,?)', (state.worldline_id, state.head_seq, *value))


def checkpoint(store, conn, row, target):
    if not available(store): return None
    saved = conn.execute('SELECT * FROM runtime_v2_checkpoints WHERE worldline_id=? AND seq<=? ORDER BY seq DESC LIMIT 1',
                         (row['id'], target)).fetchone()
    if not saved: return None
    state = RuntimeAggregate.model_validate_json(saved['state'])
    invariants(state)
    anchor = conn.execute('SELECT payload FROM runtime_v2_journal WHERE worldline_id=? AND seq=?', (row['id'], saved['seq'])).fetchone()
    expected = json.loads(anchor[0])['after_hash'] if anchor else row['initial_hash'] if saved['seq'] == 0 else None
    if (state.worldline_id != row['id'] or state.world_id != row['world_id'] or state.head_seq != saved['seq']
        or saved['state_hash'] != state_hash(state) or expected != saved['state_hash']):
        raise RuntimeFault('checkpoint_corrupted')
    return state


def child_state(parent, child, zero, scheduled):
    result = parent.model_copy(deep=True)
    ancestors = list(parent.lineage.ancestors) if parent.lineage else []
    ancestors.append(AncestorAnchor(worldline_id=parent.worldline_id, seq=parent.head_seq, state_hash=state_hash(parent)))
    result.worldline_id, result.head_seq = child, 0
    result.state_schema_version, result.event_schema_version = ((parent.state_schema_version, parent.event_schema_version) if parent.social else
        (FORK_STATE, FORK_EVENT) if parent.state_schema_version in INTERACTIVE_STATES else (FORK_CORE_STATE, FORK_CORE_EVENT))
    result.lineage = Lineage(ancestors=ancestors, tick=parent.sim_time_tick, zero_count=zero, scheduled_count=scheduled)
    raw = result.model_dump()
    for agent in raw['agents'].values():
        for item in list(agent['known'].values()) + agent['memories']:
            if item['source']['kind'] == 'event': item['source']['kind'] = 'inherited_event'
    return RuntimeAggregate.model_validate(raw)


def fork(store, parent_id, world, body, *, hook=lambda stage: None):
    if not available(store): raise RuntimeFault('history_migration_required')
    request = canonical({'parent_id': parent_id, **body})
    with store.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        old = conn.execute('SELECT child_id,request FROM runtime_v2_forks WHERE world_id=? AND request_id=?',
                           (world, body['request_id'])).fetchone()
        if old:
            if old['request'] != request: raise RuntimeFault('fork_request_conflict')
            return {'worldline_id': old['child_id'], 'world_id': world}
        parent = store._read_at(conn, parent_id, body['seq'])
        if parent.world_id != world: raise RuntimeFault('scope_mismatch')
        if state_hash(parent) != body['state_hash']: raise RuntimeFault('stale_fork_anchor')
        zero, scheduled = tick_counts(conn, parent)
        child = child_state(parent, str(uuid4()), zero, scheduled)
        baseline_row = conn.execute('SELECT b.manifest FROM runtime_v2_baselines b JOIN runtime_v2_baseline_links l ON b.id=l.baseline_id WHERE l.worldline_id=?', (parent_id,)).fetchone()
        from .baseline import FrozenBaseline
        baseline = FrozenBaseline.model_validate_json(baseline_row[0])
        save_checkpoint(store, conn, parent)
        hook('checkpoint_saved')
        store.create(child, baseline=baseline, connection=conn)
        hook('child_saved')
        manifest = store.scenario(parent_id, conn=conn)
        if manifest:
            manifest['title'] = body['title']
            conn.execute('INSERT INTO runtime_v2_scenarios VALUES(?,?,?,?,?)',
                         (child.worldline_id, world, 'fork:' + child.worldline_id, request, canonical(manifest)))
        conn.execute('INSERT INTO runtime_v2_forks VALUES(?,?,?,?,?,?,?)',
                     (child.worldline_id, parent_id, parent.head_seq, world, body['request_id'], request, body['title']))
        hook('lineage_saved')
        hook('before_commit')
        conn.commit()
        hook('after_commit')
        return {'worldline_id': child.worldline_id, 'world_id': world}


def verify_lineage(store, conn, state):
    """Recovery validates inherited state against the saved parent anchor, not a claim."""
    if not state.lineage: return
    row = conn.execute('SELECT * FROM runtime_v2_forks WHERE child_id=?', (state.worldline_id,)).fetchone()
    anchor = state.lineage.ancestors[-1]
    if not row or (row['parent_id'], row['anchor_seq']) != (anchor.worldline_id, anchor.seq):
        raise RuntimeFault('invalid_lineage')
    parent = store._read_at(conn, anchor.worldline_id, anchor.seq, use_checkpoint=False)
    expected = child_state(parent, state.worldline_id, *tick_counts(conn, parent))
    initial = conn.execute('SELECT initial FROM runtime_v2_worldlines WHERE id=?', (state.worldline_id,)).fetchone()[0]
    if canonical(expected.model_dump()) != initial: raise RuntimeFault('invalid_lineage')
