import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { creationApi, type Entity } from "../creation/api";
import { CanonHistoryDialog } from "../creation/CanonHistoryDialog";
import { reviewApi, type CanonRecords as Records } from "./api";
import { CanonRecordEditor, type RecordEdit } from "./CanonRecordEditor";
import { MaterialSources } from '../creation/MaterialSources';

export function CanonRecords({ world }: { world: string }) {
  const [params, setParams] = useSearchParams(),
    entityId = params.get("entity") || undefined;
  const [records, setRecords] = useState<Records>(),
    [entities, setEntities] = useState<Entity[]>([]),
    [error, setError] = useState(""),
    [tab, setTab] = useState(
      params.get("tab") === "relations" ? "relations" : "events",
    ),
    [edit, setEdit] = useState<RecordEdit>(),
    [history, setHistory] = useState<{ kind: string; id: string }>(),
    [status, setStatus] = useState("active"),
    [action, setAction] = useState<{
      kind: string;
      id: string;
      version: number;
      status: string;
      title: string;
    }>(),
    [busy, setBusy] = useState(false);
  async function load() {
    const [r, e] = await Promise.all([
      reviewApi.records(world, entityId),
      creationApi.entities(world),
    ]);
    setRecords(r);
    setEntities(e);
    setError("");
  }
  useEffect(() => {
    let active = true;
    Promise.all([
      reviewApi.records(world, entityId),
      creationApi.entities(world),
    ])
      .then(([r, e]) => {
        if (active) {
          setRecords(r);
          setEntities(e);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [world, entityId]);
  useEffect(() => {
    if (params.get("event")) {
      setTab("events");
      setStatus("all");
    } else if (params.get("relationship")) {
      setTab("relations");
      setStatus("all");
    } else setTab(params.get("tab") === "relations" ? "relations" : "events");
  }, [params]);
  function selectTab(next: string) {
    const updated = new URLSearchParams(params);
    updated.delete('event');
    updated.delete('relationship');
    updated.set('tab', next);
    setParams(updated, { replace: true });
  }
  useEffect(() => {
    const id = params.get("event") || params.get("relationship");
    if (id && records)
      document
        .getElementById(`record-${id}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [params, records, tab, status]);
  const name = (id: string) =>
    entities.find((e) => e.id === id)?.name || "已保留的对象";
  const entityLink = (id: string) => (
    <Link key={id} to={`/worlds/${world}/create/objects/${id}`}>
      {name(id)} →
    </Link>
  );
  const sources = (ids: string[]) =>
    ids.map((id) => (
      <Link
        key={id}
        className="text-link"
        to={`/worlds/${world}/review?candidate=${id}`}
      >
        审阅裁决与原文来源 →
      </Link>
    ));
  const matches = (s: string) =>
    status === "all" ||
    (status === "history" ? s !== "active" : s === "active");
  const actions = (
    kind: string,
    id: string,
    version: number,
    state: string,
    title: string,
    onEdit: () => void,
  ) => (
    <div className="canon-row-actions">
      <Button disabled={state !== "active"} onClick={onEdit}>
        编辑
      </Button>
      <Button
        disabled={state === "superseded"}
        onClick={() =>
          setAction({
            kind,
            id,
            version,
            status: state === "active" ? "withdrawn" : "active",
            title,
          })
        }
      >
        {state === "active" ? "撤回" : "恢复"}
      </Button>
      <Button variant="ghost" onClick={() => setHistory({ kind, id })}>
        修改历史
      </Button>
      <span className="context-hint">
        v{version} · {stateNames[state] || state}
      </span>
    </div>
  );
  const events = records?.events.filter((e) => matches(e.status)),
    relations = records?.relationships.filter((r) =>
      r.states.some((s) => matches(s.status)),
    );
  return (
    <main id="main-content" className="entity-document page">
      <Link className="back-link" to={`/worlds/${world}/create/objects`}>
        ← 世界对象
      </Link>
      <span className="eyebrow">WORKING CANON</span>
      <header className="collection-heading">
        <h1>世界事件与关系</h1>
        <div className="canon-row-actions">
          <Button onClick={() => setEdit({ kind: "event" })}>
            创建正式事件
          </Button>
          <Button onClick={() => setEdit({ kind: "relationship" })}>
            创建关系状态
          </Button>
        </div>
      </header>
      {entityId && (
        <p className="context-hint">
          当前对象：{name(entityId)} ·{" "}
          <Link className="text-link" to={`/worlds/${world}/create/records`}>
            查看全部世界记录 →
          </Link>
        </p>
      )}
      <p className="context-hint">
        正式历史与时态关系由你明确确认。撤回保留版本和来源，故事时间独立于保存时间。
      </p>
      <div className="canon-row-actions">
        <div className="quiet-tabs">
          <button
            aria-pressed={tab === "events"}
            onClick={() => selectTab("events")}
          >
            事件
          </button>
          <button
            aria-pressed={tab === "relations"}
            onClick={() => selectTab("relations")}
          >
            时态关系
          </button>
        </div>
        <label>
          显示记录{" "}
          <select
            aria-label="正式记录状态"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="active">有效记录</option>
            <option value="history">已撤回 / 已替代</option>
            <option value="all">全部记录</option>
          </select>
        </label>
      </div>
      {error && (
        <>
          <ErrorNotice>{error}</ErrorNotice>
          <Button onClick={() => void load().catch((e) => setError(e.message))}>
            重新读取
          </Button>
        </>
      )}
      {!records && !error && <p role="status">正在读取正式历史…</p>}
      {tab === "events" &&
        events?.map((e) => (
          <section
            key={e.id}
            id={`record-${e.id}`}
            className={`canon-record ${params.get("event") === e.id ? "canon-record--focused" : ""}`}
          >
            <h2>{e.title}</h2>
            <p>{e.description || "暂无说明"}</p>
            <p className="context-hint">
              {e.valid_from || "起始未知"} → {e.valid_until || "结束未知"} ·{" "}
              {e.source_note || "正文候选"}
            </p>
            {e.location_id && <p>地点：{entityLink(e.location_id)}</p>}
            <div className="affected-objects">
              {e.participants.map((id) => (
                <span key={id}>
                  {entityLink(id)}
                  {e.metadata?.participant_roles?.[id] &&
                    ` · ${e.metadata?.participant_roles[id]}`}
                </span>
              ))}
            </div>
            {e.metadata?.before_state && (
              <p>事件前：{e.metadata?.before_state}</p>
            )}
            {e.metadata?.after_state && <p>结果：{e.metadata?.after_state}</p>}
            {!!e.metadata?.causes?.length && (
              <div className="canon-causes">
                前因：
                {e.metadata?.causes.map((id) => (
                  <Link
                    key={id}
                    className="text-link"
                    to={`/worlds/${world}/create/records?event=${id}`}
                  >
                    {records?.events.find((parent) => parent.id === id)
                      ?.title || "查看前因事件"}{" "}
                    →
                  </Link>
                ))}
              </div>
            )}
            {sources(e.sources)}
            <MaterialSources world={world} kind="event" identity={e.id} editable={e.status==='active'}/>
            {actions("event", e.id, e.version, e.status, e.title, () =>
              setEdit({ kind: "event", event: e }),
            )}
          </section>
        ))}
      {tab === "relations" &&
        relations?.map((r) => (
          <section key={r.id} className="canon-record">
            <header className="collection-heading">
              <h2>
                {entityLink(r.subject_id)} / {entityLink(r.object_id)}
              </h2>
              <Button
                onClick={() => setEdit({ kind: "relationship", pair: r })}
              >
                新增时间状态
              </Button>
            </header>
            {r.states
              .filter((s) => matches(s.status))
              .map((s) => (
                <div
                  id={`record-${s.id}`}
                  className={`relation-state ${params.get("relationship") === s.id ? "canon-record--focused" : ""}`}
                  key={s.id}
                >
                  <strong>{s.label}</strong>
                  <p>{s.description || "暂无说明"}</p>
                  <span>
                    {s.valid_from || "起始未知"} → {s.valid_until || "结束未知"}
                    {s.strength != null && ` · 强度 ${s.strength}`} ·{" "}
                    {s.source_note || "正文候选"}
                  </span>
                  {sources(s.sources)}
                  <MaterialSources world={world} kind="relationship" identity={s.id} editable={s.status==='active'}/>
                  {actions(
                    "relationship",
                    s.id,
                    s.version,
                    s.status,
                    s.label,
                    () => setEdit({ kind: "relationship", pair: r, state: s }),
                  )}
                </div>
              ))}
          </section>
        ))}
      {records && !(tab === "events" ? events?.length : relations?.length) && (
        <p className="context-hint">
          当前范围没有记录。可手工创建，或从正文提取后明确接受。
        </p>
      )}
      {edit && (
        <CanonRecordEditor
          world={world}
          edit={edit}
          onClose={() => setEdit(undefined)}
          onSaved={load}
        />
      )}
      {history && (
        <CanonHistoryDialog
          {...history}
          onClose={() => setHistory(undefined)}
        />
      )}
      {action && (
        <Dialog
          title={
            action.status === "active" ? "恢复正式记录？" : "撤回正式记录？"
          }
          onClose={() => setAction(undefined)}
          busy={busy}
        >
          <p className="dialog-intro">
            {action.title}。确认改变有效状态，旧版本、引用和原文来源保留。
          </p>
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <div className="dialog-actions">
            <Button onClick={() => setAction(undefined)} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await creationApi.canonStatus(
                    action.kind,
                    action.id,
                    action.version,
                    action.status,
                  );
                  await load();
                  setAction(undefined);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              明确确认
            </Button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
const stateNames: Record<string, string> = {
  active: "有效",
  withdrawn: "已撤回",
  superseded: "已替代",
};
