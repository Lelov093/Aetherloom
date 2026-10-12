"""SQLite Creation repository. Version checks and history use one write transaction."""

import json
from datetime import UTC, datetime
from uuid import uuid4
from .worlds import WorldRepository
from .creation_models import inspect_document
from . import canon
from .canon_management import CanonManagementMixin, initialize as initialize_management


class CreationError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def now():
    return datetime.now(UTC).isoformat()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def record(row):
    result = dict(row)
    for key in ('document', 'metadata', 'aliases', 'sections', 'core', 'typed_value'):
        if key in result:
            result[key] = json.loads(result[key]) if result[key] is not None else None
    return result


class CreationRepository(CanonManagementMixin, WorldRepository):
    def __init__(self, path):
        super().__init__(path)
        with self.connection() as conn:
            conn.executescript('''
                BEGIN IMMEDIATE;
                CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS works (
                    id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id),
                    title TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
                    version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS nodes (
                    id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id),
                    parent_id TEXT REFERENCES nodes(id), title TEXT NOT NULL, kind TEXT NOT NULL,
                    position INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
                    document TEXT NOT NULL, plain_text TEXT NOT NULL, metadata TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS nodes_work ON nodes(work_id, parent_id, position);
                CREATE TABLE IF NOT EXISTS import_commits (batch_id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id));
                CREATE TABLE IF NOT EXISTS content_versions (
                    node_id TEXT NOT NULL REFERENCES nodes(id), version INTEGER NOT NULL,
                    title TEXT NOT NULL, document TEXT NOT NULL, metadata TEXT NOT NULL, saved_at TEXT NOT NULL,
                    PRIMARY KEY(node_id, version));
                CREATE TABLE IF NOT EXISTS entities (
                    id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id), name TEXT NOT NULL,
                    kind TEXT NOT NULL, aliases TEXT NOT NULL, sections TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active', version INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS entities_world ON entities(world_id, status);
                CREATE TABLE IF NOT EXISTS mentions (
                    node_id TEXT NOT NULL, content_version INTEGER NOT NULL, entity_id TEXT NOT NULL REFERENCES entities(id),
                    quote TEXT NOT NULL, FOREIGN KEY(node_id, content_version) REFERENCES content_versions(node_id, version));
                CREATE TABLE IF NOT EXISTS assertions (
                    id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id),
                    subject_id TEXT NOT NULL REFERENCES entities(id), predicate TEXT NOT NULL, value TEXT NOT NULL,
                    object_id TEXT REFERENCES entities(id), valid_from TEXT, valid_until TEXT,
                    source_note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
                INSERT OR IGNORE INTO schema_migrations VALUES (1, CURRENT_TIMESTAMP);
                COMMIT;
            ''')
            canon.initialize(conn)
            conn.commit()
            initialize_management(conn)
            if not conn.execute('SELECT 1 FROM schema_migrations WHERE version=5').fetchone():
                conn.execute('BEGIN IMMEDIATE')
                conn.execute('''CREATE TABLE extraction_failures (
                    id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES extraction_tasks(id),
                    chunk_index INTEGER NOT NULL, detail TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)''')
                conn.execute('CREATE INDEX failures_task ON extraction_failures(task_id)')
                conn.execute('INSERT INTO schema_migrations VALUES(5,CURRENT_TIMESTAMP)')
            conn.execute('''CREATE TABLE IF NOT EXISTS extraction_outputs (
                id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES extraction_tasks(id),
                chunk_index INTEGER NOT NULL, detail TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)''')
            conn.execute('CREATE INDEX IF NOT EXISTS outputs_task ON extraction_outputs(task_id)')
            conn.execute('INSERT OR IGNORE INTO schema_migrations VALUES(6,CURRENT_TIMESTAMP)')
            conn.commit()
            from .material_sources import initialize as initialize_sources
            initialize_sources(conn)

    def required(self, conn, table, identity):
        row = conn.execute(f'SELECT * FROM {table} WHERE id = ?', (identity,)).fetchone()
        if row is None:
            raise CreationError('找不到这个对象。', 404)
        return record(row)

    def writable_world(self, conn, world_id):
        if self.required(conn, 'worlds', world_id)['archived']:
            raise CreationError('请先恢复这个世界，再编辑内容。', 409)

    def expected(self, item, version):
        if item['version'] != version:
            raise CreationError('资料已更新。请保留当前修改，重新载入后比较。', 409)

    def get_item(self, table, identity):
        with self.connection() as conn:
            return self.required(conn, table, identity)

    def list_works(self, world_id):
        self.get(world_id)
        with self.connection() as conn:
            return [record(r) for r in conn.execute('SELECT * FROM works WHERE world_id=? ORDER BY created_at,id', (world_id,))]

    def create_work(self, world_id, data):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            self.writable_world(conn, world_id)
            identity, timestamp = str(uuid4()), now()
            conn.execute('INSERT INTO works(id,world_id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?,?)',
                         (identity, world_id, data['title'], data['kind'], timestamp, timestamp))
            return self.required(conn, 'works', identity)

    def update_work(self, identity, data):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            work = self.required(conn, 'works', identity)
            self.writable_world(conn, work['world_id'])
            self.expected(work, data.pop('version'))
            work.update(data)
            conn.execute('UPDATE works SET title=?,kind=?,status=?,version=version+1,updated_at=? WHERE id=?',
                         (work['title'], work['kind'], work['status'], now(), identity))
            return self.required(conn, 'works', identity)

    def list_nodes(self, work_id):
        self.get_item('works', work_id)
        with self.connection() as conn:
            return [record(r) for r in conn.execute('SELECT id,work_id,parent_id,title,kind,position,status,metadata,version,updated_at FROM nodes WHERE work_id=? ORDER BY position,created_at,id', (work_id,))]

    def validate_parent(self, conn, work_id, parent_id, identity=None):
        seen = {identity} if identity else set()
        cursor = parent_id
        while cursor:
            if cursor in seen:
                raise CreationError('文档不能移动到自己或自己的子目录中。')
            seen.add(cursor)
            parent = self.required(conn, 'nodes', cursor)
            if parent['work_id'] != work_id or parent['status'] != 'active':
                raise CreationError('请选择同一作品中的活跃目录。')
            cursor = parent['parent_id']

    def snapshot(self, conn, node, world_id):
        for key, kind in (('pov_id', 'character'), ('location_id', 'location')):
            if node['metadata'].get(key):
                entity = self.required(conn, 'entities', node['metadata'][key])
                if entity['world_id'] != world_id or entity['kind'] != kind or entity.get('merged_into'):
                    raise CreationError('文档视角或地点必须选择同世界、相应类型的保留对象。')
        _, mentions, links = inspect_document(node['document'])
        for entity_id, _ in mentions:
            if self.required(conn, 'entities', entity_id)['world_id'] != world_id:
                raise CreationError('不能链接另一世界的对象。')
        for link in links:
            target = self.required(conn, 'nodes', link)
            if self.required(conn, 'works', target['work_id'])['world_id'] != world_id:
                raise CreationError('不能链接另一世界的正文。')
        conn.execute('INSERT INTO content_versions VALUES(?,?,?,?,?,?)',
                     (node['id'], node['version'], node['title'], encoded(node['document']), encoded(node['metadata']), node['updated_at']))
        conn.executemany('INSERT INTO mentions VALUES(?,?,?,?)',
                         [(node['id'], node['version'], entity_id, quote) for entity_id, quote in mentions])

    def create_node_in(self, conn, work, data):
        self.validate_parent(conn, work['id'], data['parent_id'])
        text, _, _ = inspect_document(data['document'])
        identity, timestamp = str(uuid4()), now()
        position = conn.execute('SELECT COALESCE(MAX(position),-1)+1 FROM nodes WHERE work_id=? AND parent_id IS ?', (work['id'], data['parent_id'])).fetchone()[0]
        conn.execute('INSERT INTO nodes(id,work_id,parent_id,title,kind,position,document,plain_text,metadata,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                     (identity, work['id'], data['parent_id'], data['title'], data['kind'], position, encoded(data['document']), text, encoded(data['metadata']), timestamp, timestamp))
        node = self.required(conn, 'nodes', identity)
        self.snapshot(conn, node, work['world_id'])
        return node

    def create_node(self, work_id, data):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            work = self.required(conn, 'works', work_id)
            self.writable_world(conn, work['world_id'])
            if work['status'] != 'active':
                raise CreationError('请先恢复这部作品。', 409)
            return self.create_node_in(conn, work, data)

    def update_node(self, identity, data):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            node = self.required(conn, 'nodes', identity)
            work = self.required(conn, 'works', node['work_id'])
            self.writable_world(conn, work['world_id'])
            if work['status'] != 'active':
                raise CreationError('请先恢复这部作品。', 409)
            self.expected(node, data.pop('version'))
            if node['status'] != 'active' and set(data) - {'status'}:
                raise CreationError('请先恢复文档再编辑。', 409)
            old_parent = node['parent_id']
            node.update(data)
            if node['status'] == 'active':
                self.validate_parent(conn, node['work_id'], node['parent_id'], identity)
            text, _, _ = inspect_document(node['document'])
            conn.execute('UPDATE nodes SET title=?,kind=?,parent_id=?,position=?,status=?,document=?,plain_text=?,metadata=?,version=version+1,updated_at=? WHERE id=?',
                         (node['title'],node['kind'],node['parent_id'],node['position'],node['status'],encoded(node['document']),text,encoded(node['metadata']),now(),identity))
            if 'position' in data or 'parent_id' in data:
                self.reorder(conn, work, node['parent_id'], identity, node['position'])
                if old_parent != node['parent_id']:
                    self.reorder(conn, work, old_parent)
            result = self.required(conn, 'nodes', identity)
            self.snapshot(conn, result, work['world_id'])
            return result

    def reorder(self, conn, work, parent_id, moving=None, position=0):
        siblings = [record(r) for r in conn.execute('SELECT * FROM nodes WHERE work_id=? AND parent_id IS ? ORDER BY position,created_at,id', (work['id'], parent_id)) if r['id'] != moving]
        if moving:
            siblings.insert(min(position, len(siblings)), self.required(conn, 'nodes', moving))
        for index, sibling in enumerate(siblings):
            if sibling['position'] == index:
                continue
            if sibling['id'] == moving:
                conn.execute('UPDATE nodes SET position=? WHERE id=?', (index, moving))
            else:
                conn.execute('UPDATE nodes SET position=?,version=version+1,updated_at=? WHERE id=?', (index, now(), sibling['id']))
                self.snapshot(conn, self.required(conn, 'nodes', sibling['id']), work['world_id'])

    def history(self, identity, version=None):
        with self.connection() as conn:
            self.required(conn, 'nodes', identity)
            if version is not None:
                row = conn.execute('SELECT * FROM content_versions WHERE node_id=? AND version=?', (identity, version)).fetchone()
                if row is None:
                    raise CreationError('找不到这个历史版本。', 404)
                return record(row)
            return [dict(r) for r in conn.execute('SELECT node_id,version,title,saved_at FROM content_versions WHERE node_id=? ORDER BY version DESC', (identity,))]

    def list_entities(self, world_id):
        self.get(world_id)
        with self.connection() as conn:
            return [record(r) for r in conn.execute('SELECT * FROM entities WHERE world_id=? ORDER BY name,id', (world_id,))]

    def create_entity(self, world_id, data):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            self.writable_world(conn, world_id)
            identity, timestamp = str(uuid4()), now()
            conn.execute('INSERT INTO entities(id,world_id,name,kind,aliases,sections,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
                         (identity,world_id,data['name'],data['kind'],encoded(data['aliases']),encoded(data['sections']),timestamp,timestamp))
            canon.changed(conn, world_id, 'entity', identity, data)
            conn.execute('UPDATE entities SET core=?,custom_type=? WHERE id=?',(encoded(data.get('core',{})),data.get('custom_type',''),identity))
            self.save_snapshot(conn,'entity',identity)
            return self.required(conn, 'entities', identity)

    def update_entity(self, identity, data):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            entity = self.required(conn, 'entities', identity)
            self.writable_world(conn, entity['world_id'])
            self.expected(entity, data['version'])
            if entity.get('merged_into'):
                raise CreationError('对象已合并，请编辑保留的目标对象。',409)
            for key in ('name','kind','aliases','sections','status'):
                data.setdefault(key,entity[key])
            from .object_schema import CORE_FIELDS
            if set(data.get('core',entity['core'])) - set(CORE_FIELDS[data['kind']]):
                raise CreationError('核心字段不属于当前对象类型，请先明确整理。',400)
            if data.get('custom_type',entity['custom_type']) and data['kind']!='custom':
                raise CreationError('更改为内置类型前请明确清空自定义类型名称。',400)
            if data['kind']!=entity['kind'] and entity['core'] and 'core' not in data:
                raise CreationError('修改类型前请明确整理已有核心字段。',409)
            self.save_snapshot(conn,'entity',identity)
            conn.execute('UPDATE entities SET name=?,kind=?,aliases=?,sections=?,status=?,version=version+1,updated_at=? WHERE id=?',
                         (data['name'],data['kind'],encoded(data['aliases']),encoded(data['sections']),data['status'],now(),identity))
            canon.changed(conn, entity['world_id'], 'entity', identity, data)
            conn.execute('UPDATE entities SET core=?,custom_type=? WHERE id=?',(encoded(data.get('core',entity['core'])),data.get('custom_type',entity['custom_type']),identity))
            self.save_snapshot(conn,'entity',identity)
            return self.required(conn, 'entities', identity)

    def entity_context(self, identity):
        with self.connection() as conn:
            entity = self.required(conn, 'entities', identity)
            entity['facts'] = [record(r) for r in conn.execute('SELECT * FROM assertions WHERE subject_id=? ORDER BY created_at', (identity,))]
            for fact in entity['facts']:
                fact['sources'] = [row[0] for row in conn.execute("SELECT candidate_id FROM canon_sources WHERE object_type='assertion' AND object_id=?", (fact['id'],))]
            from .material_sources import mention_ranges
            appearances = []
            for row in conn.execute('''SELECT DISTINCT n.* FROM nodes n JOIN mentions m
                ON m.node_id=n.id AND m.content_version=n.version WHERE m.entity_id=? ORDER BY n.title''', (identity,)):
                text, ranges = mention_ranges(json.loads(row['document']))
                for entity_id, start, end in ranges:
                    if entity_id == identity:
                        appearances.append(dict(id=row['id'], title=row['title'], work_id=row['work_id'], version=row['version'],
                                                status=row['status'], quote=text[start:end], start=start, end=end))
            entity['appearances'] = appearances
            return entity

    def create_fact(self, identity, data):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            entity = self.required(conn, 'entities', identity)
            if entity.get('merged_into'):
                raise CreationError('对象已合并，请向目标对象添加事实。',409)
            self.writable_world(conn, entity['world_id'])
            if entity['status'] != 'active':
                raise CreationError('请先恢复对象再编辑事实。', 409)
            data = self.normalize_fact(conn,entity,data)
            fact_id = str(uuid4())
            conn.execute('INSERT INTO assertions(id,world_id,subject_id,predicate,value,object_id,valid_from,valid_until,source_note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
                         (fact_id,entity['world_id'],identity,data['predicate'],data['value'],data['object_id'],data['valid_from'],data['valid_until'],data['source_note'],now()))
            canon.changed(conn, entity['world_id'], 'assertion', fact_id, data)
            conn.execute('UPDATE assertions SET field_id=?,value_type=?,typed_value=? WHERE id=?',(data.get('field_id'),data['value_type'],encoded(data['typed_value']),fact_id))
            return self.save_snapshot(conn,'assertion',fact_id)

    def search(self, world_id, query):
        self.get(world_id)
        pattern = '%' + query.replace('\\', '\\\\').replace('%','\\%').replace('_','\\_') + '%'
        with self.connection() as conn:
            nodes = [dict(r) for r in conn.execute('''WITH RECURSIVE visible(id) AS (
                SELECT n.id FROM nodes n JOIN works w ON w.id=n.work_id WHERE w.world_id=? AND w.status='active' AND n.status='active' AND n.parent_id IS NULL
                UNION ALL SELECT n.id FROM nodes n JOIN visible v ON n.parent_id=v.id WHERE n.status='active')
                SELECT n.id,n.title,n.work_id,substr(n.plain_text,1,180) AS excerpt
                FROM nodes n JOIN visible v ON v.id=n.id WHERE
                (n.title LIKE ? ESCAPE '\\' OR n.plain_text LIKE ? ESCAPE '\\') LIMIT 100''', (world_id,pattern,pattern))]
            entities = [record(r) for r in conn.execute("SELECT * FROM entities WHERE world_id=? AND status='active' AND (name LIKE ? ESCAPE '\\' OR aliases LIKE ? ESCAPE '\\') LIMIT 100", (world_id,pattern,pattern))]
            return {'nodes': nodes, 'entities': entities}
