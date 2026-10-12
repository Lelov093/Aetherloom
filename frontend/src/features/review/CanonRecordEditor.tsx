import { useEffect, useState } from "react";
import { Button, Dialog, ErrorNotice } from "../../components/ui";
import { EntityChoice } from "../objects/EntityChoice";
import { creationApi, request, type Entity } from "../creation/api";
import {
  reviewApi,
  type CanonEvent,
  type CanonRelationship,
  type RelationshipState,
} from "./api";

export type RecordEdit =
  | { kind: "event"; event?: CanonEvent }
  | {
      kind: "relationship";
      pair?: CanonRelationship;
      state?: RelationshipState;
    };
export function CanonRecordEditor({
  world,
  edit,
  onClose,
  onSaved,
}: {
  world: string;
  edit: RecordEdit;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const event = edit.kind === "event" ? edit.event : undefined,
    pair = edit.kind === "relationship" ? edit.pair : undefined,
    state = edit.kind === "relationship" ? edit.state : undefined;
  const [entities, setEntities] = useState<Entity[]>([]),
    [events, setEvents] = useState<CanonEvent[]>([]),
    [name, setName] = useState(event?.title || state?.label || ""),
    [description, setDescription] = useState(
      event?.description || state?.description || "",
    ),
    [from, setFrom] = useState(event?.valid_from || state?.valid_from || ""),
    [until, setUntil] = useState(
      event?.valid_until || state?.valid_until || "",
    ),
    [note, setNote] = useState(
      event?.source_note || state?.source_note || "人工世界编辑",
    ),
    [participants, setParticipants] = useState(event?.participants || []),
    [roles, setRoles] = useState(event?.metadata?.participant_roles || {}),
    [location, setLocation] = useState(event?.location_id || ""),
    [causes, setCauses] = useState(event?.metadata?.causes || []),
    [before, setBefore] = useState(event?.metadata?.before_state || ""),
    [after, setAfter] = useState(event?.metadata?.after_state || ""),
    [subject, setSubject] = useState(pair?.subject_id || ""),
    [object, setObject] = useState(pair?.object_id || ""),
    [strength, setStrength] = useState(
      state?.strength == null ? "" : String(state.strength),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([creationApi.entities(world), reviewApi.records(world)])
      .then(([e, r]) => {
        if (active) {
          setEntities(e);
          setEvents(r.events);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [world]);
  const entitySelect = (
    label: string,
    value: string,
    set: (v: string) => void,
    disabled = false,
    locations = false,
  ) => (
    <EntityChoice
      world={world}
      label={label}
      value={value}
      onChange={set}
      disabled={disabled}
      kind={locations ? "location" : undefined}
      optional={locations}
    />
  );
  return (
    <Dialog
      title={`${event || state ? "编辑" : "创建"}正式${edit.kind === "event" ? "事件" : "关系状态"}`}
      onClose={onClose}
      busy={busy}
    >
      <p className="dialog-intro">
        确认会写入正式历史，独立于正文与
        Simulation。编辑保留原版本和原文来源；新增关系状态不会替代已有状态。
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const common = {
              description,
              valid_from: from || null,
              valid_until: until || null,
              source_note: note,
            };
            const body =
              edit.kind === "event"
                ? {
                    ...common,
                    title: name,
                    participants,
                    participant_roles: roles,
                    location_id: location || null,
                    causes,
                    before_state: before,
                    after_state: after,
                    ...(event ? { version: event.version } : {}),
                  }
                : {
                    ...common,
                    subject_id: subject,
                    object_id: object,
                    label: name,
                    strength: strength === "" ? null : Number(strength),
                    ...(state ? { version: state.version } : {}),
                  };
            const url =
              edit.kind === "event"
                ? event
                  ? `/events/${event.id}`
                  : `/worlds/${world}/events`
                : state
                  ? `/relationship-states/${state.id}`
                  : `/worlds/${world}/relationship-states`;
            await request(url, {
              method: event || state ? "PATCH" : "POST",
              body: JSON.stringify(body),
            });
            await onSaved();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>{edit.kind === "event" ? "事件标题" : "关系状态名称"}</span>
          <input
            required
            maxLength={160}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>说明</span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {edit.kind === "event" ? (
          <>
            {entitySelect("发生地点", location, setLocation, false, true)}
            <fieldset className="record-picker">
              <legend>参与者与角色</legend>
              {entities
                .filter(
                  (e) => e.status === "active" || participants.includes(e.id),
                )
                .map((e) => (
                  <div key={e.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={participants.includes(e.id)}
                        onChange={(v) => {
                          setParticipants((p) =>
                            v.target.checked
                              ? [...p, e.id]
                              : p.filter((id) => id !== e.id),
                          );
                          if (!v.target.checked)
                            setRoles((old) =>
                              Object.fromEntries(
                                Object.entries(old).filter(
                                  ([id]) => id !== e.id,
                                ),
                              ),
                            );
                        }}
                      />
                      {e.name}
                    </label>
                    {participants.includes(e.id) && (
                      <input
                        aria-label={`${e.name} 的参与角色`}
                        placeholder="参与角色（可选）"
                        value={roles[e.id] || ""}
                        onChange={(v) =>
                          setRoles({ ...roles, [e.id]: v.target.value })
                        }
                      />
                    )}
                  </div>
                ))}
            </fieldset>
            <fieldset className="record-picker">
              <legend>前因事件</legend>
              {events
                .filter(
                  (e) =>
                    e.id !== event?.id &&
                    (e.status === "active" || causes.includes(e.id)),
                )
                .map((e) => (
                  <label key={e.id}>
                    <input
                      type="checkbox"
                      checked={causes.includes(e.id)}
                      onChange={(v) =>
                        setCauses((p) =>
                          v.target.checked
                            ? [...p, e.id]
                            : p.filter((id) => id !== e.id),
                        )
                      }
                    />
                    {e.title}
                    {e.status !== "active" && "（已撤回，请移除或先恢复）"}
                  </label>
                ))}
              {!events.some(
                (e) => e.id !== event?.id && e.status === "active",
              ) && <p className="context-hint">尚无其他有效事件。</p>}
            </fieldset>
            <label className="field">
              <span>事件前状态</span>
              <textarea
                rows={2}
                value={before}
                onChange={(e) => setBefore(e.target.value)}
              />
            </label>
            <label className="field">
              <span>事件后状态 / 结果</span>
              <textarea
                rows={2}
                value={after}
                onChange={(e) => setAfter(e.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            {entitySelect("关系主体", subject, setSubject, !!pair)}
            {entitySelect("关系对象", object, setObject, !!pair)}
            <label className="field">
              <span>关系强度（0–1，可留空）</span>
              <input
                type="number"
                min={0}
                max={1}
                step="0.01"
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
              />
            </label>
          </>
        )}
        {[
          [from, setFrom, "生效故事时间"],
          [until, setUntil, "失效故事时间"],
          [note, setNote, "来源说明"],
        ].map(([value, set, label]) => (
          <label className="field" key={String(label)}>
            <span>{String(label)}</span>
            <input
              value={value as string}
              onChange={(e) => (set as (value: string) => void)(e.target.value)}
            />
          </label>
        ))}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="dialog-actions">
          <Button type="button" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={
              busy ||
              !loaded ||
              (edit.kind === "relationship" && (!subject || !object))
            }
          >
            明确确认并保存
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
