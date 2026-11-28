"""Prepare an authored start from explicit, versioned workspace sources."""
from hashlib import sha256
import json
from typing import Literal
from uuid import uuid4

from pydantic import Field, model_serializer, model_validator

from aetherloom import canon, material_sources, periods
from aetherloom.creation import record
from aetherloom.writing_locations import WRITING_KINDS, writing_location
from . import scenarios
from .authored_roles import CharacterOpening, OpeningReview, bound, compile_premises, compile_rules, entity, location_claims, role_input
from .baseline import FrozenBaseline
from .contracts import (Model, RuntimeAggregate, Scheduler, World,
                        INTERACTIVE_EVENT, INTERACTIVE_SCHEDULER, INTERACTIVE_STATE)
from .domain import RuntimeFault, canonical


class PeriodInput(Model):
    year: int | None = Field(default=None, ge=-999999, le=999999)
    event_id: str | None = Field(default=None, max_length=120)
    side: Literal['before', 'after'] | None = None

    @model_validator(mode='after')
    def one_position(self):
        if self.year is not None and self.event_id or bool(self.event_id) != bool(self.side):
            raise ValueError('Choose a year or one side of an event.')
        return self


class BackgroundInput(Model):
    materials: list[scenarios.MaterialInput] = Field(min_length=1, max_length=30)
    expanded: list[str] = Field(default_factory=list, max_length=200)
    excluded: list[str] = Field(default_factory=list, max_length=400)
    period: PeriodInput = Field(default_factory=PeriodInput)


class OpeningInput(Model):
    mode: Literal['continue', 'custom']
    material_index: int | None = Field(default=None, ge=0)
    location: scenarios.Binding
    time: str = Field(default='', max_length=160)
    situation: str = Field(default='', max_length=3000)


class PreparedInput(BackgroundInput):
    title: str = Field(min_length=1, max_length=100, pattern=r'\S')
    scope_key: str = Field(pattern=r'^[0-9a-f]{64}$')
    origin_node_id: str | None = Field(default=None, max_length=120)
    opening: OpeningInput
    cast: list[scenarios.Binding] = Field(min_length=1, max_length=12)
    review: OpeningReview | None = None
    reopened_from: str | None = Field(default=None, min_length=1, max_length=120)

    @model_serializer(mode='wrap')
    def serialize(self, handler):
        value = handler(self)
        if self.review is None:
            value.pop('review', None)
        if self.reopened_from is None:
            value.pop('reopened_from', None)
        return value


class AuthoredInput(PreparedInput):
    request_id: str = Field(min_length=1, max_length=120)


def _span(source):
    return source.node_id, source.version, source.start, source.end


def _active_node(conn, world, identity):
    node = writing_location(conn, identity)
    return node if node and node['world_id'] == world and node['status'] == 'active' else None


def _selection_metadata(conn, source):
    """Use the nearest explicit bindings of a selected document or its ancestors."""
    values = {}
    identity = source['node_id']
    while identity:
        row = conn.execute('SELECT parent_id,title,kind,metadata,version FROM nodes WHERE id=?', (identity,)).fetchone()
        metadata = source['content_version']['metadata'] if identity == source['node_id'] else json.loads(row['metadata'])
        for key in ('location_id', 'pov_id', 'story_time'):
            if metadata.get(key):
                values.setdefault(key, (metadata[key], row['title']))
        identity = row['parent_id']
    return values


class Background:
    def __init__(self, conn, world, body):
        if not conn.execute('SELECT 1 FROM worlds WHERE id=? AND archived=0', (world,)).fetchone():
            raise RuntimeFault('world_unavailable')
        if any(s.purpose != 'author_reference' or s.known_by for s in body.materials):
            raise RuntimeFault('invalid_scenario_material')
        if len({_span(s) for s in body.materials}) != len(body.materials):
            raise RuntimeFault('invalid_scenario_material')
        self.conn, self.world = conn, world
        self.revision = canon.revision(conn, world)
        self.excluded = set(body.excluded)
        self.by_key = {}
        self.sources = {}
        self.children = {}
        self.relationships = {}
        self.snapshots = {}
        self.linked_materials = {}
        self.anchors = []
        self.materials = scenarios._resolve_materials(conn, world, body.materials, set())
        self.selected_nodes = {material['node_id'] for material in self.materials}
        period = body.period
        moment = periods.Moment(period.year, period.event_id, period.side) if (
            period.year is not None or period.event_id) else None
        self.view = periods.PeriodView(conn, world, moment)
        self.period = dict(year=period.year, side=period.side, event=self.view.event_summary(period.event_id))
        for source in self.materials:
            self.add_selection(source)
        self.expansion_sources = {key for key in self.by_key if key.startswith('entity:')}
        self.expanded = set(body.expanded) & self.expansion_sources
        for root in sorted(self.expanded - self.excluded):
            self.expand(root)
        included = self.reachable() - self.excluded
        self.add_map_connections(included)
        self.add_maps(included)

    def add(self, kind, identity, name, version, reason, snapshot, *, key=None, subtype=None, parent=None):
        key = key or f'{kind}:{identity}'
        if key not in self.by_key:
            self.by_key[key] = dict(key=key, id=identity, kind=subtype or kind, title=name, version=version)
            self.snapshots[key] = snapshot
        reasons = self.sources.setdefault(key, {}).setdefault(parent, [])
        if reason not in reasons:
            reasons.append(reason)
        if parent is not None:
            self.children.setdefault(parent, {})[key] = None
        return key

    def add_entity(self, identity, reason, *, parent=None):
        value = entity(self.conn, self.world, identity)
        if value:
            key = f'entity:{identity}'
            if key not in self.snapshots and self.view.moment:
                value['period_values'] = [{'label': field['label'], 'value': field['value']}
                                          for field in periods.card_fields(self.conn, value, self.view)]
            return self.add('entity', identity, value['name'], value['version'], reason, value,
                            subtype=value['kind'], parent=parent)
        return None

    def add_document(self, identity, reason):
        if identity in self.selected_nodes or not _active_node(self.conn, self.world, identity):
            return
        row = self.conn.execute('SELECT title,version,kind,plain_text FROM nodes WHERE id=?', (identity,)).fetchone()
        if not row['plain_text'].strip():
            return
        key = f'node:{identity}'
        if key not in self.linked_materials and key not in self.excluded:
            selection = scenarios.MaterialInput(node_id=identity, version=row['version'], start=0, end=len(row['plain_text']))
            self.linked_materials[key] = scenarios._resolve_materials(self.conn, self.world, [selection], set())[0]
        self.add('node', identity, row['title'], row['version'], reason, dict(row), key=key)

    def add_record(self, kind, identity, reason, *, expanded_from=None):
        table = material_sources.TABLES[kind]
        row = self.conn.execute(f"SELECT * FROM {table} WHERE id=? AND status='active'", (identity,)).fetchone()
        if row is None:
            return
        item = record(row)
        # Runtime manifests use a discrete JSON contract. Retain numeric Canon
        # fields and map coordinates in their original decimal representation.
        if isinstance(item.get('typed_value'), float):
            item['typed_value'] = row['typed_value']
        if isinstance(item.get('strength'), float):
            item['strength'] = str(row['strength'])
        if kind == 'relationship':
            pair = self.conn.execute("""SELECT * FROM temporal_relationships WHERE id=? AND status='active'
                                        AND merged_into IS NULL""", (item['relationship_id'],)).fetchone()
            if not pair:
                return
            item.update(world_id=pair['world_id'], subject_id=pair['subject_id'], object_id=pair['object_id'])
        if item['world_id'] != self.world:
            return
        if kind in ('assertion', 'relationship'):
            anchor = self.conn.execute('SELECT * FROM canon_record_periods WHERE kind=? AND record_id=?',
                                       (kind, identity)).fetchone()
            if anchor:
                item.update(from_event_id=anchor['from_event_id'], to_event_id=anchor['to_event_id'])
        if not self.view.visible(item):
            return
        title = item.get('title') or item.get('label') or item['predicate']
        key = self.add(kind, identity, title, item['version'], reason, item, parent=expanded_from)
        for field in ('subject_id', 'object_id', 'location_id'):
            if item.get(field) and f'entity:{item[field]}' != expanded_from:
                self.add_entity(item[field], f'{title}的关联对象', parent=key)

    def add_selection(self, source):
        identity = source['node_id']
        location = _active_node(self.conn, self.world, identity)
        if not location:
            raise RuntimeFault('scenario_sources_changed')
        title = source['title']
        start, end = source['start'], source['end']
        doc = source['content_version']['document']
        for mark, attr, add in (('entityMention', 'entityId', self.add_entity),
                                ('contentLink', 'nodeId', self.add_document)):
            _, ranges = material_sources.mention_ranges(doc, mark, attr)
            for target, left, right in ranges:
                if left < end and right > start:
                    add(target, f'「{title}」所选正文中的链接')
        for row in self.conn.execute("""SELECT object_type,object_id FROM material_sources
                WHERE world_id=? AND node_id=? AND source_version=? AND status='active'
                AND (scope='document' OR (start<? AND end>?))
                ORDER BY object_type,object_id""", (self.world, identity, source['version'], end, start)):
            reason = f'「{title}」的原文绑定'
            if row['object_type'] == 'entity':
                self.add_entity(row['object_id'], reason)
            else:
                self.add_record(row['object_type'], row['object_id'], reason)
        metadata = _selection_metadata(self.conn, source)
        place, time = metadata.get('location_id', ('', ''))[0], metadata.get('story_time', ('', ''))[0]
        for field, label in (('location_id', '地点'), ('pov_id', '视角人物')):
            if field in metadata:
                value, bound_title = metadata[field]
                self.add_entity(value, f'「{bound_title}」标注的{label}')
        # The scene path supplies navigation context without widening the quoted range.
        self.anchors.append(dict(title=title, path=location['path'], location_id=place, time=time,
                                 version=source['version'], start=start, end=end, text=source['text']))

    def relationship_records(self, entity):
        identity = entity['id']
        if identity not in self.relationships:
            self.relationships[identity] = periods.anchored_records(self.conn, entity, self.view, 'relationship')
        return self.relationships[identity]

    def expansion_records(self, key):
        entity = self.snapshots[key]
        for relationship in self.relationship_records(entity):
            yield 'relationship', relationship['id'], '关系'
        for fact in periods.anchored_records(self.conn, entity, self.view, 'assertion'):
            if fact['object_id']:
                yield 'assertion', fact['id'], '对象字段'

    def expand(self, root):
        name = self.snapshots[root]['name']
        for kind, identity, label in self.expansion_records(root):
            self.add_record(kind, identity, f'从「{name}」展开的{label}', expanded_from=root)

    def reachable(self):
        # A removed entry stays reachable for Restore, but supplies no children.
        pending = [key for key, sources in self.sources.items() if None in sources]
        reached = set()
        while pending:
            key = pending.pop()
            if key not in reached:
                reached.add(key)
                if key not in self.excluded:
                    pending.extend(self.children.get(key, ()))
        return reached

    def add_map_connections(self, included):
        places = {entry['id']: self.snapshots[key] for key, entry in self.by_key.items()
                  if entry['kind'] == 'location' and key in included}
        for identity, place in places.items():
            for link in self.relationship_records(place):
                if link['map_connection'] and link['subject_id'] == identity and link['object_id'] in places:
                    self.add_record('relationship', link['id'], '所选地点之间记录的地图连通')

    def add_maps(self, included):
        places = [entry for key, entry in self.by_key.items() if entry['kind'] == 'location' and key in included]
        for item in places:
            for row in self.conn.execute("""SELECT m.id,m.title,m.width,m.height,m.version,
                       f.id AS marker_id,f.name,f.points,f.kind,f.color,f.child_map_id,f.version AS marker_version
                  FROM map_features f JOIN author_maps m ON m.id=f.map_id
                  WHERE m.world_id=? AND f.entity_id=? ORDER BY m.id,f.id""", (self.world, item['id'])):
                identity = row['id']
                map_key = f'map:{identity}'
                self.add('map', identity, row['title'], row['version'], f'地图上关联地点「{item["title"]}」',
                         {**{field: row[field] for field in ('id', 'title', 'width', 'height', 'version')}, 'markers': {}},
                         key=map_key, parent=item['key'])
                self.snapshots[map_key]['markers'][row['marker_id']] = dict(
                    name=row['name'], kind=row['kind'], color=row['color'], points=json.loads(row['points'], parse_float=str),
                    child_map_id=row['child_map_id'], version=row['marker_version'], entity_id=item['id'])

    def preview(self):
        reached = self.reachable()
        included = reached - self.excluded
        entries = []
        for key, entry in self.by_key.items():
            if key in reached:
                reasons = dict.fromkeys(reason for parent, texts in self.sources[key].items()
                                        if parent is None or parent in included for reason in texts)
                entries.append(dict(entry, included=key in included, reasons=list(reasons)))
        direct_keys = [key for key, sources in self.sources.items() if None in sources]
        children = {key: [child for child in targets if child in reached]
                    for key, targets in self.children.items() if key in included}
        expandable_keys = [key for key in self.by_key if key in included and key in self.expansion_sources
                           and key not in self.expanded and next(self.expansion_records(key), None)]
        anchors = [{**anchor, 'text': anchor['text'][:360]} for anchor in self.anchors]
        # Recompute at save under the existing writer lock. A map marker can change
        # independently of the Canon revision or its map's title/image version.
        scope_key = sha256(canonical([self.revision, self.period, self.anchors, entries, self.snapshots]).encode()).hexdigest()
        return dict(scope_key=scope_key, revision=self.revision, period=self.period, materials=anchors, context=entries,
                    direct_keys=direct_keys, children=children, expandable_keys=expandable_keys)


def prepare_authored(conn, world, body):
    background = Background(conn, world, body)
    preview = background.preview()
    if body.scope_key != preview['scope_key']:
        raise RuntimeFault('scenario_sources_changed')
    origin = _active_node(conn, world, body.origin_node_id) if body.origin_node_id else None
    if body.origin_node_id and (not origin or origin['kind'] not in WRITING_KINDS):
        raise RuntimeFault('scenario_sources_changed')
    opening = body.opening
    place = bound(conn, world, opening.location, 'location')
    review = body.review or OpeningReview()
    cast = [bound(conn, world, binding, 'character') for binding in [*body.cast, *review.candidates]]
    if len({actor['id'] for actor in cast}) != len(cast) or set(review.roles) - {actor['id'] for actor in cast}:
        raise RuntimeFault('duplicate_scenario_binding')
    anchor = None
    if opening.mode == 'continue':
        if opening.material_index is None or opening.material_index >= len(background.anchors):
            raise RuntimeFault('invalid_scenario_opening')
        anchor = background.anchors[opening.material_index]
    elif opening.material_index is not None or not opening.time.strip() or not opening.situation.strip():
        raise RuntimeFault('invalid_scenario_opening')
    time = opening.time.strip() or (anchor['time'] if anchor else '')
    if not time and body.period.year is not None:
        time = f'{body.period.year}年'
    if not time and preview['period']['event']:
        time = preview['period']['event']['title'] + ('之前' if body.period.side == 'before' else '之后')
    # Opening prose and the observation question remain on the author's side.
    start = dict(mode=opening.mode, location_id=place['id'], location_name=place['name'],
                 location_version=place['version'], time=time, situation=opening.situation.strip(),
                 material_index=opening.material_index)
    if anchor:
        start['anchor'] = {key: anchor[key] for key in ('title', 'path', 'version', 'start', 'end')}
    sources = {}
    scope = [entry for entry in preview['context'] if entry['included']]
    for entry in scope:
        key = entry['key']
        kind, identity = key.split(':', 1)
        if kind in ('entity', 'assertion', 'event', 'relationship'):
            sources[key] = dict(kind='relationship_state' if kind == 'relationship' else kind,
                                source_id=identity, version=entry['version'], snapshot=background.snapshots[key])
    # Include stable bindings used by the actual start even if they are outside its reading list.
    for value in [place, *cast]:
        sources.setdefault(f'entity:{value["id"]}', dict(kind='entity', source_id=value['id'],
                           version=value['version'], snapshot=value))
    materials = [*background.materials, *background.linked_materials.values()]
    for material in materials:
        node = material['node_id']
        sources.setdefault(f'node:{node}', dict(kind='node', source_id=node, version=material['version'],
                                               snapshot=material['content_version']))
    period_snapshot = preview['period']
    if body.period.event_id:
        row = record(conn.execute('SELECT * FROM canon_events WHERE id=?', (body.period.event_id,)).fetchone())
        key = f'event:{row["id"]}'
        sources.setdefault(key, dict(kind='event', source_id=row['id'], version=row['version'], snapshot=row))
        period_snapshot = {**period_snapshot, 'event': {**period_snapshot['event'], 'version': row['version']}}
    # Use recorded map connections only within the chosen places, scoped to the background period.
    places = {entry['id']: background.snapshots[entry['key']] for entry in scope if entry['kind'] == 'location'}
    places[place['id']] = place
    baseline_id = str(uuid4())
    frozen_spans = {(m['node_id'], m['version'], m['start'], m['end']) for m in materials}
    claims = location_claims(scope, background.snapshots, (actor['id'] for actor in cast))
    agents, candidates, roles, positions, blockers = {}, {}, {}, {}, []
    for index, actor in enumerate(cast):
        identity = actor['id']
        settings = review.roles.get(identity) or CharacterOpening()
        candidate = index >= len(body.cast)
        options = [dict(id=target, name=places[target]['name'], records=records)
                   for target, records in claims[identity].items() if target in places]
        if settings.location:
            selected = bound(conn, world, settings.location, 'location')
            places.setdefault(selected['id'], selected)
            location = selected['id']
        elif len(options) > 1:
            location = place['id']
            locations = '、'.join(option['name'] for option in options)
            blockers.append(dict(kind='role', id=identity,
                message=f'「{actor["name"]}」的位置记录同时指向{locations}。请为本线选定一个地点。'))
        elif options:
            location = options[0]['id']
        else:
            location = place['id']
        positions[identity] = dict(location_id=location, location_name=places[location]['name'],
                                   chosen=bool(settings.location), options=options)
        recipient = candidates if candidate else agents
        recipient[identity] = role_input(settings, location, baseline_id, frozen_spans)
        roles[identity] = dict(id=identity, name=actor['name'], enabled=True, avatar=index % 6,
                               persona='', voice_sample=settings.voice_sample.strip(), location=location, candidate=candidate,
                               entity_id=identity, entity_version=actor['version'])
    rule_reports, rule_blockers, access, items = compile_rules(conn, world, scope, review.required_rules, places, roles)
    blockers.extend(rule_blockers)
    check = dict(blockers=blockers, rules=rule_reports,
                 reference_people=[dict(id=row['id'], name=row['title'], version=row['version']) for row in scope
                                   if row['kind'] == 'character' and row['id'] not in roles],
                 roles=[dict(id=identity, name=role['name'], candidate=role['candidate'],
                             **positions[identity]) for identity, role in roles.items()],
                 observation_question=review.observation_question.strip())
    if blockers:
        return check, None

    for value in [*places.values(), *(item['entity'] for item in items)]:
        sources.setdefault(f'entity:{value["id"]}', dict(kind='entity', source_id=value['id'],
                           version=value['version'], snapshot=value))
    topology = {identity: set() for identity in places}
    for entry in scope:
        if entry['kind'] == 'relationship':
            link = background.snapshots[entry['key']]
            left, right = link['subject_id'], link['object_id']
            if link['map_connection'] and left in topology and right in topology:
                topology[left].add(right)
                topology[right].add(left)
    state = RuntimeAggregate(world_id=world, worldline_id=str(uuid4()), baseline_id=baseline_id,
        state_schema_version=INTERACTIVE_STATE, event_schema_version=INTERACTIVE_EVENT,
        world=World(place_topology={identity: sorted(exits) for identity, exits in topology.items()},
                    items={item['id']: item['holder'] for item in items}, access_rules=access, environment={}),
        agents=agents, candidates=candidates or None, premises=compile_premises(review, agents),
        scheduler=Scheduler(ready_actor_order=list(agents), pending_jobs=[], insertion_counter=0,
                                          policy_version=INTERACTIVE_SCHEDULER))
    baseline = FrozenBaseline(baseline_id=state.baseline_id, world_id=world, canon_revision=background.revision,
                              state_schema_version=state.state_schema_version, sources=list(sources.values()))
    setup = dict(background='', adaptations='', items=[{key: value for key, value in item.items() if key != 'entity'} for item in items],
        origin_node_id=body.origin_node_id, access_rules=[rule.model_dump() for rule in access], roles=list(roles.values()),
        places=[dict(id=key, name=value['name'], description='', neighbors=sorted(topology[key]),
                     entity_id=key, entity_version=value['version']) for key, value in places.items()])
    preparation = dict(origin=origin, opening=start, period=period_snapshot, scope=scope)
    manifest = dict(schema='experience-scenario-v1', series_id='authored-text', series_version=1,
                    asset_version='text-v1', title=body.title.strip(),
                    purpose='original_projection' if anchor else 'sandbox', setup=setup, materials=materials,
                    preparation=preparation, scope_snapshots={entry['key']: background.snapshots[entry['key']]
                                                             for entry in scope if entry['kind'] == 'map'})
    for role in check['roles']:
        identity = role['id']
        sample = state.model_copy(update={'agents': {**agents, identity: candidates[identity]}}) if role['candidate'] else state
        try:
            context = scenarios.model_context(sample, identity, manifest).body
        except RuntimeFault as fault:
            if str(fault) != 'context_budget_too_small':
                raise
            blockers.append(dict(kind='role', id=identity, message=f'「{role["name"]}」的开局输入过长，请缩减后重查。'))
            continue
        settings = review.roles.get(identity) or CharacterOpening()
        role['input'] = dict(goal=context['goal'], voice_sample=context['profile'].get('voice_sample', ''),
                             knowledge=context['knowledge'], beliefs=context['beliefs'],
                             perception=context['perception'], profile=context['profile'],
                             citations={f'opening-{index}': entry.source.model_dump()
                                        for index, entry in enumerate(settings.evidence, 1) if entry.source})
        if 'expression' in context:
            role['input']['expression'] = context['expression']
    if blockers:
        return check, None
    if body.review is not None:
        preparation['readiness'] = check
    if body.reopened_from:
        from .reopen import describe
        reopened = describe(conn, world, body.reopened_from, manifest, state)
        manifest['reopen'] = reopened
        # Store the source differences once in the frozen manifest.
        check = {**check, 'reopen': reopened}
    return check, (state, baseline, manifest)


def compile_authored(conn, world, body):
    _, compiled = prepare_authored(conn, world, body)
    if compiled is None:
        raise RuntimeFault('scenario_readiness_blocked')
    return compiled
