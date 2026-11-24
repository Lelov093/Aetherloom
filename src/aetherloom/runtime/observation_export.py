"""Portable creator notes over committed evidence; no AI or domain writes."""
from urllib.parse import urlencode, quote

from . import review
from .domain import RuntimeFault


def export(store, world, line, seq):
    review.require(store)
    with store.connection() as conn:
        conn.execute('PRAGMA query_only=ON')
        conn.execute('BEGIN')
        if store.identity(line)['world_id'] != world:
            raise RuntimeFault('scope_mismatch')
        event, _, after, manifest, baseline, _, _, text = review.evidence(
            store, conn, line, seq, require_accepted=False)
        title = (manifest or {}).get('title') or '世界线观察'
        route = f'/worlds/{quote(world, safe="")}/simulate/runtime?' + urlencode(dict(line=line, seq=seq))
        roles = {item['id']: item.get('name', item['id']) for item in (manifest or {}).get('setup', {}).get('roles', [])}
        places = {item['id']: item.get('name', item['id']) for item in (manifest or {}).get('setup', {}).get('places', [])}
        source = dict(world_id=world, worldline_id=line, seq=seq, event_id=event['event_id'],
            baseline_id=after.baseline_id, canon_revision=baseline['canon_revision'],
            logical_tick=after.sim_time_tick, accepted=event['accepted'], action_type=event['action_type'], route=route,
            actor_id=event.get('actor_id'), actor_name=roles.get(event.get('actor_id'), event.get('actor_id')),
            location_id=event.get('location_id'), location_name=places.get(event.get('location_id'), event.get('location_id')))
        markdown = '\n'.join([
            f'# {title} · 第{seq}步观察', '',
            '这是创作观察笔记，不是正式设定；保存或导出不写入 Canon。', '',
            '## 来源', '', *(f'- {key}: {value}' for key, value in source.items()),
            f'- 工作区定位（应用内路径）: {route}', '',
            '来源固定在上述世界线与已提交事件；当前作品修改不会重写该来源。', '',
            '## 当时记录', '', text, '',
            '## 我的创作想法', '', '可在这里记录值得保留的情境、疑问或改编方向。', '',
            '## 后续决定', '', '是否改写作品、保存灵感或提出正式设定候选，由创作者另行决定。', '',
        ])
        return dict(filename=f'aetherloom-observation-{seq}-{event["event_id"]}.md',
            markdown=markdown, summary=text, source=source)


def export_many(store, world, line, seqs):
    """Combine committed observations while retaining every event's provenance."""
    selected = sorted(set(seqs))
    if not selected:
        raise RuntimeFault('inspiration_events_required')
    notes = [export(store, world, line, seq) for seq in selected]
    first = notes[0]
    events = [dict(note['source'], summary=note['summary']) for note in notes]
    source = dict(first['source'], event_count=len(events), events=events)
    title = '批量世界线观察'
    markdown = '\n'.join([
        f'# {title}', '',
        '这是创作观察笔记，不是正式设定；保存或导出不写入 Canon。', '',
        '## 来源事件', '',
        *[f'- 第{event["seq"]}步 · {event.get("actor_name") or event.get("actor_id")} · {event.get("location_name") or "地点未知"}' for event in events], '',
        '## 当时记录', '',
        *[f'### 第{event["seq"]}步\n\n{event["summary"]}\n' for event in events],
        '## 我的创作想法', '', '可在这里记录值得保留的情境、疑问或改编方向。', '',
        '## 后续决定', '', '是否改写作品、保存灵感或提出正式设定候选，由创作者另行决定。', '',
    ])
    return dict(filename=f'aetherloom-observation-batch-{line}-{selected[0]}-{selected[-1]}.md',
        markdown=markdown, summary='\n\n'.join(event['summary'] for event in events), source=source)
