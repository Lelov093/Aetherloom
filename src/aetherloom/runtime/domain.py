"""Pure seven-action Resolver and canonical domain hashing."""
import hashlib
import json

from .contracts import (RuntimeAggregate as Aggregate, Evidence, Memory, EventSource, ActionIntent as Intent, TransitionPlan as Plan,
                        LocationSet, HolderSet, GoalSet, KnowledgeSet, MemoryAppend, CounterSet,
                        STATE, ENGINE, RULES, CONTRACT, EVENT, HASH, SCHEDULER,
                        INTERACTIVE_STATE, INTERACTIVE_EVENT, INTERACTIVE_SCHEDULER, ScheduledJob,
                        FORK_STATE, FORK_EVENT, INTERACTIVE_STATES, FORK_STATES, FORK_CORE_STATE, FORK_CORE_EVENT,
                        SOCIAL_STATE, SOCIAL_EVENT, SOCIAL_STATES, COGNITIVE_STATE, COGNITIVE_EVENT, READING_STATE, READING_EVENT)


class RuntimeFault(ValueError):
    pass


def canonical(value):
    def valid(item):
        if item is None or type(item) is bool:
            return
        if type(item) is int and abs(item) <= 9007199254740991:
            return
        if type(item) is str:
            item.encode('utf-8', errors='strict')
            return
        if type(item) is list:
            for entry in item: valid(entry)
            return
        if type(item) is dict and all(type(key) is str for key in item):
            for key, entry in item.items(): valid(key); valid(entry)
            return
        raise RuntimeFault('unsupported_canonical_value')
    valid(value)
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(value):
    return 'sha256:' + hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def state_hash(state):
    return digest(state.model_dump())


def validate_versions(state):
    expected = ((state.state_schema_version, ENGINE, RULES, CONTRACT,
                 READING_EVENT if state.state_schema_version == READING_STATE else COGNITIVE_EVENT if state.state_schema_version == COGNITIVE_STATE else SOCIAL_EVENT if state.state_schema_version == SOCIAL_STATE else FORK_EVENT if state.state_schema_version == FORK_STATE else INTERACTIVE_EVENT, HASH, INTERACTIVE_SCHEDULER)
                if state.state_schema_version in INTERACTIVE_STATES else (STATE, ENGINE, RULES, CONTRACT, EVENT, HASH, SCHEDULER))
    if state.state_schema_version == FORK_CORE_STATE:
        expected = (FORK_CORE_STATE, ENGINE, RULES, CONTRACT, FORK_CORE_EVENT, HASH, SCHEDULER)
    if (state.state_schema_version, state.engine_version, state.ruleset_version, state.action_contract_version,
        state.event_schema_version, state.hash_algorithm_version, state.scheduler.policy_version) != expected:
        raise RuntimeFault('unsupported_schema')


def invariants(state):
    validate_versions(state)
    if state.state_schema_version not in SOCIAL_STATES and (state.state_schema_version in FORK_STATES) != (state.lineage is not None):
        raise RuntimeFault('invalid_lineage')
    if (state.state_schema_version in SOCIAL_STATES) != (state.social is not None): raise RuntimeFault('invalid_social_schema')
    ancestors = {a.worldline_id: a.seq for a in state.lineage.ancestors} if state.lineage else {}
    if state.lineage and (len(ancestors) != len(state.lineage.ancestors) or state.worldline_id in ancestors
                          or state.lineage.tick > state.sim_time_tick):
        raise RuntimeFault('invalid_lineage')
    places, agents = state.world.place_topology, state.agents
    if (state.world.item_texts is not None) != (state.state_schema_version == READING_STATE):
        raise RuntimeFault('invalid_reading_schema')
    if state.world.item_texts is not None and (not set(state.world.item_texts) <= set(state.world.items)
        or any(not t.strip() or len(t)>1200 for t in state.world.item_texts.values())):
        raise RuntimeFault('invalid_item_text')
    if (not agents or not places or set(state.scheduler.ready_actor_order) != set(agents)
        or len(state.scheduler.ready_actor_order) != len(agents)
        or state.head_seq < 0 or state.sim_time_tick < 0 or state.scheduler.turn_counter < 0
        or state.head_seq > state.max_domain_steps):
        raise RuntimeFault('invalid_aggregate')
    if any(a.location not in places for a in agents.values()):
        raise RuntimeFault('invalid_agent_location')
    if any(holder not in agents and holder not in places for holder in state.world.items.values()):
        raise RuntimeFault('invalid_item_holder')
    if any(set(neighbors) - set(places) for neighbors in places.values()):
        raise RuntimeFault('invalid_topology')
    if any(r.destination_id not in places or r.item_id not in state.world.items for r in state.world.access_rules):
        raise RuntimeFault('invalid_access_rule')
    jobs = state.scheduler.pending_jobs
    if state.state_schema_version in INTERACTIVE_STATES:
        from .interactive import validate_job
        for job in jobs: validate_job(state, job)
    elif any(isinstance(job, ScheduledJob) for job in jobs):
        raise RuntimeFault('unsupported_schema')
    if (len({j.id for j in jobs}) != len(jobs) or len({j.insertion_order for j in jobs}) != len(jobs)
        or any(j.insertion_order < 0 or j.insertion_order >= state.scheduler.insertion_counter for j in jobs)):
        raise RuntimeFault('invalid_scheduler_queue')
    if set(agents) & set(places) or set(state.world.items) & (set(agents) | set(places)):
        raise RuntimeFault('ambiguous_entity_identity')
    def check_source(source):
        if source.kind == 'baseline':
            if source.baseline_id != state.baseline_id:
                raise RuntimeFault('invalid_baseline_source')
        elif source.kind == 'inherited_event':
            if source.worldline_id not in ancestors or not 1 <= source.seq <= ancestors[source.worldline_id]:
                raise RuntimeFault('invalid_event_source')
        elif source.worldline_id != state.worldline_id or not 1 <= source.seq <= state.head_seq:
            raise RuntimeFault('invalid_event_source')
    for agent in agents.values():
        for memory in agent.memories:
            check_source(memory.source)
            if memory.actor_id not in agents and not (state.state_schema_version in INTERACTIVE_STATES and memory.actor_id is None):
                raise RuntimeFault('invalid_memory_actor')
        for knowledge in agent.known.values():
            if knowledge.basis in ('read','checked') and state.state_schema_version != READING_STATE:
                raise RuntimeFault('invalid_reading_schema')
            check_source(knowledge.source)
            if knowledge.sender_id is not None and knowledge.sender_id not in agents:
                raise RuntimeFault('invalid_report_sender')
    if state.social:
        from .social import validate
        validate(state)
    canonical(state.model_dump())


def resolve(state: Aggregate, intent: Intent) -> Plan:
    """No I/O/randomness, no mutation of state/intent, no implicit knowledge grants."""
    invariants(state)
    if intent.contract_version != CONTRACT:
        raise RuntimeFault('unsupported_schema')
    if intent.engine_version != ENGINE:
        raise RuntimeFault('unsupported_engine')
    if intent.world_id != state.world_id:
        raise RuntimeFault('world_identity_mismatch')
    if intent.actor_id not in state.agents:
        raise RuntimeFault('invalid_actor')
    if intent.worldline_id != state.worldline_id or intent.expected_seq != state.head_seq:
        raise RuntimeFault('stale_state')
    if state.head_seq >= state.max_domain_steps:
        raise RuntimeFault('domain_limit_reached')
    args = intent.typed_args()
    actor, kind = intent.actor_id, intent.action_type
    me, world = state.agents[actor], state.world
    if kind in ('read','compare'):
        from .reading import resolve as resolve_reading
        return resolve_reading(state,intent)
    effects, reason = [], None
    recipients = [actor]
    if kind == 'move':
        if args.destination_id not in world.place_topology[me.location]:
            reason = 'not_connected'
        elif any(r.destination_id == args.destination_id and world.items[r.item_id] != actor for r in world.access_rules):
            reason = 'entry_requires_item'
        else:
            effects.append(LocationSet(entity_id=actor, before=me.location, after=args.destination_id))
    elif kind == 'take':
        if args.item_id not in world.items or world.items[args.item_id] != me.location:
            reason = 'item_not_available'
        else:
            effects.append(HolderSet(item_id=args.item_id, before=me.location, after=actor))
    elif kind == 'transfer':
        if args.item_id not in world.items or world.items[args.item_id] != actor:
            reason = 'item_not_owned'
        elif args.recipient_id == actor or args.recipient_id not in state.agents or state.agents[args.recipient_id].location != me.location:
            reason = 'recipient_not_colocated'
        else:
            effects.append(HolderSet(item_id=args.item_id, before=actor, after=args.recipient_id))
            recipients.append(args.recipient_id)
    elif kind == 'goal':
        if not args.goal.strip():
            reason = 'empty_goal'
        else:
            effects.append(GoalSet(entity_id=actor, before=me.goal, after=args.goal))
    elif kind == 'speak':
        if not args.speech.strip():
            reason = 'empty_speech'
        elif args.recipient_id is not None and (args.recipient_id == actor or args.recipient_id not in state.agents
                or state.agents[args.recipient_id].location != me.location):
            reason = 'recipient_not_colocated'
        elif any(key not in me.known for key in args.share_ids):
            reason = 'unknown_report'
        else:
            recipients += [args.recipient_id] if args.recipient_id else sorted(a for a,s in state.agents.items() if a != actor and s.location == me.location)
            for recipient in recipients[1:]:
                for key in dict.fromkeys(args.share_ids):
                    if key not in state.agents[recipient].known:
                        effects.append(KnowledgeSet(entity_id=recipient, record_id=key, before=None,
                            after=Evidence(text=me.known[key].text, basis='reported', sender_id=actor, source=EventSource(worldline_id=state.worldline_id, seq=state.head_seq+1))))
    elif kind == 'observe':
        pass  # Observation supplies perception; it does not grant global knowledge.
    if reason:
        effects, recipients = [], [actor]
    for recipient in recipients:
        text = 'rule_rejected' if reason else args.speech if kind == 'speak' else kind
        effects.append(MemoryAppend(entity_id=recipient, before_length=len(state.agents[recipient].memories),
            evidence=Memory(source=EventSource(worldline_id=state.worldline_id, seq=state.head_seq+1), actor_id=actor, action_type=kind,
                basis='own_action' if recipient == actor else 'reported' if kind == 'speak' else 'observed', text=text)))
    effects += [CounterSet(op='clock_advance', before=state.sim_time_tick, after=state.sim_time_tick+1),
                CounterSet(op='scheduler_turn_advance', before=state.scheduler.turn_counter, after=state.scheduler.turn_counter+1),
                CounterSet(op='sequence_advance', before=state.head_seq, after=state.head_seq+1)]
    return Plan(expected_seq=state.head_seq, accepted=reason is None, reason_code=reason, effects=effects)
