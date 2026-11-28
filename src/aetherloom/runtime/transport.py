"""Local desktop capability transport. No action, participant or migration routes."""
import asyncio
import json
import secrets
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.concurrency import run_in_threadpool

from .domain import RuntimeFault
from .contracts import RunSettings
from . import authored_scenarios, scenarios, series
from . import review
from aetherloom.material_sources import describe_frozen_material


class OpenSession(BaseModel):
    model_config = ConfigDict(extra='forbid')
    world_id: str = Field(min_length=1, max_length=200)
    role: str = 'creator_observer'
    worldline_id: str | None = None
    actor_id: str | None = None
    spoiler_free: bool = False


class InputCommand(BaseModel):
    model_config = ConfigDict(extra='forbid')
    cursor: str = Field(min_length=1,max_length=200)
    request_id: str = Field(min_length=1,max_length=120)
    action_type: str
    args: dict
    reason: str = Field(default='',max_length=1000)


class AutonomyInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    actors: list[str] = Field(max_length=40)
    limit: int = Field(ge=1,le=100)
    mode: str = 'rules'


class RunSettingsInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    cursor: str = Field(min_length=1, max_length=200)
    settings: RunSettings


class ModelBudgetInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    max_calls: int = Field(ge=1, le=2000)
    limit_micro: int = Field(ge=1, le=10_000_000)


class ForkInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    request_id: str = Field(min_length=1, max_length=120)
    seq: int = Field(ge=0)
    state_hash: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=100, pattern=r'\S')


class InspirationInput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    seq: int | None = Field(default=None, ge=1)
    seqs: list[int] = Field(default_factory=list, min_length=0, max_length=32)
    title: str = Field(min_length=1, max_length=160)
    note: str = Field(default='', max_length=20000)
    tags: list[str] = Field(default_factory=list, max_length=20)
    linked_nodes: list[str] = Field(default_factory=list, max_length=12)
    linked_entities: list[str] = Field(default_factory=list, max_length=12)

    @model_validator(mode='after')
    def require_events(self):
        if self.seq is None and not self.seqs:
            raise ValueError('至少选择一条世界线事件。')
        if self.seq is not None and self.seqs and self.seq not in self.seqs:
            raise ValueError('主事件必须包含在批量来源中。')
        return self


def router_for(origin, host_secret, *, interactive=False):
    """Only mounted for an explicitly enabled, trusted Host launch.

    Host secret stays in Electron main/child environment. Renderer gets only a
    world-scoped expiring session via sender-checked IPC. No cookie/query tokens.
    """
    parsed = urlsplit(origin)
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or not parsed.port or parsed.path or parsed.query or parsed.fragment or parsed.username:
        raise RuntimeFault('invalid_host_origin')
    if len(host_secret) < 32: raise RuntimeFault('invalid_host_capability')

    def boundary(request: Request):
        if request.headers.get('host') != parsed.netloc or request.headers.get('origin', origin) != origin:
            raise HTTPException(403, 'untrusted_origin')
        if request.headers.get('sec-fetch-site') in ('cross-site', 'same-site'):
            raise HTTPException(403, 'untrusted_origin')

    def host(request: Request):
        if not secrets.compare_digest(request.headers.get('x-aetherloom-host', ''), host_secret):
            raise HTTPException(401, 'host_capability_required')

    def viewer(request: Request):
        header = request.headers.get('authorization', '')
        if not header.startswith('Bearer '): raise HTTPException(401, 'session_required')
        return header[7:]

    router = APIRouter(prefix='/api/v2', dependencies=[Depends(boundary)])

    @router.post('/session', dependencies=[Depends(host)])
    def open_session(body: OpenSession, request: Request):
        return request.app.state.projection.open(body.world_id, body.role, worldline=body.worldline_id, actor=body.actor_id,
                                                spoiler_free=body.spoiler_free)

    @router.delete('/session')
    def close_session(request: Request, token=Depends(viewer)):
        request.app.state.projection.revoke(token)
        return {'closed': True}

    @router.get('/worldlines')
    def worldlines(request: Request, token=Depends(viewer)):
        return request.app.state.projection.worldlines(token)

    if interactive:
        def author(request, token, *, full_sources=False):
            projection = request.app.state.projection
            session = projection._session(token)
            if session.role != 'creator_observer': raise RuntimeFault('unauthorized')
            if full_sources and session.spoiler_free: raise RuntimeFault('spoiler_view_active')
            return session

        @router.get('/series')
        def experience_series(request: Request, token=Depends(viewer)):
            session = author(request, token)
            store = request.app.state.vnext._enabled()
            if store.layout != 'shared':
                return {'series': series.catalog(), 'inputs': {'revision': 0, 'entities': []}, 'ready': False}
            with store.connection() as conn:
                conn.execute('PRAGMA query_only=ON')
                conn.execute('BEGIN')
                from aetherloom import canon
                inputs = {'revision': canon.revision(conn, session.world), 'entities': [dict(row) for row in conn.execute(
                    "SELECT id,name,kind,version FROM entities WHERE world_id=? AND status='active' AND merged_into IS NULL AND kind IN ('character','location')", (session.world,))]}
            return {'series': series.catalog(), 'inputs': inputs, 'ready': store.layout == 'shared' and store.storage_version >= 3,
                    'social_ready':store.storage_version>=4}

        @router.post('/scenarios')
        def create_scenario(body: scenarios.ScenarioInput, request: Request, token=Depends(viewer)):
            session = author(request, token)
            return scenarios.create(request.app.state.vnext, session.world, body)

        @router.post('/scenario-background')
        def scenario_background(body: authored_scenarios.BackgroundInput, request: Request, token=Depends(viewer)):
            session = author(request, token)
            store = scenarios.preparation_store(request.app.state.vnext)
            with store.connection() as conn:
                conn.execute('PRAGMA query_only=ON')
                conn.execute('BEGIN')
                return authored_scenarios.Background(conn, session.world, body).preview()

        @router.post('/scenarios/authored', status_code=201)
        def create_authored_scenario(body: authored_scenarios.AuthoredInput, request: Request, token=Depends(viewer)):
            session = author(request, token, full_sources=bool(body.reopened_from))
            if body.reopened_from:
                request.app.state.projection._grant(session, body.reopened_from)
            return scenarios.create(request.app.state.vnext, session.world, body, compiler=authored_scenarios.compile_authored)

        @router.post('/scenario-readiness')
        def scenario_readiness(body: authored_scenarios.PreparedInput, request: Request, token=Depends(viewer)):
            session = author(request, token, full_sources=bool(body.reopened_from))
            if body.reopened_from:
                request.app.state.projection._grant(session, body.reopened_from)
            store = scenarios.preparation_store(request.app.state.vnext)
            with store.connection() as conn:
                conn.execute('PRAGMA query_only=ON')
                conn.execute('BEGIN')
                check, _ = authored_scenarios.prepare_authored(conn, session.world, body)
                return check

        @router.get('/worldlines/{worldline}/reopen')
        def reopen_setup(worldline: str, request: Request, token=Depends(viewer)):
            session = author(request, token, full_sources=True)
            request.app.state.projection._grant(session, worldline)
            from .reopen import seed
            store = scenarios.preparation_store(request.app.state.vnext)
            with store.connection() as conn:
                conn.execute('PRAGMA query_only=ON')
                conn.execute('BEGIN')
                return seed(conn, session.world, worldline)

        @router.get('/scenario-sources')
        def scenario_sources(request: Request, token=Depends(viewer)):
            session = author(request, token)
            from .social_setup import source_catalog
            store=request.app.state.vnext._enabled()
            if store.layout != 'shared': return []
            with store.connection() as conn:
                conn.execute('PRAGMA query_only=ON')
                return source_catalog(conn, session.world)

        @router.get('/compare')
        def compare_worldlines(request: Request,
                               left: str = Query(min_length=1, max_length=200),
                               right: str = Query(min_length=1, max_length=200),
                               left_tick: int | None = Query(default=None, ge=0, le=2_147_483_647),
                               right_tick: int | None = Query(default=None, ge=0, le=2_147_483_647),
                               token=Depends(viewer)):
            session = author(request, token)
            request.app.state.projection._grant(session, left)
            request.app.state.projection._grant(session, right)
            from .comparison import compare
            store = request.app.state.vnext._enabled()
            with store.connection() as conn:
                conn.execute('PRAGMA query_only=ON')
                conn.execute('BEGIN')
                return compare(store, conn, left, right, left_tick=left_tick, right_tick=right_tick, guarded=session.spoiler_free)

        @router.post('/worldlines/{worldline}/forks', status_code=201)
        def fork_worldline(worldline: str, body: ForkInput, request: Request, token=Depends(viewer)):
            return request.app.state.projection.fork(token, worldline, body.model_dump())

        @router.get('/worldlines/{worldline}/materials')
        def frozen_material(worldline: str, request: Request, index: int = Query(ge=0), token=Depends(viewer)):
            session = author(request, token, full_sources=True)
            request.app.state.projection._grant(session, worldline)
            store = request.app.state.vnext._enabled()
            with store.connection() as conn:
                conn.execute('PRAGMA query_only=ON')
                conn.execute('BEGIN')
                manifest = store.scenario(worldline, conn=conn)
                materials = manifest.get('materials', []) if manifest else []
                if index >= len(materials):
                    raise HTTPException(404, '找不到此世界线的冻结资料。')
                source = materials[index]
                node = request.app.state.creation.required(conn, 'nodes', source['node_id'])
                return describe_frozen_material(source, node, identity=f'{worldline}:{index}',
                                                target_to=f'/worlds/{session.world}/simulate?line={worldline}',
                                                target_label='返回世界线')

        @router.get('/worldlines/{worldline}/observation-note')
        def observation_note(worldline: str, request: Request, seq: int = Query(ge=1), token=Depends(viewer)):
            session = author(request, token, full_sources=True)
            request.app.state.projection._grant(session, worldline)
            from .observation_export import export
            return export(request.app.state.vnext._store, session.world, worldline, seq)

        @router.get('/worldlines/{worldline}/replay')
        def replay_timeline(worldline: str, request: Request,
                            offset: int = Query(0, ge=0),
                            limit: int = Query(100, ge=1, le=200),
                            actor_id: str | None = None,
                            location_id: str | None = None,
                            action_type: str | None = None,
                            min_tick: int | None = Query(None, ge=0),
                            max_tick: int | None = Query(None, ge=0),
                            before_seq: int | None = Query(None, ge=1),
                            query: str = Query('', max_length=200),
                            token=Depends(viewer)):
            session = author(request, token)
            request.app.state.projection._grant(session, worldline)
            from .history_view import timeline
            store = request.app.state.vnext._enabled()
            with store.connection() as conn:
                conn.execute('PRAGMA query_only=ON')
                conn.execute('BEGIN')
                return timeline(store, conn, worldline, offset=offset, limit=limit,
                                actor_id=actor_id, location_id=location_id,
                                action_type=action_type, min_tick=min_tick,
                                max_tick=max_tick, query=query, before_seq=before_seq, guarded=session.spoiler_free)

        @router.post('/worldlines/{worldline}/messages/{seq}/reveal')
        def reveal_message(worldline: str, request: Request, seq: int, token=Depends(viewer)):
            session = author(request, token)
            request.app.state.projection._grant(session, worldline)
            from .transcript import reveal
            store = request.app.state.vnext._enabled()
            with store.connection() as conn:
                conn.execute('PRAGMA query_only=ON')
                conn.execute('BEGIN')
                return reveal(store, conn, worldline, seq)

        @router.post('/worldlines/{worldline}/inspirations', status_code=201)
        def create_inspiration(worldline: str, body: InspirationInput, request: Request, token=Depends(viewer)):
            session = author(request, token, full_sources=True)
            request.app.state.projection._grant(session, worldline)
            from .observation_export import export, export_many
            seqs = sorted(set(body.seqs or [body.seq]))
            store = request.app.state.vnext._enabled()
            note = export_many(store, session.world, worldline, seqs) if len(seqs) > 1 else export(
                store, session.world, worldline, seqs[0])
            source = dict(note['source'], summary=note['summary'], materials=note['materials'])
            return request.app.state.creation.create_inspiration(session.world,
                dict(title=body.title, note=body.note, tags=body.tags, linked_nodes=body.linked_nodes,
                    linked_entities=body.linked_entities, origin_node_id=note['origin_node_id']),
                origin='simulation', source=source)

        @router.get('/review')
        def review_list(request: Request, token=Depends(viewer)):
            session = author(request, token, full_sources=True)
            return review.listing(request.app.state.vnext._store, request.app.state.simulation.repo, session.world)

        @router.get('/review/{identity}')
        def review_preview(identity: str, request: Request, token=Depends(viewer)):
            session = author(request, token, full_sources=True)
            return review.preview(request.app.state.vnext._store, request.app.state.simulation.repo, identity, session.world)

        @router.get('/review-sources/{kind}/{identity}')
        def review_sources(kind: str, identity: str, request: Request, token=Depends(viewer)):
            session = author(request, token, full_sources=True)
            return review.sources(request.app.state.vnext._store, session.world, kind, identity)

    @router.get('/worldlines/{worldline}/snapshot')
    def snapshot(worldline: str, request: Request, seq: int | None = None, token=Depends(viewer)):
        return request.app.state.projection.read(token, worldline, seq=seq)

    @router.get('/worldlines/{worldline}/updates')
    def updates(worldline: str, request: Request, cursor: str, token=Depends(viewer)):
        return request.app.state.projection.read(token, worldline, cursor=cursor)

    @router.post('/worldlines/{worldline}/control/{action}')
    def control(worldline: str, action: str, request: Request, token=Depends(viewer)):
        if action not in ('pause', 'resume', 'leave'): raise HTTPException(400, 'unsupported_control')
        reason = 'worldline_switched' if action == 'leave' else ''
        return request.app.state.projection.control(token, worldline, action == 'resume', reason=reason)

    if interactive:
        @router.post('/worldlines/{worldline}/run-settings')
        def configure_run(worldline: str, body: RunSettingsInput, request: Request, token=Depends(viewer)):
            return request.app.state.projection.configure_run(token, worldline, body.cursor, body.settings)

        @router.post('/worldlines/{worldline}/model-recovery')
        def check_model_recovery(worldline: str, request: Request, token=Depends(viewer)):
            return request.app.state.projection.model_budget_action(token, worldline)

        @router.post('/worldlines/{worldline}/model-budget')
        def extend_model_budget(worldline: str, body: ModelBudgetInput, request: Request, token=Depends(viewer)):
            return request.app.state.projection.model_budget_action(token, worldline, caps=body.model_dump())

        @router.post('/worldlines/{worldline}/actions')
        def action(worldline: str, body: InputCommand, request: Request, token=Depends(viewer)):
            return request.app.state.projection.command(token,worldline,body.model_dump())

        @router.post('/worldlines/{worldline}/interventions')
        def intervene(worldline: str, body: InputCommand, request: Request, token=Depends(viewer)):
            return request.app.state.projection.command(token,worldline,body.model_dump(),intervention=True)

        @router.post('/worldlines/{worldline}/autonomy')
        def autonomy(worldline: str, body: AutonomyInput, request: Request, token=Depends(viewer)):
            return request.app.state.projection.autonomy(token,worldline,body.actors,body.limit,body.mode)

    @router.get('/worldlines/{worldline}/stream')
    async def stream(worldline: str, request: Request, cursor: str, token=Depends(viewer)):
        projection = request.app.state.projection
        # Fail authentication before opening the SSE response; check again each poll.
        first = await run_in_threadpool(projection.read, token, worldline, cursor=cursor)

        async def events():
            nonlocal cursor
            pending = first
            try:
                while not await request.is_disconnected():
                    if pending:
                        cursor = pending['cursor']
                        yield 'event: update\ndata: ' + json.dumps(pending, ensure_ascii=False) + '\n\n'
                    else:
                        yield ': heartbeat\n\n'
                    await asyncio.sleep(0.5)
                    pending = await run_in_threadpool(projection.read, token, worldline, cursor=cursor)
            except RuntimeFault as exc:
                # No previous projection is returned after expiry/revocation.
                yield 'event: reset\ndata: ' + json.dumps({'reason': str(exc)}) + '\n\n'
        return StreamingResponse(events(), media_type='text/event-stream', headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})

    return router
