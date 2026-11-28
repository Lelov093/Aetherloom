"""Portable creator notes over committed evidence; no AI or domain writes."""
from urllib.parse import urlencode, quote

from . import review
from .domain import RuntimeFault


def frozen_sources(world, line, seq, manifest):
    path = f'/worlds/{quote(world, safe="")}/create/source?'
    return [
        dict(title=material['title'], work_title=material['work_title'], version=material['version'],
             purpose=material['purpose'], route=path + urlencode(dict(worldline=line, index=index, seq=seq)))
        for index, material in enumerate(manifest.get('materials', []))
    ]


def material_references(materials):
    if not materials:
        return []
    return [
        '## 冻结资料', '',
        *(f'- {material["work_title"]} / {material["title"]} · v{material["version"]} · '
          f'`{material["route"]}`' for material in materials), '',
    ]


def export(store, world, line, seq):
    review.require(store)
    with store.connection() as conn:
        conn.execute('PRAGMA query_only=ON')
        conn.execute('BEGIN')
        if store.identity(line)['world_id'] != world:
            raise RuntimeFault('scope_mismatch')
        event, before, after, manifest, baseline, names, _, text = review.evidence(
            store, conn, line, seq, require_accepted=False)
        manifest = manifest or {}
        title = manifest.get('title') or '世界线观察'
        route = f'/worlds/{quote(world, safe="")}/simulate?' + urlencode(dict(line=line, seq=seq))
        setup = manifest.get('setup', {})
        materials = frozen_sources(world, line, seq, manifest)
        actor_id = event.get('actor_id')
        actor = before.agents.get(actor_id)
        location_id = event.get('location_id') or (actor.location if actor else None)
        source = dict(world_id=world, worldline_id=line, seq=seq, event_id=event['event_id'],
            baseline_id=after.baseline_id, canon_revision=baseline['canon_revision'],
            logical_tick=after.sim_time_tick, accepted=event['accepted'], action_type=event['action_type'], route=route,
            actor_id=actor_id, actor_name=names.get(actor_id, actor_id),
            location_id=location_id, location_name=names.get(location_id, location_id))
        markdown = '\n'.join([
            f'# {title} · 第{seq}步观察', '',
            '创作观察笔记 · 用于保存灵感与写作参考。', '',
            '## 来源', '', *(f'- {key}: {value}' for key, value in source.items() if key != 'route'),
            f'- 工作区定位（应用内路径）: {route}', '',
            *material_references(materials),
            '## 当时记录', '', text, '',
            '## 我的创作想法', '', '可在这里记录值得保留的情境、疑问或改编方向。', '',
        ])
        return dict(filename=f'aetherloom-observation-{seq}-{event["event_id"]}.md',
            markdown=markdown, summary=text, source=source, materials=materials,
            origin_node_id=setup.get('origin_node_id'))


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
        '创作观察笔记 · 用于保存灵感与写作参考。', '',
        '## 来源事件', '',
        *[f'- 第{event["seq"]}步 · {event.get("actor_name") or event.get("actor_id")} · {event.get("location_name") or "地点未知"}' for event in events], '',
        *material_references(first['materials']),
        '## 当时记录', '',
        *[f'### 第{event["seq"]}步\n\n{event["summary"]}\n' for event in events],
        '## 我的创作想法', '', '可在这里记录值得保留的情境、疑问或改编方向。', '',
    ])
    return dict(filename=f'aetherloom-observation-batch-{line}-{selected[0]}-{selected[-1]}.md',
        markdown=markdown, summary='\n\n'.join(event['summary'] for event in events), source=source,
        materials=first['materials'], origin_node_id=first['origin_node_id'])
