"""Pure social transitions and authorized views; no provider, narrator or I/O."""
from .contracts import SocialSet, CounterSet, COGNITIVE_STATES
from .social_models import Conversation, Promise, CitedAppraisal, CitedReflection
from .domain import RuntimeFault


def refs_for(agent, state=None, own=None):
    refs = {'knowledge:' + key for key in agent.known} | {'memory:' + str(i) for i in range(len(agent.memories))}
    if state is not None and own.cognition:
        from .grounding import valid_view_ref
        groups = list(own.cognition.beliefs.values()) + own.cognition.changes + list(own.appraisals.values()) + own.reflections
        refs |= {r for item in groups for r in item.refs if valid_view_ref(state,r)}
    return refs


def validate(state):
    social = state.social
    if not social: raise RuntimeFault('social_state_required')
    if (state.state_schema_version in COGNITIVE_STATES) != (social.contract_version == 'social-domain-v2'):
        raise RuntimeFault('invalid_cognitive_schema')
    if set(social.agents) != set(state.agents): raise RuntimeFault('invalid_social_actors')
    for actor, own in social.agents.items():
        refs = refs_for(state.agents[actor],state,own)
        from .cognitive import validate as validate_cognitive
        validate_cognitive(state,actor,own,refs)
        if state.state_schema_version not in COGNITIVE_STATES and any(p.status == 'blocked' for p in own.plans):
            raise RuntimeFault('invalid_cognitive_schema')
        if own.last_decision > social.decision_counter or len(own.appraisals) > len(state.agents) or len(own.promises) > 64:
            raise RuntimeFault('invalid_social_state')
        for judgment in own.appraisals.values():
            if judgment.target_id not in state.agents or judgment.target_id == actor or not set(judgment.refs) <= refs:
                raise RuntimeFault('invalid_social_evidence')
        for reflection in own.reflections:
            if not reflection.refs or not set(reflection.refs) <= refs: raise RuntimeFault('invalid_social_evidence')
        for p in own.plans:
            if p.target_id is not None and p.target_id not in state.agents: raise RuntimeFault('invalid_plan_target')
        for key, p in own.promises.items():
            if key != actor + ':' + p.id or p.recipient_id not in state.agents or p.recipient_id == actor or p.source_ref not in refs:
                raise RuntimeFault('invalid_promise')
    for key, c in social.conversations.items():
        if (key != c.id or len(c.participants) != 2 or len(set(c.participants)) != 2
            or not set(c.participants) <= set(state.agents) or c.awaiting not in c.participants + [None]):
            raise RuntimeFault('invalid_conversation')
        for actor, ref in c.refs.items():
            if actor not in c.participants or ref not in refs_for(state.agents[actor]): raise RuntimeFault('invalid_social_evidence')


def available_actors(state, actors):
    """Oldest activated actor wins; cognition yields without changing world time."""
    eligible = [a for a in actors if state.social.agents[a].next_tick <= state.sim_time_tick]
    return sorted(eligible, key=lambda a: (state.social.agents[a].last_decision, state.scheduler.ready_actor_order.index(a)))


def view(state, actor, *, include_history=True):
    own = state.social.agents[actor].model_dump()
    if not include_history and own.get('cognition'):
        own['cognition'].pop('changes',None)  # Retired beliefs must not look current to the model.
    conversations = [c.model_dump() for c in state.social.conversations.values() if actor in c.participants]
    for c in conversations:
        c['refs'] = {actor: c['refs'][actor]} if actor in c['refs'] else {}
    incoming = {}
    for sender, agent in state.social.agents.items():
        for key, p in agent.promises.items():
            if p.recipient_id == actor:
                value = p.model_dump(exclude={'source_ref', 'accepted_ref'})
                value['sender_id'] = sender
                incoming[key] = value
    return {'own': own, 'conversations': conversations, 'incoming_promises': incoming}


def augment(state, intent, plan):
    """Append one versioned before/after social effect to the existing atomic plan."""
    social = state.social.model_copy(deep=True)
    actor = intent.actor_id
    tick = state.sim_time_tick + int(any(e.op == 'clock_advance' for e in plan.effects))
    args = intent.typed_args()
    def wake(who, reason):
        a = social.agents[who]
        a.next_tick = min(a.next_tick, tick)
        a.wake_reasons = list(dict.fromkeys(a.wake_reasons + [reason]))[-8:]
    if actor:
        me = social.agents[actor]
        social.decision_counter += 1
        me.last_decision = social.decision_counter
        me.wake_reasons = []
        me.next_tick = tick + (social.routine_interval if intent.action_type == 'wait' else 1)
    if intent.kind == 'cognition':
        if args.social:
            refs = [f'{ref.kind}:{ref.key}' for ref in args.sources]
            visible = {a for a, agent in state.agents.items() if agent.location == state.agents[actor].location}
            known_targets = visible | set(me.appraisals) | {p.target_id for p in me.plans}
            if any(p.target_id is not None and p.target_id not in known_targets for p in args.social.plans):
                raise RuntimeFault('unknown_social_target')
            if len({p.id for p in args.social.plans}) != len(args.social.plans): raise RuntimeFault('duplicate_plan')
            if state.state_schema_version not in COGNITIVE_STATES:
                if any(p.status == 'blocked' for p in args.social.plans): raise RuntimeFault('cognitive_worldline_required')
                me.plans = args.social.plans
            for judgment in args.social.appraisals:
                if judgment.target_id == actor or judgment.target_id not in known_targets: raise RuntimeFault('unknown_social_target')
                me.appraisals[judgment.target_id] = CitedAppraisal(**judgment.model_dump(), refs=refs, updated_tick=tick)
            if args.social.reflection:
                me.reflections = (me.reflections + [CitedReflection(**args.social.reflection.model_dump(), refs=refs, updated_tick=tick)])[-8:]
                for effect in plan.effects:
                    if effect.op == 'memory_append' and effect.entity_id == actor:
                        effect.evidence.text = '主观反思（不等于事实）：' + args.social.reflection.text
        if state.state_schema_version in COGNITIVE_STATES:
            from .cognitive import revise
            visible = {a for a, agent in state.agents.items() if agent.location == state.agents[actor].location}
            known_targets = visible | set(me.appraisals) | {p.target_id for p in me.plans}
            revise(state,actor,args,me,plan.effects,known_targets)
        # Separate from scheduler_turn_counter: a zero-time decision still yields.
    if plan.accepted and intent.action_type == 'speak':
        meta, recipient = args.social, args.recipient_id
        if meta and not recipient and (meta.conversation_id or meta.turn != 'continue' or meta.promise or meta.accept_promise):
            raise RuntimeFault('social_recipient_required')
        if recipient:
            conv = social.conversations.get(meta.conversation_id) if meta and meta.conversation_id else next(
                (c for c in social.conversations.values() if c.status == 'open' and set(c.participants) == {actor, recipient}), None)
            if meta and meta.conversation_id and (not conv or set(conv.participants) != {actor, recipient} or conv.status != 'open'):
                raise RuntimeFault('conversation_unavailable')
            if conv and conv.awaiting not in (actor, None): raise RuntimeFault('awaiting_other_speaker')
            if not conv:
                # Ended dialogues stay in Journal/memories, not an unbounded live registry.
                if len(social.conversations) >= 64:
                    old = next((k for k, c in social.conversations.items() if c.status != 'open'), None)
                    if old is None: raise RuntimeFault('conversation_limit')
                    del social.conversations[old]
                cid = f'conversation:{state.worldline_id}:{state.head_seq + 1}'
                conv = Conversation(id=cid, participants=[actor, recipient], awaiting=recipient, last_tick=tick)
                social.conversations[cid] = conv
            conv.last_tick, conv.awaiting = tick, recipient
            for who in (actor, recipient): conv.refs[who] = 'memory:' + str(len(state.agents[who].memories))
            if meta and meta.turn != 'continue':
                conv.status, conv.awaiting = ('declined' if meta.turn == 'decline' else 'ended'), None
            if meta and meta.promise:
                p = meta.promise
                key = actor + ':' + p.id
                if key in me.promises or len(me.promises) >= 64 or p.due_tick < tick: raise RuntimeFault('invalid_promise')
                local=state.agents[actor].location
                if (p.kind == 'transfer' and (state.world.items.get(p.item_id) != actor or p.place_id is not None)
                    or p.kind == 'meet' and (p.place_id not in [local,*state.world.place_topology[local]] or p.item_id is not None)):
                    raise RuntimeFault('invalid_promise_target')
                me.promises[key] = Promise(**p.model_dump(), recipient_id=recipient, source_ref=conv.refs[actor])
            if meta and meta.accept_promise:
                promise = social.agents[recipient].promises.get(meta.accept_promise)
                if not promise or promise.recipient_id != actor or promise.status not in ('pending', 'overdue'):
                    raise RuntimeFault('promise_unavailable')
                promise.accepted_ref = conv.refs[actor]
                promise.status = 'declined' if meta.turn == 'decline' else 'accepted'
    if plan.accepted:
        for effect in plan.effects:
            if effect.op == 'memory_append' and effect.entity_id != actor: wake(effect.entity_id, 'received_experience')
            if effect.op == 'agent_location_set':
                for c in social.conversations.values():
                    if effect.entity_id in c.participants and c.status == 'open':
                        c.status, c.awaiting = 'left', None
                for who, person in state.agents.items():
                    if who != effect.entity_id and person.location in (effect.before, effect.after): wake(who, 'local_presence_changed')
            if effect.op == 'environment_set' and effect.before != effect.after:
                for who in social.agents:
                    wake(who, 'environment_changed')
            for owner, agent in social.agents.items():
                for p in agent.promises.values():
                    if p.status in ('fulfilled', 'fulfilled_late', 'declined'): continue
                    fulfilled = (p.kind == 'transfer' and effect.op == 'item_holder_set' and effect.item_id == p.item_id
                                 and effect.before == owner and effect.after == p.recipient_id)
                    # A meeting is fulfilled by actual co-present communication, not by declaring success.
                    fulfilled |= (p.kind == 'meet' and intent.action_type == 'speak' and actor in (owner, p.recipient_id)
                                  and args.recipient_id in (owner, p.recipient_id) and state.agents[actor].location == p.place_id)
                    if fulfilled: p.status = 'fulfilled' if tick <= p.due_tick else 'fulfilled_late'
                    elif tick > p.due_tick and p.status != 'overdue':
                        p.status = 'overdue'
                        wake(owner, 'promise_due'); wake(p.recipient_id, 'promise_due')
    for who, agent in social.agents.items():
        for promise in agent.promises.values():
            if promise.status in ('pending','accepted') and tick > promise.due_tick:
                promise.status='overdue';wake(who,'promise_due');wake(promise.recipient_id,'promise_due')
        for p in agent.plans:
            if (p.status == 'active' and p.due_tick is not None
                and state.sim_time_tick < p.due_tick <= tick):
                wake(who, 'plan_due')
        due = [p.due_tick for p in agent.plans if p.status == 'active' and p.due_tick is not None and p.due_tick > tick]
        due += [p.due_tick + 1 for p in agent.promises.values() if p.status in ('pending', 'accepted') and p.due_tick >= tick]
        if due: agent.next_tick = min(agent.next_tick, min(due))
    if state.state_schema_version in COGNITIVE_STATES:
        from .cognitive import experiences
        experiences(state,intent,plan,social,wake)
    plan.effects.append(SocialSet(before=state.social, after=social))
    return plan
