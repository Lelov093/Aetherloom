"""Reviewed social inputs compile inside the existing scenario transaction."""
import json
from .contracts import Evidence, BaselineSource, ScheduledJob, SOCIAL_STATE, SOCIAL_EVENT, COGNITIVE_STATE, COGNITIVE_EVENT
from .social_models import SocialState, SocialAgent
from .domain import RuntimeFault


def source_catalog(conn, world):
    """Author-only selection labels; no implicit inclusion in any agent context."""
    result = []
    for row in conn.execute('SELECT n.id,n.title,v.version FROM nodes n JOIN works w ON w.id=n.work_id JOIN content_versions v ON v.node_id=n.id WHERE w.world_id=? ORDER BY n.title,v.version DESC', (world,)):
        result.append(dict(kind='node',id=row['id'],version=row['version'],label=row['title']))
    for kind, table, label in (('assertion','assertions','predicate'),('event','canon_events','title')):
        for row in conn.execute(f'SELECT id,version,{label} FROM {table} WHERE world_id=? AND status=\'active\'',(world,)):
            result.append(dict(kind=kind,id=row['id'],version=row['version'],label=row[label]))
    for row in conn.execute('SELECT s.id,s.version,s.label FROM relationship_states s JOIN temporal_relationships r ON r.id=s.relationship_id WHERE r.world_id=? AND s.status=\'active\'',(world,)):
        result.append(dict(kind='relationship_state',id=row['id'],version=row['version'],label=row['label']))
    return result


def selected_source(conn, world, kind, identity, version):
    if kind == 'node':
        owner = conn.execute('SELECT w.world_id FROM nodes n JOIN works w ON w.id=n.work_id WHERE n.id=?', (identity,)).fetchone()
        row = conn.execute('SELECT * FROM content_versions WHERE node_id=? AND version=?', (identity, version)).fetchone()
    else:
        table = {'assertion': 'assertions', 'event': 'canon_events', 'relationship_state': 'relationship_states'}[kind]
        row = conn.execute(f'SELECT * FROM {table} WHERE id=?', (identity,)).fetchone()
        if kind == 'relationship_state' and row:
            owner = conn.execute('SELECT world_id FROM temporal_relationships WHERE id=?', (row['relationship_id'],)).fetchone()
        else: owner = (row['world_id'],) if row else None
        historical = conn.execute('SELECT payload FROM canon_object_versions WHERE object_type=? AND object_id=? AND version=?',
            ('relationship' if kind == 'relationship_state' else kind, identity, version)).fetchone()
        if historical: row = json.loads(historical[0])
        elif row and row['version'] != version: row = None
    if not owner or owner[0] != world or not row: raise RuntimeFault('scenario_sources_changed')
    return dict(kind=kind, source_id=identity, version=version, snapshot=dict(row))


def compile_social(conn, body, state, sources):
    setup = body.social
    if setup is None: return
    actors = set(state.agents)
    if not setup.start_time.strip(): raise RuntimeFault('social_start_time_required')
    if not set(setup.initial_plans) <= actors: raise RuntimeFault('invalid_social_actors')
    for plans in setup.initial_plans.values():
        if len(plans) > 8 or len({p.id for p in plans}) != len(plans): raise RuntimeFault('invalid_initial_plans')
        if any(p.target_id is not None and p.target_id not in actors for p in plans): raise RuntimeFault('invalid_plan_target')
    state.state_schema_version, state.event_schema_version = SOCIAL_STATE, SOCIAL_EVENT
    state.social = SocialState(contract_version=setup.contract_version,
        agents={actor: SocialAgent(plans=setup.initial_plans.get(actor, [])) for actor in state.agents})
    if setup.contract_version == 'social-domain-v2':
        from .social_models import CognitiveState, BeliefMeta
        state.state_schema_version, state.event_schema_version = COGNITIVE_STATE, COGNITIVE_EVENT
        for actor, own in state.social.agents.items():
            own.cognition = CognitiveState(beliefs={key:BeliefMeta() for key in state.agents[actor].beliefs})
            state.agents[actor].committed_plans = [p.next_step for p in own.plans if p.status == 'active']
    def grant(actor, key, text):
        state.agents[actor].known[key] = Evidence(text=text, basis='initial', source=BaselineSource(baseline_id=state.baseline_id))
    # Start-time semantics are reviewed text, never an implicit calendar-to-tick parser.
    for actor in actors: grant(actor, 'social-start', '本次起点（逻辑tick 0）：' + setup.start_time)
    for i, card in enumerate(setup.cards):
        if not set(card.audience) <= actors or (card.at_start in ('future', 'excluded') and card.audience):
            raise RuntimeFault('invalid_context_audience')
        provided = [card.source_kind is not None, card.source_id is not None, card.source_version is not None]
        if any(provided) and not all(provided): raise RuntimeFault('invalid_context_source')
        if card.source_id:
            source = selected_source(conn, state.world_id, card.source_kind, card.source_id, card.source_version)
            if not any((s['kind'], s['source_id'], s['version']) == (source['kind'], source['source_id'], source['version']) for s in sources): sources.append(source)
        for actor in card.audience:
            grant(actor, f'social-card-{i}', f'[{card.category} / {card.at_start}] {card.text}')
    opening = setup.opening
    if opening:
        if (opening.place_id not in state.world.place_topology or not set(opening.audience) <= actors
            or len(set(opening.audience)) != len(opening.audience)):
            raise RuntimeFault('invalid_opening')
        if opening.kind == 'private' and len(opening.audience) != 1: raise RuntimeFault('private_opening_requires_one_actor')
        if opening.kind == 'event':
            state.scheduler.pending_jobs.append(ScheduledJob(id='social-opening', due_tick=opening.due_tick,
                priority=0, insertion_order=state.scheduler.insertion_counter, kind='scene_event',
                payload={'place_id': opening.place_id, 'text': opening.text, 'audience': opening.audience}))
            state.scheduler.insertion_counter += 1
        else:
            if opening.due_tick != 0: raise RuntimeFault('initial_opening_at_tick_zero')
            if any(state.agents[a].location != opening.place_id for a in opening.audience): raise RuntimeFault('initial_opening_location_mismatch')
            for actor in opening.audience: grant(actor, 'social-opening', f'[{opening.kind}引子] ' + opening.text)
