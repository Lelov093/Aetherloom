"""Local presentation assets, independent of Canon and simulation knowledge."""
from io import BytesIO
from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError
from .creation import CreationError

router = APIRouter(prefix='/api')


def initialize(repo):
    with repo.connection() as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS entity_portraits (
            entity_id TEXT PRIMARY KEY REFERENCES entities(id), image BLOB NOT NULL,
            media_type TEXT NOT NULL, version INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1)''')


@router.get('/worlds/{world}/portraits')
def listing(world: str, request: Request):
    repo = request.app.state.creation
    repo.get(world)
    with repo.connection() as conn:
        return {r['entity_id']:r['version'] for r in conn.execute('''SELECT p.entity_id,p.version
            FROM entity_portraits p JOIN entities e ON e.id=p.entity_id WHERE e.world_id=? AND p.active=1''',(world,))}


@router.get('/entities/{identity}/portrait')
def portrait(identity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        repo.required(conn,'entities',identity)
        row = conn.execute('SELECT * FROM entity_portraits WHERE entity_id=? AND active=1',(identity,)).fetchone()
        if not row:
            raise CreationError('尚未设置头像。',404)
        return Response(bytes(row['image']),media_type=row['media_type'],headers={'Cache-Control':'no-cache'})


def writable(repo,conn,identity):
    entity = repo.required(conn,'entities',identity)
    repo.writable_world(conn,entity['world_id'])
    if entity['status']!='active' or entity['merged_into']:
        raise CreationError('请在活跃、未合并的对象上设置头像。',409)


@router.post('/entities/{identity}/portrait')
async def upload(identity: str, request: Request, file: UploadFile):
    content = await file.read(4*1024*1024+1)
    if len(content)>4*1024*1024:
        raise CreationError('头像请使用不超过4MB的 PNG、JPEG 或 WebP。')
    try:
        with Image.open(BytesIO(content)) as image:
            media_type = {'PNG':'image/png','JPEG':'image/jpeg','WEBP':'image/webp'}.get(image.format)
            if not media_type or max(image.size)>4096:
                raise CreationError('头像格式须为 PNG、JPEG 或 WebP，宽高不超过4096像素。')
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        raise CreationError('无法读取这张头像，请选择有效的 PNG、JPEG 或 WebP。')
    repo = request.app.state.creation
    with repo.connection() as conn:
        conn.execute('BEGIN IMMEDIATE')
        writable(repo,conn,identity)
        conn.execute('''INSERT INTO entity_portraits(entity_id,image,media_type,version) VALUES(?,?,?,1)
            ON CONFLICT(entity_id) DO UPDATE SET image=excluded.image,media_type=excluded.media_type,
            version=entity_portraits.version+1,active=1''',(identity,content,media_type))
    return {'saved':True}


@router.delete('/entities/{identity}/portrait')
def hide(identity: str, request: Request):
    repo = request.app.state.creation
    with repo.connection() as conn:
        writable(repo,conn,identity)
        conn.execute('UPDATE entity_portraits SET active=0,version=version+1 WHERE entity_id=?',(identity,))
    return {'hidden':True}
