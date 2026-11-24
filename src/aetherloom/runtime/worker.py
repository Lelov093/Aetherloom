"""Bounded V2 Worker. Rules by default; explicit ModelPolicy is optional."""
import asyncio
import json

from pydantic import ValidationError

from .contracts import INTERACTIVE_STATES, COGNITIVE_STATES, READING_STATE
from .contracts import ActionIntent, CommandIntent, INTERACTIVE_STATE
from .cognition import MemoryIndex, build_context, deterministic_action
from .domain import RuntimeFault


class RuntimeWorker:
    def __init__(self, runtime, *, excluded=lambda: set()):
        self.runtime, self.excluded = runtime, excluded
        self.index, self.failures = MemoryIndex(), []
        self.task = None

    def start(self):
        if self.runtime.options.enabled and self.runtime.options.interactive:
            self.task = asyncio.create_task(self.run())

    async def shutdown(self):
        if self.task:
            self.task.cancel()
            try: await self.task
            except asyncio.CancelledError: pass

    def step(self, worldline):
        service, store = self.runtime, self.runtime._enabled()
        with store.connection() as conn:
            conn.execute('PRAGMA query_only=ON'); conn.execute('BEGIN')
            state = store._state(conn, worldline)
            control = dict(conn.execute('SELECT * FROM runtime_v2_execution_control WHERE worldline_id=?', (worldline,)).fetchone())
        if control['status'] != 'running' or state.state_schema_version not in INTERACTIVE_STATES: return None
        ready = sorted((j for j in state.scheduler.pending_jobs if j.due_tick <= state.sim_time_tick), key=lambda j:(j.due_tick,j.priority,j.insertion_order))
        token = None
        try:
            if ready:
                job = ready[0]
                token = service.grant_environment(worldline)
                intent = CommandIntent(kind='scheduled_event', world_id=state.world_id, worldline_id=worldline,
                    request_id=f'job:{job.id}:{state.head_seq}:{control["epoch"]}', expected_seq=state.head_seq, execution_epoch=control['epoch'],
                    action_type='trigger', args={'job_id': job.id})
            else:
                policy = json.loads(control['ledger']).get('autonomy', {})
                if not policy.get('enabled'): return None
                excluded = self.excluded()
                actors = [a for a in state.scheduler.ready_actor_order if a in policy['actors'] and (worldline,a) not in excluded]
                if not actors: return None
                social_ready = None
                if state.social:
                    from .social import available_actors
                    social_ready = available_actors(state, actors)
                if policy.get('mode') == 'model':
                    if self.runtime.model_policy is None:
                        store.pause_with_reason(worldline, 'model_not_enabled'); return None
                    allocation=self.runtime.model_policy.ledger.allocation(worldline)
                    if allocation and allocation['elapsed_seconds']>=allocation['runtime_seconds']:
                        store.pause_with_reason(worldline,'model:runtime_limit');return None
                    if social_ready is None or social_ready: return None
                    # All actors deliberately yielded. A labelled system wait is
                    # an ordinary committed quantum, not a generated social action.
                if policy['used'] >= policy['limit']:
                    store.pause_with_reason(worldline, 'autonomy_budget_exhausted'); return None
                actor = (social_ready or sorted(actors, key=lambda a: state.social.agents[a].next_tick))[0] if state.social else actors[state.scheduler.turn_counter % len(actors)]
                idle = social_ready == []
                token = service.grant_environment(worldline) if idle else service.grant_actor(worldline, actor, subject='rules-worker:' + actor)
                context = build_context(state, actor)  # recent12 remains the default; H-04 is not upgraded
                last = next((m for m in reversed(state.agents[actor].memories) if m.actor_id == actor), None)
                common = dict(world_id=state.world_id, worldline_id=worldline, actor_id=actor, request_id=f'rules:{state.head_seq}:{control["epoch"]}:{actor}',
                              expected_seq=state.head_seq, execution_epoch=control['epoch'])
                if idle:
                    intent = CommandIntent(kind='scheduled_event',action_type='advance_idle',args={'actors':actors},
                        **{**common,'actor_id':None})
                elif last and last.action_type == 'observe':
                    ref = next((ref for ref, source in context.sources.items() if source['kind'] == 'memory' and source['source'] == last.source.model_dump()), None)
                    if ref:
                        observation = json.loads(last.text)
                        beliefs = {'observed:' + key: str(value) for key,value in list(observation['items'].items())[:8]}
                        args={'beliefs':beliefs,'plans':context.body.get('plans',[])[:8],'sources':[context.sources[ref]]}
                        if state.state_schema_version in COGNITIVE_STATES:
                            args.update(beliefs={},plans=[],social={'belief_updates':[
                                {'key':key,'text':value,'stance':'held','reason':'本人最近一次局部观察的暂定解释'}
                                for key,value in beliefs.items()]})
                            if state.state_schema_version == READING_STATE:
                                for update, (item, holder) in zip(args['social']['belief_updates'], list(observation['items'].items())[:8]):
                                    update['evidence']=[dict(ref=ref,field='item_holder',target=item,value=holder)]
                        intent = CommandIntent(kind='cognition', action_type='cognition', args=args, **common)
                    else: intent = ActionIntent(action_type='wait', args={}, **common)
                else:
                    kind, args = deterministic_action(context) if last and last.action_type == 'cognition' else ('observe', {})
                    intent = ActionIntent(action_type=kind, args=args, **common)
            receipt = service.submit(token, intent.model_dump(), worker=True)
            if receipt.status in ('zero_time_limit','scheduled_tick_limit','autonomy_budget_exhausted','domain_limit_reached'):
                store.pause_with_reason(worldline, receipt.status)
            if receipt.status in ('committed','rule_rejected') and intent.actor_id is not None:
                # Derived refresh runs after COMMIT. Any lost job/cache is rebuilt from authorized history.
                latest = store.read_at(worldline)
                self.index.refresh(build_context(latest, intent.actor_id))
            return receipt
        finally:
            if token: service.revoke(token)

    def cycle(self):
        store = self.runtime._enabled()
        with store.connection() as conn:
            lines = [r[0] for r in conn.execute("SELECT worldline_id FROM runtime_v2_execution_control WHERE status='running'")]
        for worldline in lines:
            try: self.step(worldline)
            except (RuntimeFault, ValidationError, ValueError, KeyError) as exc:
                self.failures.append((worldline, str(exc))); self.failures = self.failures[-20:]
                store.pause_with_reason(worldline, 'worker_error:' + type(exc).__name__)

    async def run(self):
        while True:
            cycle = asyncio.create_task(asyncio.to_thread(self.cycle))
            try: await asyncio.shield(cycle)
            except asyncio.CancelledError:
                await cycle  # finish the owned SQL transaction before Host shutdown/pause
                raise
            if self.runtime.model_policy:
                await self.runtime.model_policy.cycle()
            await asyncio.sleep(0.25)  # wall-clock pacing only, never a source of logical time
