"""Authoring schema. Descriptive core fields are distinct from confirmed assertions."""
import json
from pydantic import Field, StrictBool, StrictFloat, StrictInt, StrictStr, model_validator
from typing import Literal
from .creation_models import Model

CORE_FIELDS = {
    'character': {'background':'背景', 'personality':'性格', 'capabilities':'能力', 'goals':'目标'},
    'location': {'environment':'环境', 'history':'历史', 'description':'概述'},
    'faction': {'purpose':'宗旨', 'organization':'组织结构', 'history':'历史'},
    'item': {'appearance':'外观', 'purpose':'用途', 'history':'来历'},
    'species': {'traits':'特征', 'culture':'文化', 'history':'历史'},
    'concept': {'definition':'定义', 'scope':'适用范围'},
    'world_rule': {'definition':'规则说明', 'scope':'适用范围', 'exceptions':'例外'},
    'custom': {'definition':'定义', 'description':'概述'},
}
BUILTIN_FIELDS = [
    {'key':'age','label':'年龄','value_type':'number','kinds':['character'],'aliases':['年龄','年齡','age']},
    {'key':'birth_year','label':'出生年份','value_type':'number','kinds':['character'],'aliases':['出生年份','出生年','birth_year']},
    {'key':'occupation','label':'职业','value_type':'text','kinds':['character'],'aliases':['职业','職業','occupation','profession']},
    {'key':'species','label':'种族','value_type':'entity','kinds':['character'],'aliases':['种族','物种','species']},
    {'key':'member_of','label':'所属组织','value_type':'entity','kinds':[],'aliases':['member_of','所属组织']},
    {'key':'location','label':'所在地','value_type':'entity','kinds':[],'aliases':['location','所在地']},
    {'key':'capital','label':'首都','value_type':'entity','kinds':['faction','location'],'aliases':['capital','首都']},
]
ValueType = Literal['text','number','boolean','entity','tags']
TypedValue = StrictStr | StrictInt | StrictFloat | StrictBool | list[StrictStr]

class FieldDefinition(Model):
    key: str = Field(min_length=1,max_length=80,pattern=r'^[a-z][a-z0-9_]*$')
    label: str = Field(min_length=1,max_length=80)
    value_type: ValueType
    kinds: list[Literal['character','location','faction','item','species','concept','world_rule','custom']] = Field(default_factory=list)
    aliases: list[str] = Field(default_factory=list,max_length=30)

class FactInput(Model):
    predicate: str = Field(min_length=1,max_length=160)
    value: str = Field(default='',max_length=4000)
    field_id: str | None = None
    typed_value: TypedValue | None = None
    object_id: str | None = None
    valid_from: str | None = Field(default=None,max_length=160)
    valid_until: str | None = Field(default=None,max_length=160)
    source_note: str = Field(default='人工世界编辑',max_length=500)

class FactEdit(FactInput):
    version: int = Field(ge=1)

class RecordStatus(Model):
    version: int = Field(ge=1)
    status: Literal['active','withdrawn']

class EventInput(Model):
    title: str = Field(min_length=1,max_length=160)
    description: str = Field(default='',max_length=200000)
    participants: list[str] = Field(default_factory=list,max_length=100)
    participant_roles: dict[str,str] = Field(default_factory=dict)
    location_id: str | None = None
    valid_from: str | None = Field(default=None,max_length=160)
    valid_until: str | None = Field(default=None,max_length=160)
    causes: list[str] = Field(default_factory=list,max_length=100)
    before_state: str = Field(default='',max_length=20000)
    after_state: str = Field(default='',max_length=20000)
    source_note: str = Field(default='人工世界编辑',max_length=500)

    @model_validator(mode='after')
    def roles(self):
        if set(self.participant_roles) - set(self.participants):
            raise ValueError('参与角色必须属于事件参与者。')
        return self

class EventEdit(EventInput):
    version: int = Field(ge=1)

class RelationshipInput(Model):
    subject_id: str
    object_id: str
    label: str = Field(min_length=1,max_length=160)
    description: str = Field(default='',max_length=20000)
    valid_from: str | None = Field(default=None,max_length=160)
    valid_until: str | None = Field(default=None,max_length=160)
    strength: float | None = Field(default=None,ge=0,le=1)
    source_note: str = Field(default='人工世界编辑',max_length=500)

class RelationshipEdit(RelationshipInput):
    version: int = Field(ge=1)

class MergeInput(Model):
    target_id: str
    source_version: int = Field(ge=1)
    target_version: int = Field(ge=1)
    expected_revision: int = Field(ge=1)
    keep_differences: bool = False

def predicate_key(value,fields=None):
    key = value.strip().casefold()
    for field in fields if fields is not None else BUILTIN_FIELDS:
        if key in [a.casefold() for a in [field['key'],field['label'],*field['aliases']]]:
            return field['key']
    return key

def schema(conn, world):
    custom = [json.loads(r[0]) for r in conn.execute('SELECT definition FROM world_fields WHERE world_id=? ORDER BY rowid',(world,))]
    # New built-ins must not reinterpret a world's previously authored field.
    custom_keys = {field['key'] for field in custom}
    return {'core':CORE_FIELDS,'fields':[field for field in BUILTIN_FIELDS if field['key'] not in custom_keys]+custom}
