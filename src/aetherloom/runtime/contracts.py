"""I1 wire/state contracts; independent from Legacy and experimental modules."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_serializer
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


class Evidence(Model):
    text: str
    basis: Literal['initial', 'reported', 'read', 'checked']
    sender_id: str | None = None
    source: Source


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


class Agent(Model):
    location: str
    goal: str
    known: dict[str, Evidence] = Field(default_factory=dict)
    memories: list[Memory | SceneMemory] = Field(default_factory=list)
    beliefs: dict[str, str] = Field(default_factory=dict)
    committed_plans: list[str] = Field(default_factory=list)
    cooldowns: dict[str, int] = Field(default_factory=dict)


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


class World(Model):
    place_topology: dict[str, list[str]]
    items: dict[str, str]
    access_rules: list[AccessRule]
    environment: dict[str, str | int]
    item_texts: dict[str, str] | None = None

    @model_serializer(mode='wrap')
    def serialize(self, handler):
        value = handler(self)
        if self.item_texts is None: value.pop('item_texts', None)
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

    @model_serializer(mode='wrap')
    def serialize(self, handler):
        value = handler(self)
        # Preserve the exact serialized/hash domain of pre-I6 saved states.
        if self.lineage is None:
            value.pop('lineage', None)
        if self.social is None:
            value.pop('social', None)
        return value


class EmptyArgs(Model):
    pass


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


class GoalArgs(Model):
    goal: str = Field(min_length=1, max_length=1000)


ARG_TYPES = {'observe': EmptyArgs, 'move': MoveArgs, 'take': TakeArgs, 'transfer': TransferArgs,
             'speak': SpeakArgs, 'wait': EmptyArgs, 'goal': GoalArgs, 'read': TakeArgs, 'compare': CompareArgs}


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


class ScheduleArgs(Model):
    job: ScheduledJob


class TriggerArgs(Model):
    job_id: str


class IdleArgs(Model):
    actors: list[str] = Field(min_length=1, max_length=40)


COMMAND_ARGS = {'cognition': CognitionArgs, 'environment': EnvironmentArgs, 'relocate': RelocateArgs,
                'scene_event': SceneEventArgs, 'schedule': ScheduleArgs, 'trigger': TriggerArgs, 'advance_idle': IdleArgs}


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


class MemoryAppend(Model):
    op: Literal['memory_append'] = 'memory_append'
    entity_id: str
    before_length: int
    evidence: Memory | SceneMemory


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


Op = Annotated[LocationSet | HolderSet | GoalSet | KnowledgeSet | MemoryAppend | CounterSet | BeliefSet | PlansSet | EnvironmentSet | JobsSet | SocialSet, Field(discriminator='op')]
OPS = TypeAdapter(list[Op])


class TransitionPlan(Model):
    expected_seq: int
    accepted: bool
    reason_code: str | None
    effects: list[Op]


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
