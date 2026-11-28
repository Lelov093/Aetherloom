"""Render portable export files using the project's existing document libraries."""

import html
import posixpath
import re
from io import BytesIO
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from docx import Document
from docx.opc.constants import RELATIONSHIP_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches
from markdown_it import MarkdownIt
from PIL import Image, ImageDraw

MARKDOWN = MarkdownIt('commonmark', {'html': False}).enable('strikethrough')
TEXT_FORMATS = ('md', 'docx', 'pdf', 'html')
IMAGE_FORMATS = ('png', 'jpg', 'webp')
PDF_LINK_ORIGIN = 'https://aetherloom-export.invalid/'


def text(value):
    return re.sub(r'([\\\x60*_[\]{}<>#+!|~])', r'\\\1', str(value))


def reference(label, destination):
    return f'[{label}](<{destination}>)'


def picture(label, destination):
    return '!' + reference(label, destination)


def manuscript(document, link):
    def inline(node):
        if node['type'] == 'hardBreak':
            return '  \n'
        raw = node.get('text', '')
        value = text(raw)
        target = None
        for mark in node.get('marks', []):
            kind, attrs = mark['type'], mark.get('attrs', {})
            if kind in ('bold', 'italic', 'strike') and raw.strip():
                fence = {'bold': '**', 'italic': '*', 'strike': '~~'}[kind]
                leading = value[:len(value) - len(value.lstrip())]
                trailing = value[len(value.rstrip()):]
                value = f'{leading}{fence}{value.strip()}{fence}{trailing}'
            elif kind == 'code':
                fence = ticks(raw)
                value = f'{fence} {raw} {fence}'
            elif kind == 'link':
                target = quote(attrs['href'], safe=':/?#@!$&()*+,;=%[]~-._')
            elif kind == 'entityMention':
                target = link(f'entity:{attrs["entityId"]}')
            elif kind == 'contentLink':
                target = link(f'node:{attrs["nodeId"]}')
        return reference(value, target) if target and value.strip() else value

    def block(node):
        kind = node['type']
        children = node.get('content', [])
        if kind in ('paragraph', 'heading'):
            value = ''.join(inline(child) for child in children)
            if kind == 'heading' and value.strip():
                level = max(1, min(5, int(node.get('attrs', {}).get('level', 1))))
                return '#' * (level + 1) + ' ' + value
            return value
        if kind == 'blockquote':
            return '\n'.join('> ' + line for line in block_list(children).splitlines())
        if kind in ('bulletList', 'orderedList'):
            start = node.get('attrs', {}).get('start', 1)
            rows = []
            for i, child in enumerate(children):
                prefix = f'{start + i}. ' if kind == 'orderedList' else '- '
                value = block_list(child.get('content', [])).split('\n')
                rows.append(prefix + value[0] + ''.join('\n' + ' ' * len(prefix) + line for line in value[1:]))
            return '\n'.join(rows)
        if kind == 'codeBlock':
            raw = ''.join(child.get('text', '') for child in children)
            fence = ticks(raw, minimum=3)
            return f'{fence}\n{raw}\n{fence}'
        if kind == 'horizontalRule':
            return '---'
        return block_list(children)

    def block_list(nodes):
        return '\n\n'.join(block(node) for node in nodes)

    return block_list(document.get('content', []))


def ticks(value, minimum=1):
    return '\x60' * max(minimum, max((len(match) + 1 for match in re.findall(r'\x60+', value)), default=1))


def safe_asset(path, folder, export_root):
    decoded = urlsplit(path)
    if decoded.scheme or decoded.netloc:
        return None
    resource = (folder / unquote(decoded.path)).resolve()
    return resource if resource.is_relative_to(export_root) and resource.is_file() else None


def html_file(body, title, *, printing=False, output_path=None):
    tokens = MARKDOWN.parse(body)
    if printing:
        # Chromium resolves relative anchors against the staging file. A
        # placeholder origin lets the PDF finalizer restore portable links.
        for token in tokens:
            for piece in token.children or []:
                if piece.type != 'link_open':
                    continue
                href = piece.attrGet('href')
                if href and not urlsplit(href).scheme and not href.startswith(('#', '//')):
                    target = posixpath.normpath(posixpath.join(output_path.parent.as_posix(), href))
                    piece.attrSet('href', PDF_LINK_ORIGIN + target)
    content = MARKDOWN.renderer.render(tokens, MARKDOWN.options, {})
    title = html.escape(title)
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>{title}</title><style>
body{{max-width:48rem;margin:2.4rem auto;padding:0 1.4rem;color:#20232a;font:16px/1.8 "Microsoft YaHei","Noto Sans CJK SC",sans-serif}}
h1,h2,h3{{line-height:1.4}}img{{max-width:100%;height:auto}}pre{{white-space:pre-wrap;background:#f4f5f7;padding:.65em}}
blockquote{{margin:.6em 0;border-left:3px solid #9aabba;padding-left:1em}}a{{color:#265785;overflow-wrap:anywhere}}
@media print{{body{{max-width:none;margin:0;padding:0;font-size:11pt}}h1,h2,h3{{break-after:avoid}}img{{break-inside:avoid;max-height:230mm;object-fit:contain}}}}
</style></head><body><main>{content}</main></body></html>
"""


def add_docx_link(paragraph, label, target):
    relationship = paragraph.part.relate_to(target, RELATIONSHIP_TYPE.HYPERLINK, is_external=True)
    hyperlink = OxmlElement('w:hyperlink')
    hyperlink.set(qn('r:id'), relationship)
    run = OxmlElement('w:r')
    properties = OxmlElement('w:rPr')
    style = OxmlElement('w:rStyle')
    style.set(qn('w:val'), 'Hyperlink')
    properties.append(style)
    run.append(properties)
    words = OxmlElement('w:t')
    words.text = label
    run.append(words)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)


def save_docx(body, title, destination, export_root):
    doc = Document()
    doc.core_properties.title = title
    doc.styles['Normal'].font.name = 'Microsoft YaHei'
    style = None
    containers = []
    for token in MARKDOWN.parse(body):
        if token.type in ('bullet_list_open', 'ordered_list_open', 'blockquote_open'):
            containers.append({'bullet_list_open': 'List Bullet', 'ordered_list_open': 'List Number',
                               'blockquote_open': 'Quote'}[token.type])
        elif token.type in ('bullet_list_close', 'ordered_list_close', 'blockquote_close'):
            containers.pop()
        elif token.type == 'heading_open':
            style = 'Heading ' + token.tag[1:]
        elif token.type == 'paragraph_open':
            style = containers[-1] if containers else None
        elif token.type in ('fence', 'code_block'):
            run = doc.add_paragraph().add_run(token.content)
            run.font.name = 'Consolas'
        elif token.type == 'hr':
            doc.add_paragraph('—')
        elif token.type == 'inline':
            paragraph = doc.add_paragraph(style=style)
            bold = italic = strike = False
            href = None
            label = []
            for piece in token.children or []:
                kind = piece.type
                if kind in ('strong_open', 'strong_close'):
                    bold = kind == 'strong_open'
                elif kind in ('em_open', 'em_close'):
                    italic = kind == 'em_open'
                elif kind in ('s_open', 's_close'):
                    strike = kind == 's_open'
                elif kind == 'link_open':
                    href, label = piece.attrGet('href'), []
                elif kind == 'link_close':
                    add_docx_link(paragraph, ''.join(label), href)
                    href = None
                elif kind in ('hardbreak', 'softbreak'):
                    paragraph.add_run().add_break()
                elif kind == 'image':
                    local = safe_asset(piece.attrGet('src'), destination.parent, export_root)
                    if local:
                        try:
                            with Image.open(local) as image:
                                width = min(6.0, image.width / 96)
                                png = BytesIO()
                                image.save(png, 'PNG')
                            paragraph.add_run().add_picture(png, width=Inches(width))
                        except (OSError, ValueError):
                            raise ValueError(f'无法嵌入图片 {local.name}') from None
                    elif piece.content:
                        paragraph.add_run(piece.content)
                elif kind in ('text', 'code_inline'):
                    if href:
                        label.append(piece.content)
                    else:
                        run = paragraph.add_run(piece.content)
                        run.bold, run.italic, run.font.strike = bold, italic, strike
                        if kind == 'code_inline':
                            run.font.name = 'Consolas'
    doc.save(destination)


def transcode_image(value, destination, fmt):
    with Image.open(BytesIO(value)) as image:
        if fmt == 'jpg':
            image = image.convert('RGB')
        image.save(destination, {'png': 'PNG', 'jpg': 'JPEG', 'webp': 'WEBP'}[fmt])


def draw_map(background, size, features):
    width, height = size
    scale = min(1, 1600 / max(width, height))
    width, height = max(1, round(width * scale)), max(1, round(height * scale))
    if background:
        with Image.open(BytesIO(background)) as source:
            image = source.convert('RGBA').resize((width, height))
    else:
        image = Image.new('RGBA', (width, height), '#f1eee6')
    overlay = Image.new('RGBA', image.size)
    pen = ImageDraw.Draw(overlay)
    for index, feature in enumerate(features, 1):
        points = [(point['x'] * width, point['y'] * height) for point in feature['points']]
        if not points:
            continue
        color = feature['color']
        if not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
            color = '#4580a9'
        if feature['kind'] == 'region' and len(points) >= 3:
            pen.polygon(points, fill=color + '44', outline=color, width=2)
        x, y = points[0]
        x, y = max(13, min(width - 13, x)), max(13, min(height - 13, y))
        pen.ellipse((x - 11, y - 11, x + 11, y + 11), fill=color, outline='white', width=2)
        pen.text((x, y), str(index), fill='white', anchor='mm')
    result = BytesIO()
    Image.alpha_composite(image, overlay).save(result, 'PNG')
    return result.getvalue()
