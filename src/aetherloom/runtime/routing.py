"""Trusted host history dispatch. No public authentication or Participant API."""
from dataclasses import dataclass

from .contracts import ENGINE
from .domain import RuntimeFault
from .schema import LEGACY_ENGINE


@dataclass(frozen=True)
class WorldlineKey:
    engine_version: str
    world_id: str
    worldline_id: str


class WorldlineRouter:
    def __init__(self, legacy_repository, runtime):
        store = runtime._enabled()
        if runtime.options.layout != 'shared' or store.path != legacy_repository.path.resolve():
            raise RuntimeFault('shared_registry_required')
        self._legacy, self._runtime, self._store = legacy_repository, runtime, store

    def registry(self, world_id):
        """Host inventory from saved namespaces, never inferred from an ID alone."""
        with self._store.connection() as conn:
            conn.execute('PRAGMA query_only=ON')
            rows = conn.execute('SELECT engine_version,world_id,worldline_id,storage FROM runtime_v2_registry WHERE world_id=? ORDER BY engine_version,worldline_id', (world_id,)).fetchall()
            for row in rows:
                if (row['engine_version'], row['storage']) not in ((ENGINE, 'runtime'), (LEGACY_ENGINE, 'legacy')):
                    raise RuntimeFault('unsupported_registered_engine')
            return [dict(row) for row in rows]

    def identity(self, key):
        if not isinstance(key, WorldlineKey):
            raise RuntimeFault('qualified_worldline_key_required')
        if key.engine_version not in (ENGINE, LEGACY_ENGINE):
            raise RuntimeFault('unsupported_engine')
        with self._store.connection() as conn:
            conn.execute('PRAGMA query_only=ON')
            rows = conn.execute('SELECT engine_version,world_id,worldline_id,storage FROM runtime_v2_registry WHERE engine_version=? AND worldline_id=?', (key.engine_version, key.worldline_id)).fetchall()
        if len(rows) != 1:
            raise RuntimeFault('worldline_unavailable' if not rows else 'ambiguous_worldline_registry')
        identity = dict(rows[0])
        if identity['world_id'] != key.world_id:
            raise RuntimeFault('world_identity_mismatch')
        if identity['storage'] != ('legacy' if key.engine_version == LEGACY_ENGINE else 'runtime'):
            raise RuntimeFault('registered_engine_mismatch')
        return identity

    def read_at(self, key, *, token=None, seq=None):
        identity = self.identity(key)
        if key.engine_version == LEGACY_ENGINE:
            if seq is not None:
                raise RuntimeFault('legacy_v2_readat_not_supported')
            saved = self._legacy.detail(key.worldline_id)
            # Recheck persisted identity on the actual read, not a caller-supplied label.
            if (saved['world_id'] != key.world_id or
                saved['manifest']['run_config']['engine_version'] != LEGACY_ENGINE):
                raise RuntimeFault('registered_engine_mismatch')
            return dict(identity=identity, source_format='legacy_text_world_v1', data=saved)
        return dict(identity=identity, source_format='transition_v2.1',
                    data=self._runtime.read_at(token, key.worldline_id, seq).model_dump())
