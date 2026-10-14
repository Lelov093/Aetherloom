"""Bounded Canon time projections; no duplicated history or world snapshots."""
import json

from fastapi import APIRouter, Query, Request

from . import canon
from .creation import CreationError
from .explore import graph_node, resolve
from .story_year import register, timing, validate_range

router = APIRouter(prefix='/api/worlds/{world}/explore')
LAYERS = ('event', 'relationship', 'assertion')
RECORDS = """WITH records AS (
 SELECT 'event' AS kind,e.id,e.title AS label,'' AS value,
 e.valid_from,e.valid_until,e.version,'events:'||coalesce(e.location_id,'world') AS lane_key,
 coalesce((SELECT name FROM entities WHERE id=e.location_id),'世界事件') AS lane_label,
 e.id AS event_id,NULL AS subject_id,NULL AS object_id,e.location_id
 FROM canon_events e WHERE e.world_id=:world AND e.status='active'
 UNION ALL
 SELECT 'relationship',s.id,s.label,'',s.valid_from,s.valid_until,s.version,
 'relationship:'||r.id,a.name||' → '||b.name,NULL,r.subject_id,r.object_id,NULL
 FROM relationship_states s JOIN temporal_relationships r ON r.id=s.relationship_id
 JOIN entities a ON a.id=r.subject_id JOIN entities b ON b.id=r.object_id
 WHERE r.world_id=:world AND r.status='active' AND r.merged_into IS NULL AND s.status='active'
 AND a.status='active' AND a.merged_into IS NULL AND b.status='active' AND b.merged_into IS NULL
 UNION ALL
 SELECT 'assertion',f.id,f.predicate,f.value,f.valid_from,f.valid_until,f.version,
 'assertion:'||f.subject_id||':'||f.predicate,a.name||' · '||f.predicate,NULL,f.subject_id,f.object_id,NULL
 FROM assertions f JOIN entities a ON a.id=f.subject_id
 WHERE f.world_id=:world AND f.status='active' AND a.status='active' AND a.merged_into IS NULL
 AND (f.object_id IS NULL OR EXISTS(SELECT 1 FROM entities b WHERE b.id=f.object_id AND b.status='active' AND b.merged_into IS NULL))
), scoped AS (
 SELECT *,story_match(valid_from,valid_until,:lower,:upper) AS match FROM records r
 WHERE kind IN (SELECT value FROM json_each(:layers))
 AND (:focus='' OR (:focus_kind='entity' AND (
 subject_id=:focus_id OR object_id=:focus_id OR location_id=:focus_id
 OR (kind='event' AND EXISTS(SELECT 1 FROM event_participants p WHERE p.event_id=r.id AND p.entity_id=:focus_id))))
 OR (:focus_kind='event' AND kind='event' AND id=:focus_id))
), matched AS (
 SELECT * FROM scoped WHERE match!='outside' AND (:uncertain OR match='dated')
) """


@router.get('/timeline')
def timeline(world: str, request: Request, focus: str = '', layers: str = ','.join(LAYERS),
             year_start: int | None = Query(None, ge=-999999, le=999999),
             year_end: int | None = Query(None, ge=-999999, le=999999),
             uncertain: bool = True, limit: int = Query(120, ge=1, le=240),
             offset: int = Query(0, ge=0), section: str = 'placed', locate: str = ''):
    repo = request.app.state.creation
    repo.get(world)
    validate_range(year_start, year_end)
    selected = list(dict.fromkeys(x for x in layers.split(',') if x))
    if set(selected) - set(LAYERS) or section not in ('placed', 'unplaced'):
        raise CreationError('时间展示范围无效。', 400)
    with repo.connection() as conn:
        conn.execute('BEGIN')
        register(conn)
        requested = focus
        if focus:
            focus = resolve(repo, conn, world, focus)
        kind, _, identity = focus.partition(':')
        params = dict(world=world, focus=focus, focus_kind=kind, focus_id=identity,
                      layers=json.dumps(selected), lower=year_start, upper=year_end, uncertain=uncertain)
        counts = {r['match']: r['n'] for r in conn.execute(RECORDS+'SELECT match,count(*) AS n FROM scoped GROUP BY match', params)}
        totals = {key: counts.get(key, 0) for key in ('dated', 'partial', 'undated', 'invalid', 'outside')}
        # SQL year extraction and pagination keep whole-world records out of the renderer.
        bounds = conn.execute(RECORDS+"SELECT min(y),max(y) FROM (SELECT story_year(valid_from) AS y FROM matched WHERE match IN ('dated','partial') UNION ALL SELECT story_year(valid_until) FROM matched WHERE match IN ('dated','partial'))", params).fetchone()
        test = "match IN ('dated','partial')" if section == 'placed' else "match IN ('undated','invalid')"
        total = conn.execute(RECORDS+f'SELECT count(*) FROM matched WHERE {test}', params).fetchone()[0]
        if offset >= total:
            offset = max(0, (total - 1) // limit * limit)
        if locate:
            rank = conn.execute(RECORDS+f"SELECT position FROM (SELECT kind||':'||id AS key,row_number() OVER (ORDER BY coalesce(story_year(valid_from),story_year(valid_until)),lane_label,id)-1 AS position FROM matched WHERE {test}) WHERE key=:locate", {**params, 'locate': locate}).fetchone()
            if rank:
                offset = rank[0] // limit * limit
        rows = conn.execute(RECORDS+f"SELECT * FROM matched WHERE {test} ORDER BY coalesce(story_year(valid_from),story_year(valid_until)),lane_label,id LIMIT :limit OFFSET :offset", {**params, 'limit': limit, 'offset': offset}).fetchall()
        result = []
        for row in rows:
            value = dict(row)
            value['key'] = f"{value['kind']}:{value['id']}"
            value['time'] = timing(value['valid_from'], value['valid_until'])
            value['objects'] = []
            ids = list(dict.fromkeys(x for x in (value['subject_id'], value['object_id'], value['location_id']) if x))
            if value['kind'] == 'event':
                ids += [r[0] for r in conn.execute('SELECT entity_id FROM event_participants WHERE event_id=?', (value['id'],)) if r[0] not in ids]
            for entity_id in ids:
                entity = repo.required(conn, 'entities', entity_id)
                if entity['status'] == 'active' and not entity.get('merged_into'):
                    value['objects'].append(dict(key='entity:'+entity_id, label=entity['name'], kind=entity['kind']))
            result.append(value)
        return dict(focus=focus, requested_focus=requested,
                    focus_object=graph_node(repo, conn, world, focus, 0) if focus else None,
                    revision=canon.revision(conn, world), items=result, counts=totals,
                    bounds=dict(start=bounds[0], end=bounds[1]), total=total, offset=offset,
                    remaining=max(0, total-offset-len(result)), section=section)
