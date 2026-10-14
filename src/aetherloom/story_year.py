"""Read-only year projection. Missing bounds are unknown, never infinity.

This does not change Review's conflict rules or infer a story calendar.
"""
import re

YEAR = re.compile(r'(?:Year\s*)?(-?\d{1,6})(?:\s*年)?', re.I)


def year(value):
    match = YEAR.fullmatch((value or '').strip())
    return int(match[1]) if match else None


def timing(start, end):
    first, last = year(start), year(end)
    if first is not None and last is not None:
        kind = 'invalid' if first > last else 'dated'
    else:
        kind = 'partial' if first is not None or last is not None else 'undated'
    return dict(start=first, end=last, certainty=kind)


def match(start, end, lower=None, upper=None):
    value = timing(start, end)
    if value['certainty'] in ('invalid', 'undated'):
        return value['certainty']
    if ((upper is not None and value['start'] is not None and value['start'] > upper)
            or (lower is not None and value['end'] is not None and value['end'] < lower)):
        return 'outside'
    return value['certainty']


def validate_range(lower, upper):
    from .creation import CreationError
    if lower is not None and upper is not None and lower > upper:
        raise CreationError('起始年份不能晚于结束年份。', 400)


def register(conn):
    conn.create_function('story_match', 4, match, deterministic=True)
    conn.create_function('story_year', 1, year, deterministic=True)
