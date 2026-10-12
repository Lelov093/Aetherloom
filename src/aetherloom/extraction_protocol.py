"""Compile source selectors and field choices without repairing model proposals."""
from pydantic import Field, ValidationError

from .creation_models import Model
from .object_schema import TypedValue
from .proposal_evidence import grounding_issues, numeric_value_error
from .review_models import ExtractionOutput
from .source_evidence import source_blocks
from .extraction_selectors import hydrate_selectors, subject_identity_issues

PROTOCOL = 'source-anchors-and-mapping-v3'


class ProtocolError(ValueError):
    def __init__(self, issues):
        self.issues = issues


def issue(code, message, **context):
    return dict(code=code, message=message, **context)


def validation_issues(error):
    return [issue(e['type'], e['msg'], field='.'.join(map(str, e['loc'])))
            for e in error.errors(include_input=False, include_url=False)]


def compile_proposals(raw, source, known, *, offered_block_ids=None):
    """Only the selected immutable block supplies evidence.quote; no returned quote exists."""
    blocks = {b['id']: b for b in source_blocks(source)}
    if offered_block_ids is not None:
        blocks = {key: block for key, block in blocks.items() if key in offered_block_ids}
    hydrated, issues = hydrate_selectors(raw, blocks)
    if issues:
        raise ProtocolError(issues)
    try:
        output = ExtractionOutput.model_validate(hydrated)
    except ValidationError as error:
        raise ProtocolError(validation_issues(error)) from None
    issues = grounding_issues(output, source, [])
    issues.extend(subject_identity_issues(output, known))
    entities = {item.key for item in output.items if item.payload.type == 'entity'}
    allowed = entities | {e['id'] for e in known}
    for key in entities & {e['id'] for e in known}:
        issues.append(issue('reference_collision', '新候选键不能覆盖提供的对象ID。', item_key=key))
    for item in output.items:
        payload = item.payload.model_dump()
        refs = [(name, payload.get(name)) for name in ('subject_ref', 'object_ref', 'location_ref')]
        refs.extend((f'participants.{i}', ref) for i, ref in enumerate(payload.get('participants', [])))
        for name, ref in refs:
            if ref and ref not in allowed:
                issues.append(issue('unknown_reference', '引用不属于提供的对象或原始身份提议。', item_key=item.key,
                                    field=name, reference=ref))
    if issues:
        raise ProtocolError(issues)
    return output


def mapping_options(output, known, fields):
    kinds = {e['id']: e.get('kind') for e in known}
    kinds.update({item.key: item.payload.entity_kind for item in output.items if item.payload.type == 'entity'})
    options = []
    for item in output.items:
        if item.payload.type != 'assertion':
            continue
        data, eligible = item.payload.model_dump(), []
        subject_kind = kinds.get(data['subject_ref'])
        for definition in fields:
            if definition['kinds'] and subject_kind not in definition['kinds']:
                continue
            if (definition['value_type'] == 'entity') != bool(data.get('object_ref')):
                continue
            if numeric_value_error(data, definition):
                continue
            eligible.append(definition)
        options.append(dict(item_key=item.key, subject_kind=subject_kind, proposal=data,
                            eligible_fields=eligible))
    return options


def mapping_schema(options):
    branches = []
    for option in options:
        values = [(None, {'type': 'null'})]
        for field in option['eligible_fields']:
            typed = {'text': {'const': option['proposal']['value']}, 'number': {'type': 'number'},
                     'boolean': {'type': 'boolean'}, 'entity': {'type': 'null'},
                     'tags': {'type': 'array', 'items': {'type': 'string'}}}[field['value_type']]
            values.append((field['key'], typed))
        for field_id, typed in values:
            branches.append(dict(type='object', additionalProperties=False,
                required=['item_key', 'field_id', 'typed_value'], properties={
                    'item_key': {'const': option['item_key']}, 'field_id': {'const': field_id},
                    'typed_value': typed}))
    return dict(type='object', additionalProperties=False, required=['mappings'], properties={
        'mappings': dict(type='array', minItems=len(options), maxItems=len(options),
                         items={'anyOf': branches} if branches else {'type': 'object'})})


class FieldChoice(Model):
    item_key: str
    field_id: str | None
    typed_value: TypedValue | None


class MappingOutput(Model):
    mappings: list[FieldChoice] = Field(max_length=200)


def compile_mappings(raw, output, options, source, fields):
    try:
        response = MappingOutput.model_validate(raw)
    except ValidationError as error:
        raise ProtocolError(validation_issues(error)) from None
    keys = [mapping.item_key for mapping in response.mappings]
    if len(keys) != len(set(keys)) or set(keys) != {option['item_key'] for option in options}:
        raise ProtocolError([issue('mapping_coverage', '必须逐条映射全部已验证属性，不得删项、重复或增加候选。')])
    by_key, compiled, issues = {o['item_key']: o for o in options}, output.model_dump(), []
    items = {item['key']: item for item in compiled['items']}
    for mapping in response.mappings:
        option = by_key[mapping.item_key]
        definition = next((f for f in option['eligible_fields'] if f['key'] == mapping.field_id), None)
        payload = items[mapping.item_key]['payload']
        if mapping.field_id is not None and not definition:
            issues.append(issue('ineligible_field_mapping', '字段未提供给此属性，不能取消错误映射或替换为其他字段。', item_key=mapping.item_key))
            continue
        value = mapping.typed_value
        if not definition:
            valid = value is None
        else:
            valid = {'text': isinstance(value, str) and value == payload['value'],
                     'number': type(value) in (int, float), 'boolean': type(value) is bool,
                     'entity': value is None and bool(payload.get('object_ref')),
                     'tags': isinstance(value, list) and all(isinstance(v, str) and v.strip() and v in payload['value'] for v in value)}[definition['value_type']]
        if not valid:
            issues.append(issue('field_value_type', '类型化值不符合所选字段或原值合同。', item_key=mapping.item_key))
            continue
        payload.update(field_id=mapping.field_id, typed_value=value)
        if definition:
            payload['predicate'] = definition['label']  # Compile the explicitly selected field's label.
    if issues:
        raise ProtocolError(issues)
    final = ExtractionOutput.model_validate(compiled)
    issues = grounding_issues(final, source, fields)
    if issues:
        raise ProtocolError(issues)
    return final
