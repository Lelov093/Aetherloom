import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, model_validator

from aetherloom.worlds import StaleWorld, WorldNotFound, WorldRepository
from aetherloom.creation import CreationError
from aetherloom.creation_api import router as creation_router
from aetherloom.imports import router as import_router
from aetherloom.review import ReviewRepository
from aetherloom.review_api import router as review_router
from aetherloom.object_catalog import router as catalog_router
from aetherloom.content_context import router as context_router
from aetherloom.material_sources import router as source_router
from aetherloom.content_library import router as library_router
from aetherloom.provider import CompatibleProvider, ProviderSettings
from aetherloom.extraction import ExtractionService
from aetherloom.simulation_service import SimulationService
from aetherloom.simulation_api import router as simulation_router
from aetherloom.portraits import router as portrait_router, initialize as initialize_portraits

ROOT = Path(__file__).resolve().parents[2]


class WorldCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=1200)


class WorldPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    version: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=1200)
    archived: bool | None = None

    @model_validator(mode="after")
    def validate_changes(self):
        fields = self.model_fields_set - {"version"}
        if not fields or any(getattr(self, key) is None for key in fields):
            raise ValueError("Provide at least one non-null field to update")
        return self


class WorldRead(WorldCreate):
    id: str
    archived: bool
    created_at: str
    updated_at: str
    version: int


def create_app(db_path: Path | None = None, provider=None):
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        path = db_path or Path(os.environ.get("AETHERLOOM_DB", ROOT / ".data/aetherloom.db"))
        app.state.worlds = WorldRepository(path)
        app.state.creation = ReviewRepository(path)
        initialize_portraits(app.state.creation)
        app.state.extraction = ExtractionService(app.state.creation, provider or CompatibleProvider(ProviderSettings.load(ROOT)))
        app.state.simulation = SimulationService(path)
        try:
            yield
        finally:
            await app.state.simulation.shutdown()
            await app.state.extraction.shutdown()

    app = FastAPI(title="Aetherloom", lifespan=lifespan)
    app.include_router(creation_router)
    app.include_router(import_router)
    app.include_router(review_router)
    app.include_router(catalog_router)
    app.include_router(context_router)
    app.include_router(source_router)
    app.include_router(library_router)
    app.include_router(simulation_router)
    app.include_router(portrait_router)

    @app.exception_handler(CreationError)
    async def creation_error(request: Request, error: CreationError):
        return JSONResponse(status_code=error.status, content={'detail': error.message})

    @app.exception_handler(WorldNotFound)
    async def world_missing(request: Request, error: WorldNotFound):
        return JSONResponse(status_code=404, content={'detail': '找不到这个世界。'})

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/worlds", response_model=list[WorldRead])
    def list_worlds(archived: bool = False):
        return app.state.worlds.list(archived)

    @app.post("/api/worlds", response_model=WorldRead, status_code=201)
    def create_world(body: WorldCreate):
        return app.state.worlds.create(body.name, body.description)

    @app.get("/api/worlds/{world_id}", response_model=WorldRead)
    def get_world(world_id: str):
        try:
            return app.state.worlds.get(world_id)
        except WorldNotFound:
            raise HTTPException(404, "找不到这个世界。它可能来自另一份本地资料库。")

    @app.patch("/api/worlds/{world_id}", response_model=WorldRead)
    def update_world(world_id: str, body: WorldPatch):
        try:
            return app.state.worlds.update(world_id, body.version, body.model_dump(exclude_unset=True, exclude={"version"}))
        except WorldNotFound:
            raise HTTPException(404, "找不到这个世界。")
        except StaleWorld:
            raise HTTPException(409, "这个世界已在其他页面更新。请重新载入后再修改。")

    dist = ROOT / "frontend/dist"
    if dist.exists():
        app.mount("/", StaticFiles(directory=dist, html=True), name="workspace")
    return app


app = create_app()
