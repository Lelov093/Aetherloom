import { useEffect, useState } from "react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { creationApi, type Entity, type MergePreview } from "./api";
import { reviewApi } from "../review/api";

export function EntityMergeDialog({
  entity,
  onClose,
  onMerged,
}: {
  entity: Entity;
  onClose: () => void;
  onMerged: (target: string) => void;
}) {
  const [entities, setEntities] = useState<Entity[]>([]),
    [target, setTarget] = useState(""),
    [preview, setPreview] = useState<MergePreview>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [keep, setKeep] = useState(false),
    [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    Promise.all([
      creationApi.entities(entity.world_id),
      creationApi.schema(entity.world_id),
    ])
      .then(([items, schema]) => {
        if (active) {
          setEntities(items);
          setLabels(schema.core[entity.kind] || {});
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [entity.world_id, entity.kind]);
  const request = preview
    ? {
        target_id: preview.target.id,
        source_version: preview.source.version,
        target_version: preview.target.version,
        expected_revision: preview.revision,
        keep_differences: keep,
      }
    : undefined;
  return (
    <Dialog title={`合并 ${entity.name} 的身份`} onClose={onClose} busy={busy}>
      <p className="dialog-intro">
        当前对象并入保留对象，迁移当前引用；原始身份、正文历史和来源保留。请先查看影响。
      </p>
      <label className="field">
        <span>保留对象</span>
        <select
          value={target}
          disabled={busy}
          onChange={(e) => {
            setTarget(e.target.value);
            setPreview(undefined);
            setKeep(false);
          }}
        >
          <option value="">选择同类型对象…</option>
          {entities
            .filter(
              (e) =>
                e.id !== entity.id &&
                e.kind === entity.kind &&
                e.custom_type === entity.custom_type &&
                e.status === "active",
            )
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
        </select>
      </label>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {preview && (
        <>
          <dl className="merge-counts">
            {Object.entries(preview.counts).map(([k, v]) => (
              <div key={k}>
                <dt>
                  {{
                    documents: "正文版本",
                    facts: "事实引用",
                    events: "事件",
                    relationships: "关系",
                    pending_candidates: "待审阅候选",
                    material_sources: "手工资料关联",
                  }[k] || k}
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {preview.notes.map((n) => (
            <p key={n} className="context-hint">
              {n}
            </p>
          ))}
          {preview.differences.length > 0 && (
            <>
              <h3>需要保留的差异</h3>
              {preview.differences.map((d, i) => (
                <p key={i}>
                  {labels[d.field] || d.field}：{d.current} ↔ {d.incoming}
                </p>
              ))}
              <label className="field">
                <span>
                  <input
                    type="checkbox"
                    checked={keep}
                    onChange={(e) => setKeep(e.target.checked)}
                  />
                  明确保留双方事实与来源，核心资料差异保留为合并说明
                </span>
              </label>
            </>
          )}
        </>
      )}
      <div className="dialog-actions">
        <Button
          disabled={busy || !target}
          onClick={async () => {
            setBusy(true);
            setError("");
            setPreview(undefined);
            try {
              const [current, source, selected] = await Promise.all([
                reviewApi.inbox(entity.world_id),
                creationApi.entity(entity.id),
                creationApi.entity(target),
              ]);
              setPreview(
                await creationApi.mergePreview(entity.id, {
                  target_id: target,
                  source_version: source.version,
                  target_version: selected.version,
                  expected_revision: current.revision,
                  keep_differences: false,
                }),
              );
              setKeep(false);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          预览合并影响
        </Button>
        {request && (
          <Button
            variant="primary"
            disabled={busy || (!!preview?.differences.length && !keep)}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await creationApi.merge(entity.id, request);
                onMerged(result.target.id);
              } catch (e) {
                setError((e as Error).message);
                setPreview(undefined);
              } finally {
                setBusy(false);
              }
            }}
          >
            明确确认合并
          </Button>
        )}
      </div>
    </Dialog>
  );
}
