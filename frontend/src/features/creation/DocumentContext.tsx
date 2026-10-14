import { Link } from "react-router-dom";
import { useState } from "react";
import { BookOpen, MapPin, UserRound, Clock3, PenLine } from "lucide-react";
import { Button } from "../../components/ui";
import { EntityMark } from "../../components/EntityMark";
import { creationApi, entityKinds, type Entity } from "./api";
import { ImportSources } from "./ImportSources";
import { ObjectBrowser } from "../objects/ObjectBrowser";
import { EntityChoice } from "../objects/EntityChoice";
import { MaterialClassification, materialCategories, materialTags } from './MaterialClassification';

export function DocumentContext({
  title,
  metadata,
  references,
  entities,
  world,
  busy,
  onChange,
  onSave,
  onInspect,
  readOnly = false,
  version,
}: {
  title: string;
  metadata: Record<string, string>;
  references: Entity[];
  entities: Entity[];
  world: string;
  busy: boolean;
  onChange: (value: Record<string, string>) => void;
  onSave: () => void;
  onInspect: (entity: Entity) => void;
  readOnly?: boolean;
  version: number;
}) {
  const [browsing, setBrowsing] = useState(false);
  return (
    <div className="document-context">
      <header className="document-context-heading">
        <BookOpen size={20} />
        <div>
          <span>当前文档</span>
          <h2>{title}</h2>
        </div>
      </header>
      <dl className="document-context-meta">
        {[
          ["pov", "视角人物", UserRound],
          ["location", "地点", MapPin],
          ["story_time", "故事时间", Clock3],
        ].map(([key, label, Icon]) => {
          const value = metadata[key as string];
          const Glyph = Icon as typeof UserRound;
          const object =
            key !== "story_time" && metadata[`${key}_id`] &&
            entities.find((e) => e.id === metadata[`${key}_id`]);
          return (
            <div key={key as string}>
              <dt>
                <Glyph size={15} />
                {label as string}
              </dt>
              <dd>
                {object ? (
                  <button onClick={() => onInspect(object)}>{object.name} →</button>
                ) : (
                  value || "未指定"
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="context-hint">{materialCategories[metadata.material_category || 'unclassified']} · {materialTags(metadata).join(' · ') || '无资料标签'}</p>
      <p className="context-hint">内容版本 v{version} · 正文与正式事实分别保存</p>
      {metadata.import_batch && (
        <ImportSources world={world} batch={metadata.import_batch} pages={metadata.import_source_pages} files={metadata.import_files}/>
      )}
      {!readOnly && <details className="metadata-editor">
        <summary>
          <PenLine size={14} />
          编辑文档资料
        </summary>
        <div>
          <MaterialClassification category={metadata.material_category || 'unclassified'} tags={materialTags(metadata)}
            onChange={(category,tags)=>onChange({...metadata,material_category:category,material_tags:JSON.stringify(tags)})}/>
          <EntityChoice world={world} label="视角人物" kind="character" optional value={metadata.pov_id || ''}
            onChange={id=>onChange({...metadata,pov_id:id,pov:''})}/>
          <EntityChoice world={world} label="地点" kind="location" optional value={metadata.location_id || ''}
            onChange={id=>onChange({...metadata,location_id:id,location:''})}/>
          {(metadata.pov || metadata.location) && <p className="context-hint">旧文字备注：{metadata.pov} {metadata.location}。选择具体对象后建立身份关联，同名不会自动匹配。</p>}
          {[
            ["story_time", "故事时间"],
          ].map(([key, label]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                value={metadata[key] || ""}
                onChange={(e) =>
                  onChange({ ...metadata, [key]: e.target.value })
                }
                placeholder="未指定"
              />
            </label>
          ))}
          <p className="context-hint">
            故事时间可写区间或未知；它与保存时间不同。
          </p>
          <Button onClick={onSave} disabled={busy}>
            保存文档资料
          </Button>
        </div>
      </details>}
      <section className="context-section">
        <h3>
          <UserRound size={15} />
          正文关联对象 <span>{references.length}</span>
        </h3>
        {references.length ? (
          references.map((e) => (
            <button
              className="context-object-row"
              key={e.id}
              onClick={() => onInspect(e)}
            >
              <EntityMark kind={e.kind} small />
              <span>
                <strong>{e.name}</strong>
                <small>{entityKinds[e.kind]}</small>
              </span>
            </button>
          ))
        ) : (
          <p className="context-hint">
            选中正文中的名称，再使用「链接对象」建立关联。
          </p>
        )}
      </section>
      <section className="context-section">
        <h3>查阅世界资料</h3>
        <Button onClick={() => setBrowsing(true)}>浏览世界对象资料</Button>
        {browsing && (
          <ObjectBrowser
            world={world}
            types={["entity"]}
            title="查阅世界对象"
            onClose={() => setBrowsing(false)}
            onPick={async (object) => {
              onInspect(await creationApi.entity(object.id));
              setBrowsing(false);
            }}
          />
        )}
        <Link className="text-link" to={`/worlds/${world}/create/objects`}>
          打开世界对象资料库 →
        </Link>
      </section>
    </div>
  );
}
