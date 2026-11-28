"""Validate declared evidence against the actor's actual source, not free prose."""
import json
import re

from .contracts import PerceivedMemory, READING_STATE
from .domain import RuntimeFault
from .social_models import GroundedEvidence


def quote_options(text):
    """At most two short, literal excerpts; never normalize source characters."""
    result=[]
    for match in re.finditer(r'[^。！？；\n]+[。！？；\n]?',text):
        excerpt=match.group().strip()[:80]
        if excerpt and excerpt not in result:result.append(excerpt)
        if len(result)==2:break
    return result


def observation_view(record):
    """Only an own observe receipt contains a mechanical local snapshot."""
    if record.basis!='own_action' or getattr(record,'action_type',None)!='observe': return None
    try: view=json.loads(record.text)
    except (ValueError,TypeError): return None
    if (not isinstance(view,dict) or not isinstance(view.get('location'),str)
        or not isinstance(view.get('items'),dict) or not isinstance(view.get('people'),dict)):
        return None
    return view


def evidence_type(record):
    if record.basis == 'reported': return 'report'
    if record.basis == 'read': return 'read_text'
    if record.basis == 'checked': return 'text_comparison'
    if record.basis in ('initial', 'experienced'): return 'initial'
    if isinstance(record, PerceivedMemory): return 'event_observation'
    if observation_view(record) is not None: return 'historical_observation'
    return 'subjective' if record.action_type == 'cognition' else 'action_result'


def claims(state, actor, proposed, sources):
    if state.state_schema_version != READING_STATE:
        if proposed: raise RuntimeFault('grounding_worldline_required')
        return []
    if not proposed: raise RuntimeFault('revision_evidence_required')
    available = {f'{s.kind}:{s.key}':s for s in sources}
    result = []
    for claim in proposed:
        source = available.get(claim.ref)
        if source is None: raise RuntimeFault('undeclared_revision_evidence')
        view, record = None, None
        if source.kind == 'perception':
            view, kind = source.source.view, 'current_observation'
        else:
            me = state.agents[actor]
            record = me.known[source.key] if source.kind=='knowledge' else me.memories[int(source.key)]
            kind = evidence_type(record)
            if source.kind=='memory': view=observation_view(record)
        if claim.field == 'text':
            valid = (record is not None and claim.target is None and type(claim.value) is str
                     and bool(claim.value.strip()) and claim.value in record.text)
        elif view is None: valid = False
        elif claim.field == 'location': valid = claim.target is None and claim.value == view['location']
        elif claim.field == 'item_holder':
            valid = claim.target is not None and claim.value == view['items'].get(claim.target)
        else:
            valid = (claim.target is not None and type(claim.value) is bool
                     and claim.value == (claim.target in view['people']))
        if not valid: raise RuntimeFault('evidence_claim_mismatch')
        result.append(GroundedEvidence(**claim.model_dump(),evidence_type=kind))
    return result


def valid_view_ref(state, ref):
    if state.state_schema_version != READING_STATE or not ref.startswith('perception:'): return False
    try:
        line, seq = ref.removeprefix('perception:').rsplit(':',1)
        if not seq.isdecimal(): return False
        limit = state.head_seq if line==state.worldline_id else next(
            (a.seq for a in state.lineage.ancestors if a.worldline_id==line),-1) if state.lineage else -1
        return 0 <= int(seq) <= limit
    except ValueError: return False
