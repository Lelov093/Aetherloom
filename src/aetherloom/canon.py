"""Canon history and M1 typed records, apart from future Simulation history."""
import json
from uuid import uuid4


def initialize(conn):
    if conn.execute('SELECT 1 FROM schema_migrations WHERE version=2').fetchone():
        initialize_spans(conn)
        return
    conn.executescript('''
        BEGIN IMMEDIATE;
        CREATE TABLE canon_heads (world_id TEXT PRIMARY KEY REFERENCES worlds(id), revision INTEGER NOT NULL);
        CREATE TABLE canon_changes (
            id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), revision INTEGER NOT NULL,
            object_type TEXT NOT NULL, object_id TEXT NOT NULL, payload TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE extraction_tasks (
            id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), node_id TEXT NOT NULL REFERENCES nodes(id),
            source_version INTEGER NOT NULL, baseline_revision INTEGER NOT NULL, source_text TEXT NOT NULL,
            range_start INTEGER NOT NULL, range_end INTEGER NOT NULL, chunks TEXT NOT NULL,
            completed_chunks INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '',
            provider_model TEXT NOT NULL, usage TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE review_candidates (
            id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES extraction_tasks(id),
            world_id TEXT NOT NULL REFERENCES worlds(id), node_id TEXT NOT NULL REFERENCES nodes(id),
            source_version INTEGER NOT NULL, source_quote TEXT NOT NULL, source_start INTEGER NOT NULL,
            source_end INTEGER NOT NULL, baseline_revision INTEGER NOT NULL,
            local_key TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, confidence REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending', version INTEGER NOT NULL DEFAULT 1,
            edited INTEGER NOT NULL DEFAULT 0, target_type TEXT, target_id TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(task_id,local_key));
        CREATE INDEX candidates_world ON review_candidates(world_id,status);
        CREATE TABLE canon_events (
            id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), title TEXT NOT NULL,
            description TEXT NOT NULL, location_id TEXT REFERENCES entities(id), valid_from TEXT, valid_until TEXT,
            origin TEXT NOT NULL DEFAULT 'canon' CHECK(origin='canon'), status TEXT NOT NULL DEFAULT 'active',
            version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE event_participants (
            event_id TEXT NOT NULL REFERENCES canon_events(id), entity_id TEXT NOT NULL REFERENCES entities(id),
            PRIMARY KEY(event_id,entity_id));
        CREATE TABLE temporal_relationships (
            id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id),
            subject_id TEXT NOT NULL REFERENCES entities(id), object_id TEXT NOT NULL REFERENCES entities(id),
            status TEXT NOT NULL DEFAULT 'active', UNIQUE(world_id,subject_id,object_id));
        CREATE TABLE relationship_states (
            id TEXT PRIMARY KEY, relationship_id TEXT NOT NULL REFERENCES temporal_relationships(id),
            label TEXT NOT NULL, description TEXT NOT NULL, valid_from TEXT, valid_until TEXT,
            status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE canon_sources (
            object_type TEXT NOT NULL, object_id TEXT NOT NULL, candidate_id TEXT NOT NULL REFERENCES review_candidates(id),
            PRIMARY KEY(object_type,object_id,candidate_id));
        INSERT INTO schema_migrations VALUES(2,CURRENT_TIMESTAMP);
        COMMIT;
    ''')
    initialize_spans(conn)


def initialize_spans(conn):
    if not conn.execute('SELECT 1 FROM schema_migrations WHERE version=3').fetchone():
        conn.execute("ALTER TABLE review_candidates ADD COLUMN source_spans TEXT NOT NULL DEFAULT '[]'")
        conn.execute('INSERT INTO schema_migrations VALUES(3,CURRENT_TIMESTAMP)')


def revision(conn, world_id):
    row = conn.execute('SELECT revision FROM canon_heads WHERE world_id=?', (world_id,)).fetchone()
    return row[0] if row else 1


def changed(conn, world_id, object_type, object_id, payload):
    next_revision = revision(conn, world_id) + 1
    conn.execute('INSERT INTO canon_heads VALUES(?,?) ON CONFLICT(world_id) DO UPDATE SET revision=excluded.revision',
                 (world_id, next_revision))
    conn.execute('INSERT INTO canon_changes(id,world_id,revision,object_type,object_id,payload) VALUES(?,?,?,?,?,?)',
                 (str(uuid4()), world_id, next_revision, object_type, object_id, json.dumps(payload, ensure_ascii=False)))
