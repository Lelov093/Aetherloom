import { lazy, Suspense, useState, type FormEvent } from "react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { FilePicker, TypeCombobox } from '../../components/FormControls';
import {
  emptyDocument,
  request,
  workKinds,
  type Work,
  type DocumentJSON,
} from "./api";
import {
  descendants,
  documentText,
  flatten,
  moveChapter,
  reparent,
  type ImportChapter,
  type ImportPreview,
  type ImportOcrPage,
  type ImportPageReview,
} from "./importModel";
import { ImportPageCompare } from "./ImportPageCompare";
import { MaterialClassification } from './MaterialClassification';
const ImportContentEditor = lazy(() =>
  import("./ImportContentEditor").then((m) => ({
    default: m.ImportContentEditor,
  })),
);

export function ImportDialog({
  world,
  onClose,
  onImported,
}: {
  world: string;
  onClose: () => void;
  onImported: (work: Work) => void;
}) {
  const [preview, setPreview] = useState<ImportPreview>(),
    [title, setTitle] = useState(""),
    [kind, setKind] = useState("novel"),
    [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [ack, setAck] = useState(false),
    [merging, setMerging] = useState(false);
  const [ocrLanguages,setOcrLanguages]=useState<{tag:string;name:string}[]>([]),
    [ocrLanguage,setOcrLanguage]=useState(''), [ocrReason,setOcrReason]=useState(''),
    [previewEdited,setPreviewEdited]=useState(false), [recognizing,setRecognizing]=useState(false);
  const [pageReviews, setPageReviews] = useState<ImportPageReview[]>([]);
  const [ocrRotation, setOcrRotation] = useState(0);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setAck(false);
    try {
      const body = new FormData(event.currentTarget);
      if (!body.get('docx_revision_view')) body.delete('docx_revision_view');
      const result = await request<ImportPreview>(
        `/worlds/${world}/imports/preview`,
        { method: "POST", body },
      );
      setPreview(result);
      setPageReviews([]);
      setOcrRotation(0);
      setPreviewEdited(false);
      if (result.ocr_pages?.length) {
        const info=await request<{languages:{tag:string;name:string}[];reason:string}>('/imports/ocr-capabilities');
        setOcrLanguages(info.languages);setOcrLanguage(info.languages[0]?.tag || '');setOcrReason(info.reason);
      }
      setSelected(result.chapters[0]?.key || "");
      setTitle(result.files[0]?.name.replace(/\.[^.]+$/, "") || "导入作品");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function recognizeScans() {
    if (!preview || previewEdited) return;
    setBusy(true);setRecognizing(true);setError('');setAck(false);
    try {
      const result=await request<ImportPreview>(`/worlds/${world}/imports/${preview.id}/ocr`,{
        method:'POST',body:JSON.stringify({language:ocrLanguage,rotation:ocrRotation})});
      setPreview(result);
    } catch(e) { setError((e as Error).message); }
    finally { setBusy(false);setRecognizing(false); }
  }
  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const work = await request<Work>(
        `/worlds/${world}/imports/${preview.id}/commit`,
        {
          method: "POST",
          body: JSON.stringify({
            title,
            kind,
            chapters: preview.chapters,
            acknowledged: ack,
            page_reviews: pageReviews,
          }),
        },
      );
      onImported(work);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const current = preview?.chapters.find((c) => c.key === selected),
    siblings =
      preview?.chapters.filter((c) => c.parent_key === current?.parent_key) ||
      [],
    index = siblings.findIndex((c) => c.key === selected),
    next = siblings[index + 1];
  const excludedParents = preview
    ? descendants(preview.chapters, selected)
    : new Set<string>();
  function setChapters(chapters: ImportChapter[]) {
    setPageReviews(reviews => reviews.filter(r => {
      const p = preview?.ocr_pages?.find(p => p.file_index === r.file_index && p.page === r.page);
      const before = preview?.chapters.find(c => c.key === p?.chapter_key);
      const after = chapters.find(c => c.key === p?.chapter_key);
      // Recheck prose edits; an explicit corrected-page decision can survive tree merging.
      return before?.text === after?.text || (!after && r.resolution === "corrected");
    }));
    if (preview) { setPreview({ ...preview, chapters });setPreviewEdited(true);setAck(false); }
  }
  function reviewPage(page: ImportOcrPage, resolution: ImportPageReview["resolution"] | undefined) {
    setPageReviews(reviews => [...reviews.filter(r => r.file_index !== page.file_index || r.page !== page.page),
      ...(resolution ? [{ file_index: page.file_index, page: page.page, resolution }] : [])]);
    setAck(false);
  }
  function useOcr(page: ImportOcrPage) {
    if (!preview || !page.result) return;
    const document: DocumentJSON = { type: "doc", content: page.result.text.split("\n").map(text => ({
      type: "paragraph", content: text ? [{ type: "text", text }] : [],
    })) };
    setChapters(preview.chapters.map(c => c.key === page.chapter_key ? { ...c, document, text: documentText(document) } : c));
    setSelected(page.chapter_key);
  }
  const missingPageReviews = preview?.ocr_pages?.some(p =>
    !pageReviews.some(r => r.file_index === p.file_index && r.page === p.page));
  function edit(value: Partial<ImportChapter>) {
    if (preview)
      setChapters(
        preview.chapters.map((c) =>
          c.key === selected ? { ...c, ...value } : c,
        ),
      );
  }
  function depth(chapter: ImportChapter) {
    let d = 0,
      c = chapter;
    const seen = new Set<string>();
    while (c.parent_key && !seen.has(c.key)) {
      seen.add(c.key);
      const parent = preview?.chapters.find((p) => p.key === c.parent_key);
      if (!parent) break;
      c = parent;
      d++;
    }
    return d;
  }
  function split(before: DocumentJSON, after: DocumentJSON) {
    if (!preview || !current) return;
    const created: ImportChapter = {
      ...current,
      key: crypto.randomUUID(),
      title: `${current.title.slice(0, 152)} · 后半`,
      document: after,
      text: documentText(after),
    };
    const at = preview.chapters.findIndex((c) => c.key === selected),
      chapters = [...preview.chapters];
    chapters[at] = { ...current, document: before, text: documentText(before) };
    chapters.splice(at + 1, 0, created);
    setChapters(flatten(chapters));
    setSelected(created.key);
  }
  function merge() {
    if (!preview || !current || !next) return;
    const document = {
      type: "doc",
      content: [
        ...(current.document.content || []),
        ...(next.document.content || []),
      ],
    };
    const files = [
      ...new Set(
        [
          current.source_file,
          ...(current.source_files || []),
          next.source_file,
          ...(next.source_files || []),
        ].filter(Boolean),
      ),
    ];
    setChapters(
      flatten(
        preview.chapters
          .filter((c) => c.key !== next.key)
          .map((c) =>
            c.key === selected
              ? {
                  ...c,
                  document,
                  text: documentText(document),
                  source_files: files,
                  source_pages: [...(current.source_pages || []), ...(next.source_pages || [])].filter((p, i, pages) =>
                    pages.findIndex(other => other.file_index === p.file_index && other.page === p.page) === i),
                }
              : c.parent_key === next.key
                ? { ...c, parent_key: current.key }
                : c,
          ),
      ),
    );
    setMerging(false);
  }
  return (
    <Dialog title="导入作品" onClose={onClose} busy={busy}>
      {!preview ? (
        <form onSubmit={upload}>
          <p className="dialog-intro">
            先预览层级与正文，再保存为作品。原件保留在本机，导入不触发 AI。
          </p>
          <label className="field">
            <span>选择文件（可多选）</span>
            <FilePicker
              aria-label="选择文件（可多选）"
              name="files"
              multiple
              accept=".txt,.md,.markdown,.docx,.pdf"
              required
            />
          </label>
          <label className="field"><span>DOCX 修订正文视图</span>
            <select name="docx_revision_view" defaultValue="">
              <option value="">未选择：遇到修订时停止导入</option>
              <option value="final">修订后正文：纳入新增／移入，排除删除／移出</option>
              <option value="original">修订前正文：保留删除／移出，排除新增／移入</option>
            </select>
          </label>
          <p className="context-hint">选择只决定导入的正文视图，不修改原件或接受其修订。支持文字与整行插入／删除；需要合并段落的标记、单元格及重叠行修订和未读嵌入对象仍会阻止导入。</p>
          <p className="import-note">
            扫描和文字层混合图像的 PDF 可进行本机 OCR；识别结果需对照原件核对。复杂版式的读取问题会明确提示。
          </p>
          <Button variant="primary" disabled={busy}>
            {busy ? "正在读取…" : "读取并预览"}
          </Button>
        </form>
      ) : (
        <div className="structured-import" inert={busy}>
          <div className="import-work-fields">
            <label className="field">
              <span>作品名称</span>
              <input
                value={title}
                maxLength={160}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              <span>作品类型</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(workKinds).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="context-hint">
            可调整目录、顺序和正文。关闭预览会放弃尚未导入的修改，原始附件不会改变。
          </p>
          {!!preview.ocr_pages?.some(p=>p.status!=='recognized') && (
            <section className="context-hint" aria-label="PDF 本机识别">
              <p>有 {preview.ocr_pages.filter(p=>p.status!=='recognized').length} 页待识别。本机处理，不上传原件或写入 Canon；每次最多 20 页，已完成页不重复识别。请先识别，再调整目录与正文。</p>
              {ocrReason && <p>{ocrReason}</p>}
              <label className="field"><span>识别语言</span><select aria-label="识别语言" value={ocrLanguage} onChange={e=>setOcrLanguage(e.target.value)} disabled={!ocrLanguages.length}>
                {ocrLanguages.map(l=><option key={l.tag} value={l.tag}>{l.name}</option>)}
              </select></label>
              <label className="field"><span>待处理页识别方向</span><select value={ocrRotation} onChange={e => setOcrRotation(Number(e.target.value))}>
                <option value={0}>按原页方向</option><option value={90}>顺时针转 90°</option>
                <option value={180}>转 180°</option><option value={270}>逆时针转 90°</option>
              </select></label>
              <p>方向只用于本次待处理页识别，原件保持不变；不同方向的文件请分批导入。</p>
              <Button onClick={recognizeScans} disabled={busy || !ocrLanguage || previewEdited}>{recognizing ? '正在本机识别…' : '识别待处理页'}</Button>
              {previewEdited && <p>预览已有修改，识别不会覆盖它们。请重新选择原件后先完成识别。</p>}
            </section>
          )}
          {!!preview.ocr_pages?.some(p=>p.status==='recognized') && <p className="context-hint">OCR 可能产生错字、遗漏或阅读顺序错误。请下载原件逐页核对并修正正文，再确认导入。</p>}
          <p className="context-hint">下载原件：{preview.files.map((f,index)=><a key={index} href={`/api/worlds/${world}/imports/${preview.id}/files/${index}`} download={f.name}>{f.name} </a>)}</p>
          {!!preview.ocr_pages?.length && <ImportPageCompare world={world} preview={preview}
            selected={selected} reviews={pageReviews} onSelect={setSelected} onUseOcr={useOcr} onReview={reviewPage} />}
          <div className="import-preview-layout">
            <aside className="import-preview-tree" aria-label="导入内容层级">
              {preview.chapters.map((c) => (
                <button
                  key={c.key}
                  aria-pressed={c.key === selected}
                  style={{ paddingLeft: 12 + depth(c) * 14 }}
                  onClick={() => setSelected(c.key)}
                >
                  <strong>{c.title}</strong>
                  <small>
                    {c.kind} · {c.source_file || "手工目录"}
                  </small>
                </button>
              ))}
              <Button
                onClick={() => {
                  const created: ImportChapter = {
                    key: crypto.randomUUID(),
                    parent_key: null,
                    title: "新目录",
                    kind: "volume",
                    format: "document",
                    document: emptyDocument,
                    text: "",
                    source_file: "",
                  };
                  setChapters([...preview.chapters, created]);
                  setSelected(created.key);
                }}
              >
                添加目录
              </Button>
            </aside>
            <section className="import-preview-content">
              {current && (
                <>
                  <MaterialClassification key={current.key} category={current.category || 'unclassified'} tags={current.tags || []}
                    onChange={(category,tags)=>edit({category,tags})}/>
                  <label className="field">
                    <span>内容标题</span>
                    <input
                      value={current.title}
                      maxLength={160}
                      onChange={(e) => edit({ title: e.target.value })}
                    />
                  </label>
                  <div className="import-work-fields">
                    <label className="field">
                      <span>内容类型</span>
                      <TypeCombobox
                        value={current.kind}
                        maxLength={40}
                        label="内容类型"
                        suggestions={['volume', 'chapter', 'section', 'act', 'scene', 'page', 'note']}
                        onValueChange={(value) => edit({ kind: value })}
                      />
                    </label>
                    <label className="field">
                      <span>所在目录</span>
                      <select
                        value={current.parent_key || ""}
                        onChange={(e) =>
                          setChapters(
                            reparent(
                              preview.chapters,
                              selected,
                              e.target.value || null,
                            ),
                          )
                        }
                      >
                        <option value="">作品根目录</option>
                        {preview.chapters
                          .filter((c) => !excludedParents.has(c.key))
                          .map((c) => (
                            <option key={c.key} value={c.key}>
                              {"　".repeat(depth(c))}
                              {c.title}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <div className="preview-order">
                    <Button
                      disabled={index <= 0}
                      onClick={() =>
                        setChapters(moveChapter(preview.chapters, selected, -1))
                      }
                    >
                      上移
                    </Button>
                    <Button
                      disabled={!next}
                      onClick={() =>
                        setChapters(moveChapter(preview.chapters, selected, 1))
                      }
                    >
                      下移
                    </Button>
                    <Button disabled={!next} onClick={() => setMerging(true)}>
                      合并下一同级内容
                    </Button>
                  </div>
                  <Suspense fallback={<p role="status">正在准备正文预览…</p>}>
                    <ImportContentEditor
                      key={current.key}
                      document={current.document}
                      onChange={(document) =>
                        edit({ document, text: documentText(document) })
                      }
                      onSplit={split}
                    />
                  </Suspense>
                </>
              )}
            </section>
          </div>
          {!!preview.warnings.length && (
            <details open={preview.blocked}>
              <summary>{preview.warnings.length} 条导入提示</summary>
              {preview.warnings.map((w, i) => (
                <p key={i} className="import-note">
                  {w}
                </p>
              ))}
            </details>
          )}
          {preview.warnings.length > 0 && !preview.blocked && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              我已核对预览和格式提示
            </label>
          )}
          <div className="dialog-actions">
            <Button
              disabled={busy}
              onClick={() => {
                setPreview(undefined);
                setError("");
              }}
            >
              重新选择
            </Button>
            <Button
              variant="primary"
              disabled={
                busy ||
                preview.blocked ||
                missingPageReviews ||
                !title.trim() ||
                preview.chapters.some(
                  (c) => !c.title.trim() || !c.kind.trim(),
                ) ||
                (preview.warnings.length > 0 && !ack)
              }
              onClick={commit}
            >
              {busy
                ? recognizing ? "正在本机识别…" : "正在导入…"
                : `确认导入 ${preview.chapters.length} 篇内容`}
            </Button>
          </div>
        </div>
      )}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {merging && current && next && (
        <Dialog title="合并导入预览内容？" onClose={() => setMerging(false)}>
          <p>
            将「{next.title}」的正文与子目录并入「{current.title}
            」。双方原件来源保留；尚未写入作品或 Canon。
          </p>
          <div className="dialog-actions">
            <Button onClick={() => setMerging(false)}>返回预览</Button>
            <Button variant="primary" onClick={merge}>
              确认合并预览
            </Button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
