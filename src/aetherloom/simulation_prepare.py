"""Resolve explicit scene decisions from a single Canon/material baseline."""
import json
from . import canon
from .creation import CreationError, record
from .creation_models import inspect_document
from .canon_management import TABLES


def freeze(repo, conn, world):
    entities = [record(r) for r in conn.execute('SELECT * FROM entities WHERE world_id=?', (world,))]
    ids = {e['id'] for e in entities}
    assertions = [record(r) for r in conn.execute('SELECT * FROM assertions WHERE world_id=?', (world,))]
    events = [repo.object_snapshot(conn, 'event', r[0]) for r in conn.execute('SELECT id FROM canon_events WHERE world_id=?', (world,))]
    relations = [dict(r) for r in conn.execute('SELECT * FROM temporal_relationships WHERE world_id=?', (world,))]
    states = [repo.object_snapshot(conn, 'relationship', r[0]) for r in conn.execute('SELECT s.id FROM relationship_states s JOIN temporal_relationships r ON r.id=s.relationship_id WHERE r.world_id=?', (world,))]
    ids.update(r['id'] for r in [*assertions, *events, *states])
    history = [dict(r) for r in conn.execute('SELECT * FROM canon_object_versions') if r['object_id'] in ids]
    sources = [dict(r) for r in conn.execute('SELECT * FROM material_sources WHERE world_id=?', (world,))]
    extracted = [dict(r) for r in conn.execute('SELECT s.*,c.node_id,c.source_version,c.source_quote,c.source_spans FROM canon_sources s JOIN review_candidates c ON c.id=s.candidate_id WHERE c.world_id=?', (world,))]
    source_versions = {}
    for source in [*sources, *extracted]:
        key = (source['node_id'], source['source_version'])
        row = conn.execute('SELECT * FROM content_versions WHERE node_id=? AND version=?', key).fetchone()
        if row:
            source_versions[f'{key[0]}:{key[1]}'] = record(row)
    return dict(world=repo.required(conn, 'worlds', world), revision=canon.revision(conn, world),
                entities=entities, assertions=assertions, events=events, relationships=relations,
                relationship_states=states, history=history, sources=sources, canon_sources=extracted,
                source_versions=source_versions,
                fields=[dict(r) for r in conn.execute('SELECT * FROM world_fields WHERE world_id=?', (world,))],
                changes=[dict(r) for r in conn.execute('SELECT * FROM canon_changes WHERE world_id=?', (world,))],
                simulation_sources=[dict(r) for r in conn.execute('SELECT x.*,p.simulation_id,p.seq,p.payload AS proposal_payload,s.revision_id,e.payload AS event_payload,e.diff,e.narration FROM simulation_sources x JOIN simulation_proposals p ON p.id=x.proposal_id JOIN simulations s ON s.id=p.simulation_id JOIN simulation_events e ON e.simulation_id=p.simulation_id AND e.seq=p.seq WHERE p.world_id=?', (world,))])


def resolve(repo, conn, world, setup, snapshot):
    errors, warnings = [], []
    entities = {e['id']: e for e in snapshot['entities']}
    actors = {p.entity_id for p in setup.participants}
    places = {p.entity_id for p in setup.places}
    items = {i.entity_id for i in setup.items}
    selected = actors | places | items
    if setup.expected_revision != snapshot['revision']:
        errors.append('Canon 已变化，请重新载入并核对准备内容。')
    if snapshot['world']['archived']:
        errors.append('请先恢复世界。')
    for entries, kind in ((setup.participants, 'character'), (setup.places, 'location'), (setup.items, 'item')):
        for entry in entries:
            entity = entities.get(entry.entity_id)
            if not entity or entity['kind'] != kind or entity['status'] != 'active' or entity['merged_into'] or entity['version'] != entry.version:
                errors.append(f'对象无效或版本变化：{entry.entity_id}')
    for p in setup.participants:
        if p.location_id not in places:
            errors.append('每位角色必须有本次场景内的初始地点。')
    for p in setup.places:
        if set(p.neighbors) - places or p.entity_id in p.neighbors:
            errors.append('地点连通必须引用本次场景中的其他地点。')
    for i in setup.items:
        if i.holder_id not in actors | places:
            errors.append('物品必须位于角色或地点。')
    for rule in setup.rules:
        if rule.destination_id not in places or rule.item_id not in items:
            errors.append('进入条件必须引用本次地点与物品。')
    if setup.unsupported_hard_rules:
        errors.append('有尚不支持的必要硬规则：' + '、'.join(setup.unsupported_hard_rules))
    records, decisions = {}, []
    for selection in setup.records:
        current = next((r for r in snapshot[{'assertion':'assertions', 'event':'events', 'relationship':'relationship_states'}[selection.kind]] if r['id'] == selection.id), None)
        value = current
        if current and current['version'] != selection.version:
            historical = next((h for h in snapshot['history'] if h['object_type'] == selection.kind and h['object_id'] == selection.id and h['version'] == selection.version), None)
            value = json.loads(historical['payload']) if historical else None
        if not value:
            errors.append(f'正式记录版本不存在：{selection.id}')
            continue
        refs = {v for v in [value.get('subject_id'), value.get('object_id'), value.get('location_id'), *value.get('participants', [])] if v}
        if selection.at_start in ('effective', 'past') and refs - selected:
            errors.append(f'所选正式记录的必要对象尚未纳入场景：{selection.id}')
        if set(selection.known_by) - actors:
            errors.append('知识接收者必须是本次参与角色。')
        if selection.at_start in ('future', 'excluded') and selection.known_by:
            errors.append('未来或排除记录不得提前进入角色知识。')
        decisions.append({**selection.model_dump(), 'payload': value})
        if selection.at_start in ('effective', 'past'):
            records[selection.id] = dict(kind=selection.kind, temporal=selection.at_start, payload=value)
    # Critical typed states cannot silently disagree with the manual scene baseline.
    locations = {p.entity_id: p.location_id for p in setup.participants}
    critical = {}
    for key, r in records.items():
        v = r['payload']
        if r['kind'] == 'assertion' and r['temporal'] == 'effective':
            field = v.get('field_id') or v['predicate']
            slot = (v['subject_id'], field)
            if slot in critical and critical[slot] != (v['value'], v.get('object_id')):
                errors.append(f'本次有效事实互相矛盾：{field}。请明确排除／消歧。')
            critical[slot] = (v['value'], v.get('object_id'))
            if field in ('location', '所在地') and v['subject_id'] in locations and v.get('object_id') != locations[v['subject_id']]:
                errors.append('正式所在地与初始地点冲突，请明确消歧。')
    materials = []
    for source in setup.materials:
        node = repo.required(conn, 'nodes', source.node_id)
        work = repo.required(conn, 'works', node['work_id'])
        row = conn.execute('SELECT * FROM content_versions WHERE node_id=? AND version=?', (source.node_id, source.version)).fetchone()
        if work['world_id'] != world or not row or node['version'] != source.version:
            errors.append('资料已变化或不属于当前世界，请重新核对来源版本。')
            continue
        version = record(row)
        text = inspect_document(version['document'])[0]
        if not 0 <= source.start < source.end <= len(text):
            errors.append('资料引用范围无效。')
            continue
        if set(source.known_by) - actors or (source.purpose == 'author_reference' and source.known_by):
            errors.append('作者参考不进入角色知识；接收者须属于本次场景。')
        if source.purpose == 'agent_knowledge' and not source.known_by:
            errors.append('角色已知资料必须明确至少一位接收者。')
        materials.append({**source.model_dump(), 'title': version['title'], 'work_id':work['id'], 'work_title':work['title'], 'text': text[source.start:source.end], 'content_version': version})
    if not setup.records:
        warnings.append('未选择正式事实，将使用用户确认的局部初始状态；不会补猜世界设定。')
    warnings.append('人物背景、作者意图与叙事指导不会整段发送给所有角色。文字指导不等于可执行硬规则。')
    manifest = dict(resolver_version='explicit-scene-v1', setup=setup.model_dump(), entities={i: entities[i] for i in selected if i in entities},
                    records=records, decisions=decisions, materials=materials)
    state = dict(tick=0, next_actor=0, agents={}, places={p.entity_id: p.model_dump() for p in setup.places},
                 items={i.entity_id: i.holder_id for i in setup.items}, records=records, environment={'elapsed_steps':0})
    for p in setup.participants:
        from .simulation_engine import record_text
        known = {r.id: {'basis':'user_confirmed_at_start', 'text':record_text(records[r.id]), 'temporal':r.at_start} for r in setup.records if p.entity_id in r.known_by and r.id in records}
        for index, source in enumerate(materials):
            if p.entity_id in source['known_by']:
                known[f'material:{index}'] = {'basis':'user_confirmed_material', 'text':source['text']}
        state['agents'][p.entity_id] = dict(location=p.location_id, persona=p.persona, goal=p.goal,
                                           beliefs=p.beliefs, known=known, memories=[])
    return dict(errors=list(dict.fromkeys(errors)), warnings=warnings, manifest=manifest, initial_state=state)
