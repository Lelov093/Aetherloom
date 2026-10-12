import { Button } from "../../components/ui";
import type { ImportOcrPage, ImportPageReview, ImportPreview } from "./importModel";

export function ImportPageCompare({ world, preview, selected, reviews, onSelect, onUseOcr, onReview }: {
  world: string;
  preview: ImportPreview;
  selected: string;
  reviews: ImportPageReview[];
  onSelect: (key: string) => void;
  onUseOcr: (page: ImportOcrPage) => void;
  onReview: (page: ImportOcrPage, resolution: ImportPageReview["resolution"] | undefined) => void;
}) {
  return <section aria-label="PDF 原页正文核对" className="import-page-reviews">
    <p className="context-hint">逐页对照原页与整页识别；有文字层时同时核对。OCR 可能重复文字或读错顺序，不自动拼接。请在下方正文编辑器补齐、去重和修正，再确认本页；拆分或合并后仍需核对最终预览。</p>
    {preview.ocr_pages?.map(p => {
      const review = reviews.find(r => r.file_index === p.file_index && r.page === p.page);
      const chapter = preview.chapters.find(c => c.key === p.chapter_key);
      const unchanged = chapter?.text === p.text_layer;
      const name = `${preview.files[p.file_index].name} · 第 ${p.page + 1} 页`;
      return <details key={`${p.file_index}:${p.page}`} open={selected === p.chapter_key}>
        <summary>{name} · {review ? "已核对" : "待核对"}</summary>
        {p.quality_warnings?.map(message => <p className="context-hint" key={message}>{message}</p>)}
        <a href={`/api/worlds/${world}/imports/${preview.id}/pages/${p.file_index}/${p.page}`} target="_blank" rel="noreferrer">打开完整原页</a>
        <img className="import-source-page" loading="lazy" src={`/api/worlds/${world}/imports/${preview.id}/pages/${p.file_index}/${p.page}`} alt={`${name}原页`} />
        <div className="import-text-comparison">
          {p.mode === "mixed" && <section><h3>原文字层</h3><pre>{p.text_layer}</pre></section>}
          <section><h3>整页 OCR 对照</h3><pre>{p.result?.text || p.error || "尚未识别"}</pre></section>
        </div>
        {chapter && <div className="preview-order">
          <Button onClick={() => onSelect(p.chapter_key)}>编辑此页正文</Button>
          <Button disabled={!p.result} onClick={() => onUseOcr(p)}>用整页 OCR 替换此页预览</Button>
        </div>}
        {p.mode === "mixed" && <label className="check-field"><input type="checkbox" disabled={p.status !== "recognized" || !unchanged}
          checked={review?.resolution === "text_layer"} onChange={e => onReview(p, e.target.checked ? "text_layer" : undefined)} />
          已对照原页，确认图像没有额外正文，保留原文字层</label>}
        <label className="check-field"><input type="checkbox" disabled={p.status !== "recognized"}
          checked={review?.resolution === "corrected"} onChange={e => onReview(p, e.target.checked ? "corrected" : undefined)} />
          {p.mode === "mixed" ? '已补齐并核对图中正文、重复文字和阅读顺序' : '已对照原页补齐并核对正文、错字和阅读顺序'}</label>
      </details>;
    })}
  </section>;
}
