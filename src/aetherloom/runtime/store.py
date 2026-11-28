"""SQLite CommitPort: latest read, CAS, resolve and all domain writes in one tx."""
from contextlib import contextmanager, closing, nullcontext
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

from pydantic import ValidationError
from .contracts import INTERACTIVE_STATES
from .contracts import (RuntimeAggregate as Aggregate, CommitReceipt as Receipt, CommittedTransition as Transition, ENGINE,
    ActionIntent, AttemptRuling, ConflictRuling, InteractiveTransition, INTERACTIVE_STATE, RunSettings)
from .domain import RuntimeFault, canonical, digest, invariants, resolve, state_hash
from .replay import apply_effects, apply_transition

from .schema import DDL, check_runtime
from .baseline import FrozenBaseline
from .interactive import resolve_interactive, ZERO_LIMIT, JOBS_PER_TICK
from .execution import counts_for_segment, observation_targets, observations_for
from . import history
from .contracts import ForkTransition, FORK_STATE, ForkCoreTransition, FORK_CORE_STATE
from .contracts import SocialTransition, SOCIAL_STATE, CognitiveTransition, COGNITIVE_STATE, ReadingTransition, READING_STATE



class RuntimeStore:
    @classmethod
    def initialize(cls, path):
        """Explicit bootstrap of a NEW dedicated V2 DB; never upgrade a Legacy file."""
        path = Path(path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb'):
            pass
        with closing(sqlite3.connect(path)) as conn:
            conn.execute('BEGIN IMMEDIATE')
            for statement in DDL:
                conn.execute(statement)
            conn.execute('CREATE TABLE runtime_v2_schema(version INTEGER PRIMARY KEY,engine TEXT NOT NULL)')
            conn.execute('INSERT INTO runtime_v2_schema VALUES(1,?)', (ENGINE,))
            conn.execute('PRAGMA application_id=1095062600')
            conn.execute('PRAGMA user_version=1')
            conn.commit()
        return cls(path)

    def __init__(self, path, *, layout='standalone'):
        self.path, self.layout = Path(path).resolve(), layout
        if not self.path.is_file():
            raise RuntimeFault('runtime_database_not_initialized')
        # Read-only validation before pragma/recovery, never implicit migration.
        with closing(sqlite3.connect(self.path.as_uri() + '?mode=ro', uri=True)) as check:
            self.storage_version = check_runtime(check, layout)
        if layout == 'standalone':
            with self.connection() as conn:
                conn.execute('PRAGMA journal_mode=WAL')
        self.diagnostics = {}
        self.recover()

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA synchronous=FULL')
        try:
            yield conn
        finally:
            if conn.in_transaction: conn.rollback()
            conn.close()

    def create(self, state, *, baseline: FrozenBaseline | None = None, connection=None):
        invariants(state)
        if state.head_seq != 0:
            raise RuntimeFault('invalid_initial_checkpoint')
        if self.layout == 'shared':
            if self.storage_version < 2:
                raise RuntimeFault('runtime_baseline_migration_required')
            if baseline is None:
                raise RuntimeFault('frozen_baseline_required')
            baseline.validate_for(state)
        elif baseline is not None:
            raise RuntimeFault('baseline_schema_not_available')
        blob, hashed = canonical(state.model_dump()), state_hash(state)
        with self.connection() if connection is None else nullcontext(connection) as conn:
            if connection is None:
                conn.execute('BEGIN IMMEDIATE')
            if self.layout == 'shared' and not conn.execute('SELECT 1 FROM worlds WHERE id=?', (state.world_id,)).fetchone():
                raise RuntimeFault('world_identity_mismatch')
            if baseline is not None:
                manifest = canonical(baseline.model_dump())
                previous = conn.execute('SELECT world_id,manifest FROM runtime_v2_baselines WHERE id=?', (baseline.baseline_id,)).fetchone()
                if previous is not None and tuple(previous) != (baseline.world_id, manifest):
                    raise RuntimeFault('baseline_identity_conflict')
                if previous is None:
                    conn.execute('INSERT INTO runtime_v2_baselines VALUES(?,?,?)', (baseline.baseline_id, baseline.world_id, manifest))
            conn.execute('INSERT INTO runtime_v2_worldlines VALUES(?,?,?,?,?,?,?,0)', (state.worldline_id, state.world_id, state.engine_version, blob, hashed, blob, hashed))
            conn.execute('INSERT INTO runtime_v2_execution_control VALUES(?,0,?,?,?)', (state.worldline_id, 'paused',
                'conflict_pending' if state.pending_conflict else '',
                canonical({'model_attempts': 0, 'reserved_units': 0, 'settled_units': 0})))
            if baseline is not None:
                conn.execute('INSERT INTO runtime_v2_baseline_links VALUES(?,?)', (state.worldline_id, baseline.baseline_id))
            history.save_checkpoint(self, conn, state)
            if connection is None:
                conn.commit()

    def scenario(self, worldline, *, conn=None):
        if self.layout != 'shared' or self.storage_version < 3:
            return None
        if conn is None:
            with self.connection() as read:
                read.execute('PRAGMA query_only=ON')
                return self.scenario(worldline, conn=read)
        row = conn.execute('SELECT manifest FROM runtime_v2_scenarios WHERE worldline_id=?', (worldline,)).fetchone()
        return json.loads(row[0]) if row else None

    def baseline(self, worldline):
        if self.layout != 'shared' or self.storage_version < 2:
            raise RuntimeFault('baseline_schema_not_available')
        with self.connection() as conn:
            conn.execute('PRAGMA query_only=ON')
            row = conn.execute('SELECT b.manifest FROM runtime_v2_baseline_links l JOIN runtime_v2_baselines b ON b.id=l.baseline_id WHERE l.worldline_id=?', (worldline,)).fetchone()
            if row is None:
                raise RuntimeFault('worldline_baseline_unavailable')
            return FrozenBaseline.model_validate_json(row[0])

    def _state(self, conn, worldline):
        row = conn.execute('SELECT * FROM runtime_v2_worldlines WHERE id=?', (worldline,)).fetchone()
        if row is None: raise RuntimeFault('worldline_unavailable')
        state = Aggregate.model_validate_json(row['state'])
        invariants(state)
        if (state.worldline_id != worldline or state.world_id != row['world_id'] or state.engine_version != row['engine_version']
            or state.head_seq != row['head_seq'] or state_hash(state) != row['state_hash']):
            raise RuntimeFault('checkpoint_corrupted')
        return state

    def identity(self, worldline):
        """Registry identity is available even when historical Apply is unsupported."""
        with self.connection() as conn:
            conn.execute('PRAGMA query_only=ON')
            row = conn.execute('SELECT id,world_id,engine_version FROM runtime_v2_worldlines WHERE id=?', (worldline,)).fetchone()
            if row is None:
                raise RuntimeFault('worldline_unavailable')
            return dict(row)

    def _read_at(self, conn, worldline, seq=None, *, use_checkpoint=True):
        row = conn.execute('SELECT * FROM runtime_v2_worldlines WHERE id=?', (worldline,)).fetchone()
        if row is None: raise RuntimeFault('worldline_unavailable')
        target = row['head_seq'] if seq is None else seq
        if type(target) is not int or target < 0 or target > row['head_seq']:
            raise RuntimeFault('invalid_sequence')
        state = Aggregate.model_validate_json(row['initial'])
        invariants(state)
        if (state.head_seq != 0 or state.worldline_id != worldline or state.world_id != row['world_id']
            or state.engine_version != row['engine_version'] or state_hash(state) != row['initial_hash']):
            raise RuntimeFault('checkpoint_corrupted')
        saved = history.checkpoint(self, conn, row, target) if use_checkpoint else None
        if saved is not None: state = saved
        for event in conn.execute('SELECT payload FROM runtime_v2_journal WHERE worldline_id=? AND seq>? AND seq<=? ORDER BY seq', (worldline, state.head_seq, target)):
            state = apply_transition(state, json.loads(event[0]))
        if state.head_seq != target: raise RuntimeFault('checkpoint_corrupted')
        return state

    def read_at(self, worldline, seq=None):
        with self.connection() as conn:
            conn.execute('PRAGMA query_only=ON')
            conn.execute('BEGIN')
            return self._read_at(conn, worldline, seq)

    def recover(self):
        """Startup, not an ordinary read: verify history and default to paused."""
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            integrity = conn.execute('PRAGMA integrity_check').fetchone()[0]
            if integrity != 'ok' or conn.execute('PRAGMA foreign_key_check').fetchall():
                raise RuntimeFault('checkpoint_corrupted')
            for row in conn.execute('SELECT id FROM runtime_v2_worldlines').fetchall():
                worldline = row[0]
                prior = conn.execute('SELECT status,reason FROM runtime_v2_execution_control WHERE worldline_id=?', (worldline,)).fetchone()
                reason = ''
                pending_conflict = False
                try:
                    state = self._state(conn, worldline)
                    pending_conflict = state.pending_conflict is not None
                    if state_hash(self._read_at(conn, worldline, use_checkpoint=False)) != state_hash(state):
                        raise RuntimeFault('checkpoint_corrupted')
                    if history.available(self):
                        history.verify_lineage(self, conn, state)
                        for saved in conn.execute('SELECT seq FROM runtime_v2_checkpoints WHERE worldline_id=?', (worldline,)).fetchall():
                            historical = self._read_at(conn, worldline, saved[0], use_checkpoint=False)
                            if state_hash(self._read_at(conn, worldline, saved[0])) != state_hash(historical):
                                raise RuntimeFault('checkpoint_corrupted')
                    for event in conn.execute('SELECT seq,payload FROM runtime_v2_journal WHERE worldline_id=? ORDER BY seq', (worldline,)):
                        value = json.loads(event['payload'])
                        receipt = conn.execute('SELECT payload FROM runtime_v2_receipts WHERE worldline_id=? AND request_id=?', (worldline, value['request_id'])).fetchone()
                        out = conn.execute('SELECT payload FROM runtime_v2_outbox WHERE worldline_id=? AND seq=?', (worldline,event['seq'])).fetchone()
                        if (not receipt or not out or json.loads(out[0]) != value
                            or json.loads(receipt[0])['event_id'] != value['event_id']):
                            raise RuntimeFault('checkpoint_corrupted')
                    if conn.execute('SELECT count(*) FROM runtime_v2_journal WHERE worldline_id=?', (worldline,)).fetchone()[0] != state.head_seq:
                        raise RuntimeFault('checkpoint_corrupted')
                except (RuntimeFault, ValidationError, ValueError, KeyError) as exc:
                    reason = str(exc)
                    self.diagnostics[worldline] = reason
                pause_reason = reason or ('conflict_pending' if pending_conflict else prior['reason'] if prior and prior['status']=='paused' else '')
                conn.execute('UPDATE runtime_v2_execution_control SET epoch=epoch+1,status=?,reason=? WHERE worldline_id=?',
                             ('recovery_required' if reason else 'paused', pause_reason, worldline))
            conn.commit()

    def control(self, worldline, resume=False, *, reason=''):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            state = self._state(conn, worldline)
            current = dict(conn.execute('SELECT * FROM runtime_v2_execution_control WHERE worldline_id=?', (worldline,)).fetchone())
            if current['status'] == 'recovery_required': raise RuntimeFault('checkpoint_corrupted')
            if state.pending_conflict:
                if resume:
                    raise RuntimeFault('conflict_pending')
                return current
            if current['status'] == ('running' if resume else 'paused'):
                return current
            ledger = json.loads(current['ledger'])
            if resume and 'run' not in ledger and (state.scheduler.pending_jobs or ledger.get('autonomy', {}).get('enabled')):
                manifest = self.scenario(worldline, conn=conn)
                if manifest and manifest.get('series_id') == 'authored-text':
                    ledger['run'] = {'settings': RunSettings().model_dump(), 'used': 0}
            if resume and 'run' in ledger:
                ledger['run']['used'] = 0
                stop_tick = ledger['run']['settings'].get('story_stop_tick')
                if stop_tick is not None and state.sim_time_tick >= stop_tick:
                    conn.execute("UPDATE runtime_v2_execution_control SET reason='story_time_limit',epoch=epoch+1 WHERE worldline_id=? AND reason<>'story_time_limit'", (worldline,))
                    conn.commit()
                    return self.control_state(worldline)
            conn.execute('UPDATE runtime_v2_execution_control SET epoch=epoch+1,status=?,reason=?,ledger=? WHERE worldline_id=?',
                         ('running' if resume else 'paused', '' if resume else reason, canonical(ledger), worldline))
            conn.commit()
            return self.control_state(worldline)

    def control_state(self, worldline):
        with self.connection() as conn:
            row = conn.execute('SELECT * FROM runtime_v2_execution_control WHERE worldline_id=?', (worldline,)).fetchone()
            if row is None: raise RuntimeFault('worldline_unavailable')
            return dict(row)

    def audit(self, code, worldline=None, request_id=None):
        with self.connection() as conn:
            conn.execute('INSERT INTO runtime_v2_audit(worldline_id,request_id,code) VALUES(?,?,?)', (worldline,request_id,code))
            conn.commit()

    def prior_receipt(self, worldline, request_id, subject, origin, input_identity):
        intent_digest = digest({'intent':input_identity,'subject':subject,'origin':origin})
        with self.connection() as conn:
            conn.execute('PRAGMA query_only=ON')
            previous = conn.execute('SELECT * FROM runtime_v2_receipts WHERE worldline_id=? AND request_id=?',(worldline,request_id)).fetchone()
            if previous:
                if previous['intent_digest'] == intent_digest and previous['subject'] == subject: return Receipt.model_validate_json(previous['payload'])
                return Receipt(request_id=request_id,intent_digest=intent_digest,status='idempotency_key_conflict')

    def commit_transition(self, intent, subject, origin, *, hook=None, input_identity=None, worker=False):
        hook = hook or (lambda stage, conn: None)
        intent_digest = digest({'intent': input_identity if input_identity is not None else intent.model_dump(), 'subject': subject, 'origin': origin})
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            previous = conn.execute('SELECT * FROM runtime_v2_receipts WHERE worldline_id=? AND request_id=?', (intent.worldline_id,intent.request_id)).fetchone()
            if previous:
                if previous['intent_digest'] == intent_digest and previous['subject'] == subject:
                    return Receipt.model_validate_json(previous['payload'])
                conn.execute('INSERT INTO runtime_v2_audit(worldline_id,request_id,code) VALUES(?,?,?)', (intent.worldline_id,intent.request_id,'idempotency_key_conflict'))
                conn.commit()
                return Receipt(request_id=intent.request_id, intent_digest=intent_digest, status='idempotency_key_conflict')
            state = self._state(conn, intent.worldline_id)
            control = conn.execute('SELECT * FROM runtime_v2_execution_control WHERE worldline_id=?', (intent.worldline_id,)).fetchone()
            ledger = json.loads(control['ledger'])
            run = ledger.get('run')
            settings = RunSettings.model_validate(run['settings']) if run else None
            stop_tick = settings.story_stop_tick if settings and control['status'] == 'running' else None
            error = ('checkpoint_corrupted' if control['status'] == 'recovery_required' else
                     'world_identity_mismatch' if intent.world_id != state.world_id else
                     'epoch_invalid' if intent.execution_epoch != control['epoch'] else
                     'paused' if control['status'] != 'running' and not (control['status'] == 'paused' and intent.kind == 'creator_intervention') else
                     'stale_state' if intent.expected_seq != state.head_seq else None)
            if not error:
                try:
                    plan = resolve_interactive(state, intent)
                    if stop_tick is not None and (state.sim_time_tick >= stop_tick or any(
                        op.op == 'clock_advance' and op.after > stop_tick for op in plan.effects
                    )):
                        raise RuntimeFault('story_time_limit')
                    if state.state_schema_version in INTERACTIVE_STATES:
                        zero = not any(op.op == 'clock_advance' for op in plan.effects)
                        zero_count, scheduled_count = history.tick_counts(conn, state)
                        if zero and zero_count >= ZERO_LIMIT and intent.action_type != 'resolve_conflict':
                            raise RuntimeFault('zero_time_limit')
                        if intent.kind == 'scheduled_event' and scheduled_count >= JOBS_PER_TICK:
                            raise RuntimeFault('scheduled_tick_limit')
                        if worker and isinstance(intent, ActionIntent):
                            policy = ledger.get('autonomy', {})
                            if not policy.get('enabled') or intent.actor_id not in policy.get('actors', []) or policy.get('used', 0) >= policy.get('limit', 0):
                                raise RuntimeFault('autonomy_budget_exhausted')
                except RuntimeFault as exc:
                    error = str(exc)
            if error:
                receipt = Receipt(request_id=intent.request_id, intent_digest=intent_digest, status=error)
                conn.execute('INSERT INTO runtime_v2_receipts VALUES(?,?,?,?,?)', (intent.worldline_id,intent.request_id,intent_digest,subject,canonical(receipt.model_dump())))
                conn.execute('INSERT INTO runtime_v2_audit(worldline_id,request_id,code) VALUES(?,?,?)', (intent.worldline_id,intent.request_id,error))
                if error == 'story_time_limit':
                    conn.execute("UPDATE runtime_v2_execution_control SET status='paused',reason=?,epoch=epoch+1 WHERE worldline_id=?",
                                 (error, intent.worldline_id))
                conn.commit()
                return receipt
            after = apply_effects(state, plan.effects)
            hits, stop_reason = [], ''
            if run:
                hits = observations_for(settings, intent, plan)
                if control['status'] == 'running' and settings.mode == 'segment' and counts_for_segment(intent, plan):
                    run['used'] += 1
                    if run['used'] >= settings.segment_steps:
                        stop_reason = 'segment_complete'
                if stop_tick is not None and after.sim_time_tick == stop_tick:
                    stop_reason = 'story_time_limit'
                if any(hit.mode == 'pause' for hit in hits):
                    stop_reason = 'observation_pause'
            event_id = 'evt_' + intent_digest.split(':')[1]
            model = ForkTransition if state.state_schema_version == FORK_STATE else InteractiveTransition if state.state_schema_version in INTERACTIVE_STATES else Transition
            if state.state_schema_version == SOCIAL_STATE: model = SocialTransition
            if state.state_schema_version == READING_STATE: model = ReadingTransition
            elif state.state_schema_version == COGNITIVE_STATE: model = CognitiveTransition
            if state.state_schema_version == FORK_CORE_STATE: model = ForkCoreTransition
            extra = {'kind': intent.kind, 'reason': getattr(intent, 'reason', ''), 'command':intent.model_dump()} if issubclass(model, InteractiveTransition) else {}
            if hits:
                extra['observations'] = hits
            actor_id = intent.actor_id
            if plan.ruling:
                extra['ruling'] = plan.ruling
                if isinstance(plan.ruling, AttemptRuling):
                    actor_id = plan.ruling.attempt.actor_id
                elif isinstance(plan.ruling, ConflictRuling):
                    actor_id = plan.ruling.winner_id
            event = model(world_id=intent.world_id, subject=subject, worldline_id=intent.worldline_id, event_id=event_id, seq=after.head_seq, parent_seq=state.head_seq,
                execution_epoch=control['epoch'], request_id=intent.request_id, intent_digest=intent_digest, actor_id=actor_id,
                action_type=intent.action_type, origin=origin, accepted=plan.accepted, reason_code=plan.reason_code,
                before_hash=state_hash(state), after_hash=state_hash(after), sim_time_before=state.sim_time_tick,
                sim_time_after=after.sim_time_tick, effects=plan.effects, created_at_utc=datetime.now(timezone.utc).isoformat(), **extra)
            payload = canonical(event.model_dump())
            receipt = Receipt(request_id=intent.request_id,intent_digest=intent_digest,status='committed' if plan.accepted else 'rule_rejected',
                event_id=event_id, seq=after.head_seq, reason_code=plan.reason_code)
            hook('before_journal', conn)
            conn.execute('INSERT INTO runtime_v2_journal VALUES(?,?,?,?)', (intent.worldline_id,after.head_seq,event_id,payload))
            hook('after_journal', conn)
            hook('before_state', conn)
            result = conn.execute('UPDATE runtime_v2_worldlines SET state=?,state_hash=?,head_seq=? WHERE id=? AND head_seq=?',
                (canonical(after.model_dump()),state_hash(after),after.head_seq,intent.worldline_id,intent.expected_seq))
            if result.rowcount != 1: raise RuntimeFault('stale_state')
            hook('after_state', conn)
            hook('before_receipt', conn)
            conn.execute('INSERT INTO runtime_v2_receipts VALUES(?,?,?,?,?)', (intent.worldline_id,intent.request_id,intent_digest,subject,canonical(receipt.model_dump())))
            hook('after_receipt', conn)
            hook('before_outbox', conn)
            conn.execute('INSERT INTO runtime_v2_outbox VALUES(?,?,?)', (intent.worldline_id,after.head_seq,payload))
            if after.head_seq % history.CHECKPOINT_INTERVAL == 0:
                history.save_checkpoint(self, conn, after)
            if worker and isinstance(intent, ActionIntent):
                ledger['autonomy']['used'] += 1
            if run or worker and isinstance(intent, ActionIntent):
                conn.execute('UPDATE runtime_v2_execution_control SET ledger=? WHERE worldline_id=?', (canonical(ledger), intent.worldline_id))
            if state.pending_conflict != after.pending_conflict:
                stop_reason = 'conflict_pending' if after.pending_conflict else 'conflict_resolved'
            if stop_reason:
                conn.execute("UPDATE runtime_v2_execution_control SET status='paused',reason=?,epoch=epoch+1 WHERE worldline_id=?",
                             (stop_reason, intent.worldline_id))
            hook('after_outbox', conn)
            hook('before_commit', conn)
            conn.commit()
            hook('after_commit', conn)
            return receipt

    def configure_autonomy(self, worldline, actors, limit, mode='rules'):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            state = self._state(conn, worldline)
            if state.state_schema_version not in INTERACTIVE_STATES: raise RuntimeFault('interactive_worldline_required')
            if not set(actors) <= set(state.agents) or len(actors) != len(set(actors)) or not 1 <= limit <= 100:
                raise RuntimeFault('invalid_autonomy_policy')
            control = conn.execute('SELECT * FROM runtime_v2_execution_control WHERE worldline_id=?', (worldline,)).fetchone()
            if control['status'] == 'recovery_required': raise RuntimeFault('checkpoint_corrupted')
            ledger = json.loads(control['ledger'])
            ledger['autonomy'] = {'enabled': bool(actors), 'actors': actors, 'limit': limit, 'used': 0}
            if mode != 'rules': ledger['autonomy']['mode'] = mode
            conn.execute('UPDATE runtime_v2_execution_control SET epoch=epoch+1,ledger=? WHERE worldline_id=?', (canonical(ledger), worldline))
            conn.commit()

    def configure_run(self, worldline, settings, epoch):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            state = self._state(conn, worldline)
            if state.state_schema_version not in INTERACTIVE_STATES:
                raise RuntimeFault('interactive_worldline_required')
            control = conn.execute('SELECT * FROM runtime_v2_execution_control WHERE worldline_id=?', (worldline,)).fetchone()
            if control['status'] == 'recovery_required':
                raise RuntimeFault('checkpoint_corrupted')
            if control['epoch'] != epoch:
                raise RuntimeFault('stale_view')
            if control['status'] != 'paused':
                raise RuntimeFault('pause_before_run_settings')
            ledger = json.loads(control['ledger'])
            previous = (ledger.get('run') or {}).get('settings', {}).get('observations', [])
            targets = observation_targets(state)
            targets['scheduled'].update(row['target_id'] for row in previous if row['event'] == 'scheduled')
            if (len({row.id for row in settings.observations}) != len(settings.observations)
                or any(row.target_id not in targets[row.event] for row in settings.observations)):
                raise RuntimeFault('invalid_observation_target')
            ledger['run'] = {'settings': settings.model_dump(), 'used': 0}
            conn.execute('UPDATE runtime_v2_execution_control SET ledger=?,epoch=epoch+1 WHERE worldline_id=?',
                         (canonical(ledger), worldline))
            conn.commit()

    def pause_with_reason(self, worldline, reason, *, epoch=None, seq=None):
        with self.connection() as conn:
            conn.execute('''UPDATE runtime_v2_execution_control SET status='paused',reason=?,epoch=epoch+1
                            WHERE worldline_id=? AND status='running' AND (? IS NULL OR epoch=?) AND
                            (? IS NULL OR ?=(SELECT head_seq FROM runtime_v2_worldlines WHERE id=?))''',
                         (reason, worldline, epoch, epoch, seq, seq, worldline))
            conn.commit()
