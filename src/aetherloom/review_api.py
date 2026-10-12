from fastapi import APIRouter, Request

from .review_models import ExtractionRequest, CandidateEdit, ApplyReview, SourceRecheck

router = APIRouter(prefix='/api')


@router.get('/provider')
def provider(request: Request):
    return request.app.state.extraction.provider.settings.public()


@router.post('/nodes/{identity}/extractions',status_code=202)
async def extract(identity: str, body: ExtractionRequest, request: Request):
    return request.app.state.extraction.start(identity,body)


@router.post('/extractions/{identity}/cancel')
async def cancel(identity: str, request: Request):
    return request.app.state.extraction.cancel(identity)


@router.post('/extractions/{identity}/retry',status_code=202)
async def retry(identity: str, request: Request):
    return request.app.state.extraction.retry(identity)


@router.get('/extractions/{identity}/failures')
def failures(identity: str, request: Request):
    return request.app.state.creation.extraction_failures(identity)


@router.get('/extractions/{identity}/outputs')
def outputs(identity: str, request: Request):
    return request.app.state.creation.extraction_outputs(identity)


@router.get('/worlds/{world_id}/review')
def inbox(world_id: str, request: Request):
    return request.app.state.creation.listing(world_id)


@router.get('/worlds/{world_id}/review-activity')
def activity(world_id: str, request: Request):
    repo = request.app.state.creation
    repo.get(world_id)
    with repo.connection() as conn:
        pending = conn.execute("SELECT count(*) FROM review_candidates WHERE world_id=? AND status IN ('pending','later')", (world_id,)).fetchone()[0]
        simulation_pending = conn.execute("SELECT count(*) FROM simulation_proposals WHERE world_id=? AND status='pending'", (world_id,)).fetchone()[0]
        active = conn.execute("SELECT count(*) FROM extraction_tasks WHERE world_id=? AND status IN ('queued','running')", (world_id,)).fetchone()[0]
        tasks = [dict(row) for row in conn.execute('''SELECT t.id,t.node_id,t.status,t.completed_chunks,
            json_array_length(t.chunks) AS total_chunks,t.updated_at,n.title,w.title AS work_title,w.id AS work_id
            FROM extraction_tasks t JOIN nodes n ON n.id=t.node_id JOIN works w ON w.id=n.work_id
            WHERE t.world_id=? ORDER BY t.updated_at DESC,t.rowid DESC LIMIT 10''', (world_id,))]
    return dict(pending=pending, simulation_pending=simulation_pending, active=active, tasks=tasks)


@router.get('/review/{identity}')
def preview(identity: str, request: Request):
    return request.app.state.creation.preview(identity)


@router.patch('/review/{identity}')
def edit(identity: str, body: CandidateEdit, request: Request):
    return request.app.state.creation.edit_candidate(identity,body)


@router.post('/review/{identity}/recheck-source')
def recheck(identity: str, body: SourceRecheck, request: Request):
    return request.app.state.creation.recheck(identity,body)


@router.post('/worlds/{world_id}/review/apply')
def apply(world_id: str, body: ApplyReview, request: Request):
    return request.app.state.creation.apply(world_id,body)


@router.post('/worlds/{world_id}/review/preview-apply')
def preview_apply(world_id: str, body: ApplyReview, request: Request):
    return request.app.state.creation.apply(world_id,body,dry_run=True)


@router.get('/worlds/{world_id}/canon-records')
def records(world_id: str, request: Request, entity_id: str | None = None):
    return request.app.state.creation.records(world_id,entity_id)
