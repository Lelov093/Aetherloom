"""Persistent candidates and transactional, explicitly requested Canon decisions."""
import json
import re
from uuid import uuid4

from . import canon
from .creation import CreationError, CreationRepository, encoded, now, record
from .object_schema import predicate_key, schema
from .proposal_evidence import numeric_value_error


def decoded(row):
    result = dict(row)
    for key in ('payload', 'usage', 'chunks','source_spans'):
        if key in result:
            result[key] = json.loads(result[key])
    return result


def references(payload):
    return [ref for ref in [payload.get('subject_ref'), payload.get('object_ref'),
                           payload.get('location_ref'), *payload.get('participants', [])] if ref]


def year(value):
    """Compare only explicit whole years; never infer dates from arbitrary prose."""
    match = re.fullmatch(r'(?:Year\s*)?(-?\d{1,6})(?:\s*年)?', value or '', re.I)
    return int(match[1]) if match else None


def separated(a, b):
    left = (year(a.get('valid_from')), year(a.get('valid_until')))
    right = (year(b.get('valid_from')), year(b.get('valid_until')))
    return ((left[1] is not None and right[0] is not None and left[1] < right[0])
            or (right[1] is not None and left[0] is not None and right[1] < left[0]))


class ReviewRepository(CreationRepository):
    def candidate(self, conn, identity):
        row = conn.execute('SELECT * FROM review_candidates WHERE id=?', (identity,)).fetchone()
        if not row:
            raise CreationError('找不到此审阅候选。', 404)
        return decoded(row)

    def task(self, identity):
        with self.connection() as conn:
            row = conn.execute('SELECT * FROM extraction_tasks WHERE id=?', (identity,)).fetchone()
            if not row:
                raise CreationError('找不到此提取任务。', 404)
            return decoded(row)

    def listing(self, world_id):
        self.get(world_id)
        with self.connection() as conn:
            candidates = [decoded(r) for r in conn.execute('''SELECT c.*,n.title AS source_title,n.version AS current_source_version,w.title AS work_title,w.id AS work_id
                FROM review_candidates c JOIN nodes n ON n.id=c.node_id JOIN works w ON w.id=n.work_id
                WHERE c.world_id=? ORDER BY c.created_at,c.rowid''', (world_id,))]
            for candidate in candidates:
                comparison = self.comparison(conn,candidate)
                candidate['source_stale'] = candidate['source_version'] != candidate['current_source_version']
                candidate['priority'] = ('blocking' if candidate['source_stale'] else 'important'
                    if comparison['conflicts'] or comparison['warnings'] or comparison['identity_matches'] else
                    'low' if candidate['confidence']<0.6 else 'normal')
            tasks = [decoded(r) for r in conn.execute('''SELECT id,node_id,source_version,status,error,provider_model,
                usage,completed_chunks,json_array_length(chunks) AS total_chunks,created_at,updated_at,
                (SELECT COUNT(*) FROM extraction_failures f WHERE f.task_id=extraction_tasks.id) AS failure_count
                FROM extraction_tasks WHERE world_id=? ORDER BY created_at DESC,rowid DESC''', (world_id,))]
            return {'revision': canon.revision(conn, world_id), 'candidates': candidates, 'tasks': tasks}

    def extraction_failures(self, identity):
        task = self.task(identity)
        with self.connection() as conn:
            failures = [{**dict(row), 'detail': json.loads(row['detail'])} for row in conn.execute(
                'SELECT * FROM extraction_failures WHERE task_id=? ORDER BY rowid DESC', (identity,))]
        return {'task_id': identity, 'source_version': task['source_version'], 'model': task['provider_model'],
                'failures': failures}

    def extraction_outputs(self, identity):
        task = self.task(identity)
        with self.connection() as conn:
            outputs = [{**dict(row), 'detail': json.loads(row['detail'])} for row in conn.execute(
                'SELECT * FROM extraction_outputs WHERE task_id=? ORDER BY rowid', (identity,))]
        return {'task_id': identity, 'source_version': task['source_version'], 'model': task['provider_model'],
                'outputs': outputs}

    def source(self, conn, candidate):
        node = self.required(conn, 'nodes', candidate['node_id'])
        work = self.required(conn, 'works', node['work_id'])
        original = self.history(candidate['node_id'], candidate['source_version'])
        from .creation_models import inspect_document
        text, _, _ = inspect_document(original['document'])
        start, end = candidate['source_start'], candidate['source_end']
        spans = candidate['source_spans'] or [{'start':start,'end':end}]
        archived = node['status'] != 'active' or work['status'] != 'active'
        cursor = node['parent_id']
        while cursor:
            parent = self.required(conn, 'nodes', cursor)
            archived = archived or parent['status'] != 'active'
            cursor = parent['parent_id']
        return {'title': original['title'], 'work_id': work['id'], 'work_title': work['title'],
                'version': candidate['source_version'], 'current_version': node['version'],
                'stale': node['version'] != candidate['source_version'], 'archived': archived,
                'quote': candidate['source_quote'], 'context': text[max(0,start-300):end+300],
                'occurrence_count':len(spans), 'contexts':[text[max(0,s['start']-100):s['end']+100] for s in spans[:20]],
                'current_text': node['plain_text'], 'start': start, 'end': end}

    def resolve(self, conn, candidate, ref):
        row = conn.execute("SELECT * FROM entities WHERE id=? AND world_id=?",
                           (ref, candidate['world_id'])).fetchone()
        if row:
            entity=self.canonical_entity(conn,ref,candidate['world_id'])
            return entity if entity['status']=='active' else None
        proposal = conn.execute('''SELECT target_id FROM review_candidates WHERE task_id=? AND local_key=?
            AND kind='entity' AND status IN ('accepted','merged')''', (candidate['task_id'], ref)).fetchone()
        if proposal and proposal['target_id']:
            row = conn.execute("SELECT * FROM entities WHERE id=? AND world_id=?",
                               (proposal['target_id'], candidate['world_id'])).fetchone()
            if row:
                entity=self.canonical_entity(conn,proposal['target_id'],candidate['world_id'])
                return entity if entity['status']=='active' else None
        return None

    def comparison(self, conn, candidate):
        data, kind = candidate['payload'], candidate['kind']
        current, conflicts, dependencies = [], [], []
        warnings = []
        if data.get('evidence') and data['evidence']['quote'] not in candidate['source_quote']:
            warnings.append('候选对应的原文依据不在当前引用内，请重新核对来源与候选内容。')
        if kind == 'assertion' and data['value'] not in candidate['source_quote']:
            warnings.append('事实内容未直接出现在引用中，可能包含推断、计算或改写。请与原文核对。')
        subject_evidence = data.get('subject_evidence') if kind == 'assertion' else None
        if subject_evidence:
            if subject_evidence['mention'] not in (data.get('evidence') or {}).get('quote', ''):
                warnings.append('主体词不在此属性的独立依据中，请核对主体与来源。')
            if subject_evidence['basis'] == 'coreference':
                warnings.append('此属性主体依赖代词或别名连接。请核对主体词、连接依据与所指人物；来源字面匹配不证明共指正确。')
            if subject_evidence.get('link_quote'):
                original = self.history(candidate['node_id'], candidate['source_version'])
                from .creation_models import inspect_document
                if subject_evidence['link_quote'] not in inspect_document(original['document'])[0]:
                    warnings.append('主体连接依据不在当前引用版本正文中，请核对来源，不沿用旧连接。')
        if kind == 'relationship' and data['label'] not in candidate['source_quote']:
            warnings.append('关系状态未逐字出现在引用中，可能包含推断或改写。请核对关系含义。')
        identity_matches = []
        if kind == 'entity':
            names = {data['name'].casefold(), *(s.casefold() for s in data['aliases'])}
            current = [record(r) for r in conn.execute("SELECT * FROM entities WHERE world_id=? AND status='active'", (candidate['world_id'],))
                       if names.intersection({r['name'].casefold(), *(s.casefold() for s in json.loads(r['aliases']))})]
            identities = [('canon', r['id'], r['name'], r['kind'], r['aliases']) for r in current]
            for row in conn.execute("""SELECT id,payload FROM review_candidates WHERE task_id=? AND id!=?
                AND kind='entity' AND status IN ('pending','later')""", (candidate['task_id'],candidate['id'])):
                other = json.loads(row['payload'])
                identities.append(('candidate',row['id'],other['name'],other['entity_kind'],other['aliases']))
            for scope, identity, name, entity_kind, aliases in identities:
                matched = list(dict.fromkeys(n for n in [name,*aliases] if n.casefold() in names))
                if matched:
                    identity_matches.append({'scope':scope,'id':identity,'name':name,'kind':entity_kind,
                        'aliases':aliases,'matched_names':matched,'same_kind':entity_kind==data['entity_kind']})
        resolved = {ref: self.resolve(conn, candidate, ref) for ref in references(data)}
        # A valid supplied ID can still be a model's arbitrary choice for a shared name.
        # Same-task references already resolved by explicit identity Review keep that decision.
        for ref, entity in resolved.items():
            if not entity or ref != entity['id']:
                continue
            others = [{**dict(r),'aliases':json.loads(r['aliases'])} for r in conn.execute(
                "SELECT id,name,aliases FROM entities WHERE world_id=? AND kind=? AND status='active' AND id!=?",
                (candidate['world_id'],entity['kind'],entity['id']))]
            quote = candidate['source_quote'].casefold()
            for name in dict.fromkeys([entity['name'], *entity['aliases']]):
                if name.casefold() not in quote:
                    continue
                matches = [e['name'] for e in others if name.casefold() in
                           {n.casefold() for n in [e['name'], *e['aliases']]}]
                if matches:
                    warnings.append(f'引用「{name}」同时对应 {"、".join([entity["name"],*matches])}。'
                                    f'当前候选指向「{entity["name"]}」，请核对身份或编辑引用；不会自动选择或合并。')
        mapping = None
        if kind == 'assertion' and data.get('field_id'):
            fields = schema(conn,candidate['world_id'])['fields']
            definition = next((f for f in fields if f['key']==data['field_id']),None)
            mapping = {'field_id':data['field_id'], 'label':definition['label'] if definition else data['field_id'],
                       'value_type':definition['value_type'] if definition else None,
                       'typed_value':data.get('typed_value'), 'value':data['value'], 'error':None}
            try:
                subject = resolved.get(data['subject_ref'])
                subject_kind = subject['kind'] if subject else None
                if not subject:
                    proposed = conn.execute("SELECT payload FROM review_candidates WHERE task_id=? AND local_key=? AND kind='entity'",
                                            (candidate['task_id'],data['subject_ref'])).fetchone()
                    if proposed: subject_kind = json.loads(proposed['payload'])['entity_kind']
                self.validate_candidate_field(data,fields,subject_kind)
                typed = data.get('typed_value')
                if definition['value_type']=='number': mapping['value'] = str(typed)
                elif definition['value_type']=='boolean': mapping['value'] = '是' if typed else '否'
                elif definition['value_type']=='tags': mapping['value'] = '、'.join(typed)
                elif definition['value_type']=='text':
                    mapping.update(typed_value=data['value'] if typed is None else typed,
                                   value=data['value'] if typed is None else typed)
            except CreationError as error:
                mapping['error'] = error.message
                warnings.append(error.message)
            if resolved.get(data['subject_ref']) and (not data.get('object_ref') or resolved.get(data['object_ref'])):
                try:
                    value = self.candidate_fact(conn,candidate)
                    mapping.update(typed_value=value['typed_value'],value=value['value'])
                except CreationError as error:
                    mapping['error'] = error.message
                    if error.message not in warnings: warnings.append(error.message)
        for ref, value in resolved.items():
            if not value:
                proposed = conn.execute('SELECT id,payload,status FROM review_candidates WHERE task_id=? AND local_key=?',
                                        (candidate['task_id'], ref)).fetchone()
                dependencies.append({'ref': ref, 'candidate_id': proposed['id'] if proposed else None,
                                     'name': json.loads(proposed['payload']).get('name', ref) if proposed else ref})
        if kind == 'assertion' and resolved.get(data['subject_ref']):
            subject = resolved[data['subject_ref']]['id']
            fields=schema(conn,candidate['world_id'])['fields']
            current = [dict(r) for r in conn.execute("SELECT * FROM assertions WHERE subject_id=? AND status='active'",(subject,))
                       if predicate_key(r['predicate'],fields)==predicate_key(data['predicate'],fields)]
            comparison_value = mapping['value'] if mapping and not mapping['error'] else data['value']
            conflicts = [r for r in current if (r['value'] != comparison_value or r['object_id'] != (resolved.get(data.get('object_ref')) or {}).get('id')) and not separated(r, data)]
        if kind == 'relationship' and not dependencies:
            pair = conn.execute('SELECT id FROM temporal_relationships WHERE world_id=? AND subject_id=? AND object_id=?',
                                (candidate['world_id'], resolved[data['subject_ref']]['id'], resolved[data['object_ref']]['id'])).fetchone()
            if pair:
                current = [dict(r) for r in conn.execute("SELECT * FROM relationship_states WHERE relationship_id=? AND status='active'", (pair['id'],))]
                conflicts = [r for r in current if r['label'] != data['label'] and not separated(r, data)]
        if kind == 'event':
            current = [dict(r) for r in conn.execute("SELECT * FROM canon_events WHERE world_id=? AND title=? AND status='active'", (candidate['world_id'], data['title']))]
        for item in current:
            source_type = 'relationship' if kind == 'relationship' else kind
            item['sources'] = [dict(r) for r in conn.execute('''SELECT c.id,c.node_id,c.source_version,c.source_quote
                FROM canon_sources s JOIN review_candidates c ON c.id=s.candidate_id
                WHERE s.object_type=? AND s.object_id=?''', (source_type, item['id']))]
        return {'current': current, 'conflicts': conflicts, 'dependencies': dependencies,
                'identity_matches':identity_matches,
                'warnings':warnings, 'requires_evidence_confirmation':bool(warnings), 'field_mapping':mapping,
                'affected_entities': list({v['id']:v for v in resolved.values() if v}.values()),
                'temporal_change': bool(current and any(separated(r, data) for r in current))}

    def preview(self, identity):
        with self.connection() as conn:
            conn.execute('BEGIN')
            candidate = self.candidate(conn, identity)
            return {'candidate': candidate, 'revision': canon.revision(conn, candidate['world_id']),
                    'source': self.source(conn, candidate), **self.comparison(conn, candidate)}

    def edit_candidate(self, identity, body):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            candidate = self.candidate(conn, identity)
            self.writable_world(conn, candidate['world_id'])
            self.expected(candidate, body.version)
            if candidate['status'] not in ('pending', 'later'):
                raise CreationError('仅待处理或稍后处理的候选可编辑。', 409)
            if body.payload.type != candidate['kind']:
                raise CreationError('编辑不能改变候选类型。')
            conn.execute('UPDATE review_candidates SET payload=?,edited=1,version=version+1 WHERE id=?',
                         (encoded(body.payload.model_dump()), identity))
            return self.candidate(conn, identity)

    def recheck(self, identity, body):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            candidate = self.candidate(conn, identity)
            self.writable_world(conn, candidate['world_id'])
            self.expected(candidate, body.version)
            if candidate['status'] not in ('pending', 'later'):
                raise CreationError('已裁决候选保留原始来源，不可重绑定。', 409)
            node = self.required(conn, 'nodes', candidate['node_id'])
            self.expected(node, body.source_version)
            if body.quote not in node['plain_text']:
                raise CreationError('当前正文不包含此引用，请明确修正引用或重新提取。', 409)
            start = node['plain_text'].index(body.quote)
            spans = [{'start':m.start(),'end':m.end()} for m in re.finditer(re.escape(body.quote),node['plain_text'])]
            conn.execute('''UPDATE review_candidates SET source_version=?,source_quote=?,source_start=?,source_end=?,
                source_spans=?,baseline_revision=?,version=version+1,edited=1 WHERE id=?''',
                (node['version'],body.quote,start,start+len(body.quote),encoded(spans),canon.revision(conn,candidate['world_id']),identity))
            return self.candidate(conn, identity)

    def apply(self, world_id, body, dry_run=False):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            self.writable_world(conn, world_id)
            if len({d.candidate_id for d in body.decisions}) != len(body.decisions):
                raise CreationError('同一候选不能在一次裁决中重复出现。')
            pairs = [(self.candidate(conn, d.candidate_id), d) for d in body.decisions]
            if any(c['world_id'] != world_id for c, _ in pairs):
                raise CreationError('裁决对象必须属于当前世界。')
            statuses = {'accept':'accepted','merge':'merged','reject':'rejected','ignore':'ignored','later':'later'}
            # A repeated terminal request is idempotent, even after Canon revision advanced.
            if all(c['status'] == statuses[d.action] and c['status'] != 'later' for c,d in pairs):
                return {'revision': canon.revision(conn,world_id), 'candidates':[c for c,_ in pairs]}
            if canon.revision(conn, world_id) != body.expected_revision:
                raise CreationError('Canon 已变化，请重新打开比较预览后裁决。', 409)
            pairs.sort(key=lambda pair: pair[0]['kind'] != 'entity')
            if len(pairs)>1:
                for candidate, decision in pairs:
                    if candidate['kind']=='entity' and decision.action=='accept' and decision.resolution!='keep_both':
                        if any(m['scope']=='candidate' for m in self.comparison(conn,candidate)['identity_matches']):
                            raise CreationError('同任务存在名称或别名重叠的身份候选，请先逐项确认身份，再合并或明确保持分离。',409)
            merge_effects = []
            for candidate, decision in pairs:
                self.expected(candidate, decision.version)
                if candidate['status'] not in ('pending', 'later'):
                    raise CreationError('候选已裁决，请重新载入。', 409)
                target_type, target_id = None, None
                if decision.action in ('accept', 'merge'):
                    source = self.source(conn, candidate)
                    if source['stale'] or source['archived']:
                        raise CreationError('正文来源已变化或收起。请先重新核对当前引用，或恢复文档。', 409)
                    if decision.action=='merge' and candidate['kind']=='entity':
                        entity, aliases = self.merge_identity(conn,candidate,decision.target_id)
                        dependents = [r['id'] for r in conn.execute("SELECT id,payload FROM review_candidates WHERE task_id=? AND status IN ('pending','later')",
                            (candidate['task_id'],)) if candidate['local_key'] in references(json.loads(r['payload']))]
                        merge_effects.append({'candidate_id':candidate['id'],'target_id':entity['id'],
                            'target_name':entity['name'],'target_kind':entity['kind'],
                            'added_aliases':[a for a in aliases if a not in entity['aliases']],
                            'dependent_candidate_ids':dependents})
                    target_type, target_id = self.accept(conn, candidate, decision)
                    conn.execute('INSERT OR IGNORE INTO canon_sources VALUES(?,?,?)', (target_type,target_id,candidate['id']))
                conn.execute('''UPDATE review_candidates SET status=?,target_type=?,target_id=?,version=version+1 WHERE id=?''',
                             (statuses[decision.action],target_type,target_id,candidate['id']))
            result = {'revision':canon.revision(conn,world_id),
                      'merge_effects':merge_effects,
                      'candidates':[self.candidate(conn,c['id']) for c,_ in pairs]}
            if dry_run:
                conn.rollback()
            return result

    def merge_identity(self, conn, candidate, target_id):
        entity = self.required(conn,'entities',target_id)
        data = candidate['payload']
        if entity['world_id']!=candidate['world_id'] or entity['status']!='active' or entity['kind']!=data['entity_kind']:
            raise CreationError('合并目标必须是同一世界、同类型的活跃对象。')
        aliases, seen = [], {entity['name'].casefold()}
        for alias in [*entity['aliases'],data['name'],*data['aliases']]:
            if alias.casefold() not in seen:
                aliases.append(alias)
                seen.add(alias.casefold())
        return entity, aliases

    def accept(self, conn, candidate, decision):
        data, kind, world = candidate['payload'], candidate['kind'], candidate['world_id']
        comparison = self.comparison(conn, candidate)
        if comparison['requires_evidence_confirmation'] and not decision.acknowledge_inference:
            raise CreationError('候选包含可能的推断或改写，请明确核对证据后再接受。',409)
        if comparison['dependencies']:
            raise CreationError('请先裁决被引用的对象候选，或编辑引用到已确认对象。', 409)
        if decision.action == 'merge' and kind != 'entity':
            raise CreationError('当前合并用于身份消歧，请单独裁决其他类型。')
        if kind == 'entity':
            if decision.action == 'merge':
                entity, aliases = self.merge_identity(conn,candidate,decision.target_id)
                conn.execute('UPDATE entities SET aliases=?,version=version+1,updated_at=? WHERE id=?', (encoded(aliases),now(),entity['id']))
                canon.changed(conn,world,kind,entity['id'],{'aliases':aliases,'action':'merge_candidate'})
                return kind, entity['id']
            if comparison['current'] and decision.resolution != 'keep_both':
                raise CreationError('发现同名或别名对象，请合并或明确选择保持分离。', 409)
            identity = str(uuid4())
            conn.execute('INSERT INTO entities(id,world_id,name,kind,aliases,sections,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
                         (identity,world,data['name'],data['entity_kind'],encoded(data['aliases']),encoded([{'title':'概述','body':data['description']}]),now(),now()))
        elif kind == 'assertion':
            subject = self.resolve(conn,candidate,data['subject_ref'])['id']
            object_id = self.resolve(conn,candidate,data['object_ref'])['id'] if data['object_ref'] else None
            value = self.candidate_fact(conn,candidate)
            duplicate = next((r for r in comparison['current'] if r['value']==value['value'] and r['object_id']==object_id
                              and r['field_id']==value.get('field_id')
                              and r['valid_from']==data['valid_from'] and r['valid_until']==data['valid_until']),None)
            if duplicate:
                return kind,duplicate['id']
            self.resolve_conflicts(conn,comparison,decision,'assertions',world,kind)
            identity = str(uuid4())
            conn.execute('INSERT INTO assertions(id,world_id,subject_id,predicate,value,object_id,valid_from,valid_until,source_note,created_at,field_id,value_type,typed_value) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                         (identity,world,subject,data['predicate'],value['value'],object_id,data['valid_from'],data['valid_until'],
                          '已显式接受的模拟提案' if candidate.get('origin')=='simulation' else '已显式接受的正文候选',now(),value.get('field_id'),value['value_type'],encoded(value['typed_value'])))
        elif kind == 'event':
            if comparison['current'] and decision.resolution != 'keep_both':
                raise CreationError('已有同名事件，请核对并明确保持为另一事件，或忽略此候选。',409)
            identity = str(uuid4())
            location = self.resolve(conn,candidate,data['location_ref']) if data['location_ref'] else None
            if location and location['kind'] != 'location':
                raise CreationError('事件地点必须引用地点对象。')
            conn.execute('INSERT INTO canon_events(id,world_id,title,description,location_id,valid_from,valid_until,source_note) VALUES(?,?,?,?,?,?,?,?)',
                         (identity,world,data['title'],data['description'],location['id'] if location else None,data['valid_from'],data['valid_until'],
                          '已显式接受的模拟提案' if candidate.get('origin')=='simulation' else '已显式接受的正文候选'))
            conn.executemany('INSERT INTO event_participants VALUES(?,?)',
                             [(identity, ref) for ref in {self.resolve(conn,candidate,r)['id'] for r in data['participants']}])
        else:
            subject, object_id = (self.resolve(conn,candidate,data[ref])['id'] for ref in ('subject_ref','object_ref'))
            if subject == object_id:
                raise CreationError('关系两端必须是不同对象。')
            pair = conn.execute('SELECT id FROM temporal_relationships WHERE world_id=? AND subject_id=? AND object_id=?', (world,subject,object_id)).fetchone()
            relationship_id = pair['id'] if pair else str(uuid4())
            if not pair:
                conn.execute('INSERT INTO temporal_relationships(id,world_id,subject_id,object_id) VALUES(?,?,?,?)', (relationship_id,world,subject,object_id))
            duplicate = next((r for r in comparison['current'] if r['label']==data['label'] and r['description']==data['description']
                              and r['valid_from']==data['valid_from'] and r['valid_until']==data['valid_until']),None)
            if duplicate:
                return kind,duplicate['id']
            self.resolve_conflicts(conn,comparison,decision,'relationship_states',world,kind)
            identity = str(uuid4())
            conn.execute('INSERT INTO relationship_states(id,relationship_id,label,description,valid_from,valid_until) VALUES(?,?,?,?,?,?)',
                         (identity,relationship_id,data['label'],data['description'],data['valid_from'],data['valid_until']))
        canon.changed(conn,world,kind,identity,data)
        return kind,identity

    def candidate_fact(self, conn, candidate):
        """Resolve and validate a proposed field without changing the candidate or Canon."""
        data = candidate['payload']
        entity = self.resolve(conn,candidate,data['subject_ref'])
        if not entity:
            raise CreationError('请先解决事实主体身份。',409)
        fields = schema(conn,candidate['world_id'])['fields']
        definition = self.validate_candidate_field(data,fields,entity['kind'])
        object_entity = self.resolve(conn,candidate,data['object_ref']) if data.get('object_ref') else None
        fact = {**data,'object_id':object_entity['id'] if object_entity else None}
        # Copying a text value is lossless; never guess numbers, booleans, tags or units.
        if definition and definition['value_type']=='text' and data.get('typed_value') is None:
            fact['typed_value'] = data['value']
        if definition and definition['value_type']=='entity':
            if not object_entity:
                raise CreationError('对象类型字段必须引用已解决的世界对象。',409)
            fact['typed_value'] = object_entity['id']
        return self.normalize_fact(conn,entity,fact)

    def validate_candidate_field(self, data, fields, subject_kind=None):
        definition = next((f for f in fields if f['key']==data.get('field_id')),None)
        if data.get('field_id') and not definition:
            raise CreationError('映射字段不存在，请编辑候选。',400)
        if definition and predicate_key(data['predicate'],fields)!=definition['key']:
            raise CreationError('属性名称与映射字段不一致，请编辑候选。',400)
        if definition and subject_kind and definition['kinds'] and subject_kind not in definition['kinds']:
            raise CreationError('此字段不适用于事实主体类型，请编辑候选。',400)
        if definition:
            kind,value = definition['value_type'],data.get('typed_value')
            valid = {'text':value is None or isinstance(value,str) and bool(value.strip()),
                     'number':type(value) in (int,float), 'boolean':type(value) is bool,
                     'entity':bool(data.get('object_ref')),
                     'tags':isinstance(value,list) and all(isinstance(v,str) and v.strip() for v in value)}[kind]
            if not valid: raise CreationError('事实内容与字段类型不符。',400)
            error = numeric_value_error(data,definition)
            if error: raise CreationError(error,400)
        return definition

    def resolve_conflicts(self, conn, comparison, decision, table, world, kind):
        conflicts = comparison['conflicts']
        if conflicts and decision.resolution not in ('replace','keep_both'):
            raise CreationError('存在时间重叠或未知时间的差异。请明确替换旧事实，或保留双方待后续整理。',409)
        if decision.resolution == 'replace':
            for item in conflicts:
                self.save_snapshot(conn,kind,item['id'])
                conn.execute(f"UPDATE {table} SET status='superseded',version=version+1 WHERE id=?",(item['id'],))
                self.save_snapshot(conn,kind,item['id'])
                canon.changed(conn,world,kind,item['id'],{'status':'superseded'})

    def records(self, world_id, entity_id=None):
        self.get(world_id)
        with self.connection() as conn:
            events = [record(r) for r in conn.execute('SELECT * FROM canon_events WHERE world_id=?',(world_id,))]
            for event in events:
                event['participants'] = [r[0] for r in conn.execute('SELECT entity_id FROM event_participants WHERE event_id=?',(event['id'],))]
            relations = [dict(r) for r in conn.execute('SELECT * FROM temporal_relationships WHERE world_id=? AND merged_into IS NULL',(world_id,))]
            for relation in relations:
                relation['states'] = [dict(r) for r in conn.execute('SELECT * FROM relationship_states WHERE relationship_id=?',(relation['id'],))]
            if entity_id:
                events = [e for e in events if entity_id in e['participants'] or entity_id == e['location_id']]
                relations = [r for r in relations if entity_id in (r['subject_id'],r['object_id'])]
            for kind,items in [('event',events),('relationship',[s for r in relations for s in r['states']])]:
                for item in items:
                    item['sources'] = [r[0] for r in conn.execute('SELECT candidate_id FROM canon_sources WHERE object_type=? AND object_id=?',(kind,item['id']))]
            return {'events':events,'relationships':relations}
