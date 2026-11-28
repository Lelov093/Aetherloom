"""Author annotations on versioned passages in the existing work tree."""

from typing import Literal
from urllib.parse import urlencode
from uuid import uuid4

from fastapi import APIRouter, Request
from pydantic import Field, UUID4, model_validator

from .creation import CreationError
from .creation_models import Model
from .material_sources import SourceRange, checked_material, describe_passage, visible_node

router = APIRouter(prefix='/api')
PassageUse = Literal['mention', 'hint', 'reveal', 'recall', 'payoff']
ClueStatus = Literal['unresolved', 'resolved', 'intentional_blank']


def initialize(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS narrative_clues (
        id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), title TEXT NOT NULL,
        event_id TEXT REFERENCES canon_events(id),
        status TEXT NOT NULL DEFAULT 'unresolved' CHECK(status IN ('unresolved','resolved','intentional_blank')),
        version INTEGER NOT NULL DEFAULT 1
    )''')
    conn.execute('CREATE INDEX IF NOT EXISTS narrative_clues_work ON narrative_clues(work_id)')
    conn.execute('CREATE INDEX IF NOT EXISTS narrative_clues_event ON narrative_clues(event_id)')
    conn.execute('''CREATE TABLE IF NOT EXISTS narrative_passages (
        id TEXT PRIMARY KEY, node_id TEXT NOT NULL, source_version INTEGER NOT NULL,
        start INTEGER NOT NULL, end INTEGER NOT NULL CHECK(start >= 0 AND end > start),
        event_id TEXT REFERENCES canon_events(id), clue_id TEXT REFERENCES narrative_clues(id),
        use_kind TEXT NOT NULL CHECK(use_kind IN ('mention','hint','reveal','recall','payoff')),
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
        version INTEGER NOT NULL DEFAULT 1,
        CHECK((event_id IS NULL) <> (clue_id IS NULL)),
        FOREIGN KEY(node_id,source_version) REFERENCES content_versions(node_id,version)
    )''')
    conn.execute('CREATE INDEX IF NOT EXISTS narrative_passages_node ON narrative_passages(node_id,status)')
    conn.execute('CREATE INDEX IF NOT EXISTS narrative_passages_event ON narrative_passages(event_id,status)')
    conn.execute('CREATE INDEX IF NOT EXISTS narrative_passages_clue ON narrative_passages(clue_id,status)')


class PassageCreate(SourceRange):
    scope: Literal['fragment'] = 'fragment'
    start: int = Field(ge=0)
    end: int = Field(ge=1)
    request_id: UUID4
    event_id: str | None = None
    clue_id: str | None = None
    clue_title: str | None = Field(default=None, min_length=1, max_length=160)
    use_kind: PassageUse = 'mention'

    @model_validator(mode='after')
    def target(self):
        if sum(value is not None for value in (self.event_id, self.clue_id, self.clue_title)) != 1:
            raise ValueError('请选择一条事件、已有线索，或为新线索命名。')
        return self


class PassageEdit(Model):
    version: int = Field(ge=1)
    use_kind: PassageUse
    note: str = Field(default='', max_length=500)
    status: Literal['active', 'removed'] = 'active'


class ClueEdit(Model):
    version: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=160)
    status: ClueStatus
    event_id: str | None


def require_event(repo, conn, world, identity, *, writable=False):
    event = repo.required(conn, 'canon_events', identity)
    if event['world_id'] != world:
        raise CreationError('找不到这个世界的事件。', 404)
    if writable and event['status'] != 'active':
        raise CreationError('该事件已撤回，请选择仍在收录的事件。', 409)
    return event


# Start with matching passages and follow only their ancestors. Positions come
# from the current tree, so moving a chapter never rewrites any frozen passage.
def passages(conn, match, identity):
    sql = f'''
        WITH RECURSIVE matches AS (
            SELECT p.*, n.work_id, w.title AS work_title, w.created_at AS work_created,
                   n.version AS current_version, c.title AS clue_title, c.status AS clue_status,
                   e.id AS linked_event_id, e.title AS event_title, e.status AS event_status
              FROM narrative_passages p
              JOIN nodes n ON n.id=p.node_id
              JOIN works w ON w.id=n.work_id
              LEFT JOIN narrative_clues c ON c.id=p.clue_id
              LEFT JOIN canon_events e ON e.id=coalesce(p.event_id,c.event_id)
             WHERE p.status='active' AND ({match})
        ), paths(node_id,parent_id,title_path,sort_path,source_archived) AS (
            SELECT n.id, n.parent_id, n.title, printf('%012d:%s:%s',n.position,n.created_at,n.id),
                   n.status!='active' OR w.status!='active'
              FROM (SELECT DISTINCT node_id FROM matches) m
              JOIN nodes n ON n.id=m.node_id JOIN works w ON w.id=n.work_id
            UNION ALL
            SELECT path.node_id, n.parent_id, n.title||' / '||path.title_path,
                   printf('%012d:%s:%s/',n.position,n.created_at,n.id)||path.sort_path,
                   path.source_archived OR n.status!='active'
              FROM paths path JOIN nodes n ON n.id=path.parent_id
        )
        SELECT m.*, path.title_path, path.source_archived
          FROM matches m JOIN paths path ON path.node_id=m.node_id AND path.parent_id IS NULL
         ORDER BY m.work_created,m.work_id,path.sort_path,m.source_version,m.start,m.end,m.id
    '''
    return [{**dict(row), 'source_archived': bool(row['source_archived'])} for row in conn.execute(sql, (identity,))]


@router.get('/nodes/{identity}/narrative')
def node_narrative(identity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        repo.required(conn, 'nodes', identity)
        return passages(conn, 'p.node_id=?', identity)


@router.get('/works/{identity}/narrative')
def work_narrative(identity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN')
        repo.required(conn, 'works', identity)
        clues = [dict(row) for row in conn.execute(
            'SELECT c.*,e.title AS event_title,e.status AS event_status FROM narrative_clues c '
            'LEFT JOIN canon_events e ON e.id=c.event_id WHERE c.work_id=? ORDER BY c.title,c.id', (identity,))]
        return {'passages': passages(conn, 'w.id=?', identity), 'clues': clues}


@router.get('/worlds/{world}/events/{identity}/narrative')
def event_narrative(world: str, identity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        require_event(repo, conn, world, identity)
        return passages(conn, 'p.event_id=?1 OR c.event_id=?1', identity)


@router.post('/worlds/{world}/narrative-passages', status_code=201)
def add_passage(world: str, body: PassageCreate, request: Request):
    repo = request.app.state.creation
    identity = str(body.request_id)
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        previous = conn.execute(
            'SELECT p.*, w.world_id, c.title AS clue_title FROM narrative_passages p '
            'JOIN nodes n ON n.id=p.node_id JOIN works w ON w.id=n.work_id '
            'LEFT JOIN narrative_clues c ON c.id=p.clue_id WHERE p.id=?', (identity,)).fetchone()
        if previous:
            fields = ('node_id', 'source_version', 'start', 'end', 'event_id', 'use_kind', 'note')
            same_clue = (body.clue_title == previous['clue_title'] if body.clue_title is not None
                         else body.clue_id == previous['clue_id'])
            if previous['world_id'] != world or not same_clue or not all(previous[key] == getattr(body,key) for key in fields):
                raise CreationError('此保存编号已用于另一条记录，请重新选择选段。', 409)
            return {'id': identity}
        node, start, end = checked_material(repo, conn, world, body)
        clue_id = body.clue_id
        if body.event_id is not None:
            require_event(repo, conn, world, body.event_id, writable=True)
        elif clue_id is not None:
            clue = repo.required(conn, 'narrative_clues', clue_id)
            if clue['work_id'] != node['work_id']:
                raise CreationError('线索必须属于这部作品。', 400)
        else:
            clue_id = str(uuid4())
            conn.execute('INSERT INTO narrative_clues(id,work_id,title) VALUES(?,?,?)',
                         (clue_id, node['work_id'], body.clue_title))
        conn.execute('''INSERT INTO narrative_passages(id,node_id,source_version,start,end,event_id,clue_id,use_kind,note)
            VALUES(?,?,?,?,?,?,?,?,?)''',
            (identity, node['id'], node['version'], start, end, body.event_id, clue_id, body.use_kind, body.note))
        return {'id': identity}


@router.patch('/narrative-passages/{identity}')
def edit_passage(identity: str, body: PassageEdit, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        passage = repo.required(conn, 'narrative_passages', identity)
        node = repo.required(conn, 'nodes', passage['node_id'])
        work, visible = visible_node(repo, conn, node)
        repo.writable_world(conn, work['world_id'])
        if not visible or passage['status'] != 'active':
            raise CreationError('仅可编辑当前作品中仍在使用的叙事记录。', 409)
        repo.expected(passage, body.version)
        conn.execute('UPDATE narrative_passages SET use_kind=?,note=?,status=?,version=version+1 WHERE id=?',
                     (body.use_kind, body.note, body.status, identity))
        return {'id': identity}


@router.patch('/narrative-clues/{identity}')
def edit_clue(identity: str, body: ClueEdit, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        clue = repo.required(conn, 'narrative_clues', identity)
        work = repo.required(conn, 'works', clue['work_id'])
        repo.writable_world(conn, work['world_id'])
        if work['status'] != 'active':
            raise CreationError('请先恢复这部作品。', 409)
        repo.expected(clue, body.version)
        if body.event_id is not None and body.event_id != clue['event_id']:
            require_event(repo, conn, work['world_id'], body.event_id, writable=True)
        conn.execute('UPDATE narrative_clues SET title=?,status=?,event_id=?,version=version+1 WHERE id=?',
                     (body.title, body.status, body.event_id, identity))
        return {'id': identity}


@router.get('/worlds/{world}/narrative-sources/{identity}')
def narrative_source(world: str, identity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN')
        passage = repo.required(conn, 'narrative_passages', identity)
        node = repo.required(conn, 'nodes', passage['node_id'])
        work = repo.required(conn, 'works', node['work_id'])
        if work['world_id'] != world:
            raise CreationError('找不到此世界的叙事选段。', 404)
        prefix = f'/worlds/{world}'
        if passage['clue_id']:
            clue = repo.required(conn, 'narrative_clues', passage['clue_id'])
            label = f"作品叙事 · {clue['title']}"
            destination = f"{prefix}/create?{urlencode({'work': work['id'], 'view': 'narrative'})}"
        else:
            event = require_event(repo, conn, world, passage['event_id'])
            label = event['title']
            focus = 'event:' + event['id']
            destination = (f"{prefix}/explore?{urlencode({'view': 'timeline', 'focus': focus, 'record': focus})}"
                           if event['status'] == 'active' else f"{prefix}/create/records?event={event['id']}")
        return {**passage, **describe_passage(repo, conn, passage, detail=True),
                'scope': 'fragment', 'target_to': destination, 'target_label': label}
