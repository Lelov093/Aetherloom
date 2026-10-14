import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CheckCheck,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import { Button, Dialog, EmptyState, ErrorNotice } from "../../components/ui";
import { ExtractionDiagnostics } from "./ExtractionDiagnostics";
import { creationApi, entityKinds, type Entity } from "../creation/api";
import { EntityMark } from "../../components/EntityMark";
import { ReviewDetail } from "./ReviewDetail";
import { ReviewFrame, ReviewInboxHeader, ReviewStatusTabs } from "./ReviewFrame";
import { useReviewPreview } from "./useReviewPreview";
import {
  reviewApi,
  fieldTypeNames,
  kindNames,
  statusNames,
  taskNames,
  proposalTitle,
  proposalValue,
  type Inbox,
  type Preview,
  type Decision,
  type MergeEffect,
} from "./api";

const priorityNames = {
  blocking: "来源需核对",
  important: "重要 / 差异",
  normal: "抽取候选",
  low: "低置信候选",
};
const priorityOrder = { blocking: 0, important: 1, normal: 2, low: 3 };

export function ReviewWorkspace({ world }: { world: string }) {
  const [params, setParams] = useSearchParams(),
    selectedId = params.get("candidate");
  const [inbox, setInbox] = useState<Inbox>(),
    [entities, setEntities] = useState<Entity[]>([]);
  const [error, setError] = useState(""),
    [status, setStatus] = useState("pending"),
    [kind, setKind] = useState(""),
    [work, setWork] = useState(""),
    [object, setObject] = useState(""),
    [priority, setPriority] = useState(""),
    [sort, setSort] = useState("priority");
  const [selected, setSelected] = useState<string[]>([]),
    [confirmation, setConfirmation] = useState<{
      revision: number;
      decisions: Decision[];
      previews: Preview[];
      mergeEffects: MergeEffect[];
    }>(),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [inferenceConfirmed, setInferenceConfirmed] = useState(false);
  const comparison = useReviewPreview(world, selectedId, reviewApi.preview), preview = comparison.value;
  const route = useRef({ world, selectedId });
  route.current = { world, selectedId };
  async function reload() {
    const targetWorld = world;
    const [data, objects] = await Promise.all([
      reviewApi.inbox(world),
      creationApi.entities(world),
    ]);
    if (route.current.world !== targetWorld) return;
    setInbox(data);
    setEntities(objects);
    await comparison.reload();
  }
  useEffect(() => {
    let active = true;
    setInbox(undefined);
    setError("");
    Promise.all([reviewApi.inbox(world), creationApi.entities(world)])
      .then(([data, objects]) => {
        if (active) {
          setInbox(data);
          setEntities(objects);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [world]);
  useEffect(() => {
    setMessage(""); setConfirmation(undefined); setInferenceConfirmed(false);
  }, [world, selectedId]);
  const tasksActive = inbox?.tasks.some((t) =>
    ["queued", "running"].includes(t.status),
  );
  useEffect(() => {
    if (!tasksActive) return;
    let active = true;
    const timer = setInterval(
      () =>
        reviewApi
          .inbox(world)
          .then(value => { if (active) setInbox(value); })
          .catch((e) => { if (active) setError(e.message); }),
      1500,
    );
    return () => { active = false; clearInterval(timer); };
  }, [tasksActive, world]);
  async function prepare(decisions: Decision[]) {
    if (busy || (decisions.length === 1 && decisions[0].candidate_id === selectedId && (!comparison.current || comparison.loading))) return;
    const target = route.current;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (decisions.length > 100)
        throw new Error("每次裁决最多 100 项，请缩小选择范围。");
      const previews = await Promise.all(
        decisions.map((d) => reviewApi.preview(d.candidate_id)),
      );
      const revision = previews[0].revision;
      if (previews.some((p) => p.revision !== revision))
        throw new Error("设定在预览时发生变化，请重试比较。");
      if (
        decisions.length > 1 &&
        decisions.some((d) => d.action === "accept")
      ) {
        const accepted = new Set(
          decisions
            .filter((d) => d.action === "accept")
            .map((d) => d.candidate_id),
        );
        const highRisk = previews.some(
          (p) =>
            p.source.stale ||
            p.source.archived ||
            p.conflicts.length ||
            p.requires_evidence_confirmation ||
            p.identity_matches.some((m) => m.scope === "candidate") ||
            ((p.candidate.kind === "entity" || p.candidate.kind === "event") &&
              p.current.length) ||
            p.dependencies.some(
              (d) => !d.candidate_id || !accepted.has(d.candidate_id),
            ),
        );
        if (highRisk)
          throw new Error(
            "选中项包含来源变化、未解决身份或 Canon 差异。请先逐项比较这些候选；其余可继续批量处理。",
          );
      }
      if (previews.some((p, i) => p.candidate.version !== decisions[i].version))
        throw new Error("候选已更新，请重新载入后比较。");
      // Dry-run only: inference permission is still collected in the final human confirmation.
      const result = await reviewApi.previewApply(
        world,
        revision,
        decisions.map((d, i) => ({
          ...d,
          acknowledge_inference: previews[i].requires_evidence_confirmation,
        })),
      );
      if (target.world === route.current.world && target.selectedId === route.current.selectedId) {
        setInferenceConfirmed(false);
        setConfirmation({ revision, decisions, previews, mergeEffects: result.merge_effects });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const refTargets = new Map(
    (inbox?.candidates || [])
      .filter((c) => c.kind === "entity" && c.target_id)
      .map((c) => [`${c.task_id}/${c.local_key}`, c.target_id]),
  );
  const list = (inbox?.candidates || [])
    .filter(
      (c) =>
        (status === "all" ||
          (status === "pending"
            ? ["pending", "later"].includes(c.status)
            : status === "processed"
              ? !["pending", "later"].includes(c.status)
              : c.status === status)) &&
        (!kind || c.kind === kind) &&
        (!work || c.work_id === work) &&
        (!priority || c.priority === priority) &&
        (!object ||
          c.target_id === object ||
          [
            c.payload.subject_ref,
            c.payload.object_ref,
            c.payload.location_ref,
            ...(c.payload.participants || []),
          ].some(
            (ref) =>
              ref === object ||
              refTargets.get(`${c.task_id}/${ref}`) === object,
          )),
    )
    .sort((a, b) =>
      sort === "priority"
        ? priorityOrder[a.priority || "normal"] -
          priorityOrder[b.priority || "normal"]
        : b.created_at.localeCompare(a.created_at),
    );
  const works = [
    ...new Map(
      (inbox?.candidates || []).map((c) => [c.work_id, c.work_title]),
    ).entries(),
  ];
  const selectedCandidates = (inbox?.candidates || []).filter(
    (c) => selected.includes(c.id) && ["pending", "later"].includes(c.status),
  );
  function toggle(id: string, checked: boolean) {
    setSelected((s) =>
      checked ? [...new Set([...s, id])] : s.filter((v) => v !== id),
    );
  }
  function subjectEntity(c: Inbox["candidates"][number]) {
    const ref = c.payload.subject_ref;
    const id = refTargets.get(`${c.task_id}/${ref}`) || ref;
    return entities.find((e) => e.id === id);
  }
  function issueTitle(c: Inbox["candidates"][number]) {
    const ref = c.payload.subject_ref;
    const name =
      subjectEntity(c)?.name ||
      inbox?.candidates.find(
        (e) => e.task_id === c.task_id && e.local_key === ref,
      )?.payload.name;
    return name
      ? `${name} · ${proposalTitle(c.payload)}`
      : proposalTitle(c.payload);
  }
  const inboxPanel = (
      <aside className="review-inbox" aria-label="审阅收件箱">
        <ReviewInboxHeader world={world}/>
        <ReviewStatusTabs status={status} pending={inbox?.candidates.filter(c => ['pending', 'later'].includes(c.status)).length || 0} onChange={value => { setStatus(value); setSelected([]); }}/>
        <details className="review-filter-panel">
          <summary>
            <SlidersHorizontal size={15} />
            筛选收件箱
            <span>
              {[kind, work, object, priority].filter(Boolean).length
                ? `${[kind, work, object, priority].filter(Boolean).length} 项条件`
                : "全部候选"}
            </span>
          </summary>
          <div className="review-filters">
            <label>
              类型
              <select
                aria-label="候选类型"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="">全部类型</option>
                {Object.entries(kindNames).map(([id, name]) => (
                  <option value={id} key={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              作品
              <select
                aria-label="候选来源作品"
                value={work}
                onChange={(e) => setWork(e.target.value)}
              >
                <option value="">全部作品</option>
                {works.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              人物 / 地点
              <select
                aria-label="候选影响对象"
                value={object}
                onChange={(e) => setObject(e.target.value)}
              >
                <option value="">全部对象</option>
                {entities.map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              关注项
              <select
                aria-label="审阅优先级"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="">全部优先级</option>
                {Object.entries(priorityNames).map(([id, name]) => (
                  <option value={id} key={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        <div className="review-sort">
          <select
            aria-label="候选排序"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="priority">按优先级</option>
            <option value="newest">按最新时间</option>
          </select>
          <Button
            variant="ghost"
            aria-label="刷新审阅"
            onClick={() => void reload().catch((e) => setError(e.message))}
          >
            <RotateCcw size={15} />
          </Button>
        </div>
        {status === "pending" && (
          <div className="batch-toolbar">
            <Button
              variant="ghost"
              onClick={() =>
                setSelected(
                  list
                    .filter(
                      (c) =>
                        c.confidence >= 0.9 &&
                        ["pending", "later"].includes(c.status),
                    )
                    .slice(0, 100)
                    .map((c) => c.id),
                )
              }
            >
              选择高置信项（最多100）
            </Button>
            {selectedCandidates.length > 0 && (
              <>
                <span>已选 {selectedCandidates.length}</span>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void prepare(
                      selectedCandidates.map((c) => ({
                        candidate_id: c.id,
                        version: c.version,
                        action: "accept",
                      })),
                    )
                  }
                >
                  预览接受
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void prepare(
                      selectedCandidates.map((c) => ({
                        candidate_id: c.id,
                        version: c.version,
                        action: "ignore",
                      })),
                    )
                  }
                >
                  忽略选中
                </Button>
              </>
            )}
          </div>
        )}
        <div className="review-issue-list">
          {list.map((c) => (
            <div
              className={`review-issue ${selectedId === c.id ? "selected" : ""}`}
              key={c.id}
            >
              {["pending", "later"].includes(c.status) && (
                <input
                  type="checkbox"
                  aria-label={`选择 ${issueTitle(c)}`}
                  checked={selected.includes(c.id)}
                  onChange={(e) => toggle(c.id, e.target.checked)}
                />
              )}
              <button
                type="button" disabled={busy} aria-current={selectedId === c.id ? "true" : undefined}
                onClick={() => {
                  setError("");
                  setParams({ candidate: c.id });
                }}
              >
                <div>
                  <span className="issue-identity">
                    <EntityMark
                      kind={
                        c.payload.entity_kind ||
                        subjectEntity(c)?.kind ||
                        inbox?.candidates.find(
                          (entity) =>
                            entity.kind === "entity" &&
                            entity.task_id === c.task_id &&
                            entity.local_key === c.payload.subject_ref,
                        )?.payload.entity_kind ||
                        "custom"
                      }
                      small
                    />
                    <strong>{issueTitle(c)}</strong>
                  </span>
                  <span
                    className={`review-status review-status--${c.priority || "normal"}`}
                  >
                    {c.status === "pending"
                      ? priorityNames[c.priority || "normal"]
                      : statusNames[c.status]}
                  </span>
                </div>
                <p>{proposalValue(c.payload).slice(0, 80)}</p>
                <small>
                  {kindNames[c.kind]} · {c.source_title} · v{c.source_version}
                </small>
              </button>
            </div>
          ))}
          {inbox && !list.length && (
            <p className="review-empty">
              当前筛选下没有提案。你可以继续整理资料，或从模拟结果中建立审阅提案。
            </p>
          )}
        </div>
        <details className="review-task-list">
          <summary>提取任务 · {inbox?.tasks.length || 0}</summary>
          {inbox?.tasks.map((t) => (
            <section key={t.id}>
              <strong>{taskNames[t.status]}</strong>
              <span>
                正文 v{t.source_version} · {t.completed_chunks}/{t.total_chunks}{" "}
                段
              </span>
              {t.error && <p>{t.error}</p>}
              {(t.status === "failed" || !!t.failure_count) && <ExtractionDiagnostics taskId={t.id} />}
              {["failed", "interrupted", "cancelled"].includes(t.status) && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await reviewApi.retry(t.id);
                      await reload();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  继续 / 重试
                </Button>
              )}
            </section>
          ))}
        </details>
      </aside>
  );
  return (<>
    <ReviewFrame inbox={inboxPanel} selection={selectedId}>
      <section className="review-primary" aria-label="审阅详情" aria-busy={comparison.loading}>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {message && (
          <p className="review-success" role="status">
            {message}
          </p>
        )}
        {(comparison.loading || comparison.error || (selectedId && !comparison.current)) && <div className="review-load-status" role="status">{comparison.error || '正在比较候选与当前设定…'}{comparison.error && <Button variant="ghost" onClick={() => void comparison.reload()}>重试比较</Button>}</div>}
        {preview ? (
          <div className="review-detail-holder" inert={!comparison.current || comparison.loading || busy}><ReviewDetail
            key={`${preview.candidate.id}-${preview.candidate.version}`}
            world={world}
            preview={preview}
            entities={entities}
            candidates={inbox?.candidates || []}
            active={comparison.current && !comparison.loading && !busy}
            onReload={reload}
            onDecision={(d) => d.candidate_id === route.current.selectedId && comparison.current && !comparison.loading ? prepare([d]) : Promise.resolve()}
          /></div>
        ) : selectedId ? (
          <p role="status">正在比较候选与当前设定…</p>
        ) : (
          <EmptyState
            icon={<CheckCheck size={30} />}
            title="为每条设定留下清晰的来处"
          >
            选择左侧候选，比较当前设定、原文证据、故事时间与影响对象。你不必一次处理所有内容。
          </EmptyState>
        )}
      </section>
    </ReviewFrame>
      {confirmation && (
        <Dialog
          title="确认审阅裁决"
          onClose={() => setConfirmation(undefined)}
          busy={busy}
        >
          <p className="dialog-intro">
            以下 {confirmation.decisions.length} 项将按你的选择处理。
            {confirmation.decisions.some((d) =>
              ["accept", "merge"].includes(d.action),
            )
              ? "接受 / 合并会写入正式设定；正文保持独立保存。"
              : "这些操作只更新候选状态，不修改 Canon。"}
          </p>
          <div className="decision-preview-list">
            {confirmation.decisions.map((d, i) => (
              <section key={d.candidate_id}>
                <strong>
                  {proposalTitle(confirmation.previews[i].candidate.payload)}
                </strong>
                <span>
                  {d.action === "accept"
                    ? "接受"
                    : d.action === "merge"
                      ? "合并到已确认身份"
                      : d.action === "reject"
                        ? "拒绝"
                        : d.action === "ignore"
                          ? "忽略"
                          : "稍后"}
                </span>
                <p>
                  {proposalValue(confirmation.previews[i].candidate.payload)}
                </p>
                {confirmation.previews[i].field_mapping && (
                  <p>将保存为：{confirmation.previews[i].field_mapping!.label} · {fieldTypeNames[confirmation.previews[i].field_mapping!.value_type || ""] || "未知类型"}
                    {" → "}{confirmation.previews[i].field_mapping!.value}
                  </p>
                )}
                {confirmation.previews[i].warnings?.map((w) => (
                  <p className="review-warning" key={w}>
                    {w}
                  </p>
                ))}
                <small>
                  来源：{confirmation.previews[i].source.title} v
                  {confirmation.previews[i].source.version}
                </small>
                {d.resolution === "replace" && (
                  <p className="review-warning">
                    重叠或时间未知的差异事实将标为已替代，旧记录保留。
                  </p>
                )}
                {d.resolution === "keep_both" && (
                  <p className="review-notice">
                    明确保留独立身份 / 事件，或保留差异事实双方。
                  </p>
                )}
                {d.resolution === "temporal" && <p className="review-notice">按已确认的有效时间新增记录，保留不同时间的当前记录。</p>}
                {d.action === "merge" && (
                  <div className="review-notice">
                    {confirmation.mergeEffects.filter((effect) => effect.candidate_id === d.candidate_id).map((effect) => (
                      <div key={effect.candidate_id}>
                        <p>目标：{effect.target_name} · {entityKinds[effect.target_kind]}（{effect.target_id}）</p>
                        <p>新增别名：{effect.added_aliases.join("、") || "无（已有这些名称）"}</p>
                        <p>{effect.dependent_candidate_ids.length} 项待审阅候选将引用这个身份；仍需单独裁决。</p>
                      </div>
                    ))}
                    <p>保留目标说明和稳定 ID；本候选身份说明不复制为事实。</p>
                  </div>
                )}
              </section>
            ))}
          </div>
          {confirmation.previews.some(
            (p, i) =>
              p.requires_evidence_confirmation &&
              ["accept", "merge"].includes(confirmation.decisions[i].action),
          ) && (
            <label className="inference-confirmation">
              <input
                type="checkbox"
                checked={inferenceConfirmed}
                onChange={(e) => setInferenceConfirmed(e.target.checked)}
              />
              我已核对身份引用及推断 / 改写内容，并明确认可为正式设定。
            </label>
          )}
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <div className="dialog-actions">
            <Button disabled={busy} onClick={() => setConfirmation(undefined)}>
              返回比较
            </Button>
            <Button
              variant="primary"
              disabled={
                busy ||
                (!inferenceConfirmed &&
                  confirmation.previews.some(
                    (p, i) =>
                      p.requires_evidence_confirmation &&
                      ["accept", "merge"].includes(
                        confirmation.decisions[i].action,
                      ),
                  ))
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await reviewApi.apply(
                    world,
                    confirmation.revision,
                    confirmation.decisions.map((d, i) => ({
                      ...d,
                      acknowledge_inference:
                        inferenceConfirmed &&
                        confirmation.previews[i].requires_evidence_confirmation,
                    })),
                  );
                  setConfirmation(undefined);
                  setSelected([]);
                  setMessage("裁决已保存。");
                  await reload();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "正在保存…" : "明确确认并保存"}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
