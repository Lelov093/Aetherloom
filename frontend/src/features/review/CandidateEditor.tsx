import { useEffect, useState } from "react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { creationApi, entityKinds, type Entity, type FieldDefinition } from "../creation/api";
import { reviewApi, fieldTypeNames, type Candidate, type Proposal } from "./api";

export function CandidateEditor({
  candidate,
  entities,
  candidates,
  onClose,
  onSaved,
  saveOverride,
  sourceLabel = '原文证据',
}: {
  candidate: Candidate;
  entities: Entity[];
  candidates: Candidate[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  saveOverride?: (payload:Proposal)=>Promise<unknown>;
  sourceLabel?: string;
}) {
  const [data, setData] = useState<Proposal>({ ...candidate.payload }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [aliases, setAliases] = useState(
    candidate.payload.aliases?.join("，") || "",
  );
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  useEffect(() => {
    if (candidate.kind === "assertion") void creationApi.schema(candidate.world_id)
      .then((s) => setFields(s.fields)).catch((e) => setError(e.message));
  }, [candidate.world_id, candidate.kind]);
  const field = fields.find((f) => f.key === data.field_id);
  const options = [
    ...entities
      .filter((e) => e.status === "active")
      .map((e) => ({ id: e.id, name: e.name, kind: e.kind })),
    ...candidates
      .filter(
        (c) =>
          c.task_id === candidate.task_id &&
          c.kind === "entity" &&
          !["rejected", "ignored"].includes(c.status),
      )
      .map((c) => ({
        id: c.local_key,
        name: c.target_id ? `${c.payload.name} → ${entities.find((e) => e.id === c.target_id)?.name || "已确认身份"}` : `${c.payload.name} · 待审阅`,
        kind: entities.find((e) => e.id === c.target_id)?.kind || c.payload.entity_kind,
      })),
  ];
  const subjectKind = options.find((o) => o.id === data.subject_ref)?.kind;
  const availableFields = fields.filter((f) => !subjectKind || !f.kinds.length || f.kinds.includes(subjectKind));
  const incompatibleField = field && !availableFields.includes(field);
  function input(
    key: keyof Proposal,
    label: string,
    multiline = false,
    required = false,
  ) {
    const value = typeof data[key] === "string" ? (data[key] as string) : "";
    return (
      <label className="field" key={key}>
        <span>{label}</span>
        {multiline ? (
          <textarea
            value={value}
            rows={4}
            required={required}
            onChange={(e) => setData({ ...data, [key]: e.target.value })}
          />
        ) : (
          <input
            value={value}
            required={required}
            onChange={(e) =>
              setData({ ...data, [key]: e.target.value || null })
            }
          />
        )}
      </label>
    );
  }
  function reference(
    key: "subject_ref" | "object_ref" | "location_ref",
    label: string,
    optional = false,
  ) {
    return (
      <label className="field">
        <span>{label}</span>
        <select
          value={data[key] || ""}
          required={!optional}
          onChange={(e) => setData({ ...data, [key]: e.target.value || null })}
        >
          <option value="">
            {optional ? "未指定" : "选择世界对象或身份候选"}
          </option>
          {options
            .filter((o) => key !== "location_ref" || o.kind === "location")
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
        </select>
      </label>
    );
  }
  return (
    <Dialog title="编辑审阅候选" onClose={onClose} busy={busy}>
      <p className="dialog-intro">
        修改只保存候选，不写入正式设定。之后仍需明确裁决。
      </p>
      <form
        className="candidate-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await (saveOverride ? saveOverride(data) : reviewApi.edit(candidate, data));
            await onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {data.type === "entity" && (
          <>
            {input("name", "名称", false, true)}
            <label className="field">
              <span>类型</span>
              <select
                value={data.entity_kind}
                onChange={(e) =>
                  setData({ ...data, entity_kind: e.target.value })
                }
              >
                {Object.entries(entityKinds).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>别名</span>
              <input
                value={aliases}
                onChange={(e) => {
                  setAliases(e.target.value);
                  setData({
                    ...data,
                    aliases: e.target.value
                      .split(/[，,]/)
                      .map((v) => v.trim())
                      .filter(Boolean),
                  });
                }}
              />
            </label>
            {input("description", "身份说明", true)}
          </>
        )}
        {data.type === "assertion" && (
          <>
            {reference("subject_ref", "事实主体")}
            {input("predicate", "属性 / 事实名称", false, true)}
            {input("value", "事实内容", true, true)}
            <label className="field"><span>字段映射</span>
              <select value={data.field_id || ""} onChange={(e) => {
                const selected = fields.find((f) => f.key === e.target.value);
                setData({ ...data, field_id: selected?.key || null, typed_value: null,
                  predicate: selected?.label || data.predicate });
              }}>
                <option value="">自由文本事实</option>
                {data.field_id && !field && <option value={data.field_id}>不可用字段 · {data.field_id}</option>}
                {incompatibleField && <option value={field.key}>不适用于主体类型 · {field.label}</option>}
                {availableFields.map((f) => <option key={f.key} value={f.key}>{f.label} · {fieldTypeNames[f.value_type]}</option>)}
              </select>
            </label>
            {incompatibleField && <p className="review-warning">当前映射不适用于{entityKinds[subjectKind || ""] || "这个主体"}。请选择适用字段或自由文本事实。</p>}
            {field && ![field.key, field.label, ...field.aliases].some((name) => name.toLocaleLowerCase() === data.predicate?.trim().toLocaleLowerCase()) && (
              <div className="review-warning">
                <p>属性「{data.predicate}」与映射字段「{field.label}」不一致。请核对含义后明确修正，或取消映射。</p>
                <Button type="button" onClick={() => setData({ ...data, predicate: field.label })}>按所选字段修正属性名称</Button>
              </div>
            )}
            {field && field.value_type !== "entity" && (
              <label className="field"><span>类型化内容（{field.label}）</span>
                {field.value_type === "boolean" ? (
                  <select required value={data.typed_value === true ? "true" : data.typed_value === false ? "false" : ""}
                    onChange={(e) => setData({ ...data, typed_value: e.target.value === "" ? null : e.target.value === "true" })}>
                    <option value="">选择是或否</option><option value="true">是</option><option value="false">否</option>
                  </select>
                ) : (
                  <input required={field.value_type !== "text"} type={field.value_type === "number" ? "number" : "text"} step="any"
                    value={Array.isArray(data.typed_value) ? data.typed_value.join("，") : typeof data.typed_value === "boolean" ? "" : data.typed_value ?? (field.value_type === "text" ? data.value || "" : "")}
                    onChange={(e) => setData({ ...data, typed_value: field.value_type === "number"
                      ? e.target.value === "" ? null : Number(e.target.value)
                      : field.value_type === "tags" ? e.target.value.split(/[，,]/).map((v) => v.trim()).filter(Boolean) : e.target.value })} />
                )}
                {field.value_type === "text" && data.typed_value == null && <small>未单独修改类型化内容时，完整复制上方事实内容。</small>}
              </label>
            )}
            {reference("object_ref", "引用对象（可选）", true)}
          </>
        )}
        {data.type === "event" && (
          <>
            {input("title", "事件名称", false, true)}
            {input("description", "发生了什么", true, true)}
            {reference("location_ref", "地点（可选）", true)}
            <fieldset>
              <legend>参与者</legend>
              {options.map((o) => (
                <label className="participant-option" key={o.id}>
                  <input
                    type="checkbox"
                    checked={data.participants?.includes(o.id) || false}
                    onChange={(e) =>
                      setData({
                        ...data,
                        participants: e.target.checked
                          ? [...(data.participants || []), o.id]
                          : data.participants?.filter((id) => id !== o.id),
                      })
                    }
                  />
                  {o.name}
                </label>
              ))}
            </fieldset>
          </>
        )}
        {data.type === "relationship" && (
          <>
            {reference("subject_ref", "关系起点")}
            {reference("object_ref", "关系终点")}
            {input("label", "关系状态", false, true)}
            {input("description", "关系说明", true)}
          </>
        )}
        {data.type !== "entity" && (
          <div className="temporal-inputs">
            {input("valid_from", "生效故事时间（未知留空）")}
            {input("valid_until", "结束故事时间（未知留空）")}
          </div>
        )}
        <blockquote className="candidate-evidence">
          {sourceLabel}：{candidate.source_quote}
        </blockquote>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="dialog-actions">
          <Button type="button" onClick={onClose} disabled={busy}>
            取消编辑
          </Button>
          <Button variant="primary" disabled={busy}>
            {busy ? "正在保存…" : "保存候选"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
