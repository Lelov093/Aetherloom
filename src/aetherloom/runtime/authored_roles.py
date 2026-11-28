"""Resolve explicit opening premises into the existing Runtime inputs."""
from typing import Literal

from pydantic import Field, model_serializer, model_validator

from aetherloom.creation import record
from aetherloom.object_schema import predicate_key
from .contracts import AccessRule, Agent, BaselineSource, Evidence, KeyUnknown, Model, OrdinaryPast, StoryPremises
from .domain import RuntimeFault
from .scenarios import Binding, MaterialSpan


class OpeningEvidence(Model):
    basis: Literal['initial', 'experienced', 'reported', 'belief']
    text: str = Field(min_length=1, max_length=450, pattern=r'\S')
    reporter: str = Field(default='', max_length=80)
    source: MaterialSpan | None = None

    @model_validator(mode='after')
    def report_has_speaker(self):
        if bool(self.reporter.strip()) != (self.basis == 'reported'):
            raise ValueError('A report needs an attributed speaker.')
        return self


class CharacterOpening(Model):
    location: Binding | None = None
    goal: str = Field(default='', max_length=400)
    voice_sample: str = Field(default='', max_length=250)
    evidence: list[OpeningEvidence] = Field(default_factory=list, max_length=8)


class RequiredRule(Model):
    mechanism: Literal['entry_item'] | None = None
    destination: Binding | None = None
    item: Binding | None = None
    holder: Binding | None = None


class OpeningReview(Model):
    candidates: list[Binding] = Field(default_factory=list, max_length=6)
    roles: dict[str, CharacterOpening] = Field(default_factory=dict, max_length=18)
    required_rules: dict[str, RequiredRule] = Field(default_factory=dict, max_length=30)
    observation_question: str = Field(default='', max_length=1000)
    ordinary_past: list[OrdinaryPast] = Field(default_factory=list, max_length=6)
    key_unknowns: list[KeyUnknown] = Field(default_factory=list, max_length=6)

    @model_serializer(mode='wrap')
    def serialize(self, handler):
        value = handler(self)
        if not self.ordinary_past:
            value.pop('ordinary_past', None)
        if not self.key_unknowns:
            value.pop('key_unknowns', None)
        return value


def entity(conn, world, identity):
    row = conn.execute("""SELECT * FROM entities WHERE id=? AND world_id=?
                          AND status='active' AND merged_into IS NULL""", (identity, world)).fetchone()
    return record(row) if row else None


def bound(conn, world, binding, kind):
    value = entity(conn, world, binding.entity_id)
    if not value or value['kind'] != kind or value['version'] != binding.entity_version:
        raise RuntimeFault('scenario_sources_changed')
    return value


def location_claims(scope, snapshots, identities):
    claims = {identity: {} for identity in identities}
    for entry in scope:
        if not entry['key'].startswith('assertion:'):
            continue
        fact = snapshots[entry['key']]
        subject, target = fact['subject_id'], fact['object_id']
        if subject in claims and target and (fact['field_id'] or predicate_key(fact['predicate'])) == 'location':
            claims[subject].setdefault(target, []).append(dict(id=fact['id'], version=fact['version']))
    return claims


def role_input(settings, location, baseline_id, frozen_spans):
    agent = Agent(location=location, goal=settings.goal.strip() or '根据当前所见和已知内容行动')
    for index, entry in enumerate(settings.evidence, 1):
        if entry.source and (entry.source.node_id, entry.source.version, entry.source.start, entry.source.end) not in frozen_spans:
            raise RuntimeFault('invalid_opening_source')
        key = f'opening-{index}'
        text = entry.text.strip()
        if entry.basis == 'belief':
            agent.beliefs[key] = text
        else:
            if entry.basis == 'reported':
                text = f'{entry.reporter.strip()}转述：{text}'
            agent.known[key] = Evidence(text=text, basis=entry.basis, source=BaselineSource(baseline_id=baseline_id),
                                        original=entry.source if entry.basis in ('initial', 'experienced') else None)
    return agent


def compile_premises(review, agents):
    ordinary = {f'past-{index}': entry.model_copy(update={'text': entry.text.strip()})
                for index, entry in enumerate(review.ordinary_past, 1)}
    unknowns = {f'unknown-{index}': entry.model_copy(update={'title': entry.title.strip()})
                for index, entry in enumerate(review.key_unknowns, 1)}
    for people in [*(entry.witnesses for entry in ordinary.values()), *(entry.knowers for entry in unknowns.values())]:
        if len(set(people)) != len(people) or not set(people) <= set(agents):
            raise RuntimeFault('invalid_premise_scope')
    if (len({entry.text for entry in ordinary.values()}) != len(ordinary)
        or len({entry.title for entry in unknowns.values()}) != len(unknowns)
        or any(entry.knowers and not entry.may_resolve for entry in unknowns.values())):
        raise RuntimeFault('invalid_premise_scope')
    return StoryPremises(ordinary=ordinary, unknowns=unknowns) if ordinary or unknowns else None


def compile_rules(conn, world, scope, required, places, agents):
    rules = {row['id']: row for row in scope if row['kind'] == 'world_rule'}
    if set(required) - set(rules):
        raise RuntimeFault('invalid_opening_rules')
    reports, blockers, access, items = [], [], [], {}
    for identity, row in rules.items():
        choice = required.get(identity)
        report = dict(id=identity, title=row['title'], version=row['version'], status='reference')
        reports.append(report)
        if choice is None:
            continue
        if choice.mechanism != 'entry_item' or not (choice.destination and choice.item and choice.holder):
            report.update(status='blocked', consequence='还没有可检查的后果。请补完整执行条件，或改为作者参考。')
            blockers.append(dict(kind='rule', id=identity, message=f'「{row["title"]}」缺少可检查的后果。'))
            continue
        destination = bound(conn, world, choice.destination, 'location')
        item = bound(conn, world, choice.item, 'item')
        holder = agents.get(choice.holder.entity_id)
        if holder:
            if not holder['enabled'] or holder.get('candidate') or holder['entity_version'] != choice.holder.entity_version:
                holder = None
        elif choice.holder.entity_id in places:
            location = bound(conn, world, choice.holder, 'location')
            holder = dict(id=location['id'], name=location['name'])
        if not holder or destination['id'] not in places:
            report.update(status='blocked', consequence='请为规则选择本场地点，并指定物品的初始持有人或存放地点。')
            blockers.append(dict(kind='rule', id=identity, message=f'「{row["title"]}」缺少本场地点或有效的物品归属。'))
            continue
        existing = items.get(item['id'])
        if existing and existing['holder'] != holder['id']:
            report.update(status='blocked', consequence='同一物品有两个初始归属。')
            blockers.append(dict(kind='rule', id=identity, message=f'「{item["name"]}」有两个初始归属，请选定一个。'))
            continue
        items[item['id']] = dict(id=item['id'], name=item['name'], description='', holder=holder['id'], entity=item)
        rule = AccessRule(destination_id=destination['id'], item_id=item['id'])
        if rule not in access:
            access.append(rule)
        report.update(status='supported', consequence=f'尝试进入「{destination["name"]}」时，未持有「{item["name"]}」将被阻止。',
                      destination_id=destination['id'], item_id=item['id'], holder_id=holder['id'], holder_name=holder['name'])
    return reports, blockers, access, list(items.values())
