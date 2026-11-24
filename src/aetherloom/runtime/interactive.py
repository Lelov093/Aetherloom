"""Versioned I4 pure rules: cognition, Creator interventions and deterministic jobs."""
from .contracts import INTERACTIVE_STATES
from .contracts import COGNITIVE_STATES, READING_STATE, ObservationSource
from .contracts import (ActionIntent, CommandIntent, ScheduledJob, EnvironmentArgs, SceneEventArgs,
    TransitionPlan, BeliefSet, PlansSet, EnvironmentSet, JobsSet, LocationSet,
    CounterSet, MemoryAppend, Memory, SceneMemory, EventSource, INTERACTIVE_STATE)
from .domain import RuntimeFault, canonical, resolve

ZERO_LIMIT = 16
JOBS_PER_TICK = 8


def perception(state, actor):
    place = state.agents[actor].location
    people = {key: {'location': value.location} for key, value in state.agents.items() if value.location == place}
    return {'location': place, 'exits': list(state.world.place_topology[place]), 'people': people,
            'items': {key: holder for key, holder in state.world.items.items() if holder == place or holder in people}}


def validate_job(state, job):
    if not isinstance(job, ScheduledJob): raise RuntimeFault('unsupported_scheduled_job')
    if job.kind == 'environment': EnvironmentArgs.model_validate(job.payload)
    else:
        args = SceneEventArgs.model_validate(job.payload)
        if args.place_id not in state.world.place_topology: raise RuntimeFault('invalid_event_place')
        if args.audience is not None and (not state.social or not args.audience or not set(args.audience) <= set(state.agents)):
            raise RuntimeFault('invalid_event_audience')


def cognition_sources(state, actor, args):
    me = state.agents[actor]
    for ref in args.sources:
        if ref.kind == 'perception':
            expected = ObservationSource(worldline_id=state.worldline_id,seq=state.head_seq,view=perception(state,actor))
            if (state.state_schema_version != READING_STATE or ref.key != f'{state.worldline_id}:{state.head_seq}'
                or ref.source != expected): raise RuntimeFault('unauthorized_cognition_source')
            continue
        record = me.known.get(ref.key) if ref.kind == 'knowledge' else (
            me.memories[int(ref.key)] if ref.key.isdecimal() and int(ref.key) < len(me.memories) else None)
        if record is None or record.source != ref.source: raise RuntimeFault('unauthorized_cognition_source')
    if any(not key.strip() or not value.strip() or len(key) > 120 or len(value) > 1500 for key, value in args.beliefs.items()):
        raise RuntimeFault('invalid_cognition_value')
    if any(not value.strip() or len(value) > 1000 for value in args.plans): raise RuntimeFault('invalid_cognition_value')


def scene_effects(state, place, text, *, kind='scene_event', audience=None):
    return [MemoryAppend(entity_id=actor, before_length=len(agent.memories), evidence=SceneMemory(
        source=EventSource(worldline_id=state.worldline_id, seq=state.head_seq + 1), action_type=kind, text=text))
        for actor, agent in sorted(state.agents.items()) if agent.location == place and (audience is None or actor in audience)]


def resolve_interactive(state, intent):
    args = intent.typed_args()
    if getattr(args, 'social', None) is not None and not state.social:
        raise RuntimeFault('social_worldline_required')
    plan = resolve_base(state, intent)
    if state.social:
        from .social import augment
        return augment(state, intent, plan)
    return plan


def resolve_base(state, intent):
    if isinstance(intent, ActionIntent):
        plan = resolve(state, intent)
        if state.state_schema_version in INTERACTIVE_STATES and intent.action_type == 'observe' and plan.accepted:
            for op in plan.effects:
                if op.op == 'memory_append': op.evidence.text = canonical(perception(state, intent.actor_id))
        return plan
    if state.state_schema_version not in INTERACTIVE_STATES: raise RuntimeFault('interactive_worldline_required')
    if state.head_seq >= state.max_domain_steps: raise RuntimeFault('domain_limit_reached')
    args = intent.typed_args()
    effects, quantum = [], 0
    if intent.kind == 'cognition':
        if intent.action_type != 'cognition' or intent.actor_id not in state.agents: raise RuntimeFault('invalid_actor')
        cognition_sources(state, intent.actor_id, args)
        me = state.agents[intent.actor_id]
        if state.state_schema_version in COGNITIVE_STATES:
            effects = []  # Explicit patches and their explanations are resolved together below.
        else:
            if args.social and (args.social.belief_updates or args.social.plan_updates):
                raise RuntimeFault('cognitive_worldline_required')
            effects = [BeliefSet(entity_id=intent.actor_id, key=key, before=me.beliefs.get(key), after=value, sources=args.sources)
                       for key, value in args.beliefs.items()]
            effects.append(PlansSet(entity_id=intent.actor_id, before=me.committed_plans, after=args.plans, sources=args.sources))
        effects += [MemoryAppend(entity_id=intent.actor_id, before_length=len(me.memories), evidence=Memory(
                        source=EventSource(worldline_id=state.worldline_id, seq=state.head_seq + 1), actor_id=intent.actor_id,
                        action_type='cognition', basis='own_action', text='provisional belief/plan revision'))]
    elif intent.kind == 'creator_intervention':
        if not intent.reason.strip() or intent.actor_id is not None: raise RuntimeFault('intervention_reason_required')
        if intent.action_type == 'environment':
            effects = [EnvironmentSet(key=args.key, before=state.world.environment.get(args.key), after=args.value)]
        elif intent.action_type == 'relocate':
            if args.actor_id not in state.agents or args.destination_id not in state.world.place_topology: raise RuntimeFault('invalid_scene_target')
            agent = state.agents[args.actor_id]
            effects = [LocationSet(entity_id=args.actor_id, before=agent.location, after=args.destination_id),
                MemoryAppend(entity_id=args.actor_id, before_length=len(agent.memories), evidence=SceneMemory(
                    source=EventSource(worldline_id=state.worldline_id, seq=state.head_seq + 1), action_type='scene_adjustment',
                    text='场景调整：' + args.destination_id))]
        elif intent.action_type == 'scene_event':
            if args.place_id not in state.world.place_topology: raise RuntimeFault('invalid_event_place')
            if args.audience is not None and (not state.social or not args.audience or not set(args.audience) <= set(state.agents)):
                raise RuntimeFault('invalid_event_audience')
            effects, quantum = scene_effects(state, args.place_id, args.text, audience=args.audience), 1
        elif intent.action_type == 'schedule':
            job = args.job
            validate_job(state, job)
            if (len(state.scheduler.pending_jobs) >= 64 or any(j.id == job.id for j in state.scheduler.pending_jobs)
                or job.insertion_order != state.scheduler.insertion_counter or job.due_tick < state.sim_time_tick):
                raise RuntimeFault('invalid_scheduled_job')
            effects = [JobsSet(before=state.scheduler.pending_jobs, after=state.scheduler.pending_jobs + [job]),
                       CounterSet(op='insertion_advance', before=state.scheduler.insertion_counter, after=state.scheduler.insertion_counter + 1)]
        else: raise RuntimeFault('unsupported_command')
    elif intent.kind == 'scheduled_event':
        if intent.action_type == 'advance_idle':
            if not state.social or intent.actor_id is not None or not set(args.actors) <= set(state.agents):
                raise RuntimeFault('invalid_idle_advance')
            from .social import available_actors
            if available_actors(state,args.actors) or any(j.due_tick<=state.sim_time_tick for j in state.scheduler.pending_jobs):
                raise RuntimeFault('idle_advance_not_ready')
            return TransitionPlan(expected_seq=state.head_seq,accepted=True,reason_code=None,effects=[
                CounterSet(op='clock_advance',before=state.sim_time_tick,after=state.sim_time_tick+1),
                CounterSet(op='sequence_advance',before=state.head_seq,after=state.head_seq+1)])
        if intent.action_type != 'trigger' or intent.actor_id is not None: raise RuntimeFault('unsupported_command')
        ready = sorted((job for job in state.scheduler.pending_jobs if job.due_tick <= state.sim_time_tick),
                       key=lambda job: (job.due_tick, job.priority, job.insertion_order))
        if not ready or ready[0].id != args.job_id: raise RuntimeFault('scheduled_job_not_ready')
        job = ready[0]
        validate_job(state, job)
        effects = [JobsSet(before=state.scheduler.pending_jobs, after=[j for j in state.scheduler.pending_jobs if j.id != job.id])]
        if job.kind == 'environment':
            payload = EnvironmentArgs.model_validate(job.payload)
            effects += [EnvironmentSet(key=payload.key, before=state.world.environment.get(payload.key), after=payload.value)]
        else:
            payload = SceneEventArgs.model_validate(job.payload)
            effects += scene_effects(state, payload.place_id, payload.text, audience=payload.audience)
        # A due job runs at the already-reached tick; it does not secretly advance time.
    else: raise RuntimeFault('unsupported_command')
    if quantum: effects += [CounterSet(op='clock_advance', before=state.sim_time_tick, after=state.sim_time_tick + quantum)]
    effects += [CounterSet(op='sequence_advance', before=state.head_seq, after=state.head_seq + 1)]
    return TransitionPlan(expected_seq=state.head_seq, accepted=True, reason_code=None, effects=effects)
