"""Author attempts and conflicting claims use the existing action resolver."""
from .contracts import (ActionIntent, AttemptRuling, ConflictRuling, CounterSet, EventSource,
    INTERACTIVE_STATES, ItemClaim, ItemContention, Memory, MemoryAppend, PendingConflict,
    PendingConflictSet, TransitionPlan, TakeAttempt)
from .domain import RuntimeFault, digest


def action_plan(state, command, actor, action):
    from .interactive import resolve_interactive
    intent = ActionIntent(world_id=state.world_id, worldline_id=state.worldline_id, actor_id=actor,
        request_id=command.request_id, expected_seq=command.expected_seq, execution_epoch=command.execution_epoch,
        action_type=action.kind, args=action.model_dump(exclude={'kind'}))
    # The inner resolve evaluates what could happen. The author owns the outer journal entry.
    return resolve_interactive(state, intent, adjudicating=True)


def metadata_step(state, ruling, effects=(), *, blocker=None):
    return TransitionPlan(expected_seq=state.head_seq, accepted=blocker is None, reason_code=blocker,
        effects=[*effects, CounterSet(op='sequence_advance', before=state.head_seq, after=state.head_seq + 1)], ruling=ruling)


def hold(state, conflict):
    if state.head_seq + 1 >= state.max_domain_steps:
        raise RuntimeFault('domain_limit_reached')
    return metadata_step(state, ConflictRuling(conflict=conflict, result='pending'),
                         [PendingConflictSet(before=None, after=conflict)])


def settle_claims(state, command, conflict, eligible, method, winner=None):
    detail = conflict.detail
    index = None
    if method == 'draw':
        # Anchor a local draw to this frozen contest, including a sorted roster.
        # The journal stores the index and winner. Replay applies effects directly.
        anchor = dict(worldline_id=conflict.source.worldline_id, seq=conflict.source.seq,
                      item_id=detail.item_id, actors=eligible)
        index = int(digest(anchor).split(':')[1], 16) % len(eligible)
        winner = eligible[index]
    plan = action_plan(state, command, winner, TakeAttempt(kind='take', item_id=detail.item_id))
    if not plan.accepted:
        raise RuntimeFault('conflict_state_changed')
    plan.ruling = ConflictRuling(conflict=conflict, result=method, winner_id=winner, draw_index=index)
    source = EventSource(worldline_id=state.worldline_id, seq=state.head_seq + 1)
    for actor in eligible:
        if actor != winner:
            plan.effects.append(MemoryAppend(entity_id=actor, before_length=len(state.agents[actor].memories),
                evidence=Memory(source=source, actor_id=actor, action_type='take', basis='own_action',
                                text='本次同时争用，未能取得物品。')))
    if state.pending_conflict:
        plan.effects.append(PendingConflictSet(before=state.pending_conflict, after=None))
    return plan


def resolve_adjudication(state, intent, args):
    if state.state_schema_version not in INTERACTIVE_STATES:
        raise RuntimeFault('interactive_worldline_required')
    if state.head_seq >= state.max_domain_steps:
        raise RuntimeFault('domain_limit_reached')
    if not intent.reason.strip() or intent.actor_id is not None:
        raise RuntimeFault('intervention_reason_required')

    kind = intent.action_type
    if kind == 'attempt_action':
        plan = action_plan(state, intent, args.actor_id, args.action)
        required = [rule.item_id for rule in state.world.access_rules
                    if args.action.kind == 'move' and rule.destination_id == args.action.destination_id]
        plan.ruling = AttemptRuling(attempt=args, location_id=state.agents[args.actor_id].location,
                                   required_items=list(dict.fromkeys(required)))
        return plan

    if kind == 'resolve_conflict':
        conflict = state.pending_conflict
        if conflict is None:
            raise RuntimeFault('conflict_unavailable')
        if args.method == 'cancel' and args.actor_id is None:
            return metadata_step(state, ConflictRuling(conflict=conflict, result='cancelled'),
                                 [PendingConflictSet(before=conflict, after=None)])
        if conflict.detail.kind == 'consequence':
            raise RuntimeFault('consequence_rule_unavailable')
        eligible = [claim.actor_id for claim in conflict.detail.claims if claim.blocker is None]
        if args.method == 'choose' and args.actor_id in eligible:
            return settle_claims(state, intent, conflict, eligible, 'chosen', args.actor_id)
        if args.method == 'draw' and args.actor_id is None:
            return settle_claims(state, intent, conflict, eligible, 'draw')
        raise RuntimeFault('invalid_conflict_choice')

    source = EventSource(worldline_id=state.worldline_id, seq=state.head_seq + 1)
    if kind == 'hold_consequence':
        return hold(state, PendingConflict(source=source, detail=args))

    if args.item_id not in state.world.items or len(set(args.actors)) != len(args.actors) or not set(args.actors) <= set(state.agents):
        raise RuntimeFault('invalid_item_conflict')
    take = TakeAttempt(kind='take', item_id=args.item_id)
    claims = [ItemClaim(actor_id=actor, blocker=action_plan(state, intent, actor, take).reason_code)
              for actor in sorted(args.actors)]
    detail = ItemContention(item_id=args.item_id, holder_id=state.world.items[args.item_id], claims=claims)
    conflict = PendingConflict(source=source, detail=detail)
    eligible = [claim.actor_id for claim in claims if claim.blocker is None]
    if not eligible:
        return metadata_step(state, ConflictRuling(conflict=conflict, result='blocked'), blocker='no_eligible_claimants')
    if len(eligible) == 1:
        return settle_claims(state, intent, conflict, eligible, 'rules', eligible[0])
    if args.critical:
        return hold(state, conflict)
    return settle_claims(state, intent, conflict, eligible, 'draw')
