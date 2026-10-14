import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  UsersRound,
  MapPin,
  ScrollText,
} from "lucide-react";
import { Button, ErrorNotice } from "../../components/ui";
import { Portrait, usePortraits } from '../objects/Portrait';
import { DisplayImage } from '../objects/DisplayImages';
import { EntityMark } from "../../components/EntityMark";
import { creationApi, entityKinds, type Entity } from "./api";
import { reviewApi, type CanonRecords } from "../review/api";
import { MaterialSources } from './MaterialSources';

export function EntityContext({
  world,
  entityId,
  entities,
  onBack,
  onInspect,
  backLabel = '文档上下文',
}: {
  world: string;
  entityId: string;
  entities: Entity[];
  onBack: () => void;
  onInspect: (entity: Entity) => void;
  backLabel?: string;
}) {
  const [entity, setEntity] = useState<Entity>(),
    [records, setRecords] = useState<CanonRecords>(),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    Promise.all([
      creationApi.entity(entityId),
      reviewApi.records(world, entityId),
    ])
      .then(([detail, related]) => {
        if (active) {
          setEntity(detail);
          setRecords(related);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [world, entityId, retry]);
  const { portraits } = usePortraits(world);
  const objectLink = (id: string) => `/worlds/${world}/create/objects/${id}`;
  const name = (id: string) =>
    entities.find((e) => e.id === id)?.name || "查看对象";
  const sections = entity?.sections.filter((s) => s.body.trim()) || [];
  const facts =
    entity?.facts?.filter((f) => !f.status || f.status === "active") || [];
  const relatedLocations = [
    ...new Set(
      records?.events.filter(e=>e.status==='active')
        .map((e) => e.location_id)
        .filter((id): id is string => !!id && id !== entityId) || [],
    ),
  ];
  return (
    <div className="entity-context">
      <Button variant="ghost" className="context-back" onClick={onBack}>
        <ArrowLeft size={14} />
        {backLabel}
      </Button>
      {error && (
        <>
          <ErrorNotice>{error}</ErrorNotice>
          <Button onClick={() => setRetry((n) => n + 1)}>重新读取</Button>
        </>
      )}
      {entity && entity.id !== entityId && !error && <p className="context-refresh" role="status">正在打开对象资料…</p>}
      {!entity ? !error && (
        <p role="status" className="context-hint">
          正在读取对象资料…
        </p>
      ) : (
        <div className="context-body" aria-busy={entity.id !== entityId} inert={entity.id !== entityId || !!error}>
          {entity.kind === 'location' && <DisplayImage owner="entity" id={entity.id} name={entity.name} version={portraits[entity.id]} className="context-scene"/>}
          <header className="context-identity">
            {entity.kind === 'character' && portraits[entity.id] ? <Portrait id={entity.id} name={entity.name} version={portraits[entity.id]}/> : <EntityMark kind={entity.kind}/>}
            <div>
              <span>{entityKinds[entity.kind]}</span>
              <h2>{entity.name}</h2>
              <small>{entity.aliases.join(" · ")}</small>
            </div>
          </header>
          <section className="context-section context-overview">
            <h3><ScrollText size={15}/>创作设定</h3>
            <dl className="context-core">
              {Object.entries(entity.core||{}).filter(([,value])=>value).map(([key,value])=><div key={key}>
                <dt>{coreLabels[key]||key}</dt>
                <dd>{value.length>90?<details><summary>{value.slice(0,60)}…</summary><p>{value}</p></details>:value}</dd>
              </div>)}
            </dl>
            {!Object.values(entity.core||{}).some(Boolean)&&<p className="context-hint">尚未填写基础资料。</p>}
            <p className="context-hint context-boundary">作者设定与计划不自动成为角色已知信息。</p>
          </section>
          <section className="context-section">
            <h3>
              <BookOpen size={15} />
              已确认事实 <span>{facts.length}</span>
            </h3>
            {facts.length ? (
              <dl className="context-facts">
                {facts.slice(0, 4).map((f) => (
                  <div key={f.id}>
                    <dt>{f.predicate}</dt>
                    <dd>
                      {f.value}
                      <small>
                        {f.valid_from || "起始未知"} →{" "}
                        {f.valid_until || "结束未知"}
                      </small>
                      {f.sources?.map((id) => (
                        <Link
                          key={id}
                          className="text-link"
                          to={`/worlds/${world}/review?candidate=${id}`}
                        >
                          原文来源 →
                        </Link>
                      ))}
                      <Link className="text-link" to={`${objectLink(entityId)}?tab=facts&fact=${f.id}`}>查看事实与资料来源 →</Link>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="context-hint">尚无已确认事实。</p>
            )}
            {facts.length > 4 && (
              <Link className="text-link" to={objectLink(entityId)}>
                查看全部 {facts.length} 条事实 →
              </Link>
            )}
          </section>
          <section className="context-section">
            <h3>
              <UsersRound size={15} />
              关系 <span>{records?.relationships.length || 0}</span>
            </h3>
            {records?.relationships.length ? (
              records.relationships.map((r) => {
                const other =
                  r.subject_id === entityId ? r.object_id : r.subject_id;
                const e = entities.find((e) => e.id === other);
                return (
                  <div className="context-relation" key={r.id}>
                    <button className="context-object-link" disabled={!e} onClick={() => e && onInspect(e)}>
                      {e?.kind === 'character' && portraits[other] ? <Portrait id={other} name={name(other)} version={portraits[other]} size="small"/> : <EntityMark kind={e?.kind || "custom"} small />}
                      <strong>{name(other)}</strong>
                    </button>
                    {r.states
                      .filter((s) => s.status === "active")
                      .map((s) => (
                        <p key={s.id}>
                          <span>{s.label}</span>
                          <small>
                            {r.subject_id === entityId
                              ? `${entity.name} → ${name(other)}`
                              : `${name(other)} → ${entity.name}`}{" "}
                            · {s.valid_from || "未知"} →{" "}
                            {s.valid_until || "未知"}
                          </small>
                        </p>
                      ))}
                  </div>
                );
              })
            ) : (
              <p className="context-hint">尚无已确认关系。</p>
            )}
            <Link
              className="text-link"
              to={`/worlds/${world}/create/records?entity=${entityId}&tab=relations`}
            >
              查看事件与关系历史 →
            </Link>
          </section>
          {relatedLocations.length > 0 && (
            <section className="context-section">
              <h3>
                <MapPin size={15} />
                事件相关地点
              </h3>
              {relatedLocations.map((id) => (
                <button
                  className="context-related-object"
                  key={id}
                  disabled={!entities.some(e => e.id === id)}
                  onClick={() => { const next = entities.find(e => e.id === id); if (next) onInspect(next); }}
                >
                  {portraits[id] ? <DisplayImage owner="entity" id={id} name={name(id)} version={portraits[id]} className="context-location-thumb"/> : <EntityMark kind="location" small />}
                  {name(id)}
                </button>
              ))}
            </section>
          )}
          {sections.length>0&&<section className="context-section context-notes"><h3><ScrollText size={15}/>创作笔记</h3>
            {sections.map((section,i)=><details key={i}><summary>{section.title}</summary><p>{section.body}</p></details>)}
          </section>}
          <Link
            className="context-full-link text-link"
            to={objectLink(entityId)}
          >
            打开完整对象资料 →
          </Link>
          <MaterialSources world={world} kind="entity" identity={entityId} editable={false}/>

          <Link className="text-link" to={`${objectLink(entityId)}?tab=sources`}>查看与关联手工资料来源 →</Link>
        </div>
      )}
    </div>
  );
}

const coreLabels:Record<string,string>={background:'背景',personality:'性格',capabilities:'能力',goals:'目标',environment:'环境',history:'历史',description:'概述',purpose:'宗旨 / 用途',organization:'组织结构',appearance:'外观',traits:'特征',culture:'文化',definition:'定义',scope:'适用范围',exceptions:'例外'};
