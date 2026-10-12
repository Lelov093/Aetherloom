import { useEffect, useState } from "react";
import { Button, ErrorNotice } from "../../components/ui";
import { request } from "./api";

export function ImportSources({
  world,
  batch,
  pages,
  files,
}: {
  world: string;
  batch: string;
  pages?: string;
  files?: string;
}) {
  let refs: {file_index:number;page:number}[] = [];
  try {refs = JSON.parse(pages || '[]');} catch { /* Legacy imports have no page mapping. */ }
  let names:string[] = [];
  try {names=JSON.parse(files || '[]');} catch { /* Legacy imports show the batch. */ }
  const [source, setSource] = useState<{
      files: { name: string; url: string; revision_view?: string }[];
      warnings: string[];
    }>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setSource(undefined);
    setError("");
    request<{ files: { name: string; url: string; revision_view?: string }[]; warnings: string[] }>(
      `/worlds/${world}/imports/${batch}`,
    )
      .then((data) => {
        if (active) setSource(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [world, batch, retry]);
  return (
    <section className="context-section">
      <h3>{names.length ? '来源原件' : '本批导入原件'}</h3>
      {error && (
        <>
          <ErrorNotice>{error}</ErrorNotice>
          <Button onClick={() => setRetry((v) => v + 1)}>
            重新读取原件信息
          </Button>
        </>
      )}
      {!source && !error && <p role="status">正在读取来源…</p>}
      {source?.files.map((file, i) => (!names.length || names.includes(file.name)) && (
        <a key={i} className="object-inspector-link" href={file.url} download>
          {file.name} · 下载原件{file.revision_view && ` · 导入${file.revision_view === 'final' ? '修订后' : '修订前'}正文`}
          {refs.some(r=>r.file_index===i)&&` · 来源页 ${refs.filter(r=>r.file_index===i).map(r=>r.page).join('、')}`}
        </a>
      ))}
      {!!source?.warnings.length && (
        <details>
          <summary>导入解析提示</summary>
          {source.warnings.map((warning, i) => (
            <p className="context-hint" key={i}>
              {warning}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
