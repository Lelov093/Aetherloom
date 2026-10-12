import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorNotice } from "../../components/ui";
import { EntityMark } from "../../components/EntityMark";
import { request, entityKinds, type Entity } from "./api";
interface Connection {
  id: string;
  type?: string;
  label: string;
  status: string;
  to: string;
  source_version?: number;
  source?: string;
}
interface Connections {
  version: number;
  internal_links: Connection[];
  confirmed: Connection[];
  candidates: Connection[];
}
export function ContentReferences({
  nodeId,
  version,
  entities,
  onInspect,
}: {
  nodeId: string;
  version: number;
  entities: Entity[];
  onInspect: (entity: Entity) => void;
}) {
  const [data, setData] = useState<Connections>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    request<Connections>(`/nodes/${nodeId}/context`)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [nodeId, version, retry]);
  function section(title: string, rows: Connection[]) {
    return (
      <section className="context-section">
        <h3>
          {title} <span>{rows.length}</span>
        </h3>
        {rows.length ? (
          rows.map((row, i) => (
            <div className="content-connection" key={`${row.id}-${i}`}>
              <Link className="text-link" to={row.to}>
                {row.label} →
              </Link>
              <small>
                {row.status !== "active" &&
                  row.status !== "pending" &&
                  `状态 ${row.status} · `}
                {row.source_version != null &&
                  `来源正文 v${row.source_version}${row.source_version !== version ? " · 当前正文已修订" : ""}`}
              </small>
              {row.source && (
                <Link className="text-link" to={row.source}>
                  裁决与原文 →
                </Link>
              )}
            </div>
          ))
        ) : (
          <p className="context-hint">尚无此类关联。</p>
        )}
      </section>
    );
  }
  return (
    <>
      <h2>正文与世界的联系</h2>
      <Button variant="ghost" onClick={() => setRetry((value) => value + 1)}>
        刷新关联
      </Button>
      <section className="context-section">
        <h3>
          已链接的对象 <span>{entities.length}</span>
        </h3>
        {entities.length ? (
          entities.map((e) => (
            <Button
              className="reference-row"
              key={e.id}
              onClick={() => onInspect(e)}
            >
              <EntityMark kind={e.kind} small />
              <span>
                <strong>{e.name}</strong>
                <small>{entityKinds[e.kind]}</small>
              </span>
            </Button>
          ))
        ) : (
          <p className="context-hint">
            选中文字并链接到对象；仅同名不会建立关联。
          </p>
        )}
      </section>
      {error && (
        <>
          <ErrorNotice>{error}</ErrorNotice>
          <Button onClick={() => setRetry((v) => v + 1)}>重新读取关联</Button>
        </>
      )}
      {!data && !error && <p role="status">正在读取关联来源…</p>}
      {data && (
        <>
          {section("内部内容链接", data.internal_links)}
          {section("已确认的正式设定", data.confirmed)}
          {section("待 Review 的候选", data.candidates)}
          <p className="context-hint">
            关联来自稳定链接或实际提取与裁决来源，不按名字猜测；阅读不会确认候选。
          </p>
        </>
      )}
    </>
  );
}
