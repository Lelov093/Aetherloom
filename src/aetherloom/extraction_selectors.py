"""Resolve exact, unique boundary phrases; never guess or repair source text."""
from collections import defaultdict
from copy import deepcopy


def hydrate_selectors(raw, blocks):
    hydrated, issues = deepcopy(raw), []

    def problem(code, key, field, message):
        issues.append(dict(code=code, item_key=key, field=field, message=message))

    def select(anchors, block, key, field, limit=4000, within=None):
        if not block:
            problem('source_block_not_offered', key, field,
                    '引用了本次未提供或不存在的原文块；此段拒绝，不自动换块。')
            return None
        if (not isinstance(anchors, dict) or set(anchors) != {'start_text', 'end_text'}
                or any(not isinstance(value, str) or not value.strip()
                                    or len(value) > 160 for value in anchors.values())):
            problem('invalid_source_anchors', key, field, '须提供非空原字起止短语，不能使用偏移或改写文本。')
            return None
        base = within['start'] if within else 0
        region = block['text'][base:within['end']] if within else block['text']
        positions = []
        for name in ('start_text', 'end_text'):
            phrase = anchors[name]
            position = region.find(phrase)
            if position < 0:
                problem('source_anchor_missing', key, field, '起止短语不在指定原文范围内；不改字或寻找近似替代。')
                return None
            if region.find(phrase, position+1) >= 0:
                problem('ambiguous_source_anchor', key, field, '起止短语存在重复，须明确选择唯一原字短语；不自动选取某次出现。')
                return None
            positions.append(position)
        start, end_start = positions
        end = end_start + len(anchors['end_text'])
        if end_start < start or end < start+len(anchors['start_text']) or end-start > limit:
            problem('invalid_source_anchor_order', key, field, '起止顺序或所选长度无效；不调换、截短或修补。')
            return None
        return block['text'][base+start:base+end], dict(start=base+start, end=base+end)

    if not isinstance(raw, dict) or set(raw) != {'items'} or not isinstance(raw['items'], list):
        return None, [dict(code='invalid_response', message='响应缺少有效的原始提议列表。')]
    for item in hydrated['items']:
        if not isinstance(item, dict) or not isinstance(item.get('payload'), dict):
            return None, [dict(code='invalid_response', message='原始提议结构无效。')]
        key, payload = item.get('key'), item['payload']
        block = blocks.get(item.get('source_block_id')) if isinstance(item.get('source_block_id'), str) else None
        evidence = payload.get('evidence')
        if ('quote' in item or not isinstance(evidence, dict) or set(evidence) != {'basis', 'anchors'}
                or any(name in payload for name in ('field_id', 'typed_value', 'subject_evidence'))):
            problem('source_selector_contract', key, 'payload', '仅返回原文选择与依据类别，不能返回引文、映射或已编译主体依据。')
            continue
        selected_claim = select(evidence['anchors'], block, key, 'payload.evidence.anchors')
        if selected_claim is None:
            continue
        claim, claim_span = selected_claim
        payload['evidence'] = dict(basis=evidence['basis'], quote=claim)
        if payload.get('type') == 'entity':
            if 'name' in payload:
                problem('source_selector_contract', key, 'payload.name', '姓名须通过原文范围选择，不能返回自由命名文本。')
            name = select(payload.pop('name_source', None), block, key, 'payload.name_source', 160, claim_span)
            if name is not None:
                payload['name'] = name[0]
        if payload.get('type') == 'assertion':
            if 'value' in payload:
                problem('source_selector_contract', key, 'payload.value', '属性原值须通过原文范围选择，不能复制、改写或拼接。')
            value = select(payload.pop('value_source', None), block, key, 'payload.value_source', within=claim_span)
            mention = select(payload.pop('subject_source', None), block, key, 'payload.subject_source', 160, claim_span)
            basis, link = payload.pop('subject_basis', None), payload.pop('subject_link', None)
            if value is not None:
                payload['value'] = value[0]
            link_text, link_id = None, None
            if basis not in ('literal_identity', 'coreference') or basis == 'literal_identity' and link is not None:
                problem('subject_evidence_contract', key, 'payload.subject_basis', '主体依据须明确为字面身份或有来源连接的共指。')
            elif basis == 'coreference':
                if not isinstance(link, dict) or set(link) != {'source_block_id', 'anchors'}:
                    problem('subject_evidence_contract', key, 'payload.subject_link', '共指必须明确选择连接身份的原文依据。')
                else:
                    link_id = link['source_block_id']
                    selected = blocks.get(link_id) if isinstance(link_id, str) else None
                    selected_link = select(link['anchors'], selected, key, 'payload.subject_link.anchors')
                    if selected_link is not None:
                        link_text = selected_link[0]
            if mention is not None:
                payload['subject_evidence'] = dict(mention=mention[0], basis=basis,
                    link_quote=link_text, link_source_block_id=link_id)
    return (hydrated, issues) if issues else (hydrated, [])


def subject_identity_issues(output, known):
    names = {e['id']: list(dict.fromkeys(n for n in [e.get('name'), *e.get('aliases', [])] if n)) for e in known}
    # New aliases are claims, not permission to attach an unrelated subject.
    names.update({i.key: [i.payload.name] for i in output.items if i.payload.type == 'entity'})
    matches = defaultdict(set)
    for ref, spellings in names.items():
        for name in spellings:
            matches[name].add(ref)
    issues = []
    for item in output.items:
        if item.payload.type != 'assertion' or not item.payload.subject_evidence:
            continue
        subject, evidence = item.payload.subject_ref, item.payload.subject_evidence
        spellings = names.get(subject, [])
        valid = (evidence.mention in spellings if evidence.basis == 'literal_identity' else
                 any(name in evidence.link_quote and matches[name] == {subject} for name in spellings)
                 if evidence.link_quote else False)
        if not valid:
            issues.append(dict(code='subject_identity_evidence', item_key=item.key, field='payload.subject_evidence',
                message='主体词与所指身份不一致，或共指连接未包含唯一身份表达；不自动改指其他人物。'))
    return issues
