"""Read-only content entry points; no snapshots or inferred Canon changes."""
from fastapi import APIRouter, Query, Request

from .creation import CreationError, record
from .creation_models import MaterialCategory
from .object_catalog import VISIBLE, query

router = APIRouter(prefix='/api/worlds')


def content_page(conn, world, q='', category=None, tag='', work_id=None, offset=0, limit=30):
    escaped = q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    where = """FROM nodes n JOIN visible v ON v.id=n.id JOIN works w ON w.id=n.work_id
        WHERE (n.title LIKE ? ESCAPE '\\' OR n.plain_text LIKE ? ESCAPE '\\')"""
    args = [world, '%' + escaped + '%', '%' + escaped + '%']
    if category:
        where += " AND COALESCE(json_extract(n.metadata,'$.material_category'),'unclassified')=?"
        args.append(category)
    if tag:
        where += " AND EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(n.metadata,'$.material_tags'),'[]')) WHERE value=?)"
        args.append(tag)
    if work_id:
        where += ' AND n.work_id=?'
        args.append(work_id)
    total = conn.execute(VISIBLE + 'SELECT count(*) ' + where, args).fetchone()[0]
    rows = conn.execute(VISIBLE + """SELECT n.id,n.work_id,n.parent_id,n.title,n.kind,n.position,
        n.status,n.version,n.metadata,n.updated_at,w.title AS work_title,
        substr(n.plain_text,max(1,instr(lower(n.plain_text),lower(?))-60),180) AS excerpt """ + where +
        ' ORDER BY n.updated_at DESC,n.id LIMIT ? OFFSET ?',
        [world, q, *args[1:], limit, offset]).fetchall()
    return dict(items=[record(row) for row in rows], total=total, offset=offset, limit=limit)


@router.get('/{world}/content-library')
def content_library(world: str, request: Request, q: str = Query('', max_length=200),
                    category: MaterialCategory | None = None, tag: str = Query('', max_length=80),
                    work_id: str | None = None, offset: int = Query(0, ge=0),
                    limit: int = Query(30, ge=1, le=100)):
    repo = request.app.state.creation
    repo.get(world)
    with repo.connection() as conn:
        if work_id:
            work = repo.required(conn, 'works', work_id)
            if work['world_id'] != world:
                raise CreationError('作品不属于当前世界。', 404)
        return content_page(conn, world, q.strip(), category, tag.strip(), work_id, offset, limit)


@router.get('/{world}/content-summary')
def summary(world: str, request: Request):
    repo = request.app.state.creation
    repo.get(world)
    with repo.connection() as conn:
        # A single read transaction keeps the summary internally consistent.
        conn.execute('BEGIN')
        works = [dict(row) for row in conn.execute(VISIBLE + """SELECT w.id,w.title,w.kind,
            count(v.id) AS content_count FROM works w LEFT JOIN nodes n ON n.work_id=w.id
            LEFT JOIN visible v ON v.id=n.id WHERE w.world_id=? AND w.status='active'
            GROUP BY w.id ORDER BY w.updated_at DESC,w.id""", (world, world))]
        counts = dict(works=len(works), content=sum(w['content_count'] for w in works))
        for kind in ('entity', 'event', 'relationship'):
            sql, args = query(kind, world)
            counts[kind] = conn.execute('SELECT count(*) FROM (' + sql + ')', args).fetchone()[0]
        counts['assertion'] = conn.execute("""SELECT count(*) FROM assertions a JOIN entities e ON e.id=a.subject_id
            WHERE a.world_id=? AND a.status='active' AND e.status='active' AND e.merged_into IS NULL""", (world,)).fetchone()[0]
        return dict(counts=counts, works=works, recent=content_page(conn, world, limit=6)['items'])
