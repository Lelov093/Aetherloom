"""Logical scheduling and author observations on committed transitions."""
from .contracts import ActorWait, AttemptRuling, ConflictRuling, WaitingSet


def ready_jobs(state):
    return sorted((job for job in state.scheduler.pending_jobs if job.due_tick <= state.sim_time_tick),
                  key=lambda job: (job.due_tick, job.priority, job.insertion_order))


def actor_ready_tick(state, actor):
    wait = state.agents[actor].waiting
    if wait is not None and wait.until_tick is None:
        return None
    scheduled = state.social.agents[actor].next_tick if state.social else 0
    return max(scheduled, wait.until_tick if wait else 0)


def ready_actors(state, actors):
    eligible = [actor for actor in actors if (tick := actor_ready_tick(state, actor)) is not None and tick <= state.sim_time_tick]
    if state.social:
        from .social import available_actors
        return available_actors(state, eligible)
    return eligible


def social_deadlines(state):
    if state.social:
        for actor, own in state.social.agents.items():
            for plan in own.plans:
                if plan.status == 'active' and plan.due_tick is not None:
                    yield plan.due_tick, (actor,)
            for promise in own.promises.values():
                if promise.status in ('pending', 'accepted'):
                    yield promise.due_tick + 1, (actor, promise.recipient_id)


def next_change(state, actors):
    ticks = [job.due_tick for job in state.scheduler.pending_jobs if job.due_tick > state.sim_time_tick]
    ticks.extend(tick for actor in actors if (tick := actor_ready_tick(state, actor)) is not None and tick > state.sim_time_tick)
    ticks.extend(due for due, _ in social_deadlines(state) if due > state.sim_time_tick)
    return min(ticks, default=None)


def wait_effects(state, intent, plan):
    tick = next((effect.after for effect in plan.effects if effect.op == 'clock_advance'), state.sim_time_tick)
    woken = {effect.entity_id for effect in plan.effects if effect.op == 'memory_append'
             and effect.evidence.basis != 'own_action'}
    for due, people in social_deadlines(state):
        if state.sim_time_tick < due <= tick:
            woken.update(people)
    waiting = {}
    actor = intent.actor_id
    if actor is not None and intent.kind == 'actor_action':
        woken.add(actor)
        if intent.action_type == 'wait' and plan.accepted:
            args = intent.typed_args()
            if args.until_event or args.duration:
                until = state.sim_time_tick + args.duration if args.duration else None
                if until is None or until > tick:
                    waiting[actor] = ActorWait(until_tick=until)
    for identity, agent in state.agents.items():
        old = agent.waiting
        if old and (identity in woken or old.until_tick is not None and old.until_tick <= tick):
            waiting.setdefault(identity, None)
    for identity, after in waiting.items():
        before = state.agents[identity].waiting
        if before != after:
            plan.effects.append(WaitingSet(entity_id=identity, before=before, after=after))


def observations_for(settings, intent, plan):
    if not plan.accepted or not settings.observations:
        return []
    kind, args = intent.action_type, intent.args
    if isinstance(plan.ruling, AttemptRuling):
        action = plan.ruling.attempt.action
        kind, args = action.kind, action.model_dump()
    elif isinstance(plan.ruling, ConflictRuling) and plan.ruling.winner_id:
        kind, args = 'take', {'item_id': plan.ruling.conflict.detail.item_id}
    if kind == 'trigger':
        kind, identity = 'scheduled', args.get('job_id')
    else:
        identity = args.get('destination_id' if kind == 'move' else 'item_id')
    return [condition for condition in settings.observations if condition.event == kind and condition.target_id == identity]


def observation_targets(state):
    return {'scheduled': {job.id for job in state.scheduler.pending_jobs}, 'move': state.world.place_topology,
            'take': state.world.items, 'transfer': state.world.items, 'read': state.world.item_texts or {}}


def counts_for_segment(intent, plan):
    return (intent.kind in ('actor_action', 'cognition') or intent.action_type in ('trigger', 'scene_event', 'attempt_action')
            or isinstance(plan.ruling, ConflictRuling) and plan.ruling.winner_id is not None)
