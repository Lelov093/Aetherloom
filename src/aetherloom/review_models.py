"""Typed AI proposals. None of these schemas grants Canon write permission."""
from typing import Annotated, Literal

from pydantic import Field, model_validator

from .creation_models import Model, EntityKind
from .object_schema import TypedValue

Text = Annotated[str, Field(min_length=1, max_length=4000)]
Reference = Annotated[str, Field(min_length=1, max_length=100, description=
    'Exact supplied entity/proposal ID, or exact key of an entity item in THIS output. '
    'Never an entity name, field ID, inferred ID or the key of an assertion/event/relationship.')]


class ProposalEvidence(Model):
    basis: Literal['named_identity', 'attribute_object', 'unresolved_identity',
                   'independent_attribute', 'independent_relationship', 'occurrence',
                   'event_context', 'document_framing']
    quote: Text


class GroundedProposal(Model):
    # Optional for saved proposals and explicit human edits. The real Provider
    # protocol requires this evidence for every newly generated proposal.
    evidence: ProposalEvidence | None = None


class EntityProposal(GroundedProposal):
    type: Literal['entity']
    name: Annotated[str, Field(min_length=1, max_length=160)]
    entity_kind: EntityKind
    aliases: list[str] = Field(default_factory=list, max_length=100)
    description: str = Field(default='', max_length=10000)


class AssertionProposal(GroundedProposal):
    type: Literal['assertion']
    subject_ref: Reference
    predicate: Annotated[str, Field(min_length=1, max_length=160)]
    value: Text
    field_id: str | None = Field(default=None, max_length=80)
    typed_value: TypedValue | None = None
    object_ref: Reference | None = None
    valid_from: str | None = Field(default=None, max_length=160)
    valid_until: str | None = Field(default=None, max_length=160)
    subject_evidence: 'SubjectEvidence | None' = None


class SubjectEvidence(Model):
    # Optional for historical candidates and explicit human edits.
    mention: Text
    basis: Literal['literal_identity', 'coreference']
    link_quote: Text | None = None
    link_source_block_id: str | None = Field(default=None, pattern=r'^b\d+$')


class EventProposal(GroundedProposal):
    type: Literal['event']
    title: Annotated[str, Field(min_length=1, max_length=160)]
    description: Text
    participants: list[Reference] = Field(default_factory=list, max_length=100)
    location_ref: Reference | None = None
    valid_from: str | None = Field(default=None, max_length=160)
    valid_until: str | None = Field(default=None, max_length=160)


class RelationshipProposal(GroundedProposal):
    type: Literal['relationship']
    subject_ref: Reference
    object_ref: Reference
    label: Annotated[str, Field(min_length=1, max_length=160)]
    description: str = Field(default='', max_length=10000)
    valid_from: str | None = Field(default=None, max_length=160)
    valid_until: str | None = Field(default=None, max_length=160)


Proposal = Annotated[EntityProposal | AssertionProposal | EventProposal | RelationshipProposal,
                     Field(discriminator='type')]


class ExtractedCandidate(Model):
    key: Annotated[str, Field(min_length=1, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')]
    confidence: float = Field(ge=0, le=1)
    quote: str = Field(default='', max_length=4000)
    source_block_id: str | None = Field(default=None, pattern=r'^b\d+$', max_length=20)
    payload: Proposal

    @model_validator(mode='after')
    def require_evidence(self):
        if not self.quote and not self.source_block_id:
            raise ValueError('An exact quote or supplied source block is required')
        return self


class ExtractionOutput(Model):
    items: list[ExtractedCandidate] = Field(max_length=200)

    @model_validator(mode='after')
    def unique_keys(self):
        keys = [item.key for item in self.items]
        if len(keys) != len(set(keys)):
            raise ValueError('Candidate keys must be unique')
        return self


class ExtractionRequest(Model):
    version: int = Field(ge=1)
    selection_start: int | None = Field(default=None, ge=0)
    selection_end: int | None = Field(default=None, ge=1)


class CandidateEdit(Model):
    version: int = Field(ge=1)
    payload: Proposal


class Decision(Model):
    candidate_id: str
    version: int = Field(ge=1)
    action: Literal['accept', 'reject', 'ignore', 'later', 'merge']
    target_id: str | None = None
    resolution: Literal['replace', 'temporal', 'keep_both'] | None = None
    acknowledge_inference: bool = False


class ApplyReview(Model):
    expected_revision: int = Field(ge=1)
    decisions: list[Decision] = Field(min_length=1, max_length=100)


class SourceRecheck(Model):
    version: int = Field(ge=1)
    source_version: int = Field(ge=1)
    quote: Annotated[str, Field(min_length=1, max_length=4000)]
