"""Plan a portable, explicitly selected view of a work or world."""

import json
import re
from collections import defaultdict
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from uuid import UUID
from posixpath import relpath
from typing import Callable, Literal

from pydantic import Field

from .creation import CreationError, record
from .creation_models import Model, inspect_document
from .export_render import IMAGE_FORMATS, TEXT_FORMATS, draw_map, manuscript, picture, reference, text
from .import_assets import find_import_original, read_import_batch
from .object_schema import CORE_FIELDS

MATERIALS = {
    'prose': '正文', 'lore': '设定资料', 'outline': '大纲',
    'theme': '主题', 'foreshadowing': '伏笔', 'note': '笔记与其他', 'unclassified': '资料',
}
OBJECTS = {
    'character': '人物', 'location': '地点与场景', 'faction': '组织', 'item': '物品',
    'species': '种族', 'concept': '概念', 'world_rule': '世界规则', 'custom': '自定义对象',
}
WRITING = {'volume', 'chapter', 'act', 'scene', 'section'}
ROOT = ('AetherLoom',)
Link = Callable[[str], str | None]


class ExportSelection(Model):
    work_id: str | None = None
    reader: bool = False
    selected: list[str] | None = Field(default=None, max_length=50000)
    formats: dict[str, str] = Field(default_factory=dict, max_length=50000)


def name(value):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '＿', value).strip().rstrip('. ')
    if re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\..*)?', value, re.I):
        value = '_' + value
    return value[:80].rstrip('. ') or '未命名'


def heading(label, body=''):
    return f'# {text(label)}\n\n{body}\n'


def listed(label, target, link):
    path = link(target)
    return reference(text(label), path) if path else text(label)


def json_document(value):
    return json.dumps(value, ensure_ascii=False, indent=2)


@dataclass(frozen=True)
class Entry:
    key: str
    title: str
    directory: tuple[str, ...]
    stem: str
    formats: tuple[str, ...]
    content: Callable[[Link], str | bytes] | Path | None
    selected: bool
    target: str | None = None
    suffix: str = ''
    version: str = ''

    def path(self, fmt):
        suffix = self.suffix if fmt == 'original' else '.' + fmt
        return PurePosixPath(*self.directory, self.stem + suffix)


@dataclass(frozen=True)
class ExportFile:
    source: Entry
    fmt: str
    path: PurePosixPath
    alias: bool = False


class WorkspacePlan:
    def __init__(self, title):
        self.title = title
        self.entries: list[Entry] = []
        self.occupied = defaultdict(set)
        self.reading_order = defaultdict(list)

    def unique(self, directory, title, *, file=False):
        names = self.occupied[directory, file]
        base = name(title)
        distinct = base
        index = 2
        while distinct.casefold() in names:
            distinct = f'{base}（{index}）'
            index += 1
        names.add(distinct.casefold())
        return distinct

    def folder(self, base, title):
        return (*base, self.unique(base, title))

    def add(self, key, title, directory, content, *, formats=TEXT_FORMATS, selected=True, target=None, suffix='', version=''):
        stem = Path(title).stem if formats == ('original',) else title
        item = Entry(key, title, directory, self.unique(directory, stem, file=True), formats, content,
                     selected, target, suffix, str(version))
        self.entries.append(item)
        return item

    def resolve(self, options):
        known = {entry.key for entry in self.entries}
        selected = set(options.selected) if options.selected is not None else {e.key for e in self.entries if e.selected}
        if (selected | options.formats.keys()) - known:
            raise CreationError('资料范围已变动，请重新读取导出预览。', 409)
        targets, files, rows = {}, [], []
        for item in self.entries:
            checked = item.key in selected
            alias = checked and item.target is not None and item.target in targets
            fmt = options.formats.get(item.key, item.formats[0])
            if fmt not in item.formats:
                raise CreationError(f'「{item.title}」无法导出为该格式。', 400)
            if alias:
                fmt = 'md'
            path = item.path(fmt)
            if checked:
                files.append(ExportFile(item, fmt, path, alias))
                if item.target and not alias:
                    targets[item.target] = path
            rows.append(dict(key=item.key, title=item.title, directory=item.directory, formats=item.formats,
                             format=fmt, path=str(path), selected=checked, alias=alias, missing=item.content is None))
        generated = []
        for directory, order in self.reading_order.items():
            visible = [(label, target) for label, target in order if target in targets]
            if not visible:
                continue
            # Allocate after the real content so an author's own 目录.md keeps its name.
            base = '阅读顺序'
            taken = {entry.stem.casefold() for entry in self.entries if entry.directory == directory}
            while base.casefold() in taken:
                base += '·'
            def index_body(link, lines=visible):
                return heading('阅读顺序', '\n'.join(
                    '- ' + listed(label, target, link) for label, target in lines))
            item = Entry('', '阅读顺序', directory, base, ('md',), index_body, True)
            files.append(ExportFile(item, 'md', item.path('md')))
            generated.append(str(item.path('md')))
        fingerprint = [(file.source.key, str(file.path), file.source.version, file.alias) for file in files]
        stamp = sha256(json.dumps(fingerprint, ensure_ascii=False).encode()).hexdigest()
        return {'title': self.title, 'items': rows, 'generated': generated, 'stamp': stamp}, files, targets


def path_link(targets, source_path, target):
    destination = targets.get(target)
    return quote(relpath(destination.as_posix(), source_path.parent.as_posix()), safe='/') if destination else None


def is_reader_node(node, category):
    return category == 'prose' or category == 'unclassified' and node['kind'] in WRITING


def work_pages(plan, conn, work, folder, reader):
    rows = [record(row) for row in conn.execute(
        """SELECT * FROM nodes WHERE work_id=? AND status='active' ORDER BY position,created_at,id""", (work['id'],)
    )]
    children = defaultdict(list)
    for row in rows:
        children[row['parent_id']].append(row)
    included = []
    prose_dir = (*folder, '正文')

    def walk(parent, directory, inherited):
        for node in children[parent]:
            category = node['metadata'].get('material_category', 'unclassified')
            category = inherited if category == 'unclassified' and inherited != 'unclassified' else category
            prose = is_reader_node(node, category)
            branch = directory or (prose_dir if prose else (*folder, MATERIALS.get(category, '资料')))
            has_children = bool(children[node['id']])
            if has_children:
                branch = plan.folder(branch, node['title'])
            if prose or not reader:
                included.append(node)
                target = f'node:{node["id"]}'
                if node['plain_text'].strip() or not has_children:
                    plan.add(target, node['title'], branch, lambda link, item=node: heading(
                        item['title'], manuscript(item['document'], link)), target=target, version=node['version'])
                    if prose:
                        plan.reading_order[prose_dir].append((node['title'], target))
            walk(node['id'], branch if prose or not reader else None, category)

    walk(None, None, 'unclassified')
    return included


def entity_scope(conn, world, nodes, work):
    if not work:
        return None, None, None
    node_ids = {node['id'] for node in nodes}
    targets, events, states = set(), set(), set()
    for node in nodes:
        _, mentions, _ = inspect_document(node['document'])
        targets.update(identity for identity, _ in mentions)
        targets.update(node['metadata'].get(key) for key in ('location_id', 'pov_id') if node['metadata'].get(key))
    for source in conn.execute("""SELECT node_id, object_type, object_id FROM material_sources
        WHERE world_id=? AND status='active'""", (world,)):
        if source['node_id'] not in node_ids:
            continue
        kind, identity = source['object_type'], source['object_id']
        if kind == 'entity':
            targets.add(identity)
        elif kind == 'event':
            events.add(identity)
        elif kind == 'relationship':
            states.add(identity)
        elif kind == 'assertion':
            row = conn.execute('SELECT subject_id FROM assertions WHERE id=? AND world_id=?', (identity, world)).fetchone()
            if row:
                targets.add(row['subject_id'])
    for passage in conn.execute("""SELECT p.node_id,coalesce(p.event_id,c.event_id) AS event_id
        FROM narrative_passages p JOIN nodes n ON p.node_id=n.id
        LEFT JOIN narrative_clues c ON p.clue_id=c.id WHERE n.work_id=? AND p.status='active'""", (work,)):
        if passage['node_id'] in node_ids and passage['event_id']:
            events.add(passage['event_id'])
    for identity in events:
        event = conn.execute('SELECT location_id FROM canon_events WHERE id=? AND world_id=?', (identity, world)).fetchone()
        if event and event['location_id']:
            targets.add(event['location_id'])
        targets.update(r[0] for r in conn.execute('SELECT entity_id FROM event_participants WHERE event_id=?', (identity,)))
    for identity in states:
        endpoints = conn.execute("""SELECT r.subject_id,r.object_id FROM relationship_states s
            JOIN temporal_relationships r ON s.relationship_id=r.id WHERE s.id=? AND r.world_id=?""", (identity, world)).fetchone()
        if endpoints:
            targets.update(endpoints)
    return targets, events, states


def category_folders(plan, conn, world, folder):
    children = defaultdict(list)
    for row in conn.execute('SELECT id,parent_id,name FROM world_categories WHERE world_id=? ORDER BY name,id', (world,)):
        children[row['parent_id']].append(row)
    folders = {}

    def walk(identity, branch):
        for row in children[identity]:
            path = plan.folder(branch, row['name'])
            folders[row['id']] = path
            walk(row['id'], path)

    walk(None, folder)
    return folders


def load_entities(conn, world):
    return {row['id']: record(row) for row in conn.execute(
        "SELECT * FROM entities WHERE world_id=? AND status='active' AND merged_into IS NULL ORDER BY name,id", (world,)
    )}


def add_cards(plan, conn, world, folder, entities, wanted, reader):
    folders = category_folders(plan, conn, world, folder)
    memberships, facts = defaultdict(list), defaultdict(list)
    for row in conn.execute("""SELECT m.category_id,m.entity_id FROM world_category_members m
        JOIN world_categories c ON c.id=m.category_id WHERE c.world_id=? ORDER BY c.name,c.id""", (world,)):
        memberships[row['entity_id']].append(row['category_id'])
    for row in conn.execute("SELECT * FROM assertions WHERE world_id=? AND status='active' ORDER BY created_at,id", (world,)):
        facts[row['subject_id']].append(dict(row))
    portraits = {row['entity_id']: row for row in conn.execute("""SELECT p.entity_id,p.version,p.media_type
        FROM entity_portraits p JOIN entities e ON e.id=p.entity_id WHERE e.world_id=? AND p.active=1""", (world,))}

    def card(row, link, image):
        identity = row['id']
        lines = [f'类型　{OBJECTS.get(row["kind"], row["kind"])}']
        if row['aliases']:
            lines.append('别名　' + '、'.join(text(alias) for alias in row['aliases']))
        if image and link(image):
            lines.append(picture('展示图片', link(image)))
        for field, label in CORE_FIELDS.get(row['kind'], {}).items():
            value = row['core'].get(field, '')
            if value:
                lines.append(f'**{text(label)}**　{text(value)}')
        for section in row['sections']:
            lines.append(f'## {text(section["title"])}\n\n{text(section["body"])}')
        if facts[identity]:
            lines.append('## 正式事实')
            for fact in facts[identity]:
                object_id = fact['object_id']
                value = listed(entities[object_id]['name'], f'entity:{object_id}', link) if object_id in entities else text(fact['value'])
                dates = time_range(fact)
                source = f' · {text(fact["source_note"])}' if fact['source_note'] else ''
                lines.append(f'- {text(fact["predicate"])}　{value}{dates}{source}')
        return heading(row['name'], '\n\n'.join(lines))

    for identity, row in entities.items():
        if wanted is not None and identity not in wanted:
            continue
        locations = [folders[group] for group in memberships[identity] if group in folders]
        if not locations:
            locations = [(*folder, OBJECTS.get(row['kind'], '对象'))]
        image_target = f'portrait:{identity}' if identity in portraits else None
        for index, location in enumerate(locations):
            plan.add(f'entity:{identity}:{index}', row['name'], location,
                     lambda link, card_row=row, image=image_target: card(card_row, link, image),
                     selected=not reader, target=f'entity:{identity}', version=row['version'])
        if image_target:
            def payload(identity=identity):
                return conn.execute('SELECT image FROM entity_portraits WHERE entity_id=?', (identity,)).fetchone()[0]
            add_image(plan, image_target, row['name'] + ' · 展示图片', (*locations[0], '展示图片'),
                      payload, portraits[identity]['media_type'], not reader, portraits[identity]['version'])


def add_image(plan, key, title, directory, payload, mime, selected, version):
    preferred = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}.get(mime, 'png')
    formats = (preferred, *(fmt for fmt in IMAGE_FORMATS if fmt != preferred))
    plan.add(key, title, directory, lambda _: payload(), formats=formats, selected=selected, target=key, version=version)


def time_range(row):
    if row['valid_from'] or row['valid_until']:
        return f' （{text(row["valid_from"] or "起点未定")} 至 {text(row["valid_until"] or "延续")}）'
    return ''


def add_records(plan, conn, world, folder, entities, wanted, event_ids, state_ids):
    for row in conn.execute("SELECT * FROM canon_events WHERE world_id=? AND status='active' ORDER BY valid_from,created_at,id", (world,)):
        if event_ids is not None and row['id'] not in event_ids:
            continue
        event = dict(row)
        def event_page(link, event=event):
            loc = event['location_id']
            place = '\n\n地点　' + listed(entities[loc]['name'], f'entity:{loc}', link) if loc in entities else ''
            return heading(event['title'], text(event['description']) + time_range(event) + place)
        plan.add(f'event:{event["id"]}', event['title'], (*folder, '事件'), event_page,
                 target=f'event:{event["id"]}', version=event['version'])
    for row in conn.execute("""SELECT s.*,r.subject_id,r.object_id FROM relationship_states s
        JOIN temporal_relationships r ON r.id=s.relationship_id
        WHERE r.world_id=? AND r.status='active' AND s.status='active' ORDER BY s.created_at,s.id""", (world,)):
        subject, obj = row['subject_id'], row['object_id']
        if subject not in entities or obj not in entities:
            continue
        if wanted is not None and row['id'] not in state_ids and not {subject, obj} <= wanted:
            continue
        a, b = entities[subject]['name'], entities[obj]['name']
        title = f'{a} · {row["label"]} · {b}'
        def relation_page(link, row=dict(row), a=a, b=b, title=title):
            pair = listed(a, f'entity:{row["subject_id"]}', link) + ' → ' + listed(b, f'entity:{row["object_id"]}', link)
            return heading(title, pair + time_range(row) + '\n\n' + text(row['description']))
        plan.add(f'relationship:{row["id"]}', title, (*folder, '关系'), relation_page, version=dict(row).get('version', 1))


def add_clues(plan, conn, folder, work, nodes):
    by_node = {node['id']: node['title'] for node in nodes}
    for clue in conn.execute('SELECT * FROM narrative_clues WHERE work_id=? ORDER BY title,id', (work,)):
        uses = [(row['node_id'], row['use_kind'], row['note']) for row in conn.execute(
            "SELECT node_id,use_kind,note FROM narrative_passages WHERE clue_id=? AND status='active' ORDER BY source_version,start,id", (clue['id'],))]
        def clue_page(link, row=dict(clue), uses=uses):
            status = {'unresolved': '待回收', 'resolved': '已回收', 'intentional_blank': '有意留白'}[row['status']]
            marks = {'mention': '提及', 'hint': '暗示', 'reveal': '揭示', 'recall': '回忆', 'payoff': '回收'}
            body = [status, *[f'- {marks[kind]}　{listed(by_node[node], f"node:{node}", link)}　{text(note)}'
                             for node,kind,note in uses if node in by_node]]
            return heading(row['title'], '\n\n'.join(body))
        plan.add(f'clue:{clue["id"]}', clue['title'], (*folder, '伏笔'), clue_page, version=clue['version'])


def add_maps(plan, conn, world, folder, entities, wanted):
    maps = {row['id']: row for row in conn.execute('''SELECT id,title,width,height,version,media_type
        FROM author_maps WHERE world_id=? ORDER BY created_at,id''', (world,))}
    features = defaultdict(list)
    parents = defaultdict(set)
    for feature in conn.execute('''SELECT f.* FROM map_features f JOIN author_maps m ON m.id=f.map_id
        WHERE m.world_id=? ORDER BY f.rowid''', (world,)):
        row = {**dict(feature), 'points': json.loads(feature['points'])}
        features[row['map_id']].append(row)
        if row['child_map_id'] in maps:
            parents[row['child_map_id']].add(row['map_id'])
    chosen = set(maps) if wanted is None else {identity for identity, rows in features.items()
        if any(row['entity_id'] in wanted for row in rows)}
    if wanted is not None:
        # Ancestors supply the author's route to the selected place.
        pending = list(chosen)
        while pending:
            related = parents[pending.pop()] - chosen
            chosen.update(related)
            pending.extend(related)
    for identity, row in maps.items():
        if identity not in chosen:
            continue
        title = row['title']
        route = plan.folder((*folder, '地图'), title)
        image_key, map_key = f'map-image:{identity}', f'map:{identity}'
        rows = features[identity]
        def background(identity=identity):
            return conn.execute('SELECT background FROM author_maps WHERE id=?', (identity,)).fetchone()[0]
        def map_image(_, background=background, size=(row['width'], row['height']), rows=rows):
            return draw_map(background(), size, rows)
        plan.add(image_key, title, route, map_image,
                 formats=IMAGE_FORMATS, target=image_key, version=row['version'])
        if row['media_type']:
            add_image(plan, f'map-background:{identity}', '原始底图', route, background,
                      row['media_type'], True, row['version'])
        def map_page(link, rows=rows, title=title, image_key=image_key):
            lines = [picture(title, link(image_key))] if link(image_key) else []
            kinds = {'marker': '地点标记', 'region': '区域', 'label': '标注'}
            for i, row in enumerate(rows, 1):
                place, child = row['entity_id'], row['child_map_id']
                label = f'{i}. {text(row["name"])}（{kinds[row["kind"]]}）'
                if place in entities:
                    label += ' · ' + listed(entities[place]['name'], f'entity:{place}', link)
                if child in maps:
                    label += ' · 子图 ' + listed(maps[child]['title'], f'map:{child}', link)
                lines.append(label)
            return heading(title, '\n\n'.join(lines))
        plan.add(map_key, '地图与地点', route, map_page, target=map_key, version=row['version'])


def add_originals(plan, repo, world, folder, nodes, selected):
    batches = defaultdict(set)
    for node in nodes:
        stamped = node['metadata']
        if not stamped.get('import_batch'):
            continue
        try:
            batch = str(UUID(stamped['import_batch']))
            files = json.loads(stamped.get('import_files', '[]'))
        except (TypeError, ValueError):
            continue
        if not files and stamped.get('import_file'):
            files = [stamped['import_file']]
        batches[batch].update(file for file in files if isinstance(file, str) and file)
    for identity, chosen in batches.items():
        route = repo.path.parent / 'imports' / identity
        try:
            metadata = read_import_batch(route)
            originals = {record['name']: record['asset'] for record in metadata['files']} if metadata['world_id'] == world else {}
        except (OSError, ValueError, KeyError, TypeError):
            originals = {}
        for index, title in enumerate(sorted(chosen)):
            suffix = Path(title).suffix
            path = find_import_original(route, originals[title]) if title in originals else None
            plan.add(f'original:{identity}:{index}', title, (*folder, '导入原件'), path, formats=('original',),
                     selected=selected, suffix=suffix if re.fullmatch(r'\.[a-zA-Z0-9]{1,12}', suffix) else '')


def add_inspirations(plan, conn, world, folder, nodes, entities, wanted, reader):
    node_ids = {node['id'] for node in nodes}
    node_titles = {node['id']: node['title'] for node in nodes}
    adoptions = defaultdict(list)
    if not reader:
        for row in conn.execute('''SELECT a.inspiration_id,a.node_id,a.source_version,a.start,a.end FROM inspiration_adoptions a
            JOIN inspirations i ON i.id=a.inspiration_id WHERE i.world_id=? ORDER BY a.created_at,a.id''', (world,)):
            if row['node_id'] in node_ids:
                adoptions[row['inspiration_id']].append(dict(row))
    for row in conn.execute("SELECT * FROM inspirations WHERE world_id=? AND status='active' ORDER BY created_at,id", (world,)):
        item = record(row)
        linked = [item['origin_node_id'], *item['assigned_nodes'], *item['linked_nodes']]
        if wanted is not None and not (node_ids.intersection(linked) or wanted.intersection(item['linked_entities'])
                                       or adoptions[item['id']]):
            continue

        def idea_page(link, item=item, linked=linked):
            lines = ['模拟摘录' if item['origin'] == 'simulation' else '作者手记', text(item['note'])]
            if item['tags']:
                lines.append('标签　' + '、'.join(text(tag) for tag in item['tags']))
            if item['source'].get('summary'):
                lines.append(text(item['source']['summary']))
            if item['source'].get('worldline_id'):
                line = item['source']['worldline_id']
                lines.append('模拟出处　' + listed(f'原世界线 · 第 {item["source"].get("seq", "—")} 步',
                                                   f'line:{line}', link))
            for node in dict.fromkeys(linked):
                if node in node_titles:
                    lines.append('作品位置　' + listed(node_titles[node], f'node:{node}', link))
            for identity in item['linked_entities']:
                if identity in entities:
                    lines.append('关联对象　' + listed(entities[identity]['name'], f'entity:{identity}', link))
            for use in adoptions[item['id']]:
                node = use['node_id']
                lines.append(f'采用选段　{listed(node_titles[node], f"node:{node}", link)} · v{use["source_version"]}'
                             f' · {use["start"]}–{use["end"]}')
            return heading(item['title'], '\n\n'.join(lines))

        plan.add(f'inspiration:{item["id"]}', item['title'], (*folder, '灵感库'), idea_page,
                 selected=wanted is not None and not reader, version=item['version'])


def add_versions(plan, conn, world, folder, work, nodes, wanted, event_ids, state_ids):
    node_ids = {node['id'] for node in nodes}
    for row in conn.execute('''SELECT v.node_id,v.version,v.title,n.work_id,n.status,w.title AS work_title
        FROM content_versions v JOIN nodes n ON n.id=v.node_id JOIN works w ON w.id=n.work_id
        WHERE w.world_id=? AND (v.version<n.version OR n.status='archived' OR w.status='archived')
        ORDER BY w.created_at,n.position,n.id,v.version''', (world,)):
        if work is not None and row['work_id'] != work:
            continue
        if row['node_id'] not in node_ids and row['status'] == 'deleted':
            continue
        title = f'{row["title"]} · v{row["version"]}'
        route = (*folder, '历史版本', '正文') if work else (*folder, '历史版本', '正文', name(row['work_title']))
        def previous_manuscript(link, node=row['node_id'], version=row['version'], title=title):
            document = conn.execute('SELECT document FROM content_versions WHERE node_id=? AND version=?',
                                    (node, version)).fetchone()[0]
            return heading(title, manuscript(json.loads(document), link))
        plan.add(f'node-version:{row["node_id"]}:{row["version"]}', title, route,
                 previous_manuscript, selected=False)
    for row in conn.execute('''
        WITH items(kind,id,world_id,name,version,status,subject,object) AS (
            SELECT 'entity',id,world_id,name,version,status,id,NULL FROM entities
            UNION ALL SELECT 'assertion',f.id,f.world_id,e.name||' · '||f.predicate,f.version,f.status,f.subject_id,f.object_id
                FROM assertions f JOIN entities e ON e.id=f.subject_id
            UNION ALL SELECT 'event',id,world_id,title,version,status,NULL,NULL FROM canon_events
            UNION ALL SELECT 'relationship',s.id,r.world_id,a.name||' · '||s.label||' · '||b.name,s.version,s.status,r.subject_id,r.object_id
                FROM relationship_states s JOIN temporal_relationships r ON s.relationship_id=r.id
                JOIN entities a ON a.id=r.subject_id JOIN entities b ON b.id=r.object_id
        )
        SELECT i.kind,i.id,i.name,i.subject,i.object,v.version FROM canon_object_versions v
        JOIN items i ON v.object_id=i.id AND v.object_type=i.kind
        WHERE i.world_id=? AND (v.version<i.version OR i.status!='active') ORDER BY i.name,i.id,v.version''', (world,)):
        kind, identity, version = row['kind'], row['id'], row['version']
        if wanted is not None and not (
            (row['subject'] in wanted and kind in ('entity', 'assertion')) or
            (kind == 'event' and identity in event_ids) or
            (kind == 'relationship' and (identity in state_ids or {row['subject'], row['object']} <= wanted))
        ):
            continue
        title = f'{row["name"]} · v{version}'
        label = {'entity': '对象卡片', 'event': '事件', 'assertion': '正式事实', 'relationship': '关系'}[kind]
        def previous_record(_, kind=kind, identity=identity, version=version):
            payload = conn.execute('SELECT payload FROM canon_object_versions WHERE object_type=? AND object_id=? AND version=?',
                                   (kind, identity, version)).fetchone()[0]
            return json_document(json.loads(payload))
        plan.add(f'{kind}-version:{identity}:{version}', title, (*folder, '历史版本', label), previous_record,
                 formats=('json',), selected=False)
    for row in conn.execute('''SELECT v.*,i.origin_node_id,i.assigned_nodes AS current_assignments,
            i.linked_nodes AS current_links,i.linked_entities AS current_entities FROM inspiration_versions v
        JOIN inspirations i ON i.id=v.inspiration_id WHERE i.world_id=? AND (v.version<i.version OR i.status='archived')
        ORDER BY i.title,i.id,v.version''', (world,)):
        related = [row['origin_node_id'], *json.loads(row['current_assignments']), *json.loads(row['current_links'])]
        if wanted is not None and not (node_ids.intersection(related) or wanted.intersection(json.loads(row['current_entities']))):
            continue
        title = f'{row["title"]} · v{row["version"]}'
        plan.add(f'inspiration-version:{row["inspiration_id"]}:{row["version"]}', title, (*folder, '历史版本', '灵感'),
                 lambda _, title=title, note=row['note']: heading(title, text(note)), selected=False)


def add_legacy_lines(plan, conn, world, folder):
    for row in conn.execute('''SELECT id,title,updated_at FROM simulations
        WHERE world_id=? ORDER BY created_at,id''', (world,)):
        def line_body(_, identity=row['id']):
            data = conn.execute('SELECT id,title,status,cursor,manifest,initial_state FROM simulations WHERE id=?',
                                (identity,)).fetchone()
            line = {**dict(data), 'manifest': json.loads(data['manifest']), 'initial_state': json.loads(data['initial_state'])}
            records = [{**dict(event), 'payload': json.loads(event['payload']), 'diff': json.loads(event['diff'])}
                       for event in conn.execute('SELECT * FROM simulation_events WHERE simulation_id=? ORDER BY seq', (identity,))]
            return json_document(dict(line=line, steps=records))
        plan.add(f'legacy-line:{row["id"]}', row['title'], (*folder, '完整模拟记录'), line_body,
                 formats=('json',), selected=False, version=row['updated_at'])


def add_runtime_lines(plan, conn, world, folder):
    for row in conn.execute('''SELECT w.id,w.head_seq,w.engine_version,
        coalesce(json_extract(s.manifest,'$.title'),json_extract(s.manifest,'$.setup.title')) AS title
        FROM runtime_v2_worldlines w LEFT JOIN runtime_v2_scenarios s ON s.worldline_id=w.id
        WHERE w.world_id=? ORDER BY w.id''', (world,)):
        title = row['title'] or f'世界线 {row["id"][:8]}'
        def line_body(_, row=row):
            data = conn.execute('''SELECT w.initial,s.manifest FROM runtime_v2_worldlines w
                LEFT JOIN runtime_v2_scenarios s ON s.worldline_id=w.id WHERE w.id=?''', (row['id'],)).fetchone()
            line = dict(id=row['id'], engine_version=row['engine_version'], initial=json.loads(data['initial']),
                        head_seq=row['head_seq'], scenario=json.loads(data['manifest']) if data['manifest'] else {})
            records = [json.loads(event['payload']) for event in conn.execute(
                'SELECT payload FROM runtime_v2_journal WHERE worldline_id=? ORDER BY seq', (row['id'],))]
            return json_document(dict(line=line, steps=records))
        plan.add(f'line:{row["id"]}', title, (*folder, '完整模拟记录'), line_body,
                 formats=('json',), selected=False, target=f'line:{row["id"]}', version=row['head_seq'])


def build_plan(repo, conn, world, options, runtime_conn=None):
    info = repo.required(conn, 'worlds', world)
    if options.reader and not options.work_id:
        raise CreationError('请先选择要导出读者稿的作品。', 400)
    works = [dict(row) for row in conn.execute(
        "SELECT * FROM works WHERE world_id=? AND status='active' ORDER BY created_at,id", (world,))]
    work = next((row for row in works if row['id'] == options.work_id), None)
    if options.work_id and not work:
        raise CreationError('找不到可导出的作品。', 404)
    plan = WorkspacePlan(work['title'] if work else info['name'])
    whole = (*ROOT, name(info['name']))
    work_folders = {row['id']: plan.folder(whole, row['title']) for row in works}
    folder = work_folders[work['id']] if work else whole
    nodes = []
    scoped = [work] if work else works
    for item in scoped:
        route = work_folders[item['id']]
        pages = work_pages(plan, conn, item, route, options.reader)
        nodes.extend(pages)
        if not options.reader:
            cover = conn.execute('SELECT version,media_type FROM work_covers WHERE work_id=? AND active=1', (item['id'],)).fetchone()
            if cover:
                def cover_payload(identity=item['id']):
                    return conn.execute('SELECT image FROM work_covers WHERE work_id=?', (identity,)).fetchone()[0]
                add_image(plan, f'cover:{item["id"]}', '作品封面', route, cover_payload, cover['media_type'], True, cover['version'])
            add_clues(plan, conn, route, item['id'], pages)
    if not work:
        plan.add(f'world:{world}', '世界概览', folder, lambda _: heading(info['name'], text(info['description'])), version=info['version'])
    entities = load_entities(conn, world)
    wanted, events, states = entity_scope(conn, world, nodes, options.work_id)
    add_cards(plan, conn, world, folder, entities, wanted, options.reader)
    original_nodes = nodes if options.reader else [record(row) for row in conn.execute('''
        SELECT n.metadata FROM nodes n JOIN works w ON n.work_id=w.id WHERE w.world_id=?
        AND n.status!='deleted' AND w.status!='deleted' AND (? IS NULL OR w.id=?)
        ORDER BY w.created_at,n.position,n.id''', (world, options.work_id, options.work_id))]
    add_originals(plan, repo, world, folder, original_nodes, selected=False)
    add_inspirations(plan, conn, world, folder, nodes, entities, wanted, options.reader)
    if not options.reader:
        add_records(plan, conn, world, folder, entities, wanted, events, states)
        add_maps(plan, conn, world, folder, entities, wanted)
        add_versions(plan, conn, world, folder, options.work_id, nodes, wanted, events, states)
    if not work:
        add_legacy_lines(plan, conn, world, folder)
        if runtime_conn is not None:
            add_runtime_lines(plan, runtime_conn, world, folder)
    return plan
