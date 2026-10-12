"""Check proposal-specific grounding without rewriting model output.

Basis is a model classification, not semantic proof. Exact excerpts and numeric
consistency are checked locally; explicit Review remains necessary.
"""
import re
from decimal import Decimal

from .source_evidence import EvidenceError, locate_evidence


EVIDENCE_BASES = {
    'entity': ('named_identity', 'attribute_object', 'unresolved_identity'),
    'assertion': ('independent_attribute',),
    'relationship': ('independent_relationship',),
    'event': ('occurrence',),
}


def numeric_value_error(data, definition):
    if not definition or definition['value_type'] != 'number':
        return None
    raw = data['value']
    # Reject loss of precision without converting or guessing Chinese numerals.
    if (re.search(r'约|約|大概|左右|上下|多|余|餘|来|來|将近|將近|至少|至多|不足|超过|超過|少于|少於|不到|以上|以下|[至到~～—–]', raw)
            or re.search(r'(?<![〇零一二三四五六七八九十百千万萬两兩])(?:十|[一二三四五六七八九]十)?[一二三四五六七八九两兩][一二三四五六七八九两兩](?:岁|歲)', raw)):
        return '模糊或范围数字不能映射为单个精确数字，请取消数字字段映射并保留原值。'
    value = data.get('typed_value')
    if type(value) not in (int, float):
        return None  # Existing field-type validation reports this separately.
    # Digits attached to Latin unit names (e.g. m2) are not another value.
    numbers = re.findall(r'(?<![\d.A-Za-z])[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?', data['value'])
    if len(numbers) > 1:
        return '原始数字属性包含多个数值或日期，请将属性值与时间分开后再接受。'
    if numbers and Decimal(numbers[0].replace(',', '')) != Decimal(str(value)):
        return '原始属性值与类型化数字不一致，请核对并编辑候选；不会自动换算或覆盖原值。'
    return None  # No Arabic numeral: do not guess or reject Chinese-number prose.


def grounding_issues(output, source, fields):
    issues = []
    definitions = {f['key']: f for f in fields}
    for item in output.items:
        data = item.payload.model_dump()
        evidence = data.get('evidence')
        def issue(code, field, message):
            issues.append(dict(code=code, item_key=item.key, field=field, message=message))
        if not evidence:
            issue('missing_claim_evidence', 'payload.evidence', '新生成候选缺少独立陈述依据。')
        else:
            if evidence['basis'] not in EVIDENCE_BASES[data['type']]:
                issue('unsupported_claim_basis', 'payload.evidence.basis',
                      '事件上下文或文档标记不能单独建立身份、属性或关系。')
            try:
                quote, _ = locate_evidence(source, item.quote, item.source_block_id)
                if evidence['quote'] not in quote:
                    issue('claim_evidence_quote', 'payload.evidence.quote',
                          '候选依据必须是所选原文块内的连续原文，不能改写或引用其他段。')
            except EvidenceError:
                issue('claim_evidence_quote', 'source_block_id', '候选所选来源无效。')
            if data['type'] == 'entity' and data['name'] not in evidence['quote']:
                issue('identity_evidence_name', 'payload.evidence.quote', '身份依据未包含候选名称。')
        if data['type'] == 'assertion':
            error = numeric_value_error(data, definitions.get(data.get('field_id')))
            if error:
                issue('non_atomic_numeric_value', 'payload.value', error)
    return issues
