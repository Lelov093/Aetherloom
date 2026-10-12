import { useState } from "react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { reviewApi, type ExtractionFailures } from "./api";

/** Failed output is read-only evidence; it is never a selectable Review proposal. */
export function ExtractionDiagnostics({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ExtractionFailures>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function show() {
    setOpen(true);
    setBusy(true);
    setData(undefined);
    setError("");
    try { setData(await reviewApi.failures(taskId)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <>
    <Button variant="ghost" onClick={() => void show()}>查看失败详情</Button>
    {open && <Dialog title="提取失败详情" onClose={() => setOpen(false)}>
      <div className="extraction-diagnostics">
        <p className="dialog-intro">这里保留失败段落的输出和校验原因。查看不会调用模型，也不会将这些内容写入候选或正式设定。</p>
        {busy && <p role="status">正在读取…</p>}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {data && <p>正文 v{data.source_version} · {data.model}</p>}
        {data && !data.failures.length && <p>此任务没有保存可查看的失败详情。较早的任务未保留模型输出，无法补回。</p>}
        {data?.failures.map(f => <section className="extraction-failure" key={f.id}>
          <h3>第 {f.chunk_index + 1} 段 · {f.created_at}</h3>
          <p>{f.detail.message}</p>
          {f.detail.range && <p className="context-hint">原正文字符范围 {f.detail.range.start}–{f.detail.range.end}</p>}
          <ul>{f.detail.issues?.map((issue, i) => <li key={i}>
            {issue.item_key && <strong>候选 {issue.item_key} · </strong>}
            {issue.field && <span>{issue.field} · </span>}
            {issue.reference && <span>引用「{issue.reference}」 · </span>}{issue.message}
          </li>)}</ul>
          {!!f.detail.known_entities?.length && <details><summary>当段提供的对象</summary>
            <ul>{f.detail.known_entities.map(e => <li key={e.id}>{e.name} · {e.scope === "canon" ? "正式对象" : "本任务未确认候选"} · {e.id}</li>)}</ul>
          </details>}
          {!!f.detail.allowed_references?.length && <details><summary>当段允许的对象引用</summary><p>{f.detail.allowed_references.join("、")}</p></details>}
          {!!f.detail.source_blocks?.length && <details><summary>当段原文</summary>
            {f.detail.source_blocks.map(b => <blockquote key={b.id}><small>{b.id}</small><p>{b.text}</p></blockquote>)}
          </details>}
          {!!f.detail.stages?.length && f.detail.stages.map((stage, i) => <details key={i}>
            <summary>第 {i + 1} 步 · {(stage.step ?? stage.stage) === "mapping" ? "字段映射" : "原始提议"}
              {f.detail.failed_step === (stage.step ?? stage.stage) && " · 此步失败"}</summary>
            {stage.usage?.total_tokens !== undefined && <p>本步用量：{stage.usage.total_tokens} tokens</p>}
            <pre>{stage.raw_output ?? "未收到可保存的模型正文。"}</pre>
          </details>)}
          {!f.detail.stages?.length && <details><summary>模型输出（未通过校验）</summary>
            {f.detail.output_truncated && <p>输出超过保存上限，仅保留前 200,000 字符。</p>}
            <pre>{f.detail.raw_output ?? (f.detail.parsed_output ? JSON.stringify(f.detail.parsed_output, null, 2) : "未收到可保存的模型正文。")}</pre>
          </details>}
        </section>)}
      </div>
      <div className="dialog-actions"><Button onClick={() => setOpen(false)}>关闭</Button></div>
    </Dialog>}
  </>;
}
