from fastapi import APIRouter, Request, HTTPException, Query
from typing import Literal
from .creation import CreationError
from .creation_models import WorkCreate, WorkPatch, NodeCreate, NodePatch, EntityCreate, EntityPatch, MaterialCategory
from .object_schema import FactInput,FactEdit,RecordStatus,EventInput,EventEdit,RelationshipInput,RelationshipEdit,FieldDefinition,MergeInput

router = APIRouter(prefix='/api')


def repository(request: Request):
    return request.app.state.creation


@router.get('/worlds/{world_id}/works')
def works(world_id: str, request: Request):
    return repository(request).list_works(world_id)


@router.post('/worlds/{world_id}/works', status_code=201)
def create_work(world_id: str, body: WorkCreate, request: Request):
    return repository(request).create_work(world_id, body.model_dump())


@router.patch('/works/{identity}')
def update_work(identity: str, body: WorkPatch, request: Request):
    data = body.model_dump(exclude_unset=True)
    if any(value is None for value in data.values()):
        raise HTTPException(422, '修改字段不能为空。')
    return repository(request).update_work(identity, data)


@router.get('/works/{identity}/nodes')
def nodes(identity: str, request: Request):
    return repository(request).list_nodes(identity)


@router.get('/works/{identity}/content-search')
def content_search(identity: str, request: Request, q: str = Query('', max_length=200),
                   status: Literal['active', 'archived', 'deleted'] = 'active',
                   category: MaterialCategory | None = None, tag: str = Query('', max_length=80),
                   offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100)):
    repo = repository(request)
    with repo.connection() as conn:
        repo.required(conn, 'works', identity)
        pattern = '%' + q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        cte = '''WITH RECURSIVE visible(id) AS (
            SELECT id FROM nodes WHERE work_id=? AND parent_id IS NULL AND status='active'
            UNION ALL SELECT n.id FROM nodes n JOIN visible v ON n.parent_id=v.id WHERE n.status='active') '''
        where = "FROM nodes WHERE work_id=? AND status=? AND (title LIKE ? ESCAPE '\\' OR plain_text LIKE ? ESCAPE '\\')"
        args = [identity, status, pattern, pattern]
        if category:
            where += " AND COALESCE(json_extract(metadata,'$.material_category'),'unclassified')=?"
            args.append(category)
        if tag.strip():
            where += " AND EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(nodes.metadata,'$.material_tags'),'[]')) WHERE value=?)"
            args.append(tag.strip())
        if status == 'active':
            where += ' AND id IN (SELECT id FROM visible)'
            args.insert(0, identity)
        else:
            cte = ''
        total = conn.execute(cte + 'SELECT COUNT(*) ' + where, args).fetchone()[0]
        rows = conn.execute(cte + '''SELECT id,work_id,parent_id,title,kind,status,version,position,metadata,updated_at,
            substr(plain_text, max(1,instr(lower(plain_text),lower(?))-60),180) AS excerpt ''' + where +
            ' ORDER BY position,id LIMIT ? OFFSET ?',
            ([identity, q] + args[1:] if status == 'active' else [q] + args) + [limit, offset]).fetchall()
        from .creation import record
        return dict(items=[record(r) for r in rows], total=total, offset=offset, limit=limit)


@router.post('/works/{identity}/nodes', status_code=201)
def create_node(identity: str, body: NodeCreate, request: Request):
    return repository(request).create_node(identity, body.model_dump())


@router.get('/nodes/{identity}')
def node(identity: str, request: Request):
    return repository(request).get_item('nodes', identity)


@router.patch('/nodes/{identity}')
def update_node(identity: str, body: NodePatch, request: Request):
    return repository(request).update_node(identity, body.model_dump(exclude_unset=True))


@router.get('/nodes/{identity}/history')
def history(identity: str, request: Request):
    return repository(request).history(identity)


@router.get('/nodes/{identity}/history/{version}')
def history_version(identity: str, version: int, request: Request):
    return repository(request).history(identity, version)


@router.get('/worlds/{world_id}/entities')
def entities(world_id: str, request: Request):
    return repository(request).list_entities(world_id)


@router.post('/worlds/{world_id}/entities', status_code=201)
def create_entity(world_id: str, body: EntityCreate, request: Request):
    return repository(request).create_entity(world_id, body.model_dump())


@router.get('/entities/{identity}')
def entity(identity: str, request: Request):
    return repository(request).entity_context(identity)


@router.patch('/entities/{identity}')
def update_entity(identity: str, body: EntityPatch, request: Request):
    return repository(request).update_entity(identity, body.model_dump(exclude_unset=True))


@router.post('/entities/{identity}/facts', status_code=201)
def create_fact(identity: str, body: FactInput, request: Request):
    return repository(request).create_fact(identity, body.model_dump())

@router.get('/worlds/{world_id}/object-schema')
def object_schema(world_id: str,request: Request):
    return repository(request).schema(world_id)

@router.post('/worlds/{world_id}/object-schema/fields',status_code=201)
def field(world_id: str,body: FieldDefinition,request: Request):
    return repository(request).define_field(world_id,body.model_dump())

@router.patch('/facts/{identity}')
def edit_fact(identity: str,body: FactEdit,request: Request):
    return repository(request).edit_fact(identity,body.model_dump())

@router.get('/canon/{kind}/{identity}/history')
def canon_history(kind: str,identity: str,request: Request):
    return repository(request).object_history(kind,identity)

@router.patch('/canon/{kind}/{identity}/status')
def canon_status(kind: str,identity: str,body: RecordStatus,request: Request):
    return repository(request).set_record_status(kind,identity,body.model_dump())

@router.post('/worlds/{world_id}/events',status_code=201)
def create_event(world_id: str,body: EventInput,request: Request):
    return repository(request).write_event(world_id,body.model_dump())

@router.patch('/events/{identity}')
def edit_event(identity: str,body: EventEdit,request: Request):
    repo=repository(request)
    return repo.write_event(repo.get_item('canon_events',identity)['world_id'],body.model_dump(),identity)

@router.post('/worlds/{world_id}/relationship-states',status_code=201)
def create_relationship(world_id: str,body: RelationshipInput,request: Request):
    return repository(request).write_relationship(world_id,body.model_dump())

@router.patch('/relationship-states/{identity}')
def edit_relationship(identity: str,body: RelationshipEdit,request: Request):
    repo=repository(request)
    state=repo.get_item('relationship_states',identity)
    world=repo.get_item('temporal_relationships',state['relationship_id'])['world_id']
    return repo.write_relationship(world,body.model_dump(),identity)

@router.post('/entities/{identity}/merge-preview')
def merge_preview(identity: str,body: MergeInput,request: Request):
    return repository(request).merge_entities(identity,body.model_dump(),dry_run=True)

@router.post('/entities/{identity}/merge')
def merge_entity(identity: str,body: MergeInput,request: Request):
    return repository(request).merge_entities(identity,body.model_dump())


@router.get('/worlds/{world_id}/search')
def search(world_id: str, request: Request, q: str = Query(min_length=1, max_length=200)):
    return repository(request).search(world_id, q)
