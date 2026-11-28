"""Scoped line-only facts, kept separate from what characters say about them."""
from .contracts import Evidence, EventSource, KnowledgeSet, PremiseResolution, PremiseSet


def record_key(identity):
    return 'premise:' + identity


def expression_options(state, actor):
    scope = state.premises
    past = {key: grant.text for key, grant in scope.ordinary.items()
            if actor in grant.witnesses and key not in scope.resolved} if scope else {}
    basis = {key: 'original' if evidence.original else 'premise'
             for key, evidence in state.agents[actor].known.items() if evidence.original or evidence.premise_id}
    return dict(past=past, basis=basis)


def resolve_premise(state, identity, text, people, basis):
    source = EventSource(worldline_id=state.worldline_id, seq=state.head_seq + 1)
    resolution = PremiseResolution(text=text, source=source)
    key = record_key(identity)
    return [PremiseSet(premise_id=identity, after=resolution), *[
        KnowledgeSet(entity_id=actor, record_id=key, before=state.agents[actor].known.get(key),
                     after=Evidence(text=text, source=source, basis=basis, premise_id=identity))
        for actor in people
    ]]


def speech_effects(state, actor, args):
    if args.past_id is not None and args.basis_id is not None:
        return [], 'expression_basis_conflict'
    options = expression_options(state, actor)
    if args.basis_id is not None and args.basis_id not in options['basis']:
        return [], 'expression_basis_unavailable'
    if args.past_id is not None:
        if args.past_id not in options['past']:
            return [], 'ordinary_past_unavailable'
        grant = state.premises.ordinary[args.past_id]
        return resolve_premise(state, args.past_id, grant.text, grant.witnesses, 'experienced'), None
    return [], None


def unknown_effects(state, args):
    from .domain import RuntimeFault
    scope = state.premises
    grant = scope.unknowns.get(args.unknown_id) if scope else None
    if not grant or not grant.may_resolve:
        raise RuntimeFault('key_unknown_unauthorized')
    if args.unknown_id in scope.resolved:
        raise RuntimeFault('key_unknown_already_resolved')
    return resolve_premise(state, args.unknown_id, args.answer.strip(), grant.knowers, 'established')


def validate_scope(state, check_source):
    from .domain import RuntimeFault
    scope = state.premises
    if scope is None:
        return
    if set(scope.ordinary) & set(scope.unknowns) or not set(scope.resolved) <= set(scope.ordinary) | set(scope.unknowns):
        raise RuntimeFault('invalid_story_premises')
    entries = [(key, value.witnesses, value.text, 'experienced', True) for key, value in scope.ordinary.items()]
    entries += [(key, value.knowers, None, 'established', value.may_resolve) for key, value in scope.unknowns.items()]
    for key, people, authored_text, basis, authorized in entries:
        record = scope.resolved.get(key)
        if len(set(people)) != len(people) or not set(people) <= set(state.agents) or (people and not authorized):
            raise RuntimeFault('invalid_story_premises')
        if record is None:
            continue
        if not authorized or (authored_text is not None and record.text != authored_text):
            raise RuntimeFault('invalid_story_premises')
        check_source(record.source)
        expected = Evidence(text=record.text, source=record.source, basis=basis, premise_id=key)
        if any(state.agents[actor].known.get(record_key(key)) != expected for actor in people):
            raise RuntimeFault('invalid_premise_evidence')
