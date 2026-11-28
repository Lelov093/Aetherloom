"""Opt-in social domain v1. References address the owner's authorized records."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_serializer


class SocialModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class Plan(SocialModel):
    id: str = Field(min_length=1, max_length=80)
    next_step: str = Field(min_length=1, max_length=600)
    target_id: str | None = Field(default=None, description='Known actor ID or null; put places and items in next_step.')
    due_tick: int | None = Field(default=None, ge=0)
    completion: str = Field(min_length=1, max_length=400)
    abandon: str = Field(min_length=1, max_length=400)
    status: Literal['active', 'blocked', 'completed', 'abandoned'] = 'active'


class Appraisal(SocialModel):
    target_id: str
    judgment: str = Field(min_length=1, max_length=600)


class Reflection(SocialModel):
    text: str = Field(min_length=1, max_length=1200)


class CitedAppraisal(Appraisal):
    refs: list[str]
    updated_tick: int


class CitedReflection(Reflection):
    refs: list[str]
    updated_tick: int


class SocialCognition(SocialModel):
    plans: list[Plan] = Field(default_factory=list, max_length=8)
    appraisals: list[Appraisal] = Field(default_factory=list, max_length=8)
    reflection: Reflection | None = None
    belief_updates: list['BeliefRevision'] = Field(default_factory=list, max_length=8)
    plan_updates: list['PlanRevision'] = Field(default_factory=list, max_length=8)


class BeliefRevision(SocialModel):
    key: str = Field(min_length=1, max_length=120)
    text: str | None = Field(max_length=1500)
    stance: Literal['held', 'uncertain'] = 'uncertain'
    reason: str = Field(min_length=1, max_length=600)
    evidence: list['EvidenceClaim'] = Field(default_factory=list, max_length=4)


class PlanRevision(SocialModel):
    id: str = Field(min_length=1, max_length=80)
    value: Plan | None
    reason: str = Field(min_length=1, max_length=600)
    evidence: list['EvidenceClaim'] = Field(default_factory=list, max_length=4)


class EvidenceClaim(SocialModel):
    ref: str = Field(min_length=1, max_length=240)
    field: Literal['location', 'item_holder', 'person_present', 'text']
    target: str | None = None
    value: str | bool | None


class GroundedEvidence(EvidenceClaim):
    evidence_type: Literal['current_observation', 'historical_observation', 'event_observation', 'action_result', 'report', 'read_text', 'text_comparison', 'initial', 'subjective']


class BeliefMeta(SocialModel):
    stance: Literal['held', 'uncertain'] = 'uncertain'
    refs: list[str] = Field(default_factory=list)
    updated_tick: int = 0


class Experience(SocialModel):
    ref: str
    action: str
    accepted: bool
    reason: str | None = None
    summary: str


class CognitiveChange(SocialModel):
    kind: Literal['belief', 'plan']
    key: str
    before: str | None
    after: str | None
    reason: str
    refs: list[str]
    memory_ref: str
    followup: Experience | None = None
    evidence: list[GroundedEvidence] = Field(default_factory=list, max_length=4)

    @model_serializer(mode='wrap')
    def serialize(self, handler):
        value = handler(self)
        if not self.evidence: value.pop('evidence', None)
        return value


class CognitiveState(SocialModel):
    contract_version: Literal['cognition-v1'] = 'cognition-v1'
    beliefs: dict[str, BeliefMeta] = Field(default_factory=dict)
    # Recent explanation window. Full history remains in committed transitions.
    changes: list[CognitiveChange] = Field(default_factory=list, max_length=16)
    pending: list[Experience] = Field(default_factory=list, max_length=8)


class PromiseInput(SocialModel):
    id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=600)
    kind: Literal['transfer', 'meet']
    item_id: str | None = None
    place_id: str | None = None
    due_tick: int = Field(ge=0)


class Promise(PromiseInput):
    recipient_id: str
    source_ref: str
    accepted_ref: str | None = None
    status: Literal['pending', 'accepted', 'fulfilled', 'fulfilled_late', 'overdue', 'declined'] = 'pending'


class SocialSpeech(SocialModel):
    conversation_id: str | None = None
    turn: Literal['continue', 'decline', 'end'] = 'continue'
    promise: PromiseInput | None = None
    accept_promise: str | None = None


class Conversation(SocialModel):
    id: str
    participants: list[str]
    awaiting: str | None
    status: Literal['open', 'ended', 'declined', 'left'] = 'open'
    last_tick: int
    # One latest reference per participant; full dialogue is in their memories.
    refs: dict[str, str] = Field(default_factory=dict)


class SocialAgent(SocialModel):
    plans: list[Plan] = Field(default_factory=list, max_length=8)
    appraisals: dict[str, CitedAppraisal] = Field(default_factory=dict)
    reflections: list[CitedReflection] = Field(default_factory=list, max_length=8)
    promises: dict[str, Promise] = Field(default_factory=dict)
    next_tick: int = Field(default=0, ge=0)
    last_decision: int = Field(default=0, ge=0)
    wake_reasons: list[str] = Field(default_factory=lambda: ['initial'])
    cognition: CognitiveState | None = None

    @model_serializer(mode='wrap')
    def serialize(self, handler):
        value = handler(self)
        if self.cognition is None: value.pop('cognition', None)
        return value


class SocialState(SocialModel):
    contract_version: Literal['social-domain-v1', 'social-domain-v2'] = 'social-domain-v1'
    agents: dict[str, SocialAgent]
    conversations: dict[str, Conversation] = Field(default_factory=dict)
    routine_interval: int = Field(default=3, ge=1, le=100)
    decision_counter: int = Field(default=0, ge=0)


class ContextCard(SocialModel):
    text: str = Field(min_length=1, max_length=2000)
    category: Literal['lore', 'prior', 'relationship', 'period', 'rule_reference']
    audience: list[str] = Field(default_factory=list, max_length=6)
    at_start: Literal['effective', 'past', 'future', 'excluded'] = 'effective'
    # Optional immutable selected repository record; text is an explicitly reviewed
    # interpretation, never an automatic promotion of source prose to truth.
    source_kind: Literal['node', 'assertion', 'event', 'relationship_state'] | None = None
    source_id: str | None = None
    source_version: int | None = Field(default=None, ge=1)


class Opening(SocialModel):
    kind: Literal['initial', 'event', 'private']
    text: str = Field(min_length=1, max_length=1500)
    place_id: str
    audience: list[str] = Field(min_length=1, max_length=6)
    due_tick: int = Field(default=0, ge=0)


class SocialSetup(SocialModel):
    contract_version: Literal['social-domain-v1', 'social-domain-v2'] = 'social-domain-v1'
    start_time: str = Field(min_length=1, max_length=300)
    author_intent: str = Field(default='', max_length=1200)
    cards: list[ContextCard] = Field(default_factory=list, max_length=16)
    opening: Opening | None = None
    initial_plans: dict[str, list[Plan]] = Field(default_factory=dict)
