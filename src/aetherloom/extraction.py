"""Page-independent extraction jobs with persistent progress and explicit retry."""
import asyncio
from uuid import uuid4

from . import canon
from .creation import CreationError, encoded
from .provider import ProviderError
from .review import decoded
from .source_evidence import EvidenceError, locate_evidence, source_blocks


def split_source(text, start, end, size=8000):
    chunks = []
    cursor = start
    while cursor < end:
        stop = min(cursor + size, end)
        if stop < end:
            paragraph = text.rfind('\n', cursor + size // 2, stop)
            if paragraph > cursor:
                stop = paragraph + 1
        chunks.append({'start': cursor, 'end': stop})
        cursor = stop
    return chunks


class ExtractionService:
    def __init__(self, repository, provider):
        self.repo, self.provider, self.running = repository, provider, {}
        with repository.connection() as conn:
            conn.execute("UPDATE extraction_tasks SET status='interrupted',error='本机服务已退出，可从上次完成的段落继续。' WHERE status IN ('queued','running')")

    def start(self, node_id, body):
        model = self.provider.settings.model
        if self.provider.settings.disabled:
            raise CreationError('当前为无付费检查模式，AI 调用已停用；资料整理与已有结果可正常查看。',409)
        if not self.provider.settings.public()['configured']:
            raise CreationError('请先填写本机 .env 的 Provider 配置。',409)
        with self.repo.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            node = self.repo.required(conn,'nodes',node_id)
            work = self.repo.required(conn,'works',node['work_id'])
            self.repo.writable_world(conn,work['world_id'])
            self.repo.expected(node,body.version)
            self.repo.validate_parent(conn,node['work_id'],node['parent_id'],node_id)
            if node['status'] != 'active' or work['status'] != 'active':
                raise CreationError('请先恢复正文和作品，再提取。',409)
            start = body.selection_start if body.selection_start is not None else 0
            end = body.selection_end if body.selection_end is not None else len(node['plain_text'])
            if start >= end or end > len(node['plain_text']):
                raise CreationError('请选择有效的正文范围。')
            active = conn.execute("SELECT id FROM extraction_tasks WHERE node_id=? AND source_version=? AND range_start=? AND range_end=? AND status IN ('queued','running')",
                                  (node_id,node['version'],start,end)).fetchone()
            if active:
                return self.repo.task(active['id'])
            identity = str(uuid4())
            conn.execute('''INSERT INTO extraction_tasks(id,world_id,node_id,source_version,baseline_revision,source_text,
                range_start,range_end,chunks,status,provider_model) VALUES(?,?,?,?,?,?,?,?,?,'queued',?)''',
                (identity,work['world_id'],node_id,node['version'],canon.revision(conn,work['world_id']),node['plain_text'],
                 start,end,encoded(split_source(node['plain_text'],start,end)),model))
        self.launch(identity)
        return self.repo.task(identity)

    def launch(self, identity):
        self.running[identity] = asyncio.create_task(self.run(identity))

    def known_entities(self, task, text):
        """Canonical identities and same-task proposals have distinct authority."""
        known = [{'id': e['id'], 'name': e['name'], 'aliases': e['aliases'], 'kind': e['kind'], 'scope': 'canon'}
                 for e in self.repo.list_entities(task['world_id']) if e['status']=='active'
                 and any(name.casefold() in text.casefold() for name in [e['name'], *e['aliases']])]
        with self.repo.connection() as conn:
            for entity in known:
                entity['predicates'] = [r[0] for r in conn.execute(
                    "SELECT DISTINCT predicate FROM assertions WHERE subject_id=? AND status='active'", (entity['id'],))]
            proposals = [decoded(r) for r in conn.execute(
                "SELECT * FROM review_candidates WHERE task_id=? AND kind='entity' AND status IN ('pending','later') ORDER BY rowid",
                (task['id'],))]
            facts = [decoded(r) for r in conn.execute(
                "SELECT * FROM review_candidates WHERE task_id=? AND kind='assertion' AND status IN ('pending','later')", (task['id'],))]
            for proposal in proposals:
                data = proposal['payload']
                if not any(name.casefold() in text.casefold() for name in [data['name'], *data['aliases']]):
                    continue
                known.append(dict(id=proposal['local_key'], name=data['name'], aliases=data['aliases'],
                                  kind=data['entity_kind'], scope='pending_task', description=data['description'],
                                  predicates=list(dict.fromkeys(f['payload']['predicate'] for f in facts
                                                               if f['payload']['subject_ref']==proposal['local_key']))))
        return known

    def record_usage(self, identity, usage):
        with self.repo.connection() as conn:
            totals = self.repo.task(identity)['usage']
            for key, value in usage.items():
                totals[key] = totals.get(key, 0) + value
            conn.execute('UPDATE extraction_tasks SET usage=? WHERE id=?', (encoded(totals), identity))

    def cancel(self, identity):
        with self.repo.connection() as conn:
            task = self.repo.task(identity)
            if task['status'] in ('queued','running'):
                conn.execute("UPDATE extraction_tasks SET status='cancelled',error='',updated_at=CURRENT_TIMESTAMP WHERE id=?",(identity,))
        future = self.running.get(identity)
        if future:
            future.cancel()
        return self.repo.task(identity)

    def retry(self, identity):
        if self.provider.settings.disabled:
            raise CreationError('当前为无付费检查模式，AI 调用已停用；资料整理与已有结果可正常查看。',409)
        with self.repo.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            task = self.repo.task(identity)
            self.repo.writable_world(conn,task['world_id'])
            if task['status'] not in ('failed','interrupted','cancelled') or identity in self.running:
                raise CreationError('只有已停止的任务可以重试。',409)
            node = self.repo.required(conn,'nodes',task['node_id'])
            work = self.repo.required(conn,'works',node['work_id'])
            self.repo.validate_parent(conn,node['work_id'],node['parent_id'],node['id'])
            if node['status']!='active' or work['status']!='active':
                raise CreationError('请先恢复正文和作品，再继续提取。',409)
            if node['version'] != task['source_version']:
                raise CreationError('正文版本已变化，请从当前正文重新提取。旧候选保留供审阅。',409)
            if task['provider_model'] != self.provider.settings.model:
                raise CreationError('模型配置已变化，请新建提取任务，保留旧任务的模型记录。',409)
            conn.execute("UPDATE extraction_tasks SET status='queued',error='',updated_at=CURRENT_TIMESTAMP WHERE id=?",(identity,))
        self.launch(identity)
        return self.repo.task(identity)

    async def run(self, identity):
        response_detail, context, index, usage = {}, {}, 0, {}
        progress_used, output_id = False, None
        try:
            with self.repo.connection() as conn:
                conn.execute("UPDATE extraction_tasks SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='queued'",(identity,))
            task = self.repo.task(identity)
            for index in range(task['completed_chunks'],len(task['chunks'])):
                part = task['chunks'][index]
                text = task['source_text'][part['start']:part['end']]
                known = self.known_entities(task, text)
                fields = self.repo.schema(task['world_id'])['fields']
                context = {'range': part, 'source_blocks': source_blocks(text), 'known_entities': known, 'fields': fields}
                if hasattr(self.provider, 'request_payload'):
                    context['request'] = self.provider.request_payload(text,known,fields)
                response_detail = {}
                usage = {}
                progress_used = hasattr(self.provider, 'extract_progress')
                output_id = str(uuid4()) if progress_used else None
                if progress_used:
                    def on_stage(detail, stage_usage):
                        # Record each returned stage before starting another paid request.
                        self.record_usage(identity, stage_usage)
                        with self.repo.connection() as conn:
                            self.save_output(conn, output_id, identity, index,
                                             {**detail, 'range': part, 'outcome': 'in_progress'})
                    response = await self.provider.extract_progress(text,known,fields,on_stage)
                else:
                    response = await self.provider.extract(text,known,fields)
                output, usage = response
                response_detail = getattr(response, 'diagnostic', {'parsed_output': output.model_dump()})
                if not progress_used:
                    self.record_usage(identity, usage)
                self.save_chunk(task,index,part,text,output,usage,known,response_detail,output_id)
            with self.repo.connection() as conn:
                conn.execute("UPDATE extraction_tasks SET status='succeeded',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running'",(identity,))
        except asyncio.CancelledError:
            pass  # cancel/shutdown set the durable state before interrupting I/O.
        except (ProviderError, CreationError) as error:
            if isinstance(error, ProviderError) and error.usage and not progress_used:
                self.record_usage(identity, error.usage)
            if isinstance(error, ProviderError):
                detail = {**context, **response_detail, **error.diagnostic, 'message': str(error),
                          'usage': error.usage or usage}
                # Persist only the model content and safe request context, never HTTP headers/vendor errors.
                raw = detail.get('raw_output')
                if isinstance(raw, str) and len(raw)>200000:
                    detail.update(raw_output=raw[:200000], output_truncated=True)
                serialized = encoded(self.redact(detail))
                with self.repo.connection() as conn:
                    conn.execute('INSERT INTO extraction_failures(id,task_id,chunk_index,detail) VALUES(?,?,?,?)',
                                 (str(uuid4()),identity,index,serialized))
                    if output_id and detail.get('protocol'):
                        self.save_output(conn, output_id, identity, index, {**detail, 'outcome': 'failed'})
            self.fail(identity,str(error) if isinstance(error,ProviderError) else error.message)
        except Exception:
            self.fail(identity,'提取任务失败。已完成段落与正文保留，可重试。')
        finally:
            self.running.pop(identity,None)

    def redact(self, value):
        secret = self.provider.settings.api_key
        if isinstance(value, str) and secret:
            return value.replace(secret, '[API_KEY_REDACTED]').replace(encoded(secret)[1:-1], '[API_KEY_REDACTED]')
        if isinstance(value, list): return [self.redact(v) for v in value]
        if isinstance(value, dict): return {k: self.redact(v) for k, v in value.items()}
        return value

    def save_output(self, conn, output_id, task_id, index, detail):
        conn.execute('''INSERT INTO extraction_outputs(id,task_id,chunk_index,detail) VALUES(?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET detail=excluded.detail''',
                     (output_id, task_id, index, encoded(self.redact(detail))))

    def save_chunk(self, task, index, part, text, output, usage, known, diagnostic=None, output_id=None):
        prefix = f'c{index}_'
        entities = {item.key for item in output.items if item.payload.type=='entity'}
        allowed = entities | {e['id'] for e in known}
        items, issues = [], []
        for item in output.items:
            try:
                quote, local_spans = locate_evidence(text, item.quote, item.source_block_id)
            except EvidenceError as error:
                issues.append({'code':'source_evidence', 'item_key':item.key,
                               'field':'source_block_id' if item.source_block_id else 'quote', 'message':str(error)})
                continue
            data = item.payload.model_dump()
            refs = [(key,data.get(key)) for key in ('subject_ref','object_ref','location_ref')]
            refs.extend((f'participants.{i}', ref) for i,ref in enumerate(data.get('participants',[])))
            for field,ref in refs:
                if ref and ref not in allowed:
                    issues.append({'code':'unknown_reference', 'item_key':item.key, 'field':field,
                                   'reference':ref, 'message':'此引用不属于本段提供的对象或输出中的实体候选。'})
            for key in ('subject_ref','object_ref','location_ref'):
                if data.get(key) in entities:
                    data[key] = prefix + data[key]
            if 'participants' in data:
                data['participants'] = [prefix + r if r in entities else r for r in data['participants']]
            spans = [{'start':part['start']+s['start'],'end':part['start']+s['end']} for s in local_spans]
            start = spans[0]['start']
            items.append((item,data,start,spans,quote))
        if issues:
            message = ('候选包含未提供的对象引用，此段未写入。请查看失败详情。'
                       if any(i['code']=='unknown_reference' for i in issues) else
                       '候选来源校验失败，此段未写入。请查看失败详情。')
            raise ProviderError(message, diagnostic={'stage':'candidates', 'issues':issues,
                                                     'allowed_references': sorted(allowed)})
        with self.repo.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            current = self.repo.task(task['id'])
            if current['status'] != 'running':
                return
            for item,data,start,spans,quote in items:
                conn.execute('''INSERT INTO review_candidates(id,task_id,world_id,node_id,source_version,source_quote,
                    source_start,source_end,baseline_revision,local_key,kind,payload,confidence,source_spans) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                    (str(uuid4()),task['id'],task['world_id'],task['node_id'],task['source_version'],quote,start,start+len(quote),
                     task['baseline_revision'],prefix+item.key,data['type'],encoded(data),item.confidence,encoded(spans)))
            conn.execute('UPDATE extraction_tasks SET completed_chunks=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
                         (index+1,task['id']))
            if diagnostic and diagnostic.get('protocol'):
                self.save_output(conn, output_id or str(uuid4()), task['id'], index,
                                 {**diagnostic, 'range': part, 'usage': usage, 'outcome': 'validated'})

    def fail(self, identity, error):
        with self.repo.connection() as conn:
            conn.execute("UPDATE extraction_tasks SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running'",(error,identity))

    async def shutdown(self):
        with self.repo.connection() as conn:
            conn.execute("UPDATE extraction_tasks SET status='interrupted',error='服务已退出，可继续提取。' WHERE status IN ('queued','running')")
        futures = list(self.running.values())
        for future in futures:
            future.cancel()
        await asyncio.gather(*futures,return_exceptions=True)
