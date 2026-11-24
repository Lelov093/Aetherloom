"""SQLite Creation repository. Version checks and history use one write transaction."""

import json
from datetime import UTC, datetime
from uuid import uuid4
from .worlds import WorldRepository
from .creation_models import inspect_document
from . import canon
from .canon_management import CanonManagementMixin, initialize as initialize_management, initialize_map_connections


class CreationError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


def now():
    return datetime.now(UTC).isoformat()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def record(row):
    result = dict(row)
    for key in ('document', 'metadata', 'aliases', 'sections', 'core', 'typed_value', 'source', 'tags', 'linked_nodes', 'linked_entities'):
        if key in result:
            result[key] = json.loads(result[key]) if result[key] is not None else None
    if 'map_connection' in result:
        result['map_connection'] = bool(result['map_connection'])
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
            initialize_map_connections(conn)
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
            conn.execute('''CREATE TABLE IF NOT EXISTS inspirations (
                id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id),
                title TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
                origin TEXT NOT NULL CHECK(origin IN ('manual','simulation')),
                source TEXT NOT NULL DEFAULT '{}',
                tags TEXT NOT NULL DEFAULT '[]',
                linked_nodes TEXT NOT NULL DEFAULT '[]',
                linked_entities TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
                version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )''')
            columns = {row[1] for row in conn.execute('PRAGMA table_info(inspirations)')}
            if 'tags' not in columns:
                conn.execute("ALTER TABLE inspirations ADD COLUMN tags TEXT NOT NULL DEFAULT '[]'")
            conn.execute('CREATE INDEX IF NOT EXISTS inspirations_world_status ON inspirations(world_id,status,updated_at)')
            conn.execute('INSERT OR IGNORE INTO schema_migrations VALUES(7,CURRENT_TIMESTAMP)')
            conn.commit()

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

    def _validate_inspiration_links(self, conn, world_id, linked_nodes, linked_entities):
        if len(set(linked_nodes)) != len(linked_nodes) or len(set(linked_entities)) != len(linked_entities):
            raise CreationError('灵感关联不能重复。')
        if linked_nodes:
            marks = ','.join('?' for _ in linked_nodes)
            rows = conn.execute(f'''SELECT n.id FROM nodes n JOIN works w ON w.id=n.work_id
                WHERE n.id IN ({marks}) AND w.world_id=?''', (*linked_nodes, world_id)).fetchall()
            if {row[0] for row in rows} != set(linked_nodes):
                raise CreationError('灵感关联的资料不属于当前世界。', 404)
        if linked_entities:
            marks = ','.join('?' for _ in linked_entities)
            rows = conn.execute(f'SELECT id FROM entities WHERE id IN ({marks}) AND world_id=?', (*linked_entities, world_id)).fetchall()
            if {row[0] for row in rows} != set(linked_entities):
                raise CreationError('灵感关联的对象不属于当前世界。', 404)

    def _normalize_inspiration_tags(self, tags):
        if not isinstance(tags, list) or len(tags) > 20:
            raise CreationError('灵感标签格式不正确。')
        values = []
        for value in tags:
            if not isinstance(value, str):
                raise CreationError('灵感标签格式不正确。')
            value = value.strip()
            if not value or len(value) > 40:
                raise CreationError('灵感标签格式不正确。')
            if value not in values:
                values.append(value)
        return values

    def _inspiration(self, conn, identity):
        item = self.required(conn, 'inspirations', identity)
        node_ids = item.get('linked_nodes', [])
        entity_ids = item.get('linked_entities', [])
        item['linked_node_ids'] = node_ids
        item['linked_entity_ids'] = entity_ids
        item['tags'] = item.get('tags', [])
        item['linked_nodes'] = [dict(row) for row in conn.execute('''SELECT n.id,n.title,n.work_id,w.title AS work_title,n.version,n.status
            FROM nodes n JOIN works w ON w.id=n.work_id WHERE n.id IN (%s) ORDER BY n.title,n.id''' %
            (','.join('?' for _ in node_ids) or "''"), tuple(node_ids))] if node_ids else []
        item['linked_entities'] = [dict(row) for row in conn.execute('''SELECT id,name,kind,version,status
            FROM entities WHERE id IN (%s) ORDER BY name,id''' %
            (','.join('?' for _ in entity_ids) or "''"), tuple(entity_ids))] if entity_ids else []
        return item

    def create_inspiration(self, world_id, data, *, origin='manual', source=None):
        if origin not in ('manual', 'simulation'):
            raise CreationError('灵感来源类型无效。')
        source = dict(source or {})
        if source and source.get('world_id') not in (None, world_id):
            raise CreationError('灵感来源不属于当前世界。', 404)
        linked_nodes = list(data.get('linked_nodes', []))
        linked_entities = list(data.get('linked_entities', []))
        tags = self._normalize_inspiration_tags(data.get('tags', []))
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            self.writable_world(conn, world_id)
            self._validate_inspiration_links(conn, world_id, linked_nodes, linked_entities)
            identity, timestamp = str(uuid4()), now()
            conn.execute('''INSERT INTO inspirations(id,world_id,title,note,origin,source,tags,linked_nodes,linked_entities,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)''', (identity, world_id, data['title'], data.get('note',''), origin,
                encoded(source), encoded(tags), encoded(linked_nodes), encoded(linked_entities), timestamp, timestamp))
            return self._inspiration(conn, identity)

    def list_inspirations(self, world_id, *, query='', origin=None, status='active', node_id=None,
                          worldline_id=None, character_id=None, location_id=None, tag=None, offset=0, limit=30):
        self.get(world_id)
        if status not in ('active', 'archived', 'all'):
            raise CreationError('灵感状态无效。')
        with self.connection() as conn:
            where = ['world_id=?']
            args = [world_id]
            if status != 'all':
                where.append('status=?'); args.append(status)
            if origin:
                if origin not in ('manual','simulation'): raise CreationError('灵感来源类型无效。')
                where.append('origin=?'); args.append(origin)
            if query.strip():
                where.append('(title LIKE ? ESCAPE \'\\\' OR note LIKE ? ESCAPE \'\\\')')
                pattern = '%' + query.replace('\\','\\\\').replace('%','\\%').replace('_','\\_') + '%'
                args.extend([pattern, pattern])
            if node_id:
                where.append("EXISTS (SELECT 1 FROM json_each(linked_nodes) WHERE value=?)"); args.append(node_id)
            if worldline_id:
                where.append("json_extract(source,'$.worldline_id')=?"); args.append(worldline_id)
            if character_id:
                where.append("(json_extract(source,'$.actor_id')=? OR EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(source,'$.events'),'[]')) WHERE json_extract(value,'$.actor_id')=?))")
                args.extend([character_id, character_id])
            if location_id:
                where.append("(json_extract(source,'$.location_id')=? OR EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(source,'$.events'),'[]')) WHERE json_extract(value,'$.location_id')=?))")
                args.extend([location_id, location_id])
            if tag:
                where.append("EXISTS (SELECT 1 FROM json_each(tags) WHERE value=?)"); args.append(tag)
            clause = ' AND '.join(where)
            total = conn.execute('SELECT count(*) FROM inspirations WHERE ' + clause, args).fetchone()[0]
            rows = conn.execute('SELECT id FROM inspirations WHERE ' + clause + ' ORDER BY updated_at DESC,id LIMIT ? OFFSET ?', (*args, limit, offset)).fetchall()
            facets = self._inspiration_facets(conn, world_id, status)
            return dict(items=[self._inspiration(conn, row[0]) for row in rows], total=total, offset=offset, limit=limit, facets=facets)

    def _inspiration_facets(self, conn, world_id, status='active'):
        args = [world_id]
        clause = 'world_id=?'
        if status != 'all':
            clause += ' AND status=?'; args.append(status)
        maps = {key: {} for key in ('worldlines', 'characters', 'locations', 'tags')}
        rows = conn.execute('SELECT source,tags FROM inspirations WHERE ' + clause, args).fetchall()
        for row in rows:
            source = json.loads(row['source'] or '{}')
            tags = json.loads(row['tags'] or '[]')
            events = source.get('events') or [source]
            seen = {key: set() for key in maps}
            for event in events:
                for group, value_key, label_key in (
                    ('worldlines', 'worldline_id', 'worldline_id'),
                    ('characters', 'actor_id', 'actor_name'),
                    ('locations', 'location_id', 'location_name'),
                ):
                    value = event.get(value_key)
                    if value and value not in seen[group]:
                        item = maps[group].setdefault(value, {'value': value, 'label': event.get(label_key) or value, 'count': 0})
                        item['count'] += 1
                        seen[group].add(value)
            for value in tags:
                if value not in seen['tags']:
                    item = maps['tags'].setdefault(value, {'value': value, 'label': value, 'count': 0})
                    item['count'] += 1
                    seen['tags'].add(value)
        return {key: sorted(values.values(), key=lambda item: (-item['count'], item['label'])) for key, values in maps.items()}

    def get_inspiration(self, identity):
        with self.connection() as conn:
            return self._inspiration(conn, identity)

    def update_inspiration(self, identity, data):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            item = self.required(conn, 'inspirations', identity)
            self.writable_world(conn, item['world_id'])
            self.expected(item, data.pop('version'))
            values = dict(title=item['title'], note=item['note'], status=item['status'], tags=item.get('tags', []),
                linked_nodes=item.get('linked_nodes', []), linked_entities=item.get('linked_entities', []))
            values.update({key: value for key, value in data.items() if value is not None})
            values['tags'] = self._normalize_inspiration_tags(values['tags'])
            self._validate_inspiration_links(conn, item['world_id'], values['linked_nodes'], values['linked_entities'])
            conn.execute('''UPDATE inspirations SET title=?,note=?,tags=?,linked_nodes=?,linked_entities=?,status=?,version=version+1,updated_at=? WHERE id=?''',
                (values['title'], values['note'], encoded(values['tags']), encoded(values['linked_nodes']), encoded(values['linked_entities']), values['status'], now(), identity))
            return self._inspiration(conn, identity)
