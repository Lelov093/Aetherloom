import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Square, RotateCcw } from "lucide-react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { creationApi, type ContentNode } from "../creation/api";
import { reviewApi, taskNames, type Inbox } from "./api";
import { ExtractionDiagnostics } from "./ExtractionDiagnostics";

export function ExtractionPanel({
  world,
  nodeId,
  selection,
  prepare,
  allowSelection = true,
}: {
  world: string;
  nodeId: string;
  selection: string;
  prepare: () => Promise<boolean>;
  allowSelection?: boolean;
}) {
  const [inbox, setInbox] = useState<Inbox>(),
    [provider, setProvider] = useState<{
      configured: boolean;
      model: string;
      host: string;
    }>();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<{
      node: ContentNode;
      start?: number;
      end?: number;
      length: number;
    }>();
  async function load() {
    try {
      setInbox(await reviewApi.inbox(world));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    void reviewApi
      .provider()
      .then(setProvider)
      .catch((e) => setError(e.message));
  }, [world]);
  const active = inbox?.tasks.some(
    (t) => t.status === "queued" || t.status === "running",
  );
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => void load(), 1200);
    return () => clearInterval(interval);
  }, [active, world]);
  async function preview(selected: boolean) {
    setBusy(true);
    setError("");
    try {
      if (!(await prepare())) return;
      const node = await creationApi.node(nodeId);
      const text = node.plain_text || "";
      let start: number | undefined, end: number | undefined;
      if (selected) {
        start = text.indexOf(selection);
        if (!selection || start < 0 || text.indexOf(selection, start + 1) >= 0)
          throw new Error(
            "选区无法唯一对应已保存正文，请选择更完整的片段或提取整篇。",
          );
        // API offsets use Unicode code points, while JS string indices use UTF-16.
        start = Array.from(text.slice(0, start)).length;
        end = start + Array.from(selection).length;
      }
      if (!text.trim()) throw new Error("先写下一段正文，再整理世界信息。");
      setConfirm({
        node,
        start,
        end,
        length: selected ? selection.length : text.length,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="extraction-panel">
      <h2>
        <Sparkles size={18} />
        可选 AI 整理辅助
      </h2>
      <p className="context-hint">
        无需 AI 也能整理资料。当前辅助会尝试从来源片段提出人物、事件与事实候选，复杂作品可能失败或漏项；不等于稳定的指定对象辅助。结果先进入审阅，失败不影响手工整理。
      </p>
      <p className="provider-label">
        {provider?.configured
          ? `${provider.model} · ${provider.host}`
          : "Provider 未配置"}
      </p>
      <div className="extraction-actions">
        <Button
          variant="primary"
          disabled={busy || !provider?.configured}
          onClick={() => void preview(false)}
        >
          提取正文候选
        </Button>
        {allowSelection && <Button
          disabled={busy || !selection || !provider?.configured}
          onClick={() => void preview(true)}
        >
          仅提取当前选区
        </Button>}
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <Link className="text-link" to={`/worlds/${world}/review`}>
        前往审阅 ·{" "}
        {inbox?.candidates.filter(
          (c) => c.status === "pending" || c.status === "later",
        ).length || 0}{" "}
        项待处理 →
      </Link>
      <h3>本章提取任务</h3>
      {inbox?.tasks
        .filter((t) => t.node_id === nodeId)
        .map((t) => (
          <section className="extraction-task" key={t.id}>
            <strong>
              {taskNames[t.status]} · 正文 v{t.source_version}
            </strong>
            <span>
              {t.completed_chunks}/{t.total_chunks ?? t.chunks?.length ?? 1} 段
              · {t.provider_model}
            </span>
            {t.usage.total_tokens !== undefined && (
              <span>累计 {t.usage.total_tokens} tokens</span>
            )}
            {t.error && <p>{t.error}</p>}
            {(t.status === "failed" || !!t.failure_count) && <ExtractionDiagnostics taskId={t.id} />}
            {["queued", "running"].includes(t.status) ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void run(() => reviewApi.cancel(t.id))}
              >
                <Square size={13} />
                取消
              </Button>
            ) : (
              ["failed", "cancelled", "interrupted"].includes(t.status) && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void run(() => reviewApi.retry(t.id))}
                >
                  <RotateCcw size={13} />
                  继续 / 重试
                </Button>
              )
            )}
          </section>
        ))}
      {confirm && (
        <Dialog
          title="提取世界信息候选"
          onClose={() => setConfirm(undefined)}
          busy={busy}
        >
          <p className="dialog-intro">
            将向已配置 Provider 发送
            {confirm.start === undefined ? "本章正文" : "当前选区"}（
            {confirm.length} 字，约 {Math.ceil(confirm.length / 8000)}{" "}
            段）及相关对象的名称与别名。此次请求可能计费。
          </p>
          <p className="dialog-intro">
            正文 v{confirm.node.version} · {provider?.model}
            。结果不会自动写入正式设定。
          </p>
          <div className="dialog-actions">
            <Button onClick={() => setConfirm(undefined)} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await reviewApi.extract(
                    confirm.node.id,
                    confirm.node.version,
                    confirm.start,
                    confirm.end,
                  );
                  setConfirm(undefined);
                })
              }
            >
              {busy ? "正在提交…" : "开始提取"}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
