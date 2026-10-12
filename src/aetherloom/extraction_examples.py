"""Complete synthetic guidance examples, independent of public acceptance texts.

These demonstrate the selection contract, not model quality or semantic proof.
Every example is compiled through the same strict checks in targeted tests.
"""


def anchors(start, end=None):
    return dict(start_text=start, end_text=start if end is None else end)


def item(key, payload, basis, start, end=None, block='b0'):
    return dict(key=key, confidence=0.9, source_block_id=block,
                payload={**payload, 'evidence': dict(basis=basis, anchors=anchors(start, end))})


def assertion(ref, predicate, value, subject, *, end=None, time=None, link=None):
    return dict(type='assertion', subject_ref=ref, predicate=predicate,
                value_source=anchors(value, end), subject_source=anchors(subject),
                subject_basis='coreference' if link else 'literal_identity',
                subject_link=link, object_ref=None, valid_from=time, valid_until=None)


SPEAKERS = [dict(id='ye', name='叶雨', kind='character', aliases=['我']),
            dict(id='su', name='苏槐', kind='character', aliases=['我'])]
WRAPPED = '杜鹃十三四岁，能拾\r\n    贝壳。她的父亲是船工。'

EXAMPLES = (
    dict(source=WRAPPED, known=[], output=dict(items=[
        item('du', dict(type='entity', name_source=anchors('杜鹃'), entity_kind='character',
                        aliases=[], description=''), 'named_identity', '杜鹃', '贝壳。', block='b2'),
        item('du_age', assertion('du', '年龄', '十三四岁', '杜鹃'),
             'independent_attribute', '杜鹃', '贝壳。', block='b2'),
        # The omitted subject of 能拾 is supported by the complete same sentence.
        item('du_skill', assertion('du', '技能', '拾', '杜鹃', end='贝壳'),
             'independent_attribute', '杜鹃', '贝壳。', block='b2'),
        item('father', dict(type='entity', name_source=anchors('父亲'), entity_kind='character',
                            aliases=[], description='杜鹃的父亲'),
             'named_identity', '杜鹃', '她的父亲是船工。', block='b2'),
        item('father_job', assertion('father', '职业', '船工', '父亲'),
             'independent_attribute', '她的父亲是船工。', block='b2'),
        item('parent', dict(type='relationship', subject_ref='father', object_ref='du', label='父亲',
                            description='', valid_from=None, valid_until=None),
             'independent_relationship', '杜鹃', '她的父亲是船工。', block='b2'),
    ])),
    dict(source='叶雨说：“我22岁。”苏槐说：“我二十多岁。”', known=SPEAKERS, output=dict(items=[
        item('ye_age', assertion('ye', '年龄', '22岁', '我',
             link=dict(source_block_id='b0', anchors=anchors('叶雨说：“我22岁。”'))),
             'independent_attribute', '叶雨说：“我22岁。”'),
        item('su_age', assertion('su', '年龄', '二十多岁', '我',
             link=dict(source_block_id='b0', anchors=anchors('苏槐说：“我二十多岁。”'))),
             'independent_attribute', '苏槐说：“我二十多岁。”'),
    ])),
    dict(source='我19岁。87年，宁舟27岁，任巡夜人。', known=SPEAKERS, output=dict(items=[
        item('narrator', dict(type='entity', name_source=anchors('我'), entity_kind='character',
                             aliases=[], description='以“我”自述年龄的人'),
             'unresolved_identity', '我19岁。'),
        item('narrator_age', assertion('narrator', '年龄', '19岁', '我'),
             'independent_attribute', '我19岁。'),
        item('ning', dict(type='entity', name_source=anchors('宁舟'), entity_kind='character',
                         aliases=[], description=''), 'named_identity', '87年，宁舟27岁，任巡夜人。'),
        item('ning_age', assertion('ning', '年龄', '27岁', '宁舟', time='87'),
             'independent_attribute', '87年，宁舟27岁，任巡夜人。'),
        item('ning_job', assertion('ning', '职业', '巡夜人', '宁舟', time='87'),
             'independent_attribute', '87年，宁舟27岁，任巡夜人。'),
    ])),
    dict(source='《夜航录》是章节题名。阿砾与桑芷是朋友。阿砾在白沙港登船。', known=[
        dict(id='a', name='阿砾', kind='character', aliases=[]),
        dict(id='s', name='桑芷', kind='character', aliases=[]),
        dict(id='port', name='白沙港', kind='location', aliases=[]),
    ], output=dict(items=[
        item('friends', dict(type='relationship', subject_ref='a', object_ref='s', label='朋友',
                             description='', valid_from=None, valid_until=None),
             'independent_relationship', '阿砾与桑芷是朋友。'),
        item('boarding', dict(type='event', title='阿砾登船', description='阿砾在白沙港登船。',
                              participants=['a'], location_ref='port', valid_from=None, valid_until=None),
             'occurrence', '阿砾在白沙港登船。'),
    ])),
)
