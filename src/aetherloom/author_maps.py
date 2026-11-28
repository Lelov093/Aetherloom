"""Author-drawn maps and their links to existing world objects."""

import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Form, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import Field, model_validator

from .creation import CreationError, encoded, now
from .creation_models import EntityCreate, Model
from .portraits import read_image

router = APIRouter(prefix='/api/worlds/{world}')
MAP_COLUMNS = 'id, title, width, height, version, media_type IS NOT NULL AS has_background'
BLANK_SIZE = (1200, 780)
MapTitle = Annotated[str, Form(min_length=1, max_length=120)]


def initialize(repo):
    with repo.connection() as conn:
        conn.executescript("""
            BEGIN IMMEDIATE;
            CREATE TABLE IF NOT EXISTS author_maps (
                id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id),
                title TEXT NOT NULL, created_at TEXT NOT NULL,
                width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0),
                background BLOB, media_type TEXT, version INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS author_maps_world ON author_maps(world_id,created_at,id);
            CREATE TABLE IF NOT EXISTS map_features (
                id TEXT PRIMARY KEY, map_id TEXT NOT NULL REFERENCES author_maps(id),
                kind TEXT NOT NULL CHECK(kind IN ('marker','region','label')),
                name TEXT NOT NULL, points TEXT NOT NULL, color TEXT NOT NULL,
                entity_id TEXT REFERENCES entities(id), child_map_id TEXT REFERENCES author_maps(id),
                version INTEGER NOT NULL DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS map_features_map ON map_features(map_id);
            CREATE INDEX IF NOT EXISTS map_features_entity ON map_features(entity_id);
            COMMIT;
        """)


class Point(Model):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class FeatureData(Model):
    kind: Literal['marker', 'region', 'label']
    name: str = Field(default='', max_length=160)
    points: list[Point] = Field(min_length=1, max_length=120)
    color: str = Field(default='#267f91', pattern=r'^#[0-9A-Fa-f]{6}$')
    entity_id: UUID | None = None
    child_map_id: UUID | None = None
    new_location: str | None = Field(default=None, min_length=1, max_length=160)

    @model_validator(mode='after')
    def shape(self):
        if self.kind == 'region':
            coords = [(p.x, p.y) for p in self.points]
            area = sum(x * v - y * u for (x, y), (u, v) in zip(coords, coords[1:] + coords[:1]))
            if len(coords) < 3 or len(set(coords)) != len(coords) or abs(area) < 1e-8:
                raise ValueError('区域须由至少三个不同的转角围成。')
        elif len(self.points) != 1:
            raise ValueError('标记和文字标签只需一个位置。')
        if self.kind == 'marker':
            if bool(self.entity_id) == bool(self.new_location):
                raise ValueError('请选择一个已有地点，或填写新地点名称。')
        elif not self.name or self.new_location or (self.kind == 'label' and (self.entity_id or self.child_map_id)):
            raise ValueError('请填写区域或标签名称。文字标签仅用于注记。')
        return self


class FeatureCreate(FeatureData):
    id: UUID


class FeatureEdit(FeatureData):
    version: int = Field(ge=1)


def named(title):
    if not title.strip():
        raise CreationError('请输入地图名称。')
    return title.strip()


def map_info(conn, world, map_id):
    row = conn.execute(f'SELECT {MAP_COLUMNS} FROM author_maps WHERE id=? AND world_id=?', (str(map_id), world)).fetchone()
    if not row:
        raise CreationError('找不到当前世界的这张地图。', 404)
    return dict(row)


def feature_row(conn, map_id, feature_id):
    row = conn.execute('SELECT * FROM map_features WHERE id=? AND map_id=?', (str(feature_id), str(map_id))).fetchone()
    if not row:
        raise CreationError('这项地图标注已移除。', 404)
    return dict(row)


def feature_info(repo, conn, world, row):
    feature = {**row, 'points': json.loads(row['points']), 'entity': None}
    if row['entity_id']:
        entity = repo.canonical_entity(conn, row['entity_id'], world)
        feature['entity'] = {
            'id': entity['id'], 'name': entity['name'], 'kind': entity['kind'], 'status': entity['status'],
        }
    return feature


def child_map(conn, world, map_id, child_id, editing):
    if not child_id:
        return None
    child = map_info(conn, world, child_id)['id']
    cycle = conn.execute("""WITH RECURSIVE following(id) AS (
        SELECT ? UNION SELECT f.child_map_id FROM map_features f JOIN following d ON d.id=f.map_id
        WHERE f.child_map_id IS NOT NULL AND f.id!=?
    ) SELECT 1 FROM following WHERE id=?""", (child, editing or '', str(map_id))).fetchone()
    if cycle:
        raise CreationError('这张子图会回到当前地图。请选择其他地图。', 409)
    return child


def feature_fields(repo, conn, world, map_id, body, previous=None):
    child = child_map(conn, world, map_id, body.child_map_id, previous and previous['id'])
    entity_id = str(body.entity_id) if body.entity_id else None
    if body.new_location:
        draft = EntityCreate(name=body.new_location, kind='location').model_dump()
        entity_id = repo.insert_entity(conn, world, draft)['id']
    elif entity_id and (not previous or previous['entity_id'] != entity_id):
        entity = repo.canonical_entity(conn, entity_id, world, True)
        if body.kind == 'marker' and entity['kind'] != 'location':
            raise CreationError('地点标记须绑定地点卡。')
        entity_id = entity['id']
    return body.kind, body.name, encoded([point.model_dump() for point in body.points]), body.color, entity_id, child


@router.get('/maps')
def maps(world: str, request: Request):
    repo = request.app.state.creation
    repo.get(world)
    with repo.connection() as conn:
        conn.execute('BEGIN')
        directory = [dict(row) for row in conn.execute(
            f'SELECT {MAP_COLUMNS} FROM author_maps WHERE world_id=? ORDER BY created_at,id', (world,)
        )]
        links = [dict(row) for row in conn.execute("""SELECT DISTINCT f.map_id, f.child_map_id
            FROM map_features f JOIN author_maps m ON m.id=f.map_id
            WHERE m.world_id=? AND f.child_map_id IS NOT NULL ORDER BY f.map_id,f.child_map_id""", (world,))]
    return {'maps': directory, 'links': links}


@router.post('/maps', status_code=201)
async def create_map(world: str, request: Request, title: MapTitle, id: Annotated[UUID, Form()],
                     file: UploadFile | None = None, parent_feature: UUID | None = Form(None),
                     feature_version: int | None = Form(None, ge=1)):
    repo = request.app.state.creation
    title = named(title)
    image, mime, size = await read_image(file) if file else (None, None, BLANK_SIZE)
    identity = str(id)
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        existing = conn.execute('SELECT 1 FROM author_maps WHERE id=?', (identity,)).fetchone()
        if existing:
            return map_info(conn, world, id)
        if parent_feature:
            parent = conn.execute("""SELECT f.* FROM map_features f JOIN author_maps m ON m.id=f.map_id
                WHERE f.id=? AND m.world_id=? AND f.kind IN ('marker','region')""", (str(parent_feature), world)).fetchone()
            if not parent:
                raise CreationError('找不到可挂接子图的标记或区域。', 404)
            repo.expected(parent, feature_version)
        conn.execute("""INSERT INTO author_maps(id,world_id,title,created_at,width,height,background,media_type)
                        VALUES(?,?,?,?,?,?,?,?)""", (identity, world, title, now(), *size, image, mime))
        if parent_feature:
            conn.execute('UPDATE map_features SET child_map_id=?,version=version+1 WHERE id=?', (identity, str(parent_feature)))
        return map_info(conn, world, id)


@router.get('/maps/{map_id}')
def read_map(world: str, map_id: UUID, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN')
        info = map_info(conn, world, map_id)
        features = [feature_info(repo, conn, world, row) for row in conn.execute(
            'SELECT * FROM map_features WHERE map_id=? ORDER BY rowid', (str(map_id),)
        )]
        return {**info, 'features': features}


@router.patch('/maps/{map_id}')
async def edit_map(world: str, map_id: UUID, request: Request, title: MapTitle, version: Annotated[int, Form(ge=1)],
                   file: UploadFile | None = None, remove_background: bool = Form(False)):
    repo = request.app.state.creation
    title = named(title)
    if file and remove_background:
        raise CreationError('请选择更换或移除底图。')
    background = await read_image(file) if file else (None, None, BLANK_SIZE) if remove_background else None
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        repo.expected(map_info(conn, world, map_id), version)
        conn.execute('UPDATE author_maps SET title=?,version=version+1 WHERE id=?', (title, str(map_id)))
        if background is not None:
            image, mime, size = background
            conn.execute('UPDATE author_maps SET background=?,media_type=?,width=?,height=? WHERE id=?',
                         (image, mime, *size, str(map_id)))
        return map_info(conn, world, map_id)


@router.get('/maps/{map_id}/background')
def map_background(world: str, map_id: UUID, request: Request):
    with request.app.state.creation.connection() as conn:
        row = conn.execute('SELECT background,media_type FROM author_maps WHERE id=? AND world_id=?',
                           (str(map_id), world)).fetchone()
        if not row or not row['background'] or not row['media_type']:
            raise CreationError('底图暂不可用。', 404)
        return Response(bytes(row['background']), media_type=row['media_type'], headers={'Cache-Control': 'no-cache'})


@router.post('/maps/{map_id}/features', status_code=201)
def add_feature(world: str, map_id: UUID, body: FeatureCreate, request: Request):
    repo = request.app.state.creation
    identity = str(body.id)
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        map_info(conn, world, map_id)
        if not conn.execute('SELECT 1 FROM map_features WHERE id=?', (identity,)).fetchone():
            values = feature_fields(repo, conn, world, map_id, body)
            conn.execute("""INSERT INTO map_features(id,map_id,kind,name,points,color,entity_id,child_map_id)
                         VALUES(?,?,?,?,?,?,?,?)""", (identity, str(map_id), *values))
        return feature_info(repo, conn, world, feature_row(conn, map_id, body.id))


@router.patch('/maps/{map_id}/features/{feature_id}')
def edit_feature(world: str, map_id: UUID, feature_id: UUID, body: FeatureEdit, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        map_info(conn, world, map_id)
        feature = feature_row(conn, map_id, feature_id)
        repo.expected(feature, body.version)
        if feature['kind'] != body.kind:
            raise CreationError('请保留标注类型。')
        values = feature_fields(repo, conn, world, map_id, body, feature)
        conn.execute("""UPDATE map_features SET kind=?,name=?,points=?,color=?,entity_id=?,child_map_id=?,version=version+1
                     WHERE id=?""", (*values, str(feature_id)))
        return feature_info(repo, conn, world, feature_row(conn, map_id, feature_id))


@router.delete('/maps/{map_id}/features/{feature_id}')
def remove_feature(world: str, map_id: UUID, feature_id: UUID, request: Request, version: int = Query(ge=1)):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        map_info(conn, world, map_id)
        repo.expected(feature_row(conn, map_id, feature_id), version)
        conn.execute('DELETE FROM map_features WHERE id=?', (str(feature_id),))
    return {'id': str(feature_id)}


@router.get('/locations/{identity}/map-positions')
def map_positions(world: str, identity: UUID, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN')
        place = repo.canonical_entity(conn, str(identity), world)
        if place['kind'] != 'location':
            raise CreationError('请选择地点卡。', 404)
        return [dict(row) for row in conn.execute("""WITH RECURSIVE identities(id) AS (
            SELECT ? UNION SELECT e.id FROM entities e JOIN identities i ON e.merged_into=i.id
            WHERE e.world_id=?
        ) SELECT m.id AS map_id, m.title AS map_title, f.id AS feature_id,
                 f.kind, COALESCE(NULLIF(f.name,''), ?) AS name
          FROM map_features f JOIN author_maps m ON m.id=f.map_id JOIN identities i ON i.id=f.entity_id
          WHERE m.world_id=? ORDER BY m.created_at,m.id,f.rowid""", (place['id'], world, place['name'], world))]
