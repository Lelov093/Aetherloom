"""Explicit author links from inspirations to immutable manuscript selections."""

from typing import Literal
from urllib.parse import urlencode
from uuid import uuid4

from fastapi import APIRouter, Request
from pydantic import Field

from .creation import CreationError
from .material_sources import SourceRange, checked_material, describe_passage
from .writing_locations import writing_location

router = APIRouter(prefix='/api')


def initialize(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS inspiration_adoptions (
        id TEXT PRIMARY KEY,
        inspiration_id TEXT NOT NULL REFERENCES inspirations(id),
        node_id TEXT NOT NULL, source_version INTEGER NOT NULL,
        start INTEGER NOT NULL, end INTEGER NOT NULL CHECK(start >= 0 AND end > start),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(inspiration_id,node_id,source_version,start,end),
        FOREIGN KEY(node_id,source_version) REFERENCES content_versions(node_id,version)
    )''')
    conn.execute('CREATE INDEX IF NOT EXISTS inspiration_adoptions_node ON inspiration_adoptions(node_id)')


class AdoptionCreate(SourceRange):
    inspiration_id: str
    scope: Literal['fragment'] = 'fragment'
    start: int = Field(ge=0)
    end: int = Field(ge=1)


def require_inspiration(repo, conn, world, identity):
    item = repo.required(conn, 'inspirations', identity)
    if item['world_id'] != world:
        raise CreationError('找不到这个世界的灵感。', 404)
    return item


def describe_adoption(repo, conn, row, *, detail=False):
    result = dict(row)
    passage = describe_passage(repo, conn, row, detail=True)
    location = writing_location(conn, row['node_id'])
    state = 'current'
    if passage['source_archived']:
        state = 'archived'
    elif passage['stale']:
        current = conn.execute('SELECT plain_text FROM nodes WHERE id=?', (row['node_id'],)).fetchone()[0]
        if current != passage['text']:
            # Similar or repeated text is never a locator for an earlier version.
            state = 'revised' if passage['quote'] in current else 'missing'
    result.update(passage, path=location['path'], anchor_state=state)
    if not detail:
        del result['text'], result['metadata']
        if len(result['quote']) > 160:
            result['quote'] = result['quote'][:160] + '…'
    return result


def adoption_rows(repo, conn, column, identity):
    rows = conn.execute(f'''SELECT a.*, i.title AS inspiration_title
        FROM inspiration_adoptions a JOIN inspirations i ON i.id=a.inspiration_id
        WHERE a.{column}=? ORDER BY a.created_at DESC,a.node_id,a.source_version DESC,a.start,a.id''', (identity,))
    return [describe_adoption(repo, conn, row) for row in rows]


@router.post('/worlds/{world}/inspiration-adoptions', status_code=201)
def add_adoption(world: str, body: AdoptionCreate, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        item = require_inspiration(repo, conn, world, body.inspiration_id)
        key = (item['id'], body.node_id, body.source_version, body.start, body.end)
        previous = conn.execute('''SELECT id FROM inspiration_adoptions
            WHERE inspiration_id=? AND node_id=? AND source_version=? AND start=? AND end=?''', key).fetchone()
        if previous:
            return {'id': previous['id']}
        if item['status'] != 'active':
            raise CreationError('请先恢复这条灵感，再关联正文。', 409)
        checked_material(repo, conn, world, body)
        identity = str(uuid4())
        conn.execute('''INSERT INTO inspiration_adoptions(id,inspiration_id,node_id,source_version,start,end)
            VALUES(?,?,?,?,?,?)''', (identity, *key))
        return {'id': identity}


@router.get('/worlds/{world}/inspirations/{identity}/adoptions')
def inspiration_adoptions(world: str, identity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN')
        require_inspiration(repo, conn, world, identity)
        return adoption_rows(repo, conn, 'inspiration_id', identity)


@router.get('/worlds/{world}/nodes/{identity}/inspiration-adoptions')
def node_adoptions(world: str, identity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN')
        location = writing_location(conn, identity)
        if not location or location['world_id'] != world:
            raise CreationError('找不到这个世界的正文。', 404)
        return adoption_rows(repo, conn, 'node_id', identity)


@router.get('/worlds/{world}/inspiration-adoptions/{identity}')
def adoption_source(world: str, identity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN')
        row = repo.required(conn, 'inspiration_adoptions', identity)
        item = require_inspiration(repo, conn, world, row['inspiration_id'])
        result = describe_adoption(repo, conn, row, detail=True)
        query = urlencode({'id': item['id'], 'adoption': identity})
        return {**result, 'scope': 'fragment', 'inspiration_title': item['title'],
                'target_to': f'/worlds/{world}/inspirations?{query}', 'target_label': item['title']}
