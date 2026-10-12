"""User-authored links to immutable material versions, independent of AI candidates."""
import json
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Request, Query
from pydantic import Field, model_validator
from .creation_models import Model, inspect_document

router = APIRouter(prefix='/api')
TargetKind = Literal['entity', 'assertion', 'event', 'relationship']
TABLES = {'entity': 'entities', 'assertion': 'assertions', 'event': 'canon_events', 'relationship': 'relationship_states'}


def initialize(conn):
    if conn.execute('SELECT 1 FROM schema_migrations WHERE version=7').fetchone():
        return
    conn.execute('BEGIN IMMEDIATE')
    conn.execute('''CREATE TABLE material_sources (
        id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id),
        object_type TEXT NOT NULL, object_id TEXT NOT NULL, original_object_id TEXT NOT NULL,
        node_id TEXT NOT NULL, source_version INTEGER NOT NULL,
        scope TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
        version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(node_id,source_version) REFERENCES content_versions(node_id,version))''')
    conn.execute('CREATE INDEX material_source_target ON material_sources(object_type,object_id,status)')
    conn.execute('CREATE INDEX material_source_node ON material_sources(node_id,status)')
    conn.execute('INSERT INTO schema_migrations VALUES(7,CURRENT_TIMESTAMP)')
    conn.commit()


def error(message, status=409):
    from .creation import CreationError
    raise CreationError(message, status)


def target(repo, conn, kind, identity):
    item = repo.required(conn, TABLES[kind], identity)
    if kind == 'relationship':
        pair = repo.required(conn, 'temporal_relationships', item['relationship_id'])
        item.update(world_id=pair['world_id'], subject_id=pair['subject_id'], object_id=pair['object_id'])
    return item


def visible_node(repo, conn, node):
    work = repo.required(conn, 'works', node['work_id'])
    active = work['status'] == 'active'
    cursor = node
    while cursor:
        active = active and cursor['status'] == 'active'
        cursor = repo.required(conn, 'nodes', cursor['parent_id']) if cursor['parent_id'] else None
    return work, active


def mention_ranges(document):
    """Offsets follow the same text projection as inspect_document, never a name search."""
    def walk(part):
        if part['type'] == 'text':
            text = part['text']
            return text, [(mark['attrs']['entityId'], 0, len(text)) for mark in part.get('marks', []) if mark['type'] == 'entityMention']
        if part['type'] == 'hardBreak':
            return '\n', []
        text, ranges = '', []
        separator = '' if part['type'] in {'paragraph', 'heading', 'codeBlock'} else '\n'
        for index, child in enumerate(part.get('content', [])):
            if index:
                text += separator
            child_text, child_ranges = walk(child)
            ranges.extend((identity, start + len(text), end + len(text)) for identity, start, end in child_ranges)
            text += child_text
        return text, ranges
    return walk(document)


@router.get('/worlds/{world}/material-mention')
def mention_source(world: str, request: Request, node_id: str, entity_id: str,
                   version: int = Query(ge=1), start: int = Query(ge=0), end: int = Query(ge=1)):
    repo = request.app.state.creation
    with repo.connection() as conn:
        node = repo.required(conn, 'nodes', node_id)
        work, visible = visible_node(repo, conn, node)
        entity = repo.required(conn, 'entities', entity_id)
        if work['world_id'] != world or entity['world_id'] != world:
            error('来源不属于当前世界。', 404)
        history = conn.execute('SELECT * FROM content_versions WHERE node_id=? AND version=?', (node_id, version)).fetchone()
        if not history:
            error('找不到来源版本。', 404)
        text, ranges = mention_ranges(json.loads(history['document']))
        if (entity_id, start, end) not in ranges:
            error('该范围不是此版本中保存的对象链接。', 404)
        return dict(world_id=world, node_id=node_id, work_id=work['id'], work_title=work['title'],
                    title=history['title'], source_version=version, current_version=node['version'],
                    stale=version != node['version'], source_archived=not visible, scope='fragment',
                    start=start, end=end, text=text, quote=text[start:end], metadata=json.loads(history['metadata']),
                    status='active', note='手工正文对象链接', target_label=entity['name'],
                    target_to=f"/worlds/{world}/create/objects/{entity_id}")


def label_and_link(repo, conn, kind, item):
    base = f"/worlds/{item['world_id']}/create"
    if kind == 'entity':
        return item['name'], f"{base}/objects/{item['id']}?tab=sources"
    if kind == 'assertion':
        person = repo.required(conn, 'entities', item['subject_id'])
        return f"{person['name']} · {item['predicate']}：{item['value']}", f"{base}/objects/{person['id']}?tab=facts&fact={item['id']}"
    if kind == 'event':
        return item['title'], f"{base}/records?event={item['id']}"
    a = repo.required(conn, 'entities', item['subject_id'])
    b = repo.required(conn, 'entities', item['object_id'])
    return f"{a['name']} → {b['name']} · {item['label']}", f"{base}/records?tab=relations&relationship={item['id']}"


def describe(repo, conn, row, detail=False):
    value = dict(row)
    node = repo.required(conn, 'nodes', value['node_id'])
    work, visible = visible_node(repo, conn, node)
    history = conn.execute('SELECT * FROM content_versions WHERE node_id=? AND version=?', (node['id'], value['source_version'])).fetchone()
    text = inspect_document(json.loads(history['document']))[0]
    item = target(repo, conn, value['object_type'], value['object_id'])
    label, to = label_and_link(repo, conn, value['object_type'], item)
    value.update(title=history['title'], work_title=work['title'], work_id=work['id'],
                 current_version=node['version'], stale=node['version'] != value['source_version'],
                 source_archived=not visible, target_status=item['status'], target_label=label, target_to=to,
                 quote=text[value['start']:value['end']] if detail else text[value['start']:min(value['end'], value['start'] + 160)],
                 to=f"/worlds/{value['world_id']}/create/sources/{value['id']}")
    if detail:
        value.update(text=text, metadata=json.loads(history['metadata']))
    return value


def list_sources(repo, conn, kind, identity):
    return [describe(repo, conn, row) for row in conn.execute(
        "SELECT * FROM material_sources WHERE object_type=? AND object_id=? AND status='active' ORDER BY created_at,id", (kind, identity))]


class SourceInput(Model):
    node_id: str
    source_version: int = Field(ge=1)
    target_version: int = Field(ge=1)
    scope: Literal['document', 'fragment'] = 'document'
    start: int | None = Field(default=None, ge=0)
    end: int | None = Field(default=None, ge=0)
    note: str = Field(default='', max_length=500)

    @model_validator(mode='after')
    def range(self):
        if self.scope == 'fragment' and (self.start is None or self.end is None or self.start >= self.end):
            raise ValueError('请选择明确的非空资料片段。')
        if self.scope == 'document' and (self.start is not None or self.end is not None):
            raise ValueError('整份资料关联不接受片段范围。')
        return self


@router.get('/material-targets/{kind}/{identity}/sources')
def sources(kind: TargetKind, identity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        item = target(repo, conn, kind, identity)
        return dict(world_id=item['world_id'], target_version=item['version'], sources=list_sources(repo, conn, kind, identity))


@router.post('/material-targets/{kind}/{identity}/sources', status_code=201)
def attach(kind: TargetKind, identity: str, body: SourceInput, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        item = target(repo, conn, kind, identity)
        repo.writable_world(conn, item['world_id'])
        repo.expected(item, body.target_version)
        if item['status'] != 'active' or item.get('merged_into'):
            error('请先恢复对象或记录，再关联资料；已合并对象请使用保留身份。')
        if kind == 'assertion':
            subject = repo.required(conn, 'entities', item['subject_id'])
            if subject['status'] != 'active' or subject.get('merged_into'):
                error('请先恢复事实所属对象，再关联资料。')
        node = repo.required(conn, 'nodes', body.node_id)
        work, visible = visible_node(repo, conn, node)
        if work['world_id'] != item['world_id']:
            error('来源必须属于同一世界。', 400)
        if not visible:
            error('请先恢复来源文档及其作品、父目录。')
        repo.expected(node, body.source_version)
        text = node['plain_text']
        start, end = (0, len(text)) if body.scope == 'document' else (body.start, body.end)
        if end > len(text) or not text[start:end].strip():
            error('来源范围无效或只有空白，请重新选择。', 400)
        duplicate = conn.execute("SELECT * FROM material_sources WHERE object_type=? AND object_id=? AND node_id=? AND source_version=? AND scope=? AND start=? AND end=? AND note=? AND status='active'",
                                 (kind, identity, node['id'], node['version'], body.scope, start, end, body.note)).fetchone()
        if duplicate:
            return describe(repo, conn, duplicate)
        source_id = str(uuid4())
        conn.execute('''INSERT INTO material_sources(id,world_id,object_type,object_id,original_object_id,node_id,source_version,scope,start,end,note)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)''', (source_id, item['world_id'], kind, identity, identity, node['id'], node['version'], body.scope, start, end, body.note))
        return describe(repo, conn, conn.execute('SELECT * FROM material_sources WHERE id=?', (source_id,)).fetchone())


@router.get('/worlds/{world}/material-sources/{identity}')
def source(world: str, identity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        row = conn.execute('SELECT * FROM material_sources WHERE id=? AND world_id=?', (identity, world)).fetchone()
        if not row:
            error('找不到此世界的资料来源。', 404)
        return describe(repo, conn, row, detail=True)


class RemoveInput(Model):
    version: int = Field(ge=1)


@router.post('/material-sources/{identity}/remove')
def remove(identity: str, body: RemoveInput, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT * FROM material_sources WHERE id=?', (identity,)).fetchone()
        if not row:
            error('找不到资料关联。', 404)
        repo.writable_world(conn, row['world_id'])
        repo.expected(row, body.version)
        conn.execute("UPDATE material_sources SET status='removed',version=version+1 WHERE id=?", (identity,))
        return dict(status='removed')


@router.get('/nodes/{identity}/material-sources')
def node_sources(identity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        repo.required(conn, 'nodes', identity)
        return [describe(repo, conn, row) for row in conn.execute(
            "SELECT * FROM material_sources WHERE node_id=? AND status='active' ORDER BY created_at,id", (identity,))]
