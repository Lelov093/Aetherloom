import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, ErrorNotice } from "../../components/ui";
import {
  catalogApi,
  type ObjectDetail,
  type ObjectRef,
  objectTypeNames,
} from "./api";

export function ObjectInspector({
  world,
  object,
  onNavigate,
}: {
  world: string;
  object: ObjectRef;
  onNavigate?: () => void;
}) {
  const [detail, setDetail] = useState<ObjectDetail>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    catalogApi
      .inspect(world, object)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      }).finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
    };
  }, [world, object.id, object.type, retry]);
  return (
    <section className="object-quick-inspector" aria-label="对象快速资料">
      <span className="eyebrow">{detail?.item.context || object.context}</span>
      <h3>{detail?.item.label || object.label}</h3>
      <p className="context-hint">
        {objectTypeNames[detail?.item.type || object.type]} · {detail?.item.subtitle || object.subtitle}
      </p>
      {error && (
        <>
          <ErrorNotice>{error}</ErrorNotice>
          <Button type="button" onClick={() => setRetry((v) => v + 1)}>
            重新读取资料
          </Button>
        </>
      )}
      {loading && !error && <p role="status">正在读取{object.label}的资料…</p>}
      {detail && (
        <div aria-busy={loading} inert={loading || !!error}>
          <dl>
            {detail.fields.map((field, i) => (
              <div key={i}>
                <dt>{field.label}</dt>
                <dd>{field.text}</dd>
              </div>
            ))}
          </dl>
          {!detail.fields.length && (
            <p className="context-hint">尚未填写详细说明。</p>
          )}
          {!!detail.references.length && (
            <>
              <h4>关联内容</h4>
              {detail.references.map((ref, i) =>
                onNavigate ? (
                  <Link
                    key={i}
                    className="object-inspector-link"
                    to={ref.to}
                    onClick={onNavigate}
                  >
                    {ref.label} →
                  </Link>
                ) : (
                  <p key={i}>{ref.label}</p>
                ),
              )}
            </>
          )}
          {!!detail.sources.length && (
            <>
              <h4>来源</h4>
              {detail.sources.map((source, i) =>
                source.download ? (
                  <a
                    key={i}
                    className="object-inspector-link"
                    href={source.to}
                    download
                  >
                    {source.label} · 下载原件
                  </a>
                ) : onNavigate ? (
                  <Link
                    key={i}
                    className="object-inspector-link"
                    to={source.to}
                    onClick={onNavigate}
                  >
                    {source.label} →
                  </Link>
                ) : (
                  <p key={i}>{source.label}</p>
                ),
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
