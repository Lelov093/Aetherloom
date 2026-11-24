"""Explicit subjective revisions and local experience follow-up, without inference."""
from .contracts import BeliefSet, PlansSet, COGNITIVE_STATES
from .domain import RuntimeFault
from .social_models import BeliefMeta, CognitiveChange, Experience


def validate(state, actor, own, refs):
    cognitive = own.cognition
    if (state.state_schema_version in COGNITIVE_STATES) != (cognitive is not None):
        raise RuntimeFault('invalid_cognitive_schema')
    if cognitive is None: return
    if set(cognitive.beliefs) != set(state.agents[actor].beliefs):
        raise RuntimeFault('invalid_current_beliefs')
    for record in cognitive.beliefs.values():
        if not set(record.refs) <= refs: raise RuntimeFault('invalid_cognitive_evidence')
    for change in cognitive.changes:
        if not change.refs or not set(change.refs + [change.memory_ref]) <= refs:
            raise RuntimeFault('invalid_cognitive_evidence')
        if any(e.ref not in change.refs for e in change.evidence): raise RuntimeFault('invalid_cognitive_evidence')
        if change.followup and change.followup.ref not in refs:
            raise RuntimeFault('invalid_cognitive_evidence')
    if any(e.ref not in refs for e in cognitive.pending): raise RuntimeFault('invalid_cognitive_evidence')
    expected = [p.next_step for p in own.plans if p.status == 'active']
    if state.agents[actor].committed_plans != expected:
        raise RuntimeFault('invalid_current_plans')


def revise(state, actor, args, own, effects, known_targets):
    """The actor chooses what to believe; sources justify a revision, not its truth."""
    if args.beliefs or args.plans or (args.social and args.social.plans):
        raise RuntimeFault('explicit_cognitive_revision_required')
    updates = args.social
    if updates is None: return
    refs = [f'{r.kind}:{r.key}' for r in args.sources]
    cognitive = own.cognition
    cognitive.pending = [e for e in cognitive.pending if e.ref not in refs]
    memory_ref = 'memory:' + str(len(state.agents[actor].memories))
    def record(kind, key, before, after, reason, evidence):
        if not reason.strip(): raise RuntimeFault('revision_reason_required')
        from .grounding import claims
        cognitive.changes.append(CognitiveChange(kind=kind,key=key,before=before,after=after,
            reason=reason,refs=refs,memory_ref=memory_ref,evidence=claims(state,actor,evidence,args.sources)))
    if len({u.key for u in updates.belief_updates}) != len(updates.belief_updates):
        raise RuntimeFault('duplicate_belief_revision')
    for change in updates.belief_updates:
        before = state.agents[actor].beliefs.get(change.key)
        if not change.key.strip() or (change.text is not None and not change.text.strip()):
            raise RuntimeFault('invalid_cognition_value')
        if change.text is None:
            if before is None: raise RuntimeFault('belief_unavailable')
            cognitive.beliefs.pop(change.key)
        else:
            cognitive.beliefs[change.key] = BeliefMeta(stance=change.stance,refs=refs,updated_tick=state.sim_time_tick)
        record('belief',change.key,before,change.text,change.reason,change.evidence)
        effects.append(BeliefSet(entity_id=actor,key=change.key,before=before,after=change.text,sources=args.sources))
    if len({u.id for u in updates.plan_updates}) != len(updates.plan_updates):
        raise RuntimeFault('duplicate_plan')
    plans = {p.id:p for p in own.plans}
    def description(p): return f'{p.status} · {p.next_step}' if p else None
    for change in updates.plan_updates:
        prior = plans.get(change.id)
        value = change.value
        if value is None:
            if prior is None: raise RuntimeFault('plan_unavailable')
            plans.pop(change.id)
        else:
            if value.id != change.id: raise RuntimeFault('plan_identity_mismatch')
            if value.target_id is not None and value.target_id not in known_targets:
                raise RuntimeFault('unknown_social_target')
            plans[change.id] = value.model_copy(deep=True)
        record('plan',change.id,description(prior),description(value),change.reason,change.evidence)
    if len(plans) > 8: raise RuntimeFault('plan_limit')
    own.plans = list(plans.values())
    current = [p.next_step for p in own.plans if p.status == 'active']
    if current != state.agents[actor].committed_plans:
        effects.append(PlansSet(entity_id=actor,before=state.agents[actor].committed_plans,after=current,sources=args.sources))
    cognitive.changes = cognitive.changes[-16:]
    # The memory is readable in the original Monitor and useful to later retrieval.
    summaries = [f'{"信念" if c.kind == "belief" else "计划"}：{c.before or "无"} → {c.after or "已撤回"}；{c.reason}'
                 for c in cognitive.changes if c.memory_ref == memory_ref]
    for effect in effects:
        if effect.op == 'memory_append' and effect.entity_id == actor:
            if summaries: effect.evidence.text = '主观修订（不是世界事实）：' + '；'.join(summaries)


def experiences(state, intent, plan, social, wake):
    """Only actually delivered memories can activate reconsideration or explain an action."""
    for effect in plan.effects:
        if effect.op != 'memory_append': continue
        actor = effect.entity_id
        own = social.agents[actor].cognition
        if own is None: continue
        ref = 'memory:' + str(effect.before_length)
        text = effect.evidence.text
        if intent.kind == 'actor_action' and intent.action_type not in ('speak','read','compare') and plan.accepted:
            args = intent.typed_args()
            detail = getattr(args,'destination_id',None) or getattr(args,'item_id',None) or ''
            if intent.action_type == 'transfer': detail += ' → ' + args.recipient_id
            text = intent.action_type + (' · ' + detail if detail else '')
        event = Experience(ref=ref,action=intent.action_type,accepted=plan.accepted,
            reason=plan.reason_code,summary=text[:600])
        if intent.kind == 'actor_action' and actor == intent.actor_id:
            for change in own.changes:
                if change.followup is None: change.followup = event.model_copy(deep=True)
        if intent.kind != 'cognition' and (not plan.accepted or intent.action_type in ('speak','transfer','take','move','read','compare','scene_event','scene_adjustment')):
            own.pending = (own.pending + [event])[-8:]
            wake(actor,'consider_revision')
