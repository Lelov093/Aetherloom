"""Frozen source handoff; compiling current Canon into scenes is a later concern."""
from typing import Literal

from pydantic import Field

from .contracts import Model, ENGINE, STATE, RULES
from .domain import RuntimeFault, canonical


class FrozenSource(Model):
    kind: Literal['node', 'entity', 'assertion', 'event', 'relationship_state']
    source_id: str = Field(min_length=1)
    version: int = Field(ge=1)
    snapshot: dict


class FrozenBaseline(Model):
    manifest_schema_version: Literal['frozen-baseline-v2.1'] = 'frozen-baseline-v2.1'
    baseline_id: str = Field(min_length=1, max_length=200)
    world_id: str = Field(min_length=1, max_length=120)
    canon_revision: int = Field(ge=0)
    engine_version: Literal['world-runtime-v2'] = ENGINE
    state_schema_version: Literal['aggregate-v2.1', 'aggregate-v2.2', 'aggregate-v2.4', 'aggregate-v2.5', 'aggregate-v2.6'] = STATE
    ruleset_version: Literal['discrete-places-v1'] = RULES
    sources: list[FrozenSource]

    def validate_for(self, state):
        compatible_state = self.state_schema_version == state.state_schema_version or (
            state.lineage is not None and (self.state_schema_version, state.state_schema_version) in (
                ('aggregate-v2.2', 'aggregate-v2.3'), ('aggregate-v2.1', 'aggregate-v2.1-lineage-v1')))
        if not compatible_state or (self.baseline_id, self.world_id, self.engine_version, self.ruleset_version) != (
            state.baseline_id, state.world_id, state.engine_version, state.ruleset_version):
            raise RuntimeFault('baseline_identity_mismatch')
        identities = [(s.kind, s.source_id) for s in self.sources]
        if len(set(identities)) != len(identities):
            raise RuntimeFault('duplicate_baseline_source')
        canonical(self.model_dump())
