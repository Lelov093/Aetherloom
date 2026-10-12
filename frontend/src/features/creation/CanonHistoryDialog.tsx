import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import {
  creationApi,
  entityKinds,
  type CanonHistory,
  type Entity,
  type ObjectSchema,
} from "./api";

export function CanonHistoryDialog({
  kind,
  id,
  onClose,
}: {
  kind: string;
  id: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<CanonHistory[]>(),
    [error, setError] = useState(""),
    [entities, setEntities] = useState<Entity[]>([]),
    [schema, setSchema] = useState<ObjectSchema>();
  useEffect(() => {
    let active = true;
    creationApi
      .canonHistory(kind, id)
      .then(async (data) => {
        if (!active) return;
        setItems(data);
        const world = String(data[0]?.payload.world_id || "");
        if (world) {
          const [e, s] = await Promise.all([
            creationApi.entities(world),
            creationApi.schema(world),
          ]);
          if (active) {
            setEntities(e);
            setSchema(s);
          }
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [kind, id]);
  const world = String(items?.[0]?.payload.world_id || "");
  const identity = (value: unknown) => (
    <Link
      className="text-link"
      to={`/worlds/${world}/create/objects/${String(value)}`}
    >
      {entities.find((e) => e.id === value)?.name || "查看原对象"} →
    </Link>
  );
  function show(key: string, value: unknown): React.ReactNode {
    if (value == null || value === "") return "未填写";
    if (["subject_id", "object_id", "location_id", "merged_into"].includes(key))
      return identity(value);
    if (key === "sources" && Array.isArray(value))
      return value.length
        ? value.map((v) => (
            <p key={String(v)}>
              <Link to={`/worlds/${world}/review?candidate=${String(v)}`}>
                裁决与原文来源 →
              </Link>
            </p>
          ))
        : "人工记录";
    if (key === "participants" && Array.isArray(value))
      return value.map((v) => <p key={String(v)}>{identity(v)}</p>);
    if (key === "causes" && Array.isArray(value))
      return value.map((v) => (
        <p key={String(v)}>
          <Link to={`/worlds/${world}/create/records?event=${String(v)}`}>
            查看前因事件 →
          </Link>
        </p>
      ));
    if (key === "status") return stateNames[String(value)] || String(value);
    if (key === "kind") return entityKinds[String(value)] || String(value);
    if (key === "value_type") return typeNames[String(value)] || String(value);
    if (Array.isArray(value))
      return value.map((v, i) => (
        <div key={i}>{typeof v === "object" ? show("", v) : String(v)}</div>
      ));
    if (typeof value === "object")
      return Object.entries(value).map(([k, v]) => (
        <p key={k}>
          {schema?.core[String(items?.[0]?.payload.kind)]?.[k] ||
            historyLabels[k] ||
            entities.find((e) => e.id === k)?.name ||
            k}
          ：{show(k, v)}
        </p>
      ));
    return typeof value === "boolean" ? (value ? "是" : "否") : String(value);
  }
  return (
    <Dialog title="正式设定修改历史" onClose={onClose}>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {!items && !error && <p role="status">正在读取历史…</p>}
      {items?.map((item) => (
        <details key={item.version} className="canon-history-item">
          <summary>
            版本 {item.version} · {item.saved_at || "历史时间未知"} ·{" "}
            {stateNames[String(item.payload.status)] ||
              String(item.payload.status)}
          </summary>
          <dl>
            {Object.entries(item.payload)
              .filter(
                ([key]) =>
                  ![
                    "id",
                    "world_id",
                    "created_at",
                    "updated_at",
                    "version",
                    "field_id",
                    "value_type",
                    "typed_value",
                    "relationship_id",
                  ].includes(key),
              )
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{historyLabels[key] || key}</dt>
                  <dd>{show(key, value)}</dd>
                </div>
              ))}
          </dl>
        </details>
      ))}
      <p className="context-hint">
        每次编辑形成新版本。旧记录和来源保留；历史版本不覆盖当前设定。旧记录从首次修订前的快照开始留存，不补造更早版本。
      </p>
      <Button onClick={onClose}>返回资料</Button>
    </Dialog>
  );
}
const stateNames: Record<string, string> = {
  active: "有效",
  withdrawn: "已撤回",
  superseded: "已替代",
  deleted: "已删除",
  archived: "已归档",
  merged: "已合并",
};
const typeNames: Record<string, string> = {
  text: "文本",
  number: "数字",
  boolean: "是 / 否",
  entity: "对象引用",
  tags: "标签列表",
};
const historyLabels: Record<string, string> = {
  name: "名称",
  kind: "对象类型",
  aliases: "别名",
  sections: "说明",
  core: "核心资料",
  custom_type: "自定义类型",
  merged_into: "合并目标",
  predicate: "属性",
  value: "内容",
  object_id: "引用对象",
  subject_id: "主体",
  valid_from: "生效故事时间",
  valid_until: "失效故事时间",
  source_note: "来源说明",
  status: "记录状态",
  sources: "审阅来源",
  field_id: "字段标识",
  value_type: "值类型",
  typed_value: "结构化值",
  title: "标题",
  body: "内容",
  description: "说明",
  location_id: "地点",
  metadata: "事件结构",
  participants: "参与者",
  label: "关系状态",
  strength: "关系强度",
  relationship_id: "稳定关系",
  before_state: "事件前状态",
  after_state: "事件后状态",
  causes: "前因事件",
  participant_roles: "参与者角色",
};
