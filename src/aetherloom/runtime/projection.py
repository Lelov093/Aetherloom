"""Mode-independent authorized replacement DTOs over the existing commit spine.

I3 enables local Creator/Observer only. Participant policy/ports remain closed.
Cursors and sessions are process-local, bounded and short lived, never domain IDs.
"""
from collections import OrderedDict
from dataclasses import dataclass, field
import json
import hashlib
import hmac
import secrets
import time
from threading import RLock
from pydantic import ValidationError

from .contracts import ADJUDICATION_ARGS, INTERACTIVE_STATES
from .contracts import ENGINE, INTERACTIVE_STATE, ActionIntent, CommandIntent, READING_STATE
from .domain import RuntimeFault, canonical, digest, state_hash
from .execution import next_change, ready_actors
from . import history, transcript
from .participant import participant_view
from .scenarios import view as scenario_view

PROJECTION = 'world-projection-v1'
POLICY = 'local-author-v1'


@dataclass
class Session:
    world: str
    role: str
    scope: str
    expires: float
    grants: dict = field(default_factory=dict)
    cursors: OrderedDict = field(default_factory=OrderedDict)
    worldline: str | None = None
    actor: str | None = None
    spoiler_free: bool = False
    message_metadata: dict = field(default_factory=dict)


class ProjectionHost:
    def __init__(self, runtime, *, clock=time.monotonic, ttl=900, cursor_ttl=300, capacity=64, cursor_capacity=256):
        self.runtime, self.clock = runtime, clock
        self.ttl, self.cursor_ttl = ttl, cursor_ttl
        self.capacity, self.cursor_capacity = capacity, cursor_capacity
        self.sessions = OrderedDict()
        self.lock = RLock()
        self._reference_key = secrets.token_bytes(32)

    def open(self, world, role='creator_observer', *, worldline=None, actor=None, spoiler_free=False):
        if role not in ('creator_observer', 'observer', 'participant') or (role == 'participant' and not self.runtime.options.interactive):
            raise RuntimeFault('principal_not_enabled')
        if role == 'participant':
            state = self.runtime._enabled().read_at(worldline)
            if state.world_id != world or state.state_schema_version not in INTERACTIVE_STATES or actor not in state.agents:
                raise RuntimeFault('invalid_participant_binding')
        elif worldline is not None or actor is not None: raise RuntimeFault('invalid_participant_binding')
        with self.lock:
            if role == 'participant' and self.runtime.model_policy:
                # Fence in-flight model intents in the same SQL ordering as Commit.
                # Binding a player changes execution authorization, never world time.
                with self.runtime._store.connection() as conn:
                    conn.execute('UPDATE runtime_v2_execution_control SET epoch=epoch+1 WHERE worldline_id=?', (worldline,))
                    conn.commit()
            for key, value in list(self.sessions.items()):
                if value.expires <= self.clock(): self.revoke(key)
            while len(self.sessions) >= self.capacity:
                self.revoke(next(iter(self.sessions)))
            token = secrets.token_urlsafe(32)
            scope = secrets.token_urlsafe(18)
            self.sessions[token] = Session(world, role, scope, self.clock() + self.ttl, worldline=worldline, actor=actor,
                                           spoiler_free=spoiler_free and role == 'creator_observer')
            return {'token': token, 'viewer_scope': scope, 'role': role, 'expires_in': self.ttl, 'actor_id': actor}

    def revoke(self, token):
        with self.lock:
            session = self.sessions.pop(token, None)
            if session:
                for grant in session.grants.values(): self.runtime.revoke(grant)

    def _session(self, token):
        session = self.sessions.get(token)
        if not session or session.expires <= self.clock():
            self.revoke(token)
            raise RuntimeFault('session_expired')
        return session

    def _grant(self, session, worldline):
        identity = self.runtime._enabled().identity(worldline)
        if identity['world_id'] != session.world or identity['engine_version'] != ENGINE:
            raise RuntimeFault('scope_mismatch')
        if session.role == 'participant' and session.worldline != worldline: raise RuntimeFault('scope_mismatch')
        if worldline not in session.grants:
            session.grants[worldline] = (self.runtime.grant_actor(worldline, session.actor, subject='local-host:' + session.scope, role='participant')
                if session.role == 'participant' else self.runtime.grant_creator(worldline, subject='local-host:' + session.scope))
        # Recheck on every request, including streams; revocation is never a cached permission.
        self.runtime._authorize(session.grants[worldline], worldline, 'read_local' if session.role == 'participant' else 'read')
        return session.grants[worldline]

    def worldlines(self, token):
        with self.lock:
            session = self._session(token)
            with self.runtime._enabled().connection() as conn:
                conn.execute('PRAGMA query_only=ON')
                lines = [dict(row) for row in conn.execute(
                    'SELECT id AS worldline_id,world_id,engine_version FROM runtime_v2_worldlines WHERE world_id=? ORDER BY id', (session.world,))
                    if session.role != 'participant' or row['worldline_id'] == session.worldline]
                for line in lines:
                    manifest = self.runtime._store.scenario(line['worldline_id'], conn=conn)
                    if manifest:
                        line.update(title=manifest['title'], purpose=manifest['purpose'], series_id=manifest['series_id'])
                    state = self.runtime._store._state(conn, line['worldline_id'])
                    control = dict(conn.execute('SELECT status FROM runtime_v2_execution_control WHERE worldline_id=?', (line['worldline_id'],)).fetchone())
                    line['control_status'] = control['status']
                    if session.role != 'participant':
                        line.update(seq=state.head_seq, sim_time_tick=state.sim_time_tick)
                    if history.available(self.runtime._store) and session.role != 'participant':
                        fork = conn.execute('SELECT parent_id,anchor_seq,title FROM runtime_v2_forks WHERE child_id=?', (line['worldline_id'],)).fetchone()
                        if fork: line.update(title=fork['title'], parent_worldline_id=fork['parent_id'], parent_anchor_seq=fork['anchor_seq'])
                        event_types, actors, locations = set(), set(), set()
                        for payload in conn.execute('SELECT payload FROM runtime_v2_journal WHERE worldline_id=?', (line['worldline_id'],)):
                            value = json.loads(payload[0]); command = value.get('command') or {}; args = command.get('args') or {}
                            event_types.add(value.get('action_type'))
                            if value.get('actor_id'): actors.add(value['actor_id'])
                            if args.get('place_id'): locations.add(args['place_id'])
                            if args.get('destination_id'): locations.add(args['destination_id'])
                        line.update(event_types=sorted(value for value in event_types if value), actor_ids=sorted(actors), location_ids=sorted(locations))
                return lines

    def _cursor(self, session, worldline, anchor):
        now = self.clock()
        for key, (line, saved, expires) in list(session.cursors.items()):
            if expires <= now: del session.cursors[key]
            elif line == worldline and saved == anchor: return key
        while len(session.cursors) >= self.cursor_capacity: session.cursors.popitem(last=False)
        cursor = secrets.token_urlsafe(24)
        session.cursors[cursor] = (worldline, anchor, now + self.cursor_ttl)
        return cursor

    def read(self, token, worldline, *, cursor=None, seq=None):
        """One consistent SQLite read; bounded event tail; never recover, resolve or write.

        Incremental envelopes replace the authorized DTO atomically. A gap, expired
        cursor, scope/policy/process change requires a full snapshot, not blind patches.
        """
        with self.lock:
            session = self._session(token)
            self._grant(session, worldline)
            if session.role == 'participant':
                if seq is not None: raise RuntimeFault('participant_history_disabled')
                return self._read_participant(session, worldline, cursor)
            previous = None
            if cursor is not None:
                saved = session.cursors.get(cursor)
                if not saved or saved[0] != worldline or saved[2] <= self.clock() or seq is not None or saved[1][3]:
                    raise RuntimeFault('resnapshot_required')
                previous = saved[1]
            store = self.runtime._enabled()
            with store.connection() as conn:
                conn.execute('PRAGMA query_only=ON')
                conn.execute('BEGIN')
                state = store._state(conn, worldline) if seq is None else store._read_at(conn, worldline, seq)
                control = dict(conn.execute('SELECT * FROM runtime_v2_execution_control WHERE worldline_id=?', (worldline,)).fetchone())
                activity = getattr(self.runtime.model_policy, 'activity', {}).get(worldline)
                model_ledger = getattr(self.runtime.model_policy, 'ledger', None)
                shared = model_ledger and model_ledger.shared
                allocated = (self.runtime.model_policy.exploration_for(state, conn=conn) if shared else
                             model_ledger.allocation(worldline) if model_ledger else None)
                model_budget = None
                if model_ledger and session.role == 'creator_observer':
                    if shared:
                        model_budget = self.runtime.model_policy.budget(state, control, allocated)
                    elif not state.lineage or allocated:
                        model_budget = model_ledger.summary(worldline)
                dynamic = digest({'activity':activity,'budget':model_budget}) if session.role == 'creator_observer' else None
                anchor = (state.head_seq, control['epoch'], control['status'], seq is not None, dynamic)
                if previous == anchor: return None
                if previous and (previous[0] > state.head_seq or state.head_seq - previous[0] > 64):
                    raise RuntimeFault('resnapshot_required')
                start = previous[0] if previous else max(0, state.head_seq - 50)
                manifest = store.scenario(worldline, conn=conn)
                creator = session.role == 'creator_observer'
                guarded = session.spoiler_free
                events = [transcript.summary(*record, author=creator, guarded=guarded)
                          for record in transcript.records(store, conn, worldline, start + 1, state.head_seq)]
                agents = {}
                for key, agent in state.agents.items():
                    agents[key] = agent.model_dump() if creator and not guarded else {'location': agent.location}
                    if state.social and creator and not guarded:
                        from .social import view
                        agents[key]['social'] = view(state,key)
                projection = {
                    'projection_version': PROJECTION, 'engine_version': ENGINE,
                    'world_id': state.world_id, 'worldline_id': state.worldline_id, 'baseline_id': state.baseline_id,
                    'viewer_scope': session.scope, 'policy_version': POLICY, 'role': session.role,
                    'historical': seq is not None, 'seq': state.head_seq, 'sim_time_tick': state.sim_time_tick,
                    'world': state.world.model_dump(), 'agents': agents,
                    'capabilities': ['observe'] + (['inspect_cognition', 'control'] if session.role == 'creator_observer' else []),
                    'control': {'status': control['status'], 'reason': control['reason']},
                }
                if session.role != 'creator_observer':
                    projection['world'].pop('item_texts', None)
                    projection['world'].pop('perception', None)
                if guarded:
                    projection['spoiler_free'] = True
                    projection['world'].pop('item_texts', None)
                    projection['world']['environment'] = {}
                    projection['control']['reason'] = ''
                    projection['capabilities'].remove('inspect_cognition')
                if creator and not guarded and state.premises:
                    projection['premises'] = state.premises.model_dump()
                if creator and state.pending_conflict:
                    projection['conflict_pending'] = True
                    if not guarded:
                        projection['pending_conflict'] = state.pending_conflict.model_dump()
                if self.runtime.options.interactive and session.role == 'creator_observer' and history.available(store):
                    projection['capabilities'] += ['fork'] + ([] if guarded else ['observation_export'])
                    projection['state_hash'] = state_hash(state)
                    projection['lineage'] = state.lineage.model_dump() if state.lineage else None
                if self.runtime.options.interactive and state.state_schema_version in INTERACTIVE_STATES:
                    projection['capabilities'] += ['participate']
                    if session.role == 'creator_observer':
                        projection['capabilities'] += ['intervene', 'autonomy', 'direct_scene_events']
                        if not guarded:
                            projection['capabilities'].append('adjudicate')
                            if manifest and manifest.get('series_id') == 'authored-text':
                                projection['capabilities'].append('reopen')
                        if not guarded:
                            projection['scheduler'] = state.scheduler.model_dump()
                        ledger = json.loads(control['ledger'])
                        run = ledger.get('run')
                        if run and not guarded:
                            projection['run'] = run
                        projection['autonomy'] = ledger.get('autonomy', {'enabled': False})
                        if self.runtime.model_policy and (allocated or not (shared or state.lineage or state.social)):
                            projection['capabilities'] += ['model_autonomy']
                        if model_budget: projection['model_budget'] = model_budget
                        policy = projection['autonomy']
                        active = activity if activity else {'state':'ready'}
                        if control['status'] != 'running': active = {'state':'paused'}
                        elif not policy.get('enabled') and not run: active = {'state':'autonomy_off'}
                        elif policy.get('mode') == 'model' and not self.runtime.model_policy: active = {'state':'model_off'}
                        elif (state.social or run) and not activity:
                            actors = [a for a in policy.get('actors',[]) if (worldline,a) not in self.bound_participants()]
                            ready = ready_actors(state, actors)
                            wake = next_change(state, actors)
                            active = {'state':'ready' if ready else 'waiting', 'actor_id':ready[0] if ready else None,
                                      'next_tick':wake if not guarded and not ready else None}
                        projection['execution'] = {**active, 'model_enabled':self.runtime.model_policy is not None,
                                                   'strategy':policy.get('mode','rules')}
                if manifest:
                    projection['scene'] = scenario_view(manifest, projection)
                    if creator and state.candidates:
                        projection['candidate_targets'] = [
                            dict(id=role['id'], name=role['name'], location_name=projection['scene']['places'][role['location']]['name'])
                            for role in manifest['setup']['roles'] if role['id'] in state.candidates and role['id'] not in state.agents
                        ]
            return {'type': 'update' if previous else 'snapshot', 'previous_cursor': cursor,
                    'cursor': self._cursor(session, worldline, anchor), 'projection': projection, 'events': events}

    def _opaque(self, session, source):
        return hmac.new(self._reference_key, canonical({'scope':session.scope,'source':source}).encode('utf-8'), hashlib.sha256).hexdigest()

    def _read_participant(self, session, worldline, cursor=None):
        saved = session.cursors.get(cursor) if cursor else None
        if cursor and (not saved or saved[0] != worldline or saved[2] <= self.clock()): raise RuntimeFault('resnapshot_required')
        with self.runtime._enabled().connection() as conn:
            conn.execute('PRAGMA query_only=ON'); conn.execute('BEGIN')
            state = self.runtime._store._state(conn, worldline)
            control = dict(conn.execute('SELECT * FROM runtime_v2_execution_control WHERE worldline_id=?',(worldline,)).fetchone())
            session.message_metadata = transcript.participant_metadata(self.runtime._store, conn, session.actor,
                state.agents[session.actor].memories[-50:], session.message_metadata)
            world, agents, events = participant_view(state, session.actor, lambda value:self._opaque(session,value), session.message_metadata)
            reading = state.state_schema_version == READING_STATE
            projection = {'projection_version':PROJECTION,'engine_version':ENGINE,'world_id':session.world,'worldline_id':worldline,
                'baseline_id':None,'viewer_scope':session.scope,'policy_version':'local-participant-v1','role':'participant',
                'actor_id':session.actor,'historical':False,'seq':None,'sim_time_tick':None,'world':world,'agents':agents,
                'capabilities':['observe','act','inspect_own_cognition'] + (['read','compare'] if reading else []), 'control':{'status':control['status'],'reason':''}}
            from .premises import expression_options
            expression = expression_options(state, session.actor)
            if expression['past'] or expression['basis']:
                projection['expression_options'] = expression
            manifest = self.runtime._store.scenario(worldline, conn=conn)
            if manifest:
                scene = projection['scene'] = scenario_view(manifest, projection)
                named = {identity for event in events
                         for identity in (event.get('actor_id'), event.get('location_id'), *event.get('recipient_ids', []))}
                scene.setdefault('observation_names', {}).update(
                    {row['id']: row['name'] for row in manifest['setup']['roles'] + manifest['setup']['places'] if row['id'] in named})
        anchor = (digest({'projection':projection,'events':events}), None, 'participant', False)
        if saved and saved[1] == anchor: return None
        return {'type':'update' if cursor else 'snapshot','previous_cursor':cursor,'cursor':self._cursor(session,worldline,anchor),
                'projection':projection,'events':events}

    def _ticket(self, session, worldline, cursor):
        saved = session.cursors.get(cursor)
        if not saved or saved[0] != worldline or saved[2] <= self.clock() or saved[1][3]: raise RuntimeFault('resnapshot_required')
        return saved[1]

    def command(self, token, worldline, body, *, intervention=False):
        with self.lock:
            session = self._session(token)
            if (intervention and session.role != 'creator_observer') or (not intervention and session.role != 'participant'):
                raise RuntimeFault('unauthorized')
            if session.spoiler_free and body['action_type'] == 'resolve_unknown':
                raise RuntimeFault('key_unknown_unauthorized')
            if session.spoiler_free and body['action_type'] in ADJUDICATION_ARGS:
                raise RuntimeFault('adjudication_requires_author_view')
            grant = self._grant(session, worldline)
            principal = self.runtime._grants[grant]
            identity = {'world_id':session.world,'worldline_id':worldline,'actor_id':session.actor,'command':body}
            receipt = self.runtime._store.prior_receipt(worldline, body['request_id'], principal.subject, principal.role, identity)
            if receipt is None:
                anchor = self._ticket(session, worldline, body['cursor'])
                state = self.runtime._store.read_at(worldline)
                control = self.runtime._store.control_state(worldline)
                args = dict(body['args'])
                if intervention:
                    seq, epoch = anchor[:2]
                    if body['action_type'] == 'schedule':
                        args = {'job': {**args, 'insertion_order':state.scheduler.insertion_counter}}
                    intent = CommandIntent(kind='creator_intervention', world_id=session.world, worldline_id=worldline,
                        actor_id=None, request_id=body['request_id'], expected_seq=seq, execution_epoch=epoch,
                        action_type=body['action_type'], args=args, reason=body.get('reason',''))
                else:
                    visible = self._read_participant(session,worldline)
                    if visible['cursor'] != body['cursor']: raise RuntimeFault('stale_view')
                    if state.social and isinstance(args.get('social'),dict) and args['social'].get('conversation_id'):
                        supplied=args['social']['conversation_id']
                        actual=next((c.id for c in state.social.conversations.values() if session.actor in c.participants
                            and self._opaque(session,{'conversation':c.id})==supplied),None)
                        if actual is None: raise RuntimeFault('conversation_unavailable')
                        args['social']={**args['social'],'conversation_id':actual}
                    try:
                        intent = ActionIntent(world_id=session.world,worldline_id=worldline,actor_id=session.actor,
                            request_id=body['request_id'],expected_seq=state.head_seq,execution_epoch=control['epoch'],
                            action_type=body['action_type'],args=args)
                    except ValidationError as exc: raise RuntimeFault('invalid_intent') from exc
                receipt = self.runtime.submit(grant,intent.model_dump(),input_identity=identity)
            result = receipt.model_dump()
            if session.role == 'participant':
                result = {key:result[key] for key in ('request_id','status','reason_code')}
            return result

    def autonomy(self, token, worldline, actors, limit, mode='rules'):
        with self.lock:
            session = self._session(token)
            if session.role != 'creator_observer': raise RuntimeFault('unauthorized')
            self.runtime.configure_autonomy(self._grant(session,worldline),worldline,actors,limit,mode)
            return self.read(token,worldline)

    def configure_run(self, token, worldline, cursor, settings):
        with self.lock:
            session = self._session(token)
            if session.role != 'creator_observer' or session.spoiler_free:
                raise RuntimeFault('unauthorized')
            self._grant(session, worldline)
            _, epoch, *_ = self._ticket(session, worldline, cursor)
            self.runtime._enabled().configure_run(worldline, settings, epoch)
            return self.read(token, worldline)

    def model_budget_action(self, token, worldline, *, caps=None):
        with self.lock:
            session = self._session(token)
            if session.role != 'creator_observer' or session.spoiler_free:
                raise RuntimeFault('unauthorized')
            self._grant(session, worldline)
            policy = self.runtime.model_policy
            if not policy or not policy.ledger.shared:
                raise RuntimeFault('worldline_model_budget_required')
            state, control = policy.current(worldline)
            exploration = policy.exploration_for(state)
            if not exploration:
                raise RuntimeFault('worldline_model_budget_required')
            if control['status'] != 'paused':
                raise RuntimeFault('pause_before_run_settings')
            if caps is None:
                policy.check_recovery(worldline)
            else:
                policy.ledger.extend_exploration(exploration, **caps)
            return self.read(token, worldline)

    def fork(self, token, worldline, body, *, hook=lambda stage: None):
        with self.lock:
            session = self._session(token)
            if session.role != 'creator_observer' or not self.runtime.options.interactive:
                raise RuntimeFault('unauthorized')
            self._grant(session, worldline)
            return history.fork(self.runtime._store, worldline, session.world, body, hook=hook)

    def bound_participants(self):
        with self.lock:
            return {(s.worldline,s.actor) for s in self.sessions.values() if s.role == 'participant' and s.expires > self.clock()}

    def control(self, token, worldline, resume, *, reason=''):
        with self.lock:
            session = self._session(token)
            if session.role != 'creator_observer': raise RuntimeFault('unauthorized')
            grant = self._grant(session, worldline)
            self.runtime.control(grant, worldline, resume=resume, reason=reason)
            return self.read(token, worldline)

    def close(self):
        for token in list(self.sessions): self.revoke(token)
