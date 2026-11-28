"""Reuse an authored start with current sources, keeping its saved line intact."""
import json

from aetherloom.creation import record
from aetherloom.creation_models import inspect_document
from aetherloom.writing_locations import writing_location

from .contracts import RunSettings
from .domain import RuntimeFault
from .execution import observation_targets


def _authored_start(conn, world, worldline):
    row = conn.execute('SELECT manifest,request FROM runtime_v2_scenarios WHERE world_id=? AND worldline_id=?',
                       (world, worldline)).fetchone()
    if row is None:
        raise RuntimeFault('reopen_requires_authored_start')
    manifest = json.loads(row['manifest'])
    if manifest.get('series_id') != 'authored-text':
        raise RuntimeFault('reopen_requires_authored_start')
    return manifest, json.loads(row['request'])


def _draft(material, *, title, version, start, end, text):
    return dict(node_id=material['node_id'], title=title, version=version,
                start=start, end=end, quote=text[start:end][:160])


def _current_selection(conn, world, material):
    original = material['content_version']
    old_text = inspect_document(original['document'])[0]
    start, end = material['start'], material['end']
    before = _draft(material, title=material['title'], version=material['version'], start=start, end=end, text=old_text)
    result = dict(before=before, current=None, current_version=None, same_text=False)
    row = conn.execute('''SELECT n.title,n.version,n.document FROM nodes n JOIN works w ON w.id=n.work_id
                          WHERE n.id=? AND w.world_id=? AND n.status='active' AND w.status='active' ''',
                       (material['node_id'], world)).fetchone()
    location = writing_location(conn, material['node_id']) if row else None
    if not location or location['status'] != 'active':
        return result
    current_text = inspect_document(record(row)['document'])[0]
    result['current_version'] = row['version']
    if not current_text.strip():
        return result
    old_selection = old_text[start:end]
    if row['version'] != material['version']:
        if start == 0 and end == len(old_text):
            start, end = 0, len(current_text)
        else:
            start = current_text.find(old_selection)
            if start < 0 or current_text.find(old_selection, start + 1) >= 0:
                return result
            end = start + len(old_selection)
    result['current'] = _draft(material, title=row['title'], version=row['version'], start=start, end=end, text=current_text)
    result['same_text'] = current_text[start:end] == old_selection
    return result


def seed(conn, world, worldline):
    from .authored_scenarios import AuthoredInput

    visible_start, request = _authored_start(conn, world, worldline)
    visited = {worldline}
    while 'parent_id' in request:
        parent = request['parent_id']
        if parent in visited:
            raise RuntimeFault('reopen_requires_authored_start')
        visited.add(parent)
        _, request = _authored_start(conn, world, parent)
    original = AuthoredInput.model_validate(request)
    config = original.model_dump(exclude={'request_id', 'reopened_from', 'scope_key', 'materials'})
    primary = [{key: material[key] for key in ('node_id', 'start', 'end', 'version')}
               for material in visible_start['materials'][:len(original.materials)]]
    if primary != [source.model_dump(include={'node_id', 'start', 'end', 'version'}) for source in original.materials]:
        raise RuntimeFault('reopen_requires_authored_start')
    origin = writing_location(conn, original.origin_node_id) if original.origin_node_id else None
    return dict(worldline_id=worldline, title=visible_start['title'], config=config,
                origin_available=not original.origin_node_id or bool(origin and origin['status'] == 'active'),
                materials=[_current_selection(conn, world, material) for material in visible_start['materials'][:len(primary)]])


def _materials(manifest):
    grouped = {}
    for index, material in enumerate(manifest.get('materials', [])):
        group = grouped.setdefault(material['node_id'], dict(title=material['title'], selections=[]))
        group['selections'].append(dict(index=index, version=material['version'], start=material['start'],
                                        end=material['end'], quote=material['text'][:240]))
    return grouped


def _scope(manifest):
    preparation = manifest.get('preparation', {})
    entries = {entry['key']: dict(title=entry['title'], version=entry['version'])
               for entry in preparation.get('scope', [])}
    setup = manifest.get('setup', {})
    for entity in [*setup.get('roles', []), *setup.get('places', [])]:
        if entity.get('entity_id'):
            entries.setdefault(f'entity:{entity["entity_id"]}', dict(title=entity['name'], version=entity['entity_version']))
    event = preparation.get('period', {}).get('event')
    if event and event.get('version'):
        entries.setdefault(f'event:{event["id"]}', dict(title=event['title'], version=event['version']))
    return entries


def describe(conn, world, worldline, manifest, state):
    previous, _ = _authored_start(conn, world, worldline)
    before, after = _materials(previous), _materials(manifest)
    materials = []
    for identity in dict.fromkeys([*before, *after]):
        old, new = before.get(identity), after.get(identity)
        old_ranges, new_ranges = (entry['selections'] if entry else [] for entry in (old, new))
        if old and new and old['title'] == new['title'] and (
            [{k: v for k, v in row.items() if k != 'index'} for row in old_ranges]
            == [{k: v for k, v in row.items() if k != 'index'} for row in new_ranges]
        ):
            continue
        materials.append(dict(id=identity, title=(new or old)['title'], before=old_ranges, after=new_ranges))
    previous_scope, new_scope = _scope(previous), _scope(manifest)
    scope = []
    for identity in dict.fromkeys([*previous_scope, *new_scope]):
        old, new = previous_scope.get(identity), new_scope.get(identity)
        if old != new or previous.get('scope_snapshots', {}).get(identity) != manifest.get('scope_snapshots', {}).get(identity):
            scope.append(dict(id=identity, title=(new or old)['title'], before=old, after=new))

    control = conn.execute('SELECT ledger FROM runtime_v2_execution_control WHERE worldline_id=?', (worldline,)).fetchone()
    old_run = json.loads(control['ledger']).get('run')
    settings, omitted = None, []
    if old_run:
        saved = RunSettings.model_validate(old_run['settings'])
        targets = observation_targets(state)
        observations = []
        for condition in saved.observations:
            if condition.target_id in targets[condition.event]:
                observations.append(condition)
            else:
                omitted.append(condition.title)
        settings = saved.model_copy(update={'observations': observations, 'retry_once': False}).model_dump()
    return dict(worldline_id=worldline, title=previous['title'], materials=materials, scope=scope,
                run_settings=settings, omitted_observations=omitted)
