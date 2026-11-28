"""Preview in the renderer. Stage and publish only for the desktop host."""

import os
import sqlite3
import shutil
import subprocess
from contextlib import closing, contextmanager
from dataclasses import dataclass
from hmac import compare_digest
from pathlib import Path, PurePosixPath
from posixpath import relpath
from tempfile import TemporaryDirectory
from threading import Lock
from typing import Literal
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, Request, Response
from pydantic import Field
from pypdf import PdfWriter
from pypdf.errors import PdfReadError
from pypdf.generic import NameObject, TextStringObject

from .creation import CreationError
from .export_render import PDF_LINK_ORIGIN, html_file, save_docx, transcode_image
from .workspace_export import ExportSelection, ROOT, build_plan, heading, name, path_link, reference


class Prepare(ExportSelection):
    destination: str = Field(min_length=1, max_length=32000)
    packaging: Literal['folder', 'zip', 'rar']
    stamp: str = Field(min_length=64, max_length=64)


@dataclass
class ExportJob:
    directory: TemporaryDirectory
    destination: Path
    title: str
    packaging: str
    files: list[PurePosixPath]
    pdf: list[tuple[Path, PurePosixPath]]
    rar: str | None


def rar_executable():
    executable = shutil.which('rar')
    if executable or os.name != 'nt':
        return executable
    import winreg

    # WinRAR can be installed off the system drive without a PATH entry.
    branch = r'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\WinRAR archiver'
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
            try:
                with winreg.OpenKey(hive, branch, 0, winreg.KEY_READ | view) as key:
                    directory, _ = winreg.QueryValueEx(key, 'InstallLocation')
                candidate = Path(directory) / 'Rar.exe'
                if candidate.is_absolute() and candidate.is_file():
                    return str(candidate)
            except OSError:
                continue
    return None


@contextmanager
def catalog(request, world, options):
    repo = request.app.state.creation
    runtime = request.app.state.vnext.options
    with repo.connection() as conn:
        conn.execute('BEGIN')
        if not runtime.enabled or options.work_id:
            yield build_plan(repo, conn, world, options)
        elif runtime.database.resolve() == repo.path.resolve():
            yield build_plan(repo, conn, world, options, conn)
        else:
            with closing(sqlite3.connect(runtime.database.resolve().as_uri() + '?mode=ro', uri=True)) as history:
                history.row_factory = sqlite3.Row
                history.execute('BEGIN')
                yield build_plan(repo, conn, world, options, history)


def render_files(root, files, targets):
    deferred_docs, printable = [], []
    for output in files:
        item = output.source
        destination = root.joinpath(*output.path.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if item.content is None:
            raise CreationError(f'缺少文件「{item.title}」。请恢复原件，或在预览中取消选择。', 409)
        try:
            if isinstance(item.content, Path):
                shutil.copyfile(item.content, destination)
                continue
            def link(target, origin=output.path):
                return path_link(targets, origin, target)
            if output.alias:
                content = heading(item.title, reference('打开同一张卡片', link(item.target)))
            else:
                content = item.content(link)
            if output.fmt in ('png', 'jpg', 'webp'):
                transcode_image(content, destination, output.fmt)
            elif output.fmt in ('md', 'json'):
                destination.write_text(content, encoding='utf-8')
            elif output.fmt == 'html':
                destination.write_text(html_file(content, item.title), encoding='utf-8')
            elif output.fmt == 'docx':
                # Word embeds selected images, which may be later in the plan.
                deferred_docs.append((content, item.title, destination))
            elif output.fmt == 'pdf':
                source = destination.parent / ('.print-' + uuid4().hex + '.html')
                source.write_text(html_file(content, item.title, printing=True, output_path=output.path), encoding='utf-8')
                printable.append((source, output.path))
        except (OSError, ValueError) as exc:
            raise CreationError(f'无法导出「{item.title}」。{exc.strerror if isinstance(exc, OSError) else str(exc)}', 409) from exc
    for content, title, destination in deferred_docs:
        try:
            save_docx(content, title, destination, root.resolve())
        except (OSError, ValueError) as exc:
            raise CreationError(f'无法生成 Word 文件「{title}」。', 409) from exc
    return printable


def finish_pdf(root, path):
    file = root.joinpath(*path.parts)
    rewritten = file.with_suffix('.verified')
    writer = PdfWriter(clone_from=file)
    if not writer.pages:
        raise CreationError(f'PDF「{path.name}」没有可读页面。请重新导出。', 409)
    for page in writer.pages:
        for ref in page.get('/Annots', []):
            action = ref.get_object().get('/A')
            if action and action.get('/URI', '').startswith(PDF_LINK_ORIGIN):
                target = action['/URI'].removeprefix(PDF_LINK_ORIGIN)
                action[NameObject('/URI')] = TextStringObject(relpath(target, path.parent.as_posix()))
    writer.write(rewritten)
    rewritten.replace(file)


def numbered(parent, label, suffix=''):
    index = 1
    while True:
        part = label if index == 1 else f'{label}（{index}）'
        path = parent / (part + suffix)
        if not path.exists() and not path.is_symlink():
            yield path
        index += 1


def publish(job):
    root = Path(job.directory.name)
    for source, path in job.pdf:
        finish_pdf(root, path)
        source.unlink()
    if job.packaging == 'folder':
        result = job.destination / ROOT[0]
        if not result.exists() and not result.is_symlink():
            try:
                (root / ROOT[0]).rename(result)
                return result
            except OSError:
                if not result.exists():
                    raise
        for parent in numbered(job.destination, name(job.title) + ' · 导出'):
            try:
                parent.mkdir()
            except FileExistsError:
                continue
            try:
                result = parent / ROOT[0]
                (root / ROOT[0]).rename(result)
            except OSError:
                parent.rmdir()
                raise
            return result
    suffix = '.' + job.packaging
    archive = root / ('交付' + suffix)
    if job.packaging == 'zip':
        with ZipFile(archive, 'x', ZIP_DEFLATED, allowZip64=True, compresslevel=5) as bundle:
            for file in job.files:
                bundle.write(root.joinpath(*file.parts), str(file))
    else:
        subprocess.run([job.rar, 'a', '-r', '-cfg-', '-idq', archive.name, ROOT[0]], cwd=root,
                       check=True, capture_output=True, timeout=300, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    for destination in numbered(job.destination, name(job.title), suffix):
        try:
            if os.name == 'nt':
                archive.rename(destination)
            else:
                os.link(archive, destination)
            return destination
        except FileExistsError:
            continue


def export_router(secret):
    router = APIRouter(prefix='/api')
    lock = Lock()
    jobs = {}

    def desktop(request):
        supplied = request.headers.get('X-Aetherloom-Host', '')
        if not secret or not compare_digest(supplied.encode(), secret.encode()):
            raise CreationError('请从桌面应用选择导出目录。', 403)

    @router.post('/worlds/{world}/exports/preview')
    def preview(world: str, options: ExportSelection, request: Request):
        with catalog(request, world, options) as plan:
            public, _, _ = plan.resolve(options)
        return {**public, 'rar': bool(secret and rar_executable())}

    @router.post('/worlds/{world}/exports/prepare')
    def prepare(world: str, options: Prepare, request: Request):
        desktop(request)
        destination = Path(options.destination).resolve()
        if not destination.is_dir():
            raise CreationError('导出目录已不可用，请重新选择。', 409)
        rar = rar_executable() if options.packaging == 'rar' else None
        if options.packaging == 'rar' and not rar:
            raise CreationError('本机找不到 RAR 压缩工具，请选择 ZIP 或普通文件夹。', 409)
        staging = None
        try:
            with catalog(request, world, options) as plan:
                public, files, targets = plan.resolve(options)
                if public['stamp'] != options.stamp or not files:
                    raise CreationError('导出范围已变动，请重新确认预览。', 409)
                missing = [str(file.path) for file in files if file.source.content is None]
                if missing:
                    raise CreationError('缺少原件：' + '、'.join(missing), 409)
                staging = TemporaryDirectory(prefix='.aetherloom-export-', dir=destination)
                printable = render_files(Path(staging.name), files, targets)
            job = ExportJob(staging, destination, public['title'], options.packaging, [file.path for file in files], printable, rar)
            identity = uuid4().hex
            with lock:
                jobs[identity] = job
            return {'id': identity, 'directory': staging.name,
                    'pdf': [{'input': str(source), 'output': str(Path(staging.name).joinpath(*path.parts))}
                            for source, path in printable]}
        except OSError as exc:
            if staging:
                staging.cleanup()
            raise CreationError(f'无法在选定目录准备导出。{exc.strerror or ""}', 409) from exc
        except Exception:
            if staging:
                staging.cleanup()
            raise

    @router.post('/exports/{identity}/finish')
    def finish(identity: str, request: Request):
        desktop(request)
        with lock:
            job = jobs.pop(identity, None)
        if not job:
            raise CreationError('该导出已完成或失效，请重新选择。', 409)
        try:
            return {'path': str(publish(job)), 'files': len(job.files)}
        except (OSError, ValueError, PdfReadError, subprocess.SubprocessError) as exc:
            raise CreationError(f'生成{job.packaging.upper()}交付物失败。请检查目标目录和可用空间。', 409) from exc
        finally:
            job.directory.cleanup()

    @router.delete('/exports/{identity}', status_code=204)
    def abort(identity: str, request: Request):
        desktop(request)
        with lock:
            job = jobs.pop(identity, None)
        if job:
            job.directory.cleanup()
        return Response(status_code=204)

    return router
