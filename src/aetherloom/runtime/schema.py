"""Explicit standalone/shared storage layouts; validation never applies DDL."""
import json
import sqlite3

from .contracts import ENGINE
from .domain import RuntimeFault

DDL = [
    'CREATE TABLE runtime_v2_worldlines(id TEXT PRIMARY KEY,world_id TEXT NOT NULL,engine_version TEXT NOT NULL, initial TEXT NOT NULL, initial_hash TEXT NOT NULL, state TEXT NOT NULL, state_hash TEXT NOT NULL, head_seq INTEGER NOT NULL)',
    'CREATE TABLE runtime_v2_execution_control(worldline_id TEXT PRIMARY KEY REFERENCES runtime_v2_worldlines(id), epoch INTEGER NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, ledger TEXT NOT NULL)',
    'CREATE TABLE runtime_v2_journal(worldline_id TEXT NOT NULL REFERENCES runtime_v2_worldlines(id),seq INTEGER NOT NULL,event_id TEXT UNIQUE NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(worldline_id,seq))',
    'CREATE TABLE runtime_v2_receipts(worldline_id TEXT NOT NULL REFERENCES runtime_v2_worldlines(id),request_id TEXT NOT NULL,intent_digest TEXT NOT NULL,subject TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(worldline_id,request_id))',
    'CREATE TABLE runtime_v2_outbox(worldline_id TEXT NOT NULL,seq INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(worldline_id,seq),FOREIGN KEY(worldline_id,seq) REFERENCES runtime_v2_journal(worldline_id,seq))',
    'CREATE TABLE runtime_v2_audit(id INTEGER PRIMARY KEY,worldline_id TEXT,request_id TEXT,code TEXT NOT NULL)',
    "CREATE TRIGGER journal_no_update BEFORE UPDATE ON runtime_v2_journal BEGIN SELECT RAISE(ABORT,'append_only'); END",
    "CREATE TRIGGER journal_no_delete BEFORE DELETE ON runtime_v2_journal BEGIN SELECT RAISE(ABORT,'append_only'); END",
    "CREATE TRIGGER initial_immutable BEFORE UPDATE OF initial,initial_hash ON runtime_v2_worldlines BEGIN SELECT RAISE(ABORT,'immutable_checkpoint'); END",
]

LEGACY_ENGINE = 'text-world-v1'
LEGACY_VERSION = 8
SCHEMA_SQL = 'CREATE TABLE runtime_v2_schema(version INTEGER PRIMARY KEY,engine TEXT NOT NULL)'
LEDGER_SQL = 'CREATE TABLE runtime_v2_migrations(version INTEGER PRIMARY KEY,legacy_version INTEGER NOT NULL,definition TEXT NOT NULL)'
REGISTRY_SQL = """CREATE VIEW runtime_v2_registry AS
SELECT json_extract(manifest,'$.run_config.engine_version') AS engine_version,
id AS worldline_id,world_id,'legacy' AS storage FROM simulations
UNION ALL SELECT engine_version,id,world_id,'runtime' FROM runtime_v2_worldlines"""
MIGRATIONS = {
    1: tuple(DDL) + (SCHEMA_SQL, LEDGER_SQL, REGISTRY_SQL),
    2: (
        'CREATE TABLE runtime_v2_baselines(id TEXT PRIMARY KEY,world_id TEXT NOT NULL,manifest TEXT NOT NULL)',
        'CREATE TABLE runtime_v2_baseline_links(worldline_id TEXT PRIMARY KEY REFERENCES runtime_v2_worldlines(id),baseline_id TEXT NOT NULL REFERENCES runtime_v2_baselines(id))',
        "CREATE TRIGGER runtime_v2_baseline_no_update BEFORE UPDATE ON runtime_v2_baselines BEGIN SELECT RAISE(ABORT,'immutable_baseline'); END",
        "CREATE TRIGGER runtime_v2_baseline_no_delete BEFORE DELETE ON runtime_v2_baselines BEGIN SELECT RAISE(ABORT,'immutable_baseline'); END",
        "CREATE TRIGGER runtime_v2_baseline_link_no_update BEFORE UPDATE ON runtime_v2_baseline_links BEGIN SELECT RAISE(ABORT,'immutable_baseline_link'); END",
        "CREATE TRIGGER runtime_v2_baseline_link_no_delete BEFORE DELETE ON runtime_v2_baseline_links BEGIN SELECT RAISE(ABORT,'immutable_baseline_link'); END",
    ),
    3: (
        'CREATE TABLE runtime_v2_scenarios(worldline_id TEXT PRIMARY KEY REFERENCES runtime_v2_worldlines(id),world_id TEXT NOT NULL,request_id TEXT NOT NULL,request TEXT NOT NULL,manifest TEXT NOT NULL,UNIQUE(world_id,request_id))',
        "CREATE TRIGGER runtime_v2_scenario_no_update BEFORE UPDATE ON runtime_v2_scenarios BEGIN SELECT RAISE(ABORT,'immutable_scenario'); END",
        "CREATE TRIGGER runtime_v2_scenario_no_delete BEFORE DELETE ON runtime_v2_scenarios BEGIN SELECT RAISE(ABORT,'immutable_scenario'); END",
    ),
    4: (
        'CREATE TABLE runtime_v2_checkpoints(worldline_id TEXT NOT NULL REFERENCES runtime_v2_worldlines(id),seq INTEGER NOT NULL,state TEXT NOT NULL,state_hash TEXT NOT NULL,PRIMARY KEY(worldline_id,seq))',
        'CREATE TABLE runtime_v2_forks(child_id TEXT PRIMARY KEY REFERENCES runtime_v2_worldlines(id),parent_id TEXT NOT NULL REFERENCES runtime_v2_worldlines(id),anchor_seq INTEGER NOT NULL,world_id TEXT NOT NULL,request_id TEXT NOT NULL,request TEXT NOT NULL,title TEXT NOT NULL,UNIQUE(world_id,request_id))',
        'CREATE TABLE runtime_v2_review(id TEXT PRIMARY KEY,worldline_id TEXT NOT NULL,seq INTEGER NOT NULL,world_id TEXT NOT NULL REFERENCES worlds(id),kind TEXT NOT NULL,payload TEXT NOT NULL,bindings TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT \'pending\',target_type TEXT,target_id TEXT,created_at TEXT NOT NULL,UNIQUE(worldline_id,seq,kind),FOREIGN KEY(worldline_id,seq) REFERENCES runtime_v2_journal(worldline_id,seq))',
        'CREATE TABLE runtime_v2_review_sources(object_type TEXT NOT NULL,object_id TEXT NOT NULL,proposal_id TEXT NOT NULL REFERENCES runtime_v2_review(id),PRIMARY KEY(object_type,object_id,proposal_id))',
        "CREATE TRIGGER runtime_v2_checkpoint_no_update BEFORE UPDATE ON runtime_v2_checkpoints BEGIN SELECT RAISE(ABORT,'immutable_checkpoint'); END",
        "CREATE TRIGGER runtime_v2_checkpoint_no_delete BEFORE DELETE ON runtime_v2_checkpoints BEGIN SELECT RAISE(ABORT,'immutable_checkpoint'); END",
        "CREATE TRIGGER runtime_v2_fork_no_update BEFORE UPDATE ON runtime_v2_forks BEGIN SELECT RAISE(ABORT,'immutable_lineage'); END",
        "CREATE TRIGGER runtime_v2_fork_no_delete BEFORE DELETE ON runtime_v2_forks BEGIN SELECT RAISE(ABORT,'immutable_lineage'); END",
        "CREATE TRIGGER runtime_v2_review_evidence_immutable BEFORE UPDATE OF worldline_id,seq,world_id,kind,bindings,created_at ON runtime_v2_review BEGIN SELECT RAISE(ABORT,'immutable_review_evidence'); END",
    ),
}
CORE_TABLES = {'runtime_v2_worldlines', 'runtime_v2_execution_control', 'runtime_v2_journal',
               'runtime_v2_receipts', 'runtime_v2_outbox', 'runtime_v2_audit', 'runtime_v2_schema'}
LEGACY_COLUMNS = {
    'schema_migrations': {'version', 'applied_at'},
    'worlds': {'id', 'name', 'version'},
    'simulations': {'id', 'world_id', 'revision_id', 'manifest', 'initial_state', 'state', 'status', 'generation', 'cursor', 'calls', 'cost'},
    'simulation_events': {'simulation_id', 'seq', 'actor_id', 'payload', 'diff', 'narration', 'accepted'},
    'simulation_calls': {'id', 'simulation_id', 'status', 'context', 'draft', 'raw_output', 'usage', 'reserved', 'cost'},
    'simulation_revisions': {'id', 'world_id', 'revision', 'snapshot'},
    'simulation_proposals': {'id', 'simulation_id', 'seq', 'world_id', 'kind', 'payload', 'version', 'status', 'target_id'},
    'simulation_sources': {'object_type', 'object_id', 'proposal_id'},
    'content_versions': {'node_id', 'version', 'title', 'document', 'metadata'},
    'material_sources': {'id', 'node_id', 'source_version'},
    'canon_sources': {'object_type', 'object_id'},
    'canon_events': {'id', 'world_id', 'title'},
    'canon_heads': {'world_id', 'revision'},
}


def tables(conn):
    return {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}


def check_legacy(conn):
    if conn.execute('PRAGMA application_id').fetchone()[0] != 0 or conn.execute('PRAGMA user_version').fetchone()[0] != 0:
        raise RuntimeFault('unsupported_legacy_schema')
    for name, required in LEGACY_COLUMNS.items():
        if not required <= {row[1] for row in conn.execute('PRAGMA table_info(' + name + ')')}:
            raise RuntimeFault('unsupported_legacy_schema')
    if [row[0] for row in conn.execute('SELECT version FROM schema_migrations ORDER BY version')] != list(range(1, LEGACY_VERSION + 1)):
        raise RuntimeFault('unsupported_legacy_schema')
    for row in conn.execute('SELECT manifest FROM simulations'):
        if json.loads(row[0]).get('run_config', {}).get('engine_version') != LEGACY_ENGINE:
            raise RuntimeFault('unsupported_legacy_engine')


def _normal(sql):
    return ' '.join(sql.strip().rstrip(';').split())


def check_shared(conn):
    """Validate a known forward prefix, SQL definitions and reserved namespace."""
    check_legacy(conn)
    objects = conn.execute("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall()
    sqls = {_normal(row[1]) for row in objects if row[1]}
    names = {row[0] for row in objects}
    if 'runtime_v2_migrations' not in names:
        if any(name.startswith('runtime_v2_') for name in names) or any(_normal(sql) in sqls for sql in DDL):
            raise RuntimeFault('partial_runtime_schema')
        return 0
    rows = conn.execute('SELECT version,legacy_version,definition FROM runtime_v2_migrations ORDER BY version').fetchall()
    if not rows or [r[0] for r in rows] != list(range(1, len(rows) + 1)):
        raise RuntimeFault('unsupported_runtime_schema')
    for version, source, definition in rows:
        if version not in MIGRATIONS or source != LEGACY_VERSION:
            raise RuntimeFault('unsupported_runtime_schema')
        if json.loads(definition) != list(MIGRATIONS[version]):
            raise RuntimeFault('migration_definition_mismatch')
        if any(_normal(sql) not in sqls for sql in MIGRATIONS[version]):
            raise RuntimeFault('partial_runtime_schema')
    if [tuple(row) for row in conn.execute('SELECT version,engine FROM runtime_v2_schema ORDER BY version')] != [(i, ENGINE) for i in range(1, len(rows) + 1)]:
        raise RuntimeFault('unsupported_runtime_schema')
    # No silently accepted future/stray runtime table outside the known prefix.
    expected_names = set()
    for version in range(1, len(rows) + 1):
        for statement in MIGRATIONS[version]:
            expected_names.add(statement.split()[2].split('(')[0])
    if any(name.startswith('runtime_v2_') and name not in expected_names for name in names):
        raise RuntimeFault('unsupported_runtime_schema')
    return len(rows)


def check_runtime(conn, layout):
    try:
        if layout == 'shared':
            version = check_shared(conn)
            if not version:
                raise RuntimeFault('runtime_migration_required')
            return version
        if layout != 'standalone':
            raise RuntimeFault('unsupported_storage_layout')
        if (tables(conn) != CORE_TABLES or conn.execute('PRAGMA application_id').fetchone()[0] != 1095062600
            or conn.execute('PRAGMA user_version').fetchone()[0] != 1
            or [tuple(row) for row in conn.execute('SELECT version,engine FROM runtime_v2_schema')] != [(1, ENGINE)]):
            raise RuntimeFault('unsupported_runtime_schema')
        return 1
    except (ValueError, sqlite3.DatabaseError) as exc:
        if isinstance(exc, RuntimeFault):
            raise
        raise RuntimeFault('unsupported_runtime_schema') from exc
