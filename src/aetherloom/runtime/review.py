"""V2 evidence adapter into the existing human Canon comparison/accept transaction."""
import json
from uuid import uuid4

from aetherloom import canon
from aetherloom.creation import CreationError, encoded, now
from aetherloom.review_models import Decision, EventProposal, AssertionProposal
from . import history, transcript
from .domain import RuntimeFault


def require(store):
    if not history.available(store): raise RuntimeFault('history_migration_required')


def describe_ruling(event, names):
    ruling = event['ruling']

    def name(key):
        return names.get(key, key)

    if ruling['kind'] == 'attempt':
        attempt = ruling['attempt']
        action = attempt['action']
        verb = {'move': '进入', 'take': '拾取', 'transfer': '转交'}[action['kind']]
        target = name(action.get('destination_id') or action.get('item_id'))
        intent = f'{name(attempt["actor_id"])}尝试{verb}「{target}」'
        if action['kind'] == 'transfer':
            intent += f'给{name(action["recipient_id"])}'
        decision = '规则允许' if event['accepted'] else '规则拒绝'
        if ruling['required_items']:
            decision += '，进入须持有' + '、'.join(map(name, ruling['required_items']))
        elif event['reason_code']:
            decision += f'（{event["reason_code"]}）'
        unchanged = f'{name(attempt["actor_id"])}仍在{name(ruling["location_id"])}' if action['kind'] == 'move' else '物品归属保持原状'
    else:
        detail = ruling['conflict']['detail']
        intent = (f'{"、".join(name(claim["actor_id"]) for claim in detail["claims"])}同时尝试拾取「{name(detail["item_id"])}」'
                  if detail['kind'] == 'item' else detail['description'])
        decision = {'pending': '暂停等待作者', 'blocked': '规则拒绝', 'rules': '仅一位符合规则',
                    'draw': '同条件抽签', 'chosen': '作者选定符合规则的参与者', 'cancelled': '作者搁置'}[ruling['result']]
        if ruling['winner_id']:
            decision += f'，由{name(ruling["winner_id"])}取得'
        if ruling['draw_index'] is not None:
            decision += f'（第 {ruling["draw_index"] + 1} 个抽签位）'
        unchanged = f'物品仍在{name(detail["holder_id"])}' if detail['kind'] == 'item' else '待处理的后果未生效'

    consequences = []
    for effect in transcript.ruling_effects(event):
        label = (f'{name(effect["entity_id"])}的位置' if effect['op'] == 'agent_location_set'
                 else f'{name(effect["item_id"])}的归属')
        consequences.append(f'{label} · {name(effect["before"])} → {name(effect["after"])}')
    return '\n'.join([f'作者意图 · {intent}。{event["reason"]}', f'实际裁决 · {decision}',
                      '后果 · ' + ('、'.join(consequences) if consequences else unchanged)])


def evidence(store, conn, line, seq, *, require_accepted=True):
    row = conn.execute('SELECT payload FROM runtime_v2_journal WHERE worldline_id=? AND seq=?', (line, seq)).fetchone()
    if not row: raise RuntimeFault('event_unavailable')
    event = json.loads(row[0])
    if require_accepted and not event['accepted']:
        raise CreationError('仅成立的已提交事件可以建立提案。')
    before, after = store._read_at(conn, line, seq - 1), store._read_at(conn, line, seq)
    manifest = store.scenario(line, conn=conn)
    baseline = json.loads(conn.execute('SELECT b.manifest FROM runtime_v2_baselines b JOIN runtime_v2_baseline_links l ON b.id=l.baseline_id WHERE l.worldline_id=?', (line,)).fetchone()[0])
    names = {s['source_id']: s['snapshot'].get('name', s['source_id']) for s in baseline['sources'] if s['kind'] == 'entity'}
    bindings = {key: key for key in set(before.agents) | set(before.world.place_topology) | set(before.world.items) if key in names}
    if manifest:
        for group in ('roles', 'places', 'items'):
            for item in manifest['setup'][group]:
                names[item['id']] = item['name']
                if item.get('entity_id'): bindings[item['id']] = item['entity_id']
    actor, action = event['actor_id'], event['action_type']
    args = event.get('command', {}).get('args', {})
    text = next((op['evidence']['text'] for op in event['effects'] if op['op'] == 'memory_append'), '')
    label = names.get(actor, actor) or '世界'
    if event.get('ruling'): text = describe_ruling(event, names)
    elif not event['accepted']: text = f'{label}尝试{action}，被规则拒绝（{event.get("reason_code") or "条件未满足"}）；预期行动未成立。'
    elif action == 'move': text = f"{label}从{names.get(before.agents[actor].location, before.agents[actor].location)}前往{names.get(after.agents[actor].location, after.agents[actor].location)}。"
    elif action == 'goal': text = f'{label}调整目标：{after.agents[actor].goal}'
    elif action in ('take', 'transfer'):
        op = next(op for op in event['effects'] if op['op'] == 'item_holder_set')
        text = f"{names.get(op['item_id'], op['item_id'])}的持有者：{names.get(op['before'], op['before'])} → {names.get(op['after'], op['after'])}"
    elif action == 'speak': text = f'{label}说：{args.get("speech", text)}（说法不自动成为世界事实）'
    elif action == 'read': text = f'{label}阅读了{names.get(args["item_id"],args["item_id"])}的冻结文本；内容不自动成为世界事实。'
    elif action == 'compare': text = f'{label}核对已知文本片段：{text}；仅为字面比较，不证明内容为真。'
    elif action == 'cognition':
        text = f'{label}修订暂定信念／计划；这是主观认知变化，不是所相信内容已成真。'
        if after.social:
            own=after.social.agents[actor]
            prior=before.social.agents[actor]
            if own.cognition:
                for change in own.cognition.changes:
                    if change.memory_ref == 'memory:' + str(len(before.agents[actor].memories)):
                        text += f' {"信念" if change.kind == "belief" else "计划"}：{change.before or "无"} → {change.after or "已撤回"}；本人理由：{change.reason}。'
            for target,judgment in own.appraisals.items():
                if judgment != prior.appraisals.get(target): text += f' 对{names.get(target,target)}的主观看法：{judgment.judgment}。'
    elif not text: text = f'{label} · {action} · {args}'
    if event.get('kind') == 'creator_intervention' and not event.get('ruling'):
        text = '【创作者干预】' + event.get('reason', '') + '；' + text
    return event, before, after, manifest, baseline, names, bindings, text


def propose(store, repo, world, line, seq, kind):
    require(store)
    with store.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        event, before, after, manifest, baseline, names, bindings, text = evidence(store, conn, line, seq)
        if after.world_id != world: raise RuntimeFault('scope_mismatch')
        repo.writable_world(conn, world)
        if not event['accepted']: raise CreationError('仅成立的已提交事件可以建立提案。')
        existing = conn.execute('SELECT id FROM runtime_v2_review WHERE worldline_id=? AND seq=? AND kind=?', (line, seq, kind)).fetchone()
        if existing: return {'id': existing[0]}
        def ref(slot): return bindings.get(slot, 'runtime:' + slot)
        actor, action = event['actor_id'], event['action_type']
        if kind == 'event':
            participants = [ref(actor)] if actor else []
            recipient = event.get('command', {}).get('args', {}).get('recipient_id')
            if recipient: participants.append(ref(recipient))
            place = before.agents[actor].location if actor else event.get('command', {}).get('args', {}).get('place_id')
            payload = EventProposal(type='event', title=f'{names.get(actor, actor) or "世界"} · {seq} · {(manifest or {}).get("title", line)}'[:160],
                                    description=text[:4000], participants=participants, location_ref=ref(place) if place else None)
        elif kind == 'assertion' and action in ('move', 'take', 'transfer', 'goal', 'relocate'):
            if action in ('move', 'relocate'):
                op = next(op for op in event['effects'] if op['op'] == 'agent_location_set')
                payload = AssertionProposal(type='assertion', subject_ref=ref(op['entity_id']), predicate='所在地', value=names.get(op['after'], op['after']),
                                            field_id='location', typed_value=ref(op['after']), object_ref=ref(op['after']))
            elif action == 'goal':
                payload = AssertionProposal(type='assertion', subject_ref=ref(actor), predicate='目标', value=after.agents[actor].goal)
            else:
                op = next(op for op in event['effects'] if op['op'] == 'item_holder_set')
                payload = AssertionProposal(type='assertion', subject_ref=ref(op['item_id']), predicate='持有者', value=names.get(op['after'], op['after']), object_ref=ref(op['after']))
        else: raise CreationError('此提交没有受支持的世界事实；对话、报告和信念不能自动转正。')
        identity = 'rv2_' + str(uuid4())
        conn.execute('INSERT INTO runtime_v2_review(id,worldline_id,seq,world_id,kind,payload,bindings,created_at) VALUES(?,?,?,?,?,?,?,?)',
                     (identity, line, seq, world, kind, encoded(payload.model_dump()), encoded(bindings), now()))
        conn.commit()
        return {'id': identity}


def candidate(store, conn, identity, world):
    row = conn.execute('SELECT * FROM runtime_v2_review WHERE id=? AND world_id=?', (identity, world)).fetchone()
    if not row: raise CreationError('找不到此世界的模拟提案。', 404)
    value = dict(row)
    value['payload'], value['bindings'] = json.loads(value['payload']), json.loads(value['bindings'])
    source = evidence(store, conn, value['worldline_id'], value['seq'])
    value.update(simulation_id=value['worldline_id'], task_id=value['worldline_id'], source_quote=source[-1], origin='simulation', baseline_revision=source[4]['canon_revision'])
    return value, source


def preview_in(store, repo, conn, identity, world):
    value, (event, before, after, manifest, baseline, names, bindings, text) = candidate(store, conn, identity, world)
    revision = canon.revision(conn, world)
    entities = {s['source_id']: s['snapshot'] for s in baseline['sources'] if s['kind'] == 'entity'}
    for slot, name in names.items(): entities.setdefault('runtime:' + slot, {'name': name})
    diff = {'agents': {'before': {key: a.model_dump() for key, a in before.agents.items()}, 'after': {key: a.model_dump() for key, a in after.agents.items()}},
            'items': {'before': before.world.items, 'after': after.world.items}, 'tick': {'before': before.sim_time_tick, 'after': after.sim_time_tick}}
    if after.social: diff['social']={'before':before.social.model_dump(),'after':after.social.model_dump()}
    source = {'type': 'runtime_v2', 'engine_version': after.engine_version, 'simulation_id': after.worldline_id,
              'title': (manifest or {}).get('title', after.worldline_id), 'purpose': (manifest or {}).get('purpose', 'unclassified'),
              'seq': event['seq'], 'baseline_revision': baseline['canon_revision'], 'revision_id': baseline['baseline_id'],
              'start': '冻结起点 ' + baseline['baseline_id'], 'time_basis': '逻辑 tick 不等于原作日期；正式有效时间须人工确认。',
              'event': {**event, 'narration': text, 'diff': diff, 'payload': event.get('command', {})},
              'entities': entities, 'bindings': value['bindings'], 'lineage': after.lineage.model_dump() if after.lineage else None}
    comparison = repo.comparison(conn, value)
    if source['purpose'] != 'original_projection':
        comparison['warnings'].append('模板平行世界／实验结果：请核对原作身份与改编；模板规则和布景不会自动纳入 Canon。')
    comparison['requires_evidence_confirmation'] = True
    return dict(candidate=value, revision=revision, baseline_stale=revision != baseline['canon_revision'], source=source, **comparison)


def preview(store, repo, identity, world):
    require(store)
    with store.connection() as conn:
        conn.execute('BEGIN')
        return preview_in(store, repo, conn, identity, world)


def listing(store, repo, world):
    if not history.available(store): return []
    with store.connection() as conn:
        conn.execute('BEGIN')
        ids = [r[0] for r in conn.execute('SELECT id FROM runtime_v2_review WHERE world_id=? ORDER BY created_at DESC', (world,))]
        return [preview_in(store, repo, conn, identity, world) for identity in ids]


def edit(store, repo, identity, world, body):
    require(store)
    with store.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        value, _ = candidate(store, conn, identity, world)
        repo.writable_world(conn, world)
        repo.expected(value, body.version)
        if value['status'] != 'pending' or body.payload.type != value['kind']: raise CreationError('只能编辑未裁决提案，类型不能改变。', 409)
        payload = body.payload.model_dump()
        payload.pop('subject_evidence', None)
        payload['evidence'] = None
        conn.execute('UPDATE runtime_v2_review SET payload=?,version=version+1 WHERE id=?', (encoded(payload), identity))
        conn.commit()
    return preview(store, repo, identity, world)


def decide(store, repo, identity, world, body, *, hook=lambda stage: None):
    require(store)
    with store.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        value, _ = candidate(store, conn, identity, world)
        desired = 'accepted' if body.action == 'accept' else 'rejected'
        if value['status'] == desired: return value
        repo.writable_world(conn, world)
        repo.expected(value, body.version)
        if value['status'] != 'pending' or canon.revision(conn, world) != body.expected_revision:
            raise CreationError('Canon 或提案已变化，请重新比较后裁决。', 409)
        if body.action == 'accept':
            if not body.acknowledge_inference: raise CreationError('请明确核对模拟来源、用途与身份后接受。', 409)
            if value['baseline_revision'] != body.expected_revision and not body.acknowledge_baseline:
                raise CreationError('Canon 已不同于冻结基线，请重新核对。', 409)
            target_type, target_id = repo.accept(conn, value, Decision(candidate_id=identity, version=body.version, action='accept',
                                            resolution=body.resolution, acknowledge_inference=True))
            hook('canon_saved')
            repo.save_snapshot(conn, target_type, target_id)
            conn.execute('INSERT INTO runtime_v2_review_sources VALUES(?,?,?)', (target_type, target_id, identity))
            conn.execute('UPDATE runtime_v2_review SET target_type=?,target_id=? WHERE id=?', (target_type, target_id, identity))
        conn.execute('UPDATE runtime_v2_review SET status=?,version=version+1 WHERE id=?', (desired, identity))
        hook('before_commit')
        conn.commit()
        return candidate(store, conn, identity, world)[0]


def sources(store, world, kind, identity):
    if not history.available(store): return []
    with store.connection() as conn:
        result = [dict(r) for r in conn.execute('''SELECT p.id,p.worldline_id AS simulation_id,p.seq,p.world_id
            FROM runtime_v2_review_sources s JOIN runtime_v2_review p ON p.id=s.proposal_id
            WHERE s.object_type=? AND s.object_id=? AND p.world_id=?''', (kind, identity, world))]
        for item in result:
            item['title'] = (store.scenario(item['simulation_id'], conn=conn) or {}).get('title', item['simulation_id'])
        return result


def frozen_sources(conn, world):
    """Preserve accepted V2 provenance when another scene freezes Working Canon.

    Read saved rows only; this must also work with Runtime execution disabled.
    """
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_v2_review_sources'").fetchone(): return []
    rows = conn.execute('''SELECT s.*,p.worldline_id,p.seq,p.payload AS proposal_payload,p.bindings,
        j.payload AS event_payload,w.initial,b.manifest AS baseline,sc.manifest AS scenario
        FROM runtime_v2_review_sources s JOIN runtime_v2_review p ON p.id=s.proposal_id
        JOIN runtime_v2_journal j ON j.worldline_id=p.worldline_id AND j.seq=p.seq
        JOIN runtime_v2_worldlines w ON w.id=p.worldline_id
        JOIN runtime_v2_baseline_links l ON l.worldline_id=w.id JOIN runtime_v2_baselines b ON b.id=l.baseline_id
        LEFT JOIN runtime_v2_scenarios sc ON sc.worldline_id=w.id WHERE p.world_id=?''', (world,))
    return [{**dict(row), 'lineage': json.loads(row['initial']).get('lineage')} for row in rows]
