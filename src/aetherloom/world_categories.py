"""Author-selected categories and homepage order for the existing world objects."""

import json
from uuid import uuid4

from fastapi import APIRouter, Query, Request
from pydantic import Field, field_validator

from .creation import CreationError, encoded, record
from .creation_models import Model
from .object_schema import CORE_FIELDS

router = APIRouter(prefix='/api/worlds/{world}')
CARD_FIELDS = {'summary', 'aliases'} | {f'core:{key}' for fields in CORE_FIELDS.values() for key in fields}


def initialize(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS world_categories (
        id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id),
        parent_id TEXT REFERENCES world_categories(id), name TEXT NOT NULL,
        card_fields TEXT NOT NULL, home_position INTEGER, version INTEGER NOT NULL DEFAULT 1
    )''')
    conn.execute('''CREATE INDEX IF NOT EXISTS world_categories_tree
        ON world_categories(world_id, parent_id, name)''')
    conn.execute('''CREATE TABLE IF NOT EXISTS world_category_members (
        category_id TEXT NOT NULL REFERENCES world_categories(id) ON DELETE CASCADE,
        entity_id TEXT NOT NULL REFERENCES entities(id),
        PRIMARY KEY(category_id, entity_id)
    )''')
    conn.execute('''CREATE INDEX IF NOT EXISTS world_category_members_entity
        ON world_category_members(entity_id)''')


class CategoryInput(Model):
    name: str = Field(min_length=1, max_length=80)
    parent_id: str | None = None
    card_fields: list[str] = Field(default_factory=lambda: ['summary'], max_length=24)

    @field_validator('card_fields')
    @classmethod
    def valid_fields(cls, fields):
        for value in fields:
            if value in CARD_FIELDS:
                continue
            prefix, _, title = value.partition(':')
            if prefix != 'section' or not title.strip() or len(title) > 160:
                raise ValueError('请选择有效的卡面字段。')
        if len(set(fields)) != len(fields):
            raise ValueError('卡面字段不能重复。')
        return fields


class CategoryEdit(CategoryInput):
    version: int = Field(ge=1)


class HomeInput(Model):
    previous_ids: list[str]
    ids: list[str]


class MemberMove(Model):
    category_id: str


def category_in(conn, world, identity):
    row = conn.execute('SELECT * FROM world_categories WHERE id=? AND world_id=?', (identity, world)).fetchone()
    if row is None:
        raise CreationError('找不到当前世界中的这个分类。', 404)
    return row


def category_item(row):
    return dict(id=row['id'], name=row['name'], parent_id=row['parent_id'],
                card_fields=json.loads(row['card_fields']), version=row['version'])


def validate_category(conn, world, body, identity=None):
    if body.parent_id is not None:
        category_in(conn, world, body.parent_id)
        if identity is not None:
            ancestor = conn.execute('''
                WITH RECURSIVE ancestors(id, parent_id) AS (
                    SELECT id, parent_id FROM world_categories WHERE id=?
                    UNION
                    SELECT c.id, c.parent_id FROM world_categories c JOIN ancestors a ON c.id=a.parent_id
                ) SELECT 1 FROM ancestors WHERE id=?
            ''', (body.parent_id, identity)).fetchone()
            if ancestor:
                raise CreationError('请选择当前分类及其子分类之外的上级。', 400)
    duplicate = conn.execute('''
        SELECT 1 FROM world_categories
        WHERE world_id=? AND parent_id IS ? AND name=? COLLATE NOCASE AND id IS NOT ?
    ''', (world, body.parent_id, body.name, identity)).fetchone()
    if duplicate:
        raise CreationError('同一层级已有这个名称，请换一个分类名称。', 409)


def home_ids(conn, world):
    return [r['id'] for r in conn.execute('''
        SELECT id FROM world_categories WHERE world_id=? AND home_position IS NOT NULL
        ORDER BY home_position, id
    ''', (world,))]


@router.get('/categories')
def categories(world: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN')
        repo.required(conn, 'worlds', world)
        rows = conn.execute('SELECT * FROM world_categories WHERE world_id=? ORDER BY name, id', (world,))
        return dict(categories=[category_item(row) for row in rows], home_ids=home_ids(conn, world))


@router.post('/categories', status_code=201)
def create_category(world: str, body: CategoryInput, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        validate_category(conn, world, body)
        identity = str(uuid4())
        conn.execute('''
            INSERT INTO world_categories(id, world_id, parent_id, name, card_fields) VALUES(?,?,?,?,?)
        ''', (identity, world, body.parent_id, body.name, encoded(body.card_fields)))
        return category_item(category_in(conn, world, identity))


@router.patch('/categories/{identity}')
def edit_category(world: str, identity: str, body: CategoryEdit, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        repo.expected(category_in(conn, world, identity), body.version)
        validate_category(conn, world, body, identity)
        conn.execute('''
            UPDATE world_categories SET parent_id=?, name=?, card_fields=?, version=version+1 WHERE id=?
        ''', (body.parent_id, body.name, encoded(body.card_fields), identity))
        return category_item(category_in(conn, world, identity))


@router.delete('/categories/{identity}')
def delete_category(world: str, identity: str, request: Request, version: int = Query(ge=1)):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        repo.expected(category_in(conn, world, identity), version)
        if conn.execute('SELECT 1 FROM world_categories WHERE parent_id=?', (identity,)).fetchone():
            raise CreationError('请先移动或删除此分类的子分类。', 409)
        conn.execute('DELETE FROM world_categories WHERE id=?', (identity,))
        return {'id': identity}


@router.put('/category-home')
def arrange_home(world: str, body: HomeInput, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        if body.previous_ids != home_ids(conn, world):
            raise CreationError('首页分类已更改，请关闭设置后重新载入。', 409)
        available = {row['id'] for row in conn.execute('SELECT id FROM world_categories WHERE world_id=?', (world,))}
        if len(body.ids) != len(set(body.ids)) or set(body.ids) - available:
            raise CreationError('请从当前世界中选择分类，各分类最多出现一次。', 400)
        conn.execute('UPDATE world_categories SET home_position=NULL WHERE world_id=? AND home_position IS NOT NULL', (world,))
        conn.executemany('UPDATE world_categories SET home_position=? WHERE id=?', enumerate(body.ids))
        return {'home_ids': body.ids}


@router.get('/categories/{category}/objects')
def members(world: str, category: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN')
        category_in(conn, world, category)
        return [record(row) for row in conn.execute('''
            SELECT e.* FROM world_category_members m JOIN entities e ON e.id=m.entity_id
            WHERE m.category_id=? AND e.world_id=? AND e.status='active' AND e.merged_into IS NULL
            ORDER BY e.name, e.id
        ''', (category, world))]


def active_entity(conn, world, entity):
    row = conn.execute('''
        SELECT 1 FROM entities WHERE id=? AND world_id=? AND status='active' AND merged_into IS NULL
    ''', (entity, world)).fetchone()
    if not row:
        raise CreationError('请选择当前世界中仍可陈列的活跃对象。', 404)


@router.put('/categories/{category}/objects/{entity}')
def place(world: str, category: str, entity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        category_in(conn, world, category)
        active_entity(conn, world, entity)
        conn.execute('INSERT OR IGNORE INTO world_category_members VALUES(?,?)', (category, entity))
        return {'id': entity}


@router.delete('/categories/{category}/objects/{entity}')
def unplace(world: str, category: str, entity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        category_in(conn, world, category)
        conn.execute('DELETE FROM world_category_members WHERE category_id=? AND entity_id=?', (category, entity))
        return {'id': entity}


@router.patch('/categories/{category}/objects/{entity}')
def move(world: str, category: str, entity: str, body: MemberMove, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        category_in(conn, world, category)
        category_in(conn, world, body.category_id)
        active_entity(conn, world, entity)
        if category == body.category_id:
            raise CreationError('请选择另一个分类。', 400)
        removed = conn.execute('DELETE FROM world_category_members WHERE category_id=? AND entity_id=?', (category, entity))
        if not removed.rowcount:
            raise CreationError('对象已移出本分类，请刷新后再整理。', 409)
        conn.execute('INSERT OR IGNORE INTO world_category_members VALUES(?,?)', (body.category_id, entity))
        return {'id': entity}
