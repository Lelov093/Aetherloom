"""Read-only world browsing shared by navigation, pickers and quick inspection."""

import json
from typing import Literal

from fastapi import APIRouter, Query, Request
from .creation import CreationError, record

router = APIRouter(prefix='/api')
ObjectType = Literal['work', 'content', 'entity', 'event', 'relationship']
QueryType = Literal['all', 'work', 'content', 'entity', 'event', 'relationship']
VISIBLE = """WITH RECURSIVE visible(id) AS (
    SELECT n.id FROM nodes n JOIN works w ON w.id=n.work_id
    WHERE w.world_id=? AND w.status='active' AND n.status='active' AND n.parent_id IS NULL
    UNION ALL SELECT n.id FROM nodes n JOIN visible v ON n.parent_id=v.id WHERE n.status='active') """


def item(world, kind, row):
    base = f'/worlds/{world}'
    if kind == 'work':
        return dict(id=row['id'], type=kind, label=row['title'], kind=row['kind'],
                    subtitle='作品', context='Working Content', to=f"{base}/create?work={row['id']}")
    if kind == 'content':
        return dict(id=row['id'], type=kind, label=row['title'], kind=row['kind'],
                    subtitle=row['work_title'], context='Working Content', work_id=row['work_id'],
                    to=f"{base}/create?work={row['work_id']}&node={row['id']}")
    if kind == 'entity':
        return dict(id=row['id'], type=kind, label=row['name'], kind=row['kind'],
                    subtitle='、'.join(json.loads(row['aliases'])), context='Working Canon',
                    to=f"{base}/create/objects/{row['id']}")
    if kind == 'event':
        return dict(id=row['id'], type=kind, label=row['title'], kind=kind,
                    subtitle=row['valid_from'] or '故事时间未知', context='Working Canon',
                    to=f"{base}/create/records?event={row['id']}")
    return dict(id=row['id'], type=kind, label=row['label'], kind=kind,
                subtitle=f"{row['subject_name']} → {row['object_name']}", context='Working Canon',
                to=f"{base}/create/records?tab=relations&relationship={row['id']}")


def query(kind, world, q='', entity_kind=None, work_id=None):
    escaped = q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    pattern = '%' + escaped + '%'
    if kind == 'work':
        sql, args = "SELECT * FROM works WHERE world_id=? AND status='active' AND title LIKE ? ESCAPE '\\'", [world, pattern]
    elif kind == 'content':
        sql = VISIBLE + """SELECT n.*,w.title AS work_title FROM nodes n JOIN visible v ON v.id=n.id
            JOIN works w ON w.id=n.work_id WHERE (n.title LIKE ? ESCAPE '\\' OR n.plain_text LIKE ? ESCAPE '\\')"""
        args = [world, pattern, pattern]
        if work_id:
            sql += ' AND n.work_id=?'
            args.append(work_id)
    elif kind == 'entity':
        sql = "SELECT * FROM entities WHERE world_id=? AND status='active' AND merged_into IS NULL AND (name LIKE ? ESCAPE '\\' OR aliases LIKE ? ESCAPE '\\')"
        args = [world, pattern, pattern]
        if entity_kind:
            sql += ' AND kind=?'
            args.append(entity_kind)
    elif kind == 'event':
        sql = "SELECT * FROM canon_events WHERE world_id=? AND status='active' AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')"
        args = [world, pattern, pattern]
    else:
        sql = """SELECT s.*,r.world_id,r.subject_id,r.object_id,a.name AS subject_name,b.name AS object_name
            FROM relationship_states s JOIN temporal_relationships r ON r.id=s.relationship_id
            JOIN entities a ON a.id=r.subject_id JOIN entities b ON b.id=r.object_id
            WHERE r.world_id=? AND r.merged_into IS NULL AND s.status='active'
            AND (s.label LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR b.name LIKE ? ESCAPE '\\')"""
        args = [world, pattern, pattern, pattern]
    return sql, args


@router.get('/worlds/{world}/catalog')
def browse(world: str, request: Request, type: QueryType = 'entity', q: str = Query('', max_length=200),
           entity_kind: str | None = None, work_id: str | None = None,
           offset: int = Query(0, ge=0), limit: int = Query(40, ge=1, le=100)):
    repo = request.app.state.creation
    repo.get(world)
    with repo.connection() as conn:
        if type == 'all':
            items, total = [], 0
            for category in ('entity','work','content','event','relationship'):
                sql, args = query(category, world, q.strip(), entity_kind, work_id)
                total += conn.execute(f'SELECT count(*) FROM ({sql})', args).fetchone()[0]
                label = {'entity':'name','relationship':'label'}.get(category,'title')
                rows = conn.execute(sql + f' ORDER BY {label} COLLATE NOCASE,id LIMIT 8', args).fetchall()
                items.extend(item(world,category,r) for r in rows)
            return dict(items=items, total=total, offset=0, limit=40)
        sql, args = query(type, world, q.strip(), entity_kind, work_id)
        total = conn.execute(f'SELECT count(*) FROM ({sql})', args).fetchone()[0]
        # Stable ordering keeps pagination repeatable for an unchanged collection.
        label = {'entity':'name','relationship':'label'}.get(type, 'title')
        rows = conn.execute(sql + f' ORDER BY {label} COLLATE NOCASE,id LIMIT ? OFFSET ?', [*args, limit, offset]).fetchall()
        return dict(items=[item(world, type, r) for r in rows], total=total, offset=offset, limit=limit)


@router.get('/worlds/{world}/catalog/{type}/{identity}')
def inspect(world: str, type: ObjectType, identity: str, request: Request):
    repo = request.app.state.creation
    repo.get(world)
    sql, args = query(type, world)
    with repo.connection() as conn:
        row = conn.execute(f'SELECT * FROM ({sql}) WHERE id=?', [*args, identity]).fetchone()
        if not row:
            raise CreationError('对象已不在当前活跃范围，请重新选择；历史和来源仍保留。', 404)
        value = record(row)
        fields, references, sources = [], [], []
        from .material_sources import list_sources, describe

        def manual_sources(kind, target_id):
            sources.extend(dict(label=f"{s['title']} · 来源 v{s['source_version']}" + (' · 资料已修订' if s['stale'] else ''), to=s['to'])
                           for s in list_sources(repo, conn, kind, target_id))

        def field(label, text):
            if text is not None and text != '':
                fields.append(dict(label=label, text=str(text)))

        def entity_link(identity, role=''):
            target = repo.required(conn, 'entities', identity)
            references.append(dict(label=target['name'] + (f' · {role}' if role else ''),
                                   to=f"/worlds/{world}/create/objects/{identity}"))

        if type == 'entity':
            from .object_schema import CORE_FIELDS
            for key, text in value['core'].items():
                field(CORE_FIELDS[value['kind']].get(key, key), text)
            for section in value['sections']:
                field(section['title'], section['body'])
            for fact in conn.execute("SELECT * FROM assertions WHERE subject_id=? AND status='active'", (identity,)):
                period = f"（{fact['valid_from'] or '起始未知'} → {fact['valid_until'] or '结束未知'}）"
                field(fact['predicate'], fact['value'] + period + f" · {fact['source_note']}")
                sources.extend(dict(label=f"{fact['predicate']} · 裁决来源", to=f"/worlds/{world}/review?candidate={r[0]}")
                               for r in conn.execute("SELECT candidate_id FROM canon_sources WHERE object_type='assertion' AND object_id=?", (fact['id'],)))
                if fact['object_id']:
                    entity_link(fact['object_id'])
                manual_sources('assertion', fact['id'])
        elif type == 'content':
            categories = dict(zip(['unclassified','prose','lore','outline','theme','foreshadowing','note'], ['未分类','正文','设定资料','大纲','主题','伏笔','笔记 / 其他']))
            field('资料分类', categories.get(value['metadata'].get('material_category','unclassified'), '未分类'))
            field('资料标签', ' · '.join(json.loads(value['metadata'].get('material_tags','[]'))))
            for key, label in [('pov_id','视角'),('location_id','地点')]:
                if value['metadata'].get(key):
                    entity_link(value['metadata'][key], label)
            for source in conn.execute("SELECT * FROM material_sources WHERE node_id=? AND status='active'", (identity,)):
                s = describe(repo, conn, source)
                references.append(dict(label=s['target_label'],to=s['target_to']))
                sources.append(dict(label=f"手工来源 v{s['source_version']}",to=s['to']))
            field('正文摘录', value['plain_text'][:1200])
            for key, label in [('pov', '视角'), ('location', '地点'), ('story_time', '故事时间'), ('summary', '摘要')]:
                field(label, value['metadata'].get(key))
            field('当前版本', f"v{value['version']}")
            batch = value['metadata'].get('import_batch')
            if batch:
                from .imports import batch_info
                imported = batch_info(repo, world, batch)
                files = json.loads(value['metadata'].get('import_files','[]')) or [value['metadata'].get('import_file')]
                sources.extend(dict(label=f['name'], to=f['url'], download=True) for f in imported['files'] if f['name'] in files)
                for warning in imported['warnings']:
                    field('导入提示', warning)
        elif type == 'work':
            field('内容数量（含归档与删除）', conn.execute('SELECT count(*) FROM nodes WHERE work_id=?', (identity,)).fetchone()[0])
        else:
            field('说明', value['description'])
            field('故事时间', f"{value['valid_from'] or '起始未知'} → {value['valid_until'] or '结束未知'}")
            field('来源说明', value.get('source_note'))
            if type == 'event':
                field('事件前', value['metadata'].get('before_state'))
                field('结果', value['metadata'].get('after_state'))
                for p in conn.execute('SELECT entity_id FROM event_participants WHERE event_id=?', (identity,)):
                    entity_link(p[0], value['metadata'].get('participant_roles', {}).get(p[0], ''))
                if value['location_id']:
                    entity_link(value['location_id'], '发生地点')
                for cause in value['metadata'].get('causes', []):
                    event = repo.required(conn, 'canon_events', cause)
                    references.append(dict(label=event['title'], to=f"/worlds/{world}/create/records?event={cause}"))
            else:
                entity_link(value['subject_id'], '关系主体')
                entity_link(value['object_id'], '关系对象')
                if value['strength'] is not None:
                    field('关系强度', value['strength'])
        if type in ('entity', 'event', 'relationship'):
            manual_sources(type, identity)
            sources.extend(dict(label='裁决与原文来源', to=f"/worlds/{world}/review?candidate={r[0]}")
                           for r in conn.execute('SELECT candidate_id FROM canon_sources WHERE object_type=? AND object_id=?', (type, identity)))
        return dict(item=item(world, type, row), fields=fields, references=references, sources=sources)
