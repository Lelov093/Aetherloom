"""Convert supported source formats to editable documents and a revisable hierarchy."""

import re
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from docx import Document
from docx.text.paragraph import Paragraph
from docx.text.hyperlink import Hyperlink
from docx.text.run import Run
from docx.oxml.ns import qn
from docx.oxml import parse_xml
from markdown_it import MarkdownIt
from pypdf import PdfReader
from pypdf.generic import ContentStream

from .creation import CreationError
from .creation_models import inspect_document
from .import_docx import DocxContext


def text_document(text):
    return {'type': 'doc', 'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': line}] if line else []} for line in text.split('\n')]}


def decode_text(raw, warnings):
    # BOMs are explicit encoding evidence, not a guess based on prose.
    if raw.startswith((b'\xff\xfe\x00\x00', b'\x00\x00\xfe\xff')):
        encoding = 'utf-32'
    elif raw.startswith((b'\xff\xfe', b'\xfe\xff')):
        encoding = 'utf-16'
    else:
        encoding = 'utf-8-sig'
    try:
        text = raw.decode(encoding)
    except UnicodeDecodeError:
        if encoding != 'utf-8-sig':
            raise CreationError('文本编码标记与内容不符，请另存为 UTF-8 后导入。') from None
        try:
            text = raw.decode('gb18030')
            warnings.append('使用 GB18030 解码，请核对正文是否有乱码。')
        except UnicodeDecodeError:
            raise CreationError('无法识别文本编码，请另存为 UTF-8 后导入。') from None
    if '\x00' in text:
        raise CreationError('文本包含无法读取的空字符，可能是缺少编码标记的文件；请另存为 UTF-8 后导入。')
    return text.replace('\r\n','\n').replace('\r','\n')


def markdown_document(text):
    root = {'type': 'doc', 'content': []}
    stack, marks = [root], []
    mapping = {'paragraph':'paragraph','heading':'heading','bullet_list':'bulletList','ordered_list':'orderedList','list_item':'listItem','blockquote':'blockquote'}
    for token in MarkdownIt().parse(text):
        if token.type.endswith('_open'):
            kind = mapping.get(token.type[:-5])
            if kind:
                node = {'type':kind,'content':[]}
                if kind == 'heading':
                    node['attrs'] = {'level':int(token.tag[1:])}
                if kind == 'orderedList':
                    node['attrs'] = {'start':int(token.attrGet('start') or 1)}
                stack[-1]['content'].append(node);stack.append(node)
        elif token.type.endswith('_close') and len(stack)>1:
            stack.pop()
        elif token.type == 'inline':
            for item in token.children or []:
                mark = {'strong':'bold','em':'italic','s':'strike','link':'link'}.get(item.type.removesuffix('_open').removesuffix('_close'))
                if item.type.endswith('_open') and mark:
                    value = {'type':mark}
                    if mark == 'link':
                        href = item.attrGet('href') or ''
                        if href.startswith(('https://', 'http://', 'mailto:')):
                            value['attrs'] = {'href':href}
                        else:
                            value = {'type':'unsupportedLink'}
                    marks.append(value)
                elif item.type.endswith('_close') and marks:
                    marks.pop()
                elif item.type in {'softbreak','hardbreak'}:
                    stack[-1]['content'].append({'type':'hardBreak'})
                elif item.content:
                    node = {'type':'text','text':item.content}
                    active = [*(m for m in marks if m['type'] != 'unsupportedLink'), *([{'type':'code'}] if item.type=='code_inline' else [])]
                    if active:
                        node['marks'] = active
                    stack[-1]['content'].append(node)
        elif token.type in {'fence','code_block'}:
            stack[-1]['content'].append({'type':'codeBlock','content':[{'type':'text','text':token.content.rstrip('\n')}] if token.content else []})
        elif token.type == 'hr':
            stack[-1]['content'].append({'type':'horizontalRule'})
        elif token.type == 'html_block':
            stack[-1]['content'].extend(text_document(token.content)['content'])
    return root if root['content'] else text_document(text)


def build_chapters(name, blocks):
    """A heading opens a content node; its level determines the nearest parent."""
    chapters, stack, current = [], [], None
    for block, level, title, kind in blocks:
        if level:
            while stack and stack[-1][0] >= level:
                stack.pop()
            current = dict(key=str(uuid4()), parent_key=stack[-1][1] if stack else None,
                           title=title[:160] or Path(name).stem[:160], kind=kind,
                           format='document', document={'type':'doc','content':[]}, source_file=name)
            chapters.append(current)
            stack.append((level, current['key']))
        if current is None:
            current = dict(key=str(uuid4()), parent_key=None, title=Path(name).stem[:160], kind='chapter',
                           format='document', document={'type':'doc','content':[]}, source_file=name)
            chapters.append(current)
        current['document']['content'].append(block)
    for chapter in chapters:
        chapter['text'] = inspect_document(chapter['document'])[0]
    return chapters


def text_blocks(text):
    pattern = re.compile(r'^\s*(第[〇零一二三四五六七八九十百千万\d]+([卷章节幕场])|Chapter\s+\d+)', re.I)
    for line in text.splitlines():
        match = pattern.match(line)
        unit = match.group(2) if match else None
        level = (1 if unit in ('卷','幕') else 3 if unit == '节' else 2) if match else 0
        kind = {'卷':'volume','幕':'act','节':'section','场':'scene'}.get(unit, 'chapter')
        block = {'type':'heading' if level else 'paragraph', 'content':[{'type':'text','text':line}] if line else []}
        if level:
            block['attrs'] = {'level':level}
        yield block, level, line.strip(), kind


def run_nodes(run, extra=()):
    marks = [dict(m) for m in extra]
    for prop, kind in [('bold','bold'), ('italic','italic'), ('underline','underline')]:
        if getattr(run, prop):
            marks.append({'type':kind})
    if run.font.strike or run.font.double_strike:
        marks.append({'type':'strike'})
    # Preserve footnote/endnote anchors at their position within the run.
    text=''
    for child in run._r:
        if child.tag==qn('w:t'): text+=child.text or ''
        elif child.tag==qn('w:tab'): text+='\t'
        elif child.tag in (qn('w:br'),qn('w:cr')): text+='\n'
        elif child.tag in (qn('w:footnoteReference'),qn('w:endnoteReference'),qn('w:commentReference')):
            label={'footnoteReference':'脚注','endnoteReference':'尾注','commentReference':'批注'}[child.tag.rsplit('}',1)[-1]]
            text+=f'〔{label} {child.get(qn("w:id"))}〕'
    parts = text.split('\n')
    result = []
    for index, part in enumerate(parts):
        if index:
            result.append({'type':'hardBreak'})
        if part:
            node = {'type':'text','text':part}
            if marks:
                node['marks'] = marks
            result.append(node)
    return result


def paragraph_heading(p):
    """Use Word's explicit outline level, including inherited custom styles."""
    def declared(properties):
        outline = properties.find(qn('w:outlineLvl')) if properties is not None else None
        if outline is None:
            return None
        value = int(outline.get(qn('w:val')))
        if value not in range(10):
            raise CreationError('DOCX 段落大纲级别无法读取，请检查原件。')
        return 0 if value == 9 else value + 1
    level = declared(p._p.pPr)
    if level is not None:
        return level
    style,seen = p.style,set()
    while style is not None and style.style_id not in seen:
        seen.add(style.style_id)
        level = declared(style.element.pPr)
        if level is not None:
            return level
        heading = re.fullmatch(r'Heading\s*([1-9])',style.name or '',re.I)
        if heading:
            return int(heading[1])
        style = style.base_style
    return 0


def paragraph_node(p):
    contents = []
    def read_inline(element):
        for child in element:
            if child.tag==qn('w:r'):
                contents.extend(run_nodes(Run(child,p)))
            elif child.tag==qn('w:hyperlink'):
                link=Hyperlink(child,p)
                href=link.url
                marks=[{'type':'link','attrs':{'href':href}}] if href.startswith(('https://','http://','mailto:')) else []
                for run in link.runs:
                    contents.extend(run_nodes(run,marks))
            elif child.tag in (qn('w:sdt'),qn('w:sdtContent'),qn('w:customXml'),qn('w:smartTag'),qn('w:fldSimple')):
                read_inline(child)
    read_inline(p._p)
    level = paragraph_heading(p)
    node = {'type':'heading' if level else 'paragraph','content':contents}
    if level:
        node['attrs'] = {'level':min(level, 6)}
    return node, level


def docx_notes(doc):
    notes={}
    for relationship in doc.part.rels.values():
        kind=relationship.reltype.rsplit('/',1)[-1]
        if kind not in ('footnotes','endnotes','comments'): continue
        root=parse_xml(relationship.target_part.blob)
        for note in root:
            if note.get(qn('w:type'),'normal')=='normal':
                notes[(kind,note.get(qn('w:id')))]=note
    return notes


def extras(element, doc, warnings, notes, context=None, depth=0):
    # Textbox placement is anchored, not a promise to reproduce page geometry.
    for box in element.xpath('.//w:txbxContent'):
        warnings.append('文本框正文已置于锚点段落之后；浮动位置和阅读顺序请对照原件核对。')
        for block,_,_,_ in docx_blocks(doc,warnings,box,notes,context,depth):
            yield block,0,'',''
    boxed_references={r for box in element.xpath('.//w:txbxContent') for r in box.iter()
                      if r.tag in (qn('w:footnoteReference'),qn('w:endnoteReference'),qn('w:commentReference'))}
    for reference in element.xpath('.//w:footnoteReference | .//w:endnoteReference | .//w:commentReference'):
        if reference in boxed_references: continue
        kind={'footnoteReference':'footnotes','endnoteReference':'endnotes','commentReference':'comments'}[reference.tag.rsplit('}',1)[-1]]
        identity=reference.get(qn('w:id'))
        note=notes.get((kind,identity))
        label={'footnotes':'脚注','endnotes':'尾注','comments':'批注'}[kind]
        if note is None:
            raise CreationError(f'{label} {identity} 缺少正文，不能完整读取，请检查原件。')
        warnings.append('脚注、尾注与批注已在引用段落之后展开，原始编号及位置请核对；批注仍是作者注释，不自动成为设定。')
        yield {'type':'paragraph','content':[{'type':'text','text':f'〔{label} {identity}〕'}]},0,'',''
        for block,_,_,_ in docx_blocks(doc,warnings,note,notes,context,depth):
            yield block,0,'',''


def docx_blocks(doc, warnings, container=None, notes=None, context=None, depth=0):
    notes=docx_notes(doc) if notes is None else notes
    list_stack = []
    for element in doc.element.body if container is None else container:
        if element.tag.endswith('}p'):
            p = Paragraph(element, doc)
            node, heading = paragraph_node(p)
            if any(e.tag.rsplit('}',1)[-1] in ('blip','imagedata') for e in p._p.iter()):
                warnings.append('文中图片未转换，原始图片保留在 DOCX 附件中，请核对。')
            style = p.style.name if p.style else ''
            number = p._p.pPr.numPr if p._p.pPr is not None else None
            is_list = number is not None or style.startswith(('List Bullet','List Number'))
            if is_list and not heading:
                level = int(number.ilvl.val) if number is not None and number.ilvl is not None else 0
                list_id = str(number.numId.val) if number is not None and number.numId is not None else style
                ordered = style.startswith('List Number')
                start = 1
                if number is not None and number.numId is not None:
                    numbering = doc.part.numbering_part.element
                    num = next((n for n in numbering.num_lst if n.numId==number.numId.val), None)
                    abstract = next((n for n in numbering.findall(qn('w:abstractNum')) if num is not None and int(n.get(qn('w:abstractNumId')))==num.abstractNumId.val), None)
                    if abstract is not None:
                        lvl = next((n for n in abstract.findall(qn('w:lvl')) if int(n.get(qn('w:ilvl')))==level), None)
                        if lvl is not None:
                            fmt, first = lvl.find(qn('w:numFmt')), lvl.find(qn('w:start'))
                            ordered = fmt is not None and fmt.get(qn('w:val')) != 'bullet'
                            start = int(first.get(qn('w:val'))) if first is not None else 1
                            if fmt is not None and fmt.get(qn('w:val')) not in ('bullet','decimal'):
                                warnings.append('非十进制列表编号转为数字列表，原始编号样式保留在 DOCX 附件中。')
                while list_stack and (list_stack[-1]['level'] > level or list_stack[-1]['id'] != list_id):
                    list_stack.pop()
                if not list_stack or list_stack[-1]['level'] < level:
                    listing = {'type':'orderedList' if ordered else 'bulletList','content':[]}
                    if ordered:
                        listing['attrs'] = {'start':start}
                    if list_stack:
                        list_stack[-1]['node']['content'][-1]['content'].append(listing)
                    else:
                        # Yield a mutable node; subsequent list items complete that same block.
                        yield listing, 0, '', ''
                    list_stack.append(dict(level=level,id=list_id,node=listing))
                list_stack[-1]['node']['content'].append({'type':'listItem','content':[node]})
                for block,_,_,_ in extras(element,doc,warnings,notes,context,depth):
                    list_stack[-1]['node']['content'][-1]['content'].append(block)
            else:
                list_stack = []
                title=inspect_document({'type':'doc','content':[node]})[0]
                yield node, heading, title, 'volume' if heading==1 else 'chapter' if heading==2 else 'section'
                yield from extras(element,doc,warnings,notes,context,depth)
        elif element.tag.endswith('}tbl'):
            list_stack = []
            # Read physical cells once. row.cells aliases vertical merges to the
            # cell above and can discard text in continuation cells or fail when
            # a revision view has removed the merge's starting row.
            for row_index,row in enumerate(element.findall(qn('w:tr'))):
                yield {'type':'paragraph','content':[{'type':'text','text':f'〔表格第 {row_index+1} 行〕'}]},0,'',''
                before = row.find('./'+qn('w:trPr')+'/'+qn('w:gridBefore'))
                column = int(before.get(qn('w:val'),'0')) if before is not None else 0
                for cell in row.findall(qn('w:tc')):
                    yield {'type':'paragraph','content':[{'type':'text','text':f'〔表格第 {column+1} 列〕'}]},0,'',''
                    for block,_,_,_ in docx_blocks(doc,warnings,cell,notes,context,depth):
                        yield block,0,'',''
                    span = cell.find('./'+qn('w:tcPr')+'/'+qn('w:gridSpan'))
                    column += int(span.get(qn('w:val'),'1')) if span is not None else 1
            warnings.append('表格正文按行列展开，保留单元格文字格式和嵌套表格；每个原始单元格的实际正文读取一次，合并布局请核对原件。')
        elif element.tag==qn('w:txbxContent'):
            # Also handle a standalone box in malformed-but-readable source documents.
            warnings.append('文本框正文已展开，原始位置请对照附件核对。')
            yield from docx_blocks(doc,warnings,element,notes,context,depth)
        elif element.tag in (qn('w:sdt'),qn('w:customXml')):
            list_stack = []
            body=element.find(qn('w:sdtContent')) if element.tag==qn('w:sdt') else element
            if body is not None:
                yield from docx_blocks(doc,warnings,body,notes,context,depth)
            warnings.append('内容控件与自定义 XML 中的正文已展开，控件行为及版式未转换。')
        elif element.tag==qn('w:altChunk') and context is not None:
            list_stack = []
            embedded = context.embedded(element,doc,depth)
            if embedded is not None:
                embedded_notes = docx_notes(embedded)
                context.prepare(embedded,embedded_notes,embedded=True)
                yield from docx_blocks(embedded,warnings,notes=embedded_notes,context=context,depth=depth+1)


def pdf_image_info(page):
    """Read image dimensions without decoding codecs such as JBIG2.

    PDFium renders the original for OCR. pypdf image extraction would introduce
    a separate decoder dependency merely to display a pixel-quality hint.
    """
    found, sizes, seen = False, [], set()
    pending = [(page,page.get_contents(),{})]
    while pending:
        container, content, inherited = pending.pop()
        if id(container) in seen:
            continue
        seen.add(id(container))
        resources = container.get('/Resources',inherited)
        resources = resources.get_object() if hasattr(resources,'get_object') else resources
        xobjects = (resources or {}).get('/XObject')
        xobjects = xobjects.get_object() if xobjects is not None else {}
        for image in xobjects.values():
            image = image.get_object()
            if image.get('/Subtype')=='/Image':
                found = True
                width,height = image.get('/Width'),image.get('/Height')
                if width and height:
                    sizes.append(dict(width=int(width),height=int(height)))
            elif image.get('/Subtype')=='/Form':
                pending.append((image,ContentStream(image,page.pdf),resources))
        for operands,operator in content.operations if content is not None else []:
            if operator==b'INLINE IMAGE':
                found = True
                settings=operands['settings']
                width=settings.get('/W',settings.get('/Width'));height=settings.get('/H',settings.get('/Height'))
                if width and height:
                    sizes.append(dict(width=int(width),height=int(height)))
    return found,sizes


def parse_file(name, raw, docx_revision_view=None):
    suffix = Path(name).suffix.lower()
    warnings, blocked, ocr_pages = [], False, []
    if suffix in {'.txt', '.md', '.markdown'}:
        text = decode_text(raw, warnings)
        if suffix == '.txt':
            chapters = build_chapters(name, text_blocks(text))
        else:
            doc = markdown_document(text)
            blocks = []
            for block in doc['content']:
                level = block.get('attrs',{}).get('level',0) if block['type']=='heading' else 0
                title = inspect_document({'type':'doc','content':[block]})[0]
                blocks.append((block, level, title, 'volume' if level==1 else 'chapter' if level==2 else 'section'))
            chapters = build_chapters(name, blocks)
            warnings.append('Markdown 标题、列表、引用和常用文字格式已转换；图片及相对路径链接尚未建立编辑器绑定，原语法保留在附件。')
    elif suffix == '.docx':
        doc = Document(BytesIO(raw))
        notes = docx_notes(doc)
        context = DocxContext(docx_revision_view,warnings,decode_text)
        context.prepare(doc,notes)
        chapters = build_chapters(name, docx_blocks(doc,warnings,notes=notes,context=context))
        context.finish()
        blocked = context.blocked
        warnings.append('DOCX 标题、常用文字格式、外部链接及列表已转换；页式排版和复杂样式仍需核对原件。')
    elif suffix == '.pdf':
        reader = PdfReader(BytesIO(raw))
        chapters = []
        for index, page in enumerate(reader.pages):
            text = page.extract_text() or ''
            has_images,sizes = pdf_image_info(page)
            chapter = build_chapters(name, [({'type':'paragraph','content':[{'type':'text','text':text}] if text else []},0,'','')])[0]
            chapter.update(title=f'{Path(name).stem} · 第 {index+1} 页', kind='page')
            chapters.append(chapter)
            if not text.strip():
                blocked = True
                ocr_pages.append(dict(page=index,chapter_key=chapter['key'],status='pending'))
                warnings.append(f'第 {index+1} 页没有可读取的正文，可进行本机 OCR；识别并核对前不能导入。')
            elif has_images:
                blocked = True
                ocr_pages.append(dict(page=index,chapter_key=chapter['key'],status='pending',mode='mixed',text_layer=text))
                warnings.append(f'第 {index+1} 页同时包含文字层与图像，请先本机识别并对照原页处理图中正文；不能只确认通用提示后导入。')
            if ocr_pages and ocr_pages[-1]['page']==index:
                quality = (['原页图像像素较少，放大无法恢复缺失细节；请特别核对错字、漏字，并在必要时重新扫描。']
                           if sizes and max(max(s['width'],s['height']) for s in sizes)<1000 else [])
                ocr_pages[-1].update(source_image_sizes=sizes,quality_warnings=quality)
                warnings.extend(f'第 {index+1} 页：{message}' for message in quality)
        warnings.append('PDF 阅读顺序和排版需人工核对；按页保留，不推断章节或故事时间。')
    else:
        raise CreationError('当前支持 TXT、Markdown、DOCX 和含文字的 PDF。')
    if not chapters or not any(c['text'].strip() for c in chapters):
        blocked = True
        warnings.append('没有识别到正文，请保留原始文件并检查格式。')
    return dict(chapters=chapters, warnings=list(dict.fromkeys(warnings)), blocked=blocked,ocr_pages=ocr_pages,
                revision_view=docx_revision_view if suffix=='.docx' else None)
