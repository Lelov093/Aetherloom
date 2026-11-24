"""Independent typed Op application; never runs the Resolver or a Provider."""
from copy import deepcopy
from pydantic import ValidationError
from .contracts import (RuntimeAggregate as Aggregate, CommittedTransition as Transition, OPS, STATE, EVENT, ENGINE, RULES, CONTRACT, HASH, SCHEDULER,
    InteractiveTransition, INTERACTIVE_EVENT, INTERACTIVE_STATE, INTERACTIVE_SCHEDULER, SceneMemory,
    ForkTransition, FORK_EVENT, FORK_STATE, ForkCoreTransition, FORK_CORE_EVENT, FORK_CORE_STATE,
    SocialTransition, SOCIAL_EVENT, SOCIAL_STATE, SOCIAL_STATES, CognitiveTransition, COGNITIVE_EVENT, COGNITIVE_STATE,
    ReadingTransition, READING_STATE, READING_EVENT, COGNITIVE_STATES)
from .domain import RuntimeFault, invariants, state_hash


def apply_effects(state, effects, *, inverse=False):
    result = state.model_copy(deep=True)
    operations = list(reversed(effects)) if inverse else effects
    for effect in operations:
        op = effect.op
        if op == 'agent_location_set':
            owner, attr = result.agents[effect.entity_id], 'location'
        elif op == 'agent_goal_set':
            owner, attr = result.agents[effect.entity_id], 'goal'
        elif op == 'insertion_advance':
            owner, attr = result.scheduler, 'insertion_counter'
        elif op == 'plans_set':
            owner, attr = result.agents[effect.entity_id], 'committed_plans'
        elif op == 'jobs_set':
            owner, attr = result.scheduler, 'pending_jobs'
        elif op == 'social_set':
            owner, attr = result, 'social'
        elif op in ('belief_set', 'environment_set'):
            values = result.agents[effect.entity_id].beliefs if op == 'belief_set' else result.world.environment
            expected, value = (effect.after, effect.before) if inverse else (effect.before, effect.after)
            if values.get(effect.key) != expected: raise RuntimeFault('op_precondition_failed')
            if value is None: values.pop(effect.key, None)
            else: values[effect.key] = value
            continue
        elif op in ('clock_advance', 'scheduler_turn_advance', 'sequence_advance'):
            owner, attr = (result.scheduler, 'turn_counter') if op == 'scheduler_turn_advance' else (result, 'sim_time_tick' if op == 'clock_advance' else 'head_seq')
        elif op == 'item_holder_set':
            expected, value = (effect.after, effect.before) if inverse else (effect.before, effect.after)
            if result.world.items.get(effect.item_id) != expected:
                raise RuntimeFault('op_precondition_failed')
            result.world.items[effect.item_id] = value
            continue
        elif op == 'knowledge_received':
            known = result.agents[effect.entity_id].known
            expected, value = (effect.after, effect.before) if inverse else (effect.before, effect.after)
            if known.get(effect.record_id) != expected:
                raise RuntimeFault('op_precondition_failed')
            if value is None: known.pop(effect.record_id, None)
            else: known[effect.record_id] = value.model_copy(deep=True)
            continue
        elif op == 'memory_append':
            memories = result.agents[effect.entity_id].memories
            if inverse:
                if len(memories) != effect.before_length+1 or memories[-1] != effect.evidence:
                    raise RuntimeFault('op_precondition_failed')
                memories.pop()
            else:
                if len(memories) != effect.before_length:
                    raise RuntimeFault('op_precondition_failed')
                memories.append(effect.evidence.model_copy(deep=True))
            continue
        else:
            raise RuntimeFault('unsupported_event_schema')
        expected, value = (effect.after, effect.before) if inverse else (effect.before, effect.after)
        if getattr(owner, attr) != expected:
            raise RuntimeFault('op_precondition_failed')
        setattr(owner, attr, deepcopy(value))
    invariants(result)
    return result


def apply_transition(state, raw):
    try:
        model = ({READING_EVENT: ReadingTransition, COGNITIVE_EVENT: CognitiveTransition, SOCIAL_EVENT: SocialTransition, INTERACTIVE_EVENT: InteractiveTransition, FORK_EVENT: ForkTransition, FORK_CORE_EVENT: ForkCoreTransition}.get(raw.get('event_schema_version'), Transition)
                 if isinstance(raw, dict) else Transition)
        event = model.model_validate(raw) if isinstance(raw, dict) else raw
    except ValidationError as exc:
        raise RuntimeFault('unsupported_event_schema') from exc
    versions = ((READING_STATE, READING_EVENT, ENGINE, RULES, CONTRACT, HASH, INTERACTIVE_SCHEDULER) if isinstance(event, ReadingTransition) else
                (COGNITIVE_STATE, COGNITIVE_EVENT, ENGINE, RULES, CONTRACT, HASH, INTERACTIVE_SCHEDULER) if isinstance(event, CognitiveTransition) else
                (SOCIAL_STATE, SOCIAL_EVENT, ENGINE, RULES, CONTRACT, HASH, INTERACTIVE_SCHEDULER) if isinstance(event, SocialTransition) else
                (FORK_STATE, FORK_EVENT, ENGINE, RULES, CONTRACT, HASH, INTERACTIVE_SCHEDULER) if isinstance(event, ForkTransition) else
                (INTERACTIVE_STATE, INTERACTIVE_EVENT, ENGINE, RULES, CONTRACT, HASH, INTERACTIVE_SCHEDULER) if isinstance(event, InteractiveTransition) else
                (STATE, EVENT, ENGINE, RULES, CONTRACT, HASH, SCHEDULER))
    if isinstance(event, ForkCoreTransition):
        versions = (FORK_CORE_STATE, FORK_CORE_EVENT, ENGINE, RULES, CONTRACT, HASH, SCHEDULER)
    if state.state_schema_version not in SOCIAL_STATES and any(op.op == 'social_set' for op in event.effects):
        raise RuntimeFault('unsupported_event_schema')
    if state.state_schema_version not in COGNITIVE_STATES and any(op.op == 'belief_set' and op.after is None for op in event.effects):
        raise RuntimeFault('unsupported_event_schema')
    if (event.state_schema_version, event.event_schema_version, event.engine_version, event.ruleset_version, event.action_contract_version,
            event.hash_algorithm_version, event.scheduler_policy_version) != versions or event.state_schema_version != state.state_schema_version:
        raise RuntimeFault('unsupported_event_schema')
    if not isinstance(event, InteractiveTransition) and any(op.op in ('insertion_advance', 'belief_set', 'plans_set', 'environment_set', 'jobs_set') or
        (op.op == 'memory_append' and isinstance(op.evidence, SceneMemory)) for op in event.effects):
        raise RuntimeFault('unsupported_event_schema')
    if (event.world_id != state.world_id or event.worldline_id != state.worldline_id or event.seq != state.head_seq+1 or event.parent_seq != state.head_seq
            or event.before_hash != state_hash(state) or event.sim_time_before != state.sim_time_tick):
        raise RuntimeFault('checkpoint_corrupted')
    result = apply_effects(state, event.effects)
    if result.head_seq != event.seq or result.sim_time_tick != event.sim_time_after or state_hash(result) != event.after_hash:
        raise RuntimeFault('checkpoint_corrupted')
    return result
