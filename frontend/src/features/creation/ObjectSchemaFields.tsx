import { useEffect, useState } from "react";
import { ErrorNotice } from "../../components/ui";
import { creationApi, type Entity, type ObjectSchema } from "./api";

export function ObjectSchemaFields({
  world,
  entity,
  onChange,
  readOnly = false,
}: {
  world: string;
  entity: Entity;
  onChange: (data: Partial<Entity>) => void;
  readOnly?: boolean;
}) {
  const [schema, setSchema] = useState<ObjectSchema>(),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    creationApi
      .schema(world)
      .then((data) => {
        if (active) setSchema(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [world]);
  return (
    <section className="typed-core">
      <h2>核心资料</h2>
      <p className="context-hint">
        这些资料描述对象；时间变化的世界事实、关系和事件分别管理。
      </p>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {readOnly && schema && <dl className="object-core-reading">
        {entity.kind === 'custom' && entity.custom_type && <div><dt>类型</dt><dd>{entity.custom_type}</dd></div>}
        {Object.entries(schema.core[entity.kind] || {}).filter(([key]) => entity.core?.[key]?.trim()).map(([key, label]) =>
          <div key={key}><dt>{label}</dt><dd>{entity.core[key]}</dd></div>)}
        {!Object.keys(schema.core[entity.kind] || {}).some(key => entity.core?.[key]?.trim()) && <p className="context-hint">尚未填写核心资料。可以通过「编辑资料」逐步补充。</p>}
      </dl>}
      {!readOnly && entity.kind === "custom" && (
        <label className="field">
          <span>自定义类型名称</span>
          <input
            value={entity.custom_type || ""}
            maxLength={80}
            disabled={entity.status !== "active"}
            placeholder="例如：星舰、魔法学派"
            onChange={(e) => onChange({ custom_type: e.target.value })}
          />
        </label>
      )}
      {!readOnly && Object.entries(schema?.core[entity.kind] || {}).map(([key, label]) => (
        <label className="field" key={key}>
          <span>{label}</span>
          <textarea
            rows={3}
            value={entity.core?.[key] || ""}
            disabled={entity.status !== "active"}
            onChange={(e) =>
              onChange({ core: { ...entity.core, [key]: e.target.value } })
            }
          />
        </label>
      ))}
    </section>
  );
}
