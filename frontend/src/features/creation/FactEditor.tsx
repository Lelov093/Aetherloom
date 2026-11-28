import { useEffect, useState, type FormEvent } from "react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { EntityChoice } from "../objects/EntityChoice";
import {
  creationApi, entityDraftData, RequestError,
  type Entity, type EntityDraft, type Fact, type FactWrite, type ObjectSchema, type FieldDefinition,
} from "./api";
import { SaveConflict } from "./SaveConflict";
import { periodsApi, type PeriodEvent } from '../periods/api';
import { EventSelect } from '../periods/PeriodViews';

export function FactEditor({ world, entity, initial, transition = false, onClose, onSubmit }: {
  world: string;
  entity: Entity;
  initial?: Fact;
  transition?: boolean;
  onClose: () => void;
  onSubmit: (data: FactWrite, event?: string) => Promise<void>;
}) {
  const [schema, setSchema] = useState<ObjectSchema>();
  const [field, setField] = useState(initial?.field_id || "");
  const [predicate, setPredicate] = useState(initial?.predicate || "");
  const [value, setValue] = useState(
    initial?.typed_value == null ? initial?.value || ""
      : Array.isArray(initial.typed_value) ? initial.typed_value.join("，") : String(initial.typed_value),
  );
  const [from, setFrom] = useState(transition ? '' : initial?.valid_from || "");
  const [until, setUntil] = useState(transition ? '' : initial?.valid_until || "");
  const [anchor, setAnchor] = useState('');
  const [events, setEvents] = useState<PeriodEvent[]>([]);
  const [note, setNote] = useState(initial?.source_note || "人工世界编辑");
  const [object, setObject] = useState(initial?.object_id || "");
  const [draftObject, setDraftObject] = useState<EntityDraft>();
  const [expectedVersion, setExpectedVersion] = useState(initial?.version);
  const [latest, setLatest] = useState<Fact>();
  const [referenceLabels, setReferenceLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [defining, setDefining] = useState(false);

  async function load() {
    try {
      setSchema(await creationApi.schema(world));
    } catch (error) {
      setError((error as Error).message);
    }
  }
  useEffect(() => { void load(); }, [world]);
  useEffect(() => {
    if (!transition) return;
    let active = true;
    periodsApi.events(world).then(value => { if (active) setEvents(value); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [world, transition]);

  const definition = schema?.fields.find(item => item.key === field);
  const type = definition?.value_type || "text";
  const reference = type === "entity" ? value : object;
  useEffect(() => {
    if (!latest) return;
    let active = true;
    const ids = [...new Set([latest.object_id, reference].filter((id): id is string => Boolean(id)))];
    void Promise.all(ids.map(async id => {
      const target = await creationApi.entity(id).catch(() => undefined);
      if (target?.world_id !== world) return [id, id];
      const summary = Object.values(target.core).find(text => text.trim())
        || target.sections.find(section => section.body.trim())?.body;
      return [id, summary ? target.name + ' · ' + summary.trim().slice(0, 80) : target.name];
    })).then(labels => { if (active) setReferenceLabels(Object.fromEntries(labels)); });
    return () => { active = false; };
  }, [world, latest, reference]);
  const savedReference = latest?.object_id || "";
  const savedLabel = referenceLabels[savedReference] || savedReference;
  const draftLabel = draftObject ? draftObject.name + "（待创建）" : referenceLabels[reference] || reference;
  const sameLabelDifferentObject = savedLabel === draftLabel && savedReference !== reference;

  function choose(id: string) {
    setDraftObject(undefined);
    if (type === "entity") setValue(id);
    else setObject(id);
  }

  function stage(draft: EntityDraft) {
    choose("");
    setDraftObject(draft);
  }

  function changeField(id: string) {
    const selected = schema?.fields.find(item => item.key === id);
    setField(id);
    setPredicate(selected?.label || "");
    setValue(selected?.value_type === "boolean" ? "false" : "");
    setObject("");
    setDraftObject(undefined);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (latest || busy) return;
    setBusy(true);
    setError("");
    try {
      let typed: Fact["typed_value"] = value;
      if (type === "number") {
        if (!value.trim() || !Number.isFinite(Number(value))) throw new Error("请输入有效数字。");
        typed = Number(value);
      } else if (type === "boolean") typed = value === "true";
      else if (type === "tags") typed = value.split(/[，,]/).map(part => part.trim()).filter(Boolean);
      await onSubmit({
        predicate, value, field_id: field || null, typed_value: field && !draftObject ? typed : null,
        object_id: reference || null, new_object: draftObject ? entityDraftData(draftObject) : undefined,
        valid_from: from || null, valid_until: until || null, source_note: note, version: expectedVersion,
      }, transition ? anchor : undefined);
    } catch (error) {
      setError((error as Error).message);
      if (initial && error instanceof RequestError && error.status === 409) {
        const owner = await creationApi.entity(entity.id).catch(() => undefined);
        const saved = owner?.facts?.find(fact => fact.id === initial.id);
        if (saved && saved.version !== expectedVersion) {
          setLatest(saved);
          setError("");
        }
      }
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title={transition ? '记录事实的历史变化' : initial ? "明确修改世界事实" : "明确确认世界事实"}
    onClose={onClose} busy={busy} className={defining ? "" : "fact-dialog"}>
    {defining ? <FieldForm
      onCancel={() => setDefining(false)}
      onSubmit={async data => {
        await creationApi.defineField(world, data);
        await load();
        setField(data.key);
        setPredicate(data.label);
        setValue(data.value_type === "boolean" ? "false" : "");
        setObject("");
        setDraftObject(undefined);
        setDefining(false);
      }}
    /> : <form onSubmit={submit}>
      <div className="fact-dialog-content">
        <p className="dialog-intro">{transition ? '原事实在事件前有效，新事实从该事件后生效。' : '确认会写入正式设定，旧版本及原文来源保留。故事时间未知可以留空。'}</p>
        {transition && <EventSelect events={events} value={anchor} onChange={setAnchor} disabled={busy}/>}
        <label className="field">
          <span>字段</span>
          <select value={field} onChange={event => changeField(event.target.value)} disabled={busy || transition}>
            <option value="">自由事实（文本）</option>
            {schema?.fields.filter(item => !item.kinds.length || item.kinds.includes(entity.kind)).map(item =>
              <option key={item.key} value={item.key}>{item.label} · {typeNames[item.value_type]}</option>)}
          </select>
        </label>
        {!field && <label className="field">
          <span>属性 / 事实名称</span>
          <input value={predicate} required maxLength={160} disabled={busy || transition} onChange={event => setPredicate(event.target.value)} />
        </label>}
        {type === "entity" ? <EntityChoice world={world} label="事实引用对象" value={value} onChange={choose}
          draft={draftObject} onStage={stage} disabled={busy} /> : <label className="field">
          <span>事实内容</span>
          {type === "boolean" ? <select value={value} disabled={busy} onChange={event => setValue(event.target.value)}>
            <option value="false">否</option>
            <option value="true">是</option>
          </select> : <input value={value} type={type === "number" ? "number" : "text"} step="any"
            required={type !== "tags"} disabled={busy} placeholder={type === "tags" ? "以逗号分隔多个标签" : undefined}
            onChange={event => setValue(event.target.value)} />}
        </label>}
        {!field && <EntityChoice world={world} label="引用对象（可选）" value={object} onChange={choose}
          draft={draftObject} onStage={stage} disabled={busy} optional />}
        {!transition && <>
          {!initial?.from_event_id && <label className="field"><span>生效故事时间</span><input value={from} disabled={busy} onChange={event => setFrom(event.target.value)} /></label>}
          {!initial?.to_event_id && <label className="field"><span>失效故事时间</span><input value={until} disabled={busy} onChange={event => setUntil(event.target.value)} /></label>}
        </>}
        <label className="field"><span>来源说明</span><input value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        {latest && expectedVersion !== undefined && <SaveConflict base={expectedVersion} current={latest.version}
          fields={[
            ["事实名称", latest.predicate, predicate],
            ["字段", schema?.fields.find(item => item.key === latest.field_id)?.label ?? "自由事实（文本）", definition?.label ?? "自由事实（文本）"],
            ["事实内容", latest.value_type === "entity" ? "" : latest.value, type === "entity" ? "" : value],
            ["引用对象", sameLabelDifferentObject ? savedLabel + " · " + savedReference : savedLabel,
              sameLabelDifferentObject ? draftLabel + " · " + reference : draftLabel],
            ["生效故事时间", latest.valid_from || "", from],
            ["失效故事时间", latest.valid_until || "", until],
            ["来源说明", latest.source_note, note],
          ]}
        />}
      </div>
      <div className="dialog-actions">
        <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
        {latest ? latest.status === "active" && <Button type="button" variant="primary" onClick={() => {
          setExpectedVersion(latest.version);
          setLatest(undefined);
        }}>保留草稿，以 v{latest.version} 继续编辑</Button> : <>
          {!transition && <Button type="button" disabled={busy} onClick={() => setDefining(true)}>定义扩展字段</Button>}
          <Button variant="primary" disabled={busy || !schema || transition && !anchor || (type === "entity" && !reference && !draftObject)}>
            {transition ? '保存新状态' : '确认并保存事实'}
          </Button>
        </>}
      </div>
    </form>}
  </Dialog>;
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
