import { useEffect, useState } from "react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { EntityChoice } from "../objects/EntityChoice";
import {
  creationApi,
  type Entity,
  type Fact,
  type ObjectSchema,
  type FieldDefinition,
} from "./api";

export function FactEditor({
  world,
  entity,
  initial,
  onClose,
  onSubmit,
}: {
  world: string;
  entity: Entity;
  initial?: Fact;
  onClose: () => void;
  onSubmit: (data: unknown) => Promise<void>;
}) {
  const [schema, setSchema] = useState<ObjectSchema>(),
    [field, setField] = useState(initial?.field_id || ""),
    [predicate, setPredicate] = useState(initial?.predicate || ""),
    [value, setValue] = useState(
      initial?.typed_value != null
        ? Array.isArray(initial.typed_value)
          ? initial.typed_value.join("，")
          : String(initial.typed_value)
        : initial?.value || "",
    ),
    [from, setFrom] = useState(initial?.valid_from || ""),
    [until, setUntil] = useState(initial?.valid_until || ""),
    [note, setNote] = useState(initial?.source_note || "人工世界编辑"),
    [object, setObject] = useState(initial?.object_id || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [defining, setDefining] = useState(false);
  async function load() {
    try {
      setSchema(await creationApi.schema(world));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, [world]);
  const definition = schema?.fields.find((f) => f.key === field),
    type = definition?.value_type || "text";
  return (
    <Dialog
      title={initial ? "明确修改世界事实" : "明确确认世界事实"}
      onClose={onClose}
      busy={busy}
    >
      <p className="dialog-intro">
        确认会写入正式设定，旧版本及原文来源保留。故事时间未知可以留空。
      </p>
      {defining ? (
        <FieldForm
          onCancel={() => setDefining(false)}
          onSubmit={async (data) => {
            await creationApi.defineField(world, data);
            await load();
            setField(data.key);
            setPredicate(data.label);
            setValue("");
            setDefining(false);
          }}
        />
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              let typed: unknown = value;
              if (type === "number") {
                if (!value.trim() || !Number.isFinite(Number(value)))
                  throw new Error("请输入有效数字。");
                typed = Number(value);
              }
              if (type === "boolean") typed = value === "true";
              if (type === "tags")
                typed = value
                  .split(/[，,]/)
                  .map((v) => v.trim())
                  .filter(Boolean);
              await onSubmit({
                predicate,
                value,
                field_id: field || null,
                typed_value: field ? typed : null,
                object_id: type === "entity" ? value : object || null,
                valid_from: from || null,
                valid_until: until || null,
                source_note: note,
                ...(initial ? { version: initial.version } : {}),
              });
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>字段</span>
            <select
              value={field}
              onChange={(e) => {
                const f = schema?.fields.find((f) => f.key === e.target.value);
                setField(e.target.value);
                setPredicate(f?.label || "");
                setValue(f?.value_type === "boolean" ? "false" : "");
                setObject("");
              }}
            >
              <option value="">自由事实（文本）</option>
              {schema?.fields
                .filter((f) => !f.kinds.length || f.kinds.includes(entity.kind))
                .map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label} · {typeNames[f.value_type]}
                  </option>
                ))}
            </select>
          </label>
          {!field && (
            <label className="field">
              <span>属性 / 事实名称</span>
              <input
                value={predicate}
                required
                maxLength={160}
                onChange={(e) => setPredicate(e.target.value)}
              />
            </label>
          )}
          {type === "entity" ? (
            <EntityChoice
              world={world}
              label="事实引用对象"
              value={value}
              onChange={setValue}
            />
          ) : (
            <label className="field">
              <span>事实内容</span>
              {type === "boolean" ? (
                <select
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                >
                  <option value="false">否</option>
                  <option value="true">是</option>
                </select>
              ) : (
                <input
                  value={value}
                  type={type === "number" ? "number" : "text"}
                  step="any"
                  required={type !== "tags"}
                  placeholder={
                    type === "tags" ? "以逗号分隔多个标签" : undefined
                  }
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
            </label>
          )}
          {!field && (
            <EntityChoice
              world={world}
              label="引用对象（可选）"
              value={object}
              onChange={setObject}
              optional
            />
          )}
          {[
            [from, setFrom, "生效故事时间"],
            [until, setUntil, "失效故事时间"],
            [note, setNote, "来源说明"],
          ].map(([v, set, label]) => (
            <label className="field" key={String(label)}>
              <span>{String(label)}</span>
              <input
                value={v as string}
                onChange={(e) =>
                  (set as (value: string) => void)(e.target.value)
                }
              />
            </label>
          ))}
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <div className="dialog-actions">
            <Button
              type="button"
              disabled={busy}
              onClick={() => setDefining(true)}
            >
              定义扩展字段
            </Button>
            <Button
              variant="primary"
              disabled={busy || !schema || (type === "entity" && !value)}
            >
              确认并保存事实
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
const typeNames = {
  text: "文本",
  number: "数字",
  boolean: "是 / 否",
  entity: "对象引用",
  tags: "标签列表",
};
function FieldForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (data: FieldDefinition) => Promise<void>;
}) {
  const [key, setKey] = useState(""),
    [label, setLabel] = useState(""),
    [type, setType] = useState<FieldDefinition["value_type"]>("text"),
    [aliases, setAliases] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit({
            key,
            label,
            value_type: type,
            kinds: [],
            aliases: aliases
              .split(/[，,]/)
              .map((v) => v.trim())
              .filter(Boolean),
          });
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="context-hint">
        字段定义由此世界共享。创建后名称、标识与类型固定，避免改变已有事实的含义。
      </p>
      <label className="field">
        <span>字段名称</span>
        <input
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label className="field">
        <span>稳定字段标识</span>
        <input
          required
          pattern="[a-z][a-z0-9_]*"
          value={key}
          placeholder="magic_affinity"
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      <label className="field">
        <span>值类型</span>
        <select
          value={type}
          onChange={(e) =>
            setType(e.target.value as FieldDefinition["value_type"])
          }
        >
          {Object.entries(typeNames).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>同义字段名（逗号分隔）</span>
        <input value={aliases} onChange={(e) => setAliases(e.target.value)} />
      </label>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="dialog-actions">
        <Button type="button" onClick={onCancel} disabled={busy}>
          返回事实
        </Button>
        <Button variant="primary" disabled={busy}>
          确认字段定义
        </Button>
      </div>
    </form>
  );
}
