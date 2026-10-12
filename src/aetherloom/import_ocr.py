"""Local Windows OCR; never sends source pages to a model or changes Canon."""
import asyncio
import sys
import unicodedata
from threading import Lock

from .creation import CreationError

# PDFium explicitly forbids simultaneous calls, even for different documents.
_render_lock = Lock()


def line_text(line):
    """Windows joins Chinese OCR tokens with spaces; use glyph gaps for CJK adjacency."""
    words=list(line.words)
    if not words: return line.text
    text=words[0].text
    for previous,current in zip(words,words[1:]):
        left,right=previous.bounding_rect,current.bounding_rect
        cjk=all(unicodedata.east_asian_width(c) in ('W','F') for c in (previous.text[-1],current.text[0]))
        gap=right.x-(left.x+left.width)
        separator='' if cjk and gap<max(left.height,right.height)*.25 else ' '
        text+=separator+current.text
    return text


def capabilities():
    if sys.platform != 'win32':
        return dict(available=False,languages=[],reason='本机 OCR 当前需要 Windows。')
    try:
        from winrt.windows.media.ocr import OcrEngine
        languages=[dict(tag=l.language_tag,name=l.display_name) for l in OcrEngine.available_recognizer_languages]
        return dict(available=bool(languages),languages=languages,
                    reason='' if languages else 'Windows 尚未安装 OCR 识别语言，请在系统语言设置中添加。')
    except (ImportError,OSError,RuntimeError):
        return dict(available=False,languages=[],reason='本机 Windows OCR 不可用，请检查系统 OCR 语言与项目依赖。')


def render_page(raw, index, rotation=0):
    import pypdfium2 as pdfium
    with _render_lock, pdfium.PdfDocument(raw) as pdf:
        page=pdf[index]
        try:
            width,height=page.get_size()
            scale=min(4,4096/max(width,height))
            bitmap=page.render(scale=scale)
            try:
                image=bitmap.to_pil()
                try:
                    oriented=image.rotate(-rotation,expand=True) if rotation else image.copy()
                    try:
                        rgba=oriented.convert('RGBA')
                        try:
                            return rgba.size,rgba.tobytes('raw','BGRA')
                        finally:
                            rgba.close()
                    finally:
                        oriented.close()
                finally:
                    image.close()
            finally:
                bitmap.close()
        finally:
            page.close()


async def recognize(raw, index, language, rotation=0):
    from winrt.windows.globalization import Language
    from winrt.windows.graphics.imaging import SoftwareBitmap, BitmapPixelFormat
    from winrt.windows.media.ocr import OcrEngine
    from winrt.windows.storage.streams import DataWriter
    engine=OcrEngine.try_create_from_language(Language(language))
    if engine is None:
        raise CreationError('所选 OCR 语言在本机不可用，请选择已安装语言。',422)
    (width,height),pixels=render_page(raw,index,rotation)
    writer=DataWriter()
    try:
        writer.write_bytes(pixels)
        bitmap=SoftwareBitmap.create_copy_from_buffer(writer.detach_buffer(),BitmapPixelFormat.BGRA8,width,height)
        try:
            result=await engine.recognize_async(bitmap)
            return dict(text='\n'.join(line_text(line) for line in result.lines),language=engine.recognizer_language.language_tag,
                        engine='Windows.Media.Ocr',width=width,height=height,rotation=rotation)
        finally:
            bitmap.close()
    finally:
        writer.close()


def recognize_page(raw, index, language, rotation=0):
    """Run on a worker thread so rendering/recognition does not block the local API."""
    from winrt.runtime import init_apartment, uninit_apartment, ApartmentType
    init_apartment(ApartmentType.MULTI_THREADED)
    try:
        return asyncio.run(recognize(raw,index,language,rotation))
    finally:
        uninit_apartment()
