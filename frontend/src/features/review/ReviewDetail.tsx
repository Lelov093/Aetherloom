import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftRight,
  Clock3,
  FileText,
  GitMerge,
  PenLine,
  CircleAlert,
  UsersRound,
} from "lucide-react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { entityKinds, type Entity } from "../creation/api";
import { EntityMark } from "../../components/EntityMark";
import { useWorkspaceTrail } from "../../components/WorkspaceContext";
import { Portrait, usePortraits } from "../objects/Portrait";
import { CanonSources } from "./CanonSources";
import { CandidateEditor } from "./CandidateEditor";
import {
  reviewApi,
  fieldTypeNames,
  kindNames,
  statusNames,
  proposalTitle,
  proposalValue,
  type Preview,
  type Candidate,
  type Decision,
} from "./api";

export function ReviewDetail({
  world,
  preview,
  entities,
  candidates,
  onReload,
  onDecision,
  active = true,
}: {
  world: string;
  preview: Preview;
  entities: Entity[];
  candidates: Candidate[];
  onReload: () => Promise<void>;
  onDecision: (d: Decision) => Promise<void>;
  active?: boolean;
}) {
  const { portraits } = usePortraits(world);
  const c = preview.candidate,
    p = c.payload;
  const [editing, setEditing] = useState(false),
    [sourceOpen, setSourceOpen] = useState(false),
    [rebinding, setRebinding] = useState(false);
  const [quote, setQuote] = useState(preview.source.quote),
    [mergeTarget, setMergeTarget] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = ["pending", "later"].includes(c.status),
    blocked =
      preview.source.stale ||
      preview.source.archived ||
      preview.dependencies.length > 0 ||
      Boolean(preview.field_mapping?.error);
  const duplicate =
    ["entity", "event"].includes(c.kind) && preview.current.length > 0;
  async function decide(
    action: Decision["action"],
    resolution?: Decision["resolution"],
  ) {
    await onDecision({
      candidate_id: c.id,
      version: c.version,
      action,
      resolution,
      target_id: action === "merge" ? mergeTarget : undefined,
    });
  }
  const refName = (ref?: string | null) =>
    entities.find((e) => e.id === ref)?.name ||
    candidates.find((e) => e.task_id === c.task_id && e.local_key === ref)
      ?.payload.name ||
    ref ||
    "未知";
  const referencedCandidate = candidates.find(
    (e) => e.task_id === c.task_id && e.local_key === p.subject_ref,
  );
  const subject = entities.find(
    (e) => e.id === p.subject_ref || e.id === referencedCandidate?.target_id,
  );
  const title = p.subject_ref
    ? `${refName(p.subject_ref)} · ${proposalTitle(p)}`
    : proposalTitle(p);
  useWorkspaceTrail([
    { label: "审阅收件箱", to: `/worlds/${world}/review` },
    { label: title },
  ]);
  return (
    <article className="review-detail">
      <div className="review-detail-content">
        <header className="review-detail-heading">
          <img
            className="review-heading-art"
            src="/art/harbor-light.webp"
            alt=""
            aria-hidden="true"
          />
          <div className="review-detail-identity">
            {subject?.kind === 'character' && portraits[subject.id] ? <Portrait id={subject.id} name={subject.name} version={portraits[subject.id]}/> : <EntityMark kind={p.entity_kind || subject?.kind || referencedCandidate?.payload.entity_kind || 'custom'}/>}
            <div>
              <span className="eyebrow">
                {kindNames[c.kind]} · {statusNames[c.status]}
              </span>
              <h1>{title}</h1>
              <p>理解来源与时间，再决定哪些内容属于你的世界。</p>
            </div>
          </div>
          <span
            className={`review-status review-status--${preview.conflicts.length ? "important" : "normal"}`}
          >
            {preview.conflicts.length > 0 && <CircleAlert size={13} />}
            {preview.conflicts.length
              ? "需要比较差异"
              : c.edited
                ? "已人工编辑"
                : "提取候选"}
          </span>
        </header>
        {!pending && (
          <p className="review-notice">
            此项已{statusNames[c.status]?.replace("已", "")}
            。裁决记录与原始来源保留；编辑正文不会覆盖已确认事实。
          </p>
        )}
        <div className="canon-comparison">
          <section className="canon-current">
            <h2>
              <FileText size={18} />
              当前设定
            </h2>
            <div
              className="canon-current-records"
              tabIndex={0}
              aria-label="当前已确认记录"
            >
              {preview.current.length ? (
                preview.current.map((record) => (
                  <div
                    className={`current-value ${record.value ? "current-value--fact" : ""}`}
                    key={record.id}
                  >
                    <strong>
                      {record.name ||
                        record.title ||
                        record.value ||
                        record.label}
                    </strong>
                    {record.description || record.aliases?.length ? (
                      <p>{record.description || record.aliases?.join("、")}</p>
                    ) : null}
                    {(record.valid_from || record.valid_until) && (
                      <span>
                        {record.valid_from || "起始未知"} →{" "}
                        {record.valid_until || "结束未知"}
                      </span>
                    )}
                    <CanonSources record={record} kind={c.kind} world={world}/>
                  </div>
                ))
              ) : (
                <p className="context-hint">尚无对应的已确认设定。</p>
              )}
            </div>
            <small className="canon-revision">
              当前设定版本 {preview.revision}
            </small>
          </section>
          <ArrowLeftRight className="comparison-arrow" size={23} />
          <section className="canon-candidate">
            <h2>
              <FileText size={18} />
              候选内容
            </h2>
            <strong className="candidate-value">{proposalValue(p)}</strong>
            {p.type === "entity" && <p>{p.aliases?.join("、")}</p>}
            {(p.subject_ref || p.object_ref) && (
              <p>
                {refName(p.subject_ref)}
                {p.object_ref ? ` → ${refName(p.object_ref)}` : ""}
              </p>
            )}
            {p.participants?.length ? (
              <p>参与者：{p.participants.map(refName).join("、")}</p>
            ) : null}
            {p.location_ref && <p>地点：{refName(p.location_ref)}</p>}
            {p.type !== "entity" && (
              <p>
                {p.valid_from || "起始未知"} → {p.valid_until || "结束未知"}
              </p>
            )}
            {preview.field_mapping && (
              <p>字段映射：{preview.field_mapping.label} · {fieldTypeNames[preview.field_mapping.value_type || ""] || "未知类型"}
                {" → "}{preview.field_mapping.value}
                {preview.field_mapping.error && <span className="review-warning"> · {preview.field_mapping.error}</span>}
              </p>
            )}
            <small>
              模型自评 {Math.round(c.confidence * 100)}% · 未经校准，不自动接受
            </small>
          </section>
        </div>
        {p.type === "entity" && preview.identity_matches.length > 0 && (
          <section className="identity-matches">
            <h2><UsersRound size={18} /> 名称与别名重叠</h2>
            <p className="context-hint">名称相同不代表同一身份。请比较类型与来源，明确选择合并或保持分离。</p>
            {preview.identity_matches.map((match) => (
              <div className="identity-match" key={`${match.scope}-${match.id}`}>
                <div>
                  <strong>{match.name} · {entityKinds[match.kind]}</strong>
                  <p>{match.scope === "canon" ? "已确认身份" : "同任务待审阅身份"} · 重叠名称：{match.matched_names.join("、")}</p>
                  {!match.same_kind && <small className="review-warning">对象类型不同，不能合并。请核对候选类型或保持独立。</small>}
                </div>
                {match.scope === "canon" ? (
                  <div className="identity-match-actions">
                    <Link className="text-link" to={`/worlds/${world}/create/objects/${match.id}`}>查看资料 →</Link>
                    {pending && match.same_kind && <Button onClick={() => setMergeTarget(match.id)}>
                      {mergeTarget === match.id ? "已选择此身份" : "选择为合并目标"}
                    </Button>}
                  </div>
                ) : (
                  <Link className="text-link" to={`/worlds/${world}/review?candidate=${match.id}`}>比较此候选来源 →</Link>
                )}
              </div>
            ))}
            {preview.identity_matches.some((match) => match.scope === "candidate") && (
              <p className="context-hint">若是同一身份，先单项确认其中一个，再将其余候选合并到它。它们的事实与关系仍需审阅。</p>
            )}
          </section>
        )}
        <div className="review-context-grid">
          <section className="source-context">
            <h2>
              <FileText size={18} />
              来源与上下文
            </h2>
            <div className="source-heading">
              <strong>
                {preview.source.work_title} / {preview.source.title}
              </strong>
              <Button variant="ghost" onClick={() => setSourceOpen(true)}>
                查看正文 v{preview.source.version} →
              </Button>
            </div>
            <blockquote>「{preview.source.quote}」</blockquote>
            {p.evidence && (
              <p className="context-hint">模型为此候选选择的原文：「{p.evidence.quote}」。仍需核对其含义。</p>
            )}
            {p.subject_evidence && <div className="context-hint">
              <p>主体词：「{p.subject_evidence.mention}」 · 当前指向：{refName(p.subject_ref)}</p>
              {p.subject_evidence.basis === "coreference" && <>
                <p>连接依据：「{p.subject_evidence.link_quote}」</p>
                <p>请核对这处代词或别名是否指向当前人物。</p>
              </>}
            </div>}
            {preview.source.context.trim() !== preview.source.quote.trim() && <p>{preview.source.context}</p>}
            {preview.source.occurrence_count > 1 && (
              <p className="review-notice">
                同一引用在此次提取范围内出现 {preview.source.occurrence_count}{" "}
                处。已保留全部位置；查看来源可比较各处上下文。
              </p>
            )}
            {preview.source.stale && (
              <div className="review-warning">
                <strong>
                  来源已更新：v{preview.source.version} → v
                  {preview.source.current_version}
                </strong>
                <p>
                  {pending
                    ? "旧候选不能直接接受。请重新核对引用，或从当前正文重新提取。"
                    : "此裁决使用历史来源；当前正文已更新，已确认事实保持不变。"}
                </p>
                {pending && (
                  <Button
                    onClick={() => {
                      setQuote(preview.source.quote);
                      setRebinding(true);
                    }}
                  >
                    核对当前正文与引用
                  </Button>
                )}
              </div>
            )}
            {preview.source.archived && (
              <p className="review-warning">
                来源文档或父对象已归档 / 删除。恢复后才能接受。
              </p>
            )}
          </section>
          <div className="review-secondary-context">
            {c.kind !== "entity" && (
              <section className="review-time">
                <h2>
                  <Clock3 size={18} />
                  时间背景
                </h2>
                <p>
                  候选：{p.valid_from || "未知"} → {p.valid_until || "未知"}
                  ；故事时间独立于保存时间。
                </p>
                {preview.temporal_change && (
                  <p className="temporal-notice">
                    已确认记录中存在明确不重叠的年份区间，可能属于时间变化。
                  </p>
                )}
                {preview.conflicts.length > 0 && (
                  <p className="review-warning">
                    {preview.conflicts.length}{" "}
                    条记录与候选不同，时间可能重叠或尚不明确。请编辑时间，或明确选择替换
                    / 保留双方。
                  </p>
                )}
              </section>
            )}
            {preview.affected_entities.length > 0 && (
              <section className="review-affected">
                <h2>
                  <UsersRound size={18} />
                  影响对象
                </h2>
                <div className="affected-objects">
                  {preview.affected_entities.map((e) => (
                    <Link
                      key={e.id}
                      to={`/worlds/${world}/create/objects/${e.id}`}
                    >
                      <EntityMark kind={e.kind} small />
                      <span>
                        {e.name}
                        <small>{entityKinds[e.kind]}</small>
                      </span>{" "}
                      →
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
        {preview.dependencies.length > 0 && (
          <section className="review-notice">
            <h2>先确认这些身份</h2>
            {preview.dependencies.map((d) => (
              <p key={d.ref}>
                {d.candidate_id ? (
                  <Link
                    to={`/worlds/${world}/review?candidate=${d.candidate_id}`}
                  >
                    {d.name} →
                  </Link>
                ) : (
                  `${d.name}（引用未解析，请编辑候选）`
                )}
              </p>
            ))}
          </section>
        )}
        {preview.warnings?.map((w) => (
          <p key={w} className="review-warning">
            {w}
          </p>
        ))}
        {error && <ErrorNotice>{error}</ErrorNotice>}
      </div>
      {pending && (
        <footer className="review-decision-bar">
          <Button variant="ghost" onClick={() => setEditing(true)}>
            <PenLine size={15} />
            编辑候选
          </Button>
          <Button variant="ghost" onClick={() => void decide("later")}>
            稍后处理
          </Button>
          <Button variant="ghost" onClick={() => void decide("ignore")}>
            忽略
          </Button>
          <Button onClick={() => void decide("reject")}>
            {preview.current.length ? "保留当前 / 拒绝" : "拒绝候选"}
          </Button>
          {duplicate ? (
            <Button
              variant="primary"
              disabled={blocked}
              onClick={() => void decide("accept", "keep_both")}
            >
              明确保持分离
            </Button>
          ) : preview.conflicts.length ? (
            <>
              <Button
                disabled={blocked}
                onClick={() => void decide("accept", "keep_both")}
              >
                明确保留双方
              </Button>
              <Button
                variant="primary"
                disabled={blocked}
                onClick={() => void decide("accept", "replace")}
              >
                接受并替换差异事实
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              disabled={blocked}
              onClick={() =>
                void decide(
                  "accept",
                  preview.temporal_change ? "temporal" : undefined,
                )
              }
            >
              {preview.temporal_change ? "按时间变化接受" : "接受候选"}
            </Button>
          )}
          {p.type === "entity" && (
            <div className="identity-merge">
              <label>
                合并 / 关联为别名
                <select
                  aria-label="身份合并目标"
                  value={mergeTarget}
                  onChange={(e) => setMergeTarget(e.target.value)}
                >
                  <option value="">选择已确认身份…</option>
                  {entities
                    .filter(
                      (e) => e.status === "active" && e.kind === p.entity_kind,
                    )
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} · {e.aliases.join("、") || "无别名"} · {e.id.slice(0, 8)}
                      </option>
                    ))}
                </select>
              </label>
              <Button
                disabled={blocked || !mergeTarget}
                onClick={() => void decide("merge")}
              >
                <GitMerge size={15} />
                确认同一身份
              </Button>
            </div>
          )}
        </footer>
      )}
      {editing && active && (
        <CandidateEditor
          candidate={c}
          entities={entities}
          candidates={candidates}
          onClose={() => setEditing(false)}
          onSaved={onReload}
        />
      )}
      {sourceOpen && active && (
        <Dialog
          title={`正文来源 · v${preview.source.version}（历史只读）`}
          onClose={() => setSourceOpen(false)}
        >
          <p className="dialog-intro">
            {preview.source.work_title} / {preview.source.title} · 引用保留{" "}
            {preview.source.occurrence_count} 处位置
          </p>
          {preview.source.contexts.map((text, i) => (
            <blockquote className="source-snapshot" key={i}>
              {text}
            </blockquote>
          ))}
          {preview.source.occurrence_count > 20 && (
            <p>这里只展示前 20 处；全部位置已保存在候选中。</p>
          )}
          <Link
            className="text-link"
            to={`/worlds/${world}/create?work=${preview.source.work_id}&node=${c.node_id}`}
          >
            打开当前正文 v{preview.source.current_version} →
          </Link>
        </Dialog>
      )}
      {rebinding && active && (
        <Dialog
          title="重新核对当前来源"
          onClose={() => setRebinding(false)}
          busy={busy}
        >
          <p className="dialog-intro">
            这是当前正文 v{preview.source.current_version}
            。确认表示你已重新检查候选内容与引用；操作只更新候选来源，不写入
            Canon。
          </p>
          <pre className="source-snapshot">{preview.source.current_text}</pre>
          <label className="field">
            <span>引用片段（必须存在于当前正文）</span>
            <textarea
              rows={3}
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
            />
          </label>
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <div className="dialog-actions">
            <Button
              disabled={busy}
              variant="primary"
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await reviewApi.recheck(
                    c,
                    preview.source.current_version,
                    quote,
                  );
                  await onReload();
                  setRebinding(false);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              确认当前引用，重新比较
            </Button>
          </div>
        </Dialog>
      )}
    </article>
  );
}
