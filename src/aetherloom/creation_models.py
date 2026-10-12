"""Editable documents and world identity; Canon facts stay separate."""

import json
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Status = Literal['active', 'archived', 'deleted']
WorkKind = Literal['novel', 'script', 'game', 'side_story', 'lore', 'other']
EntityKind = Literal['character', 'location', 'faction', 'item', 'species', 'concept', 'world_rule', 'custom']
MaterialCategory = Literal['unclassified', 'prose', 'lore', 'outline', 'theme', 'foreshadowing', 'note']
MATERIAL_CATEGORIES = {'unclassified', 'prose', 'lore', 'outline', 'theme', 'foreshadowing', 'note'}


def validate_metadata(metadata):
    if metadata.get('material_category', 'unclassified') not in MATERIAL_CATEGORIES:
        raise ValueError('请选择有效的资料分类。')
    if 'material_tags' in metadata:
        try:
            tags = json.loads(metadata['material_tags'])
        except (ValueError, TypeError):
            raise ValueError('资料标签格式无效。')
        if not isinstance(tags, list) or len(tags) > 30 or any(not isinstance(t, str) or not t.strip() or len(t) > 80 for t in tags):
            raise ValueError('资料标签最多30项，每项1–80字。')
        metadata['material_tags'] = json.dumps(list(dict.fromkeys(t.strip() for t in tags)), ensure_ascii=False)
    return metadata
EMPTY_DOCUMENT = {'type': 'doc', 'content': [{'type': 'paragraph'}]}
NODES = {'doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule'}
MARKS = {'bold', 'italic', 'strike', 'code', 'underline', 'link', 'entityMention', 'contentLink'}


def inspect_document(doc: dict):
    mentions, links = [], []
    count = 0

    def visit(node, depth=0):
        nonlocal count
        count += 1
        if depth > 30 or count > 100000 or not isinstance(node, dict) or node.get('type') not in NODES:
            raise ValueError('正文结构无效或过于复杂。')
        if node['type'] == 'text' and not isinstance(node.get('text'), str):
            raise ValueError('正文文本无效。')
        node_marks = node.get('marks', [])
        if not isinstance(node_marks, list):
            raise ValueError('正文标记无效。')
        for mark in node_marks:
            if not isinstance(mark, dict) or mark.get('type') not in MARKS:
                raise ValueError('不支持的正文标记。')
            attrs = mark.get('attrs') or {}
            if not isinstance(attrs, dict):
                raise ValueError('正文标记属性无效。')
            if mark['type'] == 'entityMention':
                if not isinstance(attrs.get('entityId'), str):
                    raise ValueError('对象链接缺少稳定身份。')
                mentions.append((attrs['entityId'], node.get('text', '')))
            if mark['type'] == 'contentLink':
                if not isinstance(attrs.get('nodeId'), str):
                    raise ValueError('内部链接缺少文档身份。')
                links.append(attrs['nodeId'])
            if mark['type'] == 'link' and not str(attrs.get('href', '')).startswith(('https://', 'http://', 'mailto:')):
                raise ValueError('链接地址无效。')
        children = node.get('content', [])
        if not isinstance(children, list):
            raise ValueError('正文内容无效。')
        parts = [visit(child, depth + 1) for child in children]
        if node['type'] == 'text':
            return node['text']
        if node['type'] == 'hardBreak':
            return '\n'
        return ('' if node['type'] in {'paragraph', 'heading', 'codeBlock'} else '\n').join(parts)

    if doc.get('type') != 'doc':
        raise ValueError('正文必须是文档。')
    text = visit(doc)
    if len(json.dumps(doc, ensure_ascii=False)) > 4000000:
        raise ValueError('单篇正文过大，请拆分章节。')
    return text, mentions, links


class Model(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class WorkCreate(Model):
    title: str = Field(min_length=1, max_length=160)
    kind: WorkKind = 'novel'


class WorkPatch(Model):
    version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=160)
    kind: WorkKind | None = None
    status: Status | None = None


class NodeCreate(Model):
    title: str = Field(min_length=1, max_length=160)
    kind: str = Field(default='chapter', min_length=1, max_length=40)
    parent_id: str | None = None
    document: dict = Field(default_factory=lambda: EMPTY_DOCUMENT.copy())
    metadata: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode='after')
    def validate_document(self):
        inspect_document(self.document)
        validate_metadata(self.metadata)
        return self


class NodePatch(Model):
    version: int = Field(ge=1)
    title: str | None = Field(default=None, min_length=1, max_length=160)
    kind: str | None = Field(default=None, min_length=1, max_length=40)
    parent_id: str | None = None
    position: int | None = Field(default=None, ge=0)
    status: Status | None = None
    document: dict | None = None
    metadata: dict[str, str] | None = None

    @model_validator(mode='after')
    def validate_document(self):
        if self.document is not None:
            inspect_document(self.document)
        if self.metadata is not None:
            validate_metadata(self.metadata)
        if any(getattr(self, key) is None for key in self.model_fields_set - {'parent_id'}):
            raise ValueError('修改字段不能为空。')
        return self


class Section(Model):
    title: str = Field(max_length=160)
    body: str = Field(max_length=200000)


class EntityCreate(Model):
    name: str = Field(min_length=1, max_length=160)
    kind: EntityKind = 'character'
    aliases: list[str] = Field(default_factory=list, max_length=100)
    sections: list[Section] = Field(default_factory=list, max_length=100)
    core: dict[str,str] = Field(default_factory=dict)
    custom_type: str = Field(default='',max_length=80)

    @model_validator(mode='after')
    def validate_core(self):
        from .object_schema import CORE_FIELDS
        if set(self.core) - set(CORE_FIELDS[self.kind]):
            raise ValueError('核心字段不属于当前对象类型；自定义事实请使用扩展字段。')
        if any(len(value)>200000 for value in self.core.values()):
            raise ValueError('核心说明过长。')
        if self.custom_type and self.kind != 'custom':
            raise ValueError('自定义类型名称仅用于自定义对象。')
        return self


class EntityPatch(EntityCreate):
    version: int = Field(ge=1)
    status: Status = 'active'


class FactCreate(Model):
    predicate: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=4000)
    object_id: str | None = None
    valid_from: str | None = Field(default=None, max_length=120)
    valid_until: str | None = Field(default=None, max_length=120)
    source_note: str = Field(default='人工世界编辑', max_length=500)
