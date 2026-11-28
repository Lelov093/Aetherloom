"""Participant projection is computed on the server, never cropped by a renderer."""
from copy import deepcopy

from .interactive import perception
from .contracts import PerceivedMemory, READING_STATE


def participant_view(state, actor, opaque, event_meta):
    local = perception(state, actor)
    me = state.agents[actor]
    own = me.model_dump()
    for record in own['known'].values():
        record['source'] = {'reference': opaque(record['source'])}
        record.pop('original', None)
    for memory in own['memories']: memory['source'] = {'reference': opaque(memory['source'])}
    own['cooldowns'] = {}  # internal counters do not become a clock side channel
    if state.social:
        from .social import view
        social = view(state,actor)
        def redact(value):
            if isinstance(value,str) and value.startswith('perception:'):
                return 'perception:' + opaque({'observation':value})
            if isinstance(value,list): return [redact(v) for v in value]
            if isinstance(value,dict): return {k:redact(v) for k,v in value.items()
                if k not in ('updated_tick','last_tick','due_tick','next_tick','last_decision','wake_reasons')}
            return value
        social = redact(social)
        for conversation in social['conversations']:
            conversation['id'] = opaque({'conversation':conversation['id']})
        own['social'] = social
    # A remembered observation may contain only the local facts authorized at that time.
    # Its Source becomes an opaque reference above, never a global event sequence.
    agents = deepcopy(local['people'])
    agents[actor] = own
    events = []
    for memory in me.memories[-50:]:
        source = memory.source.model_dump()
        meta = event_meta[memory.source.worldline_id, memory.source.seq]
        event = dict(event_id=opaque(source), actor_id=memory.actor_id, action_type=memory.action_type,
                     accepted=meta['accepted'], reason_code=meta['reason_code'], text=memory.text)
        if isinstance(memory, PerceivedMemory):
            event.update(channel=memory.channel, facts=memory.facts)
        else:
            event.update({key: meta[key] for key in ('message_kind', 'location_id', 'recipient_ids') if key in meta})
        events.append(event)
    world = {'place_topology': {local['location']: local['exits']}, 'items': local['items'],
             'access_rules': [], 'environment': {}}
    if state.world.perception is not None:
        world.update(area=local['area'], speech_recipients=local['speech_recipients'])
    if state.state_schema_version == READING_STATE:
        world['readable_items'] = sorted(i for i in state.world.item_texts if state.world.items[i]==actor)
    return world, agents, events
