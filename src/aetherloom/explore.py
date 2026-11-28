"""Read-only Canon relationship overviews and bounded neighbourhoods."""
import json
from typing import Literal

from fastapi import APIRouter, Query, Request

from . import canon
from .creation import CreationError, record
from .object_catalog import item
from .object_schema import CORE_FIELDS
from .periods import PeriodView, StoryMoment, anchored_records, card_fields, visible_keys
from .story_year import register, validate_range, timing

router = APIRouter(prefix='/api/worlds/{world}/explore')
FAMILIES = ('relationship', 'assertion', 'participation', 'location', 'cause')

# Only explicit identities produce edges. Mentions, author prose and pending
# proposals are deliberately absent; events retain their own node identity.
GRAPH = """WITH objects AS (
 SELECT 'entity:'||id AS key,id,name AS label,kind FROM entities
 WHERE world_id=:world AND status='active' AND merged_into IS NULL
 UNION ALL SELECT 'event:'||id,id,title,'event' FROM canon_events
 WHERE world_id=:world AND status='active'
), raw_edges AS (
 SELECT 'relationship:'||s.id AS id,'entity:'||r.subject_id AS source,
 'entity:'||r.object_id AS target,'relationship' AS family,'relationship' AS record_type,
 s.id AS record_id,s.label,
 CASE WHEN p.from_event_id IS NULL THEN s.valid_from ELSE se.valid_from END AS valid_from,
 CASE WHEN p.to_event_id IS NULL THEN s.valid_until ELSE ee.valid_until END AS valid_until,s.strength,s.version,
 s.description,s.source_note,'' AS metadata
 FROM relationship_states s JOIN temporal_relationships r ON r.id=s.relationship_id
 LEFT JOIN canon_record_periods p ON p.kind='relationship' AND p.record_id=s.id
 LEFT JOIN canon_events se ON se.id=p.from_event_id AND se.status='active'
 LEFT JOIN canon_events ee ON ee.id=p.to_event_id AND ee.status='active'
 WHERE r.world_id=:world AND r.merged_into IS NULL AND r.status='active' AND s.status='active'
 AND (NOT :map_view OR s.map_connection=1)
 UNION ALL SELECT 'assertion:'||f.id,'entity:'||f.subject_id,'entity:'||f.object_id,
 'assertion','assertion',f.id,f.predicate,
 CASE WHEN p.from_event_id IS NULL THEN f.valid_from ELSE se.valid_from END,
 CASE WHEN p.to_event_id IS NULL THEN f.valid_until ELSE ee.valid_until END,NULL,f.version,
 f.value,f.source_note,'' FROM assertions f
 LEFT JOIN canon_record_periods p ON p.kind='assertion' AND p.record_id=f.id
 LEFT JOIN canon_events se ON se.id=p.from_event_id AND se.status='active'
 LEFT JOIN canon_events ee ON ee.id=p.to_event_id AND ee.status='active'
 WHERE f.world_id=:world AND f.status='active' AND f.object_id IS NOT NULL
 UNION ALL SELECT 'participation:'||e.id||':'||p.entity_id,'entity:'||p.entity_id,'event:'||e.id,
 'participation','event',e.id,'参与',e.valid_from,e.valid_until,NULL,e.version,
 '',e.source_note,e.metadata FROM canon_events e JOIN event_participants p ON p.event_id=e.id
 WHERE e.world_id=:world AND e.status='active'
 UNION ALL SELECT 'location:'||id,'event:'||id,'entity:'||location_id,
 'location','event',id,'发生于',valid_from,valid_until,NULL,version,
 '',source_note,'' FROM canon_events
 WHERE world_id=:world AND status='active' AND location_id IS NOT NULL
 UNION ALL SELECT 'cause:'||c.value||':'||e.id,'event:'||c.value,'event:'||e.id,
 'cause','event',e.id,'促成',e.valid_from,e.valid_until,NULL,e.version,
 '',e.source_note,'' FROM canon_events e,json_each(e.metadata,'$.causes') c
 WHERE e.world_id=:world AND e.status='active'
), edges AS (
 SELECT r.* FROM raw_edges r JOIN objects a ON a.key=r.source JOIN objects b ON b.key=r.target
 WHERE r.family IN (SELECT value FROM json_each(:families))
 AND (:label='' OR (r.family='relationship' AND r.label=:label))
 AND (:direction!='outgoing' OR r.target!=:focus OR r.source=:focus)
 AND (:direction!='incoming' OR r.source!=:focus OR r.target=:focus)
 AND (a.key=:focus OR :kinds='[]' OR a.kind IN (SELECT value FROM json_each(:kinds)))
 AND (b.key=:focus OR :kinds='[]' OR b.kind IN (SELECT value FROM json_each(:kinds)))
 AND (:as_of IS NULL OR r.record_type || ':' || r.record_id IN (SELECT value FROM json_each(:as_of)))
 AND story_match(r.valid_from,r.valid_until,:lower,:upper)!='outside'
 AND (:uncertain OR story_match(r.valid_from,r.valid_until,:lower,:upper)='dated')
) """


def resolve(repo, conn, world, key):
    kind, _, identity = key.partition(':')
    if kind not in ('entity', 'event') or not identity:
        raise CreationError('请选择世界对象或正式事件。', 400)
    value = (repo.canonical_entity(conn, identity, world, True) if kind == 'entity'
             else repo.required(conn, 'canon_events', identity))
    if value['world_id'] != world or value['status'] != 'active':
        raise CreationError('此对象已不在当前世界的活跃范围。', 404)
    return f"{kind}:{value['id']}"


def graph_node(repo, conn, world, key, depth):
    kind, identity = key.split(':', 1)
    value = repo.required(conn, 'entities' if kind == 'entity' else 'canon_events', identity)
    ref = item(world, kind, {**value, 'aliases': json.dumps(value.get('aliases', []))})
    return dict(**ref, key=key, depth=depth, version=value['version'])


def graph_edge(row, timed):
    value = dict(row)
    if value['family'] == 'participation':
        role = json.loads(value['metadata']).get('participant_roles', {}).get(value['source'].split(':', 1)[1])
        value['label'] = f'参与 · {role}' if role else '参与'
    for field in ('metadata', 'description', 'source_note'):
        value.pop(field)
    if timed:
        value['time_uncertain'] = timing(value['valid_from'], value['valid_until'])['certainty'] != 'dated'
    return value


@router.get('/graph')
def neighbourhood(world: str, request: Request, moment: StoryMoment, focus: str = '', hops: int = Query(1, ge=1, le=2),
                  expanded: str = '', families: str = ','.join(FAMILIES), kinds: str = '',
                  limit: int = Query(60, ge=5, le=120),
                  year_start: int | None = Query(None, ge=-999999, le=999999),
                  year_end: int | None = Query(None, ge=-999999, le=999999), uncertain: bool = True,
                  event_id: str = '', projection: Literal['relationship', 'map'] = 'relationship',
                  scope: Literal['neighborhood', 'world'] = 'neighborhood',
                  direction: Literal['any', 'outgoing', 'incoming'] = 'any',
                  label: str = Query('', max_length=160)):
    repo = request.app.state.creation
    repo.get(world)
    validate_range(year_start, year_end)
    selected = [f for f in families.split(',') if f]
    if set(selected) - set(FAMILIES):
        raise CreationError('联系类别无效。', 400)
    map_view = projection == 'map'
    world_view = scope == 'world' and not map_view
    selected_kinds = ['location'] if map_view else [k for k in kinds.split(',') if k]
    if map_view:
        selected = ['relationship']
    extra = list(dict.fromkeys(k for k in expanded.split(',') if k))
    if len(extra) > 20:
        raise CreationError('请先收起部分分支，再继续展开。', 400)
    timed = not moment and (year_start is not None or year_end is not None)
    params = dict(world=world, families=json.dumps(selected), kinds=json.dumps(selected_kinds),
                  lower=year_start, upper=year_end, uncertain=uncertain, map_view=map_view,
                  label='' if map_view else label.strip(), direction='any' if map_view or world_view else direction,
                  as_of=None)
    with repo.connection() as conn:
        conn.execute('BEGIN')
        register(conn)
        revision = canon.revision(conn, world)
        if moment:
            view = PeriodView(conn, world, moment)
            params.update(as_of=json.dumps(visible_keys(conn, world, view)), lower=None, upper=None, uncertain=True)
        if world_view:
            edges = [graph_edge(row, timed) for row in conn.execute(
                GRAPH + 'SELECT * FROM edges ORDER BY family,id', {**params, 'focus': ''}
            )]
            keys = {edge[end] for edge in edges for end in ('source', 'target')}
            nodes = [graph_node(repo, conn, world, key, 1) for key in sorted(keys)]
            return dict(focus='', requested_focus='', revision=revision, nodes=nodes, edges=edges,
                        remaining_links=0, expanded=[])
        requested = focus
        if map_view and event_id:
            location = conn.execute("""SELECT a.id FROM canon_events e JOIN entities a ON a.id=e.location_id
                WHERE e.id=? AND e.world_id=? AND e.status='active' AND a.world_id=e.world_id
                AND a.kind='location' AND a.status='active' AND a.merged_into IS NULL""", (event_id, world)).fetchone()
            if not location:
                return dict(focus='', requested_focus='', revision=revision, nodes=[], edges=[], remaining_links=0, expanded=[])
            focus = requested = f"entity:{location['id']}"
        elif focus:
            focus = resolve(repo, conn, world, focus)
            if map_view and (not focus.startswith('entity:') or not conn.execute(
                "SELECT 1 FROM entities WHERE id=? AND world_id=? AND kind='location'", (focus[7:], world)
            ).fetchone()):
                focus = requested = ''
        if not focus:
            if map_view:
                row = conn.execute("SELECT 'entity:'||id FROM entities WHERE world_id=? AND kind='location' AND status='active' AND merged_into IS NULL ORDER BY name,id LIMIT 1", (world,)).fetchone()
            else:
                row = conn.execute("SELECT 'entity:'||id FROM entities WHERE world_id=? AND status='active' AND merged_into IS NULL ORDER BY name,id LIMIT 1", (world,)).fetchone()
                if not row:
                    row = conn.execute("SELECT 'event:'||id FROM canon_events WHERE world_id=? AND status='active' ORDER BY title,id LIMIT 1", (world,)).fetchone()
            focus = row[0] if row else ''
        if not focus:
            return dict(focus='', requested_focus=requested, revision=revision, nodes=[], edges=[], remaining_links=0, expanded=[])
        params['focus'] = focus
        depths = {focus: 0}
        visited, edges = set(), {}

        def expand(keys, depth):
            keys = sorted(set(keys) - visited)
            if not keys:
                return
            visited.update(keys)
            params['frontier'] = json.dumps(keys)
            # A high-degree hub cannot force an unbounded response or transfer.
            rows = conn.execute(GRAPH + "SELECT * FROM edges WHERE source IN (SELECT value FROM json_each(:frontier)) OR target IN (SELECT value FROM json_each(:frontier)) ORDER BY family,id LIMIT :edge_limit", {**params, 'edge_limit': 241}).fetchall()
            for row in rows:
                if len(edges) >= 240:
                    break
                for key in (row['source'], row['target']):
                    if key not in depths and len(depths) < limit:
                        depths[key] = depth
                if row['source'] in depths and row['target'] in depths:
                    edges[row['id']] = graph_edge(row, timed)

        expand([focus], 1)
        if hops == 2:
            expand(list(depths), 2)
        for key in extra:
            # Stale saved views remain readable when an expanded object disappears.
            if key in depths:
                expand([key], depths[key] + 1)
        # Include explicit links between already visible neighbours. A direct
        # neighbourhood limits node distance, not the truth of its inner links.
        params['visible'] = json.dumps(sorted(depths))
        context = conn.execute(GRAPH + 'SELECT * FROM edges WHERE source IN (SELECT value FROM json_each(:visible)) AND target IN (SELECT value FROM json_each(:visible)) ORDER BY family,id LIMIT 241', params).fetchall()
        for row in context:
            if row['id'] not in edges and len(edges) < 240:
                edges[row['id']] = graph_edge(row, timed)
        params['frontier'] = json.dumps(sorted(visited))
        total = conn.execute(GRAPH + 'SELECT count(*) FROM edges WHERE source IN (SELECT value FROM json_each(:frontier)) OR target IN (SELECT value FROM json_each(:frontier)) OR (source IN (SELECT value FROM json_each(:visible)) AND target IN (SELECT value FROM json_each(:visible)))', params).fetchone()[0]
        nodes = [graph_node(repo, conn, world, key, depth) for key, depth in depths.items()]
        return dict(focus=focus, requested_focus=requested, revision=revision, nodes=nodes,
                    edges=list(edges.values()), remaining_links=max(0, total-len(edges)), expanded=sorted(visited))


def source_links(repo, conn, world, kind, identity):
    from .material_sources import list_sources
    sources = [dict(label=f"{s['work_title']} / {s['title']} · v{s['source_version']}" + (' · 资料已修订' if s['stale'] else ''), to=s['to'], kind='material')
               for s in list_sources(repo, conn, kind, identity)]
    sources.extend(dict(label='正文裁决与原版本依据', to=f"/worlds/{world}/review?candidate={r[0]}", kind='review')
                   for r in conn.execute('SELECT candidate_id FROM canon_sources WHERE object_type=? AND object_id=?', (kind, identity)))
    sources.extend(dict(label=f"{r['title']} · 第 {r['seq']} 步", to=f"/worlds/{world}/simulate?session={r['simulation_id']}&event={r['seq']}", kind='simulation')
                   for r in conn.execute('SELECT s.title,p.simulation_id,p.seq FROM simulation_sources x JOIN simulation_proposals p ON p.id=x.proposal_id JOIN simulations s ON s.id=p.simulation_id WHERE x.object_type=? AND x.object_id=? AND p.world_id=?', (kind, identity, world)))
    return sources


@router.get('/detail/{kind}/{identity}')
def detail(world: str, kind: Literal['entity', 'assertion', 'event', 'relationship'], identity: str, request: Request, moment: StoryMoment):
    repo = request.app.state.creation
    repo.get(world)
    with repo.connection() as conn:
        conn.execute('BEGIN')
        value = repo.object_snapshot(conn, kind, identity)
        if value['world_id'] != world:
            raise CreationError('找不到此世界的记录。', 404)
        if kind == 'entity':
            identity = repo.canonical_entity(conn, identity, world)['id']
            value = repo.object_snapshot(conn, kind, identity)
        references = []
        reference_keys = set()
        def reference(key, label):
            if key in reference_keys:
                return
            node_kind, node_id = key.split(':', 1)
            obj = repo.required(conn, 'entities' if node_kind == 'entity' else 'canon_events', node_id)
            if obj['world_id'] == world:
                reference_keys.add(key)
                references.append(dict(key=key, label=obj.get('name', obj.get('title')),
                                       kind=obj['kind'] if node_kind == 'entity' else 'event',
                                       role=label, active=obj['status']=='active' and not obj.get('merged_into')))
        facts, settings = [], []
        if kind == 'entity':
            title = value['name']
            if moment:
                view = PeriodView(conn, world, moment)
                settings = [dict(label=item['label'], text=item['value']) for item in card_fields(conn,value,view) if item['value']]
                relevant_facts = anchored_records(conn,value,view,'assertion')
            else:
                settings = [dict(label=CORE_FIELDS[value['kind']].get(k, k), text=v) for k, v in value['core'].items() if v]
                settings += [dict(label=s['title'], text=s['body']) for s in value['sections'] if s['body']]
                relevant_facts = [record(row) for row in conn.execute(
                    "SELECT * FROM assertions WHERE subject_id=? AND status='active' ORDER BY predicate,id", (identity,))]
            for fact in relevant_facts:
                fact['sources'] = source_links(repo, conn, world, 'assertion', fact['id'])
                facts.append(fact)
                if fact['object_id']:
                    reference('entity:' + fact['object_id'], '正式事实引用')
            if value['kind'] == 'location':
                for event_row in conn.execute("SELECT id FROM canon_events WHERE world_id=? AND location_id=? AND status='active' ORDER BY valid_from,id", (world, identity)):
                    reference('event:' + event_row['id'], '关联事件')
                    for participant in conn.execute("SELECT entity_id FROM event_participants WHERE event_id=? ORDER BY entity_id", (event_row['id'],)):
                        reference('entity:' + participant['entity_id'], '事件参与者')
        elif kind == 'assertion':
            title = value['predicate']
            reference('entity:'+value['subject_id'], '事实主体')
            if value['object_id']:
                reference('entity:'+value['object_id'], '引用对象')
        elif kind == 'relationship':
            title = value['label']
            ends = (value['subject_id'], value['object_id'])
            reference('entity:' + ends[0], '记录主体')
            reference('entity:' + ends[1], '记录对象')
            events = conn.execute("""
                SELECT e.id, e.location_id
                FROM canon_events e
                WHERE e.world_id=? AND e.status='active' AND (
                    e.location_id IN (?, ?) OR EXISTS (
                        SELECT 1 FROM event_participants p
                        WHERE p.event_id=e.id AND p.entity_id IN (?, ?)))
                ORDER BY e.title, e.id LIMIT 12
            """, (world, *ends, *ends))
            for event in events:
                role = '关系端点是事件地点' if event['location_id'] in ends else '关系端点参与事件'
                reference('event:' + event['id'], role)
        else:
            title = value['title']
            for participant in value['participants']:
                reference('entity:'+participant, value['metadata'].get('participant_roles', {}).get(participant, '参与者'))
            if value['location_id']:
                reference('entity:'+value['location_id'], '发生地点')
            for cause in value['metadata'].get('causes', []):
                reference('event:'+cause, '原因事件')
        # Pair states describe story validity; object_history describes edits.
        states = []
        if kind == 'relationship':
            states = [dict(row) for row in conn.execute('SELECT * FROM relationship_states WHERE relationship_id=? ORDER BY created_at,id', (value['relationship_id'],))]
        versions = [dict(version=v['version'], saved_at=v['saved_at'], payload=v['payload']) for v in repo.object_history(kind, identity)]
        return dict(kind=kind, id=identity, title=title, record=value, settings=settings, facts=facts, references=references,
                    sources=source_links(repo, conn, world, kind, identity), states=states, history=versions)
