"""Literal source lookup hints, never an identity resolver or output repair."""
from collections import defaultdict
import re

from .proposal_evidence import numeric_value_error


KINSHIP = re.compile(r'(?:(?:我|他|她|其)的?)?(?:父親|父亲|母親|母亲|兒子|儿子|女兒|女儿|孩子|兄弟|兄妹|姐妹)')
NUMBER = re.compile(
    r'(?:约|約|大概|至少|至多|将近|將近|不足|超过|超過|少于|少於|不到)?\s*'
    r'[0-9〇零一二三四五六七八九十百千万萬两兩]+(?:[.,][0-9]+)?'
    r'(?:[至到~～—–][0-9〇零一二三四五六七八九十百千万萬两兩]+|多|余|餘|来|來)?'
    r'(?:岁|歲|年|米|厘米|公斤|千克|cm|kg|%|％)(?:上下|左右|以上|以下)?')
QUOTED = re.compile(r'[“「『]([^\r\n“”「」『』]{1,24})[”」』]')


def literal_hints(source, blocks, *, include_fragments=True):
    def entry(text):
        matches = [b for b in blocks if text in b['text']]
        matches.sort(key=lambda b: (not b.get('paragraph', False), b['start']))
        return dict(text=text, source_block_ids=[b['id'] for b in matches])

    kinship = list(dict.fromkeys(m.group() for m in KINSHIP.finditer(source)))
    uncertain = list(dict.fromkeys(m.group().strip() for m in NUMBER.finditer(source)
                      if numeric_value_error(dict(value=m.group().strip()), dict(value_type='number'))))
    result = dict(
        limitation='字面查找，非穷尽；不是身份、事实或共指结论。',
        kinship_expressions=[entry(text) for text in kinship],
        uncertain_numeric_values=[{**entry(text), 'numeric_field_eligible': False} for text in uncertain],
    )
    if not include_fragments:
        return result
    # Repeated literal fragments help locate a spelling; common words and
    # editorial labels remain words, not proposed identities. No gold/name list.
    occurrences = defaultdict(list)
    for run in re.finditer(r'[\u3400-\u9fff]+', source):
        for length in range(2, 9):
            for offset in range(len(run.group()) - length + 1):
                occurrences[run.group()[offset:offset+length]].append(run.start()+offset)
    repeated = []
    for text, positions in occurrences.items():
        if len(positions) < 2:
            continue
        sides = ([source[p-1:p] for p in positions],
                 [source[p+len(text):p+len(text)+1] for p in positions])
        if len(text) < 8 and any(len(set(chars)) == 1 and re.fullmatch(r'[\u3400-\u9fff]', chars[0] or '')
                                 for chars in sides):
            continue
        repeated.append((text, len(positions)))
    repeated.sort(key=lambda pair: (-pair[1], -len(pair[0]), pair[0]))
    quoted = list(dict.fromkeys(m.group(1) for m in QUOTED.finditer(source)))
    spellings = list(dict.fromkeys([*quoted, *(text for text, _ in repeated[:48])]))
    result['literal_fragments'] = [entry(text) for text in spellings]
    return result
