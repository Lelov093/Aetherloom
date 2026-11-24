"""Explicit, atomic template preparation on an already migrated shared database."""
from uuid import uuid4
from typing import Literal

from pydantic import Field, model_serializer

from aetherloom import canon
from aetherloom.creation import record
from aetherloom.creation_models import inspect_document
from .baseline import FrozenBaseline
from .contracts import (Model, Agent, Evidence, BaselineSource, RuntimeAggregate,
                        World, Scheduler, INTERACTIVE_STATE, INTERACTIVE_EVENT, INTERACTIVE_SCHEDULER,
                        COGNITIVE_STATE, READING_STATE, READING_EVENT)
from .domain import RuntimeFault, canonical
from .series import ACADEMY
from .social_models import SocialSetup


class Binding(Model):
    entity_id: str | None = None
    entity_version: int | None = Field(default=None, ge=1)


class PlaceInput(Binding):
    id: str
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default='', max_length=1200)
    neighbors: list[str] = Field(max_length=3)


class RoleInput(Binding):
    id: str
    enabled: bool = True
    name: str = Field(min_length=1, max_length=80)
    avatar: int = Field(ge=0, le=5)
    persona: str = Field(default='', max_length=2000)
    goal: str = Field(min_length=1, max_length=1000)
    location: str
    knowledge: list[str] = Field(default_factory=list, max_length=12)
    beliefs: list[str] = Field(default_factory=list, max_length=8)


class ItemInput(Model):
    id: str
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default='', max_length=600)
    holder: str
    text: str | None = Field(default=None,min_length=1,max_length=1200)

    @model_serializer(mode='wrap')
    def serialize(self, handler):
        value = handler(self)
        if self.text is None: value.pop('text',None)
        return value


class MaterialInput(Model):
    node_id: str = Field(min_length=1, max_length=120)
    version: int = Field(ge=1)
    start: int = Field(ge=0)
    end: int = Field(ge=1)
    purpose: Literal['author_reference', 'agent_knowledge'] = 'author_reference'
    known_by: list[str] = Field(default_factory=list, max_length=6)


class EntryInput(Model):
    destination_id: str
    item_id: str


class ScenarioInput(Model):
    request_id: str = Field(min_length=1, max_length=120)
    expected_revision: int = Field(ge=0)
    series_id: Literal['modern-academy'] = 'modern-academy'
    # Old clients omitted this field; preserve their frozen request/idempotence semantics.
    series_version: Literal[1, 2] = 1
    purpose: Literal['original_projection', 'template_parallel', 'sandbox'] = 'template_parallel'
    title: str = Field(min_length=1, max_length=100)
    background: str = Field(default='', max_length=3000)
    public_knowledge: str = Field(default='', max_length=1200)
    adaptations: str = Field(min_length=1, max_length=3000)
    roles: list[RoleInput] = Field(min_length=6, max_length=6)
    places: list[PlaceInput] = Field(min_length=4, max_length=4)
    items: list[ItemInput] = Field(min_length=3, max_length=3)
    materials: list[MaterialInput] = Field(default_factory=list, max_length=30)
    access_rules: list[EntryInput] = Field(default_factory=list, max_length=4)
    unsupported_hard_rules: list[str] = Field(default_factory=list, max_length=8)
    confirmed: bool = False
    social: SocialSetup | None = None


def _slots(values, defaults):
    expected = {v['id'] for v in defaults}
    if {v.id for v in values} != expected or len(values) != len(expected):
        raise RuntimeFault('invalid_series_slots')


def _resolve_materials(conn, world, values, actors):
    materials = []
    for source in values:
        row = conn.execute('''SELECT n.*, w.world_id, w.title AS work_title
                              FROM nodes n JOIN works w ON w.id=n.work_id
                              WHERE n.id=?''', (source.node_id,)).fetchone()
        version_row = conn.execute('SELECT * FROM content_versions WHERE node_id=? AND version=?',
                                    (source.node_id, source.version)).fetchone()
        if not row or row['world_id'] != world or not version_row or row['version'] != source.version:
            raise RuntimeFault('scenario_sources_changed')
        version = record(version_row)
        text = inspect_document(version['document'])[0]
        if not 0 <= source.start < source.end <= len(text):
            raise RuntimeFault('invalid_scenario_material')
        if source.purpose == 'author_reference' and source.known_by:
            raise RuntimeFault('invalid_scenario_material')
        if source.purpose == 'agent_knowledge' and (not source.known_by or set(source.known_by) - actors):
            raise RuntimeFault('invalid_scenario_material')
        materials.append({**source.model_dump(), 'title': version['title'],
                          'work_id': row['work_id'], 'work_title': row['work_title'],
                          'text': text[source.start:source.end], 'content_version': version})
    return materials


def compile_scenario(conn, world, body):
    """Called within the same write transaction as baseline/initial/scenario save."""
    row = conn.execute('SELECT * FROM worlds WHERE id=?', (world,)).fetchone()
    if not row or row['archived']:
        raise RuntimeFault('world_unavailable')
    if canon.revision(conn, world) != body.expected_revision:
        raise RuntimeFault('scenario_sources_changed')
    if not body.confirmed or not body.adaptations.strip():
        raise RuntimeFault('scenario_confirmation_required')
    if body.unsupported_hard_rules:
        raise RuntimeFault('unsupported_scenario_rules')
    if body.purpose == 'original_projection' and (body.social is None or any(
        not entry.entity_id for entry in [p for p in body.roles if p.enabled] + body.places)):
        raise RuntimeFault('original_projection_bindings_required')
    for values, defaults in ((body.roles, ACADEMY['roles']), (body.places, ACADEMY['places']), (body.items, ACADEMY['items'])):
        _slots(values, defaults)
    places = {p.id for p in body.places}
    roles = {p.id for p in body.roles if p.enabled}
    if not roles:
        raise RuntimeFault('scenario_actor_required')
    if any(p.location not in places for p in body.roles if p.enabled):
        raise RuntimeFault('invalid_scenario_location')
    allowed = {p['id']: set(p['neighbors']) for p in ACADEMY['places']}
    if any(set(p.neighbors) - allowed[p.id] or len(set(p.neighbors)) != len(p.neighbors) for p in body.places):
        raise RuntimeFault('invalid_scenario_connection')
    if any(i.holder not in roles | places for i in body.items):
        raise RuntimeFault('invalid_scenario_holder')
    if any(r.destination_id not in places or r.item_id not in {i.id for i in body.items} for r in body.access_rules):
        raise RuntimeFault('invalid_scenario_access_rule')
    sources, seen = [], set()
    for entry, kind in [(r, 'character') for r in body.roles if r.enabled] + [(p, 'location') for p in body.places]:
        if not entry.entity_id:
            if entry.entity_version is not None: raise RuntimeFault('invalid_scenario_binding')
            continue
        row = conn.execute('SELECT * FROM entities WHERE id=? AND world_id=?', (entry.entity_id, world)).fetchone()
        entity = record(row) if row else None
        if not entity or entity['kind'] != kind or entity['status'] != 'active' or entity.get('merged_into') or entity['version'] != entry.entity_version:
            raise RuntimeFault('scenario_sources_changed')
        if entry.entity_id in seen:
            raise RuntimeFault('duplicate_scenario_binding')
        seen.add(entry.entity_id)
        sources.append(dict(kind='entity', source_id=entry.entity_id, version=entry.entity_version, snapshot=entity))
    materials = _resolve_materials(conn, world, body.materials, roles)
    line, baseline_id = str(uuid4()), str(uuid4())
    agents = {}
    for person in body.roles:
        if not person.enabled: continue
        knowledge = ([body.public_knowledge] if body.public_knowledge.strip() else []) + person.knowledge
        if any(not text.strip() or len(text) > 1200 for text in knowledge + person.beliefs):
            raise RuntimeFault('invalid_scenario_cognition')
        known = {
            f'initial-{i}': Evidence(text=text, basis='initial', source=BaselineSource(baseline_id=baseline_id))
            for i, text in enumerate(knowledge)
        }
        for index, material in enumerate(materials):
            if person.id in material['known_by']:
                known[f'material-{index}'] = Evidence(
                    text=material['text'], basis='initial',
                    source=BaselineSource(baseline_id=baseline_id),
                )
        agents[person.id] = Agent(location=person.location, goal=person.goal,
            known=known,
            beliefs={f'initial-{i}': text for i, text in enumerate(person.beliefs)})
    state = RuntimeAggregate(world_id=world, worldline_id=line, baseline_id=baseline_id,
        state_schema_version=INTERACTIVE_STATE, event_schema_version=INTERACTIVE_EVENT,
        world=World(place_topology={p.id: p.neighbors for p in body.places}, items={i.id: i.holder for i in body.items},
                    access_rules=[r.model_dump() for r in body.access_rules], environment={}),
        agents=agents, scheduler=Scheduler(ready_actor_order=list(agents), pending_jobs=[], insertion_counter=0, policy_version=INTERACTIVE_SCHEDULER))
    from .social_setup import compile_social
    compile_social(conn, body, state, sources)
    texts = {i.id:i.text for i in body.items if i.text is not None}
    if texts:
        if state.state_schema_version != COGNITIVE_STATE: raise RuntimeFault('reading_requires_cognitive_setup')
        if any(not text.strip() for text in texts.values()): raise RuntimeFault('invalid_item_text')
        state.world.item_texts = texts
        state.state_schema_version, state.event_schema_version = READING_STATE, READING_EVENT
    baseline = FrozenBaseline(baseline_id=baseline_id, world_id=world, canon_revision=body.expected_revision,
                              state_schema_version=state.state_schema_version, sources=sources)
    manifest = dict(schema='experience-scenario-v1', series_id=ACADEMY['id'], series_version=body.series_version,
                    asset_version=f'academy-art-v{body.series_version}', title=body.title, purpose=body.purpose,
                    setup=body.model_dump(exclude={'request_id'}), materials=materials)
    return state, baseline, manifest


def create(runtime, world, body, *, hook=lambda stage: None):
    store = runtime._enabled()
    if not runtime.options.interactive or store.layout != 'shared' or store.storage_version < 3:
        raise RuntimeFault('scenario_migration_required')
    if body.social is not None and store.storage_version < 4:
        raise RuntimeFault('social_history_migration_required')
    payload = canonical(body.model_dump(exclude={'social'} if body.social is None else set()))
    with store.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        prior = conn.execute('SELECT worldline_id,request FROM runtime_v2_scenarios WHERE world_id=? AND request_id=?', (world, body.request_id)).fetchone()
        if prior:
            if prior['request'] != payload: raise RuntimeFault('scenario_request_conflict')
            return {'worldline_id': prior['worldline_id'], 'world_id': world}
        state, baseline, manifest = compile_scenario(conn, world, body)
        hook('prepared')
        store.create(state, baseline=baseline, connection=conn)
        hook('initial_saved')
        conn.execute('INSERT INTO runtime_v2_scenarios VALUES(?,?,?,?,?)', (state.worldline_id, world, body.request_id, payload, canonical(manifest)))
        hook('scenario_saved')
        conn.commit()
        return {'worldline_id': state.worldline_id, 'world_id': world}


def view(manifest, projection):
    """Only current authorized identities and visible exit labels reach the renderer."""
    if not manifest: return None
    setup, role = manifest['setup'], projection['role']
    places = set(projection['world']['place_topology']) | {v for vs in projection['world']['place_topology'].values() for v in vs}
    actors, items = set(projection['agents']), set(projection['world']['items'])
    result = {key: manifest[key] for key in ('series_id', 'series_version', 'asset_version', 'title', 'purpose')}
    result['places'] = {p['id']: {'name': p['name'], 'description': p['description'] if p['id'] in projection['world']['place_topology'] else ''}
                        for p in setup['places'] if p['id'] in places}
    result['actors'] = {p['id']: {k: p[k] for k in ('name', 'avatar')} for p in setup['roles'] if p['enabled'] and p['id'] in actors}
    result['items'] = {p['id']: {k: p[k] for k in ('name', 'description')} for p in setup['items'] if p['id'] in items}
    if role == 'creator_observer':
        for item in setup['items']:
            if item.get('text') is not None: result['items'][item['id']]['text'] = item['text']
        result['background'] = setup['background']
        result['adaptations'] = setup['adaptations']
        result['initial_setup'] = {
            'role_locations': {p['id']: p['location'] for p in setup['roles'] if p['enabled']},
            'item_holders': {i['id']: i['holder'] for i in setup['items']},
            'exits': {p['id']: p['neighbors'] for p in setup['places']},
            'access_rules': setup.get('access_rules', []),
        }
        if setup.get('social'): result['social_setup'] = setup['social']
        result['sources'] = {p['id']: {'entity_id': p['entity_id'], 'entity_version': p['entity_version']}
                             for p in setup['roles'] + setup['places'] if p.get('entity_id')}
        result['materials'] = [{key: value[key] for key in
                               ('node_id', 'version', 'start', 'end', 'purpose', 'title', 'work_id', 'work_title')}
                              for value in manifest.get('materials', [])]
        for p in setup['roles']:
            if p['id'] in actors: result['actors'][p['id']]['persona'] = p['persona']
    elif role == 'participant':
        own = next(p for p in setup['roles'] if p['id'] == projection['actor_id'])
        result['actors'][own['id']]['persona'] = own['persona']
    return result


def profile(store, state, actor):
    manifest = store.scenario(state.worldline_id)
    if not manifest: return None
    from .interactive import perception
    local = perception(state, actor)
    mine = next(p for p in manifest['setup']['roles'] if p['id'] == actor)
    visible_places = set(local['exits']) | {local['location']}
    recognized = set(local['people'])
    if state.social:
        own=state.social.agents[actor]
        recognized |= set(own.appraisals) | {p.target_id for p in own.plans} | {m.actor_id for m in state.agents[actor].memories}
    return {'name': mine['name'], 'persona': mine['persona'],
            'place_description': next(p['description'] for p in manifest['setup']['places'] if p['id'] == local['location']),
            'place_names': {p['id']: p['name'] for p in manifest['setup']['places'] if p['id'] in visible_places},
            'people_names': {p['id']: p['name'] for p in manifest['setup']['roles'] if p['id'] in recognized},
            'item_names': {p['id']: p['name'] for p in manifest['setup']['items'] if p['id'] in local['items']},
            'item_descriptions': {p['id']: p['description'] for p in manifest['setup']['items'] if p['id'] in local['items']}}
