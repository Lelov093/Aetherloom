"""Project committed events with their original venue and recorded audience."""
import json

from .domain import RuntimeFault


def records(store, conn, line, first, last):
    if last < first:
        return
    initial = store._read_at(conn, line, first - 1)
    locations = {identity: actor.location for identity, actor in initial.agents.items()}
    candidates = {identity: actor.location for identity, actor in (initial.candidates or {}).items()}
    evidence = {identity: {key: record.model_dump() for key, record in actor.known.items()
                           if record.original or record.premise_id}
                for identity, actor in {**(initial.candidates or {}), **initial.agents}.items()}
    scope = initial.premises
    resolved = {key: record.model_dump() for key, record in scope.resolved.items()} if scope else {}
    unknowns = scope.unknowns if scope else {}
    for row in conn.execute('''SELECT payload FROM runtime_v2_journal
                               WHERE worldline_id=? AND seq BETWEEN ? AND ? ORDER BY seq''', (line, first, last)):
        event = json.loads(row['payload'])
        args = (event.get('command') or {}).get('args') or {}
        action = event['action_type']
        if action == 'trigger':
            jobs = next((effect['before'] for effect in event['effects'] if effect['op'] == 'jobs_set'), [])
            args = next((job['payload'] for job in jobs if job['id'] == args.get('job_id')), {})
        location = locations.get(event.get('actor_id')) or args.get('place_id') or event.get('location_id')
        if event['accepted'] and action == 'speak':
            reference = evidence.get(event['actor_id'], {}).get(args.get('basis_id'), {})
            identity = reference.get('premise_id')
            if reference.get('original'):
                event['expression'] = dict(kind='original', citation=reference['original'], text=reference['text'])
            elif identity in resolved:
                event['expression'] = _premise(identity, resolved[identity], unknowns)
            if identity in unknowns or any('premise:' + key in args.get('share_ids', []) for key in unknowns):
                event['mentions_key_unknown'] = True
        for effect in event['effects']:
            if effect['op'] == 'agent_location_set':
                locations[effect['entity_id']] = effect['after']
                location = location or effect['after']
            elif effect['op'] == 'candidate_join':
                location = candidates[effect['entity_id']]
                locations[effect['entity_id']] = location
            elif effect['op'] == 'knowledge_received':
                record = effect['after']
                if record.get('original') or record.get('premise_id'):
                    evidence[effect['entity_id']][effect['record_id']] = record
            elif effect['op'] == 'premise_set':
                identity = effect['premise_id']
                resolved[identity] = effect['after']
                event['expression'] = _premise(identity, effect['after'], unknowns)
        yield event, args, location


def _premise(identity, resolution, unknowns):
    if identity in unknowns:
        return dict(kind='key_unknown', title=unknowns[identity].title, **resolution)
    return dict(kind='line_past', **resolution)


def message(event, args):
    if not event['accepted']:
        return None
    action = event['action_type']
    if action == 'speak':
        return 'private' if args.get('recipient_id') else 'speech'
    if action == 'resolve_unknown':
        return 'premise'
    if action == 'candidate_invite' or action in ('scene_event', 'trigger') and args.get('audience') is not None:
        return 'directed'
    if action == 'scene_event' or action == 'trigger' and args.get('place_id'):
        return 'scene'
    return None


def protected(event, kind, args):
    return (kind in ('private', 'directed', 'premise')
            or kind == 'scene' and args.get('spoiler') is True
            or kind == 'speech' and (not event.get('command') or event.get('mentions_key_unknown')))


def ruling_effects(event):
    return [effect for effect in event['effects'] if effect['op'] in ('agent_location_set', 'item_holder_set')]


def summary(event, args, location, *, author=True, guarded=False):
    kind = message(event, args)
    memories = {effect['entity_id']: effect['evidence'] for effect in event['effects'] if effect['op'] == 'memory_append'}
    result = {key: event.get(key) for key in ('event_id', 'seq', 'actor_id', 'action_type', 'accepted',
                                            'reason_code', 'sim_time_before', 'sim_time_after')}
    result['location_id'] = location
    if not author:
        return result
    result['kind'] = event.get('kind', 'actor_action')
    if kind:
        result['message_kind'] = kind
    if kind == 'private':
        recipient = args['recipient_id']
        if recipient in memories:
            result['recipient_ids'] = [recipient]
    if kind == 'directed':
        result['recipient_ids'] = list(memories)
    concealed = guarded and protected(event, kind, args)
    if concealed:
        result['concealed'] = True
    elif kind:
        speaker = memories.get(event.get('actor_id')) or next(iter(memories.values()), {})
        result['text'] = speaker.get('text') or args.get('text') or args.get('speech') or args.get('answer') or ''
    if guarded:
        # Free text may repeat a directed message. Keep only committed public
        # dialogue and structural details in the guarded read model.
        result['args'] = {key: args[key] for key in ('actor_id', 'destination_id', 'item_id', 'place_id') if key in args}
    else:
        result['args'] = (event.get('command') or {}).get('args') or {}
        result['reason'] = event.get('reason', '')
        if event.get('observations'):
            result['observations'] = event['observations']
        if event.get('ruling'):
            result['ruling'] = event['ruling']
            result['ruling_effects'] = ruling_effects(event)
        subject = event.get('subject', '')
        if event.get('origin') == 'agent' and subject.startswith(('rules-worker:', 'model-worker:')):
            result['decision_source'] = 'rules' if subject.startswith('rules-worker:') else 'model'
        if event.get('expression'):
            result['expression'] = event['expression']
    result['perceived_by'] = list(memories)
    witnesses = {actor: {key: record[key] for key in ('text', 'channel', 'facts', 'actor_id')}
                 for actor, record in memories.items() if record.get('action_type') == 'event_observation'}
    if witnesses and not concealed:
        result['witnesses'] = witnesses
    return result


def participant_metadata(store, conn, actor, memories, cached):
    """A journal reference is usable only when it came from this actor's memory."""
    wanted = {}
    for record in memories:
        wanted.setdefault(record.source.worldline_id, set()).add(record.source.seq)
    result = {}
    for line, seqs in wanted.items():
        missing = set()
        for seq in seqs:
            key = line, seq
            if key in cached:
                result[key] = cached[key]
            else:
                missing.add(seq)
        if not missing:
            continue
        for event, args, location in records(store, conn, line, min(missing), max(missing)):
            seq = event['seq']
            if seq not in missing:
                continue
            kind = message(event, args)
            meta = {key: event[key] for key in ('accepted', 'reason_code')}
            ruling = event.get('ruling') or {}
            if ruling.get('winner_id') and ruling['winner_id'] != actor:
                meta.update(accepted=False, reason_code='item_contest_lost')
            if kind:
                meta.update(message_kind=kind, location_id=location)
                if kind == 'private' and actor in (event['actor_id'], args['recipient_id']):
                    meta['recipient_ids'] = [args['recipient_id']]
                if kind == 'directed':
                    meta['recipient_ids'] = [actor]
            result[line, seq] = meta
    if len(result) != sum(map(len, wanted.values())):
        raise RuntimeFault('checkpoint_corrupted')
    return result


def reveal(store, conn, line, seq):
    if not 1 <= seq <= store._state(conn, line).head_seq:
        raise RuntimeFault('message_unavailable')
    record = next(records(store, conn, line, seq, seq), None)
    if not record or not protected(record[0], message(record[0], record[1]), record[1]):
        raise RuntimeFault('message_unavailable')
    entry = summary(*record)
    return {key: entry[key] for key in ('event_id', 'seq', 'actor_id', 'location_id', 'message_kind', 'text')}
