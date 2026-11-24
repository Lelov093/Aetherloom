"""Frozen artifact reading and literal excerpt comparison, never world-truth inference."""
from .contracts import (READING_STATE, Evidence, EventSource, KnowledgeSet, Memory,
                        MemoryAppend, CounterSet, TransitionPlan)
from .domain import RuntimeFault, canonical


def resolve(state, intent):
    if state.state_schema_version != READING_STATE: raise RuntimeFault('reading_worldline_required')
    actor, args = intent.actor_id, intent.typed_args()
    me, reason, record_id, content = state.agents[actor], None, None, None
    preserve_record = False
    if intent.action_type == 'read':
        if state.world.items.get(args.item_id) != actor: reason = 'item_not_owned'
        elif args.item_id not in state.world.item_texts: reason = 'item_text_unavailable'
        else:
            base, content = 'reading:' + args.item_id, state.world.item_texts[args.item_id]
            prior = next((key for key, value in me.known.items() if (key==base or key.startswith(base+':'))
                          and value.basis=='read' and value.text==content),None)
            preserve_record = prior is not None
            record_id = prior or (base if base not in me.known else f'{base}:{len(me.memories)}')
            summary = canonical(dict(item_id=args.item_id, record_id=record_id, result='read_frozen_text'))
    else:
        left, right = me.known.get(args.left_id), me.known.get(args.right_id)
        if not left or not right: reason = 'comparison_source_unavailable'
        elif args.left_id == args.right_id: reason = 'comparison_requires_two_sources'
        elif (not args.left_quote.strip() or not args.right_quote.strip()
              or args.left_quote not in left.text or args.right_quote not in right.text):
            reason = 'comparison_quote_mismatch'
        else:
            record_id = 'comparison:' + str(len(me.memories))
            content = summary = canonical(dict(left_id=args.left_id, left_quote=args.left_quote,
                right_id=args.right_id, right_quote=args.right_quote,
                result='literal_equal' if args.left_quote == args.right_quote else 'literal_different',
                scope='selected_excerpts_only_not_world_truth'))
    source = EventSource(worldline_id=state.worldline_id, seq=state.head_seq+1)
    effects = []
    if reason is None and not preserve_record:
        effects.append(KnowledgeSet(entity_id=actor,record_id=record_id,before=me.known.get(record_id),
            after=Evidence(text=content,basis='read' if intent.action_type=='read' else 'checked',source=source)))
    effects.append(MemoryAppend(entity_id=actor,before_length=len(me.memories),evidence=Memory(
        source=source,actor_id=actor,action_type=intent.action_type,basis='own_action',
        text='rule_rejected' if reason else summary)))
    effects += [CounterSet(op='clock_advance',before=state.sim_time_tick,after=state.sim_time_tick+1),
        CounterSet(op='scheduler_turn_advance',before=state.scheduler.turn_counter,after=state.scheduler.turn_counter+1),
        CounterSet(op='sequence_advance',before=state.head_seq,after=state.head_seq+1)]
    return TransitionPlan(expected_seq=state.head_seq,accepted=reason is None,reason_code=reason,effects=effects)
