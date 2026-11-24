"""Trusted local application boundary; no public HTTP/Participant grant endpoint."""
from dataclasses import dataclass
import os
from pathlib import Path
import secrets

from pydantic import ValidationError

from .contracts import INTERACTIVE_STATES
from .contracts import ActionIntent, CommandIntent, RuntimeAggregate, ENGINE, CONTRACT, INTERACTIVE_STATE
from .domain import RuntimeFault, canonical
from .store import RuntimeStore


@dataclass(frozen=True)
class RuntimeOptions:
    enabled: bool = False
    database: Path | None = None
    layout: str = 'standalone'
    interactive: bool = False

    @classmethod
    def from_env(cls):
        flag = os.environ.get('AETHERLOOM_VNEXT_ENABLED', '0')
        if flag not in ('0', '1'):
            raise RuntimeFault('invalid_vnext_flag')
        path = os.environ.get('AETHERLOOM_VNEXT_DB')
        interactive = os.environ.get('AETHERLOOM_VNEXT_INTERACTIVE', '0')
        if interactive not in ('0', '1'): raise RuntimeFault('invalid_interactive_flag')
        return cls(enabled=flag == '1', database=Path(path) if path else None,
                   layout=os.environ.get('AETHERLOOM_VNEXT_LAYOUT', 'standalone'), interactive=interactive == '1')


@dataclass(frozen=True)
class Grant:
    world_id: str
    worldline_id: str
    subject: str
    role: str
    permissions: frozenset[str]
    actor_id: str | None = None


class RuntimeService:
    def __init__(self, options=RuntimeOptions(), *, legacy_database=None):
        self.options, self._grants, self._store = options, {}, None
        self.model_policy = None
        if not options.enabled:
            return  # flag off means no V2 database open, inspection, DDL or recovery
        if options.database is None:
            raise RuntimeFault('explicit_vnext_database_required')
        if options.layout == 'shared' and legacy_database is not None and options.database.resolve() != Path(legacy_database).resolve():
            raise RuntimeFault('shared_database_mismatch')
        if options.layout != 'shared' and legacy_database is not None and options.database.resolve() == Path(legacy_database).resolve():
            raise RuntimeFault('legacy_database_cannot_be_runtime_store')
        self._store = RuntimeStore(options.database, layout=options.layout)  # must already be explicitly initialized

    def _enabled(self):
        if self._store is None:
            raise RuntimeFault('vnext_disabled')
        return self._store

    def bootstrap(self, state: RuntimeAggregate, *, baseline=None):
        """Trusted scene handoff, not a client method or Canon compiler/migration."""
        self._enabled().create(state, baseline=baseline)

    def grant_creator(self, worldline, *, subject):
        identity = self._enabled().identity(worldline)
        token = secrets.token_urlsafe(32)
        permissions = {'read', 'control'}
        if self.options.interactive:
            try:
                if self._store.read_at(worldline).state_schema_version in INTERACTIVE_STATES: permissions |= {'intervene', 'autonomy'}
            except RuntimeFault: pass  # diagnostic access must survive unsupported history
        self._grants[token] = Grant(identity['world_id'], worldline, subject, 'creator_observer', frozenset(permissions))
        return token

    def grant_actor(self, worldline, actor, *, subject, role='agent'):
        if role not in ('agent', 'creator_observer', 'participant') or (role == 'participant' and not self.options.interactive):
            raise RuntimeFault('principal_not_enabled')
        state = self._enabled().read_at(worldline)
        if role == 'participant' and state.state_schema_version not in INTERACTIVE_STATES: raise RuntimeFault('interactive_worldline_required')
        if actor not in state.agents:
            raise RuntimeFault('invalid_actor')
        token = secrets.token_urlsafe(32)
        permissions = {'act'}
        if role == 'participant': permissions.add('read_local')
        elif self.options.interactive: permissions |= {'cognition', 'context'}
        self._grants[token] = Grant(state.world_id, worldline, subject, role, frozenset(permissions), actor)
        return token

    def grant_environment(self, worldline):
        if not self.options.interactive: raise RuntimeFault('interactive_disabled')
        state = self._enabled().read_at(worldline)
        if state.state_schema_version not in INTERACTIVE_STATES: raise RuntimeFault('interactive_worldline_required')
        token = secrets.token_urlsafe(32)
        self._grants[token] = Grant(state.world_id, worldline, 'scheduler', 'environment', frozenset({'schedule'}))
        return token

    def revoke(self, token):
        self._grants.pop(token, None)

    def _authorize(self, token, worldline, permission):
        store = self._enabled()
        grant = self._grants.get(token)
        if not grant or grant.worldline_id != worldline or permission not in grant.permissions:
            store.audit('unauthorized', worldline)
            raise RuntimeFault('unauthorized')
        return grant

    def submit(self, token, payload, *, hook=None, input_identity=None, worker=False):
        worldline = payload.get('worldline_id') if isinstance(payload, dict) else None
        kind = payload.get('kind', 'actor_action') if isinstance(payload, dict) else None
        if kind != 'actor_action' and not self.options.interactive:
            self._authorize(token, worldline, 'act')
            raise RuntimeFault('unsupported_command')
        permission = {'actor_action':'act', 'cognition':'cognition', 'creator_intervention':'intervene', 'scheduled_event':'schedule'}.get(kind)
        if permission is None: raise RuntimeFault('unsupported_command')
        grant = self._authorize(token, worldline, permission)
        try:
            intent = (ActionIntent if kind == 'actor_action' else CommandIntent).model_validate(payload)
            if kind != 'actor_action' and intent.action_type not in {'cognition':{'cognition'}, 'creator_intervention':{'environment','relocate','scene_event','schedule'}, 'scheduled_event':{'trigger','advance_idle'}}[kind]:
                raise RuntimeFault('unsupported_command')
            intent.typed_args()
            canonical(intent.model_dump())
        except (ValidationError, RuntimeFault, UnicodeError, KeyError) as exc:
            self._store.audit('invalid_intent', worldline)
            raise RuntimeFault('invalid_intent') from exc
        if intent.engine_version != ENGINE:
            raise RuntimeFault('unsupported_engine')
        if kind == 'actor_action' and intent.contract_version != CONTRACT:
            raise RuntimeFault('unsupported_schema')
        if intent.actor_id != grant.actor_id or intent.world_id != grant.world_id:
            self._store.audit('unauthorized', worldline, intent.request_id)
            raise RuntimeFault('unauthorized')
        if grant.role == 'participant' and intent.action_type not in ('speak','move','take','transfer','observe','wait','read','compare'):
            raise RuntimeFault('participant_action_not_allowed')
        return self._store.commit_transition(intent, grant.subject, grant.role, hook=hook, input_identity=input_identity, worker=worker)

    def configure_autonomy(self, token, worldline, actors, limit, mode='rules'):
        self._authorize(token, worldline, 'autonomy')
        if mode not in ('rules','model'): raise RuntimeFault('invalid_autonomy_mode')
        if mode == 'model' and self.model_policy is None: raise RuntimeFault('model_not_enabled')
        if mode == 'model':
            state = self._store.read_at(worldline)
            ledger = getattr(self.model_policy, 'ledger', None)
            allowance = ledger.allocation(worldline) if ledger else None
            if state.social and not allowance:
                raise RuntimeFault('worldline_model_budget_required')
            if state.lineage and not allowance:
                raise RuntimeFault('fork_model_budget_required')
        self._store.configure_autonomy(worldline, actors, limit, mode)

    def read_at(self, token, worldline, seq=None):
        self._authorize(token, worldline, 'read')
        return self._store.read_at(worldline, seq)

    def baseline(self, token, worldline):
        self._authorize(token, worldline, 'read')
        return self._store.baseline(worldline)

    def control(self, token, worldline, *, resume=False):
        self._authorize(token, worldline, 'control')
        result = self._store.control(worldline, resume)
        if self.model_policy:
            import json
            policy=json.loads(result['ledger']).get('autonomy',{})
            self.model_policy.ledger.set_active(worldline,bool(resume and policy.get('enabled') and policy.get('mode')=='model'))
        return result

    def diagnostic(self, token, worldline):
        self._authorize(token, worldline, 'read')
        return self._store.control_state(worldline)

    def shutdown(self):
        ledger=getattr(self.model_policy,'ledger',None)
        if ledger and ledger.version==2:
            with ledger.connection() as conn: lines=[r[0] for r in conn.execute('SELECT worldline FROM allocations')]
            for line in lines: ledger.set_active(line,False)
        if self._store is not None:
            with self._store.connection() as conn:
                conn.execute('UPDATE runtime_v2_execution_control SET epoch=epoch+1,status=? WHERE status=?', ('paused', 'running'))
                conn.commit()
        self._grants.clear()
