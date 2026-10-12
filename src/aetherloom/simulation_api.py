import asyncio
import json
from fastapi import APIRouter, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import Field
from .creation import CreationError
from .creation_models import Model
from .simulation_models import Setup, SimProposalEdit, SimDecision
from .simulation_review import propose, preview, edit, decide
from .creation_models import inspect_document

router = APIRouter(prefix='/api')


@router.get('/worlds/{world}/simulation-inputs')
def inputs(world: str, request: Request):
    return request.app.state.simulation.repo.catalog(world)


@router.post('/worlds/{world}/simulations/prepare')
def prepare(world: str, body: Setup, request: Request):
    return request.app.state.simulation.repo.prepare(world, body)


@router.post('/worlds/{world}/simulations', status_code=201)
def create(world: str, body: Setup, request: Request):
    return request.app.state.simulation.repo.prepare(world, body, create=True)


@router.get('/worlds/{world}/simulations')
def listing(world: str, request: Request):
    request.app.state.simulation.health()
    return request.app.state.simulation.repo.listing(world)


@router.get('/simulations/{identity}')
def detail(identity: str, request: Request):
    request.app.state.simulation.health()
    return request.app.state.simulation.repo.detail(identity)


@router.get('/worlds/{world}/simulation-material')
def saved_material(world: str, request: Request, simulation: str, index: int = Query(ge=0)):
    repo = request.app.state.simulation.repo
    with repo.connection() as conn:
        session = repo.session(conn, simulation)
        materials = session['manifest']['materials']
        if session['world_id'] != world or index >= len(materials):
            raise CreationError('找不到此模拟的保存来源。',404)
        source = materials[index]
        node = repo.required(conn,'nodes',source['node_id'])
        return dict(id=f'{simulation}:{index}',node_id=source['node_id'],title=source['title'],work_id=source['work_id'],work_title=source['work_title'],
                    source_version=source['version'],current_version=node['version'],metadata=source['content_version']['metadata'],
                    text=inspect_document(source['content_version']['document'])[0],start=source['start'],end=source['end'],
                    scope='fragment',note='本次模拟冻结的资料引用；不随当前正文变化。',stale=node['version']!=source['version'],
                    status='active',source_archived=node['status']!='active',target_to=f'/worlds/{world}/simulate?session={simulation}',target_label=session['title'])


@router.get('/simulation-targets/{kind}/{identity}/sources')
def simulation_sources(kind: str, identity: str, request: Request):
    repo = request.app.state.simulation.repo
    from .canon_management import TABLES
    if kind not in TABLES:
        raise CreationError('来源对象类型无效。')
    with repo.connection() as conn:
        repo.required(conn,TABLES[kind],identity)
        return [dict(r) for r in conn.execute('SELECT p.id,p.simulation_id,p.seq,p.world_id,s.title FROM simulation_sources x JOIN simulation_proposals p ON p.id=x.proposal_id JOIN simulations s ON s.id=p.simulation_id WHERE x.object_type=? AND x.object_id=?', (kind,identity))]


@router.post('/simulations/{identity}/resume')
def resume(identity: str, request: Request):
    service = request.app.state.simulation
    if request.app.state.extraction.provider.settings.disabled:
        raise CreationError('当前为无付费检查模式：可查看已有真实结果和手工准备场景，AI 调用已停用。',409)
    if not service.health()['alive']:
        raise CreationError('Worker 已停止，请重开应用。', 503)
    return service.repo.control(identity, resume=True)


@router.post('/simulations/{identity}/pause')
def pause(identity: str, request: Request):
    return request.app.state.simulation.repo.control(identity)


@router.post('/runtime/pause-all')
def pause_all(request: Request):
    request.app.state.simulation.repo.pause_all('明确退出：已保存暂停状态。')
    return {'paused':True}


@router.post('/runtime/shutdown')
async def shutdown(request: Request):
    await request.app.state.simulation.shutdown()
    return {'paused':True,'worker_stopped':True}


@router.get('/simulations/{identity}/stream')
async def stream(identity: str, request: Request, after: int = Query(default=0, ge=0)):
    service = request.app.state.simulation
    service.repo.detail(identity, after)
    async def events():
        cursor, last = after, ''
        while not await request.is_disconnected():
            service.health()
            data = service.repo.detail(identity, cursor)
            for event in data['events']:
                cursor = event['seq']
                yield f'id: {cursor}\nevent: committed\ndata: {json.dumps(event,ensure_ascii=False)}\n\n'
            transient = json.dumps({'status':data['status'],'error':data['error'],'stream':data['stream'],
                                    'cursor':data['cursor'],'calls':data['calls'],'cost':data['cost']},ensure_ascii=False)
            if transient != last:
                last = transient
                yield f'event: status\ndata: {transient}\n\n'
            await asyncio.sleep(.2)
    return StreamingResponse(events(), media_type='text/event-stream', headers={'Cache-Control':'no-cache'})


class Propose(Model):
    seq: int = Field(ge=1)
    kind: str = 'event'


@router.post('/simulations/{identity}/proposals', status_code=201)
def proposal(identity: str, body: Propose, request: Request):
    return propose(request.app.state.simulation.repo, identity, body.seq, body.kind)


@router.get('/worlds/{world}/simulation-review')
def review_list(world: str, request: Request):
    repo = request.app.state.simulation.repo
    repo.get(world)
    with repo.connection() as conn:
        ids = [r[0] for r in conn.execute('SELECT id FROM simulation_proposals WHERE world_id=? ORDER BY created_at DESC', (world,))]
    return [preview(repo, identity) for identity in ids]


@router.get('/simulation-review/{identity}')
def review_preview(identity: str, request: Request):
    return preview(request.app.state.simulation.repo, identity)


@router.patch('/simulation-review/{identity}')
def review_edit(identity: str, body: SimProposalEdit, request: Request):
    return edit(request.app.state.simulation.repo, identity, body)


@router.post('/simulation-review/{identity}/decide')
def review_decide(identity: str, body: SimDecision, request: Request):
    return decide(request.app.state.simulation.repo, identity, body)
