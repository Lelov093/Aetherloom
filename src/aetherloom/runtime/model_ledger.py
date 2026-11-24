"""Explicitly provisioned execution ledger; never part of World Truth or Replay.

Money uses integer micro-CNY. An interrupted/unknown request keeps its entire
reservation: cancelling HTTP does not prove the provider stopped billing.
"""
from contextlib import contextmanager, closing
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import time

from .domain import RuntimeFault, canonical


class ModelLedger:
    @classmethod
    def initialize_session(cls, path, profile, *, approval_id, limit_micro, max_calls, input_tokens, output_tokens):
        """Explicit Host provisioning after approval; never called by app startup/UI."""
        if (not isinstance(approval_id, str) or not approval_id.strip() or type(limit_micro) is not int
            or not 0 < limit_micro <= 10_000_000 or type(max_calls) is not int or not 1 <= max_calls <= 2000
            or type(input_tokens) is not int or type(output_tokens) is not int or min(input_tokens, output_tokens) < 1):
            raise RuntimeFault('invalid_model_budget')
        # Bootstrap the existing tables; the file must be new. No old ledger upgrade.
        cls.initialize(path, profile)
        with closing(sqlite3.connect(path)) as conn:
            conn.executescript('''
                CREATE TABLE approval(id INTEGER PRIMARY KEY CHECK(id=1), approval_id TEXT NOT NULL,
                    input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL);
                CREATE TABLE allocations(worldline TEXT PRIMARY KEY, limit_micro INTEGER NOT NULL,
                    max_calls INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
                    max_actions INTEGER NOT NULL, max_cognition INTEGER NOT NULL, runtime_seconds INTEGER NOT NULL,
                    elapsed_seconds INTEGER NOT NULL DEFAULT 0, active_since INTEGER);
                CREATE TABLE committed_attempts(id TEXT PRIMARY KEY REFERENCES attempts(id),kind TEXT NOT NULL);
            ''')
            conn.execute('UPDATE config SET version=2,limit_micro=?,max_calls=?', (limit_micro,max_calls))
            conn.execute('INSERT INTO approval VALUES(1,?,?,?)', (approval_id,input_tokens,output_tokens))
            conn.commit()
        return cls(path, profile)

    @classmethod
    def initialize(cls, path, profile, *, limit_micro=10_000_000, max_calls=8):
        if type(limit_micro) is not int or not 0 < limit_micro <= 10_000_000 or not 1 <= max_calls <= 8:
            raise RuntimeFault('invalid_model_budget')
        path = Path(path).resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('xb'): pass
        with closing(sqlite3.connect(path)) as conn:
            conn.executescript('''
                CREATE TABLE config(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,
                    profile TEXT NOT NULL,limit_micro INTEGER NOT NULL,max_calls INTEGER NOT NULL);
                CREATE TABLE attempts(id TEXT PRIMARY KEY,worldline TEXT NOT NULL,actor TEXT NOT NULL,
                    seq INTEGER NOT NULL,epoch INTEGER NOT NULL,status TEXT NOT NULL,
                    reserved_micro INTEGER NOT NULL,charged_micro INTEGER NOT NULL,
                    request TEXT NOT NULL,response TEXT NOT NULL,usage TEXT NOT NULL,
                    outcome TEXT NOT NULL,started TEXT NOT NULL,finished TEXT);
            ''')
            conn.execute('INSERT INTO config VALUES(1,1,?,?,?)', (canonical(profile), limit_micro, max_calls))
            conn.commit()
        return cls(path, profile)

    def __init__(self, path, profile):
        self.path = Path(path).resolve()
        if not self.path.is_file(): raise RuntimeFault('model_ledger_required')
        # Opening a ledger must not silently create or migrate a production DB.
        with closing(sqlite3.connect(self.path.as_uri() + '?mode=ro', uri=True)) as conn:
            config = conn.execute('SELECT version,profile,limit_micro,max_calls FROM config WHERE id=1').fetchone()
            if (not config or config[0] not in (1,2) or json.loads(config[1]) != profile
                or not 0 < config[2] <= 10_000_000 or not 1 <= config[3] <= (8 if config[0] == 1 else 2000)):
                raise RuntimeFault('model_ledger_profile_mismatch')
            self.version = config[0]
            self.approval_id = conn.execute('SELECT approval_id FROM approval').fetchone()[0] if self.version==2 else None
        self.profile = profile

    def allocate(self, worldline, *, limit_micro, max_calls, input_tokens, output_tokens,
                 max_actions=60, max_cognition=16, runtime_seconds=1800):
        """Assign once, including forks. Allocations consume a single approval pool."""
        values = (limit_micro,max_calls,input_tokens,output_tokens,max_actions,max_cognition,runtime_seconds)
        if self.version != 2 or any(type(v) is not int or v < 1 for v in values): raise RuntimeFault('invalid_model_allocation')
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if conn.execute('SELECT 1 FROM allocations WHERE worldline=?',(worldline,)).fetchone(): raise RuntimeFault('allocation_already_exists')
            total = conn.execute('SELECT limit_micro,max_calls FROM config').fetchone()
            tokens = conn.execute('SELECT input_tokens,output_tokens FROM approval').fetchone()
            allocated = conn.execute('SELECT coalesce(sum(limit_micro),0),coalesce(sum(max_calls),0),coalesce(sum(input_tokens),0),coalesce(sum(output_tokens),0) FROM allocations').fetchone()
            if any(used + add > cap for used, add, cap in zip(allocated,values[:4],(*total,*tokens))):
                raise RuntimeFault('approval_allocation_exceeded')
            conn.execute('INSERT INTO allocations(worldline,limit_micro,max_calls,input_tokens,output_tokens,max_actions,max_cognition,runtime_seconds) VALUES(?,?,?,?,?,?,?,?)', (worldline,*values))
            conn.commit()

    def allocation(self, worldline):
        if self.version != 2: return None
        with self.connection() as conn:
            row = conn.execute('SELECT * FROM allocations WHERE worldline=?',(worldline,)).fetchone()
            if not row: return None
            result = dict(row)
            result['elapsed_seconds'] += max(0,int(time.time())-row['active_since']) if row['active_since'] is not None else 0
            return result

    def set_active(self, worldline, active):
        if self.version != 2: return
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row=conn.execute('SELECT * FROM allocations WHERE worldline=?',(worldline,)).fetchone()
            if not row: return
            if active and row['active_since'] is None:
                conn.execute('UPDATE allocations SET active_since=? WHERE worldline=?',(int(time.time()),worldline))
            elif not active and row['active_since'] is not None:
                conn.execute('UPDATE allocations SET elapsed_seconds=elapsed_seconds+?,active_since=NULL WHERE worldline=?',
                    (max(0,int(time.time())-row['active_since']),worldline))
            conn.commit()

    def _usage(self, conn, worldline=None):
        rows = conn.execute('SELECT * FROM attempts' + (' WHERE worldline=?' if worldline else ''), (worldline,) if worldline else ()).fetchall()
        prompt, completion = 0, 0
        for row in rows:
            usage = json.loads(row['usage'])
            known = (type(usage.get('prompt_tokens')) is int and type(usage.get('completion_tokens')) is int
                     and 0 <= usage['prompt_tokens'] <= self.profile['input_tokens']
                     and 0 <= usage['completion_tokens'] <= self.profile['output_tokens'])
            prompt += usage['prompt_tokens'] if known else self.profile['input_tokens']
            completion += usage['completion_tokens'] if known else self.profile['output_tokens']
        return sum(r['charged_micro'] for r in rows),len(rows),prompt,completion

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=15)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            if conn.in_transaction: conn.rollback()
            conn.close()

    def recover(self):
        with self.connection() as conn:
            if self.version == 2:
                for row in conn.execute('SELECT worldline,active_since FROM allocations WHERE active_since IS NOT NULL').fetchall():
                    conn.execute('UPDATE allocations SET elapsed_seconds=elapsed_seconds+?,active_since=NULL WHERE worldline=?',
                        (max(0,int(time.time())-row['active_since']),row['worldline']))
            conn.execute("UPDATE attempts SET status='interrupted',charged_micro=reserved_micro,finished=? WHERE status IN ('reserved','running')", (self.now(),))
            conn.commit()

    @staticmethod
    def now(): return datetime.now(timezone.utc).isoformat()

    def reserve(self, attempt, context, epoch, request, reserved_micro):
        if type(reserved_micro) is not int or reserved_micro <= 0: raise RuntimeFault('invalid_model_reservation')
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if conn.execute('SELECT 1 FROM attempts WHERE id=?', (attempt,)).fetchone():
                raise RuntimeFault('model_attempt_already_exists')  # never resend the same HTTP request
            config = conn.execute('SELECT * FROM config WHERE id=1').fetchone()
            used, count = conn.execute('SELECT COALESCE(SUM(charged_micro),0),count(*) FROM attempts').fetchone()
            if count >= config['max_calls'] or used + reserved_micro > config['limit_micro']:
                raise RuntimeFault('model_budget_exhausted')
            if self.version == 2:
                allocation = conn.execute('SELECT * FROM allocations WHERE worldline=?',(context.worldline_id,)).fetchone()
                if not allocation: raise RuntimeFault('worldline_model_budget_required')
                approval = conn.execute('SELECT * FROM approval').fetchone()
                for scope, caps in ((None,config), (context.worldline_id,allocation)):
                    money,calls,prompt,completion = self._usage(conn,scope)
                    token_caps = approval if scope is None else allocation
                    if (money + reserved_micro > caps['limit_micro'] or calls >= caps['max_calls']
                        or prompt + self.profile['input_tokens'] > token_caps['input_tokens']
                        or completion + self.profile['output_tokens'] > token_caps['output_tokens']):
                        raise RuntimeFault('model_budget_exhausted')
                counts = dict(conn.execute('SELECT c.kind,count(*) FROM committed_attempts c JOIN attempts a ON a.id=c.id WHERE a.worldline=? GROUP BY c.kind',(context.worldline_id,)).fetchall())
                if (counts.get('actor_action',0) >= allocation['max_actions'] or counts.get('cognition',0) >= allocation['max_cognition']
                    or allocation['elapsed_seconds'] + (max(0,int(time.time())-allocation['active_since']) if allocation['active_since'] is not None else 0)
                        >= allocation['runtime_seconds']): raise RuntimeFault('model_run_limit')
            conn.execute('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (attempt, context.worldline_id, context.actor_id, context.watermark, epoch, 'reserved', reserved_micro,
                 reserved_micro, json.dumps(request, ensure_ascii=False, allow_nan=False), '', '{}', 'not_submitted', self.now(), None))
            conn.commit()

    def running(self, attempt):
        with self.connection() as conn:
            if conn.execute("UPDATE attempts SET status='running' WHERE id=? AND status='reserved'", (attempt,)).rowcount != 1:
                raise RuntimeFault('invalid_model_attempt_state')
            conn.commit()

    def finish(self, attempt, status, *, response='', usage=None):
        usage = usage if isinstance(usage, dict) else {}
        p, c = usage.get('prompt_tokens'), usage.get('completion_tokens')
        known = type(p) is int and type(c) is int and 0 <= p <= self.profile['input_tokens'] and 0 <= c <= self.profile['output_tokens']
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT * FROM attempts WHERE id=?', (attempt,)).fetchone()
            if not row: raise RuntimeFault('unknown_model_attempt')
            if row['status'] not in ('reserved', 'running'): return dict(row)  # idempotent settlement
            cost = p * self.profile['input_micro_per_token'] + c * self.profile['output_micro_per_token'] if known else row['reserved_micro']
            if status == 'succeeded' and not known: status = 'usage_unknown'
            conn.execute('UPDATE attempts SET status=?,charged_micro=?,response=?,usage=?,finished=? WHERE id=?',
                (status, cost, response, json.dumps(usage, ensure_ascii=False, allow_nan=False), self.now(), attempt))
            conn.commit()
            return {**dict(row), 'status': status, 'charged_micro': cost}

    def outcome(self, attempt, outcome, *, kind=None):
        with self.connection() as conn:
            conn.execute("UPDATE attempts SET outcome=? WHERE id=? AND outcome='not_submitted'", (outcome, attempt))
            if self.version == 2 and kind and outcome in ('committed','rule_rejected'):
                conn.execute('INSERT OR IGNORE INTO committed_attempts VALUES(?,?)',(attempt,kind))
            conn.commit()

    def cognition_recovery(self, context):
        """One correction after an empty proposal, across epochs and restarts.

        A reserved/interrupted correction also consumes that opportunity. This
        reads the existing execution ledger, never the world's event history.
        """
        with self.connection() as conn:
            rows = conn.execute('SELECT id,outcome FROM attempts WHERE worldline=? AND actor=? AND seq=? ORDER BY rowid',
                (context.worldline_id,context.actor_id,context.watermark)).fetchall()
        for index, row in enumerate(rows):
            if row['outcome'] == 'empty_model_cognition':
                return {'attempt_id':row['id'], 'correction_used':index+1 < len(rows)}
        return None

    def summary(self, worldline=None):
        with self.connection() as conn:
            config = conn.execute('SELECT limit_micro,max_calls FROM config WHERE id=1').fetchone()
            total, count = conn.execute('SELECT COALESCE(SUM(charged_micro),0),count(*) FROM attempts').fetchone()
            result = dict(limit_micro=config['limit_micro'], max_calls=config['max_calls'], charged_micro=total, calls=count)
            if self.version == 2:
                _,_,p,c = self._usage(conn)
                result.update(input_tokens=p,output_tokens=c)
                if worldline:
                    row = conn.execute('SELECT * FROM allocations WHERE worldline=?',(worldline,)).fetchone()
                    if row:
                        money,calls,p,c = self._usage(conn,worldline)
                        counts = dict(conn.execute('SELECT c.kind,count(*) FROM committed_attempts c JOIN attempts a ON a.id=c.id WHERE a.worldline=? GROUP BY c.kind',
                            (worldline,)).fetchall())
                        elapsed=row['elapsed_seconds']+(max(0,int(time.time())-row['active_since']) if row['active_since'] is not None else 0)
                        result['allocation'] = {**dict(row),'elapsed_seconds':elapsed,'charged_micro':money,'calls':calls,
                            'used_input_tokens':p,'used_output_tokens':c,
                            'used_actions':counts.get('actor_action',0),'used_cognition':counts.get('cognition',0)}
            return result
