"""Frozen region rules for local state and evidence from committed actions."""

from .contracts import MemoryAppend, PerceivedMemory


def area(state, actor):
    place = state.agents[actor].location
    layout = state.world.perception
    if layout is None:
        return place
    position = layout.positions.get(actor, place)
    return position if layout.zones.get(position, position) == place else place


def _linked(layout, observer, source, channel):
    return any(link.observer == observer and link.source == source and getattr(link, channel)
               for link in layout.links)


def hears_words(state, observer, speaker):
    return area(state, observer) == area(state, speaker)


def _sees(layout, observer, source):
    return observer == source or (layout is not None and _linked(layout, observer, source, 'sight'))


def local_view(state, actor):
    place = state.agents[actor].location
    layout = state.world.perception
    viewpoint = area(state, actor)
    people = {identity: {'location': agent.location} for identity, agent in state.agents.items()
              if _sees(layout, viewpoint, area(state, identity))}
    items = {identity: holder for identity, holder in state.world.items.items()
             if holder in people or (holder in state.world.place_topology and _sees(layout, viewpoint, holder))}
    result = {'location': place, 'exits': list(state.world.place_topology[place]), 'people': people, 'items': items}
    if layout is not None:
        result['area'] = viewpoint
        result['speech_recipients'] = sorted(other for other in state.agents
                                             if other != actor and hears_words(state, other, actor))
    return result


def bystander_evidence(state, actor, kind, args, direct, source):
    layout = state.world.perception
    if layout is None:
        return []
    origin = area(state, actor)
    bystanders = sorted(set(state.agents) - set(direct))
    if kind == 'transfer':
        destination = area(state, args.recipient_id)
        audience = [viewer for viewer in bystanders if _sees(layout, area(state, viewer), origin)
                    and _sees(layout, area(state, viewer), destination)]
        record = PerceivedMemory(source=source, actor_id=actor, channel='sight',
                                 facts={'item_id': args.item_id, 'recipient_id': args.recipient_id},
                                 text=f'看到 {actor} 将 {args.item_id} 交给 {args.recipient_id}。')
    elif kind == 'speak' and args.recipient_id is None:
        audience = [viewer for viewer in bystanders if _linked(layout, area(state, viewer), origin, 'sound')]
        record = PerceivedMemory(source=source, channel='sound', text='听见有人说话。')
    else:
        return []
    return [MemoryAppend(entity_id=viewer, before_length=len(state.agents[viewer].memories), evidence=record)
            for viewer in audience]
