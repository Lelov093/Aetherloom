"""I1 wire/state contracts; independent from Legacy and experimental modules."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_serializer, model_validator
from .social_models import SocialState, SocialSpeech, SocialCognition

ENGINE = 'world-runtime-v2'
STATE = 'aggregate-v2.1'
RULES = 'discrete-places-v1'
CONTRACT = 'action-intent-v2.1'
EVENT = 'transition-v2.1'
HASH = 'canonical-json-int-v1'
SCHEDULER = 'action-quantum-v1'
INTERACTIVE_STATE = 'aggregate-v2.2'
INTERACTIVE_EVENT = 'transition-v2.2'
INTERACTIVE_SCHEDULER = 'discrete-scheduler-v1'
COMMAND = 'runtime-command-v1'
FORK_STATE = 'aggregate-v2.3'
FORK_EVENT = 'transition-v2.3'
FORK_CORE_STATE = 'aggregate-v2.1-lineage-v1'
FORK_CORE_EVENT = 'transition-v2.1-lineage-v1'
FORK_STATES = (FORK_STATE, FORK_CORE_STATE)
SOCIAL_STATE = 'aggregate-v2.4'
SOCIAL_EVENT = 'transition-v2.4'
COGNITIVE_STATE = 'aggregate-v2.5'
COGNITIVE_EVENT = 'transition-v2.5'
READING_STATE = 'aggregate-v2.6'
READING_EVENT = 'transition-v2.6'
COGNITIVE_STATES = (COGNITIVE_STATE, READING_STATE)
SOCIAL_STATES = (SOCIAL_STATE, *COGNITIVE_STATES)
INTERACTIVE_STATES = (INTERACTIVE_STATE, FORK_STATE, *SOCIAL_STATES)


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class BaselineSource(Model):
    kind: Literal['baseline'] = 'baseline'
    baseline_id: str


class EventSource(Model):
    kind: Literal['event'] = 'event'
    worldline_id: str
    seq: int = Field(ge=1)


class InheritedEventSource(EventSource):
    kind: Literal['inherited_event'] = 'inherited_event'


Source = Annotated[BaselineSource | EventSource | InheritedEventSource, Field(discriminator='kind')]


class MaterialSpan(Model):
    node_id: str = Field(min_length=1, max_length=120)
    version: int = Field(ge=1)
    start: int = Field(ge=0)
    end: int = Field(ge=1)


class OrdinaryPast(Model):
    text: str = Field(min_length=1, max_length=450, pattern=r'\S')
    witnesses: list[str] = Field(min_length=1, max_length=12)


class KeyUnknown(Model):
    title: str = Field(min_length=1, max_length=100, pattern=r'\S')
    may_resolve: bool = False
    knowers: list[str] = Field(default_factory=list, max_length=12)


class PremiseResolution(Model):
    text: str = Field(min_length=1, max_length=450, pattern=r'\S')
    source: Annotated[EventSource | InheritedEventSource, Field(discriminator='kind')]


class StoryPremises(Model):
    ordinary: dict[str, OrdinaryPast]
    unknowns: dict[str, KeyUnknown]
    resolved: dict[str, PremiseResolution] = Field(default_factory=dict)


class ItemClaim(Model):
    actor_id: str
    blocker: str | None


class ItemContention(Model):
    kind: Literal['item'] = 'item'
    item_id: str
    holder_id: str
    claims: list[ItemClaim] = Field(min_length=2, max_length=8)


class UnavailableConsequence(Model):
    kind: Literal['consequence'] = 'consequence'
    description: str = Field(min_length=1, max_length=450, pattern=r'\S')


class PendingConflict(Model):
    source: Annotated[EventSource | InheritedEventSource, Field(discriminator='kind')]
    detail: Annotated[ItemContention | UnavailableConsequence, Field(discriminator='kind')]


class Evidence(Model):
    text: str
    basis: Literal['initial', 'experienced', 'reported', 'read', 'checked', 'established']
    sender_id: str | None = None
    source: Source
    original: MaterialSpan | None = None
    premise_id: str | None = None

    @model_serializer(mode='wrap')
    def serialize(self, handler):
        value = handler(self)
        if self.original is None:
            value.pop('original', None)
        if self.premise_id is None:
            value.pop('premise_id', None)
        return value


class Memory(Model):
    source: EventSource | InheritedEventSource
    actor_id: str
    action_type: str
    basis: Literal['own_action', 'observed', 'reported']
    text: str


class SceneMemory(Memory):
    actor_id: None = None
    action_type: Literal['scene_event', 'scene_adjustment']
    basis: Literal['observed'] = 'observed'


class PerceivedMemory(Memory):
    actor_id: str | None = None
    action_type: Literal['event_observation'] = 'event_observation'
    basis: Literal['observed'] = 'observed'
    channel: Literal['sight', 'sound']
    facts: dict[str, str] = Field(default_factory=dict)


class ActorWait(Model):
    until_tick: int | None = Field(default=None, ge=0)


class Agent(Model):
    location: str
    goal: str
    known: dict[str, Evidence] = Field(default_factory=dict)
    memories: list[Memory | SceneMemory | PerceivedMemory] = Field(default_factory=list)
    beliefs: dict[str, str] = Field(default_factory=dict)
    committed_plans: list[str] = Field(default_factory=list)
    cooldowns: dict[str, int] = Field(default_factory=dict)
    waiting: ActorWait | None = None

    @model_serializer(mode='wrap')
    def serialize(self, handler):
        value = handler(self)
        if self.waiting is None:
            value.pop('waiting', None)
        return value


class AccessRule(Model):
    destination_id: str
    item_id: str


class Job(Model):
    id: str
    due_tick: int = Field(ge=0)
    priority: int
    insertion_order: int = Field(ge=0)
    kind: str


class ScheduledJob(Job):
    id: str = Field(min_length=1,max_length=80)
    kind: Literal['environment', 'scene_event']
    payload: dict


class Scheduler(Model):
    ready_actor_order: list[str]
    turn_counter: int = Field(default=0, ge=0)
    pending_jobs: list[Job | ScheduledJob]
    insertion_counter: int = Field(default=1, ge=0)
    policy_version: str = SCHEDULER


class SenseLink(Model):
    observer: str = Field(min_length=1, max_length=120)
    source: str = Field(min_length=1, max_length=120)
    sight: bool = False
    sound: bool = False


class PerceptionLayout(Model):
    contract_version: Literal['regional-perception-v1'] = 'regional-perception-v1'
    zones: dict[str, str] = Field(default_factory=dict, max_length=32)
    positions: dict[str, str] = Field(default_factory=dict, max_length=32)
    links: list[SenseLink] = Field(default_factory=list, max_length=128)


class World(Model):
    place_topology: dict[str, list[str]]
    items: dict[str, str]
    access_rules: list[AccessRule]
    environment: dict[str, str | int]
    item_texts: dict[str, str] | None = None
    perception: PerceptionLayout | None = None

    @model_serializer(mode='wrap')
    def serialize(self, handler):
        value = handler(self)
        if self.item_texts is None: value.pop('item_texts', None)
        if self.perception is None: value.pop('perception', None)
        return value


class AncestorAnchor(Model):
    worldline_id: str
    seq: int = Field(ge=0)
    state_hash: str


class Lineage(Model):
    contract_version: Literal['worldline-lineage-v1'] = 'worldline-lineage-v1'
    ancestors: list[AncestorAnchor] = Field(min_length=1)
    # Counts at the fork tick are domain scheduling constraints, not a fee allowance.
    tick: int = Field(ge=0)
    zero_count: int = Field(ge=0)
    scheduled_count: int = Field(ge=0)


class RuntimeAggregate(Model):
    world_id: str = Field(min_length=1, max_length=120)
    worldline_id: str = Field(min_length=1, max_length=120)
    baseline_id: str = Field(min_length=1, max_length=200)
    head_seq: int = Field(default=0, ge=0)
    state_schema_version: str = STATE
    engine_version: str = ENGINE
    ruleset_version: str = RULES
    action_contract_version: str = CONTRACT
    event_schema_version: str = EVENT
    hash_algorithm_version: str = HASH
    world: World
    agents: dict[str, Agent]
    sim_time_tick: int = Field(default=0, ge=0)
    scheduler: Scheduler
    max_domain_steps: int = Field(default=20000, ge=1)
    lineage: Lineage | None = None
    social: SocialState | None = None
    candidates: dict[str, Agent] | None = None
    premises: StoryPremises | None = None
    pending_conflict: PendingConflict | None = None

    @model_serializer(mode='wrap')
    def serialize(self, handler):
        value = handler(self)
        # Preserve the exact serialized/hash domain of pre-I6 saved states.
        if self.lineage is None:
            value.pop('lineage', None)
        if self.social is None:
            value.pop('social', None)
        if self.candidates is None:
            value.pop('candidates', None)
        if self.premises is None:
            value.pop('premises', None)
        if self.pending_conflict is None:
            value.pop('pending_conflict', None)
        return value


class EmptyArgs(Model):
    pass


class WaitArgs(Model):
    until_event: bool = False
    duration: int | None = Field(default=None, ge=1, le=10000)

    @model_validator(mode='after')
    def check_wait(self):
        if self.until_event and self.duration is not None:
            raise ValueError('Choose one wait condition.')
        return self


class MoveArgs(Model):
    destination_id: str


class TakeArgs(Model):
    item_id: str


class TransferArgs(TakeArgs):
    recipient_id: str


class CompareArgs(Model):
    left_id: str
    left_quote: str = Field(min_length=1, max_length=400)
    right_id: str
    right_quote: str = Field(min_length=1, max_length=400)


class SpeakArgs(Model):
    speech: str = Field(min_length=1, max_length=1500)
    recipient_id: str | None = None
    share_ids: list[str] = Field(default_factory=list, max_length=10)
    social: SocialSpeech | None = None
    past_id: str | None = Field(default=None, max_length=80)
    basis_id: str | None = Field(default=None, max_length=120)


class GoalArgs(Model):
    goal: str = Field(min_length=1, max_length=1000)


ARG_TYPES = {'observe': EmptyArgs, 'move': MoveArgs, 'take': TakeArgs, 'transfer': TransferArgs,
             'speak': SpeakArgs, 'wait': WaitArgs, 'goal': GoalArgs, 'read': TakeArgs, 'compare': CompareArgs}


class ActionIntent(Model):
    kind: Literal['actor_action'] = 'actor_action'
    contract_version: str = CONTRACT
    engine_version: str = ENGINE
    world_id: str = Field(min_length=1, max_length=120)
    worldline_id: str = Field(min_length=1, max_length=120)
    request_id: str = Field(min_length=1, max_length=120)
    expected_seq: int = Field(ge=0)
    execution_epoch: int = Field(ge=0)
    actor_id: str
    action_type: Literal['observe', 'move', 'speak', 'transfer', 'take', 'wait', 'goal', 'read', 'compare']
    args: dict

    def typed_args(self):
        return ARG_TYPES[self.action_type].model_validate(self.args)


class ObservationSource(Model):
    kind: Literal['perception'] = 'perception'
    worldline_id: str
    seq: int = Field(ge=0)
    view: dict


class CognitionSource(Model):
    kind: Literal['knowledge', 'memory', 'perception']
    key: str
    source: Annotated[BaselineSource | EventSource | InheritedEventSource | ObservationSource, Field(discriminator='kind')]


class CognitionArgs(Model):
    beliefs: dict[str, str] = Field(default_factory=dict, max_length=8)
    plans: list[str] = Field(max_length=8)
    sources: list[CognitionSource] = Field(min_length=1, max_length=12)
    social: SocialCognition | None = None


class EnvironmentArgs(Model):
    key: str = Field(min_length=1, max_length=80)
    value: str | int


class RelocateArgs(Model):
    actor_id: str
    destination_id: str


class SceneEventArgs(Model):
    place_id: str
    text: str = Field(min_length=1, max_length=1500)
    audience: list[str] | None = None
    spoiler: bool = False


class CandidateInviteArgs(Model):
    actor_id: str
    text: str = Field(min_length=1, max_length=500, pattern=r'\S')


class ResolveUnknownArgs(Model):
    unknown_id: str = Field(min_length=1, max_length=80)
    answer: str = Field(min_length=1, max_length=450, pattern=r'\S')


class MoveAttempt(MoveArgs):
    kind: Literal['move']


class TakeAttempt(TakeArgs):
    kind: Literal['take']


class TransferAttempt(TransferArgs):
    kind: Literal['transfer']


class AttemptActionArgs(Model):
    actor_id: str
    action: Annotated[MoveAttempt | TakeAttempt | TransferAttempt, Field(discriminator='kind')]


class ItemConflictArgs(Model):
    item_id: str
    actors: list[str] = Field(min_length=2, max_length=8)
    critical: bool = True


class ResolveConflictArgs(Model):
    method: Literal['choose', 'draw', 'cancel']
    actor_id: str | None = None


ADJUDICATION_ARGS = {'attempt_action': AttemptActionArgs, 'item_conflict': ItemConflictArgs,
                     'hold_consequence': UnavailableConsequence, 'resolve_conflict': ResolveConflictArgs}


class ScheduleArgs(Model):
    job: ScheduledJob


class TriggerArgs(Model):
    job_id: str


class IdleArgs(Model):
    actors: list[str] = Field(max_length=40)
    until_next: bool = False
    stop_tick: int | None = Field(default=None, ge=0)


COMMAND_ARGS = {'cognition': CognitionArgs, 'environment': EnvironmentArgs, 'relocate': RelocateArgs,
                'scene_event': SceneEventArgs, 'candidate_invite': CandidateInviteArgs,
                'resolve_unknown': ResolveUnknownArgs,
                'schedule': ScheduleArgs, 'trigger': TriggerArgs, 'advance_idle': IdleArgs, **ADJUDICATION_ARGS}


class CommandIntent(Model):
    kind: Literal['cognition', 'creator_intervention', 'scheduled_event']
    contract_version: Literal['runtime-command-v1'] = COMMAND
    engine_version: Literal['world-runtime-v2'] = ENGINE
    world_id: str
    worldline_id: str
    request_id: str = Field(min_length=1, max_length=120)
    expected_seq: int = Field(ge=0)
    execution_epoch: int = Field(ge=0)
    actor_id: str | None = None
    action_type: str
    reason: str = Field(default='', max_length=1000)
    args: dict

    def typed_args(self):
        return COMMAND_ARGS[self.action_type].model_validate(self.args)


class LocationSet(Model):
    op: Literal['agent_location_set'] = 'agent_location_set'
    entity_id: str
    before: str
    after: str


class HolderSet(Model):
    op: Literal['item_holder_set'] = 'item_holder_set'
    item_id: str
    before: str
    after: str


class GoalSet(Model):
    op: Literal['agent_goal_set'] = 'agent_goal_set'
    entity_id: str
    before: str
    after: str


class KnowledgeSet(Model):
    op: Literal['knowledge_received'] = 'knowledge_received'
    entity_id: str
    record_id: str
    before: Evidence | None
    after: Evidence


class PremiseSet(Model):
    op: Literal['premise_set'] = 'premise_set'
    premise_id: str
    before: None = None
    after: PremiseResolution


class PendingConflictSet(Model):
    op: Literal['pending_conflict_set'] = 'pending_conflict_set'
    before: PendingConflict | None
    after: PendingConflict | None


class WaitingSet(Model):
    op: Literal['waiting_set'] = 'waiting_set'
    entity_id: str
    before: ActorWait | None
    after: ActorWait | None


class MemoryAppend(Model):
    op: Literal['memory_append'] = 'memory_append'
    entity_id: str
    before_length: int
    evidence: Memory | SceneMemory | PerceivedMemory


class BeliefSet(Model):
    op: Literal['belief_set'] = 'belief_set'
    entity_id: str
    key: str
    before: str | None
    after: str | None
    sources: list[CognitionSource]


class PlansSet(Model):
    op: Literal['plans_set'] = 'plans_set'
    entity_id: str
    before: list[str]
    after: list[str]
    sources: list[CognitionSource]


class EnvironmentSet(Model):
    op: Literal['environment_set'] = 'environment_set'
    key: str
    before: str | int | None
    after: str | int


class JobsSet(Model):
    op: Literal['jobs_set'] = 'jobs_set'
    before: list[Job | ScheduledJob]
    after: list[Job | ScheduledJob]


class CounterSet(Model):
    op: Literal['clock_advance', 'scheduler_turn_advance', 'sequence_advance', 'insertion_advance']
    before: int
    after: int


class SocialSet(Model):
    op: Literal['social_set'] = 'social_set'
    before: SocialState
    after: SocialState


class CandidateJoin(Model):
    op: Literal['candidate_join'] = 'candidate_join'
    entity_id: str


Op = Annotated[LocationSet | HolderSet | GoalSet | KnowledgeSet | MemoryAppend | CounterSet | BeliefSet | PlansSet |
               EnvironmentSet | JobsSet | SocialSet | CandidateJoin | PremiseSet | PendingConflictSet | WaitingSet, Field(discriminator='op')]
OPS = TypeAdapter(list[Op])


class AttemptRuling(Model):
    kind: Literal['attempt'] = 'attempt'
    attempt: AttemptActionArgs
    location_id: str
    required_items: list[str] = Field(default_factory=list)


class ConflictRuling(Model):
    kind: Literal['conflict'] = 'conflict'
    conflict: PendingConflict
    result: Literal['pending', 'blocked', 'rules', 'draw', 'chosen', 'cancelled']
    winner_id: str | None = None
    draw_index: int | None = Field(default=None, ge=0)


Ruling = Annotated[AttemptRuling | ConflictRuling, Field(discriminator='kind')]


class TransitionPlan(Model):
    expected_seq: int
    accepted: bool
    reason_code: str | None
    effects: list[Op]
    ruling: Ruling | None = None


class ObservationCondition(Model):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=100, pattern=r'\S')
    mode: Literal['mark', 'pause']
    event: Literal['scheduled', 'move', 'take', 'transfer', 'read']
    target_id: str = Field(min_length=1, max_length=120)


class RunSettings(Model):
    mode: Literal['continuous', 'segment'] = 'continuous'
    segment_steps: int = Field(default=3, ge=1, le=50)
    observations: list[ObservationCondition] = Field(default_factory=list, max_length=8)
    story_stop_tick: int | None = Field(default=None, ge=0, le=2_147_483_647)
    retry_once: bool = False


class CommittedTransition(Model):
    event_schema_version: str = EVENT
    state_schema_version: str = STATE
    engine_version: str = ENGINE
    ruleset_version: str = RULES
    action_contract_version: str = CONTRACT
    hash_algorithm_version: str = HASH
    scheduler_policy_version: str = SCHEDULER
    world_id: str
    worldline_id: str
    event_id: str
    seq: int
    parent_seq: int
    execution_epoch: int
    request_id: str
    intent_digest: str
    actor_id: str
    action_type: str
    origin: Literal['agent', 'creator_observer']
    subject: str
    accepted: bool
    reason_code: str | None
    before_hash: str
    after_hash: str
    sim_time_before: int
    sim_time_after: int
    effects: list[Op]
    created_at_utc: str


class InteractiveTransition(CommittedTransition):
    event_schema_version: Literal['transition-v2.2'] = INTERACTIVE_EVENT
    state_schema_version: Literal['aggregate-v2.2'] = INTERACTIVE_STATE
    scheduler_policy_version: Literal['discrete-scheduler-v1'] = INTERACTIVE_SCHEDULER
    command_contract_version: Literal['runtime-command-v1'] = COMMAND
    kind: Literal['actor_action', 'cognition', 'creator_intervention', 'scheduled_event']
    actor_id: str | None
    origin: Literal['agent', 'creator_observer', 'participant', 'environment']
    reason: str = ''
    command: dict
    ruling: Ruling | None = None
    observations: list[ObservationCondition] = Field(default_factory=list)

    @model_serializer(mode='wrap')
    def serialize(self, handler):
        value = handler(self)
        if self.ruling is None:
            value.pop('ruling', None)
        if not self.observations:
            value.pop('observations', None)
        return value


class ForkTransition(InteractiveTransition):
    event_schema_version: Literal['transition-v2.3'] = FORK_EVENT
    state_schema_version: Literal['aggregate-v2.3'] = FORK_STATE


class SocialTransition(InteractiveTransition):
    event_schema_version: Literal['transition-v2.4'] = SOCIAL_EVENT
    state_schema_version: Literal['aggregate-v2.4'] = SOCIAL_STATE


class CognitiveTransition(InteractiveTransition):
    event_schema_version: Literal['transition-v2.5'] = COGNITIVE_EVENT
    state_schema_version: Literal['aggregate-v2.5'] = COGNITIVE_STATE


class ReadingTransition(InteractiveTransition):
    event_schema_version: Literal['transition-v2.6'] = READING_EVENT
    state_schema_version: Literal['aggregate-v2.6'] = READING_STATE


class ForkCoreTransition(CommittedTransition):
    event_schema_version: Literal['transition-v2.1-lineage-v1'] = FORK_CORE_EVENT
    state_schema_version: Literal['aggregate-v2.1-lineage-v1'] = FORK_CORE_STATE


class CommitReceipt(Model):
    request_id: str
    intent_digest: str
    status: str
    event_id: str | None = None
    seq: int | None = None
    reason_code: str | None = None
