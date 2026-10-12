"""Manual Canon authoring and identity merges, using the existing Canon transaction."""
import json
from uuid import uuid4
from . import canon
from .object_schema import schema, predicate_key

TABLES = {'assertion':'assertions','event':'canon_events','relationship':'relationship_states','entity':'entities'}

def dump(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':'))

def fail(message,status=409):
    from .creation import CreationError
    raise CreationError(message,status)

def initialize(conn):
    if conn.execute('SELECT 1 FROM schema_migrations WHERE version=4').fetchone():
        return
    conn.execute('BEGIN IMMEDIATE')
    for table, columns in {
        'entities':["core TEXT NOT NULL DEFAULT '{}'","custom_type TEXT NOT NULL DEFAULT ''","merged_into TEXT REFERENCES entities(id)"],
        'assertions':["version INTEGER NOT NULL DEFAULT 1","field_id TEXT","value_type TEXT NOT NULL DEFAULT 'text'","typed_value TEXT"],
        'canon_events':["metadata TEXT NOT NULL DEFAULT '{}'","source_note TEXT NOT NULL DEFAULT ''"],
        'relationship_states':["version INTEGER NOT NULL DEFAULT 1","strength REAL","source_note TEXT NOT NULL DEFAULT ''"],
        'temporal_relationships':["merged_into TEXT REFERENCES temporal_relationships(id)"],
    }.items():
        for column in columns:
            conn.execute(f'ALTER TABLE {table} ADD COLUMN {column}')
    conn.execute('CREATE TABLE world_fields(world_id TEXT NOT NULL REFERENCES worlds(id), key TEXT NOT NULL, definition TEXT NOT NULL, PRIMARY KEY(world_id,key))')
    conn.execute('CREATE TABLE canon_object_versions(object_type TEXT NOT NULL,object_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(object_type,object_id,version))')
    conn.execute('INSERT INTO schema_migrations VALUES(4,CURRENT_TIMESTAMP)')
    conn.commit()

class CanonManagementMixin:
    def merge_entities(self,source_id,data,dry_run=False):
        from .creation import now, inspect_document
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            source = self.required(conn,'entities',source_id)
            target = self.required(conn,'entities',data['target_id'])
            world = source['world_id']
            self.writable_world(conn,world)
            if source_id==target['id'] or world!=target['world_id'] or source['kind']!=target['kind'] or source['custom_type']!=target['custom_type']:
                fail('请选择同世界、同类型的另一个对象。',400)
            if source['status']!='active' or target['status']!='active' or source['merged_into'] or target['merged_into']:
                fail('合并双方必须是尚未合并的活跃对象。')
            self.expected(source,data['source_version'])
            self.expected(target,data['target_version'])
            if canon.revision(conn,world)!=data['expected_revision']:
                fail('世界设定已变化，请重新预览合并。')
            counts = {}
            documents = []
            for row in conn.execute('SELECT n.* FROM nodes n JOIN works w ON w.id=n.work_id WHERE w.world_id=?',(world,)):
                node = dict(row)
                doc = json.loads(node['document'])
                metadata = json.loads(node['metadata'])
                changed = False
                def remap(part):
                    nonlocal changed
                    for mark in part.get('marks',[]):
                        if mark['type']=='entityMention' and mark.get('attrs',{}).get('entityId')==source_id:
                            mark['attrs']['entityId']=target['id']
                            changed=True
                    for child in part.get('content',[]): remap(child)
                remap(doc)
                for key in ('pov_id', 'location_id'):
                    if metadata.get(key) == source_id:
                        metadata[key] = target['id']
                        changed = True
                if changed: documents.append((node,doc,metadata))
            counts['documents']=len(documents)
            for key,query,args in [
                ('facts','SELECT count(*) FROM assertions WHERE subject_id=? OR object_id=?',(source_id,source_id)),
                ('events','SELECT count(DISTINCT e.id) FROM canon_events e LEFT JOIN event_participants p ON p.event_id=e.id WHERE e.location_id=? OR p.entity_id=?',(source_id,source_id)),
                ('relationships','SELECT count(*) FROM temporal_relationships WHERE merged_into IS NULL AND (subject_id=? OR object_id=?)',(source_id,source_id)),
            ]: counts[key]=conn.execute(query,args).fetchone()[0]
            differences = []
            for key,value in source['core'].items():
                if value and target['core'].get(key) and value!=target['core'][key]:
                    differences.append({'kind':'core','field':key,'current':target['core'][key],'incoming':value})
            incoming = conn.execute("SELECT * FROM assertions WHERE subject_id=? AND status='active'",(source_id,)).fetchall()
            existing = conn.execute("SELECT * FROM assertions WHERE subject_id=? AND status='active'",(target['id'],)).fetchall()
            from .review import separated
            fields=schema(conn,world)['fields']
            for a in incoming:
                for b in existing:
                    if predicate_key(a['predicate'],fields)==predicate_key(b['predicate'],fields) and (a['value'],a['object_id'])!=(b['value'],b['object_id']) and not separated(dict(a),dict(b)):
                        differences.append({'kind':'assertion','field':a['predicate'],'current':b['value'],'incoming':a['value']})
            pairs = [dict(r) for r in conn.execute('SELECT * FROM temporal_relationships WHERE merged_into IS NULL AND (subject_id=? OR object_id=?)',(source_id,source_id))]
            direct_pairs = [p for p in pairs if {p['subject_id'],p['object_id']}=={source_id,target['id']}]
            if any(conn.execute("SELECT 1 FROM relationship_states WHERE relationship_id=? AND status='active'",(p['id'],)).fetchone() for p in direct_pairs):
                fail('双方存在有效的直接关系，合并会形成自关系。请先撤回双方之间所有有效关系状态，再重新预览；当前未改动任何引用。')
            pending = []
            for row in conn.execute("SELECT * FROM review_candidates WHERE world_id=? AND status IN ('pending','later')",(world,)):
                payload = json.loads(row['payload'])
                touched = False
                for key in ('subject_ref','object_ref','location_ref'):
                    if payload.get(key)==source_id: payload[key]=target['id'];touched=True
                if source_id in payload.get('participants',[]):
                    payload['participants']=list(dict.fromkeys(target['id'] if p==source_id else p for p in payload['participants']));touched=True
                if touched: pending.append((row['id'],payload))
            counts['pending_candidates']=len(pending)
            counts['material_sources'] = conn.execute("SELECT count(*) FROM material_sources WHERE object_type='entity' AND object_id=? AND status='active'", (source_id,)).fetchone()[0]
            result = {'source':source,'target':target,'revision':canon.revision(conn,world),'counts':counts,'differences':differences,
                      'notes':['当前正文链接将生成新版本，原文文字不改写；旧正文与已裁决候选来源保留。','事实保留全部记录；差异不会自动选择或覆盖。','关系合并同一有向对象对时，保留所有状态与来源。']}
            if dry_run:
                return result
            if differences and not data['keep_differences']:
                fail('存在差异，请在预览中明确确认保留全部事实及来源。')
            for identity in (source_id,target['id']): self.save_snapshot(conn,'entity',identity)
            # Current projections move; immutable content/history stays at its original IDs.
            affected_facts = [r[0] for r in conn.execute('SELECT id FROM assertions WHERE subject_id=? OR object_id=?',(source_id,source_id))]
            for identity in affected_facts: self.save_snapshot(conn,'assertion',identity)
            conn.execute("""UPDATE assertions SET
                subject_id=CASE WHEN subject_id=? THEN ? ELSE subject_id END,
                object_id=CASE WHEN object_id=? THEN ? ELSE object_id END,
                typed_value=CASE WHEN value_type='entity' AND object_id=? THEN ? ELSE typed_value END,
                value=CASE WHEN value_type='entity' AND object_id=? THEN ? ELSE value END,
                version=version+1 WHERE subject_id=? OR object_id=?""",
                (source_id,target['id'],source_id,target['id'],source_id,dump(target['id']),source_id,target['name'],source_id,source_id))
            for identity in affected_facts: self.save_snapshot(conn,'assertion',identity)
            affected_events = [r[0] for r in conn.execute('SELECT DISTINCT e.id FROM canon_events e LEFT JOIN event_participants p ON p.event_id=e.id WHERE e.location_id=? OR p.entity_id=?',(source_id,source_id))]
            for identity in affected_events:
                event = self.save_snapshot(conn,'event',identity)
                roles=event['metadata'].get('participant_roles',{})
                if source_id in roles:
                    previous=roles.pop(source_id)
                    roles[target['id']]=' / '.join(dict.fromkeys(v for v in [roles.get(target['id']),previous] if v))
                conn.execute('UPDATE canon_events SET location_id=CASE WHEN location_id=? THEN ? ELSE location_id END,metadata=?,version=version+1 WHERE id=?',(source_id,target['id'],dump(event['metadata']),identity))
                conn.execute('INSERT OR IGNORE INTO event_participants(event_id,entity_id) SELECT event_id,? FROM event_participants WHERE event_id=? AND entity_id=?',(target['id'],identity,source_id))
                conn.execute('DELETE FROM event_participants WHERE event_id=? AND entity_id=?',(identity,source_id))
                self.save_snapshot(conn,'event',identity)
            for pair in pairs:
                if pair in direct_pairs:
                    # Withdrawn self-relations retain original identities as historical evidence.
                    conn.execute("UPDATE temporal_relationships SET status='archived' WHERE id=?",(pair['id'],))
                    continue
                states=[r[0] for r in conn.execute('SELECT id FROM relationship_states WHERE relationship_id=?',(pair['id'],))]
                for identity in states: self.save_snapshot(conn,'relationship',identity)
                subject=target['id'] if pair['subject_id']==source_id else pair['subject_id']
                obj=target['id'] if pair['object_id']==source_id else pair['object_id']
                duplicate=conn.execute('SELECT id FROM temporal_relationships WHERE world_id=? AND subject_id=? AND object_id=?',(world,subject,obj)).fetchone()
                if duplicate:
                    conn.execute('UPDATE relationship_states SET relationship_id=?,version=version+1 WHERE relationship_id=?',(duplicate['id'],pair['id']))
                    conn.execute("UPDATE temporal_relationships SET status='merged',merged_into=? WHERE id=?",(duplicate['id'],pair['id']))
                else:
                    conn.execute('UPDATE temporal_relationships SET subject_id=?,object_id=? WHERE id=?',(subject,obj,pair['id']))
                    conn.execute('UPDATE relationship_states SET version=version+1 WHERE relationship_id=?',(pair['id'],))
                for identity in states: self.save_snapshot(conn,'relationship',identity)
            for node,doc,metadata in documents:
                text,_,_=inspect_document(doc)
                conn.execute('UPDATE nodes SET document=?,plain_text=?,metadata=?,version=version+1,updated_at=? WHERE id=?',(dump(doc),text,dump(metadata),now(),node['id']))
                self.snapshot(conn,self.required(conn,'nodes',node['id']),world)
            for identity,payload in pending:
                conn.execute('UPDATE review_candidates SET payload=?,version=version+1,edited=1 WHERE id=?',(dump(payload),identity))
            conn.execute("INSERT OR IGNORE INTO canon_sources SELECT object_type,?,candidate_id FROM canon_sources WHERE object_type='entity' AND object_id=?",(target['id'],source_id))
            conn.execute("UPDATE material_sources SET object_id=?,version=version+1 WHERE object_type='entity' AND object_id=? AND status='active'", (target['id'], source_id))
            aliases=list(dict.fromkeys([*target['aliases'],source['name'],*source['aliases']]))
            core={**source['core'],**{k:v for k,v in target['core'].items() if v}}
            sections=[*target['sections'],*source['sections']]
            if any(d['kind']=='core' for d in differences):
                labels = schema(conn,world)['core'][source['kind']]
                sections.append({'title':f"合并来源 · {source['name']}",'body':'\n'.join(f"{labels.get(k,k)}：{v}" for k,v in source['core'].items() if v)})
            if len(sections)>100 or len(aliases)>100: fail('合并后的说明或别名超出编辑容量，请先整理后再合并。')
            conn.execute('UPDATE entities SET aliases=?,sections=?,core=?,version=version+1,updated_at=? WHERE id=?',(dump([s for s in aliases if s!=target['name']]),dump(sections),dump(core),now(),target['id']))
            conn.execute("UPDATE entities SET status='deleted',merged_into=?,version=version+1,updated_at=? WHERE id=?",(target['id'],now(),source_id))
            self.save_snapshot(conn,'entity',source_id); self.save_snapshot(conn,'entity',target['id'])
            canon.changed(conn,world,'entity',target['id'],{'action':'merge','source_id':source_id,'counts':counts,'differences':differences})
            return {**result,'revision':canon.revision(conn,world),'target':self.required(conn,'entities',target['id'])}

    def canonical_entity(self,conn,identity,world=None,active=False):
        entity = self.required(conn,'entities',identity)
        seen = set()
        while entity.get('merged_into'):
            if entity['id'] in seen:
                fail('对象合并引用形成循环。')
            seen.add(entity['id'])
            entity = self.required(conn,'entities',entity['merged_into'])
        if world and entity['world_id'] != world:
            fail('引用必须属于同一世界。',400)
        if active and entity['status'] != 'active':
            fail('请先恢复引用对象。')
        return entity

    def schema(self,world):
        self.get(world)
        with self.connection() as conn:
            return schema(conn,world)

    def define_field(self,world,data):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            self.writable_world(conn,world)
            fields = schema(conn,world)['fields']
            names = {v.casefold() for f in fields for v in [f['key'],f['label'],*f['aliases']]}
            proposed = [data['key'],data['label'],*data['aliases']]
            if any(n.casefold() in names for n in proposed):
                fail('字段标识、名称或别名已存在，请使用已有字段。',400)
            conn.execute('INSERT INTO world_fields VALUES(?,?,?)',(world,data['key'],dump(data)))
            canon.changed(conn,world,'field',data['key'],data)
            return data

    def object_snapshot(self,conn,kind,identity):
        item = self.required(conn,TABLES[kind],identity)
        if kind == 'event':
            item['participants'] = [r[0] for r in conn.execute('SELECT entity_id FROM event_participants WHERE event_id=?',(identity,))]
        if kind == 'relationship':
            pair = self.required(conn,'temporal_relationships',item['relationship_id'])
            item.update(world_id=pair['world_id'],subject_id=pair['subject_id'],object_id=pair['object_id'])
        item['sources'] = [r[0] for r in conn.execute('SELECT candidate_id FROM canon_sources WHERE object_type=? AND object_id=?',(kind,identity))]
        return item

    def save_snapshot(self,conn,kind,identity):
        item = self.object_snapshot(conn,kind,identity)
        conn.execute('INSERT OR IGNORE INTO canon_object_versions(object_type,object_id,version,payload) VALUES(?,?,?,?)',
                     (kind,identity,item['version'],dump(item)))
        return item

    def object_history(self,kind,identity):
        if kind not in TABLES:
            fail('记录类型无效。',400)
        with self.connection() as conn:
            current = self.object_snapshot(conn,kind,identity)
            versions = [dict(r) for r in conn.execute('SELECT version,payload,saved_at FROM canon_object_versions WHERE object_type=? AND object_id=? ORDER BY version DESC',(kind,identity))]
            for version in versions:
                version['payload'] = json.loads(version['payload'])
            if not any(v['version']==current['version'] for v in versions):
                versions.insert(0,{'version':current['version'],'payload':current,'saved_at':current.get('created_at') if current['version']==1 else None})
            return versions

    def normalize_fact(self,conn,entity,data):
        fields = schema(conn,entity['world_id'])['fields']
        definition = next((f for f in fields if f['key']==data.get('field_id')),None)
        if data.get('field_id') and not definition:
            fail('扩展字段不存在。',400)
        result = dict(data)
        if not definition:
            if not result.get('value'):
                fail('请输入事实内容。',400)
            result.update(value_type='text',typed_value=result['value'])
        else:
            if definition['kinds'] and entity['kind'] not in definition['kinds']:
                fail('字段不适用于当前对象类型。',400)
            value,kind = result.get('typed_value'),definition['value_type']
            valid = {'text':isinstance(value,str) and bool(value.strip()),
                     'number':type(value) in (int,float), 'boolean':type(value) is bool,
                     'entity':isinstance(value,str) and bool(value),
                     'tags':isinstance(value,list) and all(isinstance(v,str) and v.strip() for v in value)}[kind]
            if not valid:
                fail('事实内容与字段类型不符。',400)
            result['value_type'] = kind
            if kind == 'entity':
                target = self.canonical_entity(conn,value,entity['world_id'],True)
                result.update(object_id=target['id'],typed_value=target['id'],value=target['name'])
            else:
                result['value'] = ('是' if value else '否') if kind=='boolean' else '、'.join(value) if kind=='tags' else str(value)
        if result.get('object_id'):
            result['object_id'] = self.canonical_entity(conn,result['object_id'],entity['world_id'],True)['id']
        return result

    def edit_fact(self,identity,data):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            old = self.required(conn,'assertions',identity)
            entity = self.canonical_entity(conn,old['subject_id'],old['world_id'],True)
            self.writable_world(conn,old['world_id'])
            self.expected(old,data['version'])
            if old['status'] != 'active':
                fail('请先恢复已撤回事实；已替代事实请新增修订。')
            value = self.normalize_fact(conn,entity,data)
            self.save_snapshot(conn,'assertion',identity)
            conn.execute('UPDATE assertions SET predicate=?,value=?,object_id=?,valid_from=?,valid_until=?,source_note=?,field_id=?,value_type=?,typed_value=?,version=version+1 WHERE id=?',
                         (*[value.get(k) for k in ('predicate','value','object_id','valid_from','valid_until','source_note','field_id','value_type')],dump(value['typed_value']),identity))
            canon.changed(conn,old['world_id'],'assertion',identity,{'action':'edit','before':old,'after':value})
            return self.save_snapshot(conn,'assertion',identity)

    def set_record_status(self,kind,identity,data):
        if kind not in ('assertion','event','relationship'):
            fail('记录类型无效。',400)
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            old = self.object_snapshot(conn,kind,identity)
            self.writable_world(conn,old['world_id'])
            self.expected(old,data['version'])
            if kind=='assertion':
                self.canonical_entity(conn,old['subject_id'],old['world_id'],True)
            if kind=='relationship' and data['status']=='active':
                subject=self.canonical_entity(conn,old['subject_id'],old['world_id'],True)
                target=self.canonical_entity(conn,old['object_id'],old['world_id'],True)
                if subject['id']==target['id']:
                    fail('该历史关系的双方已合并，不能恢复为有效自关系。')
            if old['status']=='superseded':
                fail('已被替代的历史请新增修订，不能恢复为当前事实。')
            self.save_snapshot(conn,kind,identity)
            conn.execute(f'UPDATE {TABLES[kind]} SET status=?,version=version+1 WHERE id=?',(data['status'],identity))
            canon.changed(conn,old['world_id'],kind,identity,{'action':data['status']})
            return self.save_snapshot(conn,kind,identity)

    def validate_event(self,conn,world,data,identity=None):
        participants = list(dict.fromkeys(self.canonical_entity(conn,p,world,True)['id'] for p in data['participants']))
        location = self.canonical_entity(conn,data['location_id'],world,True) if data['location_id'] else None
        if location and location['kind']!='location':
            fail('事件地点必须是地点对象。',400)
        causes = list(dict.fromkeys(data['causes']))
        for event_id in causes:
            event = self.required(conn,'canon_events',event_id)
            if event['world_id']!=world or event['status']!='active' or event_id==identity:
                fail('前因必须是同世界的其他有效事件。',400)
            seen,pending = set(),[event_id]
            while pending:
                cursor = pending.pop()
                if cursor==identity:
                    fail('事件因果不能形成循环。',400)
                if cursor not in seen:
                    seen.add(cursor)
                    pending.extend(self.required(conn,'canon_events',cursor)['metadata'].get('causes',[]))
        roles = {self.canonical_entity(conn,key,world,True)['id']:role for key,role in data['participant_roles'].items()}
        return participants,location['id'] if location else None,{'causes':causes,'participant_roles':roles,'before_state':data['before_state'],'after_state':data['after_state']}

    def write_event(self,world,data,identity=None):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            self.writable_world(conn,world)
            if identity:
                old = self.required(conn,'canon_events',identity)
                if old['world_id']!=world: fail('事件不属于当前世界。',400)
                self.expected(old,data['version'])
                if old['status']!='active': fail('请先恢复事件。')
                self.save_snapshot(conn,'event',identity)
            participants,location,metadata = self.validate_event(conn,world,data,identity)
            if identity:
                conn.execute('UPDATE canon_events SET title=?,description=?,location_id=?,valid_from=?,valid_until=?,metadata=?,source_note=?,version=version+1 WHERE id=?',
                             (data['title'],data['description'],location,data['valid_from'],data['valid_until'],dump(metadata),data['source_note'],identity))
                conn.execute('DELETE FROM event_participants WHERE event_id=?',(identity,))
            else:
                identity = str(uuid4())
                conn.execute('INSERT INTO canon_events(id,world_id,title,description,location_id,valid_from,valid_until,metadata,source_note) VALUES(?,?,?,?,?,?,?,?,?)',
                             (identity,world,data['title'],data['description'],location,data['valid_from'],data['valid_until'],dump(metadata),data['source_note']))
            conn.executemany('INSERT INTO event_participants VALUES(?,?)',[(identity,p) for p in participants])
            canon.changed(conn,world,'event',identity,data)
            return self.save_snapshot(conn,'event',identity)

    def write_relationship(self,world,data,identity=None):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            self.writable_world(conn,world)
            subject = self.canonical_entity(conn,data['subject_id'],world,True)['id']
            target = self.canonical_entity(conn,data['object_id'],world,True)['id']
            if subject==target: fail('关系两端必须不同。',400)
            if identity:
                old = self.object_snapshot(conn,'relationship',identity)
                if old['world_id']!=world: fail('关系不属于当前世界。',400)
                self.expected(old,data['version'])
                if old['status']!='active': fail('请先恢复关系状态。')
                if (subject,target)!=(old['subject_id'],old['object_id']):
                    fail('稳定关系的两端不能改写，请创建另一关系。',400)
                self.save_snapshot(conn,'relationship',identity)
                conn.execute('UPDATE relationship_states SET label=?,description=?,valid_from=?,valid_until=?,strength=?,source_note=?,version=version+1 WHERE id=?',
                             (data['label'],data['description'],data['valid_from'],data['valid_until'],data['strength'],data['source_note'],identity))
            else:
                pair = conn.execute('SELECT id FROM temporal_relationships WHERE world_id=? AND subject_id=? AND object_id=?',(world,subject,target)).fetchone()
                pair_id = pair['id'] if pair else str(uuid4())
                if not pair: conn.execute('INSERT INTO temporal_relationships(id,world_id,subject_id,object_id) VALUES(?,?,?,?)',(pair_id,world,subject,target))
                identity = str(uuid4())
                conn.execute('INSERT INTO relationship_states(id,relationship_id,label,description,valid_from,valid_until,strength,source_note) VALUES(?,?,?,?,?,?,?,?)',
                             (identity,pair_id,data['label'],data['description'],data['valid_from'],data['valid_until'],data['strength'],data['source_note']))
            canon.changed(conn,world,'relationship',identity,data)
            return self.save_snapshot(conn,'relationship',identity)
