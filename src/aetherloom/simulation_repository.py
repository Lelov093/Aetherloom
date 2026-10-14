"""Independent Simulation persistence. Only accepted Review writes Working Canon."""
import json
from uuid import uuid4
from .creation import CreationError, encoded, now
from .review import ReviewRepository
from .simulation_prepare import freeze, resolve


def unpack(row):
    data = dict(row)
    for key in ('manifest', 'initial_state', 'state', 'snapshot', 'payload', 'diff', 'usage', 'context'):
        if key in data:
            data[key] = json.loads(data[key])
    return data


class SimulationRepository(ReviewRepository):
    def __init__(self, path):
        super().__init__(path)
        with self.connection() as conn:
            conn.executescript('''
                CREATE TABLE IF NOT EXISTS simulation_revisions (
                    id TEXT PRIMARY KEY,world_id TEXT NOT NULL REFERENCES worlds(id),revision INTEGER NOT NULL,
                    snapshot TEXT NOT NULL,created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS simulations (
                    id TEXT PRIMARY KEY,world_id TEXT NOT NULL REFERENCES worlds(id),revision_id TEXT NOT NULL REFERENCES simulation_revisions(id),
                    title TEXT NOT NULL,manifest TEXT NOT NULL,initial_state TEXT NOT NULL,state TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'paused',generation INTEGER NOT NULL DEFAULT 0,
                    cursor INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',calls INTEGER NOT NULL DEFAULT 0,
                    cost REAL NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS simulation_events (
                    simulation_id TEXT NOT NULL REFERENCES simulations(id),seq INTEGER NOT NULL,actor_id TEXT NOT NULL,
                    payload TEXT NOT NULL,diff TEXT NOT NULL,narration TEXT NOT NULL,accepted INTEGER NOT NULL,
                    created_at TEXT NOT NULL,PRIMARY KEY(simulation_id,seq));
                CREATE TABLE IF NOT EXISTS simulation_calls (
                    id TEXT PRIMARY KEY,simulation_id TEXT NOT NULL REFERENCES simulations(id),generation INTEGER NOT NULL,
                    actor_id TEXT NOT NULL,model TEXT NOT NULL,status TEXT NOT NULL,context TEXT NOT NULL,
                    draft TEXT NOT NULL DEFAULT '',raw_output TEXT NOT NULL DEFAULT '',usage TEXT NOT NULL DEFAULT '{}',
                    reserved REAL NOT NULL,cost REAL NOT NULL,created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS simulation_proposals (
                    id TEXT PRIMARY KEY,simulation_id TEXT NOT NULL REFERENCES simulations(id),seq INTEGER NOT NULL,
                    world_id TEXT NOT NULL REFERENCES worlds(id),kind TEXT NOT NULL,payload TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'pending',
                    target_type TEXT,target_id TEXT,created_at TEXT NOT NULL,
                    UNIQUE(simulation_id,seq,kind));
                CREATE TABLE IF NOT EXISTS simulation_sources (
                    object_type TEXT NOT NULL,object_id TEXT NOT NULL,proposal_id TEXT NOT NULL REFERENCES simulation_proposals(id),
                    PRIMARY KEY(object_type,object_id,proposal_id));
                INSERT OR IGNORE INTO schema_migrations VALUES(8,CURRENT_TIMESTAMP);
            ''')

    def session(self, conn, identity):
        row = conn.execute('SELECT * FROM simulations WHERE id=?', (identity,)).fetchone()
        if not row:
            raise CreationError('找不到此模拟。', 404)
        return unpack(row)

    def catalog(self, world):
        with self.connection() as conn:
            conn.execute('BEGIN')
            snapshot = freeze(self, conn, world)
            return {key:value for key,value in snapshot.items() if key in ('revision','entities','assertions','events','relationship_states')}

    def prepare(self, world, setup, create=False):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE' if create else 'BEGIN')
            snapshot = freeze(self, conn, world)
            prepared = resolve(self, conn, world, setup, snapshot)
            if not create:
                return prepared
            if prepared['errors'] or not setup.confirmed:
                raise CreationError('；'.join(prepared['errors']) or '请显式核对并确认本次起点、规则与各角色输入。', 409)
            sid, revision_id = str(uuid4()), str(uuid4())
            conn.execute('INSERT INTO simulation_revisions VALUES(?,?,?,?,?)', (revision_id, world, snapshot['revision'], encoded(snapshot), now()))
            manifest, initial = prepared['manifest'], prepared['initial_state']
            from pathlib import Path
            from .provider import ProviderSettings
            config = ProviderSettings.load(Path(__file__).resolve().parents[2]).public()
            manifest['run_config'] = {key: config[key] for key in ('protocol', 'host', 'model')}
            manifest['run_config'].update(engine_version='text-world-v1', max_output_tokens=1000,
                                          input_yuan_per_million=12, output_yuan_per_million=36,
                                          price_basis='DashScope Beijing, 2026-10-12')
            conn.execute('INSERT INTO simulations(id,world_id,revision_id,title,manifest,initial_state,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
                         (sid,world,revision_id,setup.title,encoded(manifest),encoded(initial),encoded(initial),now(),now()))
            return self.session(conn, sid)

    def listing(self, world):
        self.get(world)
        with self.connection() as conn:
            return [dict(r) for r in conn.execute('''
                SELECT s.id,s.title,s.status,s.cursor,s.error,s.calls,s.cost,s.created_at,s.updated_at,
                    json_extract(s.manifest,'$.setup.start_label') AS start_label,
                    (SELECT narration FROM simulation_events WHERE simulation_id=s.id ORDER BY seq DESC LIMIT 1) AS latest_narration
                FROM simulations s WHERE s.world_id=? ORDER BY s.created_at DESC,s.rowid DESC
            ''', (world,))]

    def detail(self, identity, after=0):
        with self.connection() as conn:
            conn.execute('BEGIN')
            session = self.session(conn, identity)
            session['events'] = [unpack(r) for r in conn.execute('SELECT * FROM simulation_events WHERE simulation_id=? AND seq>? ORDER BY seq', (identity,after))]
            session['stream'] = [dict(r) for r in conn.execute("SELECT id,actor_id,draft,status FROM simulation_calls WHERE simulation_id=? AND status='running'", (identity,))]
            session['proposals'] = [unpack(r) for r in conn.execute('SELECT * FROM simulation_proposals WHERE simulation_id=? ORDER BY created_at', (identity,))]
            return session

    def control(self, identity, resume=False):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            session = self.session(conn, identity)
            if resume:
                self.writable_world(conn, session['world_id'])
                if session['status'] in ('queued', 'running'):
                    return session
                if conn.execute("SELECT 1 FROM simulations WHERE status IN ('queued','running') AND id!=?", (identity,)).fetchone():
                    raise CreationError('初版同时运行一个会话，请先暂停其他模拟。', 409)
                cfg = session['manifest']['setup']
                if session['calls'] >= cfg['max_calls'] or session['cursor'] >= cfg['max_steps'] or session['cost'] >= cfg['budget_yuan']:
                    raise CreationError('本次运行额度已到达，请保留结果；新一段运行需建立新会话。', 409)
            conn.execute('UPDATE simulations SET status=?,generation=generation+1,error=?,updated_at=? WHERE id=?',
                         ('queued' if resume else 'paused','',now(),identity))
            if not resume:
                conn.execute("UPDATE simulation_calls SET status='cancelled' WHERE simulation_id=? AND status='running'", (identity,))
            return self.session(conn, identity)

    def pause_all(self, reason=''):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            conn.execute("UPDATE simulations SET status='paused',generation=generation+1,error=?,updated_at=? WHERE status IN ('queued','running')", (reason,now()))
            conn.execute("UPDATE simulation_calls SET status='cancelled' WHERE status='running'")

    def error(self, identity, generation, message):
        with self.connection() as conn:
            conn.execute("UPDATE simulations SET status='paused',generation=generation+1,error=?,updated_at=? WHERE id=? AND generation=? AND status IN ('queued','running')", (message,now(),identity,generation))

    def reserve(self, identity, generation, actor, model, context, input_bound, global_budget=10, global_calls=48):
        reserved = (input_bound * 12 + 1000 * 36) / 1_000_000
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            session = self.session(conn, identity)
            if session['generation'] != generation or session['status'] not in ('queued','running'):
                return None
            cfg = session['manifest']['setup']
            count, cost = conn.execute('SELECT count(*),coalesce(sum(cost),0) FROM simulation_calls').fetchone()
            if count >= global_calls or cost + reserved > global_budget or session['calls'] >= cfg['max_calls'] or session['cost'] + reserved > cfg['budget_yuan']:
                raise CreationError('调用／费用预算已到达，模拟已暂停。', 409)
            call = str(uuid4())
            conn.execute('INSERT INTO simulation_calls(id,simulation_id,generation,actor_id,model,status,context,reserved,cost,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
                         (call,identity,generation,actor,model,'running',encoded(context),reserved,reserved,now()))
            conn.execute("UPDATE simulations SET status='running',calls=calls+1,cost=cost+?,updated_at=? WHERE id=?", (reserved,now(),identity))
            return call

    def draft(self, call, text):
        with self.connection() as conn:
            conn.execute("UPDATE simulation_calls SET draft=? WHERE id=? AND status='running'", (text,call))

    def settle(self, call, usage, raw, status):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT * FROM simulation_calls WHERE id=?', (call,)).fetchone()
            if not row:
                return
            # Missing usage (including cancelled/failed streams) consumes its full reservation.
            actual = ((usage['prompt_tokens']*12 + usage['completion_tokens']*36)/1_000_000
                      if isinstance(usage.get('prompt_tokens'),int) and isinstance(usage.get('completion_tokens'),int) else row['reserved'])
            conn.execute('UPDATE simulations SET cost=cost+? WHERE id=?', (actual-row['cost'],row['simulation_id']))
            conn.execute('UPDATE simulation_calls SET usage=?,raw_output=?,cost=?,status=CASE WHEN status=\'cancelled\' THEN status ELSE ? END WHERE id=?',
                         (encoded(usage),raw,actual,status,call))
            if actual > row['reserved']:
                conn.execute("UPDATE simulations SET status='paused',generation=generation+1,error='实际用量超过预留，已停止后续调用。' WHERE id=?", (row['simulation_id'],))

    def commit_step(self, identity, generation, actor, action, state, diff, narration, accepted):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            current = self.session(conn, identity)
            if current['generation'] != generation or current['status'] != 'running':
                return False
            seq = current['cursor'] + 1
            conn.execute('INSERT INTO simulation_events VALUES(?,?,?,?,?,?,?,?)', (identity,seq,actor,encoded(action),encoded(diff),narration,int(accepted),now()))
            done = seq >= current['manifest']['setup']['max_steps']
            conn.execute('UPDATE simulations SET state=?,cursor=?,status=?,updated_at=? WHERE id=?', (encoded(state),seq,'completed' if done else 'running',now(),identity))
            return True
