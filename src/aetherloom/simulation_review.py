"""Typed simulation sources, reusing Canon comparison/acceptance in one transaction."""
from uuid import uuid4
from . import canon
from .creation import CreationError, encoded, now
from .review_models import Decision, EventProposal, AssertionProposal
from .simulation_repository import unpack


def candidate(repo, conn, identity):
    row = conn.execute('SELECT * FROM simulation_proposals WHERE id=?', (identity,)).fetchone()
    if not row:
        raise CreationError('找不到模拟提案。',404)
    value = unpack(row)
    session = repo.session(conn, value['simulation_id'])
    event = unpack(conn.execute('SELECT * FROM simulation_events WHERE simulation_id=? AND seq=?', (session['id'],value['seq'])).fetchone())
    value.update(task_id=session['id'], source_quote=event['narration'], origin='simulation', baseline_revision=session['manifest']['setup']['expected_revision'])
    return value, session, event


def propose(repo, identity, seq, kind):
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        session = repo.session(conn, identity)
        repo.writable_world(conn, session['world_id'])
        row = conn.execute('SELECT * FROM simulation_events WHERE simulation_id=? AND seq=?', (identity,seq)).fetchone()
        if not row or not row['accepted']:
            raise CreationError('仅已提交且通过世界机制的事件可以回流。')
        event = unpack(row)
        action = event['payload']
        names = session['manifest']['entities']
        actor = event['actor_id']
        if kind == 'event':
            payload = EventProposal(type='event', title=f'{names[actor]["name"]} · {seq} · {session["title"]}',
                                    description=event['narration'], participants=[actor]+([action['target_id']] if action.get('target_id') in session['state']['agents'] else []),
                                    location_ref=event['diff'].get('agents',{}).get('before',session['state']['agents'])[actor]['location'])
        elif kind == 'assertion' and action['type'] in ('move','transfer','take','goal'):
            if action['type'] == 'move':
                payload = AssertionProposal(type='assertion',subject_ref=actor,predicate='所在地',value=names[action['target_id']]['name'],
                                            field_id='location',typed_value=action['target_id'],object_ref=action['target_id'])
            elif action['type'] in ('transfer','take'):
                holder = action['target_id'] if action['type']=='transfer' else actor
                payload = AssertionProposal(type='assertion',subject_ref=action['item_id'],predicate='持有者',value=names[holder]['name'],object_ref=holder)
            else:
                payload = AssertionProposal(type='assertion',subject_ref=actor,predicate='目标',value=action['new_goal'])
        else:
            raise CreationError('此事件没有可回流的受支持状态事实。')
        existing = conn.execute('SELECT id FROM simulation_proposals WHERE simulation_id=? AND seq=? AND kind=?', (identity,seq,kind)).fetchone()
        pid = existing[0] if existing else str(uuid4())
        if not existing:
            conn.execute('INSERT INTO simulation_proposals(id,simulation_id,seq,world_id,kind,payload,created_at) VALUES(?,?,?,?,?,?,?)',
                         (pid,identity,seq,session['world_id'],kind,encoded(payload.model_dump()),now()))
        return {'id':pid}


def preview(repo, identity):
    with repo.connection() as conn:
        conn.execute('BEGIN')
        value, session, event = candidate(repo, conn, identity)
        revision = canon.revision(conn, value['world_id'])
        return dict(candidate=value, revision=revision, baseline_stale=revision != value['baseline_revision'],
                    source={'type':'simulation','simulation_id':session['id'],'title':session['title'],'revision_id':session['revision_id'],
                            'baseline_revision':value['baseline_revision'],'seq':event['seq'],'start':session['manifest']['setup']['start_label'],
                            'event':event,'initial_state':session['initial_state']}, **repo.comparison(conn,value))


def edit(repo, identity, body):
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        value, _, _ = candidate(repo, conn, identity)
        repo.writable_world(conn,value['world_id'])
        repo.expected(value,body.version)
        if value['status'] != 'pending' or body.payload.type != value['kind']:
            raise CreationError('只能编辑未裁决提案，不能改变类型。',409)
        # Simulation sources do not claim literary extraction evidence.
        data = body.payload.model_dump()
        data.pop('subject_evidence',None)
        data['evidence'] = None
        conn.execute('UPDATE simulation_proposals SET payload=?,version=version+1 WHERE id=?', (encoded(data),identity))
    return preview(repo,identity)


def decide(repo, identity, body):
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        value, session, _ = candidate(repo,conn,identity)
        desired = 'accepted' if body.action == 'accept' else 'rejected'
        if value['status'] == desired:
            return value
        repo.writable_world(conn,value['world_id'])
        repo.expected(value,body.version)
        if value['status'] != 'pending' or canon.revision(conn,value['world_id']) != body.expected_revision:
            raise CreationError('Canon 或提案已变化，请重新比较后裁决。',409)
        if body.action == 'accept':
            if value['baseline_revision'] != body.expected_revision and not body.acknowledge_baseline:
                raise CreationError('当前 Canon 已不同于模拟基线，请明确核对差异后接受。',409)
            decision = Decision(candidate_id=identity,version=body.version,action='accept',resolution=body.resolution,
                                acknowledge_inference=body.acknowledge_inference)
            target_type, target_id = repo.accept(conn,value,decision)
            repo.save_snapshot(conn,target_type,target_id)
            conn.execute('INSERT INTO simulation_sources VALUES(?,?,?)', (target_type,target_id,identity))
            conn.execute('UPDATE simulation_proposals SET target_type=?,target_id=? WHERE id=?', (target_type,target_id,identity))
        conn.execute('UPDATE simulation_proposals SET status=?,version=version+1 WHERE id=?', (desired,identity))
        return candidate(repo,conn,identity)[0]
