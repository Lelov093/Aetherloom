"""Read-only connections established by stable links and explicit Canon sources."""
from fastapi import APIRouter, Request
from .review import decoded
from .object_catalog import VISIBLE

router = APIRouter(prefix='/api')


@router.get('/entities/{identity}/extraction-sources')
def extraction_sources(identity: str, request: Request):
    """Explicit Mention/Canon provenance, never a name search or inferred link."""
    repo = request.app.state.creation
    with repo.connection() as conn:
        entity = repo.required(conn, 'entities', identity)
        rows = conn.execute(VISIBLE + '''
            SELECT n.id,n.title,n.work_id,n.version,w.title AS work_title,s.source_version
            FROM (
                SELECT m.node_id,m.content_version AS source_version FROM mentions m
                JOIN nodes current ON current.id=m.node_id AND current.version=m.content_version
                WHERE m.entity_id=?
                UNION
                SELECT c.node_id,c.source_version FROM canon_sources cs
                JOIN review_candidates c ON c.id=cs.candidate_id
                WHERE c.world_id=? AND (
                    (cs.object_type='entity' AND cs.object_id=?) OR
                    (cs.object_type='assertion' AND cs.object_id IN
                        (SELECT id FROM assertions WHERE subject_id=? OR object_id=?)) OR
                    (cs.object_type='event' AND cs.object_id IN
                        (SELECT id FROM canon_events WHERE location_id=? UNION
                         SELECT event_id FROM event_participants WHERE entity_id=?)) OR
                    (cs.object_type='relationship' AND cs.object_id IN
                        (SELECT rs.id FROM relationship_states rs JOIN temporal_relationships r ON r.id=rs.relationship_id
                         WHERE r.subject_id=? OR r.object_id=?))
                )
            ) s JOIN nodes n ON n.id=s.node_id JOIN visible v ON v.id=n.id
            JOIN works w ON w.id=n.work_id WHERE w.world_id=? ORDER BY w.title,n.title,n.id,s.source_version''',
            (entity['world_id'], identity, entity['world_id'], *([identity] * 7), entity['world_id'])).fetchall()
        sources = {}
        for row in rows:
            value = dict(row)
            source_version = value.pop('source_version')
            source = sources.setdefault(value['id'], {**value, 'source_versions': []})
            if source_version not in source['source_versions']:
                source['source_versions'].append(source_version)
    return dict(world_id=entity['world_id'], sources=list(sources.values()))

@router.get('/nodes/{identity}/context')
def context(identity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        node = repo.required(conn, 'nodes', identity)
        work = repo.required(conn, 'works', node['work_id'])
        world = work['world_id']
        base = f'/worlds/{world}'
        candidates = [decoded(r) for r in conn.execute(
            "SELECT * FROM review_candidates WHERE node_id=? AND status IN ('pending','later') ORDER BY rowid", (identity,))]
        proposed_names = {(c['task_id'], c['local_key']): c['payload']['name']
                          for c in [decoded(r) for r in conn.execute(
                              "SELECT * FROM review_candidates WHERE node_id=? AND kind='entity'", (identity,))]}
        def name(candidate, reference):
            proposed = proposed_names.get((candidate['task_id'], reference))
            if proposed:
                return proposed
            entity = conn.execute('SELECT name FROM entities WHERE id=?', (reference,)).fetchone()
            return entity['name'] if entity else '待解析对象'

        def candidate_label(candidate):
            payload = candidate['payload']
            if candidate['kind']=='assertion':
                return f"{name(candidate, payload['subject_ref'])} · {payload['predicate']}：{payload['value']}"
            if candidate['kind']=='relationship':
                return f"{name(candidate, payload['subject_ref'])} → {name(candidate, payload['object_ref'])} · {payload['label']}"
            return payload.get('name') or payload['title']
        links, seen = [], set()
        def visit(value):
            for mark in value.get('marks', []):
                target = (mark.get('attrs') or {}).get('nodeId') if mark['type']=='contentLink' else None
                if target and target not in seen:
                    seen.add(target)
                    other = repo.required(conn, 'nodes', target)
                    links.append(dict(id=target,label=other['title'],status=other['status'],to=f"{base}/create?work={other['work_id']}&node={target}"))
            for child in value.get('content', []):
                visit(child)
        visit(node['document'])
        confirmed = []
        tables = {'entity':'entities','assertion':'assertions','event':'canon_events','relationship':'relationship_states'}
        for row in conn.execute('''SELECT s.object_type,s.object_id,c.id AS candidate_id,c.source_version
                FROM canon_sources s JOIN review_candidates c ON c.id=s.candidate_id WHERE c.node_id=? ORDER BY c.rowid''', (identity,)):
            kind = row['object_type']
            value = repo.required(conn, tables[kind], row['object_id'])
            if kind=='entity':
                label, to = value['name'], f"{base}/create/objects/{value['id']}"
            elif kind=='assertion':
                subject = repo.required(conn,'entities',value['subject_id'])
                label, to = f"{subject['name']} · {value['predicate']}：{value['value']}", f"{base}/create/objects/{subject['id']}?tab=facts"
            elif kind=='event':
                label,to = value['title'], f"{base}/create/records?event={value['id']}"
            else:
                relationship = repo.required(conn,'temporal_relationships',value['relationship_id'])
                subject = repo.required(conn,'entities',relationship['subject_id'])
                other = repo.required(conn,'entities',relationship['object_id'])
                label,to = f"{subject['name']} → {other['name']} · {value['label']}", f"{base}/create/records?tab=relations&relationship={value['id']}"
            confirmed.append(dict(id=value['id'],type=kind,label=label,status=value['status'],to=to,
                                  source_version=row['source_version'],source=f"{base}/review?candidate={row['candidate_id']}"))
        return dict(version=node['version'],internal_links=links,confirmed=confirmed,
                    candidates=[dict(id=c['id'],type=c['kind'],label=candidate_label(c),
                        status=c['status'],source_version=c['source_version'],to=f"{base}/review?candidate={c['id']}") for c in candidates])
