"""Story-time views of Canon. Ordinary edits still use the original record history."""

import json
from dataclasses import dataclass
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from . import canon
from .creation import CreationError, identified_sections, record
from .creation_models import Model
from .object_schema import CORE_FIELDS, FactInput, RelationshipInput
from .story_year import year

router = APIRouter(prefix='/api/worlds/{world}/periods')


def initialize(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS canon_record_periods (
        kind TEXT NOT NULL CHECK(kind IN ('relationship','assertion')),
        record_id TEXT NOT NULL, from_event_id TEXT REFERENCES canon_events(id),
        to_event_id TEXT REFERENCES canon_events(id), PRIMARY KEY(kind,record_id)
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS entity_period_values (
        id TEXT PRIMARY KEY, world_id TEXT NOT NULL REFERENCES worlds(id),
        entity_id TEXT NOT NULL REFERENCES entities(id), target TEXT NOT NULL,
        label TEXT NOT NULL, event_id TEXT NOT NULL REFERENCES canon_events(id),
        value TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        UNIQUE(entity_id,target,event_id)
    )''')


@dataclass(frozen=True)
class Moment:
    year: int | None
    event: str | None
    side: Literal['before', 'after'] | None


def moment_query(at_year: Annotated[int | None, Query(ge=-999999, le=999999)] = None,
                 at_event: Annotated[str | None, Query(max_length=160)] = None,
                 event_side: Literal['before', 'after'] | None = None):
    if at_year is not None and (at_event or event_side) or bool(at_event) != bool(event_side):
        raise CreationError('请选择一个年份，或一个事件的前后时点。')
    return Moment(at_year, at_event, event_side) if at_year is not None or at_event else None


StoryMoment = Annotated[Moment | None, Depends(moment_query)]


class PeriodView:
    def __init__(self, conn, world, moment):
        self.moment = moment
        self.events = {}
        for row in conn.execute('''SELECT id,title,status,valid_from,valid_until,metadata,location_id
                                   FROM canon_events WHERE world_id=? ORDER BY title,id''', (world,)):
            value = dict(row)
            value['causes'] = json.loads(value.pop('metadata')).get('causes', [])
            self.events[value['id']] = value
        if moment and moment.event:
            self.require_event(moment.event)
        self._ancestors = {}

    def require_event(self, identity):
        event = self.events.get(identity)
        if not event or event['status'] != 'active':
            raise CreationError('请选择当前世界的有效事件。', 404)
        return event

    def event_summary(self, identity):
        if not identity or identity not in self.events:
            return None
        event = self.events[identity]
        return {key: event[key] for key in ('id','title','status','valid_from','valid_until','location_id')}

    def ancestors(self, identity):
        if identity not in self._ancestors:
            seen = set()
            pending = list(self.events[identity]['causes'])
            while pending:
                key = pending.pop()
                if key not in seen and key in self.events and self.events[key]['status'] == 'active':
                    seen.add(key)
                    pending.extend(self.events[key]['causes'])
            self._ancestors[identity] = seen
        return self._ancestors[identity]

    def order(self, first, second):
        """Return the order only when dates or explicit event causes establish it."""
        a, b = self.events.get(first), self.events.get(second)
        if not a or not b or a['status'] != 'active' or b['status'] != 'active' or first == second:
            return None
        a_start, a_end = year(a['valid_from']), year(a['valid_until'])
        b_start, b_end = year(b['valid_from']), year(b['valid_until'])
        if ((a_start is not None and a_end is not None and a_start > a_end)
                or (b_start is not None and b_end is not None and b_start > b_end)):
            return None
        date_order = (-1 if a_end is not None and b_start is not None and a_end < b_start else
                      1 if b_end is not None and a_start is not None and b_end < a_start else None)
        cause_order = -1 if first in self.ancestors(second) else 1 if second in self.ancestors(first) else None
        return None if date_order and cause_order and date_order != cause_order else date_order or cause_order

    def relative(self, identity):
        event = self.events.get(identity)
        if not event or event['status'] != 'active':
            return None
        if self.moment.event == identity:
            return -1 if self.moment.side == 'after' else 1
        if self.moment.event:
            return self.order(identity, self.moment.event)
        start, end = year(event['valid_from']), year(event['valid_until'])
        if start is not None and end is not None and start > end:
            return None
        if end is not None and end < self.moment.year:
            return -1
        if start is not None and start > self.moment.year:
            return 1
        return None

    def visible(self, row):
        if not self.moment:
            return True
        start_event, end_event = row.get('from_event_id'), row.get('to_event_id')
        if start_event and self.relative(start_event) != -1 or end_event and self.relative(end_event) != 1:
            return False
        event = self.events.get(self.moment.event, {})
        a = b = self.moment.year
        if event:
            a, b = year(event['valid_from']), year(event['valid_until'])
        start = None if start_event else year(row['valid_from'])
        end = None if end_event else year(row['valid_until'])
        if (start is not None and b is not None and start > b
                or end is not None and a is not None and end < a
                or start is not None and end is not None and start > end):
            return False
        # At an expressly recorded transition both adjacent states have evidence.
        if self.moment.event and (self.moment.event == start_event or self.moment.event == end_event):
            return True
        valid_start = bool(start_event or (start is not None and a is not None and start <= a))
        valid_end = bool(end_event or (end is not None and b is not None and end >= b)
                         or (start_event and not row['valid_until']))
        return valid_start and valid_end

    def value_at(self, base, changes):
        if not self.moment or not changes:
            return base
        ordered = [(change, self.relative(change['event_id'])) for change in changes]
        if any(order is None for _, order in ordered):
            return None
        earlier = [change for change, order in ordered if order == -1]
        if not earlier:
            return base
        for change in earlier:
            if all(other is change or self.order(other['event_id'], change['event_id']) == -1 for other in earlier):
                return change['value']
        return None


def visible_keys(conn, world, view):
    keys = []
    for kind, table, scope in (
        ('relationship', 'relationship_states', 's.relationship_id IN (SELECT id FROM temporal_relationships WHERE world_id=?)'),
        ('assertion', 'assertions', 's.world_id=?'),
    ):
        rows = conn.execute(f'''SELECT s.id,s.valid_from,s.valid_until,p.from_event_id,p.to_event_id
            FROM {table} s LEFT JOIN canon_record_periods p ON p.kind=? AND p.record_id=s.id
            WHERE s.status='active' AND {scope}''', (kind, world))
        keys.extend(f"{kind}:{row['id']}" for row in rows if view.visible(dict(row)))
    keys.extend(f"event:{event['id']}" for event in view.events.values()
                if event['status'] == 'active' and (event['id'] == view.moment.event or view.visible(event)))
    return keys


def card_fields(conn, entity, view):
    rows = conn.execute('SELECT * FROM entity_period_values WHERE entity_id=? ORDER BY rowid', (entity['id'],))
    targets = {f"core:{key}": (label,entity['core'].get(key,'')) for key,label in CORE_FIELDS[entity['kind']].items()}
    targets.update({f"section:{s['id']}": (s['title'] or '说明',s['body']) for s in identified_sections(entity)})
    grouped = {}
    for row in rows:
        change = {**dict(row), 'event': view.event_summary(row['event_id'])}
        grouped.setdefault(row['target'], []).append(change)
        targets.setdefault(row['target'], (row['label'],None))
    return [dict(key=target, label=label, base=base, value=view.value_at(base, grouped.get(target, [])),
                 changes=grouped.get(target, [])) for target,(label,base) in targets.items()]


def anchored_records(conn, entity, view, kind):
    if kind == 'relationship':
        source = """SELECT s.*,r.subject_id,r.object_id,a.name AS subject_name,b.name AS object_name,p.from_event_id,p.to_event_id
             FROM relationship_states s JOIN temporal_relationships r ON r.id=s.relationship_id
             JOIN entities a ON r.subject_id=a.id JOIN entities b ON r.object_id=b.id
             LEFT JOIN canon_record_periods p ON p.kind='relationship' AND p.record_id=s.id
             WHERE r.world_id=? AND (r.subject_id=? OR r.object_id=?) AND r.status='active' AND r.merged_into IS NULL
             AND a.status='active' AND a.merged_into IS NULL AND b.status='active' AND b.merged_into IS NULL AND s.status='active'
             ORDER BY s.created_at,s.id"""
        args = (entity['world_id'], entity['id'], entity['id'])
    else:
        source = """SELECT s.*,p.from_event_id,p.to_event_id FROM assertions s
             LEFT JOIN canon_record_periods p ON p.kind='assertion' AND p.record_id=s.id
             WHERE s.subject_id=? AND s.status='active' ORDER BY s.predicate,s.created_at,s.id"""
        args = (entity['id'],)
    items = []
    for row in conn.execute(source, args):
        item = record(row)
        if view.visible(item):
            items.append({**item, 'from_event': view.event_summary(item['from_event_id']),
                          'to_event': view.event_summary(item['to_event_id'])})
    return items


@router.get('/objects/{identity}')
def object_periods(world: str, identity: str, request: Request, moment: StoryMoment):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN')
        entity = repo.canonical_entity(conn, identity, world)
        view = PeriodView(conn, world, moment)
        return dict(fields=card_fields(conn, entity, view), facts=anchored_records(conn, entity, view, 'assertion'),
                    relationships=anchored_records(conn, entity, view, 'relationship'),
                    selected_event=view.event_summary(moment.event) if moment else None,
                    events=[view.event_summary(event['id']) for event in view.events.values() if event['status']=='active'])


@router.get('/events')
def story_events(world: str, request: Request):
    repo = request.app.state.creation
    repo.get(world)
    with repo.connection() as conn:
        return [dict(row, status='active') for row in conn.execute('''SELECT id,title,valid_from,valid_until,location_id
            FROM canon_events WHERE world_id=? AND status='active' ORDER BY title,id''', (world,))]


class ValueEdit(Model):
    version: int = Field(ge=1)
    value: str = Field(max_length=200000)


class ValueCreate(ValueEdit):
    target: str = Field(max_length=160)
    event_id: str = Field(max_length=160)


@router.post('/objects/{identity}/values', status_code=201)
def create_value(world: str, identity: str, body: ValueCreate, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        entity = repo.canonical_entity(conn, identity, world, True)
        repo.expected(entity, body.version)
        view = PeriodView(conn, world, Moment(None, body.event_id, 'after'))
        field = next((item for item in card_fields(conn, entity, view) if item['key'] == body.target and item['base'] is not None), None)
        if not field:
            raise CreationError('这项资料已移除或不属于当前对象。', 404)
        if any(change['event_id'] == body.event_id for change in field['changes']):
            raise CreationError('此事件已有这一项的状态。可在时期总览中纠错。', 409)
        state_id = str(uuid4())
        conn.execute('INSERT INTO entity_period_values(id,world_id,entity_id,target,label,event_id,value) VALUES(?,?,?,?,?,?,?)',
                     (state_id,world,entity['id'],body.target,field['label'],body.event_id,body.value))
        canon.changed(conn, world, 'setting_state', state_id, {'action':'historical_change','event_id':body.event_id})
        return repo.save_snapshot(conn, 'setting_state', state_id)


@router.patch('/objects/{identity}/values/{state_id}')
def edit_value(world: str, identity: str, state_id: str, body: ValueEdit, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        entity = repo.canonical_entity(conn, identity, world, True)
        state = repo.object_snapshot(conn, 'setting_state', state_id)
        if state['entity_id'] != entity['id'] or state['world_id'] != world:
            raise CreationError('这项时期资料不属于当前对象。', 404)
        repo.expected(state, body.version)
        repo.save_snapshot(conn, 'setting_state', state_id)
        conn.execute('UPDATE entity_period_values SET value=?,version=version+1 WHERE id=?',(body.value,state_id))
        canon.changed(conn, world, 'setting_state', state_id, {'action':'correction'})
        return repo.save_snapshot(conn, 'setting_state', state_id)


class RelationshipChange(RelationshipInput):
    event_id: str
    version: int = Field(ge=1)


class FactChange(FactInput):
    event_id: str
    version: int = Field(ge=1)


def close_period(repo, conn, world, kind, identity, body):
    old = repo.object_snapshot(conn, kind, identity)
    if old['world_id'] != world or old['status'] != 'active':
        raise CreationError('请选择当前世界的有效记录。', 404)
    repo.expected(old, body.version)
    view = PeriodView(conn, world, Moment(None, body.event_id, 'before'))
    start = old.get('from_event_id')
    event = view.events[body.event_id]
    if old.get('to_event_id'):
        raise CreationError('这条记录已有结束事件。请从对应的新状态继续。', 409)
    if start and (start == body.event_id or view.order(start, body.event_id) == 1):
        raise CreationError('变更事件须位于原状态开始之后。')
    start_year, end_year = year(event['valid_from']), year(event['valid_until'])
    old_start, old_end = year(old['valid_from']), year(old['valid_until'])
    if ((old_start is not None and end_year is not None and old_start > end_year)
            or (old_end is not None and start_year is not None and old_end < start_year)):
        raise CreationError('所选事件超出了原记录的有效年份。')
    repo.save_snapshot(conn, kind, identity)
    conn.execute('''INSERT INTO canon_record_periods(kind,record_id,to_event_id) VALUES(?,?,?)
        ON CONFLICT(kind,record_id) DO UPDATE SET to_event_id=excluded.to_event_id''',(kind,identity,body.event_id))
    table = 'relationship_states' if kind == 'relationship' else 'assertions'
    conn.execute(f'UPDATE {table} SET version=version+1 WHERE id=?', (identity,))
    repo.save_snapshot(conn, kind, identity)
    canon.changed(conn, world, kind, identity, {'action':'end_at_event','event_id':body.event_id})
    return old


@router.post('/relationships/{identity}/transition', status_code=201)
def transition_relationship(world: str, identity: str, body: RelationshipChange, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        old = close_period(repo, conn, world, 'relationship', identity, body)
        subject = repo.canonical_entity(conn, body.subject_id, world, True)['id']
        other = repo.canonical_entity(conn, body.object_id, world, True)['id']
        if not {old['subject_id'],old['object_id']}.intersection((subject,other)):
            raise CreationError('新状态须与原关系共用至少一端。')
        return repo.save_relationship(conn, world, body.model_dump(exclude={'event_id','version'}), from_event=body.event_id)


@router.post('/facts/{identity}/transition', status_code=201)
def transition_fact(world: str, identity: str, body: FactChange, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world)
        old = close_period(repo, conn, world, 'assertion', identity, body)
        if old['field_id'] != body.field_id or old['predicate'] != body.predicate:
            raise CreationError('新状态须沿用原事实的字段和名称。')
        entity = repo.canonical_entity(conn, old['subject_id'], world, True)
        return repo.insert_fact(conn, entity, body.model_dump(exclude={'event_id','version'}), from_event=body.event_id)
