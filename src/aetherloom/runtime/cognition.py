"""Authorized evidence retrieval and rebuildable, non-authoritative local index."""
from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass
import json
import re
from threading import RLock

from .contracts import CognitionSource, ObservationSource, PerceivedMemory, READING_STATE
from .domain import RuntimeFault, canonical
from .interactive import perception


@dataclass
class AgentContext:
    world_id: str
    worldline_id: str
    actor_id: str
    watermark: int
    body: dict
    sources: dict
    cache_status: str
    index_refs: frozenset[str]


class MemoryIndex:
    """Disposable cache of reference IDs only; refresh is idempotent and scope-bound.

    The Worker refreshes after a committed result outside the domain transaction.
    Restart/loss/stale/future cache falls back to the authoritative authorized records.
    """
    def __init__(self, capacity=256):
        self.entries, self.capacity, self.lock = OrderedDict(), capacity, RLock()

    def refresh(self, context):
        key = (context.worldline_id, context.actor_id, 'memory-index-v1')
        with self.lock:
            current = self.entries.get(key)
            if current and current[0] == context.watermark: return
            self.entries[key] = (context.watermark, context.index_refs)
            self.entries.move_to_end(key)
            while len(self.entries) > self.capacity: self.entries.popitem(last=False)

    def candidates(self, worldline, actor, watermark):
        with self.lock:
            cached = self.entries.get((worldline, actor, 'memory-index-v1'))
            return cached[1] if cached and cached[0] == watermark else None


def required_message_refs(body):
    """Only this actor's latest incoming message in a live, awaiting dialogue."""
    if 'reading' not in body:return set()
    actor=body['identity'];refs=set()
    for conversation in body.get('social',{}).get('conversations',[]):
        if conversation['status']!='open' or conversation['awaiting']!=actor:continue
        ref=conversation.get('refs',{}).get(actor)
        if not ref:raise RuntimeFault('conversation_context_unavailable')
        refs.add(ref)
    return refs


def required_decision_refs(body):
    refs = required_message_refs(body)
    own = body.get('decision_focus', {}).get('last_own_ref') if 'reading' in body else None
    return refs | ({own} if own else set())


def build_context(state, actor, *, strategy='recent12', query='', index=None, budget_chars=12000, profile=None):
    if actor not in state.agents: raise RuntimeFault('invalid_actor')
    if strategy not in ('recent12', 'retrieval'): raise RuntimeFault('unsupported_memory_strategy')
    agent = state.agents[actor]
    sources = {}
    knowledge = {}
    for key, evidence in agent.known.items():
        ref = 'knowledge:' + key
        sources[ref] = CognitionSource(kind='knowledge', key=key, source=evidence.source).model_dump()
        knowledge[key] = {'text': evidence.text, 'basis': evidence.basis, 'sender_id': evidence.sender_id,
                          'source_ref': ref, 'share_id': key}
        if state.state_schema_version == READING_STATE:
            from .grounding import evidence_type
            knowledge[key]['evidence_type'] = evidence_type(evidence)
    records = []
    for i, memory in enumerate(agent.memories):
        ref = 'memory:' + str(i)
        sources[ref] = CognitionSource(kind='memory', key=str(i), source=memory.source).model_dump()
        records.append({'ref': ref, 'text': memory.text, 'basis': memory.basis, 'action_type': memory.action_type, 'actor_id': memory.actor_id})
        if isinstance(memory, PerceivedMemory):
            records[-1].update(channel=memory.channel, facts=memory.facts, evidence_type='event_observation')
        if state.state_schema_version == READING_STATE:
            from .grounding import evidence_type
            records[-1]['evidence_type'] = evidence_type(memory)
    body = {'identity': actor, 'goal': agent.goal, 'beliefs': deepcopy(agent.beliefs), 'plans': list(agent.committed_plans),
            'knowledge': knowledge, 'perception': perception(state, actor), 'experiences': []}
    if state.state_schema_version == READING_STATE:
        key = f'{state.worldline_id}:{state.head_seq}'
        body['perception_ref'] = 'perception:' + key
        sources[body['perception_ref']] = CognitionSource(kind='perception',key=key,
            source=ObservationSource(worldline_id=state.worldline_id,seq=state.head_seq,view=body['perception'])).model_dump()
        body['reading'] = dict(readable_items=sorted(item for item in state.world.item_texts if state.world.items[item]==actor),
                               comparison_sources=sorted(knowledge))
    body['action_options'] = action_options(body)
    from .premises import expression_options
    expression = expression_options(state, actor)
    if expression['past'] or expression['basis']:
        body['expression'] = expression
    if profile is not None: body['profile'] = deepcopy(profile)
    if state.social:
        from .social import view
        body['social'] = view(state, actor, include_history=False)
        body['logical_tick'] = state.sim_time_tick
    reading = state.state_schema_version == READING_STATE
    incoming = required_message_refs(body)
    pending = body.get('social', {}).get('own', {}).get('cognition', {}).get('pending', [])
    turn_words = set()
    if reading:
        own_records = {r['ref']:r for r in records if r['actor_id'] == actor and r['basis'] == 'own_action'}
        own = next(reversed(own_records.values()), None)
        failed = next((e for e in reversed(pending) if not e['accepted'] and e['ref'] in own_records), None)
        # Protect the local interaction, not every past decision. With no live
        # message, the latest unresolved rejection still deserves its feedback.
        own_ref = own['ref'] if incoming and own else failed['ref'] if failed else None
        body['decision_focus'] = dict(incoming_refs=sorted(incoming), last_own_ref=own_ref)
        body.pop('plans')  # Complete plans live once, in social.own.plans.
        query = ' '.join([query, agent.goal, *(p.next_step for p in state.social.agents[actor].plans if p.status == 'active')])
        turn_refs = incoming | ({failed['ref']} if failed else set())
        turn_words = terms(' '.join(r['text'] for r in records if r['ref'] in turn_refs))
        # Summary duplicates the complete source text (and can be truncated).
        # Keep only actual status/reason metadata beside that source reference.
        for event in pending: event.pop('summary', None)
    status = 'not_used'
    selected = records[-12:]
    if strategy == 'retrieval':
        candidates = index.candidates(state.worldline_id, actor, state.head_seq) if index else None
        if candidates != frozenset(sources): candidates = None
        status = 'fresh' if candidates is not None else 'authoritative_fallback'
        available = records if candidates is None else [r for r in records if r['ref'] in candidates]
        words = terms(query)
        ranked = sorted(enumerate(available), key=lambda pair: (
            len(turn_words & terms(pair[1]['text'])), len(words & terms(pair[1]['text'])), pair[0]), reverse=True)
        refs = {record['ref'] for _, record in ranked[:12]}
        selected = [record for record in records if record['ref'] in refs]
    if pending:
        urgent = {e['ref'] for e in pending}
        urgent_records = [r for r in records if r['ref'] in urgent]
        if reading: urgent_records.reverse()
        selected = urgent_records + [r for r in selected if r['ref'] not in urgent]
    required=required_decision_refs(body)
    body['experiences']=[r for r in records if r['ref'] in required]
    if len(body['experiences'])!=len(required):raise RuntimeFault('conversation_context_unavailable')
    selected=[r for r in selected if r['ref'] not in required]
    # Reading records contain complete authored text. Bound the new context in
    # UTF-8 bytes, leaving space for the unchanged provider/token reservation.
    # Keep whole records, never present a truncated passage as the complete text.
    def fits(value):
        text = canonical(value)
        return (len(text.encode('utf-8')) <= min(budget_chars,10000)) if reading else len(text) <= budget_chars
    if reading and not fits(body):
        touched = {}
        for i, memory in enumerate(agent.memories):
            if memory.action_type not in ('read','compare'): continue
            try:
                receipt = json.loads(memory.text)
                keys = [receipt.get('record_id')] if memory.action_type=='read' else [receipt.get('left_id'),receipt.get('right_id')]
                for key in keys: touched[key] = i
                if memory.action_type=='compare' and receipt.get('result') in ('literal_equal','literal_different'):
                    touched['comparison:'+str(i)] = i
            except (ValueError, AttributeError): continue
        words = terms(query)
        ranked = sorted(enumerate(knowledge),key=lambda pair:(len(turn_words & terms(knowledge[pair[1]]['text'])), touched.get(pair[1],-1),
            len(words & terms(knowledge[pair[1]]['text'])),pair[0]),reverse=True)
        body['knowledge'] = {}
        body['knowledge_window'] = {'policy':'whole_records_turn_then_recent_read_or_compare_then_query', 'omitted_count':len(knowledge)}
        def reading_options():
            body['reading']['comparison_sources'] = sorted(body['knowledge'])
            body['action_options'] = action_options(body)
        reading_options()
        if not fits(body): raise RuntimeFault('conversation_context_limit' if required else 'context_budget_too_small')
        for _, key in ranked:
            body['knowledge'][key] = knowledge[key]
            body['knowledge_window']['omitted_count'] -= 1
            reading_options()
            if not fits(body):
                body['knowledge'].pop(key)
                body['knowledge_window']['omitted_count'] += 1
                reading_options()
        knowledge = body['knowledge']
    if not fits(body): raise RuntimeFault('context_budget_too_small')
    for record in selected:
        body['experiences'].append(record)
        if not fits(body): body['experiences'].pop()
    # Proposals may cite only records actually delivered in this bounded context.
    delivered = {item['source_ref'] for item in knowledge.values()} | {r['ref'] for r in body['experiences']}
    if 'perception_ref' in body: delivered.add(body['perception_ref'])
    if state.social and body['social']['own'].get('cognition'):
        own = body['social']['own']['cognition']
        own['pending'] = [e for e in own['pending'] if e['ref'] in delivered]
    if reading:
        from .grounding import quote_options
        # Optional quoting aids must not displace the complete records selected
        # above. Add them only in the remaining context space.
        for record in body['experiences']+list(body['knowledge'].values()):
            options=quote_options(record['text'])
            if not options:continue
            record['quote_options']=options
            if not fits(body):record.pop('quote_options')
    return AgentContext(state.world_id, state.worldline_id, actor, state.head_seq, body,
                        {ref: deepcopy(sources[ref]) for ref in delivered}, status, frozenset(sources))


def fit_request(context, build_request):
    """Fit the actual provider envelope before reservation, without editing state.

    Existing non-reading contracts keep their original fail-fast behavior. The
    builder only constructs JSON; this loop never sends or retries HTTP.
    """
    incoming=required_message_refs(context.body)
    required=required_decision_refs(context.body)
    messages={r['ref']:r for r in context.body['experiences'] if r['ref'] in incoming}
    own_ref=context.body.get('decision_focus',{}).get('last_own_ref') if 'reading' in context.body else None
    own=next((r for r in context.body['experiences'] if r['ref']==own_ref),None)
    if own_ref and (own is None or own['actor_id']!=context.actor_id or own['basis']!='own_action'):
        raise RuntimeFault('conversation_context_unavailable')
    if (not incoming<=set(messages) or not required<=set(context.sources)
        or any(r['action_type']!='speak' or r['actor_id']==context.actor_id for r in messages.values())):
        raise RuntimeFault('conversation_context_unavailable')
    try: return context, build_request(context)
    except RuntimeFault as exc:
        if str(exc)!='model_context_limit' or 'reading' not in context.body: raise
    fitted=deepcopy(context)
    body=fitted.body
    # Experiences are already ordered by build_context's selection priority.
    # For knowledge, retain the existing ranked window where present; otherwise
    # prefer recent reading/comparison records over older background records.
    keys=list(body['knowledge'])
    if 'knowledge_window' in body: remove_keys=list(reversed(keys))
    else: remove_keys=sorted(keys,key=lambda k:body['knowledge'][k].get('evidence_type') in ('read_text','text_comparison'))
    body['request_window']={'omitted_experiences':0,'omitted_knowledge':0}
    quotes=sorted([r for r in list(body['knowledge'].values())+body['experiences'] if r.get('quote_options')],
        key=lambda r:r.get('evidence_type')=='report')
    optional=[r for r in body['experiences'] if r['ref'] not in required]
    while True:
        if quotes:
            quotes.pop(0).pop('quote_options')
            body['request_window']['omitted_quote_options']=body['request_window'].get('omitted_quote_options',0)+1
        elif optional:
            body['experiences'].remove(optional.pop())
            body['request_window']['omitted_experiences']+=1
        elif remove_keys:
            body['knowledge'].pop(remove_keys.pop(0))
            body['request_window']['omitted_knowledge']+=1
            window=body.setdefault('knowledge_window',{'policy':'whole_records_request_budget','omitted_count':0})
            window['omitted_count']+=1
        else: raise RuntimeFault('conversation_context_limit' if required else 'model_context_limit')
        body['reading']['comparison_sources']=sorted(body['knowledge'])
        body['action_options']=action_options(body)
        delivered=({r['source_ref'] for r in body['knowledge'].values()}
            | {r['ref'] for r in body['experiences']} | {body['perception_ref']})
        fitted.sources={ref:source for ref,source in fitted.sources.items() if ref in delivered}
        cognitive=body.get('social',{}).get('own',{}).get('cognition')
        if cognitive is not None:
            cognitive['pending']=[r for r in cognitive['pending'] if r['ref'] in delivered]
        try: return fitted, build_request(fitted)
        except RuntimeFault as exc:
            if str(exc)!='model_context_limit': raise


def action_options(body):
    """Only local affordances, shared by the model context and its output schema.

    Visible exits remain subject to Runtime access rules; observation exposes
    holders/presence, not the unwritten contents of a book or note.
    """
    local, actor = body['perception'], body['identity']
    options = dict(move=list(local['exits']),
                take=sorted(k for k, holder in local['items'].items() if holder == local['location']),
                transfer=dict(items=sorted(k for k, holder in local['items'].items() if holder == actor),
                              recipients=sorted(a for a, person in local['people'].items()
                                                if a != actor and person['location'] == local['location'])),
                observe=['location', 'exits', 'people', 'items'])
    if 'reading' in body:
        options.update(read=body['reading']['readable_items'],compare=body['reading']['comparison_sources'])
    return options


def terms(text):
    # Chinese prose has no word spaces; use local bigrams alongside word tokens.
    words = set(re.findall(r'[a-z0-9_]+', text.casefold()))
    for run in re.findall(r'[\u4e00-\u9fff]+', text):
        words.update(run[i:i + 2] for i in range(max(1, len(run) - 1)))
    return words


def deterministic_action(context):
    """Explicit local rule policy, not a model or a claim of general AI planning."""
    plans = context.body.get('plans')
    if plans is None:
        plans = [p['next_step'] for p in context.body['social']['own']['plans'] if p['status']=='active']
    for plan in plans + [context.body['goal']]:
        if plan.startswith('goto:'):
            target = plan.removeprefix('goto:')
            if target != context.body['perception']['location'] and target in context.body['perception']['exits']:
                return 'move', {'destination_id': target}
    return 'wait', {}
