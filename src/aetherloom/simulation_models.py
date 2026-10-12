"""Small, explicit scene contracts; author notes never grant world write authority."""
from typing import Literal
from pydantic import Field, field_validator, model_validator
from .creation_models import Model
from .review_models import Proposal


class Selection(Model):
    kind: Literal['assertion', 'event', 'relationship']
    id: str
    version: int = Field(ge=1)
    at_start: Literal['effective', 'past', 'future', 'excluded']
    reason: str = Field(min_length=1, max_length=1000)
    known_by: list[str] = Field(default_factory=list, max_length=8)


class Material(Model):
    node_id: str
    version: int = Field(ge=1)
    start: int = Field(ge=0)
    end: int = Field(ge=1)
    purpose: Literal['author_reference', 'agent_knowledge'] = 'author_reference'
    known_by: list[str] = Field(default_factory=list, max_length=8)


class Participant(Model):
    entity_id: str
    version: int = Field(ge=1)
    location_id: str
    persona: str = Field(default='', max_length=2000)
    goal: str = Field(min_length=1, max_length=1000)
    beliefs: list[str] = Field(default_factory=list, max_length=20)


class Place(Model):
    entity_id: str
    version: int = Field(ge=1)
    public_description: str = Field(default='', max_length=2000)
    neighbors: list[str] = Field(default_factory=list, max_length=10)


class Item(Model):
    entity_id: str
    version: int = Field(ge=1)
    holder_id: str


class AccessRule(Model):
    type: Literal['requires_item']
    destination_id: str
    item_id: str


class Setup(Model):
    expected_revision: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=160)
    intent: str = Field(min_length=1, max_length=2000)
    start_label: str = Field(min_length=1, max_length=160)
    time_basis: str = Field(min_length=1, max_length=2000)
    participants: list[Participant] = Field(min_length=3, max_length=8)
    places: list[Place] = Field(min_length=1, max_length=5)
    items: list[Item] = Field(default_factory=list, max_length=20)
    records: list[Selection] = Field(default_factory=list, max_length=100)
    materials: list[Material] = Field(default_factory=list, max_length=30)
    rules: list[AccessRule] = Field(default_factory=list, max_length=20)
    narrative_guidance: str = Field(default='', max_length=2000)
    unsupported_hard_rules: list[str] = Field(default_factory=list, max_length=20)
    max_steps: int = Field(default=12, ge=1, le=120)
    max_calls: int = Field(default=12, ge=1, le=48)
    budget_yuan: float = Field(default=2, gt=0, le=10)
    confirmed: bool = False

    @model_validator(mode='after')
    def unique(self):
        for entries in (self.participants, self.places, self.items):
            ids = [entry.entity_id for entry in entries]
            if len(ids) != len(set(ids)):
                raise ValueError('同一个对象不能重复选择')
        keys = [(r.kind, r.id) for r in self.records]
        if len(keys) != len(set(keys)):
            raise ValueError('正式记录不能重复选择')
        return self


class Action(Model):
    # speech comes first so the actual provider stream can expose only spoken text.
    speech: str = Field(default='', max_length=1500)
    type: Literal['observe', 'move', 'speak', 'transfer', 'take', 'wait', 'goal']
    target_id: str | None = None
    item_id: str | None = None
    share_ids: list[str] = Field(default_factory=list, max_length=10)
    new_goal: str | None = Field(default=None, max_length=1000)

    @field_validator('speech', mode='before')
    @classmethod
    def empty_speech(cls, value):
        # A JSON null means no utterance, not a malformed world action.
        return '' if value is None else value


class SimProposalEdit(Model):
    version: int = Field(ge=1)
    payload: Proposal


class SimDecision(Model):
    version: int = Field(ge=1)
    expected_revision: int = Field(ge=1)
    action: Literal['accept', 'reject']
    resolution: Literal['replace', 'temporal', 'keep_both'] | None = None
    acknowledge_inference: bool = False
    acknowledge_baseline: bool = False
