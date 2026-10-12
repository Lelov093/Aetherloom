"""Content import is independent of AI extraction. Originals remain local assets."""

import json
import asyncio
from collections import defaultdict, deque
from pathlib import Path
from typing import Literal
from uuid import uuid4
from fastapi import APIRouter, UploadFile, Request, HTTPException, Form
from fastapi.responses import FileResponse, Response
from pydantic import Field, model_validator
from .creation import CreationError, now, encoded
from .creation_models import Model, WorkKind, NodeCreate, MaterialCategory, inspect_document, validate_metadata
from .import_formats import parse_file, text_document, markdown_document
from .import_ocr import capabilities, recognize_page, render_page

router = APIRouter(prefix='/api')
_recognizing = set()


class OcrRequest(Model):
    language: str = Field(min_length=2,max_length=40)
    rotation: Literal[0,90,180,270] = 0


class ImportPageRef(Model):
    file_index: int = Field(ge=0)
    page: int = Field(ge=0)


@router.get('/imports/ocr-capabilities')
def ocr_capabilities():
    return capabilities()


class ImportChapter(Model):
    key: str = Field(default_factory=lambda:str(uuid4()), min_length=1, max_length=80)
    parent_key: str | None = Field(default=None, max_length=80)
    title: str = Field(min_length=1, max_length=160)
    text: str = Field(max_length=2000000)
    kind: str = Field(default='chapter', min_length=1, max_length=40)
    format: str = Field(default='text', pattern='^(text|markdown|document)$')
    document: dict | None = None
    source_file: str = Field(default='', max_length=300)
    source_files: list[str] = Field(default_factory=list, max_length=100)
    source_pages: list[ImportPageRef] = Field(default_factory=list, max_length=3000)
    category: MaterialCategory = 'unclassified'
    tags: list[str] = Field(default_factory=list, max_length=30)

    @model_validator(mode='after')
    def validate_content(self):
        validate_metadata({'material_category': self.category, 'material_tags': json.dumps(self.tags)})
        if self.format=='document':
            if self.document is None:
                raise ValueError('富文本正文缺失。')
            if inspect_document(self.document)[0].strip()!=self.text.strip():
                raise ValueError('正文预览已变化，请同步富文本后重试。')
        elif self.document is not None:
            raise ValueError('请明确选择文本或富文本格式，不能同时提供两份不同正文。')
        return self


class ImportPageReview(ImportPageRef):
    resolution: Literal['text_layer', 'corrected']


class ImportCommit(Model):
    title: str = Field(min_length=1, max_length=160)
    kind: WorkKind = 'novel'
    chapters: list[ImportChapter] = Field(min_length=1, max_length=3000)
    acknowledged: bool = False
    page_reviews: list[ImportPageReview] = Field(default_factory=list, max_length=3000)

    @model_validator(mode='after')
    def validate_hierarchy(self):
        entries = {c.key:c for c in self.chapters}
        if len(entries)!=len(self.chapters):
            raise ValueError('内容标识不能重复。')
        complete = set()
        for chapter in self.chapters:
            cursor, path = chapter.key, set()
            while cursor and cursor not in complete:
                if cursor not in entries:
                    raise ValueError('父目录不在当前导入中。')
                if cursor in path:
                    raise ValueError('导入层级不能形成循环。')
                path.add(cursor)
                cursor = entries[cursor].parent_key
            complete.update(path)
        return self


def read_batch(repo, world, batch_id):
    try:
        batch_id = str(__import__('uuid').UUID(batch_id))
    except ValueError:
        raise HTTPException(404, '找不到导入预览。')
    folder = repo.path.parent / 'imports' / batch_id
    path = folder / 'preview.json'
    if not path.exists():
        raise HTTPException(404, '找不到导入预览。')
    batch = json.loads(path.read_text(encoding='utf-8'))
    if batch['world_id'] != world:
        raise HTTPException(404, '找不到导入预览。')
    return folder, batch


def batch_info(repo, world, batch_id):
    folder, batch = read_batch(repo, world, batch_id)
    with repo.connection() as conn:
        saved = conn.execute('SELECT work_id FROM import_commits WHERE batch_id=?', (batch['id'],)).fetchone()
    return dict(id=batch['id'], warnings=batch['warnings'], blocked=batch['blocked'],
                work_id=saved[0] if saved else None,
                files=[dict(name=f['name'], revision_view=f.get('revision_view'),
                            url=f"/api/worlds/{world}/imports/{batch['id']}/files/{index}") for index,f in enumerate(batch['files'])])


@router.get('/worlds/{world_id}/imports/{batch_id}')
def source_info(world_id:str, batch_id:str, request:Request):
    repo = request.app.state.creation
    repo.get(world_id)
    return batch_info(repo, world_id, batch_id)


@router.get('/worlds/{world_id}/imports/{batch_id}/files/{index}')
def source_file(world_id:str, batch_id:str, index:int, request:Request):
    repo = request.app.state.creation
    repo.get(world_id)
    folder, batch = read_batch(repo, world_id, batch_id)
    if index<0 or index>=len(batch['files']):
        raise HTTPException(404, '找不到原始附件。')
    original = batch['files'][index]
    path = (folder / original['asset']).resolve()
    if not path.is_relative_to(folder.resolve()) or not path.is_file():
        raise HTTPException(404, '找不到原始附件。')
    return FileResponse(path, filename=original['name'])


@router.get('/worlds/{world_id}/imports/{batch_id}/pages/{file_index}/{page}')
def source_page(world_id:str, batch_id:str, file_index:int, page:int, request:Request):
    """Render the preserved PDF locally for comparison, independently of OCR."""
    from io import BytesIO
    from PIL import Image
    repo=request.app.state.creation
    repo.get(world_id)
    folder,batch=read_batch(repo,world_id,batch_id)
    if not any(p['file_index']==file_index and p['page']==page for p in batch.get('ocr_pages',[])):
        raise HTTPException(404,'找不到待核对的原页。')
    size,pixels=render_page((folder/batch['files'][file_index]['asset']).read_bytes(),page)
    with Image.frombytes('RGBA',size,pixels,'raw','BGRA') as image:
        stream=BytesIO();image.save(stream,format='PNG')
    return Response(stream.getvalue(),media_type='image/png')


@router.post('/worlds/{world_id}/imports/preview')
async def preview(world_id: str, request: Request, files: list[UploadFile],
                  docx_revision_view: Literal['final','original'] | None = Form(default=None)):
    repo = request.app.state.creation
    repo.get(world_id)
    if len(files) > 100:
        raise HTTPException(422, '一次最多导入 100 个文件。')
    names = [Path(file.filename or '未命名.txt').name for file in files]
    if len({name.casefold() for name in names}) != len(names):
        raise HTTPException(422, '同一批次包含重复文件名，请先改为不同名称，以便明确保留每章的原件来源。')
    batch_id = str(uuid4())
    folder = repo.path.parent / 'imports' / batch_id
    folder.mkdir(parents=True)
    batch = {'id': batch_id, 'world_id': world_id, 'chapters': [], 'warnings': [], 'blocked': False, 'files': [], 'ocr_pages':[]}
    for index, file in enumerate(files):
        raw = await file.read(25 * 1024 * 1024 + 1)
        if len(raw) > 25 * 1024 * 1024:
            raise HTTPException(422, '单个附件最多 25 MB，请拆分后导入。')
        name = Path(file.filename or '未命名.txt').name
        try:
            parsed = parse_file(name, raw,docx_revision_view)
        except CreationError:
            raise
        except Exception:
            raise HTTPException(422, f'无法读取「{name}」，请检查文件是否损坏或加密。')
        (folder / f'{index}{Path(name).suffix}').write_bytes(raw)
        batch['files'].append({'name': name, 'asset': f'{index}{Path(name).suffix}',
            'warnings':parsed['warnings'],'blocked':parsed['blocked'],'revision_view':parsed['revision_view']})
        batch['ocr_pages'].extend(dict(**page,file_index=index) for page in parsed['ocr_pages'])
        if Path(name).suffix.lower()=='.pdf':
            for page,chapter in enumerate(parsed['chapters']):
                chapter['source_pages']=[dict(file_index=index,page=page)]
        batch['chapters'].extend(parsed['chapters'])
        batch['warnings'].extend(f'{name}：{w}' for w in parsed['warnings'])
        batch['blocked'] |= parsed['blocked']
    if len(batch['chapters'])>3000:
        batch['blocked'] = True
        batch['warnings'].append('识别到超过 3000 篇内容，请拆分文件后导入。')
    (folder / 'preview.json').write_text(encoded(batch), encoding='utf-8')
    return batch


@router.post('/worlds/{world_id}/imports/{batch_id}/ocr')
async def ocr(world_id:str, batch_id:str, body:OcrRequest, request:Request):
    repo=request.app.state.creation
    repo.get(world_id)
    folder,batch=read_batch(repo,world_id,batch_id)
    with repo.connection() as conn:
        repo.writable_world(conn,world_id)
        if conn.execute('SELECT 1 FROM import_commits WHERE batch_id=?',(batch['id'],)).fetchone():
            raise HTTPException(409,'作品已导入，不能重新识别并覆盖正文。')
    available=capabilities()
    if body.language not in {l['tag'] for l in available['languages']}:
        raise HTTPException(422,available['reason'] or '请选择本机已安装的 OCR 语言。')
    if batch['id'] in _recognizing:
        raise HTTPException(409,'这个预览正在识别，请等待当前操作完成。')
    pending=[p for p in batch.get('ocr_pages',[]) if p['status']!='recognized'][:20]
    if not pending:
        return batch
    _recognizing.add(batch['id'])
    try:
        for page in pending:
            source=batch['files'][page['file_index']]
            try:
                args=((folder/source['asset']).read_bytes(),page['page'],body.language)
                result=await asyncio.to_thread(recognize_page,*args,*((body.rotation,) if body.rotation else ()))
                if not result['text'].strip():
                    raise CreationError('未识别到文字；原页仍保留，请检查原件或识别语言。')
                chapter=next(c for c in batch['chapters'] if c['key']==page['chapter_key'])
                # Mixed pages retain the accurate text layer until an explicit user edit.
                if page.get('mode')!='mixed':
                    chapter['document']=text_document(result['text']); chapter['text']=result['text']
                page.update(status='recognized',result=result,error='')
            except Exception as error:
                page.update(status='failed',error=error.message if isinstance(error,CreationError) else '本页识别失败，原页仍保留，请检查文件或本机 OCR。')
            # Persist each finished page; retry processes only unresolved pages.
            source_pages=[p for p in batch['ocr_pages'] if p['file_index']==page['file_index']]
            source['blocked']=any(p['status']!='recognized' for p in source_pages)
            base=[w for w in source['warnings'] if '没有可读取的正文' not in w and '没有识别到正文' not in w and '本机 OCR' not in w]
            source['warnings']=[*base,*[f"第 {p['page']+1} 页本机 OCR："+
                (f"已识别（{p['result']['language']}），请对照原页核对错字、遗漏及阅读顺序。" if p['status']=='recognized' else p.get('error') or '等待识别。') for p in source_pages]]
            batch['blocked']=len(batch['chapters'])>3000 or any(f['blocked'] for f in batch['files'])
            batch['warnings']=[f"{f['name']}：{w}" for f in batch['files'] for w in f['warnings']]
            temp=folder/'preview.next.json'; temp.write_text(encoded(batch),encoding='utf-8'); temp.replace(folder/'preview.json')
        return batch
    finally:
        _recognizing.discard(batch['id'])


@router.post('/worlds/{world_id}/imports/{batch_id}/commit', status_code=201)
def commit(world_id: str, batch_id: str, body: ImportCommit, request: Request):
    repo = request.app.state.creation
    _, batch = read_batch(repo, world_id, batch_id)
    batch_id = batch['id']
    if batch_id in _recognizing:
        raise HTTPException(409,'扫描页正在识别，请等待后重新核对预览。')
    if batch['blocked']:
        raise HTTPException(409, '导入尚有未完整读取的内容，请先按预览提示处理原始文件。')
    if batch['warnings'] and not body.acknowledged:
        raise HTTPException(422, '请核对并确认导入提示。')
    scanned={(p['file_index'],p['page']):p for p in batch.get('ocr_pages',[])}
    reviews={(r.file_index,r.page):r for r in body.page_reviews}
    if len(reviews)!=len(body.page_reviews) or reviews.keys()!=scanned.keys():
        raise HTTPException(409,'请逐页对照原页核对 OCR 正文，并明确确认完整性、错字和阅读顺序。')
    final_pages={(p.file_index,p.page) for c in body.chapters for p in c.source_pages}
    if not scanned.keys()<=final_pages:
        raise HTTPException(409,'已识别页的原页来源不能丢失，请保留拆分或合并后的来源关联。')
    for key,page in scanned.items():
        if page['status']!='recognized':
            raise HTTPException(409,'本页尚未完成识别，不能确认导入。')
        review=reviews[key]
        if review.resolution=='text_layer':
            if page.get('mode')!='mixed':
                raise HTTPException(409,'纯扫描页没有文字层，请核对并修正识别正文后确认。')
            # Keeping just the text layer is an explicit per-page assertion that images add no prose.
            original=next(c for c in batch['chapters'] if c['key']==page['chapter_key'])
            final=next((c for c in body.chapters if c.key==page['chapter_key']),None)
            if final is None or final.text.strip()!=original['text'].strip():
                raise HTTPException(409,'已调整或合并本页正文，请选择「已补齐并核对正文」。')
    file_names = {f['name'] for f in batch['files']}
    if any(name not in file_names for c in body.chapters for name in [c.source_file,*c.source_files] if name):
        raise HTTPException(422, '内容来源文件不在当前导入中。')
    source_pages={(p['file_index'],p['page']) for c in batch['chapters'] for p in c.get('source_pages',[])}
    if any((p.file_index,p.page) not in source_pages for c in body.chapters for p in c.source_pages):
        raise HTTPException(422,'原页来源不在当前导入中。')
    review_metadata={key:dict(**r.model_dump(),file=batch['files'][r.file_index]['name']) for key,r in reviews.items()}
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        repo.writable_world(conn, world_id)
        existing = conn.execute('SELECT work_id FROM import_commits WHERE batch_id=?', (batch_id,)).fetchone()
        if existing:
            return repo.required(conn, 'works', existing['work_id'])
        identity, timestamp = str(uuid4()), now()
        conn.execute('INSERT INTO works(id,world_id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?,?)', (identity,world_id,body.title,body.kind,timestamp,timestamp))
        work = repo.required(conn, 'works', identity)
        children, created = defaultdict(list), {}
        for chapter in body.chapters:
            children[chapter.parent_key].append(chapter)
        pending = deque(children[None])
        while pending:
            chapter = pending.popleft()
            document = chapter.document if chapter.format=='document' else markdown_document(chapter.text) if chapter.format=='markdown' else text_document(chapter.text)
            data = NodeCreate(title=chapter.title, kind=chapter.kind, document=document,
                              parent_id=created.get(chapter.parent_key),
                              metadata={'material_category':chapter.category,'material_tags':encoded(chapter.tags),
                                        'import_source_pages':encoded([p.model_dump() for p in chapter.source_pages]),
                                        'import_batch':batch_id,'import_file':chapter.source_file,'import_files':encoded(chapter.source_files or ([chapter.source_file] if chapter.source_file else [])),'import_key':chapter.key,
                                        'import_revision_views':encoded({f['name']:f['revision_view'] for f in batch['files']
                                            if f.get('revision_view') and f['name'] in (chapter.source_files or [chapter.source_file])}),
                                        'import_page_reviews':encoded([review_metadata[(p.file_index,p.page)] for p in chapter.source_pages
                                            if (p.file_index,p.page) in review_metadata])}).model_dump()
            created[chapter.key] = repo.create_node_in(conn, work, data)['id']
            pending.extend(children[chapter.key])
        conn.execute('INSERT INTO import_commits VALUES(?,?)', (batch_id, identity))
        return work
