import { useEffect, useState } from "react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { entityKinds } from "../creation/api";
import {
  catalogApi,
  objectTypeNames,
  type ObjectPage,
  type ObjectRef,
  type ObjectType,
} from "./api";
import { ObjectInspector } from "./ObjectInspector";

const allTypes: ObjectType[] = [
  "entity",
  "work",
  "content",
  "event",
  "relationship",
];
export function ObjectBrowser({
  world,
  title = "浏览这个世界",
  types = allTypes,
  entityKind,
  excludeIds = [],
  onClose,
  onPick,
  browse = false,
  searchFirst = false,
}: {
  world: string;
  title?: string;
  types?: ObjectType[];
  entityKind?: string;
  excludeIds?: string[];
  onClose: () => void;
  onPick: (object: ObjectRef) => void | Promise<void>;
  browse?: boolean;
  searchFirst?: boolean;
}) {
  const [type, setType] = useState<ObjectType | "all">(
      searchFirst ? "all" : types[0],
    ),
    [kind, setKind] = useState(entityKind || ""),
    [q, setQ] = useState(""),
    [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ObjectPage>(),
    [selected, setSelected] = useState<ObjectRef>(),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setPage(undefined);
    setError("");
    setSelected(undefined);
    if (searchFirst && !q.trim()) {
      setLoading(false);
      return;
    }
    const timer = setTimeout(
      () => {
        catalogApi
          .list(world, {
            type,
            q,
            entity_kind: type === "entity" ? kind || undefined : undefined,
            offset,
          })
          .then((value) => {
            if (active) setPage(value);
          })
          .catch((e) => {
            if (active) setError(e.message);
          })
          .finally(() => {
            if (active) setLoading(false);
          });
      },
      q ? 200 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [world, type, kind, q, offset, retry, searchFirst]);
  return (
    <Dialog title={title} onClose={onClose} busy={busy}>
      <div
        className="object-browser"
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            (e.target as HTMLElement).tagName === "INPUT"
          )
            e.preventDefault();
        }}
      >
        <p className="dialog-intro">
          {browse
            ? "按类型浏览，再查看资料或打开完整页面。"
            : "选择稳定对象引用；这一步不会修改正式设定。"}
        </p>
        <div className="quiet-tabs object-browser-types">
          {searchFirst && (
            <button
              type="button"
              aria-pressed={type === "all"}
              onClick={() => {
                setType("all");
                setOffset(0);
              }}
            >
              全部
            </button>
          )}
          {types.map((t) => (
            <button
              type="button"
              key={t}
              aria-pressed={type === t}
              onClick={() => {
                setType(t);
                setOffset(0);
              }}
            >
              {objectTypeNames[t]}
            </button>
          ))}
        </div>
        <div className="object-browser-filters">
          <label className="field">
            <span>查找对象</span>
            <input
              value={q}
              maxLength={200}
              placeholder="名称、别名或正文…"
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
            />
          </label>
          {type === "entity" && !entityKind && (
            <label className="field">
              <span>对象类型</span>
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">全部类型</option>
                {Object.entries(entityKinds).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {error && (
          <>
            <ErrorNotice>{error}</ErrorNotice>
            <Button type="button" onClick={() => setRetry((v) => v + 1)}>
              重新读取
            </Button>
          </>
        )}
        <div
          className={`object-browser-body ${selected ? "has-selection" : ""}`}
        >
          <section className="object-browser-list" aria-label="可选择对象">
            {loading && <p role="status">正在读取对象…</p>}
            {searchFirst && !q.trim() && (
              <p className="context-hint">
                输入关键词查找整个世界；也可以先选择对象类型。
              </p>
            )}
            {page?.items.map((object) => (
              <button
                type="button"
                key={object.id}
                disabled={excludeIds.includes(object.id) || busy}
                className={`object-browser-row ${selected?.id === object.id ? "selected" : ""}`}
                aria-pressed={selected?.id === object.id}
                onClick={() => setSelected(object)}
              >
                <strong>{object.label}</strong>
                <small>
                  {entityKinds[object.kind] || objectTypeNames[object.type]} ·{" "}
                  {object.subtitle || object.context}
                  {excludeIds.includes(object.id) && " · 当前引用不可选择"}
                </small>
              </button>
            ))}
            {page && !page.items.length && (
              <p className="context-hint">
                当前范围没有对象。可修改类型或关键词，已有记录不会因此改变。
              </p>
            )}
            {page &&
              (type === "all" ? (
                <p className="context-hint">
                  {page.total} 项匹配，每类显示前 8 项；选择上方类型可分页查阅。
                </p>
              ) : (
                <div className="object-browser-pagination">
                  <Button
                    type="button"
                    disabled={!offset || loading}
                    onClick={() => setOffset(Math.max(0, offset - page.limit))}
                  >
                    上一页
                  </Button>
                  <span>
                    {page.total} 项 · 第 {Math.floor(offset / page.limit) + 1}{" "}
                    页
                  </span>
                  <Button
                    type="button"
                    disabled={offset + page.limit >= page.total || loading}
                    onClick={() => setOffset(offset + page.limit)}
                  >
                    下一页
                  </Button>
                </div>
              ))}
          </section>
          {selected ? (
            <div className="object-browser-detail">
              <Button
                type="button"
                className="object-browser-back"
                onClick={() => setSelected(undefined)}
              >
                ← 返回列表
              </Button>
              <ObjectInspector
                world={world}
                object={selected}
                onNavigate={browse ? onClose : undefined}
              />
            </div>
          ) : (
            <p className="object-browser-empty context-hint">
              选择一项，查看 Working Canon 或正文资料。
            </p>
          )}
        </div>
        <div className="dialog-actions">
          <Button type="button" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!selected || busy}
            onClick={async () => {
              if (!selected) return;
              setBusy(true);
              setError("");
              try {
                await catalogApi.inspect(world, selected);
                await onPick(selected);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在核对…" : browse ? "打开完整资料" : "确认选择"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
