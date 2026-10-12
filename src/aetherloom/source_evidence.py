"""Exact source blocks, identified within one immutable extraction chunk."""
import re


class EvidenceError(ValueError):
    pass


def source_blocks(text, size=2000):
    blocks = []
    for line in re.finditer(r'[^\n]+', text):
        if not line.group().strip():
            continue  # CR-only/blank lines are framing, never evidence choices.
        for start in range(line.start(), line.end(), size):
            end = min(start + size, line.end())
            blocks.append(dict(id=f'b{len(blocks)}', start=start, end=end, text=text[start:end]))
    # Preserve existing single-line IDs. Additional windows let a hard-wrapped
    # sentence supply one continuous citation, including its original separators.
    # No words are joined, repaired or inferred; long windows stay unavailable.
    for left, right in zip(blocks.copy(), blocks[1:]):
        if right['end'] - left['start'] <= size:
            start, end = left['start'], right['end']
            blocks.append(dict(id=f'b{len(blocks)}', start=start, end=end, text=text[start:end]))
    # Some electronic editions use a blank line at every hard wrap and two
    # blank lines between paragraphs. Offer the complete ORIGINAL paragraph,
    # never joining lines. Existing line/window IDs remain unchanged.
    breaks = 3 if re.search(r'(?:\r?\n[ \t]*){3,}', text) else 2
    separator = re.compile(r'(?:\r?\n[ \t]*){' + str(breaks) + r',}')
    boundaries = [(m.start(), m.end()) for m in separator.finditer(text)]
    start = 0
    for end, following in [*boundaries, (len(text), len(text))]:
        if '\n' in text[start:end].strip() and end - start <= size:
            existing = next((b for b in blocks if b['start'] == start and b['end'] == end), None)
            if existing:
                existing['paragraph'] = True
            else:
                blocks.append(dict(id=f'b{len(blocks)}', start=start, end=end,
                                   text=text[start:end], paragraph=True))
        start = following
    return blocks


def request_source_blocks(text):
    """Cover original text with fewer choices, preserving the legacy block catalog.

    Prefer complete paragraphs, then the furthest-reaching existing window for
    any uncovered non-whitespace character. Only framing between windows may be
    omitted; the selected blocks themselves are never trimmed or reconstructed.
    """
    blocks = source_blocks(text)
    selected, covered = [], bytearray(len(text))

    def include(block):
        selected.append(block)
        covered[block['start']:block['end']] = b'\x01' * (block['end'] - block['start'])

    for block in blocks:
        if block.get('paragraph'):
            include(block)
    for position, character in enumerate(text):
        if character.isspace() or covered[position]:
            continue
        include(max((b for b in blocks if b['start'] <= position < b['end']),
                    key=lambda b: (b['end'], -b['start'])))
    return sorted(selected, key=lambda b: b['start'])


def locate_evidence(text, quote, block_id=None):
    """Never fuzzy-match or repair model prose. A block ID selects original source text."""
    offset = 0
    region = text
    if block_id:
        block = next((block for block in source_blocks(text) if block['id']==block_id), None)
        if block is None:
            raise EvidenceError('引用了未提供的原文段落。此段未写入，请核对来源后重新提取。')
        offset, region = block['start'], block['text']
        if not quote:
            quote = region
    if not quote or quote not in region:
        raise EvidenceError('候选引用不是所选原文的连续片段。此段未写入，请重新提取。')
    spans = [{'start': offset+m.start(), 'end': offset+m.end()}
             for m in re.finditer(re.escape(quote), region)]
    return quote, spans
